import type { Circuit } from '../domain/circuit/circuit';
import type { Patch } from '../domain/patch/patch';

const SMOOTHING = 0.01; // seconds; avoids zipper noise on param changes

/** Compiles a Patch into Web Audio nodes and keeps them in sync with domain state. */
export class AudioEngine {
  private ctx?: AudioContext;

  constructor(private readonly patch: Patch) {}

  async start(): Promise<void> {
    if (!this.ctx) this.build(new AudioContext());
    await this.ctx?.resume();
  }

  async stop(): Promise<void> {
    await this.ctx?.suspend();
  }

  private build(ctx: AudioContext): void {
    this.ctx = ctx;
    const compiled = new Map<string, Map<string, AudioNode>>();
    for (const [id, device] of this.patch.devices) {
      compiled.set(id, this.compileCircuit(ctx, device.circuit));
    }

    const jackNode = (d: string, dir: 'in' | 'out', j: string): AudioNode => {
      const nodeId = this.patch.device(d).jack(dir, j).nodeId;
      const node = compiled.get(d)?.get(nodeId);
      if (!node) throw new Error(`No audio node for ${d}.${j}`);
      return node;
    };

    for (const c of this.patch.connections) {
      jackNode(c.from.device, 'out', c.from.jack).connect(jackNode(c.to.device, 'in', c.to.jack));
    }
    if (this.patch.output) {
      const { device, jack } = this.patch.output;
      jackNode(device, 'out', jack).connect(ctx.destination);
    }
  }

  private compileCircuit(ctx: AudioContext, circuit: Circuit): Map<string, AudioNode> {
    const nodes = new Map<string, AudioNode>();
    for (const n of circuit.nodes.values()) {
      switch (n.kind) {
        case 'oscillator': {
          const osc = ctx.createOscillator();
          osc.type = n.options.waveform as OscillatorType;
          osc.frequency.value = n.params.frequency ?? 440;
          osc.detune.value = n.params.detune ?? 0;
          osc.start();
          nodes.set(n.id, osc);
          break;
        }
        case 'filter': {
          const f = ctx.createBiquadFilter();
          f.type = n.options.type as BiquadFilterType;
          f.frequency.value = n.params.frequency ?? 350;
          f.Q.value = n.params.Q ?? 1;
          f.gain.value = n.params.gain ?? 0;
          f.detune.value = n.params.detune ?? 0;
          nodes.set(n.id, f);
          break;
        }
        case 'envelope': {
          // CV source: its offset is automated to follow the ADSR whenever `gate` changes.
          const src = ctx.createConstantSource();
          src.offset.value = 0;
          src.start();
          nodes.set(n.id, src);
          break;
        }
        case 'constant': {
          // DC source: `offset` is a CV that other nodes can sum into a param (e.g. pitch in cents).
          const src = ctx.createConstantSource();
          src.offset.value = n.params.offset ?? 0;
          src.start();
          nodes.set(n.id, src);
          break;
        }
        case 'waveshaper': {
          const ws = ctx.createWaveShaper();
          if (n.options.curve === 'pulse') ws.curve = pulseCurve();
          ws.oversample = '4x';
          nodes.set(n.id, ws);
          break;
        }
        case 'noise': {
          const src = ctx.createBufferSource();
          src.buffer = noiseBuffer(ctx);
          src.loop = true;
          src.start();
          nodes.set(n.id, src);
          break;
        }
        case 'random': {
          const src = ctx.createBufferSource();
          src.buffer = stepBuffer(ctx);
          src.loop = true;
          src.playbackRate.value = (n.params.rate ?? 4) / STEP_SECONDS_INV;
          src.start();
          nodes.set(n.id, src);
          break;
        }
        case 'pan': {
          const p = ctx.createStereoPanner();
          p.pan.value = n.params.pan ?? 0;
          nodes.set(n.id, p);
          break;
        }
        case 'gain': {
          const g = ctx.createGain();
          g.gain.value = n.params.gain ?? 1;
          nodes.set(n.id, g);
          break;
        }
      }
    }

    for (const cable of circuit.cables) {
      const from = nodes.get(cable.from);
      const to = nodes.get(cable.to);
      if (!from || !to) continue;
      if (cable.port === 'in') from.connect(to);
      else {
        const param = audioParam(to, cable.port);
        if (param) from.connect(param);
      }
    }

    circuit.onChange((change) => {
      const node = nodes.get(change.nodeId);
      if (!node) return;
      if (circuit.node(change.nodeId).kind === 'envelope') {
        if (node instanceof ConstantSourceNode && change.type === 'param' && change.name === 'gate') {
          applyEnvelope(ctx, node.offset, circuit.node(change.nodeId).params, change.value > 0);
        }
        return;
      }
      if (node instanceof AudioBufferSourceNode && change.type === 'param' && change.name === 'rate') {
        node.playbackRate.setTargetAtTime(change.value / STEP_SECONDS_INV, ctx.currentTime, SMOOTHING);
        return;
      }
      if (change.type === 'option') {
        if (node instanceof OscillatorNode && change.name === 'waveform') {
          node.type = change.value as OscillatorType;
        } else if (node instanceof BiquadFilterNode && change.name === 'type') {
          node.type = change.value as BiquadFilterType;
        }
        return;
      }
      const param = audioParam(node, change.name);
      param?.setTargetAtTime(change.value, ctx.currentTime, SMOOTHING);
    });

    return nodes;
  }
}

function audioParam(node: AudioNode, name: string): AudioParam | undefined {
  const p = (node as unknown as Record<string, unknown>)[name];
  return p instanceof AudioParam ? p : undefined;
}

const MIN_TIME = 0.001;

/** Schedules ADSR on `offset`, starting from wherever it currently is (so retriggers don't click). */
function applyEnvelope(
  ctx: AudioContext,
  offset: AudioParam,
  p: Record<string, number>,
  gateOn: boolean,
): void {
  const t = ctx.currentTime;
  offset.cancelScheduledValues(t);
  offset.setValueAtTime(offset.value, t);
  if (gateOn) {
    const attack = Math.max(p.attack ?? 0.01, MIN_TIME);
    offset.linearRampToValueAtTime(1, t + attack);
    // setTargetAtTime reaches ~95% after 3 time constants, so decay/3 ~= "decay time".
    offset.setTargetAtTime(p.sustain ?? 0.7, t + attack, Math.max(p.decay ?? 0.2, MIN_TIME) / 3);
  } else {
    offset.setTargetAtTime(0, t, Math.max(p.release ?? 0.3, MIN_TIME) / 3);
  }
}

/** Hard-clips to +/-1: a sawtooth plus a DC offset becomes a pulse whose width follows the offset. */
function pulseCurve(): Float32Array<ArrayBuffer> {
  const size = 1024;
  const curve = new Float32Array(new ArrayBuffer(size * 4));
  for (let i = 0; i < size; i++) curve[i] = i < size / 2 ? -1 : 1;
  return curve;
}

function noiseBuffer(ctx: AudioContext): AudioBuffer {
  const buffer = ctx.createBuffer(1, ctx.sampleRate * 2, ctx.sampleRate);
  const data = buffer.getChannelData(0);
  for (let i = 0; i < data.length; i++) data[i] = Math.random() * 2 - 1;
  return buffer;
}

// Sample-and-hold buffer: STEPS random values, each held for 1/STEP_SECONDS_INV s at playbackRate 1.
// playbackRate = rate / STEP_SECONDS_INV then gives `rate` new values per second.
const STEPS = 64;
const STEP_SECONDS_INV = 10;
const STEP_SAMPLE_RATE = 8000;

function stepBuffer(ctx: AudioContext): AudioBuffer {
  const perStep = STEP_SAMPLE_RATE / STEP_SECONDS_INV;
  const buffer = ctx.createBuffer(1, STEPS * perStep, STEP_SAMPLE_RATE);
  const data = buffer.getChannelData(0);
  for (let i = 0; i < STEPS; i++) data.fill(Math.random() * 2 - 1, i * perStep, (i + 1) * perStep);
  return buffer;
}

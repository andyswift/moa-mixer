import type { Circuit } from '../domain/circuit/circuit';
import type { Patch } from '../domain/patch/patch';

const SMOOTHING = 0.01; // seconds; avoids zipper noise on param changes

/** Compiles a Patch into Web Audio nodes and keeps them in sync with domain state. */
export class AudioEngine {
  private ctx?: AudioContext;
  private readonly meters = new Map<string, { analyser: AnalyserNode; buffer: Float32Array<ArrayBuffer> }>();

  constructor(private readonly patch: Patch) {}

  async start(): Promise<void> {
    if (!this.ctx) this.build(new AudioContext());
    await this.ctx?.resume();
  }

  async stop(): Promise<void> {
    await this.ctx?.suspend();
  }

  /** The audio clock in seconds (0 until audio has started). Schedulers use it to place hits precisely. */
  get currentTime(): number {
    return this.ctx?.currentTime ?? 0;
  }

  /** Peak level (linear, 0..1+) of a meter node over the last few milliseconds; 0 until audio starts. */
  readLevel(deviceId: string, nodeId: string): number {
    const m = this.meters.get(`${deviceId}/${nodeId}`);
    if (!m) return 0;
    m.analyser.getFloatTimeDomainData(m.buffer);
    let peak = 0;
    for (const v of m.buffer) peak = Math.max(peak, Math.abs(v));
    return peak;
  }

  private build(ctx: AudioContext): void {
    this.ctx = ctx;
    const compiled = new Map<string, Map<string, AudioNode>>();
    for (const [id, device] of this.patch.devices) {
      compiled.set(id, this.compileCircuit(ctx, id, device.circuit));
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

  private compileCircuit(ctx: AudioContext, deviceId: string, circuit: Circuit): Map<string, AudioNode> {
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
        case 'convolver': {
          const cv = ctx.createConvolver();
          cv.buffer = reverbImpulse(ctx, IR_SECONDS[n.options.size ?? 'medium'] ?? IR_SECONDS.medium!);
          nodes.set(n.id, cv);
          break;
        }
        case 'compressor': {
          const comp = ctx.createDynamicsCompressor();
          comp.threshold.value = n.params.threshold ?? -24;
          comp.knee.value = n.params.knee ?? 30;
          comp.ratio.value = n.params.ratio ?? 12;
          comp.attack.value = n.params.attack ?? 0.003;
          comp.release.value = n.params.release ?? 0.25;
          nodes.set(n.id, comp);
          break;
        }
        case 'delay': {
          const d = ctx.createDelay(n.params.maxTime ?? 1);
          d.delayTime.value = n.params.delayTime ?? 0.25;
          nodes.set(n.id, d);
          break;
        }
        case 'trigger': {
          // CV source like an envelope, but fired by trigger()/choke() events rather than a gate.
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
          else if (n.options.curve === 'soft') ws.curve = softCurve();
          else if (n.options.curve === 'limit') ws.curve = limitCurve();
          else if (n.options.curve === 'warm') ws.curve = warmCurve();
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
        case 'meter': {
          const analyser = ctx.createAnalyser();
          analyser.fftSize = 1024;
          const channel = n.options.channel ?? 'mono';
          if (channel === 'mono') {
            nodes.set(n.id, analyser);
          } else {
            const split = ctx.createChannelSplitter(2);
            split.connect(analyser, channel === 'left' ? 0 : 1);
            nodes.set(n.id, split);
          }
          this.meters.set(`${deviceId}/${n.id}`, {
            analyser,
            buffer: new Float32Array(new ArrayBuffer(analyser.fftSize * 4)),
          });
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
          if (n.options.channels === 'mono') {
            g.channelCount = 1;
            g.channelCountMode = 'explicit';
          }
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
      if (change.type === 'trigger' || change.type === 'choke') {
        if (node instanceof ConstantSourceNode) {
          if (change.type === 'trigger') fireTrigger(ctx, node.offset, circuit.node(change.nodeId).params, circuit.node(change.nodeId).options.shape, change.velocity, change.when);
          else chokeTrigger(ctx, node.offset, change.when);
        }
        return;
      }
      if (circuit.node(change.nodeId).kind === 'trigger') return; // its params are read when it fires
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
        } else if (node instanceof ConvolverNode && change.name === 'size') {
          node.buffer = reverbImpulse(ctx, IR_SECONDS[change.value] ?? IR_SECONDS.medium!);
        }
        return;
      }
      const param = audioParam(node, change.name);
      param?.setTargetAtTime(change.value, ctx.currentTime, timeConstant(circuit, change.nodeId, change.name));
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

const TRIGGER_ATTACK = 0.001;
const CLAP_BURSTS = 3; // quick bursts before the tail
const CLAP_BURST_TAU = 0.0035;
const CHOKE_TAU = 0.005;

/**
 * Fires a one-shot envelope: a 1 ms attack to peak (scaled by velocity) then an exponential decay.
 * The `clap` shape stutters through a few short bursts first. `decay` is roughly the time to -40 dB.
 */
function fireTrigger(
  ctx: AudioContext,
  offset: AudioParam,
  p: Record<string, number>,
  shape: string | undefined,
  velocity: number,
  when?: number,
): void {
  const velSens = p.velSens ?? 1;
  const peak = (p.peak ?? 1) * (1 - velSens + velSens * velocity);
  const tau = Math.max(p.decay ?? 0.2, MIN_TIME) / 4;
  const t = Math.max(when ?? 0, ctx.currentTime);
  offset.cancelScheduledValues(t);
  offset.setValueAtTime(offset.value, t);
  offset.linearRampToValueAtTime(peak, t + TRIGGER_ATTACK);
  if (shape !== 'clap') {
    offset.setTargetAtTime(0, t + TRIGGER_ATTACK, tau);
    return;
  }
  const gap = Math.max(p.spread ?? 0.012, 0.002);
  offset.setTargetAtTime(0, t + TRIGGER_ATTACK, CLAP_BURST_TAU);
  for (let k = 1; k <= CLAP_BURSTS; k++) {
    const tk = t + k * gap;
    offset.setValueAtTime(peak, tk);
    offset.setTargetAtTime(0, tk, k === CLAP_BURSTS ? tau : CLAP_BURST_TAU);
  }
}

function chokeTrigger(ctx: AudioContext, offset: AudioParam, when?: number): void {
  const t = Math.max(when ?? 0, ctx.currentTime);
  offset.cancelScheduledValues(t);
  offset.setValueAtTime(offset.value, t);
  offset.setTargetAtTime(0, t, CHOKE_TAU);
}

/** Hard-clips to +/-1: a sawtooth plus a DC offset becomes a pulse whose width follows the offset. */
function pulseCurve(): Float32Array<ArrayBuffer> {
  const size = 1024;
  const curve = new Float32Array(new ArrayBuffer(size * 4));
  for (let i = 0; i < size; i++) curve[i] = i < size / 2 ? -1 : 1;
  return curve;
}

/** tanh saturation normalised to +/-1 across the shaper's input range; small signals get gain ~2.5. */
const SOFT_DRIVE = 2.5;
function softCurve(): Float32Array<ArrayBuffer> {
  const size = 2048;
  const curve = new Float32Array(new ArrayBuffer(size * 4));
  for (let i = 0; i < size; i++) {
    const x = (i / (size - 1)) * 2 - 1;
    curve[i] = Math.tanh(SOFT_DRIVE * x) / Math.tanh(SOFT_DRIVE);
  }
  return curve;
}

/** Linear up to 0.9, a soft knee, then a hard ceiling (inputs beyond +/-1 clamp to the curve's ends). */
function limitCurve(): Float32Array<ArrayBuffer> {
  const size = 4097;
  const curve = new Float32Array(new ArrayBuffer(size * 4));
  const knee = 0.9;
  for (let i = 0; i < size; i++) {
    const x = (i / (size - 1)) * 2 - 1;
    const a = Math.abs(x);
    curve[i] = Math.sign(x) * (a < knee ? a : knee + (1 - knee) * Math.tanh((a - knee) / (1 - knee)));
  }
  return curve;
}

export const WARM_RANGE = 3; // the 'warm' curve spans input amplitudes of +/-3 (feed it through a 1/3 gain)

/**
 * The channel gain stage: transparent up to 0.6, then a smooth tanh knee that settles at 1.0, reached
 * (with a flat slope, so no corner) at the edge of the +/-3 input range. Hot signals round off instead of clipping.
 */
function warmCurve(): Float32Array<ArrayBuffer> {
  const size = 4097;
  const curve = new Float32Array(new ArrayBuffer(size * 4));
  const knee = 0.6;
  for (let i = 0; i < size; i++) {
    const x = (i / (size - 1)) * 2 - 1;
    const a = Math.abs(x) * WARM_RANGE;
    curve[i] = Math.sign(x) * (a < knee ? a : knee + (1 - knee) * Math.tanh((a - knee) / (1 - knee)));
  }
  return curve;
}

// Reverb tail lengths (seconds to -60 dB) for the convolver's size option.
const IR_SECONDS: Record<string, number> = { small: 0.9, medium: 2.4, large: 5 };

/** A stereo impulse response: decorrelated noise with an exponential decay that also darkens as it fades. */
function reverbImpulse(ctx: AudioContext, seconds: number): AudioBuffer {
  const rate = ctx.sampleRate;
  const length = Math.floor(rate * seconds);
  const buffer = ctx.createBuffer(2, length, rate);
  const k = Math.log(1000) / seconds;
  for (let ch = 0; ch < 2; ch++) {
    const data = buffer.getChannelData(ch);
    let lp = 0;
    for (let i = 0; i < length; i++) {
      const t = i / rate;
      const envelope = Math.exp(-k * t) * Math.min(1, t / 0.004);
      const brightness = 0.75 * Math.exp(-t * 1.2) + 0.06; // one-pole coefficient: bright early, dark late
      lp += brightness * ((Math.random() * 2 - 1) - lp);
      data[i] = lp * envelope;
    }
  }
  return buffer;
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

/** A constant source with a `glide` param slides to new offsets over that many seconds (portamento). */
function timeConstant(circuit: Circuit, nodeId: string, param: string): number {
  const node = circuit.node(nodeId);
  if (node.kind === 'constant' && param === 'offset' && node.params.glide) {
    return Math.max(node.params.glide / 3, SMOOTHING); // ~95% of the way after 3 time constants
  }
  return SMOOTHING;
}

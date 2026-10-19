import type { Circuit } from '../domain/circuit/circuit';
import type { Patch } from '../domain/patch/patch';
import { DF_NAME, DF_SOURCE } from './dfWorklet';
import { M2600_SWITCHES } from '../domain/devices/m2600Params';
import { DUO_NAME, DUO_SOURCE } from './duoWorklet';
import { FOLD_NAME, FOLD_SOURCE } from './foldWorklet';
import { LADDER_NAME, LADDER_SOURCE } from './ladderWorklet';
import { SAMPLER_NAME, SAMPLER_SOURCE } from './samplerWorklet';
import { STRING_NAME, STRING_SOURCE } from './stringWorklet';
import { TONE_NAME, TONE_SOURCE } from './toneWorklet';
import { GRANULAR_NAME, GRANULAR_SOURCE } from './granularWorklet';
import { M2600_NAME, M2600_SOURCE } from './m2600Worklet';
import { PIPE_NAME, PIPE_SOURCE, SPRING_NAME } from './pipeWorklet';

const SMOOTHING = 0.01; // seconds; avoids zipper noise on param changes

/** What a granular node reports for display: buffer peaks (oldest to newest) and live grains as [x, width] pairs. */
export interface GrainView {
  peaks: Float32Array;
  grains: number[];
}

/** What a pipe node reports for display: which of its eight voices are sounding. */
export interface PipeView {
  active: boolean[];
}

/** What a filter-box node reports for display: envelope levels, whether each envelope's gate is open, S&H value. */
export interface DFView {
  env: number[];
  gate: boolean[];
  sh: number;
}

/** What a duo-synth node reports for display: the three modulator levels and whether the gate is open. */
export interface DuoView {
  m: number[];
  gate: boolean;
}

/** What a 2600 node reports for display: the keyboard gate, LFO and S/H clock lamps, the electronic switch, envelope levels (0-10 V). */
export interface M2600View {
  gate: boolean;
  lfo: boolean;
  clk: boolean;
  esw: number;
  adsr: number;
  ar: number;
  /** The MOA-SQ16 sequencer: the current step (0-15), whether it runs, and its clock lamp. */
  sq?: { step: number; running: boolean; clk: boolean };
}

/** What a string node reports for display: its modes' amplitudes (m) and how far tension modulation has raised the pitch. */
/** What a sampler node reports for display: [pad, position 0..1 through its sound, envelope] per voice playing. */
export interface SamplerView {
  voices: [number, number, number][];
}

export interface StringView {
  amps: Float32Array;
  pitchScale: number;
}

/** Compiles a Patch into Web Audio nodes and keeps them in sync with domain state. */
export class AudioEngine {
  private ctx?: AudioContext;
  private compiled = new Map<string, Map<string, AudioNode>>();
  private monitor?: GainNode;
  private monitorOn = true;
  private readonly compressors = new Map<string, DynamicsCompressorNode>();
  private readonly grainViews = new Map<string, GrainView>();
  private readonly pipeViews = new Map<string, PipeView>();
  private readonly dfViews = new Map<string, DFView>();
  private readonly duoViews = new Map<string, DuoView>();
  private readonly m2600Views = new Map<string, M2600View>();
  private readonly stringViews = new Map<string, StringView>();
  private readonly samplerViews = new Map<string, SamplerView>();
  private readonly meters = new Map<string, { analyser: AnalyserNode; buffer: Float32Array<ArrayBuffer> }>();

  constructor(private readonly patch: Patch) {}

  async start(): Promise<void> {
    if (!this.ctx) {
      const ctx = new AudioContext();
      await ctx.audioWorklet.addModule(workletModuleUrl());
      this.build(ctx);
    }
    await this.ctx?.resume();
  }

  /**
   * Renders a patch without speakers, faster than real time: `perform` plays it (hits placed at audio-clock times
   * from 0, as a sequencer would), and the first `seconds` of its outputs come back. For making sounds from the band's
   * own instruments (the MOA-60's factory kit).
   */
  static async render(patch: Patch, seconds: number, sampleRate: number, perform: () => void, channels = 2): Promise<AudioBuffer> {
    const ctx = new OfflineAudioContext(channels, Math.ceil(seconds * sampleRate), sampleRate);
    await ctx.audioWorklet.addModule(workletModuleUrl());
    new AudioEngine(patch).build(ctx);
    perform();
    return ctx.startRendering();
  }

  async stop(): Promise<void> {
    await this.ctx?.suspend();
  }

  /** The running AudioContext; undefined until `start()`. */
  get context(): AudioContext | undefined {
    return this.ctx;
  }

  /** Turns this page's own speakers on or off without affecting what is tapped from its jacks. */
  setMonitor(on: boolean): void {
    this.monitorOn = on;
    if (this.monitor && this.ctx) this.monitor.gain.setTargetAtTime(on ? 1 : 0, this.ctx.currentTime, 0.02);
  }

  /** The Web Audio node behind a device's jack, for tapping it or feeding it from outside the patch (the audio bus). */
  jackNode(deviceId: string, dir: 'in' | 'out', jack: string): AudioNode | undefined {
    const nodeId = this.patch.device(deviceId).jack(dir, jack).nodeId;
    return this.compiled.get(deviceId)?.get(nodeId);
  }

  /** Cuts or restores the patch cable between two jacks, e.g. to swap an internal source for audio from another tab. */
  setCable(from: { device: string; jack: string }, to: { device: string; jack: string }, on: boolean): void {
    const src = this.jackNode(from.device, 'out', from.jack);
    const dst = this.jackNode(to.device, 'in', to.jack);
    if (!src || !dst) return;
    if (on) src.connect(dst);
    else src.disconnect(dst);
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

  /** The latest buffer and grain snapshot from a granular node; undefined until audio has started. */
  readGranular(deviceId: string, nodeId: string): GrainView | undefined {
    return this.grainViews.get(`${deviceId}/${nodeId}`);
  }

  /** The latest voice activity from a pipe node; undefined until audio has started. */
  readPipe(deviceId: string, nodeId: string): PipeView | undefined {
    return this.pipeViews.get(`${deviceId}/${nodeId}`);
  }

  /** The latest envelope and gate state of a filter-box node; undefined until audio has started. */
  readDF(deviceId: string, nodeId: string): DFView | undefined {
    return this.dfViews.get(`${deviceId}/${nodeId}`);
  }

  /** The latest voices of a sampler node ([pad, position 0..1, envelope] each); undefined until audio has started. */
  readSampler(deviceId: string, nodeId: string): SamplerView | undefined {
    return this.samplerViews.get(`${deviceId}/${nodeId}`);
  }

  /** The latest mode amplitudes of a string node; undefined until audio has started. */
  readString(deviceId: string, nodeId: string): StringView | undefined {
    return this.stringViews.get(`${deviceId}/${nodeId}`);
  }

  /** The latest lamps and envelope levels of a 2600 node; undefined until audio has started. */
  readM2600(deviceId: string, nodeId: string): M2600View | undefined {
    return this.m2600Views.get(`${deviceId}/${nodeId}`);
  }

  /** The latest modulator levels of a duo-synth node; undefined until audio has started. */
  readDuo(deviceId: string, nodeId: string): DuoView | undefined {
    return this.duoViews.get(`${deviceId}/${nodeId}`);
  }

  /** Current gain reduction of a compressor node in dB (0 or negative); 0 until audio starts. */
  readReduction(deviceId: string, nodeId: string): number {
    return this.compressors.get(`${deviceId}/${nodeId}`)?.reduction ?? 0;
  }

  private build(ctx: BaseAudioContext): void {
    if (ctx instanceof AudioContext) this.ctx = ctx;
    const compiled = new Map<string, Map<string, AudioNode>>();
    for (const [id, device] of this.patch.devices) {
      compiled.set(id, this.compileCircuit(ctx, id, device.circuit));
    }
    this.compiled = compiled;

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
      // The patch outputs reach the speakers through a gain stage, so a page can silence its own speakers while
      // its audio is being played elsewhere (the audio bus taps the jacks themselves, before this).
      this.monitor = ctx.createGain();
      this.monitor.gain.value = this.monitorOn ? 1 : 0;
      this.monitor.connect(ctx.destination);
      for (const { device, jack } of [this.patch.output, ...this.patch.extraOutputs]) jackNode(device, 'out', jack).connect(this.monitor);
    }
  }

  private compileCircuit(ctx: BaseAudioContext, deviceId: string, circuit: Circuit): Map<string, AudioNode> {
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
        case 'follower': {
          const f = new AudioWorkletNode(ctx, FOLLOWER_NAME, {
            numberOfInputs: 1, numberOfOutputs: 1, outputChannelCount: [1],
            parameterData: { attack: n.params.attack ?? 0.003, release: n.params.release ?? 0.12 },
          });
          nodes.set(n.id, f);
          break;
        }
        case 'granular': {
          const { maxTime, ...params } = n.params;
          const g = new AudioWorkletNode(ctx, GRANULAR_NAME, {
            numberOfInputs: 1, numberOfOutputs: 1, outputChannelCount: [2],
            parameterData: params, processorOptions: { seconds: maxTime ?? 20 },
          });
          g.port.onmessage = (e: MessageEvent<GrainView>) => this.grainViews.set(`${deviceId}/${n.id}`, e.data);
          nodes.set(n.id, g);
          break;
        }
        case 'pipe': {
          const node = new AudioWorkletNode(ctx, PIPE_NAME, {
            numberOfInputs: 0, numberOfOutputs: 1, outputChannelCount: [2], parameterData: n.params,
          });
          node.port.onmessage = (e: MessageEvent<PipeView>) => this.pipeViews.set(`${deviceId}/${n.id}`, e.data);
          nodes.set(n.id, node);
          break;
        }
        case 'spring': {
          nodes.set(n.id, new AudioWorkletNode(ctx, SPRING_NAME, {
            numberOfInputs: 1, numberOfOutputs: 1, outputChannelCount: [2], parameterData: n.params,
          }));
          break;
        }
        case 'df': {
          const node = new AudioWorkletNode(ctx, DF_NAME, {
            numberOfInputs: 1, numberOfOutputs: 1, outputChannelCount: [2], channelCount: 2, channelCountMode: 'explicit',
            parameterData: n.params,
          });
          node.port.onmessage = (e: MessageEvent<DFView>) => this.dfViews.set(`${deviceId}/${n.id}`, e.data);
          nodes.set(n.id, node);
          break;
        }
        case 'duo': {
          const node = new AudioWorkletNode(ctx, DUO_NAME, {
            numberOfInputs: 0, numberOfOutputs: 1, outputChannelCount: [2], parameterData: n.params,
          });
          node.port.onmessage = (e: MessageEvent<DuoView>) => this.duoViews.set(`${deviceId}/${n.id}`, e.data);
          nodes.set(n.id, node);
          break;
        }
        case 'string': {
          const node = new AudioWorkletNode(ctx, STRING_NAME, {
            numberOfInputs: 0, numberOfOutputs: 1, outputChannelCount: [1], parameterData: n.params,
            processorOptions: { config: JSON.parse(n.options.config ?? '{}') as unknown },
          });
          node.port.onmessage = (e: MessageEvent<StringView>) => this.stringViews.set(`${deviceId}/${n.id}`, e.data);
          nodes.set(n.id, node);
          break;
        }
        case 'tone': {
          nodes.set(n.id, new AudioWorkletNode(ctx, TONE_NAME, {
            numberOfInputs: 0, numberOfOutputs: 1, outputChannelCount: [1], parameterData: n.params,
            processorOptions: { role: n.options.role, preset: JSON.parse(n.options.preset ?? '{}') as unknown },
          }));
          break;
        }
        case 'sampler': {
          const node = new AudioWorkletNode(ctx, SAMPLER_NAME, {
            numberOfInputs: 0, numberOfOutputs: 1, outputChannelCount: [2], parameterData: n.params,
          });
          node.port.onmessage = (e: MessageEvent<{ type: 'ready' } | ({ type: 'view' } & SamplerView)>) => {
            if (e.data.type === 'ready') circuit.nodeReady(n.id);
            else this.samplerViews.set(`${deviceId}/${n.id}`, e.data);
          };
          nodes.set(n.id, node);
          break;
        }
        case 'ladder': {
          nodes.set(n.id, new AudioWorkletNode(ctx, LADDER_NAME, {
            numberOfInputs: 1, numberOfOutputs: 1, outputChannelCount: [1], channelCount: 1, channelCountMode: 'explicit',
            parameterData: n.params,
          }));
          break;
        }
        case 'fold': {
          nodes.set(n.id, new AudioWorkletNode(ctx, FOLD_NAME, {
            numberOfInputs: 1, numberOfOutputs: 1, outputChannelCount: [1], channelCount: 1, channelCountMode: 'explicit',
            parameterData: n.params,
          }));
          break;
        }
        case 'm2600': {
          const node = new AudioWorkletNode(ctx, M2600_NAME, {
            numberOfInputs: 0, numberOfOutputs: 1, outputChannelCount: [2], parameterData: n.params,
            processorOptions: { cords: JSON.parse(n.options.cords ?? '[]') as unknown },
          });
          node.port.onmessage = (e: MessageEvent<M2600View>) => this.m2600Views.set(`${deviceId}/${n.id}`, e.data);
          nodes.set(n.id, node);
          break;
        }
        case 'compressor': {
          const comp = ctx.createDynamicsCompressor();
          this.compressors.set(`${deviceId}/${n.id}`, comp);
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
          else if (n.options.curve === 'tube') ws.curve = tubeCurve();
          else if (n.options.curve === 'abs') ws.curve = absCurve();
          else if (n.options.curve === 'crush') ws.curve = crushCurve(n.params.bits ?? 16);
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
      if (change.type === 'note' || change.type === 'gate' || change.type === 'play') {
        if (node instanceof AudioWorkletNode) node.port.postMessage(change);
        return;
      }
      if (change.type === 'message') {
        if (node instanceof AudioWorkletNode) node.port.postMessage(change.data);
        return;
      }
      if (change.type === 'trigger' || change.type === 'choke') {
        if (node instanceof ConstantSourceNode) {
          if (change.type === 'trigger') fireTrigger(ctx, node.offset, circuit.node(change.nodeId).params, circuit.node(change.nodeId).options.shape, change.velocity, change.when);
          else chokeTrigger(ctx, node.offset, change.when);
        }
        return;
      }
      if (circuit.node(change.nodeId).kind === 'trigger') return; // its params are read when it fires
      if (node instanceof WaveShaperNode && change.type === 'param' && change.name === 'bits') {
        node.curve = crushCurve(change.value);
        return;
      }
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
      if (circuit.node(change.nodeId).kind === 'm2600' && M2600_SWITCHES.has(change.name)) {
        param?.setValueAtTime(change.value, ctx.currentTime);
        return;
      }
      if (circuit.node(change.nodeId).kind === 'duo' && DUO_SWITCHES.test(change.name)) {
        param?.setValueAtTime(change.value, ctx.currentTime);
        return;
      }
      if (circuit.node(change.nodeId).kind === 'df' && DF_SWITCHES.test(change.name)) {
        param?.setValueAtTime(change.value, ctx.currentTime); // a switch position, not something to glide through
        return;
      }
      param?.setTargetAtTime(change.value, ctx.currentTime, timeConstant(circuit, change.nodeId, change.name));
    });

    return nodes;
  }
}

function audioParam(node: AudioNode, name: string): AudioParam | undefined {
  if (node instanceof AudioWorkletNode) return node.parameters.get(name);
  const p = (node as unknown as Record<string, unknown>)[name];
  return p instanceof AudioParam ? p : undefined;
}

const MIN_TIME = 0.001;

/** Filter-box params that are switch positions (filter type, sources, on/off), so they jump rather than glide. */
/** Duo-synth params that are switch positions (waves, octaves, routes, hold and LFO), so they jump rather than glide. */
const DUO_SWITCHES = /Wave$|Sync$|Route$|Hold$|Lfo$|Off$/;
const DF_SWITCHES = /Type$|Src$|Inv$|Vca$|Gate$|Loop$|Exp$|Trig$|Link$|^mono$/;

/** Schedules ADSR on `offset`, starting from wherever it currently is (so retriggers don't click). */
function applyEnvelope(
  ctx: BaseAudioContext,
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
  ctx: BaseAudioContext,
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

function chokeTrigger(ctx: BaseAudioContext, offset: AudioParam, when?: number): void {
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
/**
 * A valve's transfer curve: asymmetric (it gives way sooner on one side, as a triode biased off centre does), so it
 * adds even harmonics, warm and round, rather than a clipper's odd ones. tanh(x + bias) - tanh(bias), scaled to +/-1
 * at the input's ends; small signals pass at a gain of about 1.
 */
function tubeCurve(): Float32Array<ArrayBuffer> {
  const size = 4097;
  const curve = new Float32Array(new ArrayBuffer(size * 4));
  const drive = 2.2, bias = 0.35;
  const slope = drive * (1 - Math.tanh(bias) ** 2); // the gain at zero, divided out so quiet signals stay at their level
  for (let i = 0; i < size; i++) {
    const x = (i / (size - 1)) * 2 - 1;
    curve[i] = (Math.tanh(drive * x + bias) - Math.tanh(bias)) / slope;
  }
  return curve;
}

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

/** Full-wave rectifier: |x|. */
function absCurve(): Float32Array<ArrayBuffer> {
  const size = 1025;
  const curve = new Float32Array(new ArrayBuffer(size * 4));
  for (let i = 0; i < size; i++) curve[i] = Math.abs((i / (size - 1)) * 2 - 1);
  return curve;
}

/** Quantises to 2^bits levels across -1..1 (16 bits and up is effectively transparent). */
function crushCurve(bits: number): Float32Array<ArrayBuffer> {
  const size = 8193;
  const curve = new Float32Array(new ArrayBuffer(size * 4));
  const half = Math.pow(2, Math.max(1, Math.min(16, bits))) / 2;
  for (let i = 0; i < size; i++) {
    const x = (i / (size - 1)) * 2 - 1;
    curve[i] = Math.round(x * half) / half;
  }
  return curve;
}

// Reverb tail lengths (seconds to -60 dB) for the convolver's size option.
const IR_SECONDS: Record<string, number> = { small: 0.9, medium: 2.4, large: 5 };

/** A stereo impulse response: decorrelated noise with an exponential decay that also darkens as it fades. */
function reverbImpulse(ctx: BaseAudioContext, seconds: number): AudioBuffer {
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

function noiseBuffer(ctx: BaseAudioContext): AudioBuffer {
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

function stepBuffer(ctx: BaseAudioContext): AudioBuffer {
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

const FOLLOWER_NAME = 'moa-follower';
export const FOLLOWER_SOURCE = `
class MoaFollower extends AudioWorkletProcessor {
  static get parameterDescriptors() {
    return [
      { name: 'attack', defaultValue: 0.003, minValue: 0.0001, maxValue: 2, automationRate: 'k-rate' },
      { name: 'release', defaultValue: 0.12, minValue: 0.001, maxValue: 5, automationRate: 'k-rate' },
    ];
  }
  constructor() { super(); this.env = 0; }
  process(inputs, outputs, params) {
    const out = outputs[0][0];
    const input = inputs[0];
    const ca = 1 - Math.exp(-1 / (Math.max(params.attack[0], 0.0001) * sampleRate));
    const cr = 1 - Math.exp(-1 / (Math.max(params.release[0], 0.001) * sampleRate));
    let env = this.env;
    for (let i = 0; i < out.length; i++) {
      let x = 0;
      for (let ch = 0; ch < input.length; ch++) x = Math.max(x, Math.abs(input[ch][i]));
      env += (x > env ? ca : cr) * (x - env);
      out[i] = env;
    }
    this.env = env;
    return true;
  }
}
registerProcessor('${FOLLOWER_NAME}', MoaFollower);
`;

/** Every processor, as the one script the audio worklet loads. Top-level names must not clash between them. */
export const WORKLET_SOURCE = [FOLLOWER_SOURCE, GRANULAR_SOURCE, PIPE_SOURCE, DF_SOURCE, DUO_SOURCE, M2600_SOURCE, FOLD_SOURCE, LADDER_SOURCE, STRING_SOURCE, SAMPLER_SOURCE, TONE_SOURCE].join('\n');

/** The processors are one worklet module, loaded from an in-memory script. */
function workletModuleUrl(): string {
  return URL.createObjectURL(new Blob([WORKLET_SOURCE], { type: 'text/javascript' }));
}

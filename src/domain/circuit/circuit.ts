// Internal signal graph. Audio and CV are the same thing here: a cable carries "voltage".
// Not exported to the UI layer — devices wrap a Circuit and expose controls instead.

// 'meter' taps a signal for level display (option `channel`: mono | left | right).
// 'random' is a sample-and-hold source: a new random value in -1..1 `rate` times per second.
// 'trigger' is a one-shot envelope for percussion: `trigger(id, velocity)` fires it, `choke(id)` cuts it short.
// Params: peak (output at full velocity), decay (s), velSens (0..1: how much velocity scales the peak), and for
// shape 'clap' the `spread` (s) between the stuttered bursts that precede the tail.
// 'convolver' is a reverb: a generated impulse response chosen by option `size` (small | medium | large).
// 'compressor' is a dynamics compressor (params threshold dB, knee dB, ratio, attack s, release s); used as a limiter.
// A 'gain' node with option `channels: 'mono'` sums a stereo input down to mono.
// A 'waveshaper' has option `curve`: 'pulse' (hard clip), 'soft' (tanh-style saturation), 'limit'
// (transparent below 0.9, then a soft knee into a hard ceiling just under full scale) or 'warm' (the
// channel gain stage: its input range is +/-3, linear to 0.6, then a smooth knee that settles at 1.0),
// 'abs' (a full-wave rectifier, for an envelope follower) or 'crush' (a bit-crusher: quantises to `bits`
// bits, a param that can change while running).
// 'follower' is a peak envelope follower: it takes the loudest channel of its input and outputs a mono CV that
// rises with `attack` (s) and falls with `release` (s). It runs as an audio worklet.
// 'delay' is a delay line: `delayTime` (s, also a CV target) up to `maxTime` (s, fixed when the node is built).
// 'granular' records its mono input into a ring buffer of `maxTime` seconds (fixed when built) and plays it back
// as a stereo cloud of short grains. Params: position (0..1, how far back from "now"), size (s), pitch (semitones),
// rate (grains/s), spread, cloud, detune (cents), shape, reverse (0..1 chance), feedback and freeze (>0.5 stops recording).
// With play > 0.5 it is silent until noteOn(): 8 voices, each transposed by (note - 60) semitones, with an ADSR
// (attack, decay, release in s; sustain a level) and velocity.
// 'pipe' is the MOA-PIPE physical-modelling engine: eight voices of steam into a tuned feedback pipe, no input,
// stereo out. It takes notes like a granular node (noteOn / noteOff / allNotesOff, and pedal for the sustain pedal);
// its params are listed in `pipeWorklet.ts`.
// 'spring' is the spring reverb: mono-summed input into two dispersive feedback springs, stereo out.
// Params: tension, drip, decay (s), tilt (-1..1) and dwell (input drive).
// 'df' is the MOA-DF2 filter box: two multimode filters, two envelopes, a sample-and-hold, a delay and a mixer in
// one worklet; stereo in, stereo out. Its params are listed in `dfWorklet.ts`. `gate(id, target, on)` drives its
// envelope gates: 'keys' (the held keys) or 'open1' / 'open2' (the OPEN buttons).
export type NodeKind = 'oscillator' | 'filter' | 'gain' | 'pan' | 'envelope' | 'trigger' | 'delay' | 'convolver' | 'compressor' | 'constant' | 'waveshaper' | 'noise' | 'random' | 'meter' | 'follower' | 'granular' | 'pipe' | 'spring' | 'df';

export interface CircuitNode {
  readonly id: string;
  readonly kind: NodeKind;
  readonly params: Record<string, number>;
  readonly options: Record<string, string>;
}

/** `port` is 'in' for signal input, or the name of a param to modulate (CV). */
export interface Cable {
  readonly from: string;
  readonly to: string;
  readonly port: string;
}

export type CircuitChange =
  | { type: 'param'; nodeId: string; name: string; value: number }
  | { type: 'option'; nodeId: string; name: string; value: string }
  | { type: 'trigger'; nodeId: string; velocity: number; when?: number }
  | { type: 'choke'; nodeId: string; when?: number }
  | { type: 'note'; nodeId: string; note: number; velocity: number }
  | { type: 'gate'; nodeId: string; target: 'keys' | 'open1' | 'open2'; on: boolean };

export class Circuit {
  readonly nodes = new Map<string, CircuitNode>();
  readonly cables: Cable[] = [];
  private listeners = new Set<(c: CircuitChange) => void>();

  add(
    id: string,
    kind: NodeKind,
    params: Record<string, number> = {},
    options: Record<string, string> = {},
  ): this {
    if (this.nodes.has(id)) throw new Error(`Duplicate node id: ${id}`);
    this.nodes.set(id, { id, kind, params: { ...params }, options: { ...options } });
    return this;
  }

  connect(from: string, to: string, port = 'in'): this {
    this.node(from);
    const target = this.node(to);
    if (port !== 'in' && !(port in target.params)) {
      throw new Error(`Node ${to} has no param ${port}`);
    }
    if (this.cables.some((c) => c.from === from && c.to === to && c.port === port)) {
      throw new Error(`Duplicate cable ${from} -> ${to}.${port}`);
    }
    this.cables.push({ from, to, port });
    return this;
  }

  setParam(nodeId: string, name: string, value: number): void {
    const node = this.node(nodeId);
    if (!(name in node.params)) throw new Error(`Node ${nodeId} has no param ${name}`);
    node.params[name] = value;
    this.emit({ type: 'param', nodeId, name, value });
  }

  setOption(nodeId: string, name: string, value: string): void {
    const node = this.node(nodeId);
    if (!(name in node.options)) throw new Error(`Node ${nodeId} has no option ${name}`);
    node.options[name] = value;
    this.emit({ type: 'option', nodeId, name, value });
  }

  /** Fires a one-shot envelope; `velocity` is 0..1. `when` is an audio-clock time in seconds (default: now). */
  trigger(nodeId: string, velocity = 1, when?: number): void {
    this.expectKind(nodeId, 'trigger');
    this.emit({ type: 'trigger', nodeId, velocity: Math.min(1, Math.max(0, velocity)), when });
  }

  /** Cuts a one-shot envelope short (a fast fade to silence), e.g. a closed hat choking an open hat. */
  choke(nodeId: string, when?: number): void {
    this.expectKind(nodeId, 'trigger');
    this.emit({ type: 'choke', nodeId, when });
  }

  /** Starts a note on a granular or pipe node (note 0-127, velocity 0..1). Velocity 0 is a note off. */
  noteOn(nodeId: string, note: number, velocity = 1): void {
    this.expectKind(nodeId, 'granular', 'pipe');
    this.emit({ type: 'note', nodeId, note, velocity: Math.min(1, Math.max(0, velocity)) });
  }

  noteOff(nodeId: string, note: number): void {
    this.expectKind(nodeId, 'granular', 'pipe');
    this.emit({ type: 'note', nodeId, note, velocity: 0 });
  }

  /** Releases every note on a granular or pipe node. */
  allNotesOff(nodeId: string): void {
    this.expectKind(nodeId, 'granular', 'pipe');
    this.emit({ type: 'note', nodeId, note: -1, velocity: 0 });
  }

  /** The sustain pedal on a pipe node: while down, released notes keep sounding. */
  pedal(nodeId: string, down: boolean): void {
    this.expectKind(nodeId, 'pipe');
    this.emit({ type: 'note', nodeId, note: -2, velocity: down ? 1 : 0 });
  }

  /** Opens or closes an envelope gate on a filter-box node. */
  gate(nodeId: string, target: 'keys' | 'open1' | 'open2', on: boolean): void {
    this.expectKind(nodeId, 'df');
    this.emit({ type: 'gate', nodeId, target, on });
  }

  onChange(fn: (c: CircuitChange) => void): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  node(id: string): CircuitNode {
    const n = this.nodes.get(id);
    if (!n) throw new Error(`Unknown node: ${id}`);
    return n;
  }

  private expectKind(nodeId: string, ...kinds: NodeKind[]): void {
    if (!kinds.includes(this.node(nodeId).kind)) throw new Error(`Node ${nodeId} is not a ${kinds.join(' or ')}`);
  }

  private emit(c: CircuitChange): void {
    for (const l of this.listeners) l(c);
  }
}

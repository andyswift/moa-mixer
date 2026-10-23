import type { MidiEvent } from '../midi/events';
import {
  FINGER, MATERIALS, PICK, WINDINGS, WOUND, contactDamping, fretLength, idealFrequency, inharmonicity, linearDensity, midiToHz,
  noteOf, pluckAmplitudes, tensionFor, voiceConfig, type Coil, type StringSpec,
} from './bassPhysics';
import { ChoiceControl, NumberControl } from './controls';
import { Device } from './device';
import type { Playable } from './playable';

const MOD_WHEEL_CC = 1;
const SUSTAIN_CC = 64;
const BEND_SEMITONES = 2;
const SAMPLE_RATE = 48000; // for working out how many modes fit
/** A note on a string already holding one costs this many frets of hand movement (so double-stops find another string). */
const BUSY_STRING = 6;

/** A speaker cabinet, modelled by what makes it sound as it does: the box's low resonance and roll-off, the cones' peak and top end. */
export interface Cabinet {
  label: string;
  hp: number;
  hpQ: number;
  bumpHz: number;
  bumpDb: number;
  coneHz: number;
  coneDb: number;
  coneQ: number;
  top: number;
}

/** What makes one stringed instrument differ from another: its strings, its neck, its amp and its cabinets. */
export interface StringedDesign {
  /** The strings, low to high: a name (unique, it names the tension control) and a gauge with its standard note. */
  strings: readonly { name: string; gauge: StringSpec & { note: number } }[];
  frets: number;
  scales: Readonly<Record<string, number>>;
  scale: string;
  /** The range of the tension pegs, N. */
  tension: readonly [number, number];
  /** How far a pluck pulls the string, m, at strength 0 and 1 (exponential between). */
  pluckHeight: readonly [number, number];
  /** Where a palm mute rests, m from the bridge. */
  palmAt: number;
  /** How it is usually played: with the fingers or a pick, and how far from the bridge, m. */
  pluck: { style: 'finger' | 'pick'; position: number };
  /** Whether the bend can lower the pitch too (a vibrato arm) or only raise it (a string pulled sideways). */
  bendDown: boolean;
  /** The amp's tone stack: the bass shelf, the mid peak and the treble shelf, Hz. */
  toneStack: { bass: number; mid: number; treble: number };
  /** The gain into the valve and the make-up after it, for the Gain knob at 0..1. */
  drive: (v: number) => { pre: number; post: number };
  gain: number;
  cabinets: Readonly<Record<string, Cabinet>>;
  cabinet: string;
  /** DI / cabinet blend, 0 (all DI) to 1 (all cabinet). */
  blend: number;
  /** The output level. */
  level: number;
}

/** One string: its node in the circuit, where it is fretted, and the length vibrating now. */
export interface StringVoice {
  name: string;
  node: string;
  fret: number;
  length: number;
  /** The note it is holding for a key, if any. */
  note?: number;
}

/** A pickup as the panel draws it: where it sits (from the bridge, m), how many coils it has, and whether it is on. */
export interface PickupView {
  position: number;
  coils: number;
  on: boolean;
}

/**
 * A guitar or bass: physically modelled strings (`bassPhysics.ts`, `stringWorklet.ts`) into an amp (gain into a valve
 * curve, a three-band tone stack) and a miked speaker cabinet, blended with the DI as a studio would record it. A note
 * goes to the string a player would use: the one that needs the least hand movement from where the hand is, avoiding
 * a string that is already holding a note; letting go of a key mutes its string.
 *
 * A subclass adds its pickups' controls after `super()` (they set the string nodes' `tone` and `pickup()`), then calls
 * `ready()`, which works the strings out for the first time.
 */
export abstract class StringedInstrument extends Device implements Playable {
  readonly name: string;
  readonly bendRange = BEND_SEMITONES;
  readonly voices: StringVoice[];
  readonly frets: number;
  /** The fretting hand: the fret it last went to (open strings do not move it). */
  hand = 3;
  private held: number[] = [];
  private bend = 0;
  private modWheelValue = 0;
  private pedal = false;
  private latched = new Set<number>();
  private building = true;
  private readonly noteListeners = new Set<() => void>();
  private readonly performanceListeners = new Set<() => void>();
  private readonly physicsListeners = new Set<() => void>();
  private readonly pluckListeners = new Set<(string: number, position: number) => void>();

  constructor(name: string, protected readonly design: StringedDesign) {
    super();
    this.name = name;
    this.frets = design.frets;
    const c = this.circuit;
    this.voices = design.strings.map((s, i) => ({ name: s.name, node: `s${i + 1}`, fret: 0, length: design.scales[design.scale]! }));
    c.add('strings', 'gain', { gain: 1 });
    for (const v of this.voices) c.add(v.node, 'string', { level: 0.5, tone: 3500 }, { config: '{}' }).connect(v.node, 'strings');
    // the amp: gain into a valve curve, make-up, then bass, mid and treble
    const stack = design.toneStack;
    c.add('ampIn', 'gain', { gain: 1 })
      .add('ampDrive', 'waveshaper', {}, { curve: 'tube' })
      .add('ampPost', 'gain', { gain: 1 })
      .add('ampBass', 'filter', { frequency: stack.bass, Q: 0.707, gain: 0 }, { type: 'lowshelf' })
      .add('ampMid', 'filter', { frequency: stack.mid, Q: 0.8, gain: 0 }, { type: 'peaking' })
      .add('ampTreble', 'filter', { frequency: stack.treble, Q: 0.707, gain: 0 }, { type: 'highshelf' })
      // the cabinet: the box's resonance and roll-off below, the cones' peak, the top end, and where the mic is
      .add('cabHp', 'filter', { frequency: 55, Q: 1.1 }, { type: 'highpass' })
      .add('cabBump', 'filter', { frequency: 90, Q: 1.2, gain: 2 }, { type: 'peaking' })
      .add('cabCone', 'filter', { frequency: 2000, Q: 1.5, gain: 4 }, { type: 'peaking' })
      .add('cabLp1', 'filter', { frequency: 5000, Q: 0.707 }, { type: 'lowpass' })
      .add('cabLp2', 'filter', { frequency: 5000, Q: 0.707 }, { type: 'lowpass' })
      .add('cabMic', 'filter', { frequency: 3000, Q: 0.707, gain: 0 }, { type: 'highshelf' })
      .add('cabOut', 'gain', { gain: 0.8 })
      // the DI: the pickups straight to the desk
      .add('diOut', 'gain', { gain: 0.6 })
      .add('master', 'gain', { gain: 0.8 })
      .connect('strings', 'ampIn')
      .connect('ampIn', 'ampDrive')
      .connect('ampDrive', 'ampPost')
      .connect('ampPost', 'ampBass')
      .connect('ampBass', 'ampMid')
      .connect('ampMid', 'ampTreble')
      .connect('ampTreble', 'cabHp')
      .connect('cabHp', 'cabBump')
      .connect('cabBump', 'cabCone')
      .connect('cabCone', 'cabLp1')
      .connect('cabLp1', 'cabLp2')
      .connect('cabLp2', 'cabMic')
      .connect('cabMic', 'cabOut')
      .connect('cabOut', 'master')
      .connect('strings', 'diOut')
      .connect('diOut', 'master');
    this.outputList.push({ name: 'out', nodeId: 'master' });

    const re = () => this.reconfigureAll();
    this.choice('string.wrap', 'Wrap', ['nickel', 'stainless', 'steel'], 'nickel', re);
    this.choice('string.winding', 'Winding', WOUND, 'round', re);
    this.choice('string.scale', 'Scale', Object.keys(design.scales), design.scale, re);
    design.strings.forEach((s, i) => {
      const standard = tensionFor(this.specFor(i, 'nickel', 'round'), design.scales[design.scale]!, midiToHz(s.gauge.note));
      this.num(`${s.name}.tension`, `${s.name} tension`, design.tension[0], design.tension[1], Math.round(standard * 10) / 10, 'N', () => this.reconfigure(i));
    });
    this.num('palm', 'Palm mute', 0, 1, 0, '', re);
    this.choice('pluck.style', 'Pluck with', ['finger', 'pick'], design.pluck.style, () => undefined);
    this.num('pluck.position', 'Pluck at', 0.02, 0.4, design.pluck.position, 'm', () => undefined);
    this.num('pluck.strength', 'Strength', 0, 1, 0.5, '', () => undefined);
    // the amp and the cabinet
    this.num('amp.gain', 'Gain', 0, 1, design.gain, '', (v) => {
      const { pre, post } = design.drive(v);
      c.setParam('ampIn', 'gain', pre);
      c.setParam('ampPost', 'gain', post);
    });
    this.num('amp.bass', 'Bass', -12, 12, 0, 'dB', (v) => c.setParam('ampBass', 'gain', v));
    this.num('amp.mid', 'Mid', -12, 12, 0, 'dB', (v) => c.setParam('ampMid', 'gain', v));
    this.num('amp.treble', 'Treble', -12, 12, 0, 'dB', (v) => c.setParam('ampTreble', 'gain', v));
    this.choice('cab.type', 'Cabinet', Object.keys(design.cabinets), design.cabinet, (v) => this.applyCabinet(v));
    this.choice('cab.mic', 'Mic', ['on-axis', 'off-axis'], 'on-axis', (v) => c.setParam('cabMic', 'gain', v === 'off-axis' ? -8 : 0));
    this.num('cab.blend', 'DI / Cab', 0, 1, design.blend, '', (v) => {
      // equal power: the DI at 0, the miked cabinet at 1
      c.setParam('diOut', 'gain', Math.cos((v * Math.PI) / 2));
      c.setParam('cabOut', 'gain', Math.sin((v * Math.PI) / 2));
    });
    this.num('level', 'Level', 0, 1.5, design.level, '', (v) => c.setParam('master', 'gain', v));
  }

  protected choice(id: string, label: string, options: readonly string[], init: string, apply: (v: string) => void): void {
    this.controlList.push(new ChoiceControl(id, label, options, init, apply));
  }

  protected num(id: string, label: string, min: number, max: number, init: number, unit: string, apply: (v: number) => void, curve?: 'linear' | 'log'): void {
    this.controlList.push(new NumberControl(id, label, min, max, init, unit, apply, curve));
  }

  /** Called by the subclass once its controls are in: works every string out and sends it. */
  protected ready(): void {
    this.building = false;
    this.reconfigureAll();
  }

  /** The coils that are switched on (or one pickup's distance from the bridge, m), for string i. */
  protected abstract pickup(i: number): number | readonly Coil[];

  /** The pickups, for drawing. */
  abstract pickups(): readonly PickupView[];

  /** How long after a key string i's pluck waits, s (a strum). */
  protected pluckDelay(_i: number): number {
    return 0;
  }

  /** Sets the pickup's resonance on every string. */
  protected setTone(hz: number): void {
    for (const s of this.voices) this.circuit.setParam(s.node, 'tone', hz);
  }

  private applyCabinet(id: string): void {
    const cab = this.design.cabinets[id]!;
    const c = this.circuit;
    c.setParam('cabHp', 'frequency', cab.hp);
    c.setParam('cabHp', 'Q', cab.hpQ);
    c.setParam('cabBump', 'frequency', cab.bumpHz);
    c.setParam('cabBump', 'gain', cab.bumpDb);
    c.setParam('cabCone', 'frequency', cab.coneHz);
    c.setParam('cabCone', 'gain', cab.coneDb);
    c.setParam('cabCone', 'Q', cab.coneQ);
    c.setParam('cabLp1', 'frequency', cab.top);
    c.setParam('cabLp2', 'frequency', cab.top);
  }

  // ---- The physics, read from the controls ----

  protected value<T extends number | string>(id: string): T {
    return this.control(id).value as T;
  }

  /** String i's gauge with the set's wrap and winding (a plain string stays plain). */
  private specFor(i: number, wrap = this.value<string>('string.wrap'), winding = this.value<string>('string.winding')): StringSpec {
    const g = this.design.strings[i]!.gauge;
    if (g.winding === 'plain') return { outer: g.outer, core: g.core, wrap: g.wrap, winding: 'plain' };
    return { outer: g.outer, core: g.core, wrap: wrap as StringSpec['wrap'], winding: winding as StringSpec['winding'], packing: g.packing };
  }

  spec(i: number): StringSpec {
    return this.specFor(i);
  }

  get scale(): number {
    return this.design.scales[this.value<string>('string.scale')]!;
  }

  /** Where a palm mute rests, m from the bridge. */
  get palmAt(): number {
    return this.design.palmAt;
  }

  /** The peg's tension on string i, changed by the bend. */
  tension(i: number): number {
    return this.value<number>(`${this.voices[i]!.name}.tension`) * Math.pow(2, (2 * this.bend * BEND_SEMITONES) / 12);
  }

  /** The open string's note. */
  openNote(i: number): number {
    return noteOf(idealFrequency(this.spec(i), this.scale, this.value<number>(`${this.voices[i]!.name}.tension`))).note;
  }

  /** The notes the strings are tuned to as standard, low to high. */
  get standardNotes(): number[] {
    return this.design.strings.map((s) => s.gauge.note);
  }

  /** What string i's numbers are now, for the panel. */
  readout(i: number) {
    const spec = this.spec(i), T = this.tension(i), v = this.voices[i]!;
    const L = fretLength(this.scale, v.fret);
    const open = idealFrequency(spec, this.scale, this.value<number>(`${v.name}.tension`));
    const now = idealFrequency(spec, L, T) * Math.sqrt(1 + inharmonicity(spec, L, T));
    return {
      tension: T, mu: linearDensity(spec), speed: Math.sqrt(T / linearDensity(spec)), B: inharmonicity(spec, L, T),
      open: { hz: open, ...noteOf(open) }, now: { hz: now, ...noteOf(now) }, length: L, fret: v.fret,
      wrap: MATERIALS[spec.wrap].name, winding: WINDINGS[spec.winding].name, gauge: spec.outer,
    };
  }

  /** Pulls every string to the tension that tunes it, open, to its standard note. */
  tuneToStandard(): void {
    this.design.strings.forEach((s, i) => {
      (this.control(`${s.name}.tension`) as NumberControl).set(Math.round(tensionFor(this.spec(i), this.scale, midiToHz(s.gauge.note)) * 10) / 10);
    });
  }

  protected reconfigureAll(): void {
    for (let i = 0; i < this.voices.length; i++) this.reconfigure(i);
  }

  /** Works string i's modes out again and sends them (also kept on its node, for an engine built later). */
  private reconfigure(i: number): void {
    if (this.building) return;
    const v = this.voices[i]!;
    const cfg = voiceConfig({
      spec: this.spec(i), scale: this.scale, tension: this.tension(i), fret: v.fret, pickup: this.pickup(i),
      palm: { position: this.design.palmAt, amount: this.value<number>('palm') }, sampleRate: SAMPLE_RATE,
    });
    v.length = cfg.length;
    const message = { type: 'configure', ...cfg };
    this.circuit.setOption(v.node, 'config', JSON.stringify(message));
    this.circuit.send(v.node, message);
    for (const l of this.physicsListeners) l();
  }

  /** String i's present mode frequencies (for drawing it in slow motion). */
  modeHz(i: number): number[] {
    return (JSON.parse(this.circuit.node(this.voices[i]!.node).options.config!) as { hz?: number[] }).hz ?? [];
  }

  onPhysicsChange(fn: () => void): () => void {
    this.physicsListeners.add(fn);
    return () => this.physicsListeners.delete(fn);
  }

  // ---- Playing ----

  /** Frets string i (0 is open). */
  setFret(i: number, fret: number): void {
    const v = this.voices[i]!;
    const f = Math.max(0, Math.min(this.frets, Math.round(fret)));
    if (f === v.fret) return;
    v.fret = f;
    if (f > 0) this.hand = f;
    this.reconfigure(i);
  }

  /**
   * Plucks string i at `position` (m from the bridge; default the Pluck at control) with `strength` 0..1, after `delay`
   * seconds.
   */
  pluck(i: number, position = this.value<number>('pluck.position'), strength = this.value<number>('pluck.strength'), delay = 0): void {
    const v = this.voices[i]!;
    const at = Math.min(Math.max(position, 0.01), v.length - 0.01);
    const hz = this.modeHz(i);
    const style = this.value<string>('pluck.style') === 'pick' ? PICK : FINGER;
    const [low, high] = this.design.pluckHeight;
    const height = low * Math.pow(high / low, strength);
    const amps = pluckAmplitudes(v.length, hz, { position: at, height, ...style });
    const grab = contactDamping(v.length, hz.length, at, 0.9).map((d) => 1 - d); // the hand grabs it first
    this.circuit.send(v.node, { type: 'mute', on: false });
    this.circuit.send(v.node, delay > 0 ? { type: 'pluck', amps, grab, delay } : { type: 'pluck', amps, grab });
    for (const l of this.pluckListeners) l(i, at);
  }

  onPluck(fn: (string: number, position: number) => void): () => void {
    this.pluckListeners.add(fn);
    return () => this.pluckListeners.delete(fn);
  }

  /** Mutes string i, as a lifting finger or a resting hand does. */
  release(i: number): void {
    this.circuit.send(this.voices[i]!.node, { type: 'mute', on: true });
  }

  /** The string a player would play a note on: the least hand movement, avoiding busy strings; undefined if none can. */
  chooseString(note: number): number | undefined {
    let best: number | undefined, bestCost = Infinity;
    this.voices.forEach((v, i) => {
      const fret = note - this.openNote(i);
      if (fret < 0 || fret > this.frets) return;
      const move = fret === 0 ? 0.5 : Math.abs(fret - this.hand); // an open string needs no hand at all
      const cost = move + (v.note !== undefined && v.note !== note ? BUSY_STRING : 0);
      if (cost < bestCost) { bestCost = cost; best = i; }
    });
    return best;
  }

  keyDown(note: number, velocity = 96): void {
    const i = this.chooseString(note);
    if (i === undefined) return;
    const v = this.voices[i]!;
    if (v.note !== undefined && v.note !== note) this.held = this.held.filter((n) => n !== v.note); // that string is taken over
    v.note = note;
    this.held = this.held.filter((n) => n !== note);
    this.held.push(note);
    this.latched.delete(note);
    this.setFret(i, note - this.openNote(i));
    this.pluck(i, undefined, Math.min(1, Math.max(0.05, (this.value<number>('pluck.strength') * velocity) / 96)), this.pluckDelay(i));
    this.notifyNotes();
  }

  keyUp(note: number): void {
    if (!this.held.includes(note)) return;
    if (this.pedal) {
      this.latched.add(note);
      return;
    }
    this.held = this.held.filter((n) => n !== note);
    const i = this.voices.findIndex((v) => v.note === note);
    if (i >= 0) {
      this.voices[i]!.note = undefined;
      this.release(i);
    }
    this.notifyNotes();
  }

  get heldNotes(): readonly number[] {
    return this.held;
  }

  onNoteChange(fn: () => void): () => void {
    this.noteListeners.add(fn);
    return () => this.noteListeners.delete(fn);
  }

  get pitchBend(): number {
    return this.bend;
  }

  /** Bends the strings by changing their tension: up to a tone up, and down too if the design has a vibrato arm. */
  setPitchBend(value: number): void {
    this.bend = Math.min(1, Math.max(this.design.bendDown ? -1 : 0, value));
    this.reconfigureAll();
    this.notifyPerformance();
  }

  get modWheel(): number {
    return this.modWheelValue;
  }

  /** The mod wheel is the palm resting on the strings. */
  setModWheel(value: number): void {
    this.modWheelValue = Math.min(1, Math.max(0, value));
    (this.control('palm') as NumberControl).set(this.modWheelValue);
    this.notifyPerformance();
  }

  onPerformanceChange(fn: () => void): () => void {
    this.performanceListeners.add(fn);
    return () => this.performanceListeners.delete(fn);
  }

  /** MIDI (any channel): notes fret and pluck, the bend wheel bends, the mod wheel palm-mutes, the sustain pedal lets notes ring. */
  handleMidi(event: MidiEvent): void {
    switch (event.type) {
      case 'noteOn':
        this.keyDown(event.note, event.velocity);
        break;
      case 'noteOff':
        this.keyUp(event.note);
        break;
      case 'pitchBend':
        this.setPitchBend(event.value);
        break;
      case 'cc':
        if (event.controller === MOD_WHEEL_CC) this.setModWheel(event.value / 127);
        else if (event.controller === SUSTAIN_CC) {
          this.pedal = event.value >= 64;
          if (!this.pedal) for (const n of [...this.latched]) { this.latched.delete(n); this.keyUp(n); }
        }
        break;
    }
  }

  private notifyNotes(): void {
    for (const l of this.noteListeners) l();
  }
  private notifyPerformance(): void {
    for (const l of this.performanceListeners) l();
  }
}

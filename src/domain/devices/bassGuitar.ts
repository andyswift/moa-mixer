import type { MidiEvent } from '../midi/events';
import {
  FINGER, GAUGES, MATERIALS, PICK, SCALES, WINDINGS, contactDamping, fretLength, idealFrequency, inharmonicity, linearDensity,
  midiToHz, noteOf, pluckAmplitudes, tensionFor, voiceConfig, type StringSpec,
} from './bassPhysics';
import { ChoiceControl, NumberControl } from './controls';
import { Device } from './device';
import type { Playable } from './playable';

const MOD_WHEEL_CC = 1;
const SUSTAIN_CC = 64;
export const BASS_FRETS = 24;
/** The strings, low to high, and their gauges. */
export const BASS_STRINGS = ['E', 'A', 'D', 'G'] as const;
export type StringName = (typeof BASS_STRINGS)[number];
const BEND_SEMITONES = 2;
const PALM_POSITION = 0.03; // m from the bridge
const SAMPLE_RATE = 48000; // for working out how many modes fit
/** A note on a string already holding one costs this many frets of hand movement (so double-stops find another string). */
const BUSY_STRING = 6;

/** Cabinets, modelled by what makes them sound as they do: the box's low resonance and roll-off, the cones' peaks and top end. */
export const CABINETS = {
  '4x10': { label: '4×10', hp: 55, hpQ: 1.1, bumpHz: 90, bumpDb: 2, coneHz: 2000, coneDb: 4, coneQ: 1.5, top: 5000 },
  '1x15': { label: '1×15', hp: 42, hpQ: 1.3, bumpHz: 70, bumpDb: 3, coneHz: 1200, coneDb: 3, coneQ: 1.2, top: 2600 },
  '8x10': { label: '8×10', hp: 38, hpQ: 1.0, bumpHz: 60, bumpDb: 3.5, coneHz: 1800, coneDb: 3.5, coneQ: 1.4, top: 4500 },
} as const;
export type CabinetId = keyof typeof CABINETS;

/** One string: its gauge, its node in the circuit, where it is fretted, and the length vibrating now. */
interface Voice {
  name: StringName;
  node: string;
  fret: number;
  length: number;
  /** The note it is holding for a key, if any. */
  note?: number;
}

/**
 * MOA-BASS: a four-string bass guitar, each string physically modelled (`bassPhysics.ts`, `stringWorklet.ts`), into an
 * amp (gain into a valve curve, a three-band tone stack) and a miked speaker cabinet, blended with the DI as a studio
 * would record it. A note goes to the string a bassist would use: the one that needs the least hand movement from
 * where the hand is, avoiding a string that is already holding a note; letting go of a key mutes its string.
 */
export class BassGuitar extends Device implements Playable {
  readonly name: string;
  readonly bendRange = BEND_SEMITONES;
  readonly voices: Voice[];
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

  constructor(name = 'MOA-BASS') {
    super();
    this.name = name;
    const c = this.circuit;
    this.voices = BASS_STRINGS.map((n, i) => ({ name: n, node: `s${i + 1}`, fret: 0, length: SCALES.long }));
    c.add('strings', 'gain', { gain: 1 });
    for (const v of this.voices) c.add(v.node, 'string', { level: 0.5, tone: 3500 }, { config: '{}' }).connect(v.node, 'strings');
    // the amp: gain into a valve curve, make-up, then bass, mid and treble
    c.add('ampIn', 'gain', { gain: 1 })
      .add('ampDrive', 'waveshaper', {}, { curve: 'tube' })
      .add('ampPost', 'gain', { gain: 1 })
      .add('ampBass', 'filter', { frequency: 100, Q: 0.707, gain: 0 }, { type: 'lowshelf' })
      .add('ampMid', 'filter', { frequency: 600, Q: 0.8, gain: 0 }, { type: 'peaking' })
      .add('ampTreble', 'filter', { frequency: 2500, Q: 0.707, gain: 0 }, { type: 'highshelf' })
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
    const choice = (id: string, label: string, options: readonly string[], init: string, apply: (v: string) => void = re) =>
      this.controlList.push(new ChoiceControl(id, label, options, init, apply));
    const num = (id: string, label: string, min: number, max: number, init: number, unit: string, apply: (v: number) => void = re, curve?: 'linear' | 'log') =>
      this.controlList.push(new NumberControl(id, label, min, max, init, unit, apply, curve));

    choice('string.wrap', 'Wrap', ['nickel', 'stainless', 'steel'], 'nickel');
    choice('string.winding', 'Winding', Object.keys(WINDINGS), 'round');
    choice('string.scale', 'Scale', Object.keys(SCALES), 'long');
    BASS_STRINGS.forEach((n, i) => {
      const standard = tensionFor(this.specFor(n, 'nickel', 'round'), SCALES.long, midiToHz(GAUGES[n].note));
      num(`${n}.tension`, `${n} tension`, 40, 400, Math.round(standard * 10) / 10, 'N', () => this.reconfigure(i));
    });
    num('pickup.position', 'Pickup', 0.03, 0.3, 0.15, 'm');
    num('palm', 'Palm mute', 0, 1, 0, '');
    choice('pluck.style', 'Pluck with', ['finger', 'pick'], 'finger', () => undefined);
    num('pluck.position', 'Pluck at', 0.02, 0.4, 0.12, 'm', () => undefined);
    num('pluck.strength', 'Strength', 0, 1, 0.5, '', () => undefined);
    num('tone', 'Tone', 300, 12000, 3500, 'Hz', (v) => { for (const s of this.voices) c.setParam(s.node, 'tone', v); }, 'log');
    // the amp and the cabinet
    num('amp.gain', 'Gain', 0, 1, 0.3, '', (v) => {
      c.setParam('ampIn', 'gain', 0.4 + v * 4);
      c.setParam('ampPost', 'gain', 1 / (0.4 + v * 2.2)); // make-up: more drive, about the same level
    });
    num('amp.bass', 'Bass', -12, 12, 0, 'dB', (v) => c.setParam('ampBass', 'gain', v));
    num('amp.mid', 'Mid', -12, 12, 0, 'dB', (v) => c.setParam('ampMid', 'gain', v));
    num('amp.treble', 'Treble', -12, 12, 0, 'dB', (v) => c.setParam('ampTreble', 'gain', v));
    choice('cab.type', 'Cabinet', Object.keys(CABINETS), '4x10', (v) => this.applyCabinet(v as CabinetId));
    choice('cab.mic', 'Mic', ['on-axis', 'off-axis'], 'on-axis', (v) => c.setParam('cabMic', 'gain', v === 'off-axis' ? -8 : 0));
    num('cab.blend', 'DI / Cab', 0, 1, 0.6, '', (v) => {
      // equal power: the DI at 0, the miked cabinet at 1
      c.setParam('diOut', 'gain', Math.cos((v * Math.PI) / 2));
      c.setParam('cabOut', 'gain', Math.sin((v * Math.PI) / 2));
    });
    num('level', 'Level', 0, 1.5, 0.8, '', (v) => c.setParam('master', 'gain', v));
    this.building = false;
    this.reconfigureAll();
  }

  private applyCabinet(id: CabinetId): void {
    const cab = CABINETS[id];
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

  private value<T extends number | string>(id: string): T {
    return this.control(id).value as T;
  }

  private specFor(name: StringName, wrap = this.value<string>('string.wrap'), winding = this.value<string>('string.winding')): StringSpec {
    const g = GAUGES[name];
    return { outer: g.outer, core: g.core, wrap: wrap as StringSpec['wrap'], winding: winding as StringSpec['winding'] };
  }

  spec(i: number): StringSpec {
    return this.specFor(this.voices[i]!.name);
  }

  get scale(): number {
    return SCALES[this.value<string>('string.scale') as keyof typeof SCALES];
  }

  /** The peg's tension on string i, raised by the bend. */
  tension(i: number): number {
    return this.value<number>(`${this.voices[i]!.name}.tension`) * Math.pow(2, (2 * this.bend * BEND_SEMITONES) / 12);
  }

  /** The open string's note. */
  openNote(i: number): number {
    return noteOf(idealFrequency(this.spec(i), this.scale, this.value<number>(`${this.voices[i]!.name}.tension`))).note;
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

  /** Pulls every string to the tension that tunes it, open, to its standard note (E1 A1 D2 G2). */
  tuneToStandard(): void {
    BASS_STRINGS.forEach((n, i) => {
      (this.control(`${n}.tension`) as NumberControl).set(Math.round(tensionFor(this.spec(i), this.scale, midiToHz(GAUGES[n].note)) * 10) / 10);
    });
  }

  private reconfigureAll(): void {
    for (let i = 0; i < this.voices.length; i++) this.reconfigure(i);
  }

  /** Works string i's modes out again and sends them (also kept on its node, for an engine built later). */
  private reconfigure(i: number): void {
    if (this.building) return;
    const v = this.voices[i]!;
    const cfg = voiceConfig({
      spec: this.spec(i), scale: this.scale, tension: this.tension(i), fret: v.fret, pickup: this.value<number>('pickup.position'),
      palm: { position: PALM_POSITION, amount: this.value<number>('palm') }, sampleRate: SAMPLE_RATE,
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
    const f = Math.max(0, Math.min(BASS_FRETS, Math.round(fret)));
    if (f === v.fret) return;
    v.fret = f;
    if (f > 0) this.hand = f;
    this.reconfigure(i);
  }

  /** Plucks string i at `position` (m from the bridge; default the Pluck at control) with `strength` 0..1. */
  pluck(i: number, position = this.value<number>('pluck.position'), strength = this.value<number>('pluck.strength')): void {
    const v = this.voices[i]!;
    const at = Math.min(Math.max(position, 0.01), v.length - 0.01);
    const hz = this.modeHz(i);
    const style = this.value<string>('pluck.style') === 'pick' ? PICK : FINGER;
    const height = 0.0003 * Math.pow(20, strength); // 0.3 mm to 6 mm
    const amps = pluckAmplitudes(v.length, hz, { position: at, height, ...style });
    const grab = contactDamping(v.length, hz.length, at, 0.9).map((d) => 1 - d); // the hand grabs it first
    this.circuit.send(v.node, { type: 'mute', on: false });
    this.circuit.send(v.node, { type: 'pluck', amps, grab });
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

  /** The string a bassist would play a note on: the least hand movement, avoiding busy strings; undefined if none can. */
  chooseString(note: number): number | undefined {
    let best: number | undefined, bestCost = Infinity;
    this.voices.forEach((v, i) => {
      const fret = note - this.openNote(i);
      if (fret < 0 || fret > BASS_FRETS) return;
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
    this.pluck(i, undefined, Math.min(1, Math.max(0.05, (this.value<number>('pluck.strength') * velocity) / 96)));
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

  /** Bends the strings: pulling them sideways raises their tension (up to a tone; down does nothing). */
  setPitchBend(value: number): void {
    this.bend = Math.min(1, Math.max(0, value));
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

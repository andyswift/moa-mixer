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
const BEND_SEMITONES = 2; // the wheel bends the string up to a tone, by pulling it harder
const PALM_POSITION = 0.03; // m from the bridge
const SAMPLE_RATE = 48000; // for working out how many modes fit; the engine's real rate only trims the top one or two

/**
 * MOA-BASS, one string: a physically modelled bass guitar string (see `bassPhysics.ts`) with a fretboard, a pluck
 * (finger or pick, where and how hard), a palm mute, and a magnetic pickup. Its sound is a `string` worklet node
 * (`stringWorklet.ts`). Notes are played by fretting: a key sets the fret (the note minus the open string's pitch)
 * and plucks; letting go mutes it as a bassist's lifting finger does. The pitch wheel bends the string, which in the
 * physics means pulling it to a higher tension.
 */
export class BassString extends Device implements Playable {
  readonly name: string;
  readonly bendRange = BEND_SEMITONES;
  private held: number[] = [];
  private bend = 0;
  private modWheelValue = 0;
  private pedal = false;
  private latched = new Set<number>();
  private building = true;
  private lastLength = SCALES.long;
  private readonly noteListeners = new Set<() => void>();
  private readonly performanceListeners = new Set<() => void>();
  private readonly physicsListeners = new Set<() => void>();
  private readonly pluckListeners = new Set<(position: number) => void>();

  constructor(name = 'MOA-BASS') {
    super();
    this.name = name;
    this.circuit.add('string', 'string', { level: 0.5, tone: 3500 }, { config: '{}' });
    this.outputList.push({ name: 'out', nodeId: 'string' });

    const re = () => this.reconfigure();
    const choice = (id: string, label: string, options: readonly string[], init: string) =>
      this.controlList.push(new ChoiceControl(id, label, options, init, re));
    const num = (id: string, label: string, min: number, max: number, init: number, unit: string, apply: (v: number) => void = re, curve?: 'linear' | 'log') =>
      this.controlList.push(new NumberControl(id, label, min, max, init, unit, apply, curve));

    choice('string.gauge', 'Gauge', Object.keys(GAUGES), 'E');
    choice('string.wrap', 'Wrap', ['nickel', 'stainless', 'steel'], 'nickel');
    choice('string.winding', 'Winding', Object.keys(WINDINGS), 'round');
    choice('string.scale', 'Scale', Object.keys(SCALES), 'long');
    num('string.tension', 'Tension', 40, 400, Math.round(tensionFor(GAUGES.E, SCALES.long, midiToHz(28)) * 10) / 10, 'N');
    num('fret', 'Fret', 0, BASS_FRETS, 0, '');
    num('pickup.position', 'Pickup', 0.03, 0.3, 0.15, 'm');
    num('palm', 'Palm mute', 0, 1, 0, '');
    choice('pluck.style', 'Pluck with', ['finger', 'pick'], 'finger', );
    num('pluck.position', 'Pluck at', 0.02, 0.4, 0.12, 'm', () => undefined);
    num('pluck.strength', 'Strength', 0, 1, 0.5, '', () => undefined);
    num('tone', 'Tone', 300, 12000, 3500, 'Hz', (v) => this.circuit.setParam('string', 'tone', v), 'log');
    num('level', 'Level', 0, 1.5, 0.5, '', (v) => this.circuit.setParam('string', 'level', v));
    this.building = false;
    this.reconfigure();
  }

  // ---- The physics, read from the controls ----

  private value<T extends number | string>(id: string): T {
    return this.control(id).value as T;
  }

  get spec(): StringSpec {
    const g = GAUGES[this.value<string>('string.gauge') as keyof typeof GAUGES];
    return { outer: g.outer, core: g.core, wrap: this.value('string.wrap'), winding: this.value('string.winding') };
  }

  get scale(): number {
    return SCALES[this.value<string>('string.scale') as keyof typeof SCALES];
  }

  /** The tension the string is pulled to now: the peg's setting, raised by the bend. */
  get tension(): number {
    return this.value<number>('string.tension') * Math.pow(2, (2 * this.bend * BEND_SEMITONES) / 12);
  }

  get fret(): number {
    return Math.round(this.value<number>('fret'));
  }

  /** The length that vibrates now: from the fret to the bridge. */
  get vibratingLength(): number {
    return fretLength(this.scale, this.fret);
  }

  /** What the string's numbers are now, for the panel. */
  get readout() {
    const spec = this.spec, T = this.tension, L = this.vibratingLength;
    const open = idealFrequency(spec, this.scale, this.value<number>('string.tension'));
    const now = idealFrequency(spec, L, T) * Math.sqrt(1 + inharmonicity(spec, L, T));
    return {
      tension: T,
      mu: linearDensity(spec),
      speed: Math.sqrt(T / linearDensity(spec)),
      B: inharmonicity(spec, L, T),
      open: { hz: open, ...noteOf(open) },
      now: { hz: now, ...noteOf(now) },
      length: L,
      wrap: MATERIALS[spec.wrap].name,
      winding: WINDINGS[spec.winding].name,
    };
  }

  /** Pulls the string to the tension that tunes it, open, to its standard note (E1, A1, D2 or G2). */
  tuneToStandard(): void {
    const gauge = GAUGES[this.value<string>('string.gauge') as keyof typeof GAUGES];
    (this.control('string.tension') as NumberControl).set(Math.round(tensionFor(this.spec, this.scale, midiToHz(gauge.note)) * 10) / 10);
  }

  /** Works the modes out again and sends them to the engine (also kept on the node, for an engine built later). */
  private reconfigure(): void {
    if (this.building) return;
    const cfg = voiceConfig({
      spec: this.spec, scale: this.scale, tension: this.tension, fret: this.fret, pickup: this.value<number>('pickup.position'),
      palm: { position: PALM_POSITION, amount: this.value<number>('palm') }, sampleRate: SAMPLE_RATE,
    });
    this.lastLength = cfg.length;
    const message = { type: 'configure', ...cfg };
    this.circuit.setOption('string', 'config', JSON.stringify(message));
    this.circuit.send('string', message);
    for (const l of this.physicsListeners) l();
  }

  /** The present modes (frequencies, so the panel can animate the string in slow motion). */
  get modeHz(): number[] {
    return (JSON.parse(this.circuit.node('string').options.config!) as { hz?: number[] }).hz ?? [];
  }

  onPhysicsChange(fn: () => void): () => void {
    this.physicsListeners.add(fn);
    return () => this.physicsListeners.delete(fn);
  }

  // ---- Playing ----

  /** Plucks the string at `position` (m from the bridge; default: the Pluck at control) with `strength` 0..1. */
  pluck(position = this.value<number>('pluck.position'), strength = this.value<number>('pluck.strength')): void {
    const length = this.lastLength;
    const at = Math.min(Math.max(position, 0.01), length - 0.01);
    const hz = this.modeHz;
    const style = this.value<string>('pluck.style') === 'pick' ? PICK : FINGER;
    const height = 0.0003 * Math.pow(20, strength); // 0.3 mm to 6 mm
    const amps = pluckAmplitudes(length, hz, { position: at, height, ...style });
    // the hand grabs the string first: the modes that move where it touches are stopped
    const grab = contactDamping(length, hz.length, at, 0.9).map((d) => 1 - d);
    this.circuit.send('string', { type: 'mute', on: false });
    this.circuit.send('string', { type: 'pluck', amps, grab });
    for (const l of this.pluckListeners) l(at);
  }

  onPluck(fn: (position: number) => void): () => void {
    this.pluckListeners.add(fn);
    return () => this.pluckListeners.delete(fn);
  }

  /** Lifts the fretting finger: the string is muted (as a bassist ends a note). */
  release(): void {
    this.circuit.send('string', { type: 'mute', on: true });
  }

  /** The open string's note (to work out frets from notes). */
  get openNote(): number {
    return noteOf(idealFrequency(this.spec, this.scale, this.value<number>('string.tension'))).note;
  }

  keyDown(note: number, velocity = 96): void {
    const fret = note - this.openNote;
    if (fret < 0 || fret > BASS_FRETS) return; // not on this string
    this.held = this.held.filter((n) => n !== note);
    this.held.push(note);
    this.latched.delete(note);
    (this.control('fret') as NumberControl).set(fret);
    this.pluck(undefined, Math.min(1, Math.max(0.05, (this.value<number>('pluck.strength') * velocity) / 96)));
    this.notifyNotes();
  }

  keyUp(note: number): void {
    if (!this.held.includes(note)) return;
    if (this.pedal) {
      this.latched.add(note);
      return;
    }
    this.held = this.held.filter((n) => n !== note);
    const previous = this.held[this.held.length - 1];
    if (previous === undefined) this.release();
    else (this.control('fret') as NumberControl).set(previous - this.openNote); // falls back to the note still held (a pull-off)
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

  /** Bends the string: pulling it sideways raises its tension (the wheel: up to a tone up; down does nothing). */
  setPitchBend(value: number): void {
    this.bend = Math.min(1, Math.max(0, value));
    this.reconfigure();
    this.notifyPerformance();
  }

  get modWheel(): number {
    return this.modWheelValue;
  }

  /** The mod wheel is the palm: rest it on the strings. */
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

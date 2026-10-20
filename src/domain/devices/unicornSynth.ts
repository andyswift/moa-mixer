import type { MidiClock } from '../midi/clock';
import type { MidiEvent } from '../midi/events';
import { RHYTHM_NAMES, SONG_NAMES } from '../sequencer/unicornRhythm';
import { ChoiceControl, NumberControl, ToggleControl } from './controls';
import { Device } from './device';
import { Transport } from './transport';

/** A sound for the voices: two waves, the second `i2` semitones off and mixed in by `mix2`, an ADSR and vibrato. */
export interface ToneSound {
  w1: 'square' | 'pulse25' | 'pulse12' | 'saw' | 'triangle' | 'sine';
  w2: ToneSound['w1'];
  i2: number;
  mix2: number;
  a: number;
  d: number;
  s: number;
  r: number;
  /** Vibrato depth in cents (0 for none), its rate and how long after the note it starts. */
  vib: number;
  vibRate: number;
  vibDelay: number;
  gain: number;
}

export interface UnicornPreset {
  name: string;
  /** What the button says (in Norwegian: the page is for Norwegian children). */
  label: string;
  /** A picture for the button. */
  icon: string;
  sound: ToneSound;
  /** Where Magic (the filter) and Sparkle (its resonance) start for this sound. */
  magic: number;
  sparkle: number;
}

const tone = (s: Partial<ToneSound>): ToneSound => ({
  w1: 'square', w2: 'square', i2: 12, mix2: 0, a: 0.005, d: 0.3, s: 0.6, r: 0.2, vib: 0, vibRate: 5.5, vibDelay: 0.3, gain: 1, ...s,
});

/** Simple sounds, as a small keyboard's: a few waves, an envelope and vibrato. */
export const UNICORN_PRESETS: readonly UnicornPreset[] = [
  { name: 'Piano', label: 'Piano', icon: '🎹', magic: 4500, sparkle: 0.1, sound: tone({ w1: 'pulse25', w2: 'square', i2: 12, mix2: 0.3, a: 0.002, d: 0.9, s: 0, r: 0.25 }) },
  { name: 'Organ', label: 'Orgel', icon: '🎶', magic: 6000, sparkle: 0.05, sound: tone({ w1: 'square', w2: 'square', i2: 12, mix2: 0.5, a: 0.005, d: 0.1, s: 1, r: 0.08, gain: 0.8 }) },
  { name: 'Flute', label: 'Fløyte', icon: '🌬️', magic: 3000, sparkle: 0.1, sound: tone({ w1: 'sine', w2: 'triangle', i2: 12, mix2: 0.15, a: 0.06, d: 0.3, s: 0.9, r: 0.15, vib: 12, vibDelay: 0.35, gain: 1.3 }) },
  { name: 'Trumpet', label: 'Trompet', icon: '🎺', magic: 2500, sparkle: 0.3, sound: tone({ w1: 'saw', w2: 'pulse25', i2: 0, mix2: 0.3, a: 0.04, d: 0.2, s: 0.8, r: 0.1, vib: 10, gain: 0.8 }) },
  { name: 'Violin', label: 'Fiolin', icon: '🎻', magic: 3500, sparkle: 0.15, sound: tone({ w1: 'saw', w2: 'saw', i2: 0.08, mix2: 0.5, a: 0.12, d: 0.3, s: 1, r: 0.3, vib: 18, vibDelay: 0.4, gain: 0.8 }) },
  { name: 'Bells', label: 'Bjeller', icon: '🔔', magic: 8000, sparkle: 0.1, sound: tone({ w1: 'sine', w2: 'sine', i2: 19, mix2: 0.4, a: 0.001, d: 1.5, s: 0, r: 1.2, gain: 1.3 }) },
  { name: 'Robot', label: 'Robot', icon: '🤖', magic: 1200, sparkle: 0.85, sound: tone({ w1: 'pulse12', w2: 'square', i2: -12, mix2: 0.5, a: 0.001, d: 0.2, s: 0.7, r: 0.05, vib: 60, vibRate: 9, vibDelay: 0 }) },
  { name: 'Kitty', label: 'Pusekatt', icon: '🐱', magic: 2000, sparkle: 0.7, sound: tone({ w1: 'triangle', w2: 'pulse25', i2: 12, mix2: 0.25, a: 0.02, d: 0.4, s: 0.3, r: 0.3, vib: 40, vibRate: 7, vibDelay: 0.1, gain: 1.2 }) },
  { name: 'Space', label: 'Romskip', icon: '🚀', magic: 1500, sparkle: 0.6, sound: tone({ w1: 'saw', w2: 'square', i2: 7, mix2: 0.5, a: 0.3, d: 1, s: 0.7, r: 1.5, vib: 8, gain: 0.8 }) },
  { name: 'Elephant', label: 'Elefant', icon: '🐘', magic: 900, sparkle: 0.3, sound: tone({ w1: 'square', w2: 'saw', i2: -12, mix2: 0.6, a: 0.005, d: 0.3, s: 0.6, r: 0.1 }) },
];

/** Sustain lets go slowly: the release this many times longer (and at least this long). */
const SUSTAIN_TIMES = 4, SUSTAIN_MIN = 1;
/** Vibrato on adds this much to a sound that has none. */
const VIBRATO_CENTS = 15;

/**
 * MOA-UNICORN: a keyboard for children, with simple sounds in the spirit of a Casiotone. Eight voices
 * (`toneWorklet.ts`) into the MOA-1's ladder filter: Magic opens it, Sparkle is its resonance. A rhythm box and One
 * Key Play (any key plays the next note of a song) are on the page; their choices are controls here.
 *
 * MIDI notes on its channel (any by default) play it; the octave buttons move every key an octave.
 */
export class UnicornSynth extends Device {
  readonly name: string;
  readonly transport: Transport;
  private readonly held = new Map<number, number>(); // key -> the note it plays
  private readonly noteListeners = new Set<(note: number, on: boolean) => void>();
  private readonly changeListeners = new Set<() => void>();

  // the circuit first: the controls below send their first values to it
  private readonly built = this.circuit
    .add('voices', 'tone', { level: 0.7 }, { role: 'voices', preset: JSON.stringify(UNICORN_PRESETS[0]!.sound) })
    .add('filter', 'ladder', { cutoff: 4500, detune: 0, res: 0.1, drive: 0.15 })
    .add('drums', 'tone', { level: 0.6 }, { role: 'drums', preset: '{}' })
    .add('out', 'gain', { gain: 0.8 })
    .add('meter', 'meter', {}, { channel: 'mono' })
    .connect('voices', 'filter')
    .connect('filter', 'out')
    .connect('drums', 'out')
    .connect('out', 'meter');

  readonly preset = this.choice('uni.preset', 'Sound', UNICORN_PRESETS.map((p) => p.name), 'Piano', () => this.loadSound(true));
  readonly magic = this.num('uni.magic', 'Magic', 150, 12000, 4500, 'Hz', (v) => this.circuit.setParam('filter', 'cutoff', v), 'log');
  readonly sparkle = this.num('uni.sparkle', 'Sparkle', 0, 0.95, 0.1, '', (v) => this.circuit.setParam('filter', 'res', v));
  readonly volume = this.num('uni.volume', 'Volume', 0, 1, 0.8, '', (v) => this.circuit.setParam('out', 'gain', v));
  readonly vibrato = this.toggle('uni.vibrato', 'Vibrato', false, () => this.loadSound(false));
  readonly sustain = this.toggle('uni.sustain', 'Sustain', false, () => this.loadSound(false));
  readonly octave = this.choice('uni.octave', 'Octave', ['-1', '0', '+1'], '0', () => this.notifyChange());
  readonly rhythm = this.choice('uni.rhythm', 'Rhythm', ['off', ...RHYTHM_NAMES], 'off', () => this.notifyChange());
  readonly tempo = this.num('uni.tempo', 'Tempo', 50, 200, 110, 'BPM', () => this.notifyChange());
  readonly beatLevel = this.num('uni.beat', 'Drums', 0, 1, 0.7, '', (v) => this.circuit.setParam('drums', 'level', v));
  readonly song = this.choice('uni.song', 'Song', ['off', ...SONG_NAMES], 'off', () => this.notifyChange());

  constructor(clock: MidiClock, name = 'MOA-UNICORN') {
    super();
    this.name = name;
    this.transport = new Transport(clock);
    this.transport.channel.set('omni');
    this.controlList.push(this.transport.channel);
    this.outputList.push({ name: 'out', nodeId: 'out' });
    this.meterList.push({ name: 'out', nodeId: 'meter' });
  }

  get currentPreset(): UnicornPreset {
    return UNICORN_PRESETS.find((p) => p.name === this.preset.value) ?? UNICORN_PRESETS[0]!;
  }

  /** The sound as it plays: the preset with sustain and vibrato. */
  get sound(): ToneSound {
    const s = { ...this.currentPreset.sound };
    if (this.sustain.value) s.r = Math.max(SUSTAIN_MIN, s.r * SUSTAIN_TIMES);
    if (this.vibrato.value && s.vib === 0) s.vib = VIBRATO_CENTS;
    return s;
  }

  /** Sends the sound to the voices; a new preset also sets Magic and Sparkle where it likes them. */
  private loadSound(newPreset: boolean): void {
    // (not while the controls are being made)
    if (!(this.sustain as ToggleControl | undefined) || !(this.vibrato as ToggleControl | undefined)) return;
    const s = this.sound;
    this.circuit.node('voices').options.preset = JSON.stringify(s);
    this.circuit.send('voices', { type: 'preset', preset: s });
    if (newPreset) {
      this.magic.set(this.currentPreset.magic);
      this.sparkle.set(this.currentPreset.sparkle);
    }
    this.notifyChange();
  }

  private get shift(): number {
    return 12 * Number(this.octave.value);
  }

  /** A key down: plays `note` moved by the octave buttons (or `as`, a note chosen for it, as One Key Play does). */
  keyDown(key: number, velocity = 0.8, when?: number, as?: number): void {
    const note = (as ?? key) + this.shift;
    if (note < 0 || note > 127) return;
    if (this.held.has(key)) this.keyUp(key, when);
    this.held.set(key, note);
    this.circuit.send('voices', { type: 'on', note, velocity, when });
    for (const l of this.noteListeners) l(note, true);
  }

  keyUp(key: number, when?: number): void {
    const note = this.held.get(key);
    if (note === undefined) return;
    this.held.delete(key);
    this.circuit.send('voices', { type: 'off', note, when });
    for (const l of this.noteListeners) l(note, false);
  }

  /** Plays a note for `length` seconds from `when` (a tune being played to the listener). */
  playNote(note: number, when: number, length: number, velocity = 0.8): void {
    this.circuit.send('voices', { type: 'on', note: note + this.shift, velocity, when });
    this.circuit.send('voices', { type: 'off', note: note + this.shift, when: when + length });
  }

  drum(kind: string, velocity: number, when?: number): void {
    this.circuit.send('drums', { type: 'drum', kind, velocity, when });
  }

  /** Stops every note (and any tune that was placed ahead). */
  allOff(): void {
    for (const k of [...this.held.keys()]) this.keyUp(k);
    this.circuit.send('voices', { type: 'allOff' });
  }

  get heldKeys(): readonly number[] {
    return [...this.held.keys()];
  }

  handleMidi(event: MidiEvent): void {
    if ((event.type !== 'noteOn' && event.type !== 'noteOff') || !this.transport.acceptsChannel(event.channel)) return;
    if (event.type === 'noteOn' && event.velocity > 0) this.keyDown(event.note, event.velocity / 127);
    else this.keyUp(event.note);
  }

  /** Called with every note that starts or stops (for the unicorn to jump). */
  onNote(fn: (note: number, on: boolean) => void): () => void {
    this.noteListeners.add(fn);
    return () => this.noteListeners.delete(fn);
  }

  onChange(fn: () => void): () => void {
    this.changeListeners.add(fn);
    return () => this.changeListeners.delete(fn);
  }

  private notifyChange(): void {
    for (const l of this.changeListeners) l();
  }

  private num(...args: ConstructorParameters<typeof NumberControl>): NumberControl {
    const c = new NumberControl(...args);
    this.controlList.push(c);
    return c;
  }

  private choice(...args: ConstructorParameters<typeof ChoiceControl>): ChoiceControl {
    const c = new ChoiceControl(...args);
    this.controlList.push(c);
    return c;
  }

  private toggle(...args: ConstructorParameters<typeof ToggleControl>): ToggleControl {
    const c = new ToggleControl(...args);
    this.controlList.push(c);
    return c;
  }
}

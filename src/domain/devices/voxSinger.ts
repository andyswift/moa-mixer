import type { MidiEvent } from '../midi/events';
import { midiToHz } from './bassPhysics';
import { NumberControl } from './controls';
import { Device } from './device';
import type { Playable } from './playable';

const MOD_WHEEL_CC = 1;
const BREATH_CC = 2;
const EXPRESSION_CC = 11;
const VOWEL_CC = 74;
const BEND_SEMITONES = 2;

/**
 * A vocal tract's shape: where the tongue's body is (on a 44-section grid, throat to teeth), how high, the lips'
 * opening, the velum's, and the ring (how narrow the tube just above the folds is: 0.5 as it rests).
 */
export interface TractShape {
  tongueIndex: number;
  tongueDiameter: number;
  lips: number;
  velum: number;
  ring?: number;
}

/**
 * The vowels, as tract shapes: each found by searching the tongue and lips for the shape whose first two resonances
 * (measured from the model's own impulse response, 17 cm tract) land on the average man's (Peterson and Barney 1952;
 * oh between their /o/ and /ɔ/). In the order the Vowel knob passes through them: round at the back to spread at the front.
 */
export const VOWELS: readonly { name: string; formants: [number, number]; shape: Omit<TractShape, 'velum'> }[] = [
  { name: 'oo', formants: [300, 870], shape: { tongueIndex: 25, tongueDiameter: 2.25, lips: 0.5 } },
  { name: 'oh', formants: [500, 850], shape: { tongueIndex: 19, tongueDiameter: 2.4, lips: 0.7 } },
  { name: 'ah', formants: [730, 1090], shape: { tongueIndex: 11, tongueDiameter: 2.25, lips: 1.5 } },
  { name: 'eh', formants: [530, 1840], shape: { tongueIndex: 28, tongueDiameter: 3.3, lips: 1.3 } },
  { name: 'ee', formants: [270, 2290], shape: { tongueIndex: 35.5, tongueDiameter: 2.5, lips: 0.7 } },
];

/** The tract's shape for a point on the Vowel knob (0 oo .. 4 ee, between two vowels a blend of them) and a velum opening. */
export function vowelShape(vowel: number, nasal: number): TractShape {
  const v = Math.max(0, Math.min(VOWELS.length - 1, vowel));
  const a = VOWELS[Math.floor(v)]!.shape, b = VOWELS[Math.min(VOWELS.length - 1, Math.floor(v) + 1)]!.shape, f = v - Math.floor(v);
  const mix = (x: number, y: number) => x + (y - x) * f;
  return { tongueIndex: mix(a.tongueIndex, b.tongueIndex), tongueDiameter: mix(a.tongueDiameter, b.tongueDiameter), lips: mix(a.lips, b.lips), velum: 0.01 + 0.39 * nasal };
}

/** What the voice's worklet draws: the tract's diameters glottis to lips, the velum, the pitch and how loud. */
export interface VoxView {
  diameters: Float32Array;
  velum: number;
  hz: number;
  amp: number;
  lipStart: number;
  noseStart: number;
}

/**
 * MOA-VOX: a singing voice, physically modelled (`voiceWorklet.ts`): vocal folds (an LF glottal pulse with a tension
 * and a breath), a vocal tract of cylinders shaped by a tongue and lips into vowels, and a nose behind the velum. One
 * voice: a singer sings one note at a time, so a key pressed while another is held is sung legato, gliding to it, and
 * letting it go glides back to the one still held. The bend wheel bends the pitch, the mod wheel adds vibrato; a
 * breath controller (CC 2) gives it air, the expression pedal (CC 11) how loud, and CC 74 moves the vowel.
 */
export class VoxSinger extends Device implements Playable {
  readonly name: string;
  readonly bendRange = BEND_SEMITONES;
  private held: number[] = [];
  private velocities = new Map<number, number>();
  private bend = 0;
  private modWheelValue = 0;
  private readonly noteListeners = new Set<() => void>();
  private readonly performanceListeners = new Set<() => void>();
  private settings: Record<string, unknown> = {};

  constructor(name = 'MOA-VOX') {
    super();
    this.name = name;
    const c = this.circuit;
    c.add('voice', 'voice', { level: 0.8 }, { config: '{}' })
      .add('master', 'gain', { gain: 1 })
      .connect('voice', 'master');
    this.outputList.push({ name: 'out', nodeId: 'master' });

    const shape = () => this.configure({ shape: this.shape });
    this.num('vowel', 'Vowel', 0, VOWELS.length - 1, 2, '', shape);
    this.num('nasal', 'Nasal', 0, 1, 0, '', shape);
    this.num('ring', 'Ring', 0, 1, 0.5, '', shape);
    this.num('size', 'Tract', 13, 19, 17, 'cm', (v) => this.configure({ length: v }));
    this.num('tension', 'Tension', 0, 1, 0.6, '', (v) => this.configure({ tension: v }));
    this.num('breath', 'Breath', 0, 1, 0.25, '', (v) => this.configure({ breath: v }));
    this.num('roughness', 'Rough', 0, 1, 0.3, '', (v) => this.configure({ roughness: v }));
    this.num('onset', 'Onset', 0, 1, 0.5, '', (v) => this.configure({ onset: v }));
    this.num('scoop', 'Scoop', 0, 150, 40, 'ct', (v) => this.configure({ scoop: v }));
    this.num('vibrato.depth', 'Vibrato', 0, 100, 30, 'ct', (v) => this.applyVibrato(v));
    this.num('vibrato.rate', 'Rate', 3, 8, 5.5, 'Hz', (v) => this.configure({ vibRate: v }));
    this.num('vibrato.delay', 'Delay', 0, 1.5, 0.35, 's', (v) => this.configure({ vibDelay: v }));
    this.num('glide', 'Glide', 0.005, 0.5, 0.06, 's', (v) => this.configure({ glide: v }), 'log');
    this.num('attack', 'Attack', 0.01, 1, 0.08, 's', (v) => this.configure({ attack: v }), 'log');
    this.num('release', 'Release', 0.02, 2, 0.25, 's', (v) => this.configure({ release: v }), 'log');
    this.num('level', 'Level', 0, 2, 0.8, '', (v) => c.setParam('voice', 'level', v));
  }

  private num(id: string, label: string, min: number, max: number, init: number, unit: string, apply: (v: number) => void, curve?: 'linear' | 'log'): void {
    this.controlList.push(new NumberControl(id, label, min, max, init, unit, apply, curve));
  }

  private value(id: string): number {
    const c = this.controlList.find((x) => x.id === id);
    return c ? (c.value as number) : 0;
  }

  /** Sends the voice a change, and keeps the whole setup in the node's options for a worklet built later. */
  private configure(change: Record<string, unknown>): void {
    this.settings = { ...this.settings, ...change };
    this.circuit.setOption('voice', 'config', JSON.stringify(this.settings));
    this.circuit.send('voice', { type: 'configure', ...change });
  }

  /** The vibrato: the knob's depth, and the mod wheel adding up to 60 cents more. */
  private applyVibrato(depth = this.value('vibrato.depth')): void {
    this.configure({ vibDepth: depth + 60 * this.modWheelValue });
  }

  /** The tract's shape the knobs ask for now. */
  get shape(): TractShape {
    return { ...vowelShape(this.value('vowel'), this.value('nasal')), ring: this.value('ring') };
  }

  // ---- playing ----

  get heldNotes(): readonly number[] {
    return this.held;
  }

  keyDown(note: number, velocity = 100): void {
    const legato = this.held.length > 0;
    this.held = [...this.held.filter((n) => n !== note), note];
    this.velocities.set(note, velocity);
    this.sing(note, legato);
    this.notifyNotes();
  }

  keyUp(note: number): void {
    if (!this.held.includes(note)) return;
    const wasSinging = this.held.at(-1) === note;
    this.held = this.held.filter((n) => n !== note);
    this.velocities.delete(note);
    if (!this.held.length) this.circuit.send('voice', { type: 'off' });
    else if (wasSinging) this.sing(this.held.at(-1)!, true); // back to the one still held
    this.notifyNotes();
  }

  private sing(note: number, legato: boolean): void {
    const velocity = this.velocities.get(note) ?? 100;
    this.circuit.send('voice', { type: 'note', hz: midiToHz(note), intensity: 0.35 + 0.65 * (velocity / 127), legato });
  }

  onNoteChange(fn: () => void): () => void {
    this.noteListeners.add(fn);
    return () => this.noteListeners.delete(fn);
  }

  get pitchBend(): number {
    return this.bend;
  }

  setPitchBend(value: number): void {
    this.bend = Math.min(1, Math.max(-1, value));
    this.configure({ bend: this.bend * BEND_SEMITONES });
    this.notifyPerformance();
  }

  get modWheel(): number {
    return this.modWheelValue;
  }

  setModWheel(value: number): void {
    this.modWheelValue = Math.min(1, Math.max(0, value));
    this.applyVibrato();
    this.notifyPerformance();
  }

  onPerformanceChange(fn: () => void): () => void {
    this.performanceListeners.add(fn);
    return () => this.performanceListeners.delete(fn);
  }

  /** MIDI (any channel): notes sing, the bend wheel bends, the mod wheel adds vibrato. */
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
        else if (event.controller === BREATH_CC) (this.control('breath') as NumberControl).set(event.value / 127);
        else if (event.controller === EXPRESSION_CC) this.configure({ expression: event.value / 127 });
        else if (event.controller === VOWEL_CC) (this.control('vowel') as NumberControl).set(((VOWELS.length - 1) * event.value) / 127);
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

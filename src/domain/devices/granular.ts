import type { MidiEvent } from '../midi/events';
import { Device } from './device';
import { ChoiceControl, NumberControl, ToggleControl } from './controls';
import type { Playable } from './playable';
import { REVERB_SIZES, SOFT_UNITY } from './sendFx';
import type { PresetValues, SynthPreset } from './synthPresets';
import { MIDI_CHANNELS } from './transport';

/** The MIDI channel the granular voices listen on by default (1 is the mono synth, 2 the poly synth, 10 the drums). */
export const GRANULAR_MIDI_CHANNEL = '3';
const MOD_WHEEL_CC = 1;
const BEND_RANGE_SEMITONES = 2;
const DEFAULT_VELOCITY = 0.8; // for keys with no velocity of their own (the on-screen and computer keyboards)

/** Seconds of audio the capture buffer holds. */
export const GRANULAR_BUFFER_SECONDS = 20;

/** Every control with its default, so loading a patch always resets everything. */
export const GRANULAR_INIT: PresetValues = {
  'gr.position': 0.3, 'gr.size': 120, 'gr.pitch': 0, 'gr.rate': 12, 'gr.spread': 0.5, 'gr.cloud': 0.2,
  'gr.detune': 0, 'gr.shape': 0.3, 'gr.reverse': 0, 'gr.feedback': 0, 'gr.mix': 1, 'gr.freeze': 0,
  'gr.filter': 20000, 'gr.reso': 0.7, 'gr.drive': 0, 'gr.reverb': 0, 'gr.tone': 8000, 'gr.tail': 'medium',
  'gr.play': 0, 'gr.attack': 20, 'gr.decay': 300, 'gr.sustain': 0.8, 'gr.release': 600,
};

/** The convolver normalises its tail, so the reverb needs make-up gain (same reasoning as the send reverb). */
const REVERB_MAKEUP = 3.5;
const REVERB_CEILING = 2;
/** Saturator: drive 0..1 raises the gain into the soft clipper from 1x to 1 + DRIVE_RANGE x. */
const DRIVE_RANGE = 7;

const p = (name: string, values: PresetValues): SynthPreset => ({ name, values });

export const GRANULAR_PRESETS: readonly SynthPreset[] = [
  p('Init', {}),
  p('Cloud Wash', { 'gr.position': 0.5, 'gr.size': 350, 'gr.rate': 30, 'gr.spread': 1, 'gr.cloud': 0.6, 'gr.detune': 12, 'gr.shape': 0, 'gr.reverb': 0.35, 'gr.tail': 'large' }),
  p('Frozen Pad', { 'gr.position': 0.15, 'gr.size': 700, 'gr.rate': 14, 'gr.spread': 0.9, 'gr.cloud': 0.25, 'gr.detune': 6, 'gr.shape': 0, 'gr.freeze': 1, 'gr.filter': 3500, 'gr.reverb': 0.3, 'gr.tail': 'large' }),
  p('Stutter', { 'gr.position': 0.02, 'gr.size': 90, 'gr.rate': 8, 'gr.spread': 0.2, 'gr.cloud': 0, 'gr.shape': 0.7 }),
  p('Octave Shimmer', { 'gr.position': 0.25, 'gr.size': 220, 'gr.pitch': 12, 'gr.rate': 24, 'gr.spread': 0.8, 'gr.cloud': 0.3, 'gr.detune': 8, 'gr.feedback': 0.35, 'gr.reverb': 0.25 }),
  p('Reverse Swell', { 'gr.position': 0.35, 'gr.size': 900, 'gr.rate': 6, 'gr.spread': 0.6, 'gr.cloud': 0.15, 'gr.shape': 0, 'gr.reverse': 1 }),
  p('Glitch Dust', { 'gr.position': 0.6, 'gr.size': 25, 'gr.rate': 70, 'gr.spread': 1, 'gr.cloud': 0.9, 'gr.detune': 40, 'gr.shape': 0.8, 'gr.reverse': 0.3, 'gr.drive': 0.35, 'gr.filter': 9000, 'gr.reso': 3 }),
  p('Tape Drone', { 'gr.position': 0.1, 'gr.size': 500, 'gr.pitch': -12, 'gr.rate': 18, 'gr.spread': 0.4, 'gr.cloud': 0.1, 'gr.detune': 4, 'gr.shape': 0, 'gr.feedback': 0.6, 'gr.filter': 1800, 'gr.reso': 2, 'gr.drive': 0.25 }),
];

/**
 * Granular processor: mono in, stereo out, for an aux send.
 *   in -> grains (records into a ring buffer, plays back a cloud of short windowed grains)
 *      -> filter -> saturator -> wet ----------------------------\
 *                          \-> reverb send -> reverb -> tone ----> out
 *   in -> dry ---------------------------------------------------/
 * The buffer always records the live input, so Position reaches back in time from "now" (0) to the oldest audio
 * (1). Freeze stops recording and holds the buffer still. Feedback writes the output back into the buffer, softly
 * clipped inside the engine, so it stays bounded. Mix 1 is all grains (what you want on an aux send).
 *
 * Two ways to play it. With Keys off, the cloud runs all the time (an effect on whatever comes in). With Keys on, it
 * is silent until a note arrives: 8 voices, each its own cloud transposed by (note - 60) semitones and shaped by the
 * ADSR. Playing a key switches Keys on. Notes come from the keyboard bed or from MIDI on the chosen channel (default 3);
 * pitch bend (+/- 2 semitones) adds to Pitch, and the mod wheel is kept for the modulation stage.
 */
export class GranularFx extends Device implements Playable {
  readonly name: string;
  /** The eight patch slots: the factory patches, overwritten by saves. */
  readonly slots: SynthPreset[] = [...GRANULAR_PRESETS];
  currentSlot = 0;
  currentPreset: SynthPreset = this.slots[0]!;
  private readonly presetListeners = new Set<() => void>();
  private readonly noteListeners = new Set<() => void>();
  private readonly performanceListeners = new Set<() => void>();
  private held: number[] = [];
  private bend = 0;
  private modWheelValue = 0;
  private pitchSemitones = 0;

  constructor(name = 'Granular') {
    super();
    this.name = name;
    const c = this.circuit;

    c.add('in', 'gain', { gain: 1 }, { channels: 'mono' })
      .add('grains', 'granular', {
        maxTime: GRANULAR_BUFFER_SECONDS, position: 0.3, size: 0.12, pitch: 0, rate: 12, spread: 0.5, cloud: 0.2,
        detune: 0, shape: 0.3, reverse: 0, feedback: 0, freeze: 0,
        play: 0, attack: 0.02, decay: 0.3, sustain: 0.8, release: 0.6,
      })
      .add('filter', 'filter', { frequency: 20000, Q: 0.7, gain: 0, detune: 0 }, { type: 'lowpass' })
      .add('preDrive', 'gain', { gain: 1 })
      .add('sat', 'waveshaper', {}, { curve: 'soft' })
      .add('postDrive', 'gain', { gain: SOFT_UNITY })
      .add('revSend', 'gain', { gain: 0 })
      .add('conv', 'convolver', {}, { size: 'medium' })
      .add('revTone', 'filter', { frequency: 8000, Q: 0.707, gain: 0, detune: 0 }, { type: 'lowpass' })
      .add('revDrive', 'gain', { gain: (REVERB_MAKEUP * SOFT_UNITY) / REVERB_CEILING })
      .add('revSat', 'waveshaper', {}, { curve: 'soft' })
      .add('revOut', 'gain', { gain: REVERB_CEILING })
      .add('wet', 'gain', { gain: 1 })
      .add('dry', 'gain', { gain: 0 })
      .add('out', 'gain', { gain: 1 })
      .add('inMeter', 'meter', {}, { channel: 'mono' })
      .add('meterL', 'meter', {}, { channel: 'left' })
      .add('meterR', 'meter', {}, { channel: 'right' })
      .connect('in', 'grains')
      .connect('in', 'dry')
      .connect('in', 'inMeter')
      .connect('grains', 'filter')
      .connect('filter', 'preDrive')
      .connect('preDrive', 'sat')
      .connect('sat', 'postDrive')
      .connect('postDrive', 'wet')
      .connect('wet', 'out')
      .connect('postDrive', 'revSend')
      .connect('revSend', 'conv')
      .connect('conv', 'revTone')
      .connect('revTone', 'revDrive')
      .connect('revDrive', 'revSat')
      .connect('revSat', 'revOut')
      .connect('revOut', 'out')
      .connect('dry', 'out')
      .connect('out', 'meterL')
      .connect('out', 'meterR');

    this.inputList.push({ name: 'in', nodeId: 'in' });
    this.outputList.push({ name: 'out', nodeId: 'out' });
    this.meterList.push(
      { name: 'in', nodeId: 'inMeter' },
      { name: 'out.L', nodeId: 'meterL' },
      { name: 'out.R', nodeId: 'meterR' },
    );

    const init = GRANULAR_INIT as Record<string, number>;
    const num = (id: string, label: string, min: number, max: number, unit: string,
      apply: (v: number) => void, curve?: 'linear' | 'log') =>
      this.controlList.push(new NumberControl(id, label, min, max, init[id]!, unit, apply, curve));
    const grain = (id: string, label: string, min: number, max: number, unit: string, param: string,
      scale = 1, curve?: 'linear' | 'log') =>
      num(id, label, min, max, unit, (v) => c.setParam('grains', param, v * scale), curve);

    grain('gr.position', 'Position', 0, 1, '', 'position');
    grain('gr.size', 'Size', 5, 2000, 'ms', 'size', 1 / 1000, 'log');
    num('gr.pitch', 'Pitch', -24, 24, 'st', (v) => {
      this.pitchSemitones = v;
      this.applyPitch();
    });
    grain('gr.rate', 'Rate', 0.5, 100, 'Hz', 'rate', 1, 'log');
    grain('gr.spread', 'Spread', 0, 1, '', 'spread');
    grain('gr.cloud', 'Cloud', 0, 1, '', 'cloud');
    grain('gr.detune', 'Detune', 0, 100, 'ct', 'detune');
    grain('gr.shape', 'Shape', 0, 1, '', 'shape');
    grain('gr.reverse', 'Reverse', 0, 1, '', 'reverse');
    grain('gr.feedback', 'Feedback', 0, 0.95, '', 'feedback');
    num('gr.filter', 'Filter', 40, 20000, 'Hz', (v) => c.setParam('filter', 'frequency', v), 'log');
    num('gr.reso', 'Reso', 0.7, 12, '', (v) => c.setParam('filter', 'Q', v), 'log');
    num('gr.drive', 'Drive', 0, 1, '', (v) => {
      c.setParam('preDrive', 'gain', 1 + DRIVE_RANGE * v);
      c.setParam('postDrive', 'gain', SOFT_UNITY / (1 + 2 * v)); // drive adds grit, not much loudness
    });
    num('gr.reverb', 'Reverb', 0, 1, '', (v) => c.setParam('revSend', 'gain', v));
    num('gr.tone', 'Tone', 1000, 16000, 'Hz', (v) => c.setParam('revTone', 'frequency', v), 'log');
    num('gr.mix', 'Mix', 0, 1, '', (v) => {
      c.setParam('wet', 'gain', v);
      c.setParam('dry', 'gain', 1 - v);
    });
    num('gr.attack', 'Attack', 1, 4000, 'ms', (v) => c.setParam('grains', 'attack', v / 1000), 'log');
    num('gr.decay', 'Decay', 5, 4000, 'ms', (v) => c.setParam('grains', 'decay', v / 1000), 'log');
    num('gr.sustain', 'Sustain', 0, 1, '', (v) => c.setParam('grains', 'sustain', v));
    num('gr.release', 'Release', 5, 8000, 'ms', (v) => c.setParam('grains', 'release', v / 1000), 'log');
    this.controlList.push(
      new ToggleControl('gr.play', 'Keys', false, (on) => {
        c.setParam('grains', 'play', on ? 1 : 0);
        if (!on) this.releaseAll();
      }),
      new ChoiceControl('gr.channel', 'MIDI channel', MIDI_CHANNELS, GRANULAR_MIDI_CHANNEL, () => {}),
      new ChoiceControl('gr.tail', 'Tail', REVERB_SIZES, 'medium', (v) => c.setOption('conv', 'size', v)),
      new ToggleControl('gr.freeze', 'Freeze', false, (on) => c.setParam('grains', 'freeze', on ? 1 : 0)),
    );
  }

  // ---- Playing ----

  /** Pitch is the knob plus the pitch wheel, both in semitones. */
  private applyPitch(): void {
    this.circuit.setParam('grains', 'pitch', this.pitchSemitones + this.bend * BEND_RANGE_SEMITONES);
  }

  /** Releases every sounding voice and forgets the held keys. */
  private releaseAll(): void {
    this.circuit.allNotesOff('grains');
    if (this.held.length > 0) {
      this.held = [];
      for (const l of this.noteListeners) l();
    }
  }

  /** Starts a note. Playing a key turns Keys on, since the cloud would otherwise ignore it. */
  keyDown(note: number, velocity = DEFAULT_VELOCITY): void {
    const keys = this.control('gr.play');
    if (keys.kind === 'toggle' && !keys.value) keys.set(true);
    this.held = this.held.filter((n) => n !== note);
    this.held.push(note);
    this.circuit.noteOn('grains', note, velocity);
    for (const l of this.noteListeners) l();
  }

  keyUp(note: number): void {
    this.held = this.held.filter((n) => n !== note);
    this.circuit.noteOff('grains', note);
    for (const l of this.noteListeners) l();
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

  setPitchBend(value: number): void {
    this.bend = Math.min(1, Math.max(-1, value));
    this.applyPitch();
    for (const l of this.performanceListeners) l();
  }

  get modWheel(): number {
    return this.modWheelValue;
  }

  setModWheel(value: number): void {
    this.modWheelValue = Math.min(1, Math.max(0, value));
    for (const l of this.performanceListeners) l();
  }

  onPerformanceChange(fn: () => void): () => void {
    this.performanceListeners.add(fn);
    return () => this.performanceListeners.delete(fn);
  }

  /** Reacts to MIDI on the chosen channel: notes (with velocity), pitch bend, mod wheel (CC 1) and program change. */
  handleMidi(event: MidiEvent): void {
    if (!('channel' in event)) return;
    const channel = this.control('gr.channel');
    if (channel.kind !== 'choice' || (channel.value !== 'omni' && Number(channel.value) !== event.channel)) return;
    switch (event.type) {
      case 'noteOn':
        this.keyDown(event.note, event.velocity / 127);
        break;
      case 'noteOff':
        this.keyUp(event.note);
        break;
      case 'pitchBend':
        this.setPitchBend(event.value);
        break;
      case 'cc':
        if (event.controller === MOD_WHEEL_CC) this.setModWheel(event.value / 127);
        break;
      case 'programChange':
        if (event.program < this.slots.length) this.loadSlot(event.program);
        break;
    }
  }

  // ---- Patches ----

  /** Loads a patch: every control back to its default, then the patch's values on top. */
  loadPreset(preset: SynthPreset): void {
    const values = { ...GRANULAR_INIT, ...preset.values };
    this.currentPreset = preset;
    for (const [id, value] of Object.entries(values)) {
      const c = this.control(id);
      if (c.kind === 'number' && typeof value === 'number') c.set(value);
      else if (c.kind === 'toggle' && typeof value === 'number') c.set(value > 0);
      else if (c.kind === 'choice' && typeof value === 'string') c.set(value);
      else throw new Error(`Preset "${preset.name}": bad value for ${id}`);
    }
    for (const l of this.presetListeners) l();
  }

  /** Loads patch slot `index` (0-7). */
  loadSlot(index: number): void {
    const preset = this.slots[index];
    if (!preset) throw new Error(`No patch slot ${index}`);
    this.currentSlot = index;
    this.loadPreset(preset);
  }

  /** The current value of every control, in the form a patch stores. */
  snapshot(): PresetValues {
    const values: PresetValues = {};
    for (const c of this.controlList) {
      if (c.id === 'gr.channel') continue; // the MIDI channel belongs to the setup, not the sound
      values[c.id] = c.kind === 'toggle' ? (c.value ? 1 : 0) : c.value;
    }
    return values;
  }

  /** Stores the current sound in slot `index`, keeping the slot's name. */
  saveSlot(index: number): SynthPreset {
    const preset: SynthPreset = { name: this.slots[index]!.name, values: this.snapshot() };
    this.slots[index] = preset;
    this.currentSlot = index;
    this.currentPreset = preset;
    for (const l of this.presetListeners) l();
    return preset;
  }

  onPresetChange(fn: () => void): () => void {
    this.presetListeners.add(fn);
    return () => this.presetListeners.delete(fn);
  }
}

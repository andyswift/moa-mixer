import { Device } from './device';
import { ChoiceControl, NumberControl, ToggleControl } from './controls';
import type { Playable } from './playable';
import { PIPE_BANKS, PIPE_INIT, PIPE_PRESETS } from './pipePresets';
import { REVERB_SIZES } from './sendFx';
import type { PresetValues, SynthPreset } from './synthPresets';
import { Transport } from './transport';
import { MidiClock } from '../midi/clock';
import type { MidiEvent } from '../midi/events';

export const PIPE_VOICES = 8;
export const PIPE_MODES = ['poly', 'mono', 'unison'] as const;
export const PIPE_LFO_WAVES = ['sine', 'tri', 'sqr', 'ramp', 'rnd'] as const;
export const PIPE_LFO_DESTS = ['pitch', 'filter', 'steam', 'sat', 'push'] as const;
export const PIPE_LFO_DIVISIONS = ['1/1', '1/2', '1/4', '1/8', '1/16', '1/32'] as const;

const MOD_WHEEL_CC = 1;
const SUSTAIN_CC = 64;
const BEND_RANGE_SEMITONES = 2;
const DEFAULT_VELOCITY = 0.8; // for keys with no velocity of their own (the on-screen and computer keyboards)
/** The convolver normalises its tail, so it needs make-up gain (see the send reverb). */
const REVERB_MAKEUP = 3;

/**
 * MOA-PIPE: an eight-voice physical-modelling synthesizer, built on the Karplus-Strong idea. There are no
 * oscillators. Each voice blows "steam" (noise or DC pressure, filtered and shaped by an envelope) into a "pipe":
 * a tuned delay with filtered, saturated feedback. See `pipeWorklet.ts` for the model.
 *
 *   pipe (8 voices, stereo) -> dry ----------------------------\
 *                          \-> reverb -> low cut -> damping -> wet -> limiter -> out
 *
 * The note engine lives in the worklet; this device owns the controls, the patches and the performance state
 * (held keys, pitch bend, mod wheel, sustain pedal) and talks to the worklet through the circuit.
 */
export class PipeSynth extends Device implements Playable {
  readonly name: string;
  readonly transport: Transport;
  /** The sixteen patch slots (two banks of eight): the factory patches, overwritten by saves. */
  readonly slots: SynthPreset[] = [...PIPE_PRESETS];
  currentSlot = 0;
  currentPreset: SynthPreset = this.slots[0]!;
  private held: number[] = [];
  private bend = 0;
  private modWheelValue = 0;
  private lfoHz = 5;
  private lfoSync = false;
  private lfoDivision: (typeof PIPE_LFO_DIVISIONS)[number] = '1/8';
  private clockPulses = 0;
  private readonly noteListeners = new Set<() => void>();
  private readonly performanceListeners = new Set<() => void>();
  private readonly presetListeners = new Set<() => void>();

  constructor(name = 'Pipe', clock = new MidiClock()) {
    super();
    this.name = name;
    this.transport = new Transport(clock);
    this.transport.channel.set('omni');
    const c = this.circuit;

    c.add('pipe', 'pipe', {
      atk: 0.001, dec: 0.03, sus: 0, rel: 0.2, envKey: 0, vel: 0.5, legato: 0,
      noise: 1, nCut: 100, nRes: 0.2, nKey: 0.5, nEnv: 0, onePole: 0, gain: 0.8,
      tune: 0, fine: 0, harm: 0, split: 0, splitPt: 0.5, pol: 0,
      fbDec: 2, fbRel: 0.4, push: 0, satHard: 0.3, satSym: 0,
      hp: -36, lp: 36, hpComp: 1, lpComp: 1,
      mode: 0, detune: 12, glide: 0.1, glideOn: 0, spread: 0.5, volume: 0.8,
      lfoRate: 5, lfoShape: 0, lfoDelay: 0, lfoAmt: 0, lfoDest: 0,
      bend: 0, mod: 0,
    })
      .add('dry', 'gain', { gain: 1 })
      .add('revIn', 'gain', { gain: 1 })
      .add('conv', 'convolver', {}, { size: 'medium' })
      .add('revLow', 'filter', { frequency: 120, Q: 0.707, detune: 0 }, { type: 'highpass' })
      .add('revHigh', 'filter', { frequency: 8000, Q: 0.707, detune: 0 }, { type: 'lowpass' })
      .add('wet', 'gain', { gain: 0 })
      .add('sum', 'gain', { gain: 1 })
      .add('limiter', 'compressor', { threshold: -2, knee: 0, ratio: 20, attack: 0.002, release: 0.12 })
      .add('out', 'gain', { gain: 1 })
      .add('meterL', 'meter', {}, { channel: 'left' })
      .add('meterR', 'meter', {}, { channel: 'right' })
      .connect('pipe', 'dry')
      .connect('pipe', 'revIn')
      .connect('revIn', 'conv')
      .connect('conv', 'revLow')
      .connect('revLow', 'revHigh')
      .connect('revHigh', 'wet')
      .connect('dry', 'sum')
      .connect('wet', 'sum')
      .connect('sum', 'limiter')
      .connect('limiter', 'out')
      .connect('out', 'meterL')
      .connect('out', 'meterR');
    this.outputList.push({ name: 'out', nodeId: 'out' });
    this.meterList.push({ name: 'out.L', nodeId: 'meterL' }, { name: 'out.R', nodeId: 'meterR' });

    this.addControls();
    this.transport.tempo.onChange(() => this.applyLfoRate());
  }

  // ---- Controls ----

  private addControls(): void {
    const c = this.circuit;
    const init = PIPE_INIT as Record<string, number>;
    const num = (id: string, label: string, min: number, max: number, unit: string,
      apply: (v: number) => void, curve?: 'linear' | 'log') =>
      this.controlList.push(new NumberControl(id, label, min, max, init[id]!, unit, apply, curve));
    const param = (id: string, label: string, min: number, max: number, unit: string, name: string,
      scale = 1, curve?: 'linear' | 'log') =>
      num(id, label, min, max, unit, (v) => c.setParam('pipe', name, v * scale), curve);
    const toggle = (id: string, label: string, name: string) =>
      this.controlList.push(new ToggleControl(id, label, (init[id] ?? 0) > 0, (on) => c.setParam('pipe', name, on ? 1 : 0)));

    // Envelope (the steam's ADSR)
    param('env.attack', 'Attack', 0.5, 10000, 'ms', 'atk', 1 / 1000, 'log');
    param('env.decay', 'Decay', 1, 10000, 'ms', 'dec', 1 / 1000, 'log');
    param('env.sustain', 'Sustain', 0, 1, '', 'sus');
    param('env.release', 'Release', 5, 20000, 'ms', 'rel', 1 / 1000, 'log');
    param('env.keytrack', 'Keytrack', 0, 1, '', 'envKey');
    param('env.velocity', 'Velocity', 0, 1, '', 'vel');
    toggle('env.legato', 'Legato', 'legato');

    // Generator (the steam)
    param('gen.noise', 'DC / Noise', 0, 1, '', 'noise');
    param('gen.cutoff', 'Cutoff', 30, 140, 'pitch', 'nCut');
    param('gen.reso', 'Resonance', 0, 1, '', 'nRes');
    param('gen.keytrack', 'Keytrack', 0, 1, '', 'nKey');
    param('gen.envAmt', 'Env amount', -48, 48, 'st', 'nEnv');
    param('gen.gain', 'Gain', 0, 2, '', 'gain');
    toggle('gen.onePole', '1-pole', 'onePole');

    // Feedback (the pipe)
    param('fb.push', 'Push', 0, 1.5, '', 'push');
    param('fb.decay', 'Decay', 0.05, 30, 's', 'fbDec', 1, 'log');
    param('fb.release', 'Release', 0.02, 20, 's', 'fbRel', 1, 'log');

    // Saturation
    param('sat.hardness', 'Soft / Hard', 0, 1, '', 'satHard');
    param('sat.symmetry', 'Symmetry', 0, 1, '', 'satSym');

    // Patch
    param('patch.volume', 'Volume', 0, 1.2, '', 'volume');

    // Delay box
    param('delay.tune', 'Tune', -24, 24, 'st', 'tune');
    param('delay.fine', 'Fine', -100, 100, 'ct', 'fine');
    param('delay.harmonics', 'Harmonics', 0, 1, '', 'harm');
    param('delay.splitPoint', 'Split point', 0.05, 0.95, '', 'splitPt');
    toggle('delay.split', 'Split', 'split');
    toggle('delay.polarity', 'Polarity', 'pol');

    // Filter, in semitones from the note being played, so the tone follows the keyboard
    param('filter.highpass', 'Highpass', -60, 36, 'st', 'hp');
    param('filter.lowpass', 'Lowpass', 0, 84, 'st', 'lp');
    param('filter.hpComp', 'HP comp', 0, 1, '', 'hpComp');
    param('filter.lpComp', 'LP comp', 0, 1, '', 'lpComp');

    // Voice
    this.controlList.push(
      new ChoiceControl('voice.mode', 'Mode', PIPE_MODES, 'poly', (v) => {
        this.releaseAll();
        c.setParam('pipe', 'mode', PIPE_MODES.indexOf(v as (typeof PIPE_MODES)[number]));
      }),
    );
    param('voice.detune', 'Detune', 0, 100, 'ct', 'detune');
    param('voice.glide', 'Glide', 1, 5000, 'ms', 'glide', 1 / 1000, 'log');
    toggle('voice.glideOn', 'Glide on', 'glideOn');

    // LFO
    this.controlList.push(
      new ChoiceControl('lfo.wave', 'Wave', PIPE_LFO_WAVES, 'sine', (v) =>
        c.setParam('pipe', 'lfoShape', PIPE_LFO_WAVES.indexOf(v as (typeof PIPE_LFO_WAVES)[number]))),
      new ChoiceControl('lfo.dest', 'Destination', PIPE_LFO_DESTS, 'pitch', (v) =>
        c.setParam('pipe', 'lfoDest', PIPE_LFO_DESTS.indexOf(v as (typeof PIPE_LFO_DESTS)[number]))),
      new ChoiceControl('lfo.division', 'Division', PIPE_LFO_DIVISIONS, '1/8', (v) => {
        this.lfoDivision = v as (typeof PIPE_LFO_DIVISIONS)[number];
        this.applyLfoRate();
      }),
      new ToggleControl('lfo.sync', 'Sync', false, (on) => {
        this.lfoSync = on;
        this.applyLfoRate();
      }),
    );
    num('lfo.rate', 'Rate', 0.05, 40, 'Hz', (v) => {
      this.lfoHz = v;
      this.applyLfoRate();
    }, 'log');
    param('lfo.delay', 'Delay', 0, 5, 's', 'lfoDelay');
    param('lfo.amount', 'Amount', 0, 1, '', 'lfoAmt');

    // Reverb
    num('rev.mix', 'Mix', 0, 1, '', (v) => {
      c.setParam('dry', 'gain', Math.cos((v * Math.PI) / 2));
      c.setParam('wet', 'gain', Math.sin((v * Math.PI) / 2) * REVERB_MAKEUP);
    });
    num('rev.bass', 'Bass', 20, 800, 'Hz', (v) => c.setParam('revLow', 'frequency', v), 'log');
    num('rev.treble', 'Treble', 1500, 16000, 'Hz', (v) => c.setParam('revHigh', 'frequency', v), 'log');
    param('rev.spread', 'Spread', 0, 1, '', 'spread');
    this.controlList.push(
      new ChoiceControl('rev.size', 'Size', REVERB_SIZES, 'medium', (v) => c.setOption('conv', 'size', v)),
    );
  }

  /** LFO speed: the rate knob in Hz, or a note division of the transport tempo when synced. */
  private applyLfoRate(): void {
    const denominator = Number(this.lfoDivision.split('/')[1]);
    const hz = this.lfoSync ? ((this.transport.bpm / 60) * denominator) / 4 : this.lfoHz;
    this.circuit.setParam('pipe', 'lfoRate', Math.min(40, Math.max(0.05, hz)));
  }

  // ---- Playing ----

  private releaseAll(): void {
    this.circuit.allNotesOff('pipe');
    if (this.held.length > 0) {
      this.held = [];
      this.notifyNotes();
    }
  }

  keyDown(note: number, velocity = DEFAULT_VELOCITY): void {
    this.held = this.held.filter((n) => n !== note);
    this.held.push(note);
    this.circuit.noteOn('pipe', note, velocity);
    this.notifyNotes();
  }

  keyUp(note: number): void {
    this.held = this.held.filter((n) => n !== note);
    this.circuit.noteOff('pipe', note);
    this.notifyNotes();
  }

  get heldNotes(): readonly number[] {
    return this.held;
  }

  onNoteChange(fn: () => void): () => void {
    this.noteListeners.add(fn);
    return () => this.noteListeners.delete(fn);
  }

  /** The sustain pedal (CC 64). */
  setSustain(down: boolean): void {
    this.circuit.pedal('pipe', down);
  }

  get pitchBend(): number {
    return this.bend;
  }

  setPitchBend(value: number): void {
    this.bend = Math.min(1, Math.max(-1, value));
    this.circuit.setParam('pipe', 'bend', this.bend * BEND_RANGE_SEMITONES);
    this.notifyPerformance();
  }

  get modWheel(): number {
    return this.modWheelValue;
  }

  /** The mod wheel adds to the LFO amount: with the LFO on Filter it overblows, on Pitch it is vibrato. */
  setModWheel(value: number): void {
    this.modWheelValue = Math.min(1, Math.max(0, value));
    this.circuit.setParam('pipe', 'mod', this.modWheelValue);
    this.notifyPerformance();
  }

  onPerformanceChange(fn: () => void): () => void {
    this.performanceListeners.add(fn);
    return () => this.performanceListeners.delete(fn);
  }

  /** Reacts to MIDI on the chosen channel: notes with velocity, pitch bend, mod wheel, sustain pedal, program change, clock. */
  handleMidi(event: MidiEvent): void {
    if (event.type === 'clock') {
      if (this.lfoSync && this.transport.synced && ++this.clockPulses % 24 === 0) this.applyLfoRate();
      return;
    }
    if (!('channel' in event) || !this.transport.acceptsChannel(event.channel)) return;
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
        else if (event.controller === SUSTAIN_CC) this.setSustain(event.value >= 64);
        break;
      case 'programChange':
        if (event.program < this.slots.length) this.loadSlot(event.program);
        break;
    }
  }

  // ---- Patches ----

  /** Loads a patch: every control back to its init value, then the patch's values on top. */
  loadPreset(preset: SynthPreset): void {
    const values = { ...PIPE_INIT, ...preset.values };
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

  /** Loads patch slot `index` (0-15). */
  loadSlot(index: number): void {
    const preset = this.slots[index];
    if (!preset) throw new Error(`No patch slot ${index}`);
    this.currentSlot = index;
    this.loadPreset(preset);
  }

  /** The current value of every control, in the form a patch stores. */
  snapshot(): PresetValues {
    const values: PresetValues = {};
    for (const c of this.controlList) values[c.id] = c.kind === 'toggle' ? (c.value ? 1 : 0) : c.value;
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

  private notifyPerformance(): void {
    for (const l of this.performanceListeners) l();
  }

  private notifyNotes(): void {
    for (const l of this.noteListeners) l();
  }
}

export { PIPE_BANKS };

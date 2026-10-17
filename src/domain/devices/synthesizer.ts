import { Device } from './device';
import { ChoiceControl, NumberControl } from './controls';
import type { Circuit } from '../circuit/circuit';
import { INIT, SYNTH_PRESETS, type SynthPreset } from './synthPresets';
import { Transport } from './transport';
import { MidiClock } from '../midi/clock';
import { applyCcValue, DEFAULT_CC_MAP } from '../midi/ccMap';
import type { MidiEvent } from '../midi/events';

const CENTS_PER_OCTAVE = 1200;
const BEND_RANGE_CENTS = 200; // pitch wheel: +/- 2 semitones
const MOD_WHEEL_CENTS = 100; // full mod wheel adds this much LFO vibrato depth
const MOD_WHEEL_CC = 1;

const A4_HZ = 440;
const LFO_DEFAULT_HZ = 4.8;
const PW_SOURCES = ['man', 'lfo', 'env'] as const;
const NOTE_MODES = ['legato', 'retrig'] as const;
const LFO_WAVES = ['tri', 'sqr', 'rnd'] as const;
const RANGES = { "16'": -1200, "8'": 0, "4'": 1200, "2'": 2400 } as const;
const SUB_MODES = { '-1': -1200, '-2': -2400 } as const;
/** A note at this velocity or above is accented, as a 303's accent step (most sequencers send 127 for an accent). */
export const ACCENT_VELOCITY = 110;
const ACCENT_AMP = 0.6; // at full accent, accented notes are this much louder
const ACCENT_ENV = 0.8; // ... their filter envelope swings this much further
const ACCENT_DECAY = 0.12; // ... and decays no longer than this (s)
const DRIVE_TILT_HZ = 700; // the drive's tilt EQ pivots here
const LADDER_GAIN = 1.25; // the ladder measured about 2 dB under the clean filter on an acid line; this matches them

/**
 * SH-101 style monophonic synth:
 *   saw + pulse + sub + noise -> source mix -> filter -> (dry, or drive) -> amp (VCA) -> accent -> level
 * Pitch is a CV in cents: a hidden `pitch` signal (the played note) and `range` (octave switch)
 * are both summed into every oscillator's detune, so the sub tracks the keyboard for free.
 * ampEnv drives the VCA, filterEnv sweeps the filter cutoff (and the keyboard follows it via keyFollow).
 * Filter: Clean (two biquads, the original) or Ladder, a four-pole ladder with its saturation inside the resonance
 * loop (`ladderWorklet.ts`), whose Filter drive squashes loud notes' resonance into a rubbery squelch. Both get the
 * same cutoff, envelope, key follow and LFO.
 * Accent (for acid lines): a loud note (velocity 110 and up) is louder, with a deeper and shorter filter sweep.
 * Drive: a parallel wavefolder after the filter, blended in as it rises, so at 0 the dry sound is untouched. A tilt EQ
 * before it picks what folds (bright: the lows stay clean, no mud on a bass line); Even biases the fold for even
 * harmonics; Harmonics keeps that many harmonics of the played note (the folder follows the pitch) and drops the fizz.
 * The folder is antialiased (see `foldWorklet.ts`), so it adds no tones unrelated to the note.
 */
export class Synthesizer extends Device {
  readonly name: string;
  readonly transport: Transport;
  /** CC number -> control id. Editable; defaults suit a Torso T-1 CC track. */
  readonly ccMap = new Map(DEFAULT_CC_MAP);
  private held: number[] = []; // MIDI notes currently down, most recent last
  private presetListeners = new Set<() => void>();
  currentPreset: SynthPreset = SYNTH_PRESETS[0]!;
  private gateOpen = false;
  private glideSeconds = 0;
  private retrigger = false;
  private pwSource: (typeof PW_SOURCES)[number] = 'man';
  private pwmAmount = 0;
  private bend = 0; // -1..1
  private modWheelValue = 0; // 0..1
  private oscModCents = 0; // the panel's Mod fader: LFO -> pitch depth
  private accentAmount = 0;
  private envAmount = 2; // oct
  private envDecay = 0.3; // s
  private accented = false;
  private readonly performanceListeners = new Set<() => void>();
  private readonly noteListeners = new Set<() => void>();

  constructor(name = 'Synth', clock = new MidiClock()) {
    super();
    this.name = name;
    this.transport = new Transport(clock);
    const c = this.circuit;
    c.add('pitch', 'constant', { offset: 0, glide: 0 })
      .add('range', 'constant', { offset: 0 })
      .add('bend', 'constant', { offset: 0 }) // pitch wheel, in cents
      .add('subShift', 'constant', { offset: SUB_MODES['-1'] })
      .add('pulseWidthCv', 'constant', { offset: 0 })
      .add('sawOsc', 'oscillator', { frequency: A4_HZ, detune: 0 }, { waveform: 'sawtooth' })
      .add('pulseOsc', 'oscillator', { frequency: A4_HZ, detune: 0 }, { waveform: 'sawtooth' })
      .add('pulseSum', 'gain', { gain: 1 }) // saw + width CV
      .add('pulseShaper', 'waveshaper', {}, { curve: 'pulse' })
      .add('subOsc', 'oscillator', { frequency: A4_HZ, detune: 0 }, { waveform: 'square' })
      .add('noise', 'noise')
      .add('mix.saw', 'gain', { gain: 0.8 })
      .add('mix.pulse', 'gain', { gain: 0 })
      .add('mix.sub', 'gain', { gain: 0.55 })
      .add('mix.noise', 'gain', { gain: 0.05 })
      .add('mix', 'gain', { gain: 0.5 })
      // 24 dB/oct low-pass: two 12 dB stages in series. Resonance lives on the first stage.
      .add('filter1', 'filter', { frequency: 800, Q: 1, detune: 0 }, { type: 'lowpass' })
      .add('filter2', 'filter', { frequency: 800, Q: 0.707, detune: 0 }, { type: 'lowpass' })
      .add('ladder', 'ladder', { cutoff: 800, detune: 0, res: 0.2, drive: 0 })
      .add('filterClean', 'gain', { gain: 1 })
      .add('filterLadder', 'gain', { gain: 0 })
      .add('filterOut', 'gain', { gain: 1 })
      .add('keyFollow', 'gain', { gain: 0.5 }) // pitch CV scaled: 1 = cutoff tracks the keyboard 1:1
      .add('amp', 'gain', { gain: 0 }) // silent until the amp envelope opens it
      .add('accentAmp', 'gain', { gain: 1 })
      .add('level', 'gain', { gain: 0.5 })
      // drive: a dry path and a tilted, folded path, blended
      .add('driveDry', 'gain', { gain: 1 })
      .add('driveTiltLo', 'filter', { frequency: DRIVE_TILT_HZ, Q: 0.707, gain: 0, detune: 0 }, { type: 'lowshelf' })
      .add('driveTiltHi', 'filter', { frequency: DRIVE_TILT_HZ, Q: 0.707, gain: 0, detune: 0 }, { type: 'highshelf' })
      .add('driveFold', 'fold', { fold: 1, even: 0, harmonics: 48, pitch: 0 })
      .add('driveWet', 'gain', { gain: 0 })
      .add('ampEnv', 'envelope', { attack: 0.005, decay: 0.2, sustain: 0.7, release: 0.3, gate: 0 })
      .add('filterEnv', 'envelope', { attack: 0.005, decay: 0.3, sustain: 0.3, release: 0.3, gate: 0 })
      .add('filterEnvDepth', 'gain', { gain: 2 * CENTS_PER_OCTAVE }) // envelope 0..1 -> cents
      // LFO: a triangle/square oscillator or a sample-and-hold source, selected by two gains.
      .add('lfoOsc', 'oscillator', { frequency: LFO_DEFAULT_HZ, detune: 0 }, { waveform: 'triangle' })
      .add('lfoRnd', 'random', { rate: LFO_DEFAULT_HZ })
      .add('lfoOscOut', 'gain', { gain: 1 })
      .add('lfoRndOut', 'gain', { gain: 0 })
      .add('lfo', 'gain', { gain: 1 })
      .add('lfoPitch', 'gain', { gain: 0 }) // cents
      .add('lfoPw', 'gain', { gain: 0 }) // pulse width offset
      .add('envPw', 'gain', { gain: 0 }) // pulse width offset, driven by the filter envelope
      .add('lfoFilter', 'gain', { gain: 0 }); // cents

    for (const osc of ['sawOsc', 'pulseOsc', 'subOsc']) {
      c.connect('pitch', osc, 'detune').connect('range', osc, 'detune').connect('bend', osc, 'detune');
    }
    c.connect('subShift', 'subOsc', 'detune')
      .connect('pulseOsc', 'pulseSum')
      .connect('pulseWidthCv', 'pulseSum')
      .connect('pulseSum', 'pulseShaper')
      .connect('sawOsc', 'mix.saw')
      .connect('pulseShaper', 'mix.pulse')
      .connect('subOsc', 'mix.sub')
      .connect('noise', 'mix.noise');
    for (const src of ['mix.saw', 'mix.pulse', 'mix.sub', 'mix.noise']) c.connect(src, 'mix');
    c.connect('mix', 'filter1')
      .connect('filter1', 'filter2')
      .connect('filter2', 'filterClean')
      .connect('mix', 'ladder')
      .connect('ladder', 'filterLadder')
      .connect('filterClean', 'filterOut')
      .connect('filterLadder', 'filterOut')
      .connect('filterOut', 'driveDry')
      .connect('filterOut', 'driveTiltLo')
      .connect('driveTiltLo', 'driveTiltHi')
      .connect('driveTiltHi', 'driveFold')
      .connect('driveFold', 'driveWet')
      // the folder hears the played pitch (the oscillators' pitch CVs, in cents from A4) to keep N harmonics of it
      .connect('pitch', 'driveFold', 'pitch')
      .connect('range', 'driveFold', 'pitch')
      .connect('bend', 'driveFold', 'pitch')
      .connect('driveDry', 'amp')
      .connect('driveWet', 'amp')
      .connect('amp', 'accentAmp')
      .connect('accentAmp', 'level')
      .connect('ampEnv', 'amp', 'gain')
      .connect('filterEnv', 'filterEnvDepth')
      .connect('pitch', 'keyFollow');
    for (const f of ['filter1', 'filter2', 'ladder']) {
      c.connect('filterEnvDepth', f, 'detune')
        .connect('keyFollow', f, 'detune')
        .connect('lfoFilter', f, 'detune');
    }
    for (const osc of ['sawOsc', 'pulseOsc', 'subOsc']) c.connect('lfoPitch', osc, 'detune');
    c.connect('lfoOsc', 'lfoOscOut')
      .connect('lfoRnd', 'lfoRndOut')
      .connect('lfoOscOut', 'lfo')
      .connect('lfoRndOut', 'lfo')
      .connect('lfo', 'lfoPitch')
      .connect('lfo', 'lfoPw')
      .connect('lfo', 'lfoFilter')
      .connect('lfoPw', 'pulseSum')
      .connect('filterEnv', 'envPw')
      .connect('envPw', 'pulseSum');
    this.outputList.push({ name: 'out', nodeId: 'level' });

    this.controlList.push(
      new ChoiceControl('osc.range', 'Range', Object.keys(RANGES), "8'", (v) =>
        c.setParam('range', 'offset', RANGES[v as keyof typeof RANGES])),
      new NumberControl('osc.width', 'Width', 5, 50, 50, '%', (v) =>
        // 50% -> offset 0 (square); narrower pulses shift the saw further from zero.
        c.setParam('pulseWidthCv', 'offset', 1 - (2 * v) / 100)),
      new ChoiceControl('osc.sub', 'Sub', Object.keys(SUB_MODES), '-1', (v) =>
        c.setParam('subShift', 'offset', SUB_MODES[v as keyof typeof SUB_MODES])),
      mixLevel(c, 'saw', 'Saw', 0.8),
      mixLevel(c, 'pulse', 'Pulse', 0),
      mixLevel(c, 'sub', 'Sub', 0.55),
      mixLevel(c, 'noise', 'Noise', 0.05),
      new NumberControl('filter.cutoff', 'Cutoff', 20, 20000, 800, 'Hz', (v) => {
        c.setParam('filter1', 'frequency', v);
        c.setParam('filter2', 'frequency', v);
        c.setParam('ladder', 'cutoff', v);
      }, 'log'),
      new NumberControl('filter.resonance', 'Resonance', 0.1, 20, 1, '', (v) => {
        c.setParam('filter1', 'Q', v);
        c.setParam('ladder', 'res', Math.sqrt((v - 0.1) / 19.9)); // the same knob, mapped onto the ladder's feedback
      }),
      new ChoiceControl('filter.model', 'Filter', ['clean', 'ladder'], 'clean', (v) => {
        c.setParam('filterClean', 'gain', v === 'clean' ? 1 : 0);
        c.setParam('filterLadder', 'gain', v === 'ladder' ? LADDER_GAIN : 0);
      }),
      new NumberControl('filter.drive', 'Filter drive', 0, 1, 0, '', (v) => c.setParam('ladder', 'drive', v)),
      new NumberControl('filter.keyFollow', 'Key', 0, 100, 50, '%', (v) => c.setParam('keyFollow', 'gain', v / 100)),
      new NumberControl('perf.glide', 'Glide', 0, 3, 0, 's', (v) => {
        this.glideSeconds = v;
        c.setParam('pitch', 'glide', v);
      }),
      new ChoiceControl('perf.notes', 'Notes', NOTE_MODES, 'legato', (v) => {
        this.retrigger = v === 'retrig';
      }),
      new ChoiceControl('lfo.wave', 'Wave', LFO_WAVES, 'tri', (v) => {
        c.setOption('lfoOsc', 'waveform', v === 'sqr' ? 'square' : 'triangle');
        c.setParam('lfoOscOut', 'gain', v === 'rnd' ? 0 : 1);
        c.setParam('lfoRndOut', 'gain', v === 'rnd' ? 1 : 0);
      }),
      new NumberControl('lfo.rate', 'Rate', 0.1, 30, LFO_DEFAULT_HZ, 'Hz', (v) => {
        c.setParam('lfoOsc', 'frequency', v);
        c.setParam('lfoRnd', 'rate', v);
      }, 'log'),
      new NumberControl('osc.mod', 'Mod', 0, 600, 0, 'ct', (v) => {
        this.oscModCents = v;
        this.applyVibrato();
      }),
      new ChoiceControl('osc.pwSource', 'PW src', PW_SOURCES, 'man', (v) => {
        this.pwSource = v as (typeof PW_SOURCES)[number];
        this.applyPwm();
      }),
      new NumberControl('osc.pwm', 'PWM', 0, 100, 0, '%', (v) => {
        this.pwmAmount = v / 100;
        this.applyPwm();
      }),
      new NumberControl('filter.lfo', 'LFO', 0, 4, 0, 'oct', (v) => c.setParam('lfoFilter', 'gain', v * CENTS_PER_OCTAVE)),
      new NumberControl('level', 'Level', 0, 1, 0.5, '', (v) => c.setParam('level', 'gain', v)),
      new NumberControl('filterEnv.amount', 'Amount', 0, 6, 2, 'oct', (v) => {
        this.envAmount = v;
        this.applyAccent();
      }),
      ...adsr(c, 'filterEnv', { attack: 0.005, decay: 0.3, sustain: 0.3, release: 0.3 }, (v) => {
        this.envDecay = v;
        this.applyAccent();
      }),
      new NumberControl('accent', 'Accent', 0, 1, 0, '', (v) => {
        this.accentAmount = v;
        this.applyAccent();
      }),
      new NumberControl('drive', 'Drive', 0, 1, 0, '', (v) => {
        // the folded path comes in over the first third (the dry stays under it at 35 %); the folding keeps deepening
        const wet = Math.min(1, v * 3);
        c.setParam('driveDry', 'gain', 1 - wet * 0.65);
        c.setParam('driveFold', 'fold', 0.8 + v * 9);
        c.setParam('driveWet', 'gain', wet * 0.55);
      }),
      new NumberControl('drive.even', 'Even', 0, 1, 0, '', (v) => c.setParam('driveFold', 'even', v)),
      new NumberControl('drive.harmonics', 'Harmonics', 4, 128, 48, '', (v) => c.setParam('driveFold', 'harmonics', v), 'log'),
      new NumberControl('drive.tilt', 'Tilt', -12, 12, 0, 'dB', (v) => {
        c.setParam('driveTiltLo', 'gain', -v);
        c.setParam('driveTiltHi', 'gain', v);
      }),
      ...adsr(c, 'ampEnv', { attack: 0.005, decay: 0.2, sustain: 0.7, release: 0.3 }),
    );
  }

  /** Pitch wheel position, -1..1 (full travel is +/- 2 semitones). */
  get pitchBend(): number {
    return this.bend;
  }

  setPitchBend(value: number): void {
    this.bend = Math.min(1, Math.max(-1, value));
    this.circuit.setParam('bend', 'offset', this.bend * BEND_RANGE_CENTS);
    this.notifyPerformance();
  }

  /** Mod wheel position, 0..1: adds LFO vibrato depth on top of the panel's Mod fader. */
  get modWheel(): number {
    return this.modWheelValue;
  }

  setModWheel(value: number): void {
    this.modWheelValue = Math.min(1, Math.max(0, value));
    this.applyVibrato();
    this.notifyPerformance();
  }

  /** Fires when the wheels move from anywhere (on-screen or MIDI), so the panel can follow. */
  onPerformanceChange(fn: () => void): () => void {
    this.performanceListeners.add(fn);
    return () => this.performanceListeners.delete(fn);
  }

  /** MIDI notes currently held, oldest first; fires on every key down and up. */
  get heldNotes(): readonly number[] {
    return this.held;
  }

  onNoteChange(fn: () => void): () => void {
    this.noteListeners.add(fn);
    return () => this.noteListeners.delete(fn);
  }

  private applyVibrato(): void {
    this.circuit.setParam('lfoPitch', 'gain', this.oscModCents + this.modWheelValue * MOD_WHEEL_CENTS);
  }

  private notifyPerformance(): void {
    for (const l of this.performanceListeners) l();
  }

  private notifyNotes(): void {
    for (const l of this.noteListeners) l();
  }

  /** Loads a patch: every control is reset to INIT, then the patch's values are applied on top. */
  loadPreset(preset: SynthPreset): void {
    const values = { ...INIT, ...preset.values };
    this.currentPreset = preset;
    for (const [id, value] of Object.entries(values)) {
      const c = this.control(id);
      if (c.kind === 'number' && typeof value === 'number') c.set(value);
      else if (c.kind === 'choice' && typeof value === 'string') c.set(value);
      else throw new Error(`Preset "${preset.name}": bad value for ${id}`);
    }
    for (const l of this.presetListeners) l();
  }

  onPresetChange(fn: () => void): () => void {
    this.presetListeners.add(fn);
    return () => this.presetListeners.delete(fn);
  }

  /**
   * Key down for a MIDI note number. Mono with last-note priority: the newest held note plays, and
   * releasing it falls back to the previous one still held (overlapping, so legato rules apply).
   * A velocity of ACCENT_VELOCITY or more accents the note (by the Accent amount).
   */
  keyDown(note: number, velocity = 100): void {
    this.held = this.held.filter((n) => n !== note);
    this.held.push(note);
    this.accented = velocity >= ACCENT_VELOCITY;
    this.applyAccent();
    this.noteOn(midiToHz(note));
    this.notifyNotes();
  }

  keyUp(note: number): void {
    this.held = this.held.filter((n) => n !== note);
    const previous = this.held[this.held.length - 1];
    if (previous === undefined) this.noteOff();
    else this.noteOn(midiToHz(previous));
    this.notifyNotes();
  }

  /** Reacts to a MIDI message: notes, pitch bend, mod wheel (CC 1), mapped CCs and program changes on this synth's channel. */
  handleMidi(event: MidiEvent): void {
    if ('channel' in event && !this.transport.acceptsChannel(event.channel)) return;
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
      case 'cc': {
        if (event.controller === MOD_WHEEL_CC) {
          this.setModWheel(event.value / 127);
          break;
        }
        const id = this.ccMap.get(event.controller);
        if (id) applyCcValue(this.control(id), event.value);
        break;
      }
      case 'programChange': {
        const preset = SYNTH_PRESETS[event.program];
        if (preset) this.loadPreset(preset);
        break;
      }
    }
  }

  /** Sets the accent's three effects for the note about to play: level, filter envelope depth and its decay. */
  private applyAccent(): void {
    const a = this.accented ? this.accentAmount : 0;
    const c = this.circuit;
    c.setParam('accentAmp', 'gain', 1 + a * ACCENT_AMP);
    c.setParam('filterEnvDepth', 'gain', this.envAmount * (1 + a * ACCENT_ENV) * CENTS_PER_OCTAVE);
    c.setParam('filterEnv', 'decay', a > 0 ? Math.min(this.envDecay, ACCENT_DECAY + (1 - a) * this.envDecay) : this.envDecay);
  }

  /** Pulse width follows the chosen source: manual width only, or width modulated by the LFO / filter envelope. */
  private applyPwm(): void {
    const depth = this.pwmAmount * 0.9; // keep clear of fully closed (0% / 100%) pulses
    this.circuit.setParam('lfoPw', 'gain', this.pwSource === 'lfo' ? depth : 0);
    this.circuit.setParam('envPw', 'gain', this.pwSource === 'env' ? depth : 0);
  }

  /**
   * Plays a note. A note that starts while another is still held is "overlapping": the pitch
   * glides to it, and in legato mode the envelopes are not retriggered. A note from silence
   * always jumps straight to pitch.
   */
  noteOn(hz: number): void {
    const overlapping = this.gateOpen;
    const glide = this.glideSeconds;
    if (!overlapping) this.circuit.setParam('pitch', 'glide', 0);
    this.circuit.setParam('pitch', 'offset', CENTS_PER_OCTAVE * Math.log2(hz / A4_HZ));
    if (!overlapping) this.circuit.setParam('pitch', 'glide', glide);

    if (!overlapping || this.retrigger) {
      this.circuit.setParam('ampEnv', 'gate', 1);
      this.circuit.setParam('filterEnv', 'gate', 1);
    }
    this.gateOpen = true;
  }

  noteOff(): void {
    this.circuit.setParam('ampEnv', 'gate', 0);
    this.circuit.setParam('filterEnv', 'gate', 0);
    this.gateOpen = false;
  }
}

function adsr(
  c: Circuit,
  node: string,
  d: { attack: number; decay: number; sustain: number; release: number },
  /** Takes over the decay (the filter envelope's, which the accent shortens). */
  onDecay?: (v: number) => void,
): NumberControl[] {
  const time = (id: 'attack' | 'decay' | 'release', label: string, min: number, max: number) =>
    new NumberControl(`${node}.${id}`, label, min, max, d[id], 's', (v) => c.setParam(node, id, v), 'log');
  return [
    time('attack', 'Attack', 0.001, 5),
    onDecay ? new NumberControl(`${node}.decay`, 'Decay', 0.005, 5, d.decay, 's', onDecay, 'log') : time('decay', 'Decay', 0.005, 5),
    new NumberControl(`${node}.sustain`, 'Sustain', 0, 1, d.sustain, '', (v) => c.setParam(node, 'sustain', v)),
    time('release', 'Release', 0.005, 10),
  ];
}

function mixLevel(c: Circuit, name: string, label: string, initial: number): NumberControl {
  return new NumberControl(`mix.${name}`, label, 0, 1, initial, '', (v) => c.setParam(`mix.${name}`, 'gain', v));
}

export const midiToHz = (note: number): number => A4_HZ * Math.pow(2, (note - 69) / 12);

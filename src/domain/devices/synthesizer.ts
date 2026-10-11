import { Device } from './device';
import { ChoiceControl, NumberControl } from './controls';
import type { Circuit } from '../circuit/circuit';
import { INIT, SYNTH_PRESETS, type SynthPreset } from './synthPresets';
import { Transport } from './transport';
import { MidiClock } from '../midi/clock';
import { applyCcValue, DEFAULT_CC_MAP } from '../midi/ccMap';
import type { MidiEvent } from '../midi/events';

const CENTS_PER_OCTAVE = 1200;

const A4_HZ = 440;
const LFO_DEFAULT_HZ = 4.8;
const PW_SOURCES = ['man', 'lfo', 'env'] as const;
const NOTE_MODES = ['legato', 'retrig'] as const;
const LFO_WAVES = ['tri', 'sqr', 'rnd'] as const;
const RANGES = { "16'": -1200, "8'": 0, "4'": 1200, "2'": 2400 } as const;
const SUB_MODES = { '-1': -1200, '-2': -2400 } as const;

/**
 * SH-101 style monophonic synth:
 *   saw + pulse + sub + noise -> source mix -> filter -> amp (VCA) -> level
 * Pitch is a CV in cents: a hidden `pitch` signal (the played note) and `range` (octave switch)
 * are both summed into every oscillator's detune, so the sub tracks the keyboard for free.
 * ampEnv drives the VCA, filterEnv sweeps the filter cutoff (and the keyboard follows it via keyFollow).
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

  constructor(name = 'Synth', clock = new MidiClock()) {
    super();
    this.name = name;
    this.transport = new Transport(clock);
    const c = this.circuit;
    c.add('pitch', 'constant', { offset: 0, glide: 0 })
      .add('range', 'constant', { offset: 0 })
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
      .add('keyFollow', 'gain', { gain: 0.5 }) // pitch CV scaled: 1 = cutoff tracks the keyboard 1:1
      .add('amp', 'gain', { gain: 0 }) // silent until the amp envelope opens it
      .add('level', 'gain', { gain: 0.5 })
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
      c.connect('pitch', osc, 'detune').connect('range', osc, 'detune');
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
      .connect('filter2', 'amp')
      .connect('amp', 'level')
      .connect('ampEnv', 'amp', 'gain')
      .connect('filterEnv', 'filterEnvDepth')
      .connect('pitch', 'keyFollow');
    for (const f of ['filter1', 'filter2']) {
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
      }, 'log'),
      new NumberControl('filter.resonance', 'Resonance', 0.1, 20, 1, '', (v) => c.setParam('filter1', 'Q', v)),
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
      new NumberControl('osc.mod', 'Mod', 0, 600, 0, 'ct', (v) => c.setParam('lfoPitch', 'gain', v)),
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
      new NumberControl('filterEnv.amount', 'Amount', 0, 6, 2, 'oct', (v) =>
        c.setParam('filterEnvDepth', 'gain', v * CENTS_PER_OCTAVE)),
      ...adsr(c, 'filterEnv', { attack: 0.005, decay: 0.3, sustain: 0.3, release: 0.3 }),
      ...adsr(c, 'ampEnv', { attack: 0.005, decay: 0.2, sustain: 0.7, release: 0.3 }),
    );
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
   */
  keyDown(note: number): void {
    this.held = this.held.filter((n) => n !== note);
    this.held.push(note);
    this.noteOn(midiToHz(note));
  }

  keyUp(note: number): void {
    this.held = this.held.filter((n) => n !== note);
    const previous = this.held[this.held.length - 1];
    if (previous === undefined) this.noteOff();
    else this.noteOn(midiToHz(previous));
  }

  /** Reacts to a MIDI message: notes, mapped CCs and program changes on this synth's channel. */
  handleMidi(event: MidiEvent): void {
    if ('channel' in event && !this.transport.acceptsChannel(event.channel)) return;
    switch (event.type) {
      case 'noteOn':
        this.keyDown(event.note);
        break;
      case 'noteOff':
        this.keyUp(event.note);
        break;
      case 'cc': {
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
): NumberControl[] {
  const time = (id: 'attack' | 'decay' | 'release', label: string, min: number, max: number) =>
    new NumberControl(`${node}.${id}`, label, min, max, d[id], 's', (v) => c.setParam(node, id, v), 'log');
  return [
    time('attack', 'Attack', 0.001, 5),
    time('decay', 'Decay', 0.005, 5),
    new NumberControl(`${node}.sustain`, 'Sustain', 0, 1, d.sustain, '', (v) => c.setParam(node, 'sustain', v)),
    time('release', 'Release', 0.005, 10),
  ];
}

function mixLevel(c: Circuit, name: string, label: string, initial: number): NumberControl {
  return new NumberControl(`mix.${name}`, label, 0, 1, initial, '', (v) => c.setParam(`mix.${name}`, 'gain', v));
}

export const midiToHz = (note: number): number => A4_HZ * Math.pow(2, (note - 69) / 12);

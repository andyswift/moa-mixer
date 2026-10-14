import type { Circuit } from '../circuit/circuit';
import { Device } from './device';
import { ChoiceControl, NumberControl, ToggleControl } from './controls';
import { LYNCH_BANKS, LYNCH_GROUPS, LYNCH_INIT, LYNCH_NOT_IN_PATCH, LYNCH_PATCHES, LYNCH_PRESETS, slotIndex } from './lynchPresets';
import type { Playable } from './playable';
import type { PresetValues, SynthPreset } from './synthPresets';
import { Transport } from './transport';
import { VoiceAllocator, type VoiceAction } from './voiceAllocator';
import { MidiClock } from '../midi/clock';
import type { MidiEvent } from '../midi/events';

export const LYNCH_VOICES = 6;
export const ASSIGN_MODES = ['poly1', 'poly2', 'unison'] as const;
export const DCO_RANGES = ['16', '8', '4'] as const;
export const HPF_POSITIONS = ['0', '1', '2', '3'] as const;
export const TRANSPOSE_OCTAVES = ['-2', '-1', '0', '1', '2'] as const;

const CENTS_PER_OCTAVE = 1200;
const A4_NOTE = 69;
const MOD_WHEEL_CC = 1;
const SUSTAIN_CC = 64;
const PULSE_LEVEL = 0.65; // a pulse is louder than a saw at the same peak
const UNISON_DETUNE = 12;
/** Voice output level per mode, so a chord and a unison stack sit at similar loudness. */
const VOICE_LEVEL = { poly: 0.4, unison: 0.3 } as const;
/** Cutoff of the high-pass filter at each of its four positions; position 0 is a bass boost instead. */
const HPF_HZ = [10, 10, 240, 720] as const;
const RANGE_CENTS = { '16': -CENTS_PER_OCTAVE, '8': 0, '4': CENTS_PER_OCTAVE } as const;
/** The chorus: slow and wide for I, a little faster for II, fast and shallow for both. */
const CHORUS = { i: { rate: 0.5, depth: 0.0013 }, ii: { rate: 0.83, depth: 0.0013 }, both: { rate: 9, depth: 0.00025 } } as const;

/**
 * Lynch 106: a six-voice polyphonic synth in the mould of a classic one-oscillator analogue polysynth, with a
 * chorus, a high-pass filter and 128 patch memories.
 *   per voice:  saw + pulse (PWM) + sub + noise -> bass boost / high-pass -> 24 dB low-pass -> VCA (envelope or gate)
 *   shared:     triangle LFO with delay, bender (pitch and filter), tuning, portamento
 *   output:     6 voices -> chorus (I, II or both, stereo) -> level -> volume -> limiter
 * One ADSR shapes the filter and, in ENV mode, the VCA. As on the original there is no velocity.
 *
 * The panel has two states. In manual state the sliders are the sound; selecting a patch loads it over them (the
 * manual settings are kept) and the Manual key brings the manual sound back. Write stores the sound in a slot.
 */
export class LynchSynth extends Device implements Playable {
  readonly name: string;
  readonly transport: Transport;
  /** The 128 patch slots: group A or B, 8 banks of 8. Factory patches, overwritten by saves. */
  readonly slots: SynthPreset[] = [...LYNCH_PRESETS];
  currentSlot = 0;
  currentPreset: SynthPreset = this.slots[0]!;
  /** Group (0 = A, 1 = B) and bank (1-8) chosen with the keys; a patch key loads a slot from them. */
  group = 0;
  bank = 1;
  private manualState = true;
  private manualSnapshot: PresetValues | undefined;
  private readonly allocator = new VoiceAllocator(LYNCH_VOICES);
  private held: number[] = [];
  private readonly sounding = new Map<number, number>(); // key as played -> note that started (transpose may change)
  private latched = new Set<number>(); // notes kept sounding by hold or the pedal after the key came up
  private pedal = false;
  private bend = 0;
  private modWheelValue = 0;
  private portamento = 0;
  private bendSemitones = 2;
  private bendFilter = 0.2;
  private lfoSensitivity = 0.3;
  private lfoDepthCents = 0;
  private pwmSource: 'man' | 'lfo' = 'man';
  private pwm = 0.5;
  private envDepth = 0.4;
  private envSign = 1;
  private lfoTrig = false;
  private chorusI = false;
  private chorusII = false;
  private readonly noteListeners = new Set<() => void>();
  private readonly performanceListeners = new Set<() => void>();
  private readonly presetListeners = new Set<() => void>();

  constructor(name = 'Lynch', clock = new MidiClock()) {
    super();
    this.name = name;
    this.transport = new Transport(clock);
    this.transport.channel.set('omni');
    const c = this.circuit;

    this.addShared(c);
    for (let i = 0; i < LYNCH_VOICES; i++) this.addVoice(c, i);
    this.addOutput(c);
    this.outputList.push({ name: 'out', nodeId: 'out' });
    this.meterList.push({ name: 'out.L', nodeId: 'meterL' }, { name: 'out.R', nodeId: 'meterR' });
    this.addControls(c);
  }

  // ---- Playing ----

  keyDown(note: number): void {
    const octave = Number((this.control('key.transpose') as ChoiceControl).value);
    const sounded = note + octave * 12;
    this.held = this.held.filter((n) => n !== note);
    this.held.push(note);
    this.latched.delete(note);
    this.sounding.set(note, sounded);
    this.apply(this.allocator.noteOn(sounded));
    this.updateLfoGate();
    this.notifyNotes();
  }

  keyUp(note: number): void {
    const sounded = this.sounding.get(note);
    if (sounded === undefined) return;
    if (this.holding) {
      this.latched.add(note); // the key is up but the note keeps sounding
      return;
    }
    this.release(note, sounded);
  }

  private release(note: number, sounded: number): void {
    this.sounding.delete(note);
    this.latched.delete(note);
    this.held = this.held.filter((n) => n !== note);
    this.apply(this.allocator.noteOff(sounded));
    this.updateLfoGate();
    this.notifyNotes();
  }

  /** Hold or the sustain pedal is down: released keys keep sounding. */
  private get holding(): boolean {
    return this.pedal || (this.control('key.hold') as ToggleControl).value;
  }

  /** Lets go of every note that was only being kept alive by hold or the pedal. */
  private releaseLatched(): void {
    for (const note of [...this.latched]) {
      const sounded = this.sounding.get(note);
      if (sounded !== undefined) this.release(note, sounded);
    }
  }

  private releaseAll(): void {
    this.apply(this.allocator.releaseAll());
    this.held = [];
    this.sounding.clear();
    this.latched.clear();
    this.updateLfoGate();
    this.notifyNotes();
  }

  get heldNotes(): readonly number[] {
    return this.held;
  }

  onNoteChange(fn: () => void): () => void {
    this.noteListeners.add(fn);
    return () => this.noteListeners.delete(fn);
  }

  /** Is voice `index` (0-5) playing a held key right now? Drives the voice LEDs. */
  voiceActive(index: number): boolean {
    return this.allocator.isActive(index);
  }

  get pitchBend(): number {
    return this.bend;
  }

  /** The bender's left and right: pitch by the DCO sensitivity, the filter by the VCF sensitivity. */
  setPitchBend(value: number): void {
    this.bend = Math.min(1, Math.max(-1, value));
    this.circuit.setParam('bend', 'offset', this.bend * this.bendSemitones * 100);
    this.circuit.setParam('bendVcf', 'offset', this.bend * this.bendFilter * 2400);
    this.notifyPerformance();
  }

  get modWheel(): number {
    return this.modWheelValue;
  }

  /** The bender pushed forward (or the mod wheel): LFO vibrato by the LFO sensitivity. */
  setModWheel(value: number): void {
    this.modWheelValue = Math.min(1, Math.max(0, value));
    this.circuit.setParam('lfoPitchMod', 'gain', this.modWheelValue * this.lfoSensitivity * 200);
    this.updateLfoGate();
    this.notifyPerformance();
  }

  onPerformanceChange(fn: () => void): () => void {
    this.performanceListeners.add(fn);
    return () => this.performanceListeners.delete(fn);
  }

  /** The LFO delay restarts with the first key, or, with LFO TRIG on, when the lever is pushed forward. */
  private updateLfoGate(): void {
    const on = this.lfoTrig ? this.modWheelValue > 0.05 : this.held.length > 0;
    this.circuit.setParam('lfoFade', 'gate', on ? 1 : 0);
  }

  /** Reacts to MIDI on the chosen channel: notes, pitch bend, mod wheel, sustain pedal, program change, clock. */
  handleMidi(event: MidiEvent): void {
    if (event.type === 'clock') return;
    if (!('channel' in event) || !this.transport.acceptsChannel(event.channel)) return;
    switch (event.type) {
      case 'noteOn':
        this.keyDown(event.note);
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
          if (!this.pedal) this.releaseLatched();
        }
        break;
      case 'programChange':
        if (event.program < this.slots.length) this.loadSlot(event.program);
        break;
    }
  }

  // ---- Patch memory ----

  /** True while the panel is the sound; false once a patch has been selected over it. */
  get manual(): boolean {
    return this.manualState;
  }

  /** The bank and patch numbers of the loaded slot, 1-8 each. */
  get patchNumber(): { group: number; bank: number; patch: number } {
    const within = this.currentSlot % (LYNCH_BANKS * LYNCH_PATCHES);
    return { group: Math.floor(this.currentSlot / (LYNCH_BANKS * LYNCH_PATCHES)), bank: Math.floor(within / LYNCH_PATCHES) + 1, patch: (within % LYNCH_PATCHES) + 1 };
  }

  selectGroup(group: number): void {
    this.group = Math.min(LYNCH_GROUPS.length - 1, Math.max(0, group));
    this.notifyPreset();
  }

  selectBank(bank: number): void {
    this.bank = Math.min(LYNCH_BANKS, Math.max(1, bank));
    this.notifyPreset();
  }

  /** A patch key: loads patch `patch` (1-8) of the selected group and bank. */
  selectPatch(patch: number): void {
    this.loadSlot(slotIndex(this.group, this.bank, patch));
  }

  /** Loads a slot (0-127). The manual sound is remembered so the Manual key can bring it back. */
  loadSlot(index: number): void {
    const preset = this.slots[index];
    if (!preset) throw new Error(`No patch slot ${index}`);
    if (this.manualState) this.manualSnapshot = this.snapshot();
    this.manualState = false;
    this.currentSlot = index;
    const { group, bank } = this.patchNumber;
    this.group = group;
    this.bank = bank;
    this.loadPreset(preset);
  }

  /** The Manual key: the panel's own settings are the sound again. */
  selectManual(): void {
    if (this.manualState) return;
    this.manualState = true;
    if (this.manualSnapshot) this.applyValues(this.manualSnapshot);
    this.notifyPreset();
  }

  loadPreset(preset: SynthPreset): void {
    this.currentPreset = preset;
    this.applyValues({ ...LYNCH_INIT, ...preset.values });
    this.notifyPreset();
  }

  private applyValues(values: PresetValues): void {
    for (const [id, value] of Object.entries(values)) {
      if ((LYNCH_NOT_IN_PATCH as readonly string[]).includes(id)) continue;
      const c = this.control(id);
      if (c.kind === 'number' && typeof value === 'number') c.set(value);
      else if (c.kind === 'toggle' && typeof value === 'number') c.set(value > 0);
      else if (c.kind === 'choice' && typeof value === 'string') c.set(value);
      else throw new Error(`Patch: bad value for ${id}`);
    }
  }

  /** The current value of every sound control, in the form a patch stores. */
  snapshot(): PresetValues {
    const values: PresetValues = {};
    for (const c of this.controlList) {
      if ((LYNCH_NOT_IN_PATCH as readonly string[]).includes(c.id)) continue;
      values[c.id] = c.kind === 'toggle' ? (c.value ? 1 : 0) : c.value;
    }
    return values;
  }

  /** The Write key: stores the sound in the selected slot, keeping the slot's name. */
  write(index = slotIndex(this.group, this.bank, this.patchNumber.patch)): SynthPreset {
    const preset: SynthPreset = { name: this.slots[index]!.name, values: this.snapshot() };
    this.slots[index] = preset;
    this.currentSlot = index;
    this.currentPreset = preset;
    this.manualState = false;
    this.notifyPreset();
    return preset;
  }

  onPresetChange(fn: () => void): () => void {
    this.presetListeners.add(fn);
    return () => this.presetListeners.delete(fn);
  }

  // ---- Voice handling ----

  private apply(actions: VoiceAction[]): void {
    const c = this.circuit;
    for (const a of actions) {
      const v = (n: string) => `v${a.voice}.${n}`;
      if (a.kind === 'off') {
        c.setParam(v('env'), 'gate', 0);
        c.setParam(v('gate'), 'gate', 0);
        continue;
      }
      // With portamento on (a glide time on the pitch node) a note slides from the voice's last pitch.
      c.setParam(v('pitch'), 'offset', (a.note - A4_NOTE) * 100);
      if (a.retrigger) {
        c.setParam(v('env'), 'gate', 1);
        c.setParam(v('gate'), 'gate', 1);
      }
    }
  }

  private eachVoice(fn: (v: (name: string) => string) => void): void {
    for (let i = 0; i < LYNCH_VOICES; i++) fn((name) => `v${i}.${name}`);
  }

  private applyMode(mode: (typeof ASSIGN_MODES)[number]): void {
    this.releaseAll();
    this.allocator.mode = mode === 'unison' ? 'unison' : 'poly';
    this.allocator.prefer = mode === 'poly2' ? 'lowest' : 'oldest';
    const level = mode === 'unison' ? VOICE_LEVEL.unison : VOICE_LEVEL.poly;
    this.eachVoice((v) => this.circuit.setParam(v('out'), 'gain', level));
    // Unison spreads the voices symmetrically across +/- the detune; poly keeps them in tune.
    const spread = mode === 'unison' ? UNISON_DETUNE : 0;
    const mid = (LYNCH_VOICES - 1) / 2;
    for (let i = 0; i < LYNCH_VOICES; i++) {
      const offset = ((i - mid) / mid) * spread;
      this.circuit.setParam(`v${i}.det`, 'offset', offset === 0 ? 0 : offset); // never -0
    }
  }

  private notifyNotes(): void {
    for (const l of this.noteListeners) l();
  }

  private notifyPerformance(): void {
    for (const l of this.performanceListeners) l();
  }

  private notifyPreset(): void {
    for (const l of this.presetListeners) l();
  }

  // ---- Circuit ----

  private addShared(c: Circuit): void {
    c.add('bend', 'constant', { offset: 0 })
      .add('tune', 'constant', { offset: 0 })
      .add('rangeShift', 'constant', { offset: 0 })
      .add('subShift', 'constant', { offset: -CENTS_PER_OCTAVE })
      .add('pwCv', 'constant', { offset: 0 })
      .add('bendVcf', 'constant', { offset: 0 })
      .add('lfoOsc', 'oscillator', { frequency: 5, detune: 0 }, { waveform: 'triangle' })
      .add('lfoFade', 'envelope', { attack: 0.001, decay: 0.001, sustain: 1, release: 0.02, gate: 0 })
      .add('lfoFadeGain', 'gain', { gain: 0 })
      .add('lfo', 'gain', { gain: 1 })
      .add('lfoPitch', 'gain', { gain: 0 }) // cents, from the DCO LFO slider
      .add('lfoPitchMod', 'gain', { gain: 0 }) // cents, from the bender lever pushed forward
      .add('lfoPw', 'gain', { gain: 0 })
      .add('lfoFilter', 'gain', { gain: 0 }) // cents
      .add('noise', 'noise')
      .add('voices', 'gain', { gain: 1 })
      .connect('lfoOsc', 'lfoFadeGain')
      .connect('lfoFade', 'lfoFadeGain', 'gain') // the LFO fades in after its delay
      .connect('lfoFadeGain', 'lfo');
    for (const dest of ['lfoPitch', 'lfoPitchMod', 'lfoPw', 'lfoFilter']) c.connect('lfo', dest);
  }

  private addVoice(c: Circuit, i: number): void {
    const v = (n: string) => `v${i}.${n}`;
    c.add(v('pitch'), 'constant', { offset: 0, glide: 0 })
      .add(v('det'), 'constant', { offset: 0 })
      .add(v('osc'), 'oscillator', { frequency: 440, detune: 0 }, { waveform: 'sawtooth' })
      .add(v('sub'), 'oscillator', { frequency: 440, detune: 0 }, { waveform: 'square' })
      .add(v('rawOut'), 'gain', { gain: 1 })
      .add(v('pulseSum'), 'gain', { gain: 1 }) // saw + width CV + LFO, then hard-clipped into a pulse
      .add(v('shaper'), 'waveshaper', {}, { curve: 'pulse' })
      .add(v('pulseOut'), 'gain', { gain: PULSE_LEVEL })
      .add(v('subLevel'), 'gain', { gain: 0 })
      .add(v('noiseLevel'), 'gain', { gain: 0 })
      .add(v('mix'), 'gain', { gain: 0.5 })
      .add(v('boost'), 'filter', { frequency: 120, Q: 0.707, gain: 0, detune: 0 }, { type: 'lowshelf' })
      .add(v('hpf'), 'filter', { frequency: 10, Q: 0.707, gain: 0, detune: 0 }, { type: 'highpass' })
      .add(v('f1'), 'filter', { frequency: 3000, Q: 1, detune: 0 }, { type: 'lowpass' })
      .add(v('f2'), 'filter', { frequency: 3000, Q: 0.707, detune: 0 }, { type: 'lowpass' })
      .add(v('keyFollow'), 'gain', { gain: 0.5 })
      .add(v('env'), 'envelope', { attack: 0.005, decay: 0.4, sustain: 0.6, release: 0.3, gate: 0 })
      .add(v('envDepth'), 'gain', { gain: 0.4 * 6 * CENTS_PER_OCTAVE })
      .add(v('gate'), 'envelope', { attack: 0.003, decay: 0.001, sustain: 1, release: 0.015, gate: 0 })
      .add(v('envAmp'), 'gain', { gain: 1 })
      .add(v('gateAmp'), 'gain', { gain: 0 })
      .add(v('amp'), 'gain', { gain: 0 })
      .add(v('out'), 'gain', { gain: VOICE_LEVEL.poly });
    for (const osc of ['osc', 'sub']) {
      for (const cv of [v('pitch'), v('det'), 'bend', 'tune', 'rangeShift', 'lfoPitch', 'lfoPitchMod']) c.connect(cv, v(osc), 'detune');
    }
    c.connect('subShift', v('sub'), 'detune')
      .connect(v('osc'), v('rawOut'))
      .connect(v('osc'), v('pulseSum'))
      .connect('pwCv', v('pulseSum'))
      .connect('lfoPw', v('pulseSum'))
      .connect(v('pulseSum'), v('shaper'))
      .connect(v('shaper'), v('pulseOut'))
      .connect(v('rawOut'), v('mix'))
      .connect(v('pulseOut'), v('mix'))
      .connect(v('sub'), v('subLevel'))
      .connect(v('subLevel'), v('mix'))
      .connect('noise', v('noiseLevel'))
      .connect(v('noiseLevel'), v('mix'))
      .connect(v('mix'), v('boost'))
      .connect(v('boost'), v('hpf'))
      .connect(v('hpf'), v('f1'))
      .connect(v('f1'), v('f2'))
      .connect(v('f2'), v('amp'))
      .connect(v('env'), v('envDepth'))
      .connect(v('pitch'), v('keyFollow'));
    for (const f of ['f1', 'f2']) {
      c.connect(v('envDepth'), v(f), 'detune')
        .connect(v('keyFollow'), v(f), 'detune')
        .connect('lfoFilter', v(f), 'detune')
        .connect('bendVcf', v(f), 'detune');
    }
    c.connect(v('env'), v('envAmp'))
      .connect(v('envAmp'), v('amp'), 'gain')
      .connect(v('gate'), v('gateAmp'))
      .connect(v('gateAmp'), v('amp'), 'gain')
      .connect(v('amp'), v('out'))
      .connect(v('out'), 'voices');
  }

  /** voices -> chorus (two delays swept in opposite directions, panned apart) -> level -> volume -> limiter. */
  private addOutput(c: Circuit): void {
    c.add('chDry', 'gain', { gain: 1 })
      .add('chLfo', 'oscillator', { frequency: 0.5, detune: 0 }, { waveform: 'triangle' })
      .add('chDelayL', 'delay', { delayTime: 0.0035, maxTime: 0.02 })
      .add('chDelayR', 'delay', { delayTime: 0.0035, maxTime: 0.02 })
      .add('chDepthL', 'gain', { gain: CHORUS.i.depth })
      .add('chDepthR', 'gain', { gain: -CHORUS.i.depth })
      .add('chToneL', 'filter', { frequency: 9000, Q: 0.707, gain: 0, detune: 0 }, { type: 'lowpass' })
      .add('chToneR', 'filter', { frequency: 9000, Q: 0.707, gain: 0, detune: 0 }, { type: 'lowpass' })
      .add('chPanL', 'pan', { pan: -1 })
      .add('chPanR', 'pan', { pan: 1 })
      .add('chWet', 'gain', { gain: 0 })
      .add('chSum', 'gain', { gain: 1 })
      .add('vcaLevel', 'gain', { gain: 0.8 })
      .add('volume', 'gain', { gain: 0.75 })
      .add('limiter', 'compressor', { threshold: -2, knee: 0, ratio: 20, attack: 0.002, release: 0.12 })
      .add('out', 'gain', { gain: 1 })
      .add('meterL', 'meter', {}, { channel: 'left' })
      .add('meterR', 'meter', {}, { channel: 'right' })
      .connect('voices', 'chDry')
      .connect('chDry', 'chSum')
      .connect('voices', 'chDelayL')
      .connect('voices', 'chDelayR')
      .connect('chDelayL', 'chToneL')
      .connect('chDelayR', 'chToneR')
      .connect('chToneL', 'chPanL')
      .connect('chToneR', 'chPanR')
      .connect('chPanL', 'chWet')
      .connect('chPanR', 'chWet')
      .connect('chWet', 'chSum')
      .connect('chLfo', 'chDepthL')
      .connect('chLfo', 'chDepthR')
      .connect('chDepthL', 'chDelayL', 'delayTime')
      .connect('chDepthR', 'chDelayR', 'delayTime')
      .connect('chSum', 'vcaLevel')
      .connect('vcaLevel', 'volume')
      .connect('volume', 'limiter')
      .connect('limiter', 'out')
      .connect('out', 'meterL')
      .connect('out', 'meterR');
  }

  private addControls(c: Circuit): void {
    const init = LYNCH_INIT as Record<string, number | string>;
    const n = (id: string) => init[id] as number;
    const num = (id: string, label: string, min: number, max: number, unit: string,
      apply: (v: number) => void, curve?: 'linear' | 'log') =>
      this.controlList.push(new NumberControl(id, label, min, max, n(id), unit, apply, curve));
    const voices = (fn: (v: (name: string) => string, value: number) => void) => (value: number) =>
      this.eachVoice((v) => fn(v, value));
    const toggle = (id: string, label: string, apply: (on: boolean) => void) =>
      this.controlList.push(new ToggleControl(id, label, n(id) > 0, apply));
    const choice = (id: string, label: string, options: readonly string[], apply: (v: string) => void) =>
      this.controlList.push(new ChoiceControl(id, label, options, init[id] as string, apply));

    // LFO
    num('lfo.rate', 'Rate', 0.1, 30, 'Hz', (x) => c.setParam('lfoOsc', 'frequency', x), 'log');
    num('lfo.delay', 'Delay time', 0, 3, 's', (x) => c.setParam('lfoFade', 'attack', Math.max(0.001, x)));

    // DCO
    num('dco.lfo', 'LFO', 0, 1, '', (x) => {
      this.lfoDepthCents = x * 150;
      c.setParam('lfoPitch', 'gain', this.lfoDepthCents);
    });
    num('dco.pwm', 'PWM', 0, 1, '', (x) => {
      this.pwm = x;
      this.applyPulseWidth();
    });
    choice('dco.pwmSource', 'PWM source', ['man', 'lfo'], (s) => {
      this.pwmSource = s as 'man' | 'lfo';
      this.applyPulseWidth();
    });
    choice('dco.range', 'Range', DCO_RANGES, (r) => c.setParam('rangeShift', 'offset', RANGE_CENTS[r as keyof typeof RANGE_CENTS]));
    toggle('dco.pulse', 'Pulse', (on) => this.eachVoice((v) => c.setParam(v('pulseOut'), 'gain', on ? PULSE_LEVEL : 0)));
    toggle('dco.saw', 'Saw', (on) => this.eachVoice((v) => c.setParam(v('rawOut'), 'gain', on ? 1 : 0)));
    num('dco.sub', 'Sub', 0, 1, '', voices((v, x) => c.setParam(v('subLevel'), 'gain', x * 0.6)));
    num('dco.noise', 'Noise', 0, 1, '', voices((v, x) => c.setParam(v('noiseLevel'), 'gain', x * 0.5)));

    // HPF: four positions (0 bass boost, 1 flat, 2 and 3 progressively thinner)
    choice('hpf.freq', 'HPF', HPF_POSITIONS, (pos) => {
      const i = Number(pos);
      this.eachVoice((v) => {
        c.setParam(v('boost'), 'gain', i === 0 ? 6 : 0);
        c.setParam(v('hpf'), 'frequency', HPF_HZ[i]!);
      });
    });

    // VCF
    num('vcf.freq', 'Freq', 20, 20000, 'Hz', voices((v, x) => {
      c.setParam(v('f1'), 'frequency', x);
      c.setParam(v('f2'), 'frequency', x);
    }), 'log');
    num('vcf.res', 'Res', 0, 1, '', voices((v, x) => c.setParam(v('f1'), 'Q', 0.5 * Math.pow(32, x))));
    num('vcf.env', 'Env', 0, 1, '', (x) => {
      this.envDepth = x;
      this.applyEnvDepth();
    });
    choice('vcf.polarity', 'Env polarity', ['plus', 'minus'], (p) => {
      this.envSign = p === 'minus' ? -1 : 1;
      this.applyEnvDepth();
    });
    num('vcf.lfo', 'LFO', 0, 1, '', (x) => c.setParam('lfoFilter', 'gain', x * 3 * CENTS_PER_OCTAVE));
    num('vcf.kybd', 'Kybd', 0, 1, '', voices((v, x) => c.setParam(v('keyFollow'), 'gain', x)));

    // VCA
    choice('vca.mode', 'VCA', ['env', 'gate'], (m) =>
      this.eachVoice((v) => {
        c.setParam(v('envAmp'), 'gain', m === 'env' ? 1 : 0);
        c.setParam(v('gateAmp'), 'gain', m === 'gate' ? 1 : 0);
      }));
    num('vca.level', 'Level', 0, 1, '', (x) => c.setParam('vcaLevel', 'gain', x));

    // ENV: one ADSR for the filter and (in ENV mode) the amplifier
    const time = (id: 'attack' | 'decay' | 'release', label: string, min: number, max: number) =>
      num(`env.${id}`, label, min, max, 's', voices((v, x) => c.setParam(v('env'), id, x)), 'log');
    time('attack', 'A', 0.001, 3);
    time('decay', 'D', 0.002, 12);
    num('env.sustain', 'S', 0, 1, '', voices((v, x) => c.setParam(v('env'), 'sustain', x)));
    time('release', 'R', 0.002, 12);

    // Chorus: I and II are independent keys; both down is the fast, shallow third setting; none is off.
    toggle('chorus.i', 'Chorus I', (on) => {
      this.chorusI = on;
      this.applyChorus();
    });
    toggle('chorus.ii', 'Chorus II', (on) => {
      this.chorusII = on;
      this.applyChorus();
    });

    // Bender sensitivities and LFO TRIG
    num('bend.dco', 'Bender DCO', 0, 12, 'st', (x) => {
      this.bendSemitones = x;
      this.setPitchBend(this.bend);
    });
    num('bend.vcf', 'Bender VCF', 0, 1, '', (x) => {
      this.bendFilter = x;
      this.setPitchBend(this.bend);
    });
    num('bend.lfo', 'Bender LFO', 0, 1, '', (x) => {
      this.lfoSensitivity = x;
      this.setModWheel(this.modWheelValue);
    });
    toggle('bend.lfoTrig', 'LFO trig', (on) => {
      this.lfoTrig = on;
      this.updateLfoGate();
    });

    // Performance: portamento and assign mode are part of a patch; volume, tuning, hold and transpose are not.
    num('master.portamento', 'Portamento', 0, 1, '', (x) => {
      this.portamento = x;
      const time = x * x * 2.5; // 0 = off; a gentle curve to 2.5 s
      this.eachVoice((v) => c.setParam(v('pitch'), 'glide', time));
    });
    choice('assign.mode', 'Assign', ASSIGN_MODES, (m) => this.applyMode(m as (typeof ASSIGN_MODES)[number]));
    num('master.tune', 'Tune', -50, 50, 'ct', (x) => c.setParam('tune', 'offset', x));
    num('master.volume', 'Volume', 0, 1, '', (x) => c.setParam('volume', 'gain', x));
    toggle('key.hold', 'Hold', (on) => {
      if (!on) this.releaseLatched();
    });
    choice('key.transpose', 'Key transpose', TRANSPOSE_OCTAVES, () => {});
  }

  /** The PWM slider is the pulse width itself in manual, or the depth of LFO modulation of a square wave. */
  private applyPulseWidth(): void {
    const c = this.circuit;
    if (this.pwmSource === 'man') {
      c.setParam('pwCv', 'offset', 1 - 2 * ((50 - this.pwm * 45) / 100)); // 50 % down to 5 %
      c.setParam('lfoPw', 'gain', 0);
    } else {
      c.setParam('pwCv', 'offset', 0);
      c.setParam('lfoPw', 'gain', this.pwm * 0.9);
    }
  }

  private applyEnvDepth(): void {
    this.eachVoice((v) => this.circuit.setParam(v('envDepth'), 'gain', this.envSign * this.envDepth * 6 * CENTS_PER_OCTAVE));
  }

  /** Off, I, II, or both (fast and shallow). The dry signal stays, the wet one is added as in the original. */
  private applyChorus(): void {
    const c = this.circuit;
    const i = this.chorusI;
    const ii = this.chorusII;
    const mode = i && ii ? CHORUS.both : i ? CHORUS.i : ii ? CHORUS.ii : undefined;
    const on = mode !== undefined;
    const chosen = mode ?? CHORUS.i;
    c.setParam('chLfo', 'frequency', chosen.rate);
    c.setParam('chDepthL', 'gain', chosen.depth);
    c.setParam('chDepthR', 'gain', -chosen.depth);
    c.setParam('chWet', 'gain', on ? 0.7 : 0);
    c.setParam('chDry', 'gain', on ? 0.75 : 1);
  }
}

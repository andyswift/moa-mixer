import { Device } from './device';
import { ARP_GROUPS, ARP_MODES, ARP_OCTAVES, ARP_RATE_PULSES, ARP_RATES, Arpeggiator, type ArpMode, type ArpRate, arpStepMs } from './arpeggiator';
import { CHORD_SHAPES, CHORD_TYPES, type ChordType, chordFromNotes, chordNotes, parseChord } from './chords';
import { ChoiceControl, NumberControl, TextControl, ToggleControl } from './controls';
import type { Circuit } from '../circuit/circuit';
import { POLY_BANKS, POLY_INIT, POLY_PRESETS } from './polyPresets';
import type { Playable } from './playable';
import type { PresetValues, SynthPreset } from './synthPresets';
import { Transport } from './transport';
import { VOICE_MODES, VoiceAllocator, type VoiceAction, type VoiceMode } from './voiceAllocator';
import { MidiClock } from '../midi/clock';
import type { MidiEvent } from '../midi/events';

export const POLY_VOICES = 6;
export const POLY_MIDI_CHANNEL = 'omni';

const CENTS_PER_OCTAVE = 1200;
const A4_NOTE = 69;
const BEND_RANGE_CENTS = 200;
const MOD_WHEEL_CENTS = 100;
const MOD_WHEEL_CC = 1;
const OSC_WAVES = ['saw', 'pulse', 'tri'] as const;
const LFO_WAVES = ['tri', 'up', 'down', 'sqr', 'rnd'] as const;
export const LFO_DIVISIONS = ['1/1', '1/2', '1/4', '1/8', '1/16', '1/32'] as const;
/** Voice output level per mode, so a chord, a unison stack and a single mono note sit at similar loudness. */
const VOICE_LEVEL: Record<VoiceMode, number> = { poly: 0.45, mono: 0.6, unison: 0.34 };
const PULSE_LEVEL = 0.65; // a pulse is louder than a saw at the same peak
/** An arpeggiator further behind than this (a sleeping tab) carries on from now instead of catching up. */
const ARP_RESYNC_MS = 250;

/**
 * Six-voice polyphonic synth, one oscillator per voice:
 *   osc (saw / pulse / triangle) + sub -> 24 dB low-pass -> VCA -> voices bus -> chorus -> delay -> volume
 * Envelope 1 sweeps each voice's filter, envelope 2 shapes its amplitude; one shared LFO modulates pitch,
 * pulse width, filter and amplitude. Voice modes: poly (allocated), mono (one voice, glide) and unison
 * (all six, detuned). Pitch is a per-voice CV in cents (a constant node), like the mono synth.
 *
 * Keys go through chord mode (each key plays a chord shape, fixed or learned from held keys) and then either
 * straight to the voices or to the arpeggiator, which steps through them at a division of the tempo (or of an
 * incoming MIDI clock when the transport is synced). The app calls `tick()` every few milliseconds to run it.
 */
export class PolySynth extends Device implements Playable {
  readonly name: string;
  readonly transport: Transport;
  /** The sixteen patch slots (two banks of eight): the factory patches, overwritten by saves. */
  readonly slots: SynthPreset[] = [...POLY_PRESETS];
  currentSlot = POLY_BANKS[0]!.length; // Init
  currentPreset: SynthPreset = this.slots[this.currentSlot]!;
  private readonly allocator = new VoiceAllocator(POLY_VOICES);
  private held: number[] = [];
  private bend = 0;
  private modWheelValue = 0;
  private vibratoCents = 0;
  private portamento = 0;
  private unisonDetune = 12;
  private lfoHz = 5;
  private lfoSync = false;
  private lfoDivision: (typeof LFO_DIVISIONS)[number] = '1/8';
  private clockPulses = 0;
  private readonly arp = new Arpeggiator();
  private arpOn = false;
  private arpLatch = false;
  private arpRate: ArpRate = '1/16';
  private arpGate = 0.5;
  private chordType: ChordType = 'off';
  private chordMemory = [0, 4, 7];
  /** Notes each held key started, so a chord change while a key is down still releases what it started. */
  private readonly keyNotes = new Map<number, number[]>();
  /** How many keys (and the arpeggiator) hold each sounding note: overlapping chords release a shared note last. */
  private readonly noteHolds = new Map<number, number>();
  /** Keys feeding the arpeggiator: the held keys, or with latch on the last chord played. */
  private arpKeys: number[] = [];
  private arpRunning = false;
  private arpSounding: number[] = [];
  private arpNextTime = 0;
  private arpOffTime?: number;
  private arpFreePulses = 0;
  private readonly performanceListeners = new Set<() => void>();
  private readonly noteListeners = new Set<() => void>();
  private readonly presetListeners = new Set<() => void>();

  constructor(
    name = 'Poly',
    private readonly clock = new MidiClock(),
    private readonly now: () => number = () => performance.now(),
  ) {
    super();
    this.name = name;
    this.transport = new Transport(clock);
    this.transport.channel.set(POLY_MIDI_CHANNEL);
    const c = this.circuit;

    this.addShared(c);
    for (let i = 0; i < POLY_VOICES; i++) this.addVoice(c, i);
    this.addEffects(c);
    this.outputList.push({ name: 'out', nodeId: 'level' });
    this.addControls(c);
    this.transport.tempo.onChange(() => this.applyLfoRate());
  }

  // ---- Playing ----

  keyDown(note: number): void {
    const fresh = this.held.length === 0;
    this.held = this.held.filter((n) => n !== note);
    this.held.push(note);
    if (this.arpOn) {
      // Latched, a new chord starts when every key has been let go and one goes down again.
      if (this.arpLatch && fresh) this.arpKeys = [];
      this.arpKeys = [...this.arpKeys.filter((n) => n !== note), note];
      this.startArp();
    } else {
      this.playKey(note);
    }
    this.notifyNotes();
  }

  keyUp(note: number): void {
    this.held = this.held.filter((n) => n !== note);
    if (this.arpOn) {
      if (!this.arpLatch) this.arpKeys = this.arpKeys.filter((n) => n !== note);
    } else {
      for (const n of this.keyNotes.get(note) ?? []) this.unhold(n);
      this.keyNotes.delete(note);
    }
    this.notifyNotes();
  }

  /** Runs the arpeggiator on its own tempo: plays the steps and note-offs that are due. Call every few ms. */
  tick(now = this.now()): void {
    if (this.arpOffTime !== undefined && now >= this.arpOffTime) this.arpRelease();
    if (!this.arpRunning || this.transport.synced) return;
    if (this.arpNextTime < now - ARP_RESYNC_MS) this.arpNextTime = now;
    while (this.arpRunning && this.arpNextTime <= now) {
      this.arpStep(this.arpNextTime);
      this.arpNextTime += arpStepMs(this.arpRate, this.transport.bpm);
    }
  }

  /** Learns the held keys as the chord memory and switches chord mode to it. False if no keys are held. */
  learnChord(): boolean {
    if (this.held.length === 0) return false;
    (this.control('chord.memory') as TextControl).set(chordFromNotes(this.held));
    (this.control('chord.type') as ChoiceControl).set('memory');
    return true;
  }

  /** The chord memory's intervals above the key (semitones). */
  get chordMemoryNotes(): readonly number[] {
    return this.chordMemory;
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

  setPitchBend(value: number): void {
    this.bend = Math.min(1, Math.max(-1, value));
    this.circuit.setParam('bend', 'offset', this.bend * BEND_RANGE_CENTS);
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

  /** Reacts to MIDI on this synth's channel: notes, pitch bend, mod wheel (CC 1), program change, clock. */
  handleMidi(event: MidiEvent): void {
    if (event.type === 'clock') {
      // Keep a tempo-synced LFO in step with an incoming clock: once a beat is plenty.
      if (this.lfoSync && this.transport.synced && ++this.clockPulses % 24 === 0) this.applyLfoRate();
      this.arpClock();
      return;
    }
    if ('channel' in event && !this.transport.acceptsChannel(event.channel)) return;
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
        break;
      case 'programChange': {
        if (event.program < this.slots.length) this.loadSlot(event.program);
        break;
      }
    }
  }

  // ---- Patches ----

  /** Loads a patch: every control is reset to the init values, then the patch's on top. */
  loadPreset(preset: SynthPreset): void {
    const values = { ...POLY_INIT, ...preset.values };
    this.currentPreset = preset;
    for (const [id, value] of Object.entries(values)) {
      const c = this.control(id);
      if (c.kind === 'number' && typeof value === 'number') c.set(value);
      else if (c.kind === 'choice' && typeof value === 'string') c.set(value);
      else if (c.kind === 'toggle' && typeof value === 'number') c.set(value > 0);
      else if (c.kind === 'text' && typeof value === 'string') c.set(value);
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

  /** The current value of every patch control, in the form a patch stores. */
  snapshot(): PresetValues {
    const values: PresetValues = {};
    for (const c of this.controlList) values[c.id] = c.kind === 'toggle' ? (c.value ? 1 : 0) : c.value;
    return values;
  }

  /** Stores the current sound in slot `index`, keeping the slot's name unless one is given. */
  saveSlot(index: number, name = this.slots[index]!.name): SynthPreset {
    const preset: SynthPreset = { name, values: this.snapshot() };
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

  // ---- Chords and the arpeggiator ----

  private chordIntervals(): readonly number[] {
    return this.chordType === 'memory' ? this.chordMemory : CHORD_SHAPES[this.chordType];
  }

  /** Sounds a key's chord (hold the new notes before letting go of the old, so a repeated key retriggers). */
  private playKey(key: number): void {
    const previous = this.keyNotes.get(key) ?? [];
    const notes = chordNotes(key, this.chordIntervals());
    for (const n of notes) this.hold(n);
    for (const n of previous) this.unhold(n);
    this.keyNotes.set(key, notes);
  }

  private hold(note: number): void {
    this.noteHolds.set(note, (this.noteHolds.get(note) ?? 0) + 1);
    this.apply(this.allocator.noteOn(note));
  }

  private unhold(note: number): void {
    const holds = (this.noteHolds.get(note) ?? 0) - 1;
    if (holds > 0) {
      this.noteHolds.set(note, holds);
      return;
    }
    this.noteHolds.delete(note);
    this.apply(this.allocator.noteOff(note));
  }

  private setArpOn(on: boolean): void {
    if (on === this.arpOn) return;
    this.arpOn = on;
    if (on) {
      for (const notes of this.keyNotes.values()) for (const n of notes) this.unhold(n);
      this.keyNotes.clear();
      this.arpKeys = [...this.held];
      this.startArp();
    } else {
      this.stopArp();
      for (const key of this.held) this.playKey(key);
    }
  }

  private setArpLatch(on: boolean): void {
    this.arpLatch = on;
    if (!on) this.arpKeys = this.arpKeys.filter((n) => this.held.includes(n));
  }

  /** The notes the arpeggiator steps through: every arp key's chord, in the order played, without repeats. */
  private arpNotes(): number[] {
    const intervals = this.chordIntervals();
    return [...new Set(this.arpKeys.flatMap((k) => chordNotes(k, intervals)))];
  }

  /** Starts a run from the first note; on its own tempo the first step plays at once, synced it waits for the grid. */
  private startArp(): void {
    if (this.arpRunning || this.arpKeys.length === 0) return;
    this.arpRunning = true;
    this.arp.reset();
    if (!this.transport.synced) {
      const now = this.now();
      this.arpStep(now);
      this.arpNextTime = now + arpStepMs(this.arpRate, this.transport.bpm);
    }
  }

  private stopArp(): void {
    this.arpRelease();
    this.arpRunning = false;
    this.arpKeys = [];
  }

  /** Plays the next note (or group); with no keys left (and no latch) the run ends here. */
  private arpStep(time: number): void {
    this.arpRelease();
    const notes = this.arp.next(this.arpNotes());
    if (notes.length === 0) {
      this.arpRunning = false;
      return;
    }
    this.arpSounding = notes;
    for (const n of notes) this.hold(n);
    this.arpOffTime = time + this.arpGate * arpStepMs(this.arpRate, this.transport.bpm);
  }

  private arpRelease(): void {
    for (const n of this.arpSounding) this.unhold(n);
    this.arpSounding = [];
    this.arpOffTime = undefined;
  }

  /** Synced to MIDI clock: a step every so many pulses, on the song's grid while the clock runs. */
  private arpClock(): void {
    if (!this.arpRunning || !this.transport.synced) return;
    const pulse = this.clock.running ? this.clock.ticks - 1 : this.arpFreePulses++;
    if (pulse >= 0 && pulse % ARP_RATE_PULSES[this.arpRate] === 0) this.arpStep(this.now());
  }

  // ---- Voice handling ----

  private apply(actions: VoiceAction[]): void {
    const c = this.circuit;
    for (const a of actions) {
      const v = (n: string) => `v${a.voice}.${n}`;
      if (a.kind === 'off') {
        c.setParam(v('env1'), 'gate', 0);
        c.setParam(v('env2'), 'gate', 0);
        continue;
      }
      // A note that doesn't glide jumps straight to pitch: zero the glide time around the change.
      if (!a.glide) c.setParam(v('pitch'), 'glide', 0);
      c.setParam(v('pitch'), 'offset', (a.note - A4_NOTE) * 100);
      if (!a.glide) c.setParam(v('pitch'), 'glide', this.portamento);
      if (a.retrigger) {
        c.setParam(v('env1'), 'gate', 1);
        c.setParam(v('env2'), 'gate', 1);
      }
    }
  }

  private eachVoice(fn: (v: (name: string) => string) => void): void {
    for (let i = 0; i < POLY_VOICES; i++) fn((name) => `v${i}.${name}`);
  }

  private applyMode(mode: VoiceMode): void {
    this.apply(this.allocator.releaseAll());
    this.held = [];
    this.keyNotes.clear();
    this.noteHolds.clear();
    this.arpKeys = [];
    this.arpRunning = false;
    this.arpSounding = [];
    this.arpOffTime = undefined;
    this.allocator.mode = mode;
    this.eachVoice((v) => this.circuit.setParam(v('out'), 'gain', VOICE_LEVEL[mode]));
    this.applyDetune();
    this.notifyNotes();
  }

  /** Unison spreads the voices symmetrically across +/- the detune amount; other modes are in tune. */
  private applyDetune(): void {
    const spread = this.allocator.mode === 'unison' ? this.unisonDetune : 0;
    const mid = (POLY_VOICES - 1) / 2;
    for (let i = 0; i < POLY_VOICES; i++) {
      const offset = ((i - mid) / mid) * spread;
      this.circuit.setParam(`v${i}.det`, 'offset', offset === 0 ? 0 : offset); // never -0
    }
  }

  private applyVibrato(): void {
    this.circuit.setParam('lfoPitch', 'gain', this.vibratoCents + this.modWheelValue * MOD_WHEEL_CENTS);
  }

  /** LFO speed: the rate knob in Hz, or a note division of the transport tempo when synced. */
  private applyLfoRate(): void {
    const denominator = Number(this.lfoDivision.split('/')[1]);
    const hz = this.lfoSync ? ((this.transport.bpm / 60) * denominator) / 4 : this.lfoHz;
    this.circuit.setParam('lfoOsc', 'frequency', hz);
    this.circuit.setParam('lfoRnd', 'rate', hz);
  }

  private notifyPerformance(): void {
    for (const l of this.performanceListeners) l();
  }

  private notifyNotes(): void {
    for (const l of this.noteListeners) l();
  }

  // ---- Circuit ----

  private addShared(c: Circuit): void {
    c.add('bend', 'constant', { offset: 0 })
      .add('subShift', 'constant', { offset: -CENTS_PER_OCTAVE })
      .add('pwCv', 'constant', { offset: 0 })
      .add('lfoOsc', 'oscillator', { frequency: 5, detune: 0 }, { waveform: 'triangle' })
      .add('lfoRnd', 'random', { rate: 5 })
      .add('lfoOscOut', 'gain', { gain: 1 })
      .add('lfoSign', 'gain', { gain: 1 }) // -1 turns the ramp-up into a ramp-down
      .add('lfoRndOut', 'gain', { gain: 0 })
      .add('lfo', 'gain', { gain: 1 })
      .add('lfoPitch', 'gain', { gain: 0 }) // cents
      .add('lfoPw', 'gain', { gain: 0 })
      .add('lfoFilter', 'gain', { gain: 0 }) // cents
      .add('lfoAmp', 'gain', { gain: 0 })
      .add('voices', 'gain', { gain: 1 })
      .connect('lfoOsc', 'lfoOscOut')
      .connect('lfoOscOut', 'lfoSign')
      .connect('lfoSign', 'lfo')
      .connect('lfoRnd', 'lfoRndOut')
      .connect('lfoRndOut', 'lfo');
    for (const dest of ['lfoPitch', 'lfoPw', 'lfoFilter', 'lfoAmp']) c.connect('lfo', dest);
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
      .add(v('pulseOut'), 'gain', { gain: 0 })
      .add(v('subLevel'), 'gain', { gain: 0 })
      .add(v('mix'), 'gain', { gain: 0.5 })
      .add(v('f1'), 'filter', { frequency: 2400, Q: 1, detune: 0 }, { type: 'lowpass' })
      .add(v('f2'), 'filter', { frequency: 2400, Q: 0.707, detune: 0 }, { type: 'lowpass' })
      .add(v('keyFollow'), 'gain', { gain: 0.5 })
      .add(v('env1'), 'envelope', { attack: 0.005, decay: 0.4, sustain: 0.4, release: 0.4, gate: 0 })
      .add(v('env1Depth'), 'gain', { gain: 2 * CENTS_PER_OCTAVE })
      .add(v('env2'), 'envelope', { attack: 0.005, decay: 0.3, sustain: 0.7, release: 0.35, gate: 0 })
      .add(v('amp'), 'gain', { gain: 0 })
      .add(v('trem'), 'gain', { gain: 1 })
      .add(v('ampKey'), 'gain', { gain: 0 })
      .add(v('out'), 'gain', { gain: VOICE_LEVEL.poly });
    for (const osc of ['osc', 'sub']) {
      c.connect(v('pitch'), v(osc), 'detune')
        .connect(v('det'), v(osc), 'detune')
        .connect('bend', v(osc), 'detune')
        .connect('lfoPitch', v(osc), 'detune');
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
      .connect(v('mix'), v('f1'))
      .connect(v('f1'), v('f2'))
      .connect(v('f2'), v('amp'))
      .connect(v('env1'), v('env1Depth'))
      .connect(v('pitch'), v('keyFollow'));
    for (const f of ['f1', 'f2']) {
      c.connect(v('env1Depth'), v(f), 'detune').connect(v('keyFollow'), v(f), 'detune').connect('lfoFilter', v(f), 'detune');
    }
    c.connect(v('env2'), v('amp'), 'gain')
      .connect(v('amp'), v('trem'))
      .connect('lfoAmp', v('trem'), 'gain') // tremolo: the gain sits at 1 and the LFO moves it around that
      .connect(v('pitch'), v('ampKey'))
      .connect(v('ampKey'), v('trem'), 'gain')
      .connect(v('trem'), v('out'))
      .connect(v('out'), 'voices');
  }

  /** voices -> chorus (two LFO-modulated delays) -> echo (delay with a darkened feedback loop) -> volume. */
  private addEffects(c: Circuit): void {
    c.add('chorusDry', 'gain', { gain: 1 })
      .add('chorusWet', 'gain', { gain: 0 })
      .add('chDelayA', 'delay', { delayTime: 0.016, maxTime: 0.05 })
      .add('chDelayB', 'delay', { delayTime: 0.024, maxTime: 0.05 })
      .add('chLfoA', 'oscillator', { frequency: 0.62, detune: 0 }, { waveform: 'sine' })
      .add('chLfoB', 'oscillator', { frequency: 0.83, detune: 0 }, { waveform: 'sine' })
      .add('chDepthA', 'gain', { gain: 0.0025 })
      .add('chDepthB', 'gain', { gain: 0.003 })
      .add('fxMix', 'gain', { gain: 1 })
      .connect('voices', 'chorusDry')
      .connect('chorusDry', 'fxMix')
      .connect('voices', 'chDelayA')
      .connect('voices', 'chDelayB')
      .connect('chDelayA', 'chorusWet')
      .connect('chDelayB', 'chorusWet')
      .connect('chorusWet', 'fxMix')
      .connect('chLfoA', 'chDepthA')
      .connect('chDepthA', 'chDelayA', 'delayTime')
      .connect('chLfoB', 'chDepthB')
      .connect('chDepthB', 'chDelayB', 'delayTime');

    c.add('dlyLine', 'delay', { delayTime: 0.35, maxTime: 1.5 })
      .add('dlyTone', 'filter', { frequency: 4500, Q: 0.707, detune: 0 }, { type: 'lowpass' })
      .add('dlyFb', 'gain', { gain: 0.3 })
      .add('dlyWet', 'gain', { gain: 0 })
      .add('dlySum', 'gain', { gain: 1 })
      .add('level', 'gain', { gain: 0.7 })
      .connect('fxMix', 'dlySum')
      .connect('fxMix', 'dlyLine')
      .connect('dlyLine', 'dlyTone')
      .connect('dlyTone', 'dlyFb')
      .connect('dlyFb', 'dlyLine')
      .connect('dlyTone', 'dlyWet')
      .connect('dlyWet', 'dlySum')
      .connect('dlySum', 'level');
  }

  private addControls(c: Circuit): void {
    const num = (id: string, label: string, min: number, max: number, init: number, unit: string,
      apply: (v: number) => void, curve?: 'linear' | 'log') =>
      this.controlList.push(new NumberControl(id, label, min, max, init, unit, apply, curve));
    const voices = (fn: (v: (n: string) => string, value: number) => void) => (value: number) =>
      this.eachVoice((v) => fn(v, value));
    const init = POLY_INIT as Record<string, number | string>;
    const n = (id: string) => init[id] as number;
    const time = (prefix: string, id: 'attack' | 'decay' | 'release', label: string, min: number, max: number) =>
      num(`${prefix}.${id}`, label, min, max, n(`${prefix}.${id}`), 's',
        voices((v, x) => c.setParam(v(prefix), id, x)), 'log');
    const sustain = (prefix: string) =>
      num(`${prefix}.sustain`, 'Sustain', 0, 1, n(`${prefix}.sustain`), '', voices((v, x) => c.setParam(v(prefix), 'sustain', x)));

    // Oscillator: one saw / pulse / triangle plus a sub an octave down.
    this.controlList.push(
      new ChoiceControl('osc.wave', 'Wave', OSC_WAVES, init['osc.wave'] as string, (w) =>
        this.eachVoice((v) => {
          c.setOption(v('osc'), 'waveform', w === 'tri' ? 'triangle' : 'sawtooth');
          c.setParam(v('rawOut'), 'gain', w === 'pulse' ? 0 : 1);
          c.setParam(v('pulseOut'), 'gain', w === 'pulse' ? PULSE_LEVEL : 0);
        })),
    );
    num('osc.width', 'Width', 5, 50, n('osc.width'), '%', (x) => c.setParam('pwCv', 'offset', 1 - (2 * x) / 100));
    num('osc.pwm', 'LFO PWM', 0, 100, n('osc.pwm') * 100, '%', (x) => c.setParam('lfoPw', 'gain', (x / 100) * 0.9));
    num('osc.vibrato', 'LFO Pitch', 0, 100, n('osc.vibrato'), 'ct', (x) => {
      this.vibratoCents = x;
      this.applyVibrato();
    });
    num('osc.sub', 'Sub', 0, 1, n('osc.sub'), '', voices((v, x) => c.setParam(v('subLevel'), 'gain', x * 0.6)));

    // Filter
    num('filter.cutoff', 'Cutoff', 20, 20000, n('filter.cutoff'), 'Hz', voices((v, x) => {
      c.setParam(v('f1'), 'frequency', x);
      c.setParam(v('f2'), 'frequency', x);
    }), 'log');
    num('filter.resonance', 'Resonance', 0.1, 20, n('filter.resonance'), '', voices((v, x) => c.setParam(v('f1'), 'Q', x)));
    num('filter.env', 'Env 1', 0, 6, n('filter.env'), 'oct', voices((v, x) => c.setParam(v('env1Depth'), 'gain', x * CENTS_PER_OCTAVE)));
    num('filter.lfo', 'LFO', 0, 4, n('filter.lfo'), 'oct', (x) => c.setParam('lfoFilter', 'gain', x * CENTS_PER_OCTAVE));
    num('filter.key', 'Key track', 0, 100, n('filter.key'), '%', voices((v, x) => c.setParam(v('keyFollow'), 'gain', x / 100)));

    // Amplifier
    num('amp.lfo', 'LFO', 0, 100, n('amp.lfo'), '%', (x) => c.setParam('lfoAmp', 'gain', (x / 100) * 0.8));
    num('amp.key', 'Key track', 0, 100, n('amp.key'), '%', voices((v, x) => c.setParam(v('ampKey'), 'gain', x / 100 / 6000)));
    num('level', 'Volume', 0, 1, n('level'), '', (x) => c.setParam('level', 'gain', x));

    // LFO
    this.controlList.push(
      new ChoiceControl('lfo.wave', 'Wave', LFO_WAVES, init['lfo.wave'] as string, (w) => {
        c.setOption('lfoOsc', 'waveform', w === 'sqr' ? 'square' : w === 'up' || w === 'down' ? 'sawtooth' : 'triangle');
        c.setParam('lfoSign', 'gain', w === 'down' ? -1 : 1);
        c.setParam('lfoOscOut', 'gain', w === 'rnd' ? 0 : 1);
        c.setParam('lfoRndOut', 'gain', w === 'rnd' ? 1 : 0);
      }),
    );
    num('lfo.rate', 'Rate', 0.1, 30, n('lfo.rate'), 'Hz', (x) => {
      this.lfoHz = x;
      this.applyLfoRate();
    }, 'log');
    this.controlList.push(
      new ToggleControl('lfo.sync', 'Sync', false, (on) => {
        this.lfoSync = on;
        this.applyLfoRate();
      }),
      new ChoiceControl('lfo.division', 'Division', LFO_DIVISIONS, init['lfo.division'] as string, (d) => {
        this.lfoDivision = d as (typeof LFO_DIVISIONS)[number];
        this.applyLfoRate();
      }),
    );

    // Envelope generators: 1 sweeps the filter, 2 shapes the amplitude.
    for (const prefix of ['env1', 'env2']) {
      time(prefix, 'attack', 'Attack', 0.001, 5);
      time(prefix, 'decay', 'Decay', 0.005, 5);
      sustain(prefix);
      time(prefix, 'release', 'Release', 0.005, 10);
    }

    // Voices
    this.controlList.push(
      new ChoiceControl('voices.mode', 'Mode', VOICE_MODES, init['voices.mode'] as string, (m) => this.applyMode(m as VoiceMode)),
    );
    num('voices.portamento', 'Portamento', 0, 2, n('voices.portamento'), 's', (x) => {
      this.portamento = x;
      this.eachVoice((v) => c.setParam(v('pitch'), 'glide', x));
    });
    num('voices.detune', 'Detune', 0, 50, n('voices.detune'), 'ct', (x) => {
      this.unisonDetune = x;
      this.applyDetune();
    });

    // Effects
    num('fx.chorus', 'Chorus', 0, 1, n('fx.chorus'), '', (x) => {
      c.setParam('chorusWet', 'gain', x * 0.7);
      c.setParam('chorusDry', 'gain', 1 - x * 0.25);
    });
    num('fx.delayTime', 'Delay time', 0.01, 1, n('fx.delayTime'), 's', (x) => c.setParam('dlyLine', 'delayTime', x), 'log');
    num('fx.feedback', 'Feedback', 0, 0.9, n('fx.feedback'), '', (x) => c.setParam('dlyFb', 'gain', x));
    num('fx.mix', 'Delay mix', 0, 1, n('fx.mix'), '', (x) => c.setParam('dlyWet', 'gain', x));

    // Arpeggiator and chord mode
    this.controlList.push(
      new ToggleControl('arp.on', 'Arp', false, (on) => this.setArpOn(on)),
      new ChoiceControl('arp.mode', 'Mode', ARP_MODES, init['arp.mode'] as string, (m) => {
        this.arp.mode = m as ArpMode;
      }),
      new ChoiceControl('arp.octaves', 'Octaves', ARP_OCTAVES, init['arp.octaves'] as string, (o) => {
        this.arp.octaves = Number(o);
      }),
      new ChoiceControl('arp.group', 'Group', ARP_GROUPS, init['arp.group'] as string, (g) => {
        this.arp.group = Number(g);
      }),
      new ChoiceControl('arp.rate', 'Rate', ARP_RATES, init['arp.rate'] as string, (r) => {
        this.arpRate = r as ArpRate;
      }),
    );
    num('arp.gate', 'Gate', 5, 100, n('arp.gate'), '%', (x) => {
      this.arpGate = x / 100;
    });
    this.controlList.push(
      new ToggleControl('arp.latch', 'Latch', false, (on) => this.setArpLatch(on)),
      new ChoiceControl('chord.type', 'Chord', CHORD_TYPES, init['chord.type'] as string, (t) => {
        this.chordType = t as ChordType;
      }),
      new TextControl('chord.memory', 'Chord memory', init['chord.memory'] as string, (text) => {
        this.chordMemory = parseChord(text);
      }),
    );
  }
}

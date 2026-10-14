import type { MidiEvent } from '../midi/events';
import { ChoiceControl, NumberControl, ToggleControl } from './controls';
import { Device } from './device';
import { DUO_INIT, DUO_NOT_IN_PATCH, DUO_PRESETS } from './duoPresets';
import type { Playable } from './playable';
import type { PresetValues, SynthPreset } from './synthPresets';

export const DUO_BEND_SEMITONES = 3;
const MOD_WHEEL_CC = 1;
const SUSTAIN_CC = 64;

/** Octave switch positions as semitone offsets from the "8 foot" (middle C at 261.6 Hz) position. */
export const DUO_OSC1_OCTAVES = { '32': -24, '16': -12, '8': 0 } as const;
export const DUO_OSC2_OCTAVES = { '16': -12, '8': 0, '4': 12 } as const;

/** Every worklet param starts at 0 until its control sets it; the controls set each one when built. */
const PARAMS = [
  'o1Wave', 'o1Off', 'o1Pw', 'o1Lvl', 'o1Gld', 'o2Wave', 'o2Off', 'o2Dtn', 'o2Lvl', 'o2Gld', 'tune', 'sync', 'vibRate', 'vibLvl', 'noise',
  'vcoRoute', 'vcfRoute', 'modRoute', 'cutoff', 'res', 'post',
  'm1Rise', 'm1Fall', 'm1Hold', 'm1Lfo', 'm1Lvl', 'm2Rise', 'm2Fall', 'm2Hold', 'm2Lfo', 'm2Lvl',
  'vcaRise', 'vcaFall', 'vcaHold', 'vcaLfo', 'level', 'rvTime', 'rvDecay', 'rvMix', 'bend', 'modw',
];

/**
 * MOA-DUO: a paraphonic two-oscillator synth with a routable dual filter, inspired by a small hardware synth of
 * the same idea. One voice architecture, two oscillators: with one key both play it; with two, oscillator 1 takes
 * the low note and oscillator 2 the high one; with three or more, oscillator 1 keeps the lowest and oscillator 2
 * follows the last note played (if it is higher). Mono mode plays the newest key on both. Legato means a key
 * pressed while another is held does not restart the modulators. The sound is one worklet node (`duoWorklet.ts`).
 */
export class DuoSynth extends Device implements Playable {
  readonly name: string;
  readonly bendRange = DUO_BEND_SEMITONES;
  /** Sixteen patch slots: the factory patches, overwritten by saves. */
  readonly slots: SynthPreset[] = [...DUO_PRESETS];
  currentSlot = 0;
  currentPreset: SynthPreset = this.slots[0]!;
  private held: number[] = [];
  private latched = new Set<number>();
  private pedal = false;
  private bend = 0;
  private modWheelValue = 0;
  private gate = false;
  private lastChannel = 1;
  private lockedChannel: number | undefined;
  private readonly noteListeners = new Set<() => void>();
  private readonly performanceListeners = new Set<() => void>();
  private readonly presetListeners = new Set<() => void>();

  constructor(name = 'MOA-DUO') {
    super();
    this.name = name;
    const c = this.circuit;
    c.add('synth', 'duo', Object.fromEntries(PARAMS.map((n) => [n, 0])))
      .add('meterL', 'meter', {}, { channel: 'left' })
      .add('meterR', 'meter', {}, { channel: 'right' })
      .connect('synth', 'meterL')
      .connect('synth', 'meterR');
    this.outputList.push({ name: 'out', nodeId: 'synth' });
    this.meterList.push({ name: 'out.L', nodeId: 'meterL' }, { name: 'out.R', nodeId: 'meterR' });

    const init = DUO_INIT;
    const set = (param: string) => (v: number) => c.setParam('synth', param, v);
    const num = (id: string, label: string, min: number, max: number, unit: string, param: string, curve?: 'linear' | 'log') =>
      this.controlList.push(new NumberControl(id, label, min, max, init[id] as number, unit, set(param), curve));
    const choice = (id: string, label: string, options: readonly string[], param: string, map?: (v: string) => number) =>
      this.controlList.push(new ChoiceControl(id, label, options, init[id] as string, (v) => set(param)(map ? map(v) : options.indexOf(v))));
    const toggle = (id: string, label: string, param: string) =>
      this.controlList.push(new ToggleControl(id, label, (init[id] as number) > 0, (v) => set(param)(v ? 1 : 0)));

    choice('osc1.wave', 'Wave', ['saw', 'square'], 'o1Wave');
    choice('osc1.octave', 'Octave', ['32', '16', '8'], 'o1Off', (v) => DUO_OSC1_OCTAVES[v as keyof typeof DUO_OSC1_OCTAVES]);
    num('osc1.pw', 'Pulse width', 0, 1, '', 'o1Pw');
    num('osc1.glide', 'Glide', 0, 1, '', 'o1Gld');
    num('osc1.level', 'Level', 0, 1, '', 'o1Lvl');
    choice('osc2.wave', 'Wave', ['saw', 'tri'], 'o2Wave');
    choice('osc2.octave', 'Octave', ['16', '8', '4'], 'o2Off', (v) => DUO_OSC2_OCTAVES[v as keyof typeof DUO_OSC2_OCTAVES]);
    num('osc2.detune', 'Detune', 0, 24, 'st', 'o2Dtn');
    num('osc2.glide', 'Glide', 0, 1, '', 'o2Gld');
    num('osc2.level', 'Level', 0, 1, '', 'o2Lvl');
    num('tune', 'Tune', -100, 100, 'ct', 'tune');
    toggle('sync', 'Sync', 'sync');
    num('vib.rate', 'Vibrato rate', 0.1, 20, 'Hz', 'vibRate', 'log');
    num('vib.level', 'Vibrato level', 0, 1, '', 'vibLvl');
    num('noise', 'Noise', 0, 1, '', 'noise');
    choice('route.vco', 'VCO routing', ['nor', 'split', 'half', 'vca'], 'vcoRoute');
    choice('route.vcf', 'VCF routing', ['lpf', 'hpf', 'even', 'odd'], 'vcfRoute');
    choice('route.mod', 'Mod routing', ['single', 'dual', 'split', 'odd'], 'modRoute');
    num('filter.cutoff', 'Cutoff', 20, 20000, 'Hz', 'cutoff', 'log');
    num('filter.res', 'Resonance', 0, 1, '', 'res');
    num('filter.post', 'Post', -4, 4, 'oct', 'post');
    for (const [n, k] of [['1', 'm1'], ['2', 'm2'], ['vca', 'vca']] as const) {
      const id = n === 'vca' ? 'vca' : `mod${n}`;
      num(`${id}.rise`, 'Rise', 0.001, 5, 's', `${k}Rise`, 'log');
      num(`${id}.fall`, 'Fall', 0.01, 15, 's', `${k}Fall`, 'log');
      toggle(`${id}.hold`, 'Hold', `${k}Hold`);
      toggle(`${id}.lfo`, 'LFO', `${k}Lfo`);
      if (n !== 'vca') num(`${id}.level`, 'Level', 0, 1, '', `${k}Lvl`);
    }
    num('vca.level', 'Level', 0, 1.5, '', 'level');
    num('reverb.time', 'Time', 0, 1, '', 'rvTime');
    num('reverb.decay', 'Decay', 0, 1, '', 'rvDecay');
    num('reverb.mix', 'Mix', 0, 1, '', 'rvMix');
    // Played settings: the page reads them, the worklet does not.
    this.controlList.push(
      new ToggleControl('play.legato', 'Legato', (init['play.legato'] as number) > 0, () => undefined),
      new ChoiceControl('play.mode', 'Mode', ['mono', 'duo'], init['play.mode'] as string, () => undefined),
      new ToggleControl('play.channel', 'Channel lock', false, () => undefined),
    );
  }

  // ---- Playing ----

  keyDown(note: number): void {
    const wasEmpty = this.held.length === 0;
    this.held = this.held.filter((n) => n !== note);
    this.held.push(note);
    this.latched.delete(note);
    this.sendNotes(wasEmpty || !this.legato);
    this.notifyNotes();
  }

  keyUp(note: number): void {
    if (!this.held.includes(note)) return;
    if (this.pedal) {
      this.latched.add(note);
      return;
    }
    this.release(note);
  }

  private release(note: number): void {
    this.held = this.held.filter((n) => n !== note);
    this.latched.delete(note);
    this.sendNotes(false);
    this.notifyNotes();
  }

  private releaseLatched(): void {
    for (const note of [...this.latched]) this.release(note);
  }

  private get legato(): boolean {
    return (this.control('play.legato') as ToggleControl).value;
  }

  /** The two oscillator notes for the keys held now (the paraphony rules); undefined with no keys. */
  assign(): { n1: number; n2: number } | undefined {
    const held = this.held;
    if (held.length === 0) return undefined;
    const last = held[held.length - 1]!;
    const mode = (this.control('play.mode') as ChoiceControl).value;
    if (mode === 'mono' || held.length === 1) return { n1: last, n2: last };
    const low = Math.min(...held);
    const high = Math.max(...held);
    if (held.length === 2) return { n1: low, n2: high };
    return { n1: low, n2: last > low ? last : high };
  }

  /** Tells the worklet the notes and gate; `retrig` restarts the modulators. */
  private sendNotes(retrig: boolean): void {
    const a = this.assign();
    if (a) {
      this.gate = true;
      this.circuit.play('synth', a.n1, a.n2, true, retrig);
    } else if (this.gate) {
      this.gate = false;
      this.circuit.play('synth', this.lastN1, this.lastN2, false, false);
    }
    if (a) {
      this.lastN1 = a.n1;
      this.lastN2 = a.n2;
    }
  }
  private lastN1 = 60;
  private lastN2 = 60;

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

  /** The pitch wheel: -1..1, three semitones either way. */
  setPitchBend(value: number): void {
    this.bend = Math.min(1, Math.max(-1, value));
    this.circuit.setParam('synth', 'bend', this.bend * DUO_BEND_SEMITONES);
    this.notifyPerformance();
  }

  get modWheel(): number {
    return this.modWheelValue;
  }

  /** The mod wheel adds to the vibrato depth. */
  setModWheel(value: number): void {
    this.modWheelValue = Math.min(1, Math.max(0, value));
    this.circuit.setParam('synth', 'modw', this.modWheelValue);
    this.notifyPerformance();
  }

  onPerformanceChange(fn: () => void): () => void {
    this.performanceListeners.add(fn);
    return () => this.performanceListeners.delete(fn);
  }

  /** MIDI: notes, pitch bend, mod wheel (CC 1), sustain pedal (CC 64) and program change. With the channel switch on CHAN, only the channel heard last while on OMNI is accepted. */
  handleMidi(event: MidiEvent): void {
    if (!('channel' in event)) return;
    const lock = (this.control('play.channel') as ToggleControl).value;
    if (!lock) {
      this.lastChannel = event.channel;
      this.lockedChannel = undefined;
    } else {
      this.lockedChannel ??= this.lastChannel;
      if (event.channel !== this.lockedChannel) return;
    }
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

  // ---- Patches ----

  loadSlot(index: number): void {
    const preset = this.slots[index];
    if (!preset) throw new Error(`No patch slot ${index}`);
    this.currentSlot = index;
    this.currentPreset = preset;
    this.applyValues({ ...DUO_INIT, ...preset.values });
    this.notifyPreset();
  }

  private applyValues(values: PresetValues): void {
    for (const [id, value] of Object.entries(values)) {
      if ((DUO_NOT_IN_PATCH as readonly string[]).includes(id)) continue;
      const c = this.control(id);
      if (c.kind === 'number' && typeof value === 'number') c.set(value);
      else if (c.kind === 'toggle' && typeof value === 'number') c.set(value > 0);
      else if (c.kind === 'choice' && typeof value === 'string') c.set(value);
      else throw new Error(`Patch: bad value for ${id}`);
    }
  }

  /** The current value of every sound control, in the form a patch stores (played settings are left out). */
  snapshot(): PresetValues {
    const values: PresetValues = {};
    for (const c of this.controlList) {
      if ((DUO_NOT_IN_PATCH as readonly string[]).includes(c.id)) continue;
      values[c.id] = c.kind === 'toggle' ? (c.value ? 1 : 0) : c.value;
    }
    return values;
  }

  saveSlot(index: number): SynthPreset {
    const preset: SynthPreset = { name: this.slots[index]!.name, values: this.snapshot() };
    this.slots[index] = preset;
    this.currentSlot = index;
    this.currentPreset = preset;
    this.notifyPreset();
    return preset;
  }

  onPresetChange(fn: () => void): () => void {
    this.presetListeners.add(fn);
    return () => this.presetListeners.delete(fn);
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
}

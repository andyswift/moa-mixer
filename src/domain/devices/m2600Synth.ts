import type { MidiEvent } from '../midi/events';
import { ChoiceControl, NumberControl, ToggleControl } from './controls';
import { Device } from './device';
import { type Cord, addCord, orient, parse, removeAt, resolve, serialize } from './m2600Cords';
import { M2600_CORDS_KEY, M2600_INIT, M2600_NOT_IN_PATCH, M2600_PRESETS, M2600_RETIRED } from './m2600Presets';
import { M2600_PARAMS, M2600_PERFORMANCE } from './m2600Params';
import type { Playable } from './playable';
import { SQ16_DIVS, type SQ16Message } from './sq16Params';
import type { PresetValues, SynthPreset } from './synthPresets';

export const M2600_BEND_SEMITONES = 2;
const MOD_WHEEL_CC = 1;
const SUSTAIN_CC = 64;
export const M2600_CHANNELS = ['omni', ...Array.from({ length: 16 }, (_, i) => String(i + 1))] as const;

/**
 * MOA-2600: a semi-modular synth in the mould of the ARP 2600 (not affiliated; the name and artwork are our own),
 * with a second, SEM-style filter. The sound is one worklet node (`m2600Worklet.ts`); this class turns keys into the
 * keyboard controller's two voltages. Mono mode plays the lowest held key, as the original keyboard does; duo mode
 * gives the lowest key to the keyboard CV (VCO 1, the filters) and the highest to the upper voice (VCO 2 and 3).
 * Single trigger fires the envelopes only on the first key of a phrase; multi fires them on every key.
 */
export class M2600Synth extends Device implements Playable {
  readonly name: string;
  readonly bendRange = M2600_BEND_SEMITONES;
  readonly slots: SynthPreset[] = [...M2600_PRESETS];
  currentSlot = 0;
  currentPreset: SynthPreset = this.slots[0]!;
  private held: number[] = [];
  private latched = new Set<number>();
  private pedal = false;
  private bend = 0;
  private modWheelValue = 0;
  private gate = false;
  private last = { n1: 60, n2: 60 };
  private portaHeld = false;
  private manualOn = false;
  private cordList: Cord[] = [];
  private midiPulses = 0;
  private readonly cordListeners = new Set<() => void>();
  private readonly noteListeners = new Set<() => void>();
  private readonly performanceListeners = new Set<() => void>();
  private readonly presetListeners = new Set<() => void>();

  constructor(name = 'MOA-2600') {
    super();
    this.name = name;
    const c = this.circuit;
    const all = [...M2600_PARAMS, ...M2600_PERFORMANCE];
    c.add('synth', 'm2600', Object.fromEntries(all.map((p) => [p.id, p.def])), { cords: '[]' })
      .add('meterL', 'meter', {}, { channel: 'left' })
      .add('meterR', 'meter', {}, { channel: 'right' })
      .connect('synth', 'meterL')
      .connect('synth', 'meterR');
    this.outputList.push({ name: 'out', nodeId: 'synth' });
    this.meterList.push({ name: 'out.L', nodeId: 'meterL' }, { name: 'out.R', nodeId: 'meterR' });

    const set = (param: string) => (v: number) => c.setParam('synth', param, v);
    for (const p of M2600_PARAMS) {
      const init = M2600_INIT[p.id];
      if (p.kind === 'number') {
        this.controlList.push(new NumberControl(p.id, p.label, p.min, p.max, init as number, p.unit ?? '', set(p.id), p.curve));
      } else if (p.kind === 'choice') {
        const options = p.options!;
        this.controlList.push(new ChoiceControl(p.id, p.label, options, init as string, (v) => set(p.id)(options.indexOf(v))));
      } else {
        this.controlList.push(new ToggleControl(p.id, p.label, (init as number) > 0, (v) => set(p.id)(v ? 1 : 0)));
      }
    }
    // Played settings: the page reads it, the worklet does not.
    this.controlList.push(new ChoiceControl('play.channel', 'MIDI channel', M2600_CHANNELS, 'omni', () => undefined));
  }

  /** The MIDI channel setting where a page conducting the synth looks for it (as on the other synths). */
  get transport(): { channel: ChoiceControl } {
    return { channel: this.control('play.channel') as ChoiceControl };
  }

  // ---- Playing ----

  keyDown(note: number): void {
    const wasEmpty = this.held.length === 0;
    this.held = this.held.filter((n) => n !== note);
    this.held.push(note);
    this.latched.delete(note);
    this.sendNotes(wasEmpty || this.multiTrigger);
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

  private get multiTrigger(): boolean {
    return (this.control('kb.trig') as ChoiceControl).value === 'multi';
  }

  /** The keyboard CV note (n1) and the upper voice (n2) for the keys held now; undefined with no keys. */
  assign(): { n1: number; n2: number } | undefined {
    if (this.held.length === 0) return undefined;
    const low = Math.min(...this.held);
    if ((this.control('kb.voice') as ChoiceControl).value === 'mono') return { n1: low, n2: low };
    return { n1: low, n2: Math.max(...this.held) };
  }

  private sendNotes(retrig: boolean): void {
    const a = this.assign();
    if (a) {
      this.gate = true;
      this.last = a;
      this.circuit.play('synth', a.n1, a.n2, true, retrig);
    } else if (this.gate) {
      this.gate = false;
      this.circuit.play('synth', this.last.n1, this.last.n2, false, false);
    }
  }

  get heldNotes(): readonly number[] {
    return this.held;
  }

  onNoteChange(fn: () => void): () => void {
    this.noteListeners.add(fn);
    return () => this.noteListeners.delete(fn);
  }

  /** The AR's manual button: opens its gate while pressed. */
  setManual(on: boolean): void {
    if (on === this.manualOn) return;
    this.manualOn = on;
    this.circuit.send('synth', { type: 'manual', on });
  }

  /** The portamento's momentary button: glide on while held, whatever the switch says. */
  setPortamentoHeld(on: boolean): void {
    if (on === this.portaHeld) return;
    this.portaHeld = on;
    this.circuit.setParam('synth', 'kb.portaOn', on || (this.control('kb.portaOn') as ToggleControl).value ? 1 : 0);
  }

  get pitchBend(): number {
    return this.bend;
  }

  setPitchBend(value: number): void {
    this.bend = Math.min(1, Math.max(-1, value));
    this.circuit.setParam('synth', 'bend', this.bend * M2600_BEND_SEMITONES);
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

  // ---- The MOA-SQ16 sequencer ----

  /** Run, stop, toggle, step once or reset the sequencer (`jump` goes to a step, 0-15). */
  sequencer(action: 'run' | 'stop' | 'toggle' | 'step' | 'reset'): void {
    this.circuit.send('synth', { type: 'sq', action } satisfies SQ16Message);
  }

  jumpTo(index: number): void {
    this.circuit.send('synth', { type: 'sq', action: 'jump', index } satisfies SQ16Message);
  }

  /** MIDI clock, start, continue and stop drive the sequencer when its clock source is MIDI. */
  private handleClock(event: MidiEvent): void {
    if ((this.control('sq.sync') as ChoiceControl).value !== 'midi') return;
    if (event.type === 'start') {
      this.midiPulses = 0;
      this.sequencer('reset');
      this.sequencer('run');
    } else if (event.type === 'continue') this.sequencer('run');
    else if (event.type === 'stop') this.sequencer('stop');
    else if (event.type === 'clock') {
      const per = SQ16_DIVS[(this.control('sq.div') as ChoiceControl).value as keyof typeof SQ16_DIVS];
      if (this.midiPulses % per === 0) this.circuit.send('synth', { type: 'sqtick' } satisfies SQ16Message);
      this.midiPulses++;
    }
  }

  /** MIDI on the chosen channel (or any): notes, pitch bend, mod wheel (CC 1), sustain pedal (CC 64), program change; and MIDI clock for the sequencer. */
  handleMidi(event: MidiEvent): void {
    if (!('channel' in event)) {
      this.handleClock(event);
      return;
    }
    const channel = (this.control('play.channel') as ChoiceControl).value;
    if (channel !== 'omni' && Number(channel) !== event.channel) return;
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
          if (!this.pedal) for (const note of [...this.latched]) this.release(note);
        }
        break;
      case 'programChange':
        if (event.program < this.slots.length) this.loadSlot(event.program);
        break;
    }
  }

  // ---- Patch cords ----

  get cords(): readonly Cord[] {
    return this.cordList;
  }

  /** Joins two jacks, in either order; false if they cannot be joined (two outputs, two inputs, two MULT jacks). */
  connect(a: string, b: string): boolean {
    const cord = orient(a, b);
    if (!cord) return false;
    this.setCords(addCord(this.cordList, cord));
    return true;
  }

  /** Pulls every cord out of jack `id`. */
  unplug(id: string): void {
    this.setCords(removeAt(this.cordList, id));
  }

  clearCords(): void {
    this.setCords([]);
  }

  setCords(cords: readonly Cord[]): void {
    this.cordList = [...cords];
    const resolved = resolve(this.cordList);
    // kept on the node too, so a worklet built later (audio starting) begins with them
    this.circuit.setOption('synth', 'cords', JSON.stringify(resolved));
    this.circuit.send('synth', { type: 'cords', cords: resolved });
    for (const l of this.cordListeners) l();
  }

  onCordsChange(fn: () => void): () => void {
    this.cordListeners.add(fn);
    return () => this.cordListeners.delete(fn);
  }

  // ---- Patches ----

  loadSlot(index: number): void {
    const preset = this.slots[index];
    if (!preset) throw new Error(`No patch slot ${index}`);
    this.currentSlot = index;
    this.currentPreset = preset;
    this.applyValues({ ...M2600_INIT, ...preset.values });
    this.notifyPreset();
  }

  private applyValues(values: PresetValues): void {
    for (const [id, value] of Object.entries(values)) {
      if ((M2600_NOT_IN_PATCH as readonly string[]).includes(id) || (M2600_RETIRED as readonly string[]).includes(id)) continue;
      if (id === M2600_CORDS_KEY) {
        if (typeof value !== 'string') throw new Error('Patch: bad cords');
        this.setCords(parse(value));
        continue;
      }
      const c = this.control(id);
      if (c.kind === 'number' && typeof value === 'number') c.set(value);
      else if (c.kind === 'toggle' && typeof value === 'number') c.set(value > 0);
      else if (c.kind === 'choice' && typeof value === 'string') c.set(value);
      else throw new Error(`Patch: bad value for ${id}`);
    }
  }

  /** The current value of every sound control and the cords, in the form a patch stores (the MIDI channel is left out). */
  snapshot(): PresetValues {
    const values: PresetValues = {};
    for (const c of this.controlList) {
      if ((M2600_NOT_IN_PATCH as readonly string[]).includes(c.id)) continue;
      values[c.id] = c.kind === 'toggle' ? (c.value ? 1 : 0) : c.value;
    }
    values[M2600_CORDS_KEY] = serialize(this.cordList);
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

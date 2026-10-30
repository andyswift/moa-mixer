import type { MidiEvent } from '../midi/events';
import { ChoiceControl, type Control, NumberControl, ToggleControl } from './controls';
import { Device } from './device';
import type { Playable } from './playable';
import { RIG_DEFAULTS, RIG_PARAMS, type RigRoute, type RigSide } from './rigParams';
import { RIG_PRESETS, type RigPreset } from './rigPresets';

export const RIG_PARTS = 16;
/** The pool of voices the parts share. */
export const RIG_VOICES = 24;

const MOD_WHEEL_CC = 1;
const EXPRESSION_CC = 11;

/** One of the sixteen parts: its sound (sides A and B) and where it sits in the multi. */
export interface RigPart {
  name: string;
  /** The preset slot it was loaded from. */
  slot: number;
  /** Its share of the voice pool; 0 silences it. */
  voices: number;
  /** The MIDI channel it listens on, 1-16, or 0 for all. */
  channel: number;
  /** Lowest and highest note it plays (a split). */
  lo: number;
  hi: number;
  /** Octaves added to what it plays. */
  octave: number;
  a: RigSide;
  b: RigSide;
}

const clone = (s: RigSide): RigSide => ({ params: { ...s.params }, matrix: s.matrix.map((r) => ({ ...r })) });

/**
 * MOA-RIG: a multitimbral synth after the Melbourne Instruments NINA, with sixteen parts instead of four. Each part is
 * a patch on the same voice (`rigWorklet.ts`) and takes a fixed share of a pool of 24 voices. The panel edits one part
 * and one side (A or B) at a time: the controls are the patch's params (`RIG_PARAMS`) and always show the part and
 * side being edited. The keyboard bed plays the edited part; MIDI plays every part listening on the event's channel,
 * within its key range. The sound is one worklet node; its `state` option holds the whole multi for a worklet built
 * later, and changes go to it as messages.
 */
export class RigSynth extends Device implements Playable {
  readonly name: string;
  readonly slots: readonly RigPreset[] = RIG_PRESETS;
  readonly parts: RigPart[];
  private editPart = 0;
  private editSide: 'a' | 'b' = 'a';
  /** While the controls are being set to show another part, their changes are not edits. */
  private syncing = true;
  private bpmValue = 120;
  private held: number[] = [];
  /** Which parts each sounding MIDI note went to (and at what pitch), so its note off finds them whatever changed since. */
  private readonly sounding = new Map<string, { part: number; note: number }[]>();
  private bend = 0;
  private modWheelValue = 0;
  private readonly noteListeners = new Set<() => void>();
  private readonly performanceListeners = new Set<() => void>();
  private readonly partListeners = new Set<() => void>();

  constructor(name = 'MOA-RIG') {
    super();
    this.name = name;
    this.parts = Array.from({ length: RIG_PARTS }, (_, p) => ({
      name: p === 0 ? RIG_PRESETS[0]!.name : '', slot: 0, voices: p === 0 ? RIG_VOICES : 0,
      channel: p === 0 ? 0 : p + 1, lo: 0, hi: 127, octave: 0,
      a: clone(RIG_PRESETS[0]!.a), b: clone(RIG_PRESETS[0]!.a),
    }));
    const c = this.circuit;
    c.add('synth', 'rig', {}, { state: '{}' })
      .add('meterL', 'meter', {}, { channel: 'left' })
      .add('meterR', 'meter', {}, { channel: 'right' })
      .connect('synth', 'meterL')
      .connect('synth', 'meterR');
    this.outputList.push({ name: 'out', nodeId: 'synth' });
    this.meterList.push({ name: 'out.L', nodeId: 'meterL' }, { name: 'out.R', nodeId: 'meterR' });

    for (const p of RIG_PARAMS) {
      const edit = (v: number) => this.edit(p.id, v);
      if (p.kind === 'number') this.controlList.push(new NumberControl(p.id, p.label, p.min, p.max, p.def, p.unit ?? '', edit, p.curve));
      else if (p.kind === 'choice') this.controlList.push(new ChoiceControl(p.id, p.label, p.options!, p.options![p.def]!, (v) => edit(p.options!.indexOf(v))));
      else this.controlList.push(new ToggleControl(p.id, p.label, p.def > 0, (v) => edit(v ? 1 : 0)));
    }
    this.syncing = false;
    this.saveState();
  }

  // ---- Editing ----

  get part(): number {
    return this.editPart;
  }

  get side(): 'a' | 'b' {
    return this.editSide;
  }

  /** Edits another part: the controls move to its sound. */
  selectPart(part: number): void {
    this.editPart = Math.max(0, Math.min(RIG_PARTS - 1, part));
    this.syncControls();
  }

  /** Edits side A or B of the part. */
  selectSide(side: 'a' | 'b'): void {
    this.editSide = side;
    this.syncControls();
  }

  /** Loads a factory sound into the edited part. */
  loadSlot(slot: number): void {
    const preset = this.slots[slot];
    if (!preset) return;
    const pt = this.parts[this.editPart]!;
    pt.slot = slot;
    pt.name = preset.name;
    pt.a = clone(preset.a);
    pt.b = clone(preset.b ?? preset.a);
    this.syncControls();
    this.sendPatch(this.editPart);
  }

  /** The edited side's mod routings. */
  get routes(): readonly RigRoute[] {
    return this.parts[this.editPart]![this.editSide].matrix;
  }

  /** Replaces the edited side's mod routings. */
  setRoutes(routes: RigRoute[]): void {
    this.parts[this.editPart]![this.editSide].matrix = routes.map((r) => ({ ...r }));
    this.sendPatch(this.editPart);
  }

  /** Copies the edited side onto the other, so morphing starts from the same sound. */
  copySide(): void {
    const pt = this.parts[this.editPart]!;
    if (this.editSide === 'a') pt.b = clone(pt.a); else pt.a = clone(pt.b);
    this.sendPatch(this.editPart);
  }

  /** Gives a part `voices` of the pool, as many as the other parts leave free. */
  setVoices(part: number, voices: number): void {
    const others = this.parts.reduce((sum, pt, i) => sum + (i === part ? 0 : pt.voices), 0);
    this.parts[part]!.voices = Math.max(0, Math.min(RIG_VOICES - others, Math.round(voices)));
    this.circuit.send('synth', { type: 'layout', counts: this.parts.map((pt) => pt.voices) });
    this.saveState();
    this.notifyParts();
  }

  /** Sets a part's MIDI channel (0 for all), key range or octave. */
  setPartSetting(part: number, setting: 'channel' | 'lo' | 'hi' | 'octave', value: number): void {
    this.parts[part]![setting] = Math.round(value);
    this.notifyParts();
  }

  /** Voices of the pool not given to any part. */
  get freeVoices(): number {
    return RIG_VOICES - this.parts.reduce((sum, pt) => sum + pt.voices, 0);
  }

  set bpm(v: number) {
    this.bpmValue = v;
    this.circuit.send('synth', { type: 'bpm', bpm: v });
    this.saveState();
  }

  get bpm(): number {
    return this.bpmValue;
  }

  onPartChange(fn: () => void): () => void {
    this.partListeners.add(fn);
    return () => this.partListeners.delete(fn);
  }

  private edit(id: string, value: number): void {
    if (this.syncing) return;
    this.parts[this.editPart]![this.editSide].params[id] = value;
    this.sendPatch(this.editPart);
  }

  private syncControls(): void {
    this.syncing = true;
    const params = this.parts[this.editPart]![this.editSide].params;
    for (const c of this.controlList) {
      const v = params[c.id] ?? RIG_DEFAULTS[c.id]!;
      setControl(c, v);
    }
    this.syncing = false;
    this.notifyParts();
  }

  private sendPatch(part: number): void {
    const pt = this.parts[part]!;
    this.circuit.send('synth', { type: 'patch', part, a: pt.a, b: pt.b });
    this.saveState();
  }

  private saveState(): void {
    this.circuit.setOption('synth', 'state', JSON.stringify({
      counts: this.parts.map((pt) => pt.voices),
      patches: this.parts.map((pt, part) => ({ part, a: pt.a, b: pt.b })),
      bpm: this.bpmValue,
    }));
  }

  private notifyParts(): void {
    for (const l of this.partListeners) l();
  }

  // ---- Playing ----

  /** The keyboard bed plays the edited part. */
  keyDown(note: number): void {
    this.held = this.held.filter((n) => n !== note);
    this.held.push(note);
    this.start(`k${note}`, [this.editPart], note, 0.8);
    this.notifyNotes();
  }

  keyUp(note: number): void {
    if (!this.held.includes(note)) return;
    this.held = this.held.filter((n) => n !== note);
    this.stop(`k${note}`);
    this.notifyNotes();
  }

  handleMidi(event: MidiEvent): void {
    switch (event.type) {
      case 'noteOn': {
        const parts = this.parts.flatMap((pt, i) =>
          pt.voices > 0 && (pt.channel === 0 || pt.channel === event.channel) && event.note >= pt.lo && event.note <= pt.hi ? [i] : []);
        this.start(`${event.channel}:${event.note}`, parts, event.note, event.velocity / 127);
        break;
      }
      case 'noteOff':
        this.stop(`${event.channel}:${event.note}`);
        break;
      case 'pitchBend':
        this.setPitchBend(event.value);
        break;
      case 'cc':
        if (event.controller === MOD_WHEEL_CC) this.setModWheel(event.value / 127);
        else if (event.controller === EXPRESSION_CC) this.sendControl('exp', event.value / 127);
        break;
      default:
        break;
    }
  }

  private start(key: string, parts: number[], note: number, velocity: number): void {
    this.stop(key);
    const sent = parts.map((part) => ({ part, note: note + 12 * this.parts[part]!.octave }));
    for (const s of sent) this.circuit.send('synth', { type: 'on', part: s.part, note: s.note, vel: velocity });
    if (sent.length) this.sounding.set(key, sent);
  }

  private stop(key: string): void {
    for (const s of this.sounding.get(key) ?? []) this.circuit.send('synth', { type: 'off', part: s.part, note: s.note });
    this.sounding.delete(key);
  }

  /** Releases everything (the transport's stop). */
  panic(): void {
    this.sounding.clear();
    this.held = [];
    this.circuit.send('synth', { type: 'panic' });
    this.notifyNotes();
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
    this.bend = Math.max(-1, Math.min(1, value));
    this.sendControl('bend', this.bend);
    this.notifyPerformance();
  }

  get modWheel(): number {
    return this.modWheelValue;
  }

  setModWheel(value: number): void {
    this.modWheelValue = Math.max(0, Math.min(1, value));
    this.sendControl('mod', this.modWheelValue);
    this.notifyPerformance();
  }

  onPerformanceChange(fn: () => void): () => void {
    this.performanceListeners.add(fn);
    return () => this.performanceListeners.delete(fn);
  }

  private sendControl(name: string, value: number): void {
    for (let part = 0; part < RIG_PARTS; part++) this.circuit.send('synth', { type: 'ctrl', part, name, value });
  }

  private notifyNotes(): void {
    for (const l of this.noteListeners) l();
  }

  private notifyPerformance(): void {
    for (const l of this.performanceListeners) l();
  }
}

/** Sets a control from a stored param value (choices are stored as option indices, toggles as 0 / 1). */
function setControl(c: Control, v: number): void {
  if (c.kind === 'number') c.set(v);
  else if (c.kind === 'choice') c.set(c.options[Math.round(v)] ?? c.options[0]!);
  else if (c.kind === 'toggle') c.set(v >= 0.5);
}

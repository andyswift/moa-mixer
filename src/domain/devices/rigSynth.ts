import type { MidiEvent } from '../midi/events';
import { RigSequencer, type RigStep } from '../sequencer/rigSequencer';
import { ChoiceControl, type Control, NumberControl, ToggleControl } from './controls';
import { Device } from './device';
import type { Playable } from './playable';
import { RIG_DEFAULTS, RIG_PARAMS, type RigRoute, type RigSide } from './rigParams';
import { RIG_MULTI_VERSION, type RigMulti } from './rigMulti';
import { RIG_PRESETS, type RigPreset } from './rigPresets';

export const RIG_PARTS = 16;
/** The pool of voices the parts share. */
export const RIG_VOICES = 24;

/** A step recorded with no note off yet gets this gate. */
const RECORD_GATE = 0.5;
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
const copy = <T>(v: T): T => JSON.parse(JSON.stringify(v)) as T;

/** A part as a fresh multi has it: part 1 the Init sound with the whole pool, the rest empty, each on its own channel. */
export function freshPart(p: number): RigPart {
  return {
    name: p === 0 ? RIG_PRESETS[0]!.name : '', slot: 0, voices: p === 0 ? RIG_VOICES : 0,
    channel: p === 0 ? 0 : p + 1, lo: 0, hi: 127, octave: 0,
    a: clone(RIG_PRESETS[0]!.a), b: clone(RIG_PRESETS[0]!.a),
  };
}

/**
 * MOA-RIG: a multitimbral synth after the Melbourne Instruments NINA, with sixteen parts instead of four. Each part is
 * a patch on the same voice (`rigWorklet.ts`) and takes a fixed share of a pool of 24 voices. The panel edits one part
 * and one side (A or B) at a time: the controls are the patch's params (`RIG_PARAMS`) and always show the part and
 * side being edited. The keyboard bed plays the edited part; MIDI plays every part listening on the event's channel,
 * within its key range. The sound is one worklet node; its `state` option holds the whole multi for a worklet built
 * later, and changes go to it as messages.
 *
 * The sequencer (`seq`) has a track per part. It sends ahead of time, so its notes and locks carry their audio-clock
 * time; the page gives the device that clock (`now`) and calls `seq.schedule` every few milliseconds. With a step
 * held (`holdStep`), turning a control locks it on that step rather than changing the sound. Stopped, playing the
 * edited part sets the selected step's notes (a chord is the keys held together; with REC the step then moves on).
 * Playing with REC on writes onto the nearest step, gate and all.
 */
export class RigSynth extends Device implements Playable {
  readonly name: string;
  /** The sounds a part can load: the factory ones, then the ones saved with `saveSound`. */
  readonly slots: RigPreset[] = [...RIG_PRESETS];
  readonly parts: RigPart[];
  private multiNameValue = 'Multi';
  private readonly editListeners = new Set<() => void>();
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
  readonly seq: RigSequencer;
  /** The audio clock, in seconds (set by the page). */
  now: () => number = () => 0;
  /** How long after the audio clock the player hears it (set by the page): a note played live is placed by what was heard. */
  latency: () => number = () => 0;
  /** The edited track's selected step (-1 for none). */
  private selStep = -1;
  /** While set, control changes lock onto this step instead of editing the sound. */
  private lockStep?: { track: number; step: number };
  private recording = false;
  /** Step entry: keys held for the chord on the selected step. */
  private entryHeld = new Set<number>();
  /** Live recording: notes waiting for their release to set the gate. */
  private readonly takes = new Map<number, { step: RigStep; tick: number; clock: number }>();

  constructor(name = 'MOA-RIG') {
    super();
    this.name = name;
    this.seq = new RigSequencer({
      on: (part, note, vel, when) => this.circuit.send('synth', { type: 'on', part, note, vel, when }),
      off: (part, note, when) => this.circuit.send('synth', { type: 'off', part, note, when }),
      locks: (part, locks, when) => this.circuit.send('synth', { type: 'lock', part, locks, when }),
      mod: (part, value, when) => this.circuit.send('synth', { type: 'ctrl', part, name: 'seq', value, when }),
      flush: () => this.circuit.send('synth', { type: 'flush' }),
    });
    this.parts = Array.from({ length: RIG_PARTS }, (_, p) => freshPart(p));
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
    if (this.lockStep && this.lockStep.track !== this.editPart) this.lockStep = undefined;
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

  // ---- Multis and sounds ----

  get multiName(): string {
    return this.multiNameValue;
  }

  set multiName(name: string) {
    this.multiNameValue = name.slice(0, 24);
    this.edited();
  }

  /** Called after anything that a multi or the saved sounds keep has changed (for saving). */
  onEdit(fn: () => void): () => void {
    this.editListeners.add(fn);
    return () => this.editListeners.delete(fn);
  }

  private edited(): void {
    for (const l of this.editListeners) l();
  }

  /** Names a part (what the part buttons and the sequencer's lanes show). */
  setPartName(part: number, name: string): void {
    this.parts[part]!.name = name.slice(0, 24);
    this.notifyParts();
    this.edited();
  }

  /**
   * Saves the edited part's sound (both sides) as a sound any part can load, under `name`: a saved sound of the same
   * name is replaced (factory ones never are). Returns its slot.
   */
  saveSound(name: string): number {
    const pt = this.parts[this.editPart]!;
    const sound: RigPreset = { name: name.trim().slice(0, 24) || 'Sound', a: clone(pt.a), b: clone(pt.b) };
    let slot = this.slots.findIndex((s, i) => i >= this.factorySounds && s.name === sound.name);
    if (slot < 0) slot = this.slots.push(sound) - 1;
    else this.slots[slot] = sound;
    pt.slot = slot;
    pt.name = sound.name;
    this.notifyParts();
    this.edited();
    return slot;
  }

  /** How many of the slots are factory sounds (the saved ones come after). */
  get factorySounds(): number {
    return RIG_PRESETS.length;
  }

  /** The saved sounds (for storage). */
  get savedSounds(): RigPreset[] {
    return this.slots.slice(this.factorySounds);
  }

  /** Puts saved sounds (from storage) after the factory ones. */
  setSavedSounds(sounds: RigPreset[]): void {
    this.slots.splice(this.factorySounds, Infinity, ...sounds.map(copy));
    this.notifyParts();
  }

  /** The whole machine as it is now. */
  toMulti(): RigMulti {
    return copy({
      v: RIG_MULTI_VERSION, name: this.multiName, parts: this.parts, patterns: this.seq.patterns,
      current: this.seq.current, chain: this.seq.chain, tempo: this.bpm, shuffle: this.seq.shuffle,
    });
  }

  /** Loads a multi (sanitised beforehand): stops the sequencer, and the edited part goes back to part 1. */
  loadMulti(m: RigMulti): void {
    this.stop();
    this.multiName = m.name;
    m.parts.forEach((src, p) => {
      Object.assign(this.parts[p]!, copy(src), { voices: 0, slot: src.slot < this.slots.length ? src.slot : 0 });
    });
    // voices last, so a save that asks for more than the pool still gets what fits, in part order
    m.parts.forEach((src, p) => { this.parts[p]!.voices = Math.max(0, Math.min(this.freeVoices, src.voices)); });
    this.seq.patterns = copy(m.patterns);
    this.seq.current = m.current;
    this.seq.next = undefined;
    this.seq.chain = [...m.chain];
    this.seq.shuffle = m.shuffle;
    this.bpm = m.tempo;
    this.circuit.send('synth', { type: 'layout', counts: this.parts.map((pt) => pt.voices) });
    this.parts.forEach((_, p) => this.sendPatch(p));
    this.editPart = 0;
    this.editSide = 'a';
    this.selStep = -1;
    this.lockStep = undefined;
    this.syncControls();
    this.seq.notify();
  }

  /** Starts over: part 1 with the Init sound, empty patterns. */
  newMulti(): void {
    const fresh = new RigSynth().toMulti();
    fresh.name = 'Multi';
    this.loadMulti(fresh);
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
    this.edited();
  }

  /** Voices of the pool not given to any part. */
  get freeVoices(): number {
    return RIG_VOICES - this.parts.reduce((sum, pt) => sum + pt.voices, 0);
  }

  set bpm(v: number) {
    this.bpmValue = v;
    this.seq.tempo = v;
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
    if (this.lockStep) {
      const { track, step } = this.lockStep;
      this.seq.pattern.tracks[track]!.steps[step]!.locks[id] = value;
      this.seq.notify();
      return;
    }
    this.parts[this.editPart]![this.editSide].params[id] = value;
    this.sendPatch(this.editPart);
  }

  // ---- Sequencer editing ----

  /** The edited part's track's selected step, or -1. */
  get step(): number {
    return this.selStep;
  }

  /** Selects a step of a track; its part becomes the edited one. */
  selectStep(track: number, step: number): void {
    this.selStep = step;
    this.entryHeld.clear();
    if (this.lockStep) this.lockStep = { track, step };
    if (track !== this.editPart) this.selectPart(track);
    else if (this.lockStep) this.syncControls();
    else this.notifyParts();
  }

  /** Holds the selected step: controls now show and lock its values (off with `releaseStep`). */
  holdStep(): void {
    if (this.selStep < 0) return;
    this.lockStep = { track: this.editPart, step: this.selStep };
    this.syncControls();
  }

  releaseStep(): void {
    if (!this.lockStep) return;
    this.lockStep = undefined;
    this.syncControls();
  }

  get holding(): boolean {
    return this.lockStep !== undefined;
  }

  get isRecording(): boolean {
    return this.recording;
  }

  setRecording(on: boolean): void {
    this.recording = on;
    this.entryHeld.clear();
    this.takes.clear();
    this.notifyParts();
  }

  play(): void {
    this.seq.play(this.now());
  }

  stop(): void {
    this.seq.stop(this.now());
    this.takes.clear();
  }

  private heard(): number {
    return this.now() - this.latency();
  }

  /**
   * Writes a played note into the edited part's track. Stopped, with a step selected, it sets the step's notes (a
   * chord is the keys held together), REC or not; with REC the step then moves on. Playing, only with REC.
   */
  private recordOn(note: number, velocity: number): void {
    const track = this.seq.pattern.tracks[this.editPart]!;
    if (this.seq.isPlaying) {
      if (!this.recording) return;
      const near = this.seq.stepNear(this.editPart, this.heard());
      if (!near) return;
      const step = track.steps[near.step]!;
      if (!this.takes.size || !step.notes.length) step.notes = [];
      if (!step.notes.includes(note)) step.notes.push(note);
      step.vel = velocity;
      step.gate = RECORD_GATE;
      this.seq.recorded(this.editPart, near.step, near.tick);
      this.takes.set(note, { step, tick: this.seq.tickAt(this.heard()), clock: track.clock });
    } else {
      if (this.selStep < 0 && !this.recording) return;
      if (this.selStep < 0) this.selStep = 0;
      const step = track.steps[this.selStep]!;
      if (this.entryHeld.size === 0) step.notes = [];
      this.entryHeld.add(note);
      if (!step.notes.includes(note)) step.notes.push(note);
      step.vel = velocity;
    }
    this.seq.notify();
  }

  private recordOff(note: number): void {
    const take = this.takes.get(note);
    if (take) {
      this.takes.delete(note);
      take.step.gate = Math.max(0.25, Math.min(16, Math.round(((this.seq.tickAt(this.heard()) - take.tick) / take.clock) * 4) / 4));
      this.seq.notify();
    }
    if (this.entryHeld.delete(note) && this.entryHeld.size === 0 && this.recording && !this.seq.isPlaying) {
      // the chord is in: on to the next step
      this.selStep = (this.selStep + 1) % this.seq.pattern.tracks[this.editPart]!.length;
      this.notifyParts();
    }
  }

  /** Moves a step's notes by semitones (the chord keeps its shape; nothing goes past 0 or 127). */
  transposeStep(track: number, step: number, semitones: number): void {
    const s = this.seq.pattern.tracks[track]?.steps[step];
    if (!s?.notes.length) return;
    const lo = Math.min(...s.notes), hi = Math.max(...s.notes);
    const by = Math.max(-lo, Math.min(127 - hi, Math.round(semitones)));
    if (!by) return;
    s.notes = s.notes.map((n) => n + by);
    this.seq.notify();
  }

  private syncControls(): void {
    this.syncing = true;
    const lock = this.lockStep ? this.seq.pattern.tracks[this.lockStep.track]!.steps[this.lockStep.step]!.locks : {};
    const params = { ...this.parts[this.editPart]![this.editSide].params, ...lock };
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
    this.edited();
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
    this.release(`k${note}`);
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
        this.release(`${event.channel}:${event.note}`);
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
    this.release(key);
    const sent = parts.map((part) => ({ part, note: note + 12 * this.parts[part]!.octave }));
    for (const s of sent) this.circuit.send('synth', { type: 'on', part: s.part, note: s.note, vel: velocity });
    if (sent.length) this.sounding.set(key, sent);
    const mine = sent.find((s) => s.part === this.editPart);
    if (mine) this.recordOn(mine.note, velocity);
  }

  private release(key: string): void {
    for (const s of this.sounding.get(key) ?? []) {
      this.circuit.send('synth', { type: 'off', part: s.part, note: s.note });
      if (s.part === this.editPart) this.recordOff(s.note);
    }
    this.sounding.delete(key);
  }

  /** Releases everything (the transport's stop), and stops the sequencer. */
  panic(): void {
    this.stop();
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

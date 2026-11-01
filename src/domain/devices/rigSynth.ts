import type { MidiEvent } from '../midi/events';
import { RigSequencer, type RigStep } from '../sequencer/rigSequencer';
import { ChoiceControl, type Control, NumberControl, ToggleControl } from './controls';
import { Device } from './device';
import type { Playable } from './playable';
import { RIG_DEFAULTS, RIG_PARAMS, type RigRoute, type RigSide } from './rigParams';
import { cloneKit, padSoundId, RIG_FIRST_PAD_NOTE, RIG_KITS, RIG_PAD_ORDER, RIG_PADS, type RigKit, type RigPad } from './rigKit';
import { RIG_MIX_DEFAULTS, RIG_MIX_PARAMS } from './rigMix';
import { PEDAL_NAMES, PEDAL_SLOTS, type PedalName, pedalId, pedalParams, pedalSlotIds } from './rigPedals';
import { RIG_MULTI_VERSION, type RigMulti, type RigMultiPart } from './rigMulti';
import { RIG_PRESETS, type RigPreset } from './rigPresets';
import { rigStringPresets, rigStringSetup, sanitiseStrings, type RigStringInstrument, type RigStringPreset, type RigStrings } from './rigStrings';

export const RIG_PARTS = 16;
/** The pool of voices the parts share. */
export const RIG_VOICES = 48;

/** A sound for a kit's pads, as the page makes or loads it. */
export interface RigKitSound {
  rate: number;
  channels: Float32Array[];
}

/** The keyboard bed's middle C plays a kit's first pad. */
const KIT_KEY_SHIFT = 60 - RIG_FIRST_PAD_NOTE;

export type RigPartKind = RigMultiPart['kind'];
export const isStringKind = (kind: string): kind is RigStringInstrument => kind === 'bass' || kind === 'guitar';
/** Whether a part makes a sound at all: a synth with voices, a kit, or a bass or guitar. */
export const partPlays = (pt: { kind: string; voices: number }): boolean => pt.kind !== 'synth' || pt.voices > 0;

/** A step recorded with no note off yet gets this gate. */
const RECORD_GATE = 0.5;
const MOD_WHEEL_CC = 1;
const EXPRESSION_CC = 11;

/** One of the sixteen parts: its sound (sides A and B, or a kit) and where it sits in the multi. */
export interface RigPart {
  name: string;
  /**
   * A synth part plays the voice; a kit part plays its kit's pads (notes 36 to 51); a bass or guitar part plays its
   * strings (`strings`). Only a synth part takes voices from the pool.
   */
  kind: RigPartKind;
  kit?: RigKit;
  strings?: RigStrings;
  /** The preset slot it was loaded from. */
  slot: number;
  /** That sound's name, as last saved or loaded (`toMulti` writes the slot's own). */
  sound?: string;
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
    name: p === 0 ? RIG_PRESETS[0]!.name : '', kind: 'synth', slot: 0, sound: RIG_PRESETS[0]!.name, voices: p === 0 ? RIG_VOICES : 0,
    channel: p === 0 ? 0 : p + 1, lo: 0, hi: 127, octave: 0,
    a: clone(RIG_PRESETS[0]!.a), b: clone(RIG_PRESETS[0]!.a),
  };
}

/**
 * MOA-RIG: a multitimbral synth after the Melbourne Instruments NINA, with sixteen parts instead of four. Each part is
 * a patch on the same voice (`rigWorklet.ts`) and takes a fixed share of a pool of 48 voices. The panel edits one part
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
/** A note's length on a step: its own, or the step's gate. */
export const noteGate = (s: RigStep, note: number): number => s.gates?.[note] ?? s.gate;
const clampGate = (g: number) => Math.round(Math.max(0.25, Math.min(16, g)) * 100) / 100;
const clampVelocity = (v: number) => Math.round(Math.max(0.05, Math.min(1, v)) * 100) / 100;
/** Drops a note's own velocity and length from a step (the note itself already gone). */
function forgetNote(s: RigStep, note: number): void {
  if (s.vels) { delete s.vels[note]; if (!Object.keys(s.vels).length) delete s.vels; }
  if (s.gates) { delete s.gates[note]; if (!Object.keys(s.gates).length) delete s.gates; }
}

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
  private followEdit = false;
  private modWheelValue = 0;
  private readonly noteListeners = new Set<() => void>();
  private readonly performanceListeners = new Set<() => void>();
  private readonly partListeners = new Set<() => void>();
  readonly seq: RigSequencer;
  /** The audio clock, in seconds (set by the page). */
  now: () => number = () => 0;
  /** How long after the audio clock the player hears it (set by the page): a note played live is placed by what was heard. */
  latency: () => number = () => 0;
  /**
   * Makes or loads a pad's sound (set by the page: it renders analogue pads from the MOA-DR and loads the MOA-60's
   * factory kits). Without it kits are silent.
   */
  kitSounds?: (pad: RigPad) => Promise<RigKitSound | undefined>;
  /** Sounds the worklet has, by id, with their rates. */
  private readonly sentSounds = new Map<string, number>();
  /** The mixer and effects: a control per param of `RIG_MIX_PARAMS` (not the edited part's: see `deskControl`). */
  readonly desk: Control[] = [];
  private readonly mixValues: Record<string, number> = { ...RIG_MIX_DEFAULTS };
  private readonly fetching = new Set<string>();
  private padSel = 0;
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
    for (const p of RIG_MIX_PARAMS) {
      const put = (v: number) => this.setMix(p.id, v);
      if (p.kind === 'number') this.desk.push(new NumberControl(p.id, p.label, p.min, p.max, p.def, p.unit ?? '', put, p.curve));
      else if (p.kind === 'choice') this.desk.push(new ChoiceControl(p.id, p.label, p.options!, p.options![p.def]!, (v) => put(p.options!.indexOf(v))));
      else this.desk.push(new ToggleControl(p.id, p.label, p.def > 0, (v) => put(v ? 1 : 0)));
    }
    this.syncing = false;
    this.saveState();
    // a worklet built (or rebuilt) gets every kit's sounds and pads
    c.onReady((id) => {
      if (id !== 'synth') return;
      this.sentSounds.clear();
      this.parts.forEach((_, p) => this.sendKit(p));
    });
  }

  // ---- The mixer ----

  /** A mixer or effect control by id (`p3.fader`, `rA.a`, `dub.time`, `master.fader`). */
  deskControl(id: string): Control {
    if (!this.deskById) this.deskById = new Map(this.desk.map((d) => [d.id, d]));
    const c = this.deskById.get(id);
    if (!c) throw new Error(`Unknown mixer control: ${id}`);
    return c;
  }
  private deskById?: Map<string, Control>;

  /** A mixer value as a number (a choice as its index, a toggle as 0 or 1). */
  deskValue(id: string): number {
    return this.mixValues[id] ?? RIG_MIX_DEFAULTS[id]!;
  }

  private setDesk(id: string, value: number): void {
    const c = this.deskControl(id);
    if (c.kind === 'number') c.set(value);
    else if (c.kind === 'choice') c.set(c.options[Math.round(value)]!);
    else if (c.kind === 'toggle') c.set(value >= 0.5);
  }

  // ---- The pedals (rigPedals.ts): each part's four insert slots ----

  /** Part `part`'s (0-based) slot `slot` (0-based): its type's name. */
  pedalType(part: number, slot: number): PedalName {
    return PEDAL_NAMES[Math.round(this.deskValue(pedalId(part + 1, slot + 1, 'type')))] as PedalName;
  }

  /** Puts a pedal in a slot, switched on, its MIX and knobs at the type's own starting points (OFF empties it). */
  setPedal(part: number, slot: number, type: PedalName): void {
    for (const [id, v] of Object.entries(pedalParams(part + 1, slot + 1, type))) this.setDesk(id, v);
  }

  /** Moves a pedal along its part's chain: the slots between shift over to make room. */
  movePedal(part: number, from: number, to: number): void {
    if (from === to || to < 0 || to >= PEDAL_SLOTS) return;
    const slots = Array.from({ length: PEDAL_SLOTS }, (_, s) => pedalSlotIds(part + 1, s + 1).map((id) => this.deskValue(id)));
    const [moved] = slots.splice(from, 1);
    slots.splice(to, 0, moved!);
    slots.forEach((values, s) => pedalSlotIds(part + 1, s + 1).forEach((id, i) => this.setDesk(id, values[i]!)));
  }

  private setMix(id: string, value: number): void {
    if (this.mixValues[id] === value) return;
    this.mixValues[id] = value;
    this.circuit.send('synth', { type: 'mix', id, value });
    if (this.syncing) return;
    this.saveState();
  }

  /** The mix as a multi keeps it: every value but the momentary ones (the throws). */
  private mixToSave(): Record<string, number> {
    return Object.fromEntries(Object.entries(this.mixValues).filter(([id]) => !id.endsWith('throw')));
  }

  // ---- Kits ----

  /**
   * Makes a part a kit (with the first factory kit if it has none), a bass or a guitar (with its first factory sound if
   * it has none of that instrument), or a synth again. Only a synth keeps its voices.
   */
  setKind(part: number, kind: RigPartKind): void {
    const pt = this.parts[part]!;
    if (pt.kind === kind) return;
    pt.kind = kind;
    if (kind !== 'synth' && pt.voices) this.setVoices(part, 0);
    if (kind === 'kit') {
      pt.kit ??= cloneKit(RIG_KITS[0]!);
      pt.name = pt.kit.name;
    } else if (isStringKind(kind)) {
      if (pt.strings?.instrument !== kind) {
        const first = rigStringPresets(kind)[0]!;
        pt.strings = { instrument: kind, params: { ...first.params } };
        pt.name = first.name;
      }
    }
    this.circuit.send('synth', { type: 'kind', part, kind });
    this.saveState();
    this.sendKit(part);
    this.sendStrings(part);
    this.notifyParts();
  }

  // ---- Bass and guitar parts ----

  /** Loads a factory string sound into a part (making it that instrument's part). */
  loadStrings(part: number, sound: RigStringPreset): void {
    const pt = this.parts[part]!;
    pt.strings = { instrument: sound.instrument, params: { ...sound.params } };
    pt.name = sound.name;
    if (pt.kind !== sound.instrument) this.setKind(part, sound.instrument);
    else { this.sendStrings(part); this.saveState(); this.notifyParts(); }
  }

  /** Sets one of a bass or guitar part's params (a choice as its option's index). */
  setStringParam(part: number, id: string, value: number): void {
    const s = this.parts[part]?.strings;
    if (!s || s.params[id] === value) return;
    s.params[id] = value;
    this.sendStrings(part);
    this.saveState();
    this.notifyParts();
  }

  private sendStrings(part: number): void {
    const pt = this.parts[part]!;
    if (!isStringKind(pt.kind) || !pt.strings) return;
    this.circuit.send('synth', { type: 'strings', part, setup: rigStringSetup(pt.strings) });
  }

  /** Loads a kit into a part (making it a kit part). */
  loadKit(part: number, kit: RigKit): void {
    const pt = this.parts[part]!;
    pt.kit = cloneKit(kit);
    pt.name = kit.name;
    if (pt.kind !== 'kit') this.setKind(part, 'kit');
    else { this.sendKit(part); this.saveState(); this.notifyParts(); }
  }

  /** The edited kit's selected pad. */
  get pad(): number {
    return this.padSel;
  }

  selectPad(pad: number): void {
    this.padSel = Math.max(0, Math.min(RIG_PADS - 1, pad));
    this.notifyParts();
  }

  /** Changes a pad of a kit part; a new sound (another voice, knob or sample) is made and sent. */
  setPad(part: number, pad: number, changes: Partial<RigPad>): void {
    const p = this.parts[part]?.kit?.pads[pad];
    if (!p) return;
    Object.assign(p, changes);
    this.sendPad(part, pad);
    this.saveState();
    this.notifyParts();
  }

  private sendKit(part: number): void {
    const pt = this.parts[part]!;
    if (pt.kind !== 'kit' || !pt.kit) return;
    for (let i = 0; i < pt.kit.pads.length; i++) this.sendPad(part, i);
  }

  /** Sends a pad's settings once its sound is in the worklet (asking the page for the sound first if not). */
  private sendPad(part: number, pad: number): void {
    const p = this.parts[part]?.kit?.pads[pad];
    if (!p) return;
    const id = padSoundId(p);
    const rate = this.sentSounds.get(id);
    if (rate === undefined) { this.fetchSound(id, p); return; }
    this.circuit.send('synth', {
      type: 'pad', part, pad,
      settings: {
        sample: id, start: p.start * rate, end: p.end > p.start ? p.end * rate : 0, tune: p.tune, level: p.level, pan: p.pan,
        attack: 0, decay: p.decay, mode: 'oneshot', reverse: p.reverse, loop: false, group: p.group, velLevel: 1,
        cutoff: p.cutoff, reso: p.reso, velFilter: 0,
      },
    });
  }

  private fetchSound(id: string, pad: RigPad): void {
    if (!this.kitSounds || this.fetching.has(id)) return;
    this.fetching.add(id);
    void this.kitSounds({ ...pad, analog: { ...pad.analog } }).then((sound) => {
      this.fetching.delete(id);
      if (!sound) return;
      this.circuit.send('synth', { type: 'sample', id, rate: sound.rate, channels: sound.channels });
      this.sentSounds.set(id, sound.rate);
      this.parts.forEach((pt, part) => pt.kit?.pads.forEach((p, i) => { if (pt.kind === 'kit' && padSoundId(p) === id) this.sendPad(part, i); }));
      this.dropUnused();
    }, () => this.fetching.delete(id));
  }

  /** Lets the worklet forget sounds no pad plays any more (old renders of a knob being turned). */
  private dropUnused(): void {
    const used = new Set(this.parts.flatMap((pt) => (pt.kind === 'kit' && pt.kit ? pt.kit.pads.map(padSoundId) : [])));
    for (const id of [...this.sentSounds.keys()]) {
      if (!used.has(id)) { this.sentSounds.delete(id); this.circuit.send('synth', { type: 'drop', id }); }
    }
  }

  // ---- Editing ----

  get part(): number {
    return this.editPart;
  }

  get side(): 'a' | 'b' {
    return this.editSide;
  }

  /** Edits another part: the controls move to its sound (and MIDI with it, if it follows the edited part). */
  selectPart(part: number): void {
    const was = this.editPart;
    this.editPart = Math.max(0, Math.min(RIG_PARTS - 1, part));
    if (this.followEdit && was !== this.editPart) {
      // the wheels move over with the keyboard: the part left behind goes back to rest
      for (const [name, value] of [['bend', this.bend], ['mod', this.modWheelValue]] as const) {
        this.circuit.send('synth', { type: 'ctrl', part: was, name, value: 0 });
        this.circuit.send('synth', { type: 'ctrl', part: this.editPart, name, value });
      }
    }
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

  /**
   * MIDI to the edited part: on, notes, bend and wheels from any channel play only the part being edited, whatever
   * its channel and key range; off, every part plays what comes on its channel, within its range. A setting of the
   * machine, not of the multi.
   */
  get midiToEdited(): boolean {
    return this.followEdit;
  }

  set midiToEdited(on: boolean) {
    this.followEdit = on;
    this.notifyParts();
  }

  /** The metronome: a click on each beat while the sequencer plays. A setting of the machine, not of the multi. */
  get metronome(): boolean {
    return this.clickOn;
  }

  set metronome(on: boolean) {
    this.clickOn = on;
    this.notifyParts();
  }
  private clickOn = false;

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
      v: RIG_MULTI_VERSION, name: this.multiName, parts: this.parts.map((pt) => ({ ...pt, sound: this.slots[pt.slot]?.name })), patterns: this.seq.patterns,
      current: this.seq.current, chain: this.seq.chain, tempo: this.bpm, shuffle: this.seq.shuffle, mix: this.mixToSave(),
    });
  }

  /** Loads a multi (sanitised beforehand): stops the sequencer, and the edited part goes back to part 1. */
  loadMulti(m: RigMulti): void {
    this.stop();
    this.multiName = m.name;
    // a part's sound by its name where the save has one (the list may have grown since), else where it was
    const slotOf = (src: RigMultiPart) => {
      if (src.sound && this.slots[src.slot]?.name !== src.sound) {
        const i = this.slots.findIndex((s) => s.name === src.sound);
        if (i >= 0) return i;
      }
      return src.slot < this.slots.length ? src.slot : 0;
    };
    m.parts.forEach((src, p) => {
      Object.assign(this.parts[p]!, copy(src), {
        voices: 0, slot: slotOf(src), kit: src.kit ? copy(src.kit) : undefined,
        strings: isStringKind(src.kind) ? sanitiseStrings(src.strings, src.kind) : undefined,
      });
    });
    // voices last, so a save that asks for more than the pool still gets what fits, in part order
    m.parts.forEach((src, p) => { this.parts[p]!.voices = src.kind !== 'synth' ? 0 : Math.max(0, Math.min(this.freeVoices, src.voices)); });
    this.seq.patterns = copy(m.patterns);
    this.seq.current = m.current;
    this.seq.next = undefined;
    this.seq.chain = [...m.chain];
    this.seq.shuffle = m.shuffle;
    this.bpm = m.tempo;
    this.syncing = true;
    for (const c of this.desk) setControl(c, m.mix[c.id] ?? RIG_MIX_DEFAULTS[c.id]!);
    this.syncing = false;
    this.circuit.send('synth', { type: 'layout', counts: this.parts.map((pt) => pt.voices) });
    this.parts.forEach((pt, p) => {
      this.sendPatch(p);
      this.circuit.send('synth', { type: 'kind', part: p, kind: pt.kind });
      this.sendKit(p);
      this.sendStrings(p);
    });
    this.dropUnused();
    this.editPart = 0;
    this.padSel = 0;
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
    if (this.parts[part]!.kind !== 'synth') voices = 0;
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
      // a synth's first note held replaces the step; a kit adds its hits, so the drums go in a pass at a time
      if (!this.takes.size && this.parts[this.editPart]!.kind !== 'kit') { step.notes = []; delete step.vels; delete step.gates; }
      if (!step.notes.includes(note)) step.notes.push(note);
      // each hit keeps its own velocity (a kit's pads recorded over several passes)
      step.vels = { ...step.vels, [note]: velocity };
      step.gate = RECORD_GATE;
      this.seq.recorded(this.editPart, near.step, near.tick);
      this.takes.set(note, { step, tick: this.seq.tickAt(this.heard()), clock: track.clock });
    } else {
      if (this.selStep < 0 && !this.recording) return;
      if (this.selStep < 0) this.selStep = 0;
      const step = track.steps[this.selStep]!;
      if (this.entryHeld.size === 0) { step.notes = []; delete step.vels; delete step.gates; }
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
      // each note held its own length (a chord's notes let go one by one); the step's gate is the last's
      const gate = Math.max(0.25, Math.min(16, Math.round(((this.seq.tickAt(this.heard()) - take.tick) / take.clock) * 4) / 4));
      take.step.gate = gate;
      if (take.step.notes.length > 1 || take.step.gates) take.step.gates = { ...take.step.gates, [note]: gate };
      this.seq.notify();
    }
    if (this.entryHeld.delete(note) && this.entryHeld.size === 0 && this.recording && !this.seq.isPlaying) {
      // the chord is in: on to the next step
      this.selStep = (this.selStep + 1) % this.seq.pattern.tracks[this.editPart]!.length;
      this.notifyParts();
    }
  }

  /** Plays a note on the edited part to hear it, without writing it anywhere (the drum grid's row names). */
  audition(note: number, on: boolean): void {
    this.circuit.send('synth', on ? { type: 'on', part: this.editPart, note, vel: 0.8 } : { type: 'off', part: this.editPart, note });
  }

  /** Turns a note (a kit's pad) on or off on a step: the drum grid. A hit put in gets the step's velocity. */
  toggleHit(track: number, step: number, note: number): void {
    const s = this.seq.pattern.tracks[track]?.steps[step];
    if (!s) return;
    if (s.notes.includes(note)) {
      s.notes = s.notes.filter((n) => n !== note);
      forgetNote(s, note);
    } else s.notes.push(note);
    this.seq.notify();
  }

  /** Takes a note (a kit's pad) out of every step of a track: clears a row of the drum grid. */
  clearHits(track: number, note: number): void {
    const t = this.seq.pattern.tracks[track];
    if (!t) return;
    for (const s of t.steps) {
      if (!s.notes.includes(note)) continue;
      s.notes = s.notes.filter((n) => n !== note);
      forgetNote(s, note);
    }
    this.seq.notify();
  }

  /**
   * Moves the hits of some rows of the drum grid (pads, 0-15) one pad up (-1) or down (+1) on every step of a track.
   * A row they pass is swapped past them, never overwritten. Returns where the rows went (unchanged at the edge).
   */
  moveRows(track: number, pads: number[], dir: -1 | 1): number[] {
    const t = this.seq.pattern.tracks[track];
    // up and down as the rows are shown (RIG_PAD_ORDER), not by pad number
    const at = (pad: number) => RIG_PAD_ORDER.indexOf(pad);
    const sel = [...new Set(pads.map(at))].sort((x, y) => (x - y) * -dir); // the row leading the way moves first
    if (!t || !sel.length || sel.some((q) => q < 0 || q + dir < 0 || q + dir >= RIG_PADS)) return pads;
    const row = Array.from({ length: RIG_PADS }, (_, q) => q); // row[q]: the row whose hits end up in row q
    for (const q of sel) [row[q], row[q + dir]] = [row[q + dir]!, row[q]!];
    const note = (q: number) => RIG_FIRST_PAD_NOTE + RIG_PAD_ORDER[q]!;
    const to = new Map(row.map((from, q) => [note(from), note(q)]));
    for (const s of t.steps) {
      s.notes = s.notes.map((n) => to.get(n) ?? n);
      if (s.vels) s.vels = Object.fromEntries(Object.entries(s.vels).map(([n, v]) => [to.get(Number(n)) ?? Number(n), v]));
      if (s.gates) s.gates = Object.fromEntries(Object.entries(s.gates).map(([n, g]) => [to.get(Number(n)) ?? Number(n), g]));
    }
    this.seq.notify();
    return sel.map((q) => RIG_PAD_ORDER[q + dir]!).sort((x, y) => at(x) - at(y));
  }

  /** A hit's own velocity, 0..1. */
  setHitVelocity(track: number, step: number, note: number, velocity: number): void {
    const s = this.seq.pattern.tracks[track]?.steps[step];
    if (!s?.notes.includes(note)) return;
    s.vels = { ...s.vels, [note]: clampVelocity(velocity) };
    this.seq.notify();
  }

  /** Moves a step's notes by semitones (the chord keeps its shape; nothing goes past 0 or 127). */
  transposeStep(track: number, step: number, semitones: number): void {
    const s = this.seq.pattern.tracks[track]?.steps[step];
    if (!s?.notes.length) return;
    const lo = Math.min(...s.notes), hi = Math.max(...s.notes);
    const by = Math.max(-lo, Math.min(127 - hi, Math.round(semitones)));
    if (!by) return;
    s.notes = s.notes.map((n) => n + by);
    if (s.vels) s.vels = Object.fromEntries(Object.entries(s.vels).map(([n, v]) => [Number(n) + by, v]));
    if (s.gates) s.gates = Object.fromEntries(Object.entries(s.gates).map(([n, g]) => [Number(n) + by, g]));
    this.seq.notify();
  }

  // ---- the piano roll: notes with their own lengths and velocities

  /** Puts a note on a step, its own length (steps) and velocity (0..1); a note already there takes them. */
  addNote(track: number, step: number, note: number, gate: number, velocity?: number): void {
    const s = this.seq.pattern.tracks[track]?.steps[step];
    if (!s || note < 0 || note > 127) return;
    if (!s.notes.includes(note)) s.notes.push(note);
    s.gates = { ...s.gates, [note]: clampGate(gate) };
    if (velocity !== undefined) s.vels = { ...s.vels, [note]: clampVelocity(velocity) };
    this.seq.notify();
  }

  /** Takes a note off a step. */
  removeNote(track: number, step: number, note: number): void {
    const s = this.seq.pattern.tracks[track]?.steps[step];
    if (!s?.notes.includes(note)) return;
    s.notes = s.notes.filter((n) => n !== note);
    forgetNote(s, note);
    this.seq.notify();
  }

  /** A note's own length, in steps (0.25 to 16). */
  setNoteGate(track: number, step: number, note: number, gate: number): void {
    const s = this.seq.pattern.tracks[track]?.steps[step];
    if (!s?.notes.includes(note)) return;
    s.gates = { ...s.gates, [note]: clampGate(gate) };
    this.seq.notify();
  }

  /** Moves a note to another step and pitch, with its length and velocity; onto a note already there, it replaces it. */
  moveNote(track: number, step: number, note: number, toStep: number, toNote: number): void {
    const t = this.seq.pattern.tracks[track];
    const s = t?.steps[step], d = t?.steps[toStep];
    if (!s?.notes.includes(note) || !d || toNote < 0 || toNote > 127 || (step === toStep && note === toNote)) return;
    const gate = noteGate(s, note), velocity = s.vels?.[note] ?? s.vel;
    s.notes = s.notes.filter((n) => n !== note);
    forgetNote(s, note);
    if (!d.notes.includes(toNote)) d.notes.push(toNote);
    d.gates = { ...d.gates, [toNote]: gate };
    d.vels = { ...d.vels, [toNote]: velocity };
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
      kinds: this.parts.map((pt) => pt.kind),
      strings: this.parts.map((pt) => (isStringKind(pt.kind) && pt.strings ? rigStringSetup(pt.strings) : null)),
      mix: this.mixValues,
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
    this.start(`k${note}`, [this.editPart], this.parts[this.editPart]!.kind === 'kit' ? note - KIT_KEY_SHIFT : note, 0.8);
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
        const parts = this.followEdit ? [this.editPart] : this.parts.flatMap((pt, i) =>
          partPlays(pt) && (pt.channel === 0 || pt.channel === event.channel) && event.note >= pt.lo && event.note <= pt.hi ? [i] : []);
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
    const sent = parts.map((part) => ({ part, note: this.parts[part]!.kind === 'kit' ? note : note + 12 * this.parts[part]!.octave }));
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

  /** The wheels go to every part, or only to the edited one when MIDI follows it. */
  private sendControl(name: string, value: number): void {
    if (this.followEdit) { this.circuit.send('synth', { type: 'ctrl', part: this.editPart, name, value }); return; }
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

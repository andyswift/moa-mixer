import { BAR_TICKS, QUADRUPLETS, TRIPLETS, divisionIndex, nearestDivision, stepDivision } from './division';
import { SequencerEngine } from './engine';
import { GROOVES } from './grooves';
import { SCALES, inScale } from './scales';
import {
  type Bank, INFINITE_REPEATS, MAX_PITCH_NOTES, MAX_REPEATS, MAX_STEPS, MAX_TEMPO, MIN_TEMPO, PATTERNS, type Pattern,
  type StepValues, type TrackParams, TRACKS, clonePattern, cloneTrack, newPattern, newTrack, patternEdited, sanitiseTrack,
} from './track';
import { euclid, rotate } from './euclid';

export type PadColor =
  | 'off' | 'orange' | 'blue' | 'blueGrey' | 'dimBlue' | 'white' | 'pink' | 'green' | 'darkGreen' | 'red'
  | 'darkBlue' | 'brightBlue' | 'cyan' | 'magenta';

export interface Pad {
  color: PadColor;
  /** Printed hint for contextual views (a note name, a division, a scale). */
  label?: string;
  flash?: boolean;
}

/** What the knobs and pads are showing: a parameter, or one of the overview pages. */
export type ViewId =
  | 'tracks' | 'steps' | 'pulses' | 'cycles' | 'division' | 'time' | 'velocity' | 'probability' | 'accent' | 'groove'
  | 'sustain' | 'timing' | 'delay' | 'repeats' | 'offset' | 'pace' | 'pitch' | 'harmony' | 'scale' | 'root' | 'length'
  | 'quantize' | 'tempo' | 'channel' | 'bank' | 'pattern' | 'mute';

export type HoldKey = 'bank' | 'pattern' | 'mute' | 'temp' | 'clear';

/** Where banks live between sessions. */
export interface BankStore {
  load(slot: number): Bank | undefined;
  save(slot: number, bank: Bank): void;
  /** Which of the 16 bank slots hold a saved bank. */
  saved(): boolean[];
}

const NOTE_NAMES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];
/** The chromatic keyboard on the pads: black keys on the top row, white keys below, octave buttons at both ends. */
const KEY_PAD: Record<number, number> = { 2: 1, 3: 3, 5: 6, 6: 8, 7: 10, 9: 0, 10: 2, 11: 4, 12: 5, 13: 7, 14: 9, 15: 11 };
const BASE_NOTE = 60; // C3 on the T-1's scale of names: the default octave page

const clamp = (v: number, lo: number, hi: number): number => Math.min(hi, Math.max(lo, v));
/** Pad index 0-15 as a bipolar value: the top row runs -1 to 0 and the bottom row 0 to +1 (the T-1's left/right halves). */
const bipolar = (i: number): number => (i < 8 ? -(7 - i) / 7 : (i - 8) / 7);
const unipolar16 = (i: number): number => (i + 1) / 16;

interface Num { key: keyof StepValues; min: number; max: number; step: number }
const NUMS: Record<string, Num> = {
  velocity: { key: 'velocity', min: 1, max: 127, step: 1 },
  sustain: { key: 'sustain', min: 0, max: 1, step: 0.02 },
  probability: { key: 'probability', min: -1, max: 1, step: 0.02 },
  accent: { key: 'accent', min: -1, max: 1, step: 0.04 },
  timing: { key: 'timing', min: -1, max: 1, step: 0.04 },
  repeats: { key: 'repeats', min: 0, max: INFINITE_REPEATS, step: 1 },
  offset: { key: 'repeatOffset', min: -1, max: 1, step: 0.04 },
  pace: { key: 'repeatPace', min: -1, max: 1, step: 0.04 },
  pitch: { key: 'pitch', min: -24, max: 24, step: 1 },
  harmony: { key: 'harmony', min: -24, max: 24, step: 1 },
};

/** The knob a view belongs to, so the pad view stays on after the knob is let go. */
const SECONDARY: Record<string, ViewId> = {
  pulses: 'pulses', velocity: 'probability', accent: 'groove', timing: 'delay', repeats: 'offset', time: 'pace',
  pitch: 'harmony', scale: 'root', length: 'quantize',
};

/**
 * The T-1's interaction model, without any screen: knobs turn (relative edits) or are pressed (to show a
 * parameter on the pads), Ctrl switches to the secondary functions, and the sixteen pads set values absolutely or
 * pick tracks, patterns and banks depending on the view. The UI only draws `pads()` and forwards presses.
 */
export class SequencerController {
  selected: number[] = [0];
  /** Locked view (double press), if any. */
  locked: ViewId | undefined;
  /** View shown while a knob is held. */
  momentary: ViewId | undefined;
  ctrlLatch = false;
  ctrlKey = false;
  readonly held = new Set<HoldKey>();
  /** Pad pages: octave of the pitch keyboard, repeats range, step page, and the steps being locked. */
  pitchPage = 0;
  repeatsPage = 0;
  stepsPage = 0;
  stepEdit: number[] = [];
  bankSlot = 0;
  /** Counts pad presses, so a hold pad can tell a tap from a hold-and-press. */
  padCount = 0;
  readonly flashes: number[] = new Array<number>(TRACKS).fill(0);
  /** Last thing touched, for the readout. */
  last = { name: 'steps', value: '16' };
  private clipboard: { kind: 'track'; track: TrackParams } | { kind: 'pattern'; pattern: Pattern } | undefined;
  private pendingMute: Set<number> | undefined;
  private tempSnapshot: Map<number, TrackParams> | undefined;
  private chainPresses: number[] = [];
  private readonly listeners = new Set<() => void>();
  private edited = new Set<number>();

  constructor(readonly engine: SequencerEngine, private readonly store?: BankStore) {}

  get bank(): Bank {
    return this.engine.bank;
  }
  get pattern(): Pattern {
    return this.engine.pattern;
  }
  get track(): TrackParams {
    return this.pattern.tracks[this.selected[0] ?? 0]!;
  }
  get ctrl(): boolean {
    return this.ctrlLatch || this.ctrlKey;
  }

  onChange(fn: () => void): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }
  private emit(): void {
    for (const l of this.listeners) l();
  }

  // ---------------------------------------------------------------- view

  /** The view the pads are showing right now. */
  get view(): ViewId {
    if (this.held.has('bank')) return 'bank';
    if (this.held.has('pattern')) return 'pattern';
    if (this.held.has('mute')) return 'mute';
    return this.momentary ?? this.locked ?? 'tracks';
  }

  /** Back to the home track view (the T-1's Bank button when nothing is held). */
  home(): void {
    this.locked = undefined;
    this.momentary = undefined;
    this.stepEdit = [];
    this.emit();
  }

  // ---------------------------------------------------------------- knobs

  private target(): TrackParams[] {
    return this.selected.map((i) => this.pattern.tracks[i]!);
  }

  private markEdited(): void {
    this.edited.add(this.bankSlot);
  }

  /** Is the bank slot changed since it was saved or loaded? */
  isUnsaved(slot = this.bankSlot): boolean {
    return this.edited.has(slot);
  }

  /** A knob went down: show its parameter (the secondary one with Ctrl). */
  knobDown(id: string): void {
    const view = this.ctrl && SECONDARY[id] ? SECONDARY[id]! : (id as ViewId);
    if (this.held.has('clear')) {
      this.resetParam(view);
      return;
    }
    this.momentary = view;
    this.emit();
  }

  knobUp(): void {
    this.momentary = undefined;
    this.emit();
  }

  /** Double press: keep the pad view after the knob is let go. */
  knobLock(id: string): void {
    const view = this.ctrl && SECONDARY[id] ? SECONDARY[id]! : (id as ViewId);
    this.locked = this.locked === view ? undefined : view;
    this.emit();
  }

  /** Turn a knob by `delta` clicks (positive clockwise). Ctrl turns the secondary function. */
  knobTurn(id: string, delta: number): void {
    if (delta === 0) return;
    const ctrl = this.ctrl;
    const view = ctrl && SECONDARY[id] ? SECONDARY[id]! : (id as ViewId);
    this.momentary ??= undefined;
    const all = this.held.has('pattern');
    const tracks = all ? this.pattern.tracks : this.target();
    if (this.held.has('temp')) this.snapshotTemp(tracks);
    for (const t of tracks) this.turn(t, view, id, ctrl, delta);
    this.markEdited();
    this.last = { name: view, value: this.valueText(view, tracks[0]!) };
    this.emit();
  }

  private lockedStep(t: TrackParams, key: keyof StepValues, apply: (current: number) => number): boolean {
    if (this.stepEdit.length === 0) return false;
    for (const s of this.stepEdit) {
      const lock = (t.locks[s] ??= { pulse: true });
      const current = (lock[key] as number | undefined) ?? (t[key] as number);
      (lock as Record<string, number>)[key] = apply(current);
    }
    return true;
  }

  private turn(t: TrackParams, view: ViewId, id: string, ctrl: boolean, delta: number): void {
    const n = NUMS[view];
    if (n) {
      const step = (cur: number): number => {
        const next = cur + delta * n.step;
        const rounded = n.step >= 1 ? Math.round(next) : Math.round(next / n.step) * n.step;
        return clamp(Math.round(rounded * 1000) / 1000, n.min, n.max);
      };
      if (!this.lockedStep(t, n.key, step)) (t[n.key] as number) = step(t[n.key] as number);
      return;
    }
    switch (view) {
      case 'steps':
        t.steps = clamp(t.steps + delta, 1, ctrl ? MAX_STEPS : Math.max(16, t.steps));
        t.pulses = Math.min(t.pulses, t.steps);
        break;
      case 'pulses':
        if (id === 'pulses' && !ctrl) t.pulses = clamp(t.pulses + delta, 0, t.steps);
        else t.rotate = (t.rotate + delta + t.steps * 1000) % t.steps;
        break;
      case 'cycles':
        t.cycles = clamp(t.cycles + delta, 1, 16);
        break;
      case 'division':
        if (ctrl) t.division = clamp(t.division + delta, 1, BAR_TICKS);
        else {
          let ticks = t.division;
          for (let i = 0; i < Math.abs(delta); i++) ticks = stepDivision(ticks, delta);
          t.division = ticks;
        }
        break;
      case 'time': {
        let ticks = t.repeatTime;
        for (let i = 0; i < Math.abs(delta); i++) ticks = stepDivision(ticks, delta);
        const apply = () => ticks;
        if (!this.lockedStep(t, 'repeatTime', apply)) t.repeatTime = ticks;
        break;
      }
      case 'groove':
        t.groove = (t.groove + delta + GROOVES.length * 100) % GROOVES.length;
        break;
      case 'delay':
        t.delay = clamp(t.delay + delta * 2, -BAR_TICKS / 2, BAR_TICKS / 2);
        break;
      case 'scale':
        t.scale = (t.scale + delta + SCALES.length * 100) % SCALES.length;
        break;
      case 'root':
        t.root = (t.root + delta + 1200) % 12;
        break;
      case 'length': {
        const opts = LENGTHS;
        const at = opts.findIndex((o) => o === t.length);
        t.length = opts[clamp((at < 0 ? 0 : at) + delta, 0, opts.length - 1)]!;
        break;
      }
      case 'quantize': {
        const at = QUANTIZES.findIndex((o) => o === this.pattern.quantize);
        this.pattern.quantize = QUANTIZES[clamp((at < 0 ? 3 : at) + delta, 0, QUANTIZES.length - 1)]!;
        break;
      }
      case 'tempo':
        this.engine.bank.tempo = clamp(this.engine.bank.tempo + delta, MIN_TEMPO, MAX_TEMPO);
        break;
      case 'channel':
        t.channel = clamp(t.channel + delta, 1, 16);
        break;
      default:
        break;
    }
  }

  private resetParam(view: ViewId): void {
    const fresh = newTrack();
    for (const t of this.target()) {
      const n = NUMS[view];
      if (n) (t[n.key] as number | number[]) = fresh[n.key] as number;
      else if (view === 'steps') t.steps = 16;
      else if (view === 'pulses') { t.pulses = 0; t.rotate = 0; }
      else if (view === 'division') t.division = fresh.division;
      else if (view === 'groove') t.groove = 0;
      else if (view === 'scale') t.scale = 0;
      else if (view === 'root') t.root = 0;
      else if (view === 'length') t.length = 0;
      else if (view === 'channel') t.channel = fresh.channel;
      else if (view === 'delay') t.delay = 0;
    }
    this.markEdited();
    this.emit();
  }

  // ---------------------------------------------------------------- readout

  valueText(view: ViewId, t: TrackParams = this.track): string {
    const pct = (v: number): string => `${Math.round(v * 100)}%`;
    switch (view) {
      case 'steps': return String(t.steps);
      case 'pulses': return `${t.pulses}${t.rotate ? ` rot ${t.rotate}` : ''}`;
      case 'cycles': return String(t.cycles);
      case 'division': return divisionIndex(t.division) >= 0 ? nearestDivision(t.division).label : `${t.division}t`;
      case 'time': return divisionIndex(t.repeatTime) >= 0 ? nearestDivision(t.repeatTime).label : `${t.repeatTime}t`;
      case 'velocity': return String(t.velocity);
      case 'probability': return pct(t.probability);
      case 'accent': return pct(t.accent);
      case 'groove': return GROOVES[t.groove]!.name;
      case 'sustain': return pct(t.sustain);
      case 'timing': return pct(t.timing);
      case 'delay': return `${t.delay}t`;
      case 'repeats': return t.repeats >= INFINITE_REPEATS ? 'inf' : String(t.repeats);
      case 'offset': return pct(t.repeatOffset);
      case 'pace': return pct(t.repeatPace);
      case 'pitch': return t.pitchNotes.map(noteName).join(' ') || '-';
      case 'harmony': return String(t.harmony);
      case 'scale': return SCALES[t.scale]!.name;
      case 'root': return NOTE_NAMES[t.root]!;
      case 'length': return t.length === 0 ? 'inf' : lengthLabel(t.length);
      case 'quantize': return lengthLabel(this.pattern.quantize);
      case 'tempo': return `${this.bank.tempo} bpm`;
      case 'channel': return String(t.channel);
      default: return '';
    }
  }

  // ---------------------------------------------------------------- pads

  /** The sixteen pads for the current view. */
  pads(playheadStep = -1): Pad[] {
    const blank = (): Pad[] => Array.from({ length: 16 }, () => ({ color: 'off' as PadColor }));
    const t = this.track;
    const p = blank();
    const view = this.view;
    const level = (v01: number, color: PadColor = 'blueGrey'): void => {
      const lit = Math.round(v01 * 16);
      for (let i = 0; i < 16; i++) p[i] = { color: i < lit ? color : 'off' };
    };
    const pick = (selected: number, count = 16, color: PadColor = 'blue'): void => {
      for (let i = 0; i < count; i++) p[i] = { color: i === selected ? 'white' : color };
    };
    switch (view) {
      case 'tracks':
        for (let i = 0; i < TRACKS; i++) {
          const sel = this.selected.includes(i);
          const muted = this.pattern.tracks[i]!.muted;
          p[i] = { color: muted ? 'blueGrey' : sel ? 'orange' : 'off', flash: this.flashes[i]! > 0 && !muted };
        }
        break;
      case 'mute':
        for (let i = 0; i < TRACKS; i++) {
          const muted = (this.pendingMute ?? new Set(this.pattern.tracks.flatMap((x, j) => (x.muted ? [j] : [])))).has(i);
          p[i] = { color: muted ? 'blueGrey' : 'off' };
        }
        break;
      case 'steps':
      case 'pulses': {
        const euc = rotate(euclid(t.pulses, t.steps), t.rotate);
        const man = rotate(t.manual.slice(0, t.steps), t.rotate);
        for (let i = 0; i < 16; i++) {
          const s = this.stepsPage * 16 + i;
          if (s >= t.steps) continue;
          const pulse = euc[s] || man[s] || t.locks[s]?.pulse;
          const locked = t.locks[s] && Object.keys(t.locks[s]!).some((k) => k !== 'pulse');
          const color: PadColor = view === 'steps'
            ? (pulse ? 'blueGrey' : 'dimBlue')
            : (pulse ? 'orange' : 'blueGrey');
          p[i] = { color: s === playheadStep ? 'white' : this.stepEdit.includes(s) ? 'red' : locked && pulse ? 'red' : color, flash: this.stepEdit.includes(s) };
        }
        break;
      }
      case 'division':
      case 'time': {
        const ticks = view === 'division' ? t.division : t.repeatTime;
        QUADRUPLETS.forEach((d, i) => { p[i] = { color: d.ticks === ticks ? 'white' : 'blueGrey', label: d.label }; });
        TRIPLETS.forEach((d, i) => { p[10 + i] = { color: d.ticks === ticks ? 'white' : 'blue', label: d.label }; });
        if (divisionIndex(ticks) < 0) p[7] = { color: 'white', flash: true };
        break;
      }
      case 'velocity': level(t.velocity / 127); break;
      case 'sustain': level(t.sustain); break;
      case 'tempo': level((this.bank.tempo - MIN_TEMPO) / (MAX_TEMPO - MIN_TEMPO)); break;
      case 'channel': pick(t.channel - 1, 16, 'blueGrey'); break;
      case 'probability':
      case 'accent':
      case 'timing':
      case 'offset':
      case 'pace': {
        const v = this.num(view, t);
        for (let i = 0; i < 16; i++) p[i] = { color: 'off' };
        // the pad nearest the value is white; the run from the middle to it is orange
        const idx = Math.round(v >= 0 ? 8 + v * 7 : 7 + v * 7);
        const mid = v >= 0 ? 8 : 7;
        for (let i = Math.min(mid, idx); i <= Math.max(mid, idx); i++) p[i] = { color: 'orange' };
        p[idx] = { color: 'white' };
        break;
      }
      case 'delay': {
        const idx = Math.round(clamp(t.delay / (BAR_TICKS / 2), -1, 1) * 7 + (t.delay >= 0 ? 8 : 7));
        p[clamp(idx, 0, 15)] = { color: 'white' };
        break;
      }
      case 'groove':
        for (let i = 0; i < 8; i++) {
          const pad = i < 4 ? i : i + 4;
          p[pad] = { color: i === t.groove ? 'white' : 'darkGreen', label: GROOVES[i]!.name };
        }
        break;
      case 'repeats': {
        const first = this.repeatsPage * 7;
        for (let i = 0; i < 7; i++) {
          const n = first + i;
          p[i] = { color: n > MAX_REPEATS ? 'off' : t.repeats === n ? 'white' : 'blueGrey', label: String(n) };
        }
        for (let i = 0; i < 7; i++) p[8 + i] = { color: i === this.repeatsPage ? 'white' : 'orange', label: `${i * 7}-${i * 7 + 6}` };
        if (this.repeatsPage === 6) p[6] = { color: t.repeats >= INFINITE_REPEATS ? 'white' : 'brightBlue', label: 'inf' };
        p[7] = { color: t.repeatMode === 'choke' ? 'pink' : 'darkGreen', label: 'choke' };
        p[15] = { color: t.repeatMode === 'tail' ? 'pink' : 'darkGreen', label: 'tail' };
        break;
      }
      case 'pitch':
      case 'harmony':
      case 'root': {
        const root = view === 'root';
        for (const [padIndex, pc] of Object.entries(KEY_PAD)) {
          const note = BASE_NOTE + this.pitchPage * 12 + pc;
          const ok = root || inScale(note, t.scale, t.root, t.userScale);
          const on = root ? pc === t.root : t.pitchNotes.includes(note);
          const black = [1, 3, 6, 8, 10].includes(pc);
          p[Number(padIndex) - 1 + (Number(padIndex) > 8 ? 0 : 0)] = {
            color: !ok ? 'blueGrey' : root ? (on ? 'pink' : black ? 'blue' : 'white') : on ? 'orange' : black ? 'blue' : 'white',
            label: NOTE_NAMES[pc],
          };
        }
        p[7] = { color: 'pink', label: 'oct+' };
        p[15] = { color: 'pink', label: 'oct-' };
        break;
      }
      case 'scale':
        SCALES.forEach((s, i) => { p[8 + i] = { color: i === t.scale ? 'white' : i === 7 ? 'pink' : 'blue', label: s.name }; });
        break;
      case 'length': {
        for (let i = 0; i < 8; i++) p[i] = { color: lengthOf(i) === t.length ? 'white' : 'green', label: String(i + 1) };
        p[15] = { color: t.length === 16 * BAR_TICKS ? 'white' : 'green', label: '16' };
        p[8] = { color: t.length === 0 ? 'white' : 'brightBlue', label: 'inf' };
        LENGTH_FRACTIONS.forEach((ticks, i) => { p[9 + i] = { color: t.length === ticks ? 'white' : 'darkGreen', label: nearestDivision(ticks).label }; });
        break;
      }
      case 'quantize': {
        for (let i = 0; i < 8; i++) p[i] = { color: (i + 1) * BAR_TICKS === this.pattern.quantize ? 'white' : 'green', label: String(i + 1) };
        p[15] = { color: this.pattern.quantize === 16 * BAR_TICKS ? 'white' : 'green', label: '16' };
        [BAR_TICKS / 2, BAR_TICKS / 4, BAR_TICKS / 8].forEach((ticks, i) => { p[10 + i] = { color: this.pattern.quantize === ticks ? 'white' : 'darkGreen', label: nearestDivision(ticks).label }; });
        break;
      }
      case 'cycles':
        for (let i = 0; i < 16; i++) p[i] = { color: i < t.cycles ? 'blueGrey' : 'off', label: String(i + 1) };
        break;
      case 'pattern': {
        const chain = this.engine.chain;
        for (let i = 0; i < PATTERNS; i++) {
          const edited = patternEdited(this.bank.patterns[i]!);
          p[i] = {
            color: i === this.engine.patternIndex ? 'white' : chain.length > 1 && chain.includes(i) ? 'brightBlue' : edited ? 'blue' : 'darkBlue',
            flash: this.engine.playing && i === this.engine.patternIndex,
          };
        }
        break;
      }
      case 'bank': {
        const saved = this.store?.saved() ?? [];
        for (let i = 0; i < 16; i++) {
          p[i] = { color: i === this.bankSlot ? (this.isUnsaved(i) ? 'pink' : 'white') : this.isUnsaved(i) ? 'pink' : saved[i] ? 'green' : 'darkGreen' };
        }
        break;
      }
      default:
        break;
    }
    return p;
  }

  private num(view: string, t: TrackParams): number {
    return t[NUMS[view]!.key] as number;
  }

  /** Presses (or lets go of) pad `i` (0-15). */
  pad(i: number, down: boolean): void {
    const view = this.view;
    if (!down) {
      if (view === 'pattern' && this.chainPresses.length > 1) this.engine.setChain([...this.chainPresses]);
      this.chainPresses = [];
      return;
    }
    this.padCount += 1;
    const t = this.track;
    const tracks = this.held.has('pattern') ? this.pattern.tracks : this.target();
    const forAll = (fn: (x: TrackParams) => void) => {
      for (const x of this.stepEdit.length ? this.target() : tracks) fn(x);
      this.markEdited();
    };
    const set = (key: keyof StepValues, value: number) => {
      for (const x of this.target()) {
        if (this.stepEdit.length > 0) for (const s of this.stepEdit) ((x.locks[s] ??= { pulse: true }) as Record<string, number>)[key] = value;
        else (x[key] as number) = value;
      }
      this.markEdited();
    };
    switch (view) {
      case 'tracks': {
        if (this.held.has('clear')) {
          const clip = this.clipboard;
          if (clip?.kind === 'track') this.pattern.tracks[i] = { ...cloneTrack(clip.track), channel: this.pattern.tracks[i]!.channel };
          else this.pattern.tracks[i] = newTrack(this.pattern.tracks[i]!.channel);
          this.markEdited();
        } else if (this.ctrl) {
          this.cycleTrackMode(i);
        } else if (this.held.has('temp')) {
          this.selected = this.selected.includes(i) ? this.selected : [...this.selected, i];
        } else this.selectTrack(i, false);
        break;
      }
      case 'mute': {
        const pending = (this.pendingMute ??= new Set(this.pattern.tracks.flatMap((x, j) => (x.muted ? [j] : []))));
        if (pending.has(i)) pending.delete(i);
        else pending.add(i);
        if (this.ctrl) this.commitMute();
        break;
      }
      case 'steps': {
        const steps = this.stepsPage * 16 + i + 1;
        forAll((x) => { x.steps = steps; x.pulses = Math.min(x.pulses, steps); });
        break;
      }
      case 'pulses': {
        const s = this.stepsPage * 16 + i;
        if (s >= t.steps) break;
        if (this.ctrl) {
          const at = this.stepEdit.indexOf(s);
          if (at >= 0) this.stepEdit.splice(at, 1);
          else this.stepEdit.push(s);
          for (const x of this.target()) (x.locks[s] ??= { pulse: true }).pulse = true;
        } else if (this.held.has('clear')) {
          for (const x of this.target()) { delete x.locks[s]; x.manual[s] = false; }
          this.stepEdit = this.stepEdit.filter((e) => e !== s);
        } else {
          for (const x of this.target()) {
            const pos = (s - x.rotate + x.steps * 1000) % x.steps;
            const lock = x.locks[s];
            if (lock?.pulse) lock.pulse = false;
            else x.manual[pos] = !x.manual[pos];
          }
        }
        this.markEdited();
        break;
      }
      case 'division':
      case 'time': {
        const ticks = i < 7 ? QUADRUPLETS[i]?.ticks : i >= 10 && i <= 14 ? TRIPLETS[i - 10]?.ticks : undefined;
        if (ticks === undefined) break;
        if (view === 'division') forAll((x) => { x.division = ticks; });
        else set('repeatTime', ticks);
        break;
      }
      case 'velocity': set('velocity', Math.round(1 + (i * 126) / 15)); break;
      case 'sustain': set('sustain', unipolar16(i)); break;
      case 'probability': set('probability', bipolar(i)); break;
      case 'accent': set('accent', bipolar(i)); break;
      case 'timing': set('timing', bipolar(i)); break;
      case 'offset': set('repeatOffset', bipolar(i)); break;
      case 'pace': set('repeatPace', bipolar(i)); break;
      case 'delay': forAll((x) => { x.delay = Math.round(bipolar(i) * (BAR_TICKS / 8)); }); break;
      case 'tempo': this.engine.bank.tempo = Math.round(MIN_TEMPO + (i * (MAX_TEMPO - MIN_TEMPO)) / 15); this.markEdited(); break;
      case 'channel': forAll((x) => { x.channel = i + 1; }); break;
      case 'groove': {
        const g = i < 4 ? i : i >= 8 && i < 12 ? i - 4 : -1;
        if (g >= 0) forAll((x) => { x.groove = g; });
        break;
      }
      case 'repeats': {
        if (i === 7) { forAll((x) => { x.repeatMode = 'choke'; }); break; }
        if (i === 15) { forAll((x) => { x.repeatMode = 'tail'; }); break; }
        if (i >= 8 && i <= 14) { this.repeatsPage = i - 8; break; }
        if (i < 7) {
          const n = this.repeatsPage * 7 + i;
          if (this.repeatsPage === 6 && i === 6) set('repeats', INFINITE_REPEATS);
          else if (n <= MAX_REPEATS) set('repeats', n);
        }
        break;
      }
      case 'pitch':
      case 'harmony': {
        if (i === 7) { this.pitchPage = clamp(this.pitchPage + 1, -5, 5); break; }
        if (i === 15) { this.pitchPage = clamp(this.pitchPage - 1, -5, 5); break; }
        const pc = KEY_PAD[i + 1];
        if (pc === undefined) break;
        const note = BASE_NOTE + this.pitchPage * 12 + pc;
        for (const x of this.target()) {
          if (!inScale(note, x.scale, x.root, x.userScale)) continue;
          if (this.held.has('clear')) x.pitchNotes = [note];
          else if (x.pitchNotes.includes(note)) x.pitchNotes = x.pitchNotes.filter((n) => n !== note);
          else if (x.pitchNotes.length < MAX_PITCH_NOTES) x.pitchNotes = [...x.pitchNotes, note].sort((a, b) => a - b);
        }
        this.markEdited();
        break;
      }
      case 'root': {
        const pc = KEY_PAD[i + 1];
        if (pc !== undefined) forAll((x) => { x.root = pc; });
        break;
      }
      case 'scale':
        if (i >= 8) forAll((x) => { x.scale = i - 8; });
        break;
      case 'length': {
        const ticks = i < 8 ? lengthOf(i) : i === 15 ? 16 * BAR_TICKS : i === 8 ? 0 : LENGTH_FRACTIONS[i - 9];
        if (ticks !== undefined) forAll((x) => { x.length = ticks; });
        break;
      }
      case 'quantize': {
        const ticks = i < 8 ? (i + 1) * BAR_TICKS : i === 15 ? 16 * BAR_TICKS : i >= 10 && i <= 12 ? [BAR_TICKS / 2, BAR_TICKS / 4, BAR_TICKS / 8][i - 10] : undefined;
        if (ticks !== undefined) { this.pattern.quantize = ticks; this.markEdited(); }
        break;
      }
      case 'cycles': forAll((x) => { x.cycles = i + 1; }); break;
      case 'pattern': {
        if (this.held.has('clear')) {
          const clip = this.clipboard;
          this.bank.patterns[i] = clip?.kind === 'pattern' ? clonePattern(clip.pattern) : newPattern();
          this.markEdited();
        } else {
          this.chainPresses.push(i);
          if (this.chainPresses.length === 1) this.engine.queue(i);
        }
        break;
      }
      case 'bank': {
        if (this.ctrl) this.saveBank(i);
        else this.loadBank(i);
        break;
      }
      default:
        break;
    }
    this.emit();
  }

  // ---------------------------------------------------------------- tracks, patterns, banks

  private selectTrack(i: number, additive: boolean): void {
    if (additive) this.selected = this.selected.includes(i) ? this.selected.filter((x) => x !== i) : [...this.selected, i];
    else this.selected = [i];
    if (this.selected.length === 0) this.selected = [i];
    this.last = { name: `track ${this.selected[0]! + 1}`, value: `ch ${this.track.channel}` };
  }

  /** Several tracks at once (the T-1's hold one track pad and press another). */
  addTrack(i: number): void {
    this.selectTrack(i, true);
    this.emit();
  }

  private cycleTrackMode(i: number): void {
    // note, CC and FX tracks arrive in a later round; for now Ctrl + a track pad just selects it
    this.selectTrack(i, false);
  }

  private commitMute(): void {
    if (!this.pendingMute) return;
    this.pattern.tracks.forEach((t, i) => { t.muted = this.pendingMute!.has(i); });
    this.pendingMute = undefined;
    this.markEdited();
  }

  loadBank(slot: number): void {
    const bank = this.store?.load(slot);
    this.bankSlot = slot;
    if (bank) this.engine.bank = bank;
    else this.engine.bank = { ...this.engine.bank, patterns: Array.from({ length: PATTERNS }, newPattern) };
    this.engine.patternIndex = 0;
    this.edited.delete(slot);
    this.held.delete('bank');
    this.held.add('pattern');
  }

  saveBank(slot: number): void {
    this.store?.save(slot, this.bank);
    this.bankSlot = slot;
    this.edited.delete(slot);
  }

  /** The Ctrl pad: latched on or off (holding the Shift key is the other way in). */
  setCtrl(on: boolean): void {
    this.ctrlLatch = on;
    this.emit();
  }

  setCtrlKey(on: boolean): void {
    if (this.ctrlKey === on) return;
    this.ctrlKey = on;
    this.emit();
  }

  // ---------------------------------------------------------------- hold pads and transport

  /** A hold pad went down or up: bank, pattern, mute, temp or clear. */
  hold(key: HoldKey, down: boolean): void {
    if (down) {
      this.held.add(key);
      if (key === 'mute') this.pendingMute = new Set(this.pattern.tracks.flatMap((x, j) => (x.muted ? [j] : [])));
      if (key === 'temp') this.snapshotTemp(this.pattern.tracks);
    } else {
      this.held.delete(key);
      if (key === 'mute') this.commitMute();
      if (key === 'temp') this.restoreTemp();
      if (key === 'bank' && this.view === 'pattern') this.held.delete('pattern');
    }
    this.emit();
  }

  /** Bank pad pressed without a pad press: go home (exit the current mode). */
  tapBank(): void {
    this.home();
  }

  private snapshotTemp(tracks: TrackParams[]): void {
    if (this.tempSnapshot) return;
    this.tempSnapshot = new Map(this.pattern.tracks.map((t, i) => [i, cloneTrack(t)]));
    void tracks;
  }

  private restoreTemp(): void {
    if (!this.tempSnapshot) return;
    for (const [i, t] of this.tempSnapshot) this.pattern.tracks[i] = sanitiseTrack(t);
    this.tempSnapshot = undefined;
  }

  /** The Clear pad with Ctrl is Copy: copies the selected track (or the current pattern in pattern view). */
  copy(): void {
    if (this.view === 'pattern') this.clipboard = { kind: 'pattern', pattern: clonePattern(this.pattern) };
    else this.clipboard = { kind: 'track', track: cloneTrack(this.track) };
    this.emit();
  }

  /** Empties the clipboard (double tap on Clear). */
  clearClipboard(): void {
    this.clipboard = undefined;
    this.emit();
  }

  get hasClipboard(): boolean {
    return this.clipboard !== undefined;
  }

  /** Notes fired on a track light its pad; the UI decays the counter. */
  flash(track: number): void {
    this.flashes[track] = 6;
  }

  decayFlashes(): void {
    for (let i = 0; i < TRACKS; i++) if (this.flashes[i]! > 0) this.flashes[i] = this.flashes[i]! - 1;
  }

  /** Steps-pad pages (steps beyond 16). */
  setStepsPage(page: number): void {
    this.stepsPage = clamp(page, 0, 3);
    this.emit();
  }

  /** Per-step edit mode ends. */
  exitStepEdit(): void {
    this.stepEdit = [];
    this.emit();
  }

  /** The pulses of the selected track on one page of steps, for the readout dots. */
  pulseDots(): boolean[] {
    const t = this.track;
    const euc = rotate(euclid(t.pulses, t.steps), t.rotate);
    const man = rotate(t.manual.slice(0, t.steps), t.rotate);
    return Array.from({ length: t.steps }, (_, s) => Boolean(euc[s] || man[s] || t.locks[s]?.pulse));
  }
}

const noteName = (n: number): string => `${NOTE_NAMES[((n % 12) + 12) % 12]}${Math.floor(n / 12) - 2}`;

const lengthOf = (i: number): number => (i + 1) * BAR_TICKS;
const LENGTH_FRACTIONS = [BAR_TICKS / 2, BAR_TICKS / 4, BAR_TICKS / 8, BAR_TICKS / 16, BAR_TICKS / 32, BAR_TICKS / 64];
const LENGTHS = [0, ...[...LENGTH_FRACTIONS].reverse(), ...Array.from({ length: 8 }, (_, i) => lengthOf(i)), 16 * BAR_TICKS];
const QUANTIZES = [BAR_TICKS / 8, BAR_TICKS / 4, BAR_TICKS / 2, ...Array.from({ length: 8 }, (_, i) => lengthOf(i)), 16 * BAR_TICKS];
const lengthLabel = (ticks: number): string => {
  if (ticks >= BAR_TICKS) return `${ticks / BAR_TICKS} bar`;
  return nearestDivision(ticks).label;
};


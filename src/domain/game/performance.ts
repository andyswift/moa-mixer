import type { NoteEvent } from '../../songs/types';
import { seeded } from '../../songs/feel';
import { GOOD_MS, OK_MS } from './groove';

/**
 * Playing a song's part along with the band. A part becomes cues: everything that starts together (a note, or the
 * three notes of a chord). Each cue is judged once, by how near its beat the player's first note lands and whether
 * every note of it was played (any octave): good within GOOD_MS, close within OK_MS, off further out; a wrong note
 * makes it wrong; a cue nobody played is missed. The same grades and windows as the groove lessons.
 */
export interface Cue {
  readonly t: number;
  readonly len: number;
  /** The notes as written (for showing and for the engine to play). */
  readonly notes: readonly number[];
  /** Their pitch classes, sorted, no repeats: what the player must play. */
  readonly pcs: readonly number[];
  /** A dead note (written at velocity 40 or less): struck with the hand damping the string, any pitch. */
  readonly dead?: boolean;
  /** Played with the palm resting on the strings (the mod wheel up). */
  readonly palm?: boolean;
}

/** Notes this soft or softer are dead notes, as the MOA-BASS plays them. */
export const DEAD_VELOCITY = 40;
/** The mod wheel at or above this is the palm resting on the strings. */
export const PALM_WHEEL = 0.4;

/** Groups a part's notes into cues by start time. */
export function cuesOf(part: readonly NoteEvent[]): Cue[] {
  const byTime = new Map<number, NoteEvent[]>();
  for (const n of part) {
    const key = Math.round(n.t * 1000) / 1000;
    byTime.set(key, [...(byTime.get(key) ?? []), n]);
  }
  return [...byTime.entries()].sort((a, b) => a[0] - b[0]).map(([t, ns]) => ({
    t,
    len: Math.max(...ns.map((n) => n.len)),
    notes: ns.map((n) => n.note),
    pcs: [...new Set(ns.map((n) => n.note % 12))].sort((a, b) => a - b),
    ...(ns.every((n) => n.vel <= DEAD_VELOCITY) ? { dead: true } : {}),
  }));
}

/** Marks the cues starting inside any of these beat ranges as palm-muted. */
export function withPalm(cues: readonly Cue[], ranges: readonly (readonly [number, number])[]): Cue[] {
  return cues.map((c) => (ranges.some(([a, b]) => c.t >= a && c.t < b) ? { ...c, palm: true } : c));
}

/** How long a cue was held against how long it is written. */
export type LengthGrade = 'good' | 'short' | 'long';

/** A hold within this share of the written length (or LENGTH_MIN_MS, if more) is right. */
const LENGTH_TOLERANCE = 0.3;
const LENGTH_MIN_MS = 120;

export function lengthGrade(writtenMs: number, heldMs: number): LengthGrade {
  const tol = Math.max(LENGTH_TOLERANCE * writtenMs, LENGTH_MIN_MS);
  return Math.abs(heldMs - writtenMs) <= tol ? 'good' : heldMs < writtenMs ? 'short' : 'long';
}

/**
 * What note lengths do to the score: nothing ('off'), part of every cue's points ('scored': the length lessons), or a
 * bonus that can only raise it ('bonus': gigs from Northside Club on).
 */
export type LengthMode = 'off' | 'scored' | 'bonus';
const LENGTH_SHARE = 0.4;
const LENGTH_BONUS = 0.25;

export type CueGrade = 'good' | 'close' | 'off' | 'wrong' | 'missed';

export interface CueResult {
  readonly grade: CueGrade;
  /** First note's distance from the beat, ms (negative early); undefined if missed. */
  readonly offsetMs?: number;
  /** Why a right note was still wrong: a dead note played full, a palm-muted note played open, a note played dead. */
  readonly why?: 'not dead' | 'no palm' | 'too soft';
}

/** A note further than this from every waiting cue answers none of them. */
export const REACH_MS = 250;

/** How the crowd answers each graded cue. */
const CROWD_STEP: Record<CueGrade, number> = { good: 0.03, close: 0.012, off: -0.03, wrong: -0.05, missed: -0.04 };
const STREAK_BONUS = 0.01;
const STREAK_FROM = 8;

/**
 * One run of a part. `startMs` is when beat 0 is heard (performance.now() clock); `beatMs` is a beat's length (a
 * slowed rehearsal run passes a longer one).
 */
export class PartJudge {
  readonly results: (CueResult | undefined)[];
  /** Notes heard so far for each cue (pitch classes) and when its first note came. */
  private heard: { pcs: Set<number>; firstMs: number; wrong: boolean }[];
  streak = 0;
  bestStreak = 0;
  /** 0..1: how the room feels. */
  crowd: number;
  crowdPeak: number;
  private crowdSum = 0;
  private crowdCount = 0;
  /** When each cue's hold ended (its first note let go), ms; NaN until then. */
  private heldEnd: number[];
  /** The cue each pitch class last went to, to match its note-off. */
  private lastCue = new Map<number, number>();
  readonly lengths: LengthMode;
  /** Judge the touch too: dead notes soft, palm-muted notes with the wheel up, other notes not dead. */
  readonly touch: boolean;

  constructor(readonly cues: readonly Cue[], readonly startMs: number, readonly beatMs: number, crowdStart = 0.4,
    opts: { lengths?: LengthMode; touch?: boolean } = {}) {
    this.results = cues.map(() => undefined);
    this.heard = cues.map(() => ({ pcs: new Set<number>(), firstMs: NaN, wrong: false }));
    this.heldEnd = cues.map(() => NaN);
    this.crowd = crowdStart;
    this.crowdPeak = crowdStart;
    this.lengths = opts.lengths ?? 'off';
    this.touch = opts.touch ?? false;
  }

  due(i: number): number {
    return this.startMs + this.cues[i]!.t * this.beatMs;
  }

  /**
   * A note played at `timeMs`. It goes to the nearest waiting cue in reach; a cue is graded as soon as all its notes
   * are in (or at once on a wrong note). Returns the cue it went to and, if that settled it, its result.
   */
  play(note: number, timeMs: number, velocity = 100, wheel = 0): { cue?: number; result?: CueResult } {
    this.settle(timeMs);
    let best = -1;
    let bestOff = Infinity;
    this.cues.forEach((_, i) => {
      if (this.results[i]) return;
      const off = timeMs - this.due(i);
      if (Math.abs(off) <= REACH_MS && Math.abs(off) < Math.abs(bestOff)) { best = i; bestOff = off; }
    });
    if (best < 0) return {};
    const h = this.heard[best]!;
    if (Number.isNaN(h.firstMs)) h.firstMs = timeMs;
    const cue = this.cues[best]!;
    const off0 = h.firstMs - this.due(best);
    if (!cue.dead && !cue.pcs.includes(note % 12)) {
      h.wrong = true;
      return { cue: best, result: this.grade(best, 'wrong', off0) };
    }
    if (this.touch) {
      const why = cue.dead && velocity > DEAD_VELOCITY ? 'not dead' : !cue.dead && velocity <= DEAD_VELOCITY ? 'too soft'
        : cue.palm && wheel < PALM_WHEEL ? 'no palm' : undefined;
      if (why) return { cue: best, result: this.grade(best, 'wrong', off0, why) };
    }
    this.lastCue.set(note % 12, best);
    h.pcs.add(cue.dead ? cue.pcs[0]! : note % 12);
    if (h.pcs.size < cue.pcs.length) return { cue: best };
    const a = Math.abs(off0);
    return { cue: best, result: this.grade(best, a <= GOOD_MS ? 'good' : a <= OK_MS ? 'close' : 'off', off0) };
  }

  /**
   * A note let go at `timeMs`: ends the hold of the cue it last played (a chord's hold ends with its first note let
   * go). Returns that cue and how its length went, unless it is a dead note (those have no length).
   */
  release(note: number, timeMs: number): { cue?: number; length?: LengthGrade } {
    const i = this.lastCue.get(note % 12);
    if (i === undefined) return {};
    this.lastCue.delete(note % 12);
    if (!Number.isNaN(this.heldEnd[i]!) || Number.isNaN(this.heard[i]!.firstMs)) return {};
    this.heldEnd[i] = timeMs;
    return this.cues[i]!.dead ? { cue: i } : { cue: i, length: this.length(i) };
  }

  /** How long cue i was held against its written length, once let go. */
  length(i: number): LengthGrade | undefined {
    const end = this.heldEnd[i]!;
    if (Number.isNaN(end) || this.cues[i]!.dead) return undefined;
    return lengthGrade(this.cues[i]!.len * this.beatMs, end - this.heard[i]!.firstMs);
  }

  /** How much of cue i's written length has been held: 0..; while still held, up to `nowMs`. */
  holdShare(i: number, nowMs: number): number {
    const start = this.heard[i]!.firstMs;
    if (Number.isNaN(start) || this.results[i]?.grade === 'wrong') return 0;
    const end = Number.isNaN(this.heldEnd[i]!) ? nowMs : this.heldEnd[i]!;
    return Math.max(0, (end - start) / (this.cues[i]!.len * this.beatMs));
  }

  /** Lengths of the cues played right that have been let go: how many were good, short or long. */
  lengthStats(): { measured: number; good: number; short: number; long: number } {
    const st = { measured: 0, good: 0, short: 0, long: 0 };
    this.cues.forEach((_, i) => {
      const g = this.length(i);
      const r = this.results[i]?.grade;
      if (!g || !(r === 'good' || r === 'close' || r === 'off')) return;
      st.measured++;
      st[g]++;
    });
    return st;
  }

  /** Grades every cue whose time has passed out of reach: missed, or off if only part of a chord came. */
  settle(timeMs: number): number[] {
    const settled: number[] = [];
    this.cues.forEach((_, i) => {
      if (this.results[i] || timeMs - this.due(i) <= REACH_MS) return;
      const h = this.heard[i]!;
      this.grade(i, h.pcs.size ? 'off' : 'missed', h.pcs.size ? h.firstMs - this.due(i) : undefined);
      settled.push(i);
    });
    return settled;
  }

  private grade(i: number, grade: CueGrade, offsetMs?: number, why?: CueResult['why']): CueResult {
    const r: CueResult = { grade, ...(offsetMs === undefined ? {} : { offsetMs }), ...(why ? { why } : {}) };
    this.results[i] = r;
    if (grade === 'good' || grade === 'close') this.streak++;
    else this.streak = 0;
    this.bestStreak = Math.max(this.bestStreak, this.streak);
    this.crowd = Math.min(1, Math.max(0, this.crowd + CROWD_STEP[grade] + (this.streak >= STREAK_FROM ? STREAK_BONUS : 0)));
    this.crowdPeak = Math.max(this.crowdPeak, this.crowd);
    this.crowdSum += this.crowd;
    this.crowdCount++;
    return r;
  }

  /** The waiting cue due next (or now). */
  current(timeMs: number): number | undefined {
    const i = this.cues.findIndex((_, k) => !this.results[k] && timeMs - this.due(k) <= REACH_MS);
    return i < 0 ? undefined : i;
  }

  finished(timeMs: number): boolean {
    return !this.cues.length || timeMs > this.due(this.cues.length - 1) + REACH_MS;
  }

  /** Timing alone: good 1, close 0.5, the rest 0, over every cue: 0..1. */
  get timingScore(): number {
    if (!this.cues.length) return 1;
    return this.results.reduce((sum, r) => sum + (r?.grade === 'good' ? 1 : r?.grade === 'close' ? 0.5 : 0), 0) / this.cues.length;
  }

  /** Share of the cues played on time whose length was right (dead notes left out). */
  get lengthScore(): number {
    const st = this.lengthStats();
    const due = this.cues.filter((c, i) => !c.dead && ['good', 'close'].includes(this.results[i]?.grade ?? '')).length;
    return due ? st.good / due : 0;
  }

  /**
   * The score, 0..1. With lengths off it is the timing score; scored, each cue's points are 60% timing and 40% length
   * (dead notes, which have no length, all timing); as a bonus, length raises the timing score toward 1, never lowers it.
   */
  get score(): number {
    const timing = this.timingScore;
    if (this.lengths === 'off' || !this.cues.length) return timing;
    if (this.lengths === 'bonus') return timing + (1 - timing) * LENGTH_BONUS * this.lengthScore;
    return this.scoreFor(this.cues.map((_, i) => i));
  }

  /** The score of some of the cues (a section of a lesson), with lengths scored. */
  scoreFor(indices: readonly number[]): number {
    if (!indices.length) return 1;
    const points = indices.reduce((sum, i) => {
      const r = this.results[i]?.grade;
      const t = r === 'good' ? 1 : r === 'close' ? 0.5 : 0;
      if (this.cues[i]!.dead || this.lengths === 'off') return sum + t;
      return sum + t * (1 - LENGTH_SHARE) + (t > 0 && this.length(i) === 'good' ? LENGTH_SHARE : 0);
    }, 0);
    return points / indices.length;
  }

  get crowdAverage(): number {
    return this.crowdCount ? this.crowdSum / this.crowdCount : this.crowd;
  }

  counts(): Record<CueGrade, number> {
    const c: Record<CueGrade, number> = { good: 0, close: 0, off: 0, wrong: 0, missed: 0 };
    for (const r of this.results) if (r) c[r.grade]++;
    return c;
  }

  /** Mean offset of the cues played on time-ish (good, close, off), ms: negative rushes, positive drags. */
  meanOffsetMs(): number {
    const offs = this.results.filter((r) => r && r.offsetMs !== undefined && r.grade !== 'wrong').map((r) => r!.offsetMs!);
    return offs.length ? offs.reduce((a, b) => a + b, 0) / offs.length : 0;
  }
}

/** How loose a bandmate the engine plays is at a level: the spread of its timing, ms. */
export function bandmateSlipMs(level: number): number {
  return Math.max(5, 26 - 4 * (level - 1));
}

/** A part as a bandmate plays it: each note moved by a bell-shaped slip of `slipMs` (seeded: the same every time). */
export function humanise(part: readonly NoteEvent[], beatMs: number, slipMs: number, seed: number): NoteEvent[] {
  const rnd = seeded(seed);
  return part.map((n) => {
    const bell = (rnd() + rnd() + rnd() - 1.5) / 1.5; // -1..1, most near 0
    return { ...n, t: n.t + (bell * slipMs) / beatMs, vel: Math.max(1, Math.min(127, Math.round(n.vel * (0.92 + rnd() * 0.16)))) };
  });
}

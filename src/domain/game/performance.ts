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
}

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
  }));
}

export type CueGrade = 'good' | 'close' | 'off' | 'wrong' | 'missed';

export interface CueResult {
  readonly grade: CueGrade;
  /** First note's distance from the beat, ms (negative early); undefined if missed. */
  readonly offsetMs?: number;
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

  constructor(readonly cues: readonly Cue[], readonly startMs: number, readonly beatMs: number, crowdStart = 0.4) {
    this.results = cues.map(() => undefined);
    this.heard = cues.map(() => ({ pcs: new Set<number>(), firstMs: NaN, wrong: false }));
    this.crowd = crowdStart;
    this.crowdPeak = crowdStart;
  }

  due(i: number): number {
    return this.startMs + this.cues[i]!.t * this.beatMs;
  }

  /**
   * A note played at `timeMs`. It goes to the nearest waiting cue in reach; a cue is graded as soon as all its notes
   * are in (or at once on a wrong note). Returns the cue it went to and, if that settled it, its result.
   */
  play(note: number, timeMs: number): { cue?: number; result?: CueResult } {
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
    if (!cue.pcs.includes(note % 12)) {
      h.wrong = true;
      return { cue: best, result: this.grade(best, 'wrong', h.firstMs - this.due(best)) };
    }
    h.pcs.add(note % 12);
    if (h.pcs.size < cue.pcs.length) return { cue: best };
    const off = h.firstMs - this.due(best);
    const a = Math.abs(off);
    return { cue: best, result: this.grade(best, a <= GOOD_MS ? 'good' : a <= OK_MS ? 'close' : 'off', off) };
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

  private grade(i: number, grade: CueGrade, offsetMs?: number): CueResult {
    const r: CueResult = offsetMs === undefined ? { grade } : { grade, offsetMs };
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

  /** Good 1, close 0.5, the rest 0, over every cue: 0..1. */
  get score(): number {
    if (!this.cues.length) return 1;
    return this.results.reduce((sum, r) => sum + (r?.grade === 'good' ? 1 : r?.grade === 'close' ? 0.5 : 0), 0) / this.cues.length;
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

import type { Role } from './progress';

/**
 * Timing lessons: the drums play a groove and the player plays on given beats. Each note is judged by how close it
 * lands to its beat: within GOOD_MS is good (a full point), within OK_MS is close (half a point), further off or the
 * wrong note scores nothing. Notes are as the instrument sounds (on the bass, an octave below the keys).
 */
export interface GrooveBar {
  /** The note to play in this bar. */
  readonly note: number;
  /** Which beats to play it on, 0 being the first beat of the bar. */
  readonly beats: readonly number[];
}

export interface GrooveLesson {
  readonly id: string;
  readonly role: Role;
  readonly track: 'technique';
  readonly title: string;
  readonly topic: string;
  readonly goal: string;
  readonly intro: readonly string[];
  readonly hint: string;
  readonly bpm: number;
  /** Bars of drums before the player comes in. */
  readonly countInBars: number;
  readonly bars: readonly GrooveBar[];
  readonly xp: number;
}

export const BEATS_PER_BAR = 4;
export const GOOD_MS = 50;
export const OK_MS = 110;
/** A note further than this from every beat still waiting is not an answer at all, just an extra note. */
const REACH_MS = 250;
export const GROOVE_PASS_MARK = 0.7;

export const GROOVES: readonly GrooveLesson[] = [
  {
    id: 'B-T2',
    role: 'bass',
    track: 'technique',
    title: 'Lock to the kick',
    topic: 'Playing on the beat',
    goal: 'Lock to the kick drum',
    intro: [
      'The bass and the kick drum are the floor the band stands on. When the bass lands exactly with the kick, the two sound like one big note; a little early or late and the groove wobbles.',
      'The drums count you in for one bar. Then play the note shown on the beats shown: first on beats 1 and 3, then on every beat. Listen to the kick, not to your own note.',
      'Within 50 ms of the beat is good; within 110 ms is close. Press Listen first to hear how it should go.',
    ],
    hint: 'Feel the beat before you play: nod on each kick through the count-in, then play on the nod. If you keep landing late, play a little earlier than feels right.',
    bpm: 90,
    countInBars: 1,
    bars: [
      { note: 28, beats: [0, 2] }, { note: 28, beats: [0, 2] }, { note: 33, beats: [0, 2] }, { note: 33, beats: [0, 2] },
      { note: 28, beats: [0, 1, 2, 3] }, { note: 28, beats: [0, 1, 2, 3] }, { note: 33, beats: [0, 1, 2, 3] }, { note: 33, beats: [0, 1, 2, 3] },
    ],
    xp: 120,
  },
];

/** One note the player should play: its beat counted from the first beat of the first played bar, and its note. */
export interface GrooveHit {
  readonly beat: number;
  readonly note: number;
  readonly bar: number;
}

export function grooveHits(l: GrooveLesson): GrooveHit[] {
  return l.bars.flatMap((b, bar) => b.beats.map((beat) => ({ beat: bar * BEATS_PER_BAR + beat, note: b.note, bar })));
}

/** The whole run in beats, count-in included, measured from the count-in's first beat. */
export function grooveLengthBeats(l: GrooveLesson): number {
  return (l.countInBars + l.bars.length) * BEATS_PER_BAR;
}

/** good and close score; off is the right note too far from the beat; extra answers no beat at all. */
export type Grade = 'good' | 'close' | 'off' | 'wrong note' | 'extra';

export interface GrooveResult {
  readonly grade: Grade;
  /** The hit it answered, if any. */
  readonly hit?: number;
  /** How far from the beat, ms; negative is early. */
  readonly offsetMs?: number;
}

/**
 * One run of a timing lesson. `startMs` is when the first played bar's first beat is heard (after the count-in), on
 * the same clock as the notes' times (performance.now()).
 */
export class GrooveSession {
  readonly hits: GrooveHit[];
  readonly results: (GrooveResult | undefined)[];
  private readonly beatMs: number;

  constructor(readonly lesson: GrooveLesson, readonly startMs: number) {
    this.hits = grooveHits(lesson);
    this.results = this.hits.map(() => undefined);
    this.beatMs = 60000 / lesson.bpm;
  }

  /** When hit i is due, ms. */
  due(i: number): number {
    return this.startMs + this.hits[i]!.beat * this.beatMs;
  }

  /** A note played at `timeMs`: matched to the nearest unanswered hit in reach, and graded. */
  play(note: number, timeMs: number): GrooveResult {
    let best = -1;
    let bestOff = Infinity;
    this.hits.forEach((_, i) => {
      if (this.results[i]) return;
      const off = timeMs - this.due(i);
      if (Math.abs(off) <= REACH_MS && Math.abs(off) < Math.abs(bestOff)) { best = i; bestOff = off; }
    });
    if (best < 0) return { grade: 'extra' };
    const off = Math.abs(bestOff);
    const grade: Grade = note % 12 !== this.hits[best]!.note % 12 ? 'wrong note' : off <= GOOD_MS ? 'good' : off <= OK_MS ? 'close' : 'off';
    const result: GrooveResult = { grade, hit: best, offsetMs: bestOff };
    this.results[best] = result;
    return result;
  }

  /** Points for each hit: good 1, close 0.5, anything else 0. */
  get score(): number {
    const points = this.results.reduce((sum, r) => sum + (r?.grade === 'good' ? 1 : r?.grade === 'close' ? 0.5 : 0), 0);
    return this.hits.length ? points / this.hits.length : 1;
  }

  /** The hit due next (or now) at `timeMs`: the first unanswered one not yet out of reach. */
  current(timeMs: number): number | undefined {
    const i = this.hits.findIndex((_, k) => !this.results[k] && timeMs - this.due(k) <= REACH_MS);
    return i < 0 ? undefined : i;
  }

  /** The run is over once the last hit is out of reach. */
  finished(timeMs: number): boolean {
    return timeMs > this.due(this.hits.length - 1) + REACH_MS;
  }

  get passed(): boolean {
    return this.score >= GROOVE_PASS_MARK;
  }
}

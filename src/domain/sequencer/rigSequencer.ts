/**
 * The MOA-RIG's sequencer, after the NINA's (firmware 2.1): one track per part, sixteen patterns. Every track has its
 * own length (1 to 64 steps), clock (a step from four times to a quarter as fast as a sixteenth), direction and
 * probability, so tracks of different lengths and clocks run against each other. A step holds a chord, velocity,
 * gate (in steps: past 1 it ties into the next), probability, micro-timing, a value for the SEQ mod source, and
 * parameter locks: params of the part held at a value for the length of the step.
 *
 * A pattern restarts every track at its length (0 runs them free). A queued pattern, or the next in a chain, takes
 * over at the end of the pattern (at the next bar when it runs free).
 *
 * Time is the audio clock, as on the MOA-60: `schedule(now)` is called every few milliseconds and sends everything
 * due before `now + LOOKAHEAD`, each event with its exact time, for the worklet to place on its sample.
 */
import { PPQ } from './mpcSequencer';

export const RIG_TRACKS = 16;
export const RIG_PATTERNS = 16;
export const RIG_MAX_STEPS = 64;
export const RIG_LOOKAHEAD = 0.12;
const SIXTEENTH = PPQ / 4;
const BAR = PPQ * 4;
const MAX_GATE = 16;

/** Track clocks: ticks per step (96 a beat), named as how fast they run against sixteenths. */
export const RIG_CLOCKS = [
  ['×4', 6], ['×3', 8], ['×2', 12], ['×1½', 16], ['×1', 24], ['×¾', 32], ['×½', 48], ['×¼', 96],
] as const satisfies readonly (readonly [string, number])[];
export const RIG_DIRECTIONS = ['fwd', 'rev', 'pingpong', 'random'] as const;
export type RigDirection = (typeof RIG_DIRECTIONS)[number];

export interface RigStep {
  /** MIDI notes; none is a rest (its locks still play). */
  notes: number[];
  /** 0..1 */
  vel: number;
  /** How long the notes last, in steps: 1 is the whole step, more ties into the steps after. */
  gate: number;
  /** Chance the step plays, 0..1. */
  prob: number;
  /** Off the grid by this share of a step, -0.5..0.5. */
  micro: number;
  /** The SEQ mod source's value through this step, 0..1. */
  mod: number;
  /** Params of the part held for this step: id -> value (choices as option indices, as in a patch). */
  locks: Record<string, number>;
}

export interface RigTrack {
  steps: RigStep[];
  length: number;
  /** Ticks per step (one of RIG_CLOCKS). */
  clock: number;
  direction: RigDirection;
  /** Chance any step plays, 0..1, on top of the step's own. */
  prob: number;
  muted: boolean;
  solo: boolean;
}

export interface RigPattern {
  /** Sixteenths before every track restarts and a queued pattern takes over; 0 runs free. */
  length: number;
  tracks: RigTrack[];
}

export const newStep = (): RigStep => ({ notes: [], vel: 0.8, gate: 0.5, prob: 1, micro: 0, mod: 0, locks: {} });
export const newTrack = (): RigTrack => ({
  steps: Array.from({ length: RIG_MAX_STEPS }, newStep), length: 16, clock: SIXTEENTH, direction: 'fwd', prob: 1, muted: false, solo: false,
});
export const newRigPattern = (): RigPattern => ({ length: 64, tracks: Array.from({ length: RIG_TRACKS }, newTrack) });

const clone = <T>(v: T): T => JSON.parse(JSON.stringify(v)) as T;
export const cloneRigPattern = (p: RigPattern): RigPattern => clone(p);
export const cloneRigTrack = (t: RigTrack): RigTrack => clone(t);

/** The step a track plays on its k-th step since it (re)started. */
export function stepIndex(direction: RigDirection, length: number, k: number, random: () => number): number {
  if (direction === 'fwd') return k % length;
  if (direction === 'rev') return length - 1 - (k % length);
  if (direction === 'random') return Math.floor(random() * length);
  if (length < 2) return 0;
  const m = k % (2 * length - 2); // ping-pong: the ends are not played twice
  return m < length ? m : 2 * length - 2 - m;
}

/** Where the sequencer's notes and locks go: part, and the audio-clock time (seconds) they are due. */
export interface RigSeqOutput {
  on(part: number, note: number, vel: number, when: number): void;
  off(part: number, note: number, when?: number): void;
  locks(part: number, locks: Record<string, number>, when?: number): void;
  mod(part: number, value: number, when?: number): void;
  /** Drops everything sent ahead that has not happened yet (on stop). */
  flush(): void;
}

interface Off { tick: number; note: number }
interface TrackRun {
  /** Tick of the track's next step. */
  next: number;
  /** Steps played since the track (re)started. */
  k: number;
  locked: boolean;
  mod: number;
  /** Locks or mod were sent: a stop sets them back (a flush may have dropped the step that would have). */
  touched: boolean;
  /** Note offs not sent yet, in no order. */
  offs: Off[];
  /** Note offs sent ahead (they are dropped by a flush, so a stop sends them again). */
  sent: { note: number; time: number }[];
  /** The last steps played and when, for the playhead. */
  played: { step: number; time: number }[];
}

const freshRun = (at: number): TrackRun => ({ next: at, k: 0, locked: false, mod: 0, touched: false, offs: [], sent: [], played: [] });

export class RigSequencer {
  patterns: RigPattern[] = Array.from({ length: RIG_PATTERNS }, newRigPattern);
  current = 0;
  /** Patterns to play in turn, looping; empty plays `current` (or `next`) only. */
  chain: number[] = [];
  /** The pattern queued to take over at the end of this one. */
  next?: number;
  tempo = 120;
  /** Late second sixteenths (and eighths), as a share of a step: 0 straight, 0.5 a dotted feel. */
  shuffle = 0;
  /** Steps that should not sound this pass, as they were just recorded and sounded when played: "track:step". */
  private readonly skip = new Set<string>();
  private playing = false;
  private t0 = 0; // audio time of tick `base`
  private base = 0;
  private tempoUsed = 120;
  private scheduled = 0; // ticks before this are sent
  private sentTick = 0; // the latest tick a step has been sent for (steps go out up to half a step past `scheduled`)
  private patternStart = 0;
  private chainPos = 0;
  private runs: TrackRun[] = [];
  private readonly listeners = new Set<() => void>();

  constructor(private readonly out: RigSeqOutput, private readonly random: () => number = Math.random) {}

  get pattern(): RigPattern {
    return this.patterns[this.current]!;
  }
  get isPlaying(): boolean {
    return this.playing;
  }
  private get secondsPerTick(): number {
    return 60 / (this.tempoUsed * PPQ);
  }
  tickAt(time: number): number {
    return this.base + (time - this.t0) / this.secondsPerTick;
  }
  timeAt(tick: number): number {
    return this.t0 + (tick - this.base) * this.secondsPerTick;
  }

  play(now: number): void {
    if (this.playing) return;
    if (this.chain.length) { this.chainPos = 0; this.current = this.chain[0]!; }
    else if (this.next !== undefined) this.current = this.next;
    this.next = undefined;
    this.tempoUsed = this.tempo;
    this.t0 = now + 0.05;
    this.base = 0;
    this.scheduled = 0;
    this.sentTick = 0;
    this.patternStart = 0;
    this.runs = Array.from({ length: RIG_TRACKS }, () => freshRun(0));
    this.skip.clear();
    this.playing = true;
    this.notify();
  }

  /** Stops: everything sent ahead is dropped, and every note the sequencer started is let go. */
  stop(now: number): void {
    if (!this.playing) return;
    this.playing = false;
    this.out.flush();
    this.runs.forEach((run, part) => {
      const notes = new Set([...run.offs.map((o) => o.note), ...run.sent.filter((s) => s.time > now).map((s) => s.note)]);
      for (const n of notes) this.out.off(part, n);
      if (run.touched) { this.out.locks(part, {}); this.out.mod(part, 0); }
    });
    this.runs = [];
    this.notify();
  }

  /** Queues a pattern for the end of this one (straight away when stopped); it ends any chain. */
  queue(index: number): void {
    this.chain = [];
    if (this.playing) this.next = index;
    else this.current = index;
    this.notify();
  }

  setChain(indices: number[]): void {
    this.chain = indices.filter((i) => i >= 0 && i < RIG_PATTERNS);
    this.chainPos = this.chain.indexOf(this.current); // -1: the chain starts at its first pattern at the next turn
    if (!this.playing && this.chain.length) this.current = this.chain[0]!;
    this.notify();
  }

  /** The step of a track sounding at an audio time, or -1 (for the playhead). */
  stepAt(track: number, time: number): number {
    const played = this.runs[track]?.played ?? [];
    for (let i = played.length - 1; i >= 0; i--) if (played[i]!.time <= time) return played[i]!.step;
    return -1;
  }

  /**
   * The step of a track nearest an audio time, and its tick, for recording: a note played just before a step lands on
   * it. Undefined when stopped.
   */
  stepNear(track: number, time: number): { step: number; tick: number } | undefined {
    const run = this.runs[track];
    if (!this.playing || !run) return undefined;
    const t = this.pattern.tracks[track]!;
    const tick = this.tickAt(time);
    const k = Math.max(0, Math.round((tick - this.trackStart(track)) / t.clock));
    const step = t.direction === 'random' ? k % t.length : stepIndex(t.direction, t.length, k, this.random);
    return { step, tick: this.trackStart(track) + k * t.clock };
  }

  /** Records a step that has just sounded live: it is not played again until its next pass. */
  recorded(track: number, step: number, tick: number): void {
    if (tick >= this.scheduled) this.skip.add(`${track}:${step}`);
  }

  private trackStart(track: number): number {
    const run = this.runs[track]!;
    return run.next - run.k * this.pattern.tracks[track]!.clock;
  }

  /** Sends everything due before `now + LOOKAHEAD`. */
  schedule(now: number): void {
    if (!this.playing) return;
    if (this.tempo !== this.tempoUsed) {
      // keep the steps already sent where they are, and go on at the new tempo from the last of them
      const anchor = Math.max(this.scheduled, this.sentTick);
      this.t0 = this.timeAt(anchor);
      this.base = anchor;
      this.tempoUsed = this.tempo;
    }
    const target = this.tickAt(now + RIG_LOOKAHEAD);
    while (this.scheduled < target) {
      const boundary = this.boundary();
      const until = Math.min(target, boundary);
      this.runTracks(until, boundary);
      this.scheduled = until;
      if (until === boundary) this.turn(boundary);
    }
    for (const run of this.runs) run.sent = run.sent.filter((s) => s.time > now - 0.5);
  }

  /** The next tick a pattern can turn over at. */
  private boundary(): number {
    const len = this.pattern.length * SIXTEENTH;
    if (len > 0) return this.patternStart + len * (Math.floor((this.scheduled - this.patternStart) / len) + 1);
    const wants = this.next !== undefined || this.chain.length > 1;
    return wants ? (Math.floor(this.scheduled / BAR) + 1) * BAR : Infinity;
  }

  private turn(at: number): void {
    const len = this.pattern.length * SIXTEENTH;
    let changed = false;
    if (this.chain.length) {
      this.chainPos = (this.chainPos + 1) % this.chain.length;
      changed = this.chain[this.chainPos] !== this.current;
      this.current = this.chain[this.chainPos]!;
    } else if (this.next !== undefined) {
      changed = this.next !== this.current;
      this.current = this.next;
      this.next = undefined;
    }
    if (!changed && len === 0) return;
    this.patternStart = at;
    for (const run of this.runs) { run.next = at; run.k = 0; }
    this.skip.clear();
    this.notify();
  }

  /** Sends the steps before `until` (and half a step past, as micro-timing can pull a step that early), not past `boundary`. */
  private runTracks(until: number, boundary: number): void {
    const p = this.pattern;
    const solo = p.tracks.some((t) => t.solo);
    p.tracks.forEach((t, part) => {
      const run = this.runs[part]!;
      while (run.next < boundary && run.next - t.clock / 2 < until) {
        this.flushOffs(part, run, run.next);
        const idx = stepIndex(t.direction, t.length, run.k, this.random);
        const step = t.steps[idx]!;
        const swing = (t.clock === SIXTEENTH || t.clock === 2 * SIXTEENTH) && run.k % 2 === 1 ? this.shuffle * t.clock : 0;
        const tick = run.next + swing + step.micro * t.clock;
        this.sentTick = Math.max(this.sentTick, run.next, tick);
        const when = this.timeAt(Math.max(this.scheduled, tick));
        const lockIds = Object.keys(step.locks);
        if (lockIds.length || run.locked) {
          this.out.locks(part, step.locks, this.timeAt(run.next));
          run.locked = lockIds.length > 0;
          run.touched = true;
        }
        if (step.mod !== run.mod) {
          this.out.mod(part, step.mod, this.timeAt(run.next));
          run.mod = step.mod;
          run.touched = true;
        }
        const audible = !t.muted && (!solo || t.solo) && !this.skip.delete(`${part}:${idx}`);
        if (audible && step.notes.length && this.random() < step.prob * t.prob) {
          const end = tick + Math.max(1, Math.min(MAX_GATE, step.gate) * t.clock - 1);
          for (const note of step.notes) {
            // the same note still held from an earlier step is let go first, so its off does not cut this one
            const held = run.offs.findIndex((o) => o.note === note);
            if (held >= 0) { run.offs.splice(held, 1); this.sendOff(part, run, note, when); }
            this.out.on(part, note, step.vel, when);
            run.offs.push({ tick: end, note });
          }
        }
        run.played.push({ step: idx, time: this.timeAt(run.next) });
        if (run.played.length > 8) run.played.shift();
        run.next += t.clock;
        run.k++;
      }
      this.flushOffs(part, run, until);
    });
  }

  private flushOffs(part: number, run: TrackRun, before: number): void {
    run.offs = run.offs.filter((o) => {
      if (o.tick >= before) return true;
      this.sendOff(part, run, o.note, this.timeAt(o.tick));
      return false;
    });
  }

  private sendOff(part: number, run: TrackRun, note: number, when: number): void {
    this.out.off(part, note, when);
    run.sent.push({ note, time: when });
  }

  onChange(fn: () => void): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }
  notify(): void {
    for (const l of this.listeners) l();
  }
}

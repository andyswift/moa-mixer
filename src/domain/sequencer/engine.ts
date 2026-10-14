import { BAR_TICKS, PPQN } from './division';
import { euclid, rotate } from './euclid';
import { grooveVelocity } from './grooves';
import { harmonise, transposeInScale } from './scales';
import { type Bank, INFINITE_REPEATS, type Pattern, type StepValues, type TrackParams, TRACKS } from './track';

export interface SeqEvent {
  /** Absolute tick since the sequencer started. */
  tick: number;
  kind: 'on' | 'off';
  channel: number;
  note: number;
  velocity: number;
  track: number;
}

interface Pending extends SeqEvent {
  /** Which pulse this belongs to (repeats share their pulse's group). */
  group: number;
  repeat: boolean;
  /** Identifies one note-on, so an off can tell whether its note was cut or retriggered meanwhile. */
  id: number;
}

interface TrackRun {
  loopStart: number;
  loopLength: number;
  loops: number;
  queue: Pending[];
  sounding: Map<number, number>;
  pulseGroup: number;
  /** The pulse group that last cut the track's sounding notes, so one chord does not cut itself. */
  cutGroup: number;
  channel: number;
}

/** mulberry32: a small seeded generator so tests can repeat a probability run. */
export function seeded(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Ticks a note lasts: 50% sustain is one division, below that a fraction of it, 100% is sixteen divisions. */
export function sustainTicks(sustain: number, division: number): number {
  const s = Math.min(1, Math.max(0, sustain));
  const ticks = s <= 0.5 ? (s / 0.5) * division : division * (1 + ((s - 0.5) / 0.5) * 15);
  return Math.max(1, Math.round(ticks));
}

/** The notes a pulse sounds: the pitch menu, moved by pitch (scale degrees) and then by harmony. */
export function chordFor(t: StepValues, scale: number, root: number, userScale: readonly number[]): number[] {
  const moved = t.pitchNotes.map((n) => transposeInScale(n, t.pitch, scale, root, userScale));
  return harmonise(moved, t.harmony, scale, root, userScale);
}

const wrap = (n: number, len: number): number => ((n % len) + len) % len;

/**
 * Turns a bank into timed note events, tick by tick (96 per quarter note). Pure and clock-free: call
 * `advance(untilTick)` and it returns every event before that tick. Tracks loop independently, so different step
 * counts and divisions make polyrhythms; a queued pattern takes over at the next quantize boundary.
 */
export class SequencerEngine {
  tick = 0;
  playing = false;
  patternIndex = 0;
  /** Patterns waiting to play, in order; a chain loops through them. */
  chain: number[] = [];
  private chainPos = 0;
  private patternStart = 0;
  private runs: TrackRun[] = [];
  private nextId = 1;
  /** Pulse counts per track, so the groove template follows the notes rather than the steps. */
  private pulseCounter: number[] = new Array<number>(TRACKS).fill(0);

  constructor(public bank: Bank, private readonly random: () => number = Math.random) {}

  get pattern(): Pattern {
    return this.bank.patterns[this.patternIndex]!;
  }

  /** Queues a pattern to start at the next quantize boundary (immediately when stopped). */
  queue(index: number): void {
    this.chain = [index];
    this.chainPos = 0;
    if (!this.playing) this.patternIndex = index;
  }

  /** Plays the patterns in order, looping, advancing at each quantize boundary. */
  setChain(indices: number[]): void {
    this.chain = [...indices];
    this.chainPos = Math.max(0, this.chain.indexOf(this.patternIndex));
    if (!this.playing && this.chain.length > 0) this.patternIndex = this.chain[0]!;
  }

  start(): void {
    this.playing = true;
    this.tick = 0;
    this.patternStart = 0;
    this.pulseCounter.fill(0);
    this.runs = this.freshRuns(0);
  }

  /** Stops, returning the note-offs for anything still sounding. */
  stop(): SeqEvent[] {
    const offs = this.silence(this.tick);
    this.playing = false;
    this.runs = [];
    return offs;
  }

  private freshRuns(at: number): TrackRun[] {
    return Array.from({ length: TRACKS }, () => ({
      loopStart: at, loopLength: 0, loops: -1, queue: [], sounding: new Map(), pulseGroup: 0, cutGroup: -1, channel: 1,
    }));
  }

  private silence(at: number): SeqEvent[] {
    const out: SeqEvent[] = [];
    this.runs.forEach((run, track) => {
      for (const note of run.sounding.keys()) out.push({ tick: at, kind: 'off', channel: run.channel, note, velocity: 0, track });
      run.sounding.clear();
      run.queue = [];
    });
    return out;
  }

  /** Every event with `tick < until`, in order (offs before ons at the same tick). */
  advance(until: number): SeqEvent[] {
    const out: SeqEvent[] = [];
    if (!this.playing) return out;
    while (this.tick < until) {
      const t = this.tick;
      // a queued pattern (or the next one in a chain) starts on a quantize boundary
      if (t > this.patternStart && (t - this.patternStart) % this.pattern.quantize === 0) {
        let target = this.patternIndex;
        if (this.chain.length > 1) {
          this.chainPos = (this.chainPos + 1) % this.chain.length;
          target = this.chain[this.chainPos]!;
        } else if (this.chain.length === 1) target = this.chain[0]!;
        if (target !== this.patternIndex) {
          out.push(...this.silence(t));
          this.patternIndex = target;
          this.patternStart = t;
          this.runs = this.freshRuns(t);
          this.pulseCounter.fill(0);
        }
      }
      const batch: Pending[] = [];
      for (let track = 0; track < TRACKS; track++) {
        const run = this.runs[track]!;
        const params = this.pattern.tracks[track]!;
        run.channel = params.channel;
        // a new loop of the track
        if (run.loops < 0 || t >= run.loopStart + run.loopLength) {
          run.loops += 1;
          run.loopStart = t;
          run.loopLength = this.loopLength(params);
          if (!params.muted) this.generate(track, run, params, t);
        }
        // due events for this tick
        const due = run.queue.filter((e) => e.tick <= t);
        if (due.length === 0) continue;
        run.queue = run.queue.filter((e) => e.tick > t);
        for (const e of due) batch.push(e);
      }
      batch.sort((a, b) => (a.kind === b.kind ? 0 : a.kind === 'off' ? -1 : 1));
      for (const e of batch) {
        const run = this.runs[e.track]!;
        if (e.kind === 'off') {
          if (run.sounding.get(e.note) === e.id) {
            run.sounding.delete(e.note);
            out.push({ tick: t, kind: 'off', channel: e.channel, note: e.note, velocity: 0, track: e.track });
          }
          continue;
        }
        // a new pulse cuts what the track was playing; choke mode also drops the previous pulse's pending repeats
        if (!e.repeat) {
          if (run.cutGroup !== e.group) {
            run.cutGroup = e.group;
            for (const [note] of run.sounding) out.push({ tick: t, kind: 'off', channel: e.channel, note, velocity: 0, track: e.track });
            run.sounding.clear();
            if (this.pattern.tracks[e.track]!.repeatMode === 'choke') run.queue = run.queue.filter((q) => !q.repeat || q.kind === 'off' || q.group >= e.group);
          }
        } else if (run.sounding.has(e.note)) {
          out.push({ tick: t, kind: 'off', channel: e.channel, note: e.note, velocity: 0, track: e.track });
          run.sounding.delete(e.note);
        }
        run.sounding.set(e.note, e.id);
        out.push({ tick: t, kind: 'on', channel: e.channel, note: e.note, velocity: e.velocity, track: e.track });
      }
      this.tick += 1;
    }
    return out;
  }

  private loopLength(p: TrackParams): number {
    const full = p.steps * p.division;
    return p.length > 0 ? Math.min(p.length, full) : full;
  }

  /** Lays out one loop of a track: pulses with locks, cycle overrides, timing, probability, repeats and note-offs. */
  private generate(track: number, run: TrackRun, p: TrackParams, loopStart: number): void {
    const cycle = p.cycleOverrides[run.loops % Math.max(1, p.cycles)] ?? {};
    const euclidPulses = rotate(euclid(p.pulses, p.steps), p.rotate);
    const manual = rotate(p.manual.slice(0, p.steps), p.rotate);
    const loopLen = run.loopLength;
    let pulseIndex = this.pulseCounter[track]!;
    const stepTimes: number[] = [];
    for (let i = 0; i < p.steps; i++) {
      const lock = p.locks[i];
      const base = i * p.division;
      if (base >= loopLen) break;
      if (!(euclidPulses[i] || manual[i] || lock?.pulse)) {
        stepTimes.push(-1);
        continue;
      }
      stepTimes.push(base);
    }
    const pulseSteps = stepTimes.map((tm, i) => (tm >= 0 ? i : -1)).filter((i) => i >= 0);
    pulseSteps.forEach((i, k) => {
      const lock = p.locks[i];
      const v: StepValues = { ...p, ...cycle, ...lock } as StepValues;
      const micro = i % 2 === 1 ? Math.round(v.timing * p.division * 0.5) : 0;
      const at = loopStart + wrap(i * p.division + micro + p.delay, loopLen);
      const group = ++run.pulseGroup;
      const silencedPulse = v.probability < 0 && this.random() < -v.probability;
      const chord = chordFor(v, p.scale, p.root, p.userScale);
      const velocity = grooveVelocity(v.velocity, p.groove, v.accent, pulseIndex);
      pulseIndex += 1;
      const dur = sustainTicks(v.sustain, p.division);
      const nextPulse = pulseSteps[k + 1];
      const choke = p.repeatMode === 'choke';
      const emit = (tick: number, vel: number, repeat: boolean) => {
        if (silencedPulse) return;
        if (v.probability > 0 && this.random() < v.probability) return;
        for (const note of chord) {
          const id = this.nextId++;
          run.queue.push({ tick, kind: 'on', channel: p.channel, note, velocity: vel, track, group, repeat, id });
          run.queue.push({ tick: tick + dur, kind: 'off', channel: p.channel, note, velocity: 0, track, group, repeat, id });
        }
      };
      emit(at, velocity, false);
      // repeats
      const infinite = v.repeats >= INFINITE_REPEATS;
      const count = infinite ? 512 : v.repeats;
      const cutoff = choke
        ? (nextPulse !== undefined ? loopStart + nextPulse * p.division : loopStart + loopLen)
        : Number.POSITIVE_INFINITY;
      const limit = infinite ? loopStart + loopLen : Number.POSITIVE_INFINITY;
      let when = at;
      for (let r = 1; r <= count; r++) {
        const pace = v.repeatPace;
        const factor = pace >= 0 ? 1 + pace * 0.35 * (r - 1) : 1 / (1 + -pace * 0.35 * (r - 1));
        when += Math.max(1, Math.round(v.repeatTime * factor));
        if (when >= cutoff || when >= limit) break;
        const ramp = Math.min(1, r * Math.abs(v.repeatOffset) * 0.25);
        const vel = v.repeatOffset >= 0
          ? Math.round(velocity + (127 - velocity) * ramp)
          : Math.max(1, Math.round(velocity * (1 - ramp)));
        emit(when, vel, true);
      }
    });
    this.pulseCounter[track] = pulseIndex;
    run.queue.sort((a, b) => a.tick - b.tick);
  }
}

/** Seconds per tick at a tempo. */
export const tickSeconds = (bpm: number): number => 60 / (bpm * PPQN);
export { BAR_TICKS };

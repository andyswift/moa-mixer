import { BAR_TICKS, DEFAULT_DIVISION_TICKS, QUADRUPLETS } from './division';

export const TRACKS = 16;
export const PATTERNS = 16;
export const MAX_STEPS = 64;
export const MAX_REPEATS = 48;
/** The repeats knob fully clockwise: repeats go on until the next pulse (or the end of the loop). */
export const INFINITE_REPEATS = MAX_REPEATS + 1;
export const MAX_PITCH_NOTES = 8;
export const CYCLE_SLOTS = 16;

/** The values a single step can lock to its own setting, whether or not it carries a pulse. */
export interface StepValues {
  velocity: number;
  sustain: number;
  probability: number;
  accent: number;
  timing: number;
  repeats: number;
  repeatTime: number;
  repeatOffset: number;
  repeatPace: number;
  pitchNotes: number[];
  pitch: number;
  harmony: number;
}

export interface TrackParams extends StepValues {
  /** 1-64 steps in the Euclidean cycle (16 per page). */
  steps: number;
  /** Euclidean pulses spread over the steps. */
  pulses: number;
  /** Start point: positive starts later, wrapping round. */
  rotate: number;
  /** Pulses placed by hand; they survive Euclidean edits. */
  manual: boolean[];
  /** Ticks per step (96 PPQN): 24 is a sixteenth. */
  division: number;
  /** Per-step parameter locks, keyed by step index. A lock with `pulse` set also places a pulse. */
  locks: Record<number, Partial<StepValues> & { pulse?: boolean }>;
  /** Number of cycles (1-16): each loop of the track plays the next set of overrides. */
  cycles: number;
  /** Overrides per cycle (kept from the start so banks saved now still load when cycles get their editor). */
  cycleOverrides: Partial<StepValues>[];
  repeatMode: 'choke' | 'tail';
  groove: number;
  delay: number;
  scale: number;
  root: number;
  userScale: number[];
  /** Loop length in ticks; 0 is infinite (the full step count). */
  length: number;
  channel: number;
  muted: boolean;
}

/** A fresh track: sixteen steps, no pulses, middle C, 100 velocity, a note one division long. */
export function newTrack(channel = 1): TrackParams {
  return {
    steps: 16, pulses: 0, rotate: 0, manual: new Array<boolean>(MAX_STEPS).fill(false),
    division: DEFAULT_DIVISION_TICKS, locks: {}, cycles: 4,
    cycleOverrides: Array.from({ length: CYCLE_SLOTS }, () => ({})),
    repeats: 0, repeatTime: QUADRUPLETS[5]!.ticks, repeatOffset: 0, repeatPace: 0, repeatMode: 'choke',
    velocity: 100, probability: 0, accent: 0, groove: 0, sustain: 0.5, timing: 0, delay: 0,
    pitchNotes: [60], pitch: 0, harmony: 0, scale: 0, root: 0, userScale: [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11],
    length: 0, channel, muted: false,
  };
}

export interface Pattern {
  /** Ticks the pattern plays before a queued pattern may start (the T-1's quantize). */
  quantize: number;
  tracks: TrackParams[];
}

export const newPattern = (): Pattern => ({
  quantize: BAR_TICKS,
  tracks: Array.from({ length: TRACKS }, (_, i) => newTrack(1 + (i % 16))),
});

export interface Bank {
  tempo: number;
  patterns: Pattern[];
}

export const MIN_TEMPO = 24;
export const MAX_TEMPO = 280;

export const newBank = (): Bank => ({ tempo: 120, patterns: Array.from({ length: PATTERNS }, newPattern) });

/** A pattern counts as edited when any track differs from a fresh one (so the pad lights blue). */
export function patternEdited(p: Pattern): boolean {
  const fresh = newPattern();
  return JSON.stringify(p) !== JSON.stringify(fresh);
}

/** The demo the page starts with: track 1 plays a five-pulse Euclidean pattern, track 2 a snare-ish backbeat. */
export function demoBank(): Bank {
  const bank = newBank();
  const p = bank.patterns[0]!;
  p.tracks[0]!.pulses = 5;
  p.tracks[0]!.pitchNotes = [48];
  p.tracks[0]!.sustain = 0.4;
  p.tracks[1]!.pulses = 3;
  p.tracks[1]!.rotate = 2;
  p.tracks[1]!.pitchNotes = [60];
  p.tracks[1]!.channel = 2;
  return bank;
}

const clone = <T>(v: T): T => JSON.parse(JSON.stringify(v)) as T;
export const cloneTrack = (t: TrackParams): TrackParams => clone(t);
export const clonePattern = (p: Pattern): Pattern => clone(p);
export const cloneBank = (b: Bank): Bank => clone(b);

/** Keeps a loaded or edited track inside its legal ranges. */
export function sanitiseTrack(t: TrackParams): TrackParams {
  const fresh = newTrack(t.channel);
  const merged: TrackParams = { ...fresh, ...t };
  merged.steps = Math.min(MAX_STEPS, Math.max(1, Math.round(merged.steps)));
  merged.pulses = Math.min(merged.steps, Math.max(0, Math.round(merged.pulses)));
  merged.repeats = Math.min(INFINITE_REPEATS, Math.max(0, Math.round(merged.repeats)));
  merged.velocity = Math.min(127, Math.max(1, Math.round(merged.velocity)));
  merged.cycles = Math.min(CYCLE_SLOTS, Math.max(1, Math.round(merged.cycles)));
  merged.channel = Math.min(16, Math.max(1, Math.round(merged.channel)));
  merged.pitchNotes = merged.pitchNotes.filter((n) => Number.isInteger(n) && n >= 0 && n <= 127).slice(0, MAX_PITCH_NOTES);
  merged.manual = Array.from({ length: MAX_STEPS }, (_, i) => merged.manual[i] === true);
  return merged;
}

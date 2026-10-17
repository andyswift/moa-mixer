import type { NoteEvent } from './types';

/** Beats from the start of the song for a bar (0-based) and a 16th-note step (0-15) inside it. */
export const at16 = (bar: number, step: number, beatsPerBar = 4): number => bar * beatsPerBar + step / 4;

/** Beats for a length given in 16th-note steps. */
export const steps = (n: number): number => n / 4;

export const note = (t: number, len: number, pitch: number, vel = 100): NoteEvent => ({ t, len, note: pitch, vel });

/** General MIDI drum notes the drum machine answers to. */
export const DRUM = {
  kick: 36, snare: 38, clap: 39, closedHat: 42, openHat: 46, ride: 51,
  rim: 37, lowTom: 41, midTom: 45, highTom: 48, cowbell: 56, crash: 49,
} as const;

/** Each chord is held for `barsPerChord` bars, then the loop repeats. */
export function chordAt<T>(chords: readonly T[], bar: number, barsPerChord: number): T {
  return chords[Math.floor(bar / barsPerChord) % chords.length]!;
}

/** Plays `pitches` on consecutive steps of a bar (`stride` steps apart), each lasting `len` steps. */
export function arpeggio(bar: number, pitches: readonly number[], stride: number, len: number, vel: number, startStep = 0): NoteEvent[] {
  const out: NoteEvent[] = [];
  for (let i = 0, s = startStep; s < 16; i++, s += stride) out.push(note(at16(bar, s), steps(len), pitches[i % pitches.length]!, vel));
  return out;
}

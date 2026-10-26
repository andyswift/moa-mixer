/** Fixed chord shapes, in semitones above the key played. 'memory' plays the chord learned from held keys. */
export const CHORD_SHAPES = {
  off: [0],
  maj: [0, 4, 7],
  min: [0, 3, 7],
  '7': [0, 4, 7, 10],
  m7: [0, 3, 7, 10],
  maj7: [0, 4, 7, 11],
  sus4: [0, 5, 7],
  '5th': [0, 7],
  oct: [0, 12],
} as const satisfies Record<string, readonly number[]>;

// Listed out: Object.keys would put the integer-like '7' first.
export const CHORD_TYPES = ['off', 'maj', 'min', '7', 'm7', 'maj7', 'sus4', '5th', 'oct', 'memory'] as const satisfies readonly (keyof typeof CHORD_SHAPES | 'memory')[];
export type ChordType = (typeof CHORD_TYPES)[number];

/** The most notes a learned chord keeps (the synth has six voices). */
export const CHORD_MAX_NOTES = 6;
const CHORD_MAX_SPAN = 48;

/** Reads a stored chord memory ("0,4,7"); anything unreadable falls back to a single note. */
export function parseChord(text: string): number[] {
  const steps = text.split(',').map((s) => Number(s.trim()))
    .filter((n) => Number.isInteger(n) && n >= 0 && n <= CHORD_MAX_SPAN);
  const unique = [...new Set([0, ...steps])].sort((a, b) => a - b);
  return unique.slice(0, CHORD_MAX_NOTES);
}

/** The chord memory for some held notes: their intervals above the lowest, as stored text ("0,4,7"). */
export function chordFromNotes(notes: readonly number[]): string {
  if (notes.length === 0) throw new Error('No notes to learn a chord from');
  const lowest = Math.min(...notes);
  return parseChord(notes.map((n) => String(n - lowest)).join(',')).join(',');
}

/** The notes a key plays: the chord's intervals on top of it, kept inside the MIDI range. */
export function chordNotes(key: number, intervals: readonly number[]): number[] {
  return intervals.map((i) => key + i).filter((n) => n >= 0 && n <= 127);
}

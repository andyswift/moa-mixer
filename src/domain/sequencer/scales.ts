export interface Scale {
  readonly name: string;
  /** Pitch classes above the root (0-11). */
  readonly steps: readonly number[];
}

/** The T-1's eight scales, in its order. The user scale starts as chromatic and is edited per track. */
export const SCALES: readonly Scale[] = [
  { name: 'chrom', steps: [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11] },
  { name: 'major', steps: [0, 2, 4, 5, 7, 9, 11] },
  { name: 'minor', steps: [0, 2, 3, 5, 7, 8, 10] },
  { name: 'panta', steps: [0, 3, 5, 7, 10] },
  { name: 'hira', steps: [0, 2, 3, 7, 8] },
  { name: 'iwato', steps: [0, 1, 5, 6, 10] },
  { name: 'tetra', steps: [0, 4, 7, 11] },
  { name: 'user', steps: [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11] },
];

export const SCALE_NAMES = SCALES.map((s) => s.name);

const mod12 = (n: number): number => ((n % 12) + 12) % 12;

/** The scale as a set of pitch classes for a root (0-11) and optional custom user steps. */
export function pitchClasses(scaleIndex: number, root: number, userSteps?: readonly number[]): Set<number> {
  const scale = SCALES[scaleIndex] ?? SCALES[0]!;
  const steps = scale.name === 'user' && userSteps ? userSteps : scale.steps;
  return new Set(steps.map((s) => mod12(s + root)));
}

export function inScale(note: number, scaleIndex: number, root: number, userSteps?: readonly number[]): boolean {
  return pitchClasses(scaleIndex, root, userSteps).has(mod12(note));
}

/** All the notes of the scale between two MIDI notes, ascending. */
export function scaleNotes(scaleIndex: number, root: number, low = 0, high = 127, userSteps?: readonly number[]): number[] {
  const set = pitchClasses(scaleIndex, root, userSteps);
  const out: number[] = [];
  for (let n = low; n <= high; n++) if (set.has(mod12(n))) out.push(n);
  return out;
}

/** Moves a note by whole scale degrees (negative goes down); a note outside the scale first snaps down to it. */
export function transposeInScale(note: number, degrees: number, scaleIndex: number, root: number, userSteps?: readonly number[]): number {
  if (degrees === 0) return note;
  const notes = scaleNotes(scaleIndex, root, 0, 127, userSteps);
  if (notes.length === 0) return note;
  let at = notes.findIndex((n) => n >= note);
  if (at < 0) at = notes.length - 1;
  if (notes[at]! > note && at > 0) at -= 1; // snap down, then move
  const moved = Math.min(notes.length - 1, Math.max(0, at + degrees));
  return notes[moved]!;
}

/**
 * Harmony: each step moves one chord tone along by one scale degree in turn (the lowest first), so turning
 * the knob walks a chord through its inversions and then on into new chords inside the scale.
 */
export function harmonise(notes: readonly number[], steps: number, scaleIndex: number, root: number, userSteps?: readonly number[]): number[] {
  if (notes.length === 0 || steps === 0) return [...notes];
  const out = [...notes].sort((a, b) => a - b);
  const direction = Math.sign(steps);
  for (let i = 0; i < Math.abs(steps); i++) {
    const idx = direction > 0 ? i % out.length : out.length - 1 - (i % out.length);
    out[idx] = transposeInScale(out[idx]!, direction * 3, scaleIndex, root, userSteps);
  }
  return out.sort((a, b) => a - b);
}

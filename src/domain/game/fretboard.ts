/** The bass's strings, low to high, and the notes they are tuned to (MOA-BASS standard tuning). */
export const BASS_STRINGS = ['E', 'A', 'D', 'G'] as const;
export const BASS_TUNING = [28, 33, 38, 43] as const;
export const SHOWN_FRETS = 7;

export interface FretPosition {
  /** 0 is the low E string. */
  readonly string: number;
  /** 0 is the open string. */
  readonly fret: number;
}

/**
 * Where a beginner finds a note on the bass: in the first position (frets 0-4) on the lowest string that has it there,
 * else as low on the neck as it goes. Undefined if the bass cannot play it.
 */
export function bassPosition(note: number): FretPosition | undefined {
  for (let s = 0; s < BASS_TUNING.length; s++) {
    const fret = note - BASS_TUNING[s]!;
    if (fret >= 0 && fret <= 4) return { string: s, fret };
  }
  let best: FretPosition | undefined;
  for (let s = 0; s < BASS_TUNING.length; s++) {
    const fret = note - BASS_TUNING[s]!;
    if (fret >= 0 && fret <= 24 && (!best || fret < best.fret)) best = { string: s, fret };
  }
  return best;
}

/** A root and its fifth in the fifth's one shape: the fifth one string up and two frets along (when there is a string up). */
export function rootFifthShape(root: number): FretPosition[] {
  const r = bassPosition(root);
  if (!r) return [];
  if (r.string < BASS_TUNING.length - 1 && r.fret + 2 <= 24) return [r, { string: r.string + 1, fret: r.fret + 2 }];
  const f = bassPosition(root + 7);
  return f ? [r, f] : [r];
}

/** "E string, open" / "A string, fret 3". */
export function describePosition(p: FretPosition): string {
  return `${BASS_STRINGS[p.string]} string, ${p.fret === 0 ? 'open' : `fret ${p.fret}`}`;
}

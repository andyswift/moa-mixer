import type { NoteEvent } from './types';

/**
 * What makes a band sound played rather than sequenced, for a song's generator to use: a seeded random (the same
 * performance every time), and one dynamics curve the whole band follows, so they swell and drop back together.
 */

/** A random in 0..1 from a seed: the same numbers every time. */
export function seeded(seed: number): () => number {
  let s = seed >>> 0;
  return () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 4294967296; };
}

/**
 * Plays a part to the band's dynamics: each note's velocity scaled by the level at its beat (1 as written). A dead
 * note (velocity 40 or less) stays dead, and `max` caps the rest (a bass picked hard by the bridge goes sharp).
 */
export function withDynamics(notes: NoteEvent[], level: (beat: number) => number, max = 127): NoteEvent[] {
  return notes.map((n) => {
    const vel = Math.round(n.vel * level(n.t));
    return { ...n, vel: Math.max(1, n.vel <= 40 ? Math.min(40, vel) : Math.min(max, vel)) };
  });
}

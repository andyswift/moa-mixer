export const ARP_MODES = ['up', 'down', 'updown', 'order', 'random'] as const;
export type ArpMode = (typeof ARP_MODES)[number];
export const ARP_OCTAVES = ['1', '2', '3', '4'] as const;
/** Notes played together on each step: single, double or triple (after the Bree6's Double/Triple modes). */
export const ARP_GROUPS = ['1', '2', '3'] as const;
export const ARP_RATES = ['1/4', '1/8', '1/8T', '1/16', '1/16T', '1/32'] as const;
export type ArpRate = (typeof ARP_RATES)[number];

/** MIDI clock pulses (24 a beat) per arpeggiator step. */
export const ARP_RATE_PULSES: Record<ArpRate, number> = { '1/4': 24, '1/8': 12, '1/8T': 8, '1/16': 6, '1/16T': 4, '1/32': 3 };

/** Milliseconds per step at a tempo. */
export function arpStepMs(rate: ArpRate, bpm: number): number {
  return (60000 / bpm) * (ARP_RATE_PULSES[rate] / 24);
}

/**
 * Works out which note an arpeggiator plays next from the notes held. Pure: no timing, no sound.
 * - up / down / updown run through the notes sorted by pitch (updown turns at the ends without repeating them);
 *   order keeps the order they were played in; random picks any of them.
 * - Octaves repeats the pattern that many octaves up.
 * - Group plays that many consecutive notes of the pattern together on each step, sliding along it one note a
 *   step (C+E, E+G, G+C...), so a double or triple arpeggio walks through the chord's inversions.
 * Changing the held notes carries on after the note played last, so adding a note mid-run (or the rest of a chord
 * landing a moment after its first key) neither restarts the pattern nor repeats a note.
 */
export class Arpeggiator {
  mode: ArpMode = 'up';
  octaves = 1;
  group = 1;
  private position = -1;
  private last?: number;

  constructor(private readonly random: () => number = Math.random) {}

  /** One full cycle of the pattern for these notes (held notes in the order they were played). */
  pattern(notes: readonly number[]): number[] {
    const base = this.mode === 'order' ? [...notes] : [...notes].sort((a, b) => a - b);
    const run: number[] = [];
    for (let o = 0; o < this.octaves; o++) for (const n of base) if (n + 12 * o <= 127) run.push(n + 12 * o);
    if (this.mode === 'down') return run.reverse();
    if (this.mode === 'updown' && run.length > 2) return [...run, ...run.slice(1, -1).reverse()];
    return run;
  }

  /** The notes to play together on the next step (one unless grouped); empty when no notes are held. */
  next(notes: readonly number[]): number[] {
    const run = this.pattern(notes);
    if (run.length === 0) return [];
    if (this.mode === 'random') this.position = Math.floor(this.random() * run.length);
    else this.position = (this.anchor(run) + 1) % run.length;
    this.last = run[this.position];
    const size = Math.min(this.group, run.length);
    return [...new Set(Array.from({ length: size }, (_, i) => run[(this.position + i) % run.length]!))];
  }

  /** Start again from the first note of the pattern. */
  reset(): void {
    this.position = -1;
    this.last = undefined;
  }

  /** Where the last note played sits in a (possibly changed) pattern: its nearest occurrence, else the old place. */
  private anchor(run: readonly number[]): number {
    if (this.last === undefined || run[this.position] === this.last) return this.position;
    let best = this.position;
    let distance = Infinity;
    run.forEach((n, i) => {
      if (n === this.last && Math.abs(i - this.position) < distance) {
        best = i;
        distance = Math.abs(i - this.position);
      }
    });
    return best;
  }
}

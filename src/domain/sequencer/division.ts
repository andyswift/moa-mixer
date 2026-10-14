/** The sequencer runs at 96 ticks per quarter note, the T-1's resolution for free divisions. */
export const PPQN = 96;
export const BAR_TICKS = PPQN * 4;

export interface Division {
  readonly label: string;
  readonly ticks: number;
  readonly triplet: boolean;
}

const quad = (n: number): Division => ({ label: `1/${n}`, ticks: BAR_TICKS / n, triplet: false });
const trip = (n: number): Division => ({ label: `1/${n}`, ticks: BAR_TICKS / n, triplet: true });

/** Note values: quadruplets 1/1 to 1/64 (4 per bar at 1/4) and triplets 1/3 to 1/48 (3 per bar at 1/3). */
export const QUADRUPLETS: readonly Division[] = [1, 2, 4, 8, 16, 32, 64].map(quad);
export const TRIPLETS: readonly Division[] = [3, 6, 12, 24, 48].map(trip);
/** Every division from long to short, quadruplets and triplets interleaved by length (what turning the knob steps through). */
export const DIVISIONS: readonly Division[] = [...QUADRUPLETS, ...TRIPLETS].sort((a, b) => b.ticks - a.ticks);

export const DEFAULT_DIVISION_TICKS = BAR_TICKS / 16;

/** The nearest named division for a tick length (free divisions snap for display). */
export function nearestDivision(ticks: number): Division {
  return DIVISIONS.reduce((best, d) => (Math.abs(d.ticks - ticks) < Math.abs(best.ticks - ticks) ? d : best));
}

/** Index in DIVISIONS of an exact tick length, or -1 for a free division. */
export function divisionIndex(ticks: number): number {
  return DIVISIONS.findIndex((d) => d.ticks === ticks);
}

/** Moves one division longer (-1) or shorter (+1); a free division first snaps to the nearest named one. */
export function stepDivision(ticks: number, delta: number): number {
  let i = divisionIndex(ticks);
  if (i < 0) i = DIVISIONS.indexOf(nearestDivision(ticks));
  const next = Math.min(DIVISIONS.length - 1, Math.max(0, i + Math.sign(delta)));
  return DIVISIONS[next]!.ticks;
}

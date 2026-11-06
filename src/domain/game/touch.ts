/**
 * The player's touch. Keyboards answer velocity very differently, so a fixed "40 or softer is a dead note" is unfair
 * on many of them. Touch setup asks for a few notes as soft as the player can and a few played normally, and puts
 * the player's dead-note threshold between them. The game then maps every velocity through it: at or under the
 * threshold lands in 1..40 (dead, to the bass and to the judge), above it in 41..127.
 */

/** Velocities the game treats as dead notes (the MOA-BASS plays 40 or softer damped). */
export const GAME_DEAD_MAX = 40;
/** Where the threshold sits between soft and normal: nearer soft, so a normal note never comes out dead. */
const BETWEEN = 0.45;
/** Soft and normal closer than this means the keyboard hardly answers velocity. */
const MIN_SPREAD = 14;
export const DEFAULT_THRESHOLD = GAME_DEAD_MAX;

export interface TouchSetup {
  /** The highest velocity the player's keyboard counts as a dead note. */
  readonly threshold: number;
  /** False if the keyboard does not seem to send velocity (or soft and normal came out the same). */
  readonly sensitive: boolean;
}

const mean = (xs: readonly number[]) => xs.reduce((a, b) => a + b, 0) / xs.length;

/** Works out the threshold from soft and normal notes (at least one of each). */
export function calibrate(soft: readonly number[], normal: readonly number[]): TouchSetup {
  const s = mean(soft);
  const n = mean(normal);
  if (n - s < MIN_SPREAD) return { threshold: Math.round(Math.min(s, n) - 1), sensitive: false };
  // between the loudest soft note and the softest normal one, leaning soft, never above the softest normal note
  const t = Math.round(s + (n - s) * BETWEEN);
  return { threshold: Math.max(Math.max(...soft), Math.min(t, Math.min(...normal) - 1)), sensitive: true };
}

/** A raw velocity mapped through the player's threshold onto the game's scale. */
export function mapVelocity(raw: number, threshold: number): number {
  const t = Math.min(126, Math.max(1, threshold));
  if (raw <= t) return Math.max(1, Math.round((raw / t) * GAME_DEAD_MAX));
  return Math.min(127, GAME_DEAD_MAX + 1 + Math.round(((raw - t - 1) / Math.max(1, 127 - t - 1)) * (127 - GAME_DEAD_MAX - 1)));
}

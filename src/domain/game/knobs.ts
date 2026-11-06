/** The game uses this many of the player's knobs. */
export const KNOB_COUNT = 4;

/** Controllers that are not knobs on any keyboard: mod wheel, data entry, volume, sustain and the other pedals. */
const NOT_KNOBS = new Set([1, 6, 7, 64, 65, 66, 67, 120, 121, 122, 123]);

/**
 * Knob setup: the player turns knob 1, then knob 2, and so on; each new controller that moves is the next knob.
 * Returns the knobs so far with this controller added, or the same list if it is not a usable knob or already taken.
 */
export function learnKnob(knobs: readonly number[], controller: number): number[] {
  if (knobs.length >= KNOB_COUNT || NOT_KNOBS.has(controller) || knobs.includes(controller)) return [...knobs];
  return [...knobs, controller];
}

/** Which knob (0-based) a controller is, or -1. */
export function knobIndex(knobs: readonly number[], controller: number): number {
  return knobs.indexOf(controller);
}

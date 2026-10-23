/**
 * Cymbals cut from Gaute's breaks, for the MOA-KIT: the three moments in his recordings where a cymbal sounds on its
 * own, between the drums (found by onset detection: a hit with almost nothing below 250 Hz). Each is cut from a
 * millisecond before the hit to where the next drum lands, its low end filtered off (the room's ringing drums under
 * it), faded in and out so neither end clicks, and brought up to a common level. Their tails were cut short by the
 * next drum; the kit grows them back with a reverb.
 */

/** The breaks the hits come from, and where (in samples at 44.1 kHz): from the onset to the next drum. */
export const CYMBAL_CUTS = {
  /** A short, tight hit: the closed hi-hat (and, tuned up, the ride's bell). */
  funk: { break: 'gaute-135-funk', from: 29642, to: 39325 },
  /** Another short one: the pedal (and, tuned down, the ride). */
  heavy: { break: 'gaute-135-heavy', from: 39431, to: 48674 },
  /** The longest, ringing one: the open hi-hat (and, tuned down, the crash). */
  steady: { break: 'gaute-135-steady', from: 112018, to: 126761 },
} as const;
export type CymbalCut = keyof typeof CYMBAL_CUTS;
export const CUT_RATE = 44100;

const LEAD_IN = 0.001; // s before the onset kept, faded in
const FADE_OUT = 0.04; // s faded out before the next drum
const LOW_CUT = 350; // Hz: under this is the drums' ringing, not the cymbal
const PEAK = 0.9;

/** A two-pole high-pass (two one-poles), run forward. */
function highPass(x: Float32Array, rate: number, hz: number): Float32Array {
  const a = Math.exp((-2 * Math.PI * hz) / rate);
  let y: Float32Array = x;
  for (let pass = 0; pass < 2; pass++) {
    const z = new Float32Array(y.length);
    let px = 0, py = 0;
    for (let i = 0; i < y.length; i++) { py = a * (py + y[i]! - px); px = y[i]!; z[i] = py; }
    y = z;
  }
  return y;
}

/** Cuts one hit out of its break (mono, at 44.1 kHz) and makes it ready to play. */
export function cutCymbal(breakAudio: Float32Array, cut: CymbalCut): Float32Array {
  const c = CYMBAL_CUTS[cut];
  const from = Math.max(0, c.from - Math.round(LEAD_IN * CUT_RATE));
  // filter a little before the cut too, so the filter has settled by the hit
  const pre = Math.max(0, from - 2048);
  const x = highPass(breakAudio.subarray(pre, c.to), CUT_RATE, LOW_CUT).slice(from - pre);
  const fadeIn = Math.round(LEAD_IN * CUT_RATE), fadeOut = Math.round(FADE_OUT * CUT_RATE);
  for (let i = 0; i < fadeIn && i < x.length; i++) x[i]! *= 0.5 - 0.5 * Math.cos((Math.PI * i) / fadeIn);
  for (let i = 0; i < fadeOut && i < x.length; i++) x[x.length - 1 - i]! *= 0.5 - 0.5 * Math.cos((Math.PI * i) / fadeOut);
  let peak = 0;
  for (const v of x) peak = Math.max(peak, Math.abs(v));
  if (peak > 0) for (let i = 0; i < x.length; i++) x[i]! *= PEAK / peak;
  return x;
}

/** How each cymbal plays a hit: which cut, tuned, how long it lasts (s; 0 = all of it) and how loud. */
export interface CymbalPad {
  cut: CymbalCut;
  tune: number;
  decay: number;
  level: number;
}

/** The sampled cymbals: the hi-hat (closed, open, pedal; one choke group), the ride (bow, bell) and the crash. */
export const SAMPLED = {
  // levels measured on the kit page: a closed hat, the ride and the pedal under the drums otherwise
  hat: { closed: { cut: 'funk', tune: 0, decay: 0.2, level: 1.6 }, open: { cut: 'steady', tune: 0, decay: 0, level: 0.85 }, pedal: { cut: 'heavy', tune: -1, decay: 0.06, level: 1.1 } },
  ride: { bow: { cut: 'heavy', tune: -3, decay: 0, level: 1.6 }, bell: { cut: 'funk', tune: 4, decay: 0, level: 1.3 } },
  crash: { hit: { cut: 'steady', tune: -2, decay: 0, level: 1 } },
} as const satisfies Record<string, Record<string, CymbalPad>>;

/**
 * The MOA-60's sampling character, after the Akai MPC60: sounds are kept at 40 kHz in 12 bits, and the 12 bits are
 * spread non-linearly (fine steps for quiet sounds, coarse for loud), so a 12-bit store keeps something like the
 * dynamic range of 16 bits. Loud sounds carry a little grit that follows the signal; quiet tails stay clean.
 *
 * The non-linear steps are a compander: the level is squeezed by a log curve, rounded to 12 bits (sign plus 2047
 * steps) and opened up again. MU is chosen so the smallest step is about one 16-bit step (2 / 65536), the dynamic
 * range the MPC60 was known for; at full scale the steps are about 0.2% of the level.
 */
export const MPC60_RATE = 40000;
export const MU = 68;
const STEPS = 2047;
const LOG_MU = Math.log1p(MU);

/** One sample through the 12-bit non-linear store (in -1..1, clipped). */
export function compand12(x: number): number {
  const a = Math.min(1, Math.abs(x));
  const q = Math.round((Math.log1p(MU * a) / LOG_MU) * STEPS) / STEPS;
  const y = Math.expm1(q * LOG_MU) / MU;
  return x < 0 ? -y : y;
}

/** The size of one 12-bit step at level `a` (0..1): how coarse the store is there. */
export function stepAt(a: number): number {
  const q = Math.log1p(MU * a) / LOG_MU;
  return (Math.expm1((q + 1 / STEPS) * LOG_MU) - Math.expm1(q * LOG_MU)) / MU;
}

// Band-limited resampling: a Kaiser-windowed sinc, tabled at PHASES fractional offsets (interpolated between them).
const ZEROS = 16; // zero crossings of the sinc each side
const PHASES = 256;
const BETA = 8.6; // Kaiser window: about 85 dB of stop band

function besselI0(x: number): number {
  let sum = 1, term = 1;
  for (let k = 1; k < 40; k++) {
    term *= (x / (2 * k)) ** 2;
    sum += term;
    if (term < sum * 1e-12) break;
  }
  return sum;
}

/**
 * Resamples one channel from `fromRate` to `toRate`. The low-pass sits at 90% of the lower of the two Nyquist
 * frequencies (18 kHz into 40 kHz), so nothing above the new Nyquist folds back.
 */
export function resample(input: Float32Array, fromRate: number, toRate: number): Float32Array {
  if (fromRate === toRate) return input.slice();
  const ratio = toRate / fromRate;
  const cut = 0.9 * Math.min(1, ratio); // cut-off as a fraction of the input's Nyquist
  const half = Math.ceil(ZEROS / cut); // taps each side, in input samples
  const width = 2 * half;
  // table[p][k]: the filter at offset (k - half + 1 - p / PHASES) input samples
  const table = new Float64Array((PHASES + 1) * width);
  const i0b = besselI0(BETA);
  for (let p = 0; p <= PHASES; p++) {
    for (let k = 0; k < width; k++) {
      const t = k - half + 1 - p / PHASES;
      const r = t / half;
      const win = Math.abs(r) >= 1 ? 0 : besselI0(BETA * Math.sqrt(1 - r * r)) / i0b;
      const x = Math.PI * cut * t;
      table[p * width + k] = cut * (x === 0 ? 1 : Math.sin(x) / x) * win;
    }
  }
  const outLength = Math.floor(input.length * ratio);
  const out = new Float32Array(outLength);
  for (let j = 0; j < outLength; j++) {
    const t = j / ratio;
    const i = Math.floor(t);
    const pf = (t - i) * PHASES;
    const p = Math.floor(pf), w = pf - p;
    const a = p * width, b = a + width;
    let acc = 0;
    for (let k = 0; k < width; k++) {
      const n = i - half + 1 + k;
      if (n < 0 || n >= input.length) continue;
      acc += input[n]! * (table[a + k]! + w * (table[b + k]! - table[a + k]!));
    }
    out[j] = acc;
  }
  return out;
}

/** A sound as the MPC60 would keep it: every channel at 40 kHz through the 12-bit store. */
export function toMpc60(channels: readonly Float32Array[], rate: number): { channels: Float32Array[]; rate: number } {
  return {
    rate: MPC60_RATE,
    channels: channels.map((c) => {
      const r = resample(c, rate, MPC60_RATE);
      for (let i = 0; i < r.length; i++) r[i] = compand12(r[i]!);
      return r;
    }),
  };
}

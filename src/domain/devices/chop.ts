/**
 * Cutting a break into slices for the pads, two ways: where the hits are (transients), or evenly by the beat.
 * Both return the slice starts in frames, the first at 0; a slice ends where the next begins.
 */

const HOP_SECONDS = 0.0025;
const WINDOW_SECONDS = 0.01;
const MIN_GAP_SECONDS = 0.06; // no two slices closer than this (a flam is one hit)
const PRE_ROLL_SECONDS = 0.0015; // a slice starts just before its hit, so the attack is whole

/** A mono mix of the channels. */
export function mixDown(channels: readonly Float32Array[]): Float32Array {
  if (channels.length === 1) return channels[0]!;
  const out = new Float32Array(channels[0]!.length);
  for (const c of channels) for (let i = 0; i < out.length; i++) out[i]! += c[i]! / channels.length;
  return out;
}

/**
 * Where the hits are: the rise of the short-term energy (in dB, so quiet ghost notes count as well as loud ones),
 * picked where it jumps clearly above its recent level. `sensitivity` 0..1: more slices as it rises. At most `max`
 * slices; the strongest hits are kept.
 */
export function transients(mono: Float32Array, rate: number, sensitivity = 0.5, max = 16): number[] {
  const hop = Math.max(1, Math.round(HOP_SECONDS * rate));
  const win = Math.max(hop, Math.round(WINDOW_SECONDS * rate));
  const frames = Math.floor((mono.length - win) / hop);
  if (frames < 2) return [0];
  const level = new Float64Array(frames);
  for (let f = 0; f < frames; f++) {
    let e = 0;
    for (let i = f * hop; i < f * hop + win; i++) e += mono[i]! * mono[i]!;
    level[f] = 10 * Math.log10(e / win + 1e-10);
  }
  // the rise over the last two hops, against the level just before it
  const rise = new Float64Array(frames);
  for (let f = 2; f < frames; f++) rise[f] = Math.max(0, level[f]! - Math.max(level[f - 2]!, -80));
  const threshold = 12 - 9 * sensitivity; // dB of rise that counts as a hit
  const floor = Math.max(...level) - 50; // nothing in the noise floor
  const gap = Math.round(MIN_GAP_SECONDS / HOP_SECONDS);
  const peaks: { frame: number; strength: number }[] = [];
  for (let f = 2; f < frames - 1; f++) {
    if (rise[f]! < threshold || level[f]! < floor) continue;
    if (rise[f]! < rise[f - 1]! || rise[f]! < rise[f + 1]!) continue; // a local maximum of the rise
    const last = peaks[peaks.length - 1];
    if (last && f - last.frame < gap) {
      if (rise[f]! > last.strength) peaks[peaks.length - 1] = { frame: f, strength: rise[f]! };
      continue;
    }
    peaks.push({ frame: f, strength: rise[f]! });
  }
  const kept = peaks.sort((a, b) => b.strength - a.strength).slice(0, max - 1).sort((a, b) => a.frame - b.frame);
  const pre = Math.round(PRE_ROLL_SECONDS * rate);
  // the window that rose ends at frame * hop + win; the hit starts within it, at the first sample above a tenth of its peak
  const starts = kept.map(({ frame }) => {
    const from = Math.max(0, (frame - 2) * hop), to = Math.min(mono.length, frame * hop + win);
    let peak = 0;
    for (let i = from; i < to; i++) peak = Math.max(peak, Math.abs(mono[i]!));
    let i = from;
    while (i < to && Math.abs(mono[i]!) < peak * 0.1) i++;
    return Math.max(0, i - pre);
  });
  const out = [0];
  for (const s of starts) if (s - out[out.length - 1]! >= MIN_GAP_SECONDS * rate * 0.5) out.push(s);
  return out;
}

/** Even slices: `count` equal parts of `length` frames (e.g. a two-bar break in sixteen eighth notes). */
export function evenSlices(length: number, count: number): number[] {
  return Array.from({ length: count }, (_, i) => Math.round((i * length) / count));
}

/** The tempo at which a loop of `length` frames lasts `beats` beats. */
export function loopTempo(length: number, rate: number, beats: number): number {
  return (60 * beats * rate) / length;
}

/**
 * Even slices that land on the hits: `count` equal parts, each cut moved to the nearest hit within `snap` seconds
 * (so a live break chopped in eighths keeps every stroke whole, at the start of its slice), or left on the grid
 * where nothing is played near it.
 */
export function gridSlices(mono: Float32Array, rate: number, count: number, snap = 0.04): number[] {
  const hitsAt = transients(mono, rate, 0.7, 4 * count).slice(1);
  return evenSlices(mono.length, count).map((g, i) => {
    if (i === 0) return 0;
    let best = g, d = snap * rate;
    for (const h of hitsAt) if (Math.abs(h - g) < d) { d = Math.abs(h - g); best = h; }
    return best;
  });
}

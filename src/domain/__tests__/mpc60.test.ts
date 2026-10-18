import { describe, expect, it } from 'vitest';
import { evenSlices, gridSlices, loopTempo, transients } from '../devices/chop';
import { compand12, MPC60_RATE, resample, stepAt, toMpc60 } from '../devices/mpc60Character';

const sine = (hz: number, rate: number, seconds: number, amp = 0.8) => Float32Array.from({ length: Math.round(rate * seconds) }, (_, i) => amp * Math.sin((2 * Math.PI * hz * i) / rate));
/** Amplitude of `hz` in `x` (a single-bin DFT over the middle, away from the edges). */
const amplitude = (x: Float32Array, hz: number, rate: number) => {
  const from = Math.floor(x.length / 4), to = Math.floor((3 * x.length) / 4);
  let re = 0, im = 0;
  for (let i = from; i < to; i++) { re += x[i]! * Math.cos((2 * Math.PI * hz * i) / rate); im += x[i]! * Math.sin((2 * Math.PI * hz * i) / rate); }
  return (2 * Math.hypot(re, im)) / (to - from);
};
const db = (a: number) => 20 * Math.log10(a);

describe('MOA-60 character: 40 kHz, 12 bits, non-linear', () => {
  it('the 12-bit store has 16-bit steps for quiet sounds and coarse ones for loud', () => {
    expect(stepAt(0)).toBeGreaterThan(2 / 65536 * 0.8);
    expect(stepAt(0)).toBeLessThan(2 / 65536 * 1.2);
    expect(stepAt(1)).toBeGreaterThan(stepAt(0) * 50); // linear 12-bit would be the same everywhere
    expect(stepAt(1)).toBeLessThan(0.0025);
    expect(compand12(1)).toBeCloseTo(1, 10);
    expect(compand12(-0.5)).toBeCloseTo(-compand12(0.5), 12);
    expect(compand12(0)).toBe(0);
  });

  it('its error follows the signal: about 60 dB under a loud sound, still far under a quiet one', () => {
    for (const amp of [0.9, 0.01]) {
      const x = sine(997, 40000, 0.5, amp);
      let err = 0, sig = 0;
      for (const v of x) { err += (compand12(v) - v) ** 2; sig += v * v; }
      const snr = 10 * Math.log10(sig / err);
      expect(snr).toBeGreaterThan(amp > 0.5 ? 55 : 40);
      expect(snr).toBeLessThan(amp > 0.5 ? 70 : 80);
    }
  });

  it('resampling to 40 kHz keeps a tone in tune and at its level', () => {
    const y = resample(sine(1000, 48000, 0.5), 48000, MPC60_RATE);
    expect(y.length).toBe(20000);
    expect(db(amplitude(y, 1000, MPC60_RATE) / 0.8)).toBeCloseTo(0, 1);
    expect(db(amplitude(y, 12000, MPC60_RATE) + 1e-12)).toBeLessThan(-80);
  });

  it('nothing above 20 kHz folds back down: a 22 kHz tone at 48 kHz is gone, not moved to 18 kHz', () => {
    const y = resample(sine(22000, 48000, 0.5), 48000, MPC60_RATE);
    expect(db(amplitude(y, 18000, MPC60_RATE) / 0.8)).toBeLessThan(-70);
    // and 16 kHz, inside the band, passes
    const z = resample(sine(16000, 48000, 0.5), 48000, MPC60_RATE);
    expect(db(amplitude(z, 16000, MPC60_RATE) / 0.8)).toBeGreaterThan(-0.5);
  });

  it('a whole sound goes through: every channel, at 40 kHz', () => {
    const s = toMpc60([sine(440, 44100, 0.25), sine(220, 44100, 0.25)], 44100);
    expect(s.rate).toBe(40000);
    expect(s.channels).toHaveLength(2);
    expect(s.channels[0]!.length).toBe(10000);
  });
});

describe('chopping a break', () => {
  /** Hits: a short noisy burst with a decaying tail at each time, some loud, some ghost notes. */
  const breakAt = (rate: number, hits: [number, number][], seconds = 2) => {
    const x = new Float32Array(rate * seconds);
    let seed = 1;
    const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647) * 2 - 1;
    for (const [t, amp] of hits) for (let i = 0; i < rate * 0.2; i++) x[Math.round(t * rate) + i]! += amp * rnd() * Math.exp(-i / (rate * 0.03));
    return x;
  };

  it('finds the hits, loud ones and ghost notes, each within a couple of milliseconds', () => {
    const rate = 44100;
    const hits: [number, number][] = [[0.1, 0.9], [0.35, 0.6], [0.5, 0.08], [0.85, 0.9], [1.2, 0.5], [1.4, 0.06]];
    const found = transients(breakAt(rate, hits), rate, 0.6);
    expect(found[0]).toBe(0);
    const starts = found.slice(1).map((f) => f / rate);
    expect(starts).toHaveLength(hits.length);
    starts.forEach((s, i) => expect(Math.abs(s - hits[i]![0])).toBeLessThan(0.003));
  });

  it('keeps only the strongest hits when there are more than pads', () => {
    const rate = 44100;
    const hits: [number, number][] = Array.from({ length: 12 }, (_, i) => [0.05 + i * 0.15, i % 3 === 0 ? 0.9 : 0.1]);
    const found = transients(breakAt(rate, hits), rate, 0.8, 5);
    expect(found).toHaveLength(5);
    expect(found.slice(1).map((f) => Math.round((f / rate - 0.05) / 0.15) + 0)).toEqual([0, 3, 6, 9]);
  });

  it('grid slices: even, but each cut moved onto a hit played near it (a live break keeps its strokes whole)', () => {
    const rate = 44100;
    // eighths at 1 s per bar of 8: hits a little early or late, one eighth left empty
    const hits: [number, number][] = [[0.0, 0.9], [0.13, 0.6], [0.24, 0.7], [0.395, 0.5], [0.5, 0.9], [0.86, 0.6]];
    const cuts = gridSlices(breakAt(rate, hits, 1), rate, 8).map((f) => f / rate);
    expect(cuts[0]).toBe(0);
    [0.13, 0.24, 0.395, 0.5].forEach((t, i) => expect(Math.abs(cuts[i + 1]! - t)).toBeLessThan(0.003));
    expect(cuts[5]).toBeCloseTo(0.625, 3); // nothing near: stays on the grid
    expect(cuts[7]).toBeCloseTo(0.86, 2);
  });

  it('even slices and the tempo of a loop', () => {
    expect(evenSlices(1600, 4)).toEqual([0, 400, 800, 1200]);
    expect(loopTempo(44100 * 2, 44100, 4)).toBeCloseTo(120, 10); // four beats in two seconds
  });
});

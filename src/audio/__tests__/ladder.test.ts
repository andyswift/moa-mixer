import { describe, expect, it } from 'vitest';
import { LADDER_SOURCE } from '../ladderWorklet';

type Params = { cutoff: number; res: number; drive: number };
interface Core { process(input: Float32Array, output: Float32Array, n: number, p: Params, detune?: Float32Array): void }
const { LadderCore } = new Function(`${LADDER_SOURCE}; return { LadderCore };`)() as { LadderCore: new (sr: number) => Core };

const SR = 48000;

function run(input: Float32Array, p: Partial<Params>, detune?: (i: number) => number): Float32Array {
  const core = new LadderCore(SR);
  const out = new Float32Array(input.length);
  for (let at = 0; at < input.length; at += 128) {
    const len = Math.min(128, input.length - at);
    const d = detune ? Float32Array.from({ length: len }, (_, i) => detune(at + i)) : undefined;
    core.process(input.subarray(at, at + len), out.subarray(at, at + len), len, { cutoff: 1000, res: 0, drive: 0, ...p }, d);
  }
  return out;
}
const sine = (hz: number, n = SR, amp = 0.3) => Float32Array.from({ length: n }, (_, i) => amp * Math.sin((2 * Math.PI * hz * i) / SR));
const rms = (x: Float32Array, from = SR / 4) => {
  let s = 0;
  for (let i = from; i < x.length; i++) s += x[i]! * x[i]!;
  return Math.sqrt(s / (x.length - from));
};
const db = (r: number) => 20 * Math.log10(r);
/** Rising zero crossings per second. */
function pitch(x: Float32Array, from = SR / 2): number {
  let first = -1, last = -1, count = 0;
  for (let i = from + 1; i < x.length; i++) if (x[i - 1]! < 0 && x[i]! >= 0) { if (first < 0) first = i; last = i; count++; }
  return count < 2 ? 0 : ((count - 1) * SR) / (last - first);
}

describe('ladder filter', () => {
  it('is a four-pole low-pass: flat well below the cutoff, about 24 dB down an octave above it and falling', () => {
    const gain = (hz: number) => db(rms(run(sine(hz), { cutoff: 1000 })) / rms(sine(hz)));
    expect(Math.abs(gain(100))).toBeLessThan(1.5);
    expect(gain(4000)).toBeLessThan(-20);
    expect(gain(8000)).toBeLessThan(gain(4000) - 15);
  });

  it('self-oscillates near the cutoff at full resonance, and stays bounded', () => {
    const kick = new Float32Array(SR * 2);
    kick[0] = 0.5; // a click to start it
    const out = run(kick, { cutoff: 600, res: 1 });
    expect(rms(out, SR)).toBeGreaterThan(0.05);
    expect(Math.abs(pitch(out, SR) / 600 - 1)).toBeLessThan(0.08);
    let peak = 0;
    for (const v of out) peak = Math.max(peak, Math.abs(v));
    expect(peak).toBeLessThan(3);
  });

  it('drive saturates inside the loop: the resonant peak is squashed relative to the body as it rises', () => {
    // a loud saw-ish note through a resonant filter; compare the energy at the cutoff with the fundamental
    const n = SR;
    const saw = Float32Array.from({ length: n }, (_, i) => 0.6 * (2 * (((110 * i) / SR) % 1) - 1));
    const peakRatio = (drive: number) => {
      const y = run(saw, { cutoff: 880, res: 0.85, drive });
      // energy near the 8th harmonic (the resonance) against the fundamental, by correlation
      const at = (hz: number) => {
        let re = 0, im = 0;
        for (let i = SR / 4; i < n; i++) { re += y[i]! * Math.cos((2 * Math.PI * hz * i) / SR); im += y[i]! * Math.sin((2 * Math.PI * hz * i) / SR); }
        return Math.hypot(re, im);
      };
      return at(880) / at(110);
    };
    expect(peakRatio(1)).toBeLessThan(peakRatio(0) * 0.7);
  });

  it('follows the cutoff CV sample by sample (the envelope input)', () => {
    const noise = Float32Array.from({ length: SR }, (_, i) => 0.3 * Math.sin(i * 12.9898) * Math.sin(i * 78.233));
    const closed = rms(run(noise, { cutoff: 200 }));
    const opened = rms(run(noise, { cutoff: 200 }, () => 3600)); // +3 octaves
    expect(opened).toBeGreaterThan(closed * 2);
  });

  it('stays finite and bounded with everything at the top', () => {
    const loud = Float32Array.from({ length: SR }, (_, i) => (i % 200 < 100 ? 1 : -1));
    const out = run(loud, { cutoff: 18000, res: 1, drive: 1 }, (i) => (i % 4800) - 2400);
    expect(out.every(Number.isFinite)).toBe(true);
    let peak = 0;
    for (const v of out) peak = Math.max(peak, Math.abs(v));
    expect(peak).toBeLessThan(4);
  });
});

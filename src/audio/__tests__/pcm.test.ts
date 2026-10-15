import { describe, expect, it } from 'vitest';
import { PCM_SOURCE } from '../pcmWorklet';

interface Ring {
  fill: number;
  underruns: number;
  drops: number;
  primed: boolean;
  push(l: Float32Array, r: Float32Array): void;
  pull(l: Float32Array, r: Float32Array, ratio: number): void;
}

const { PcmRing } = new Function('AudioWorkletProcessor', 'registerProcessor', 'sampleRate', `${PCM_SOURCE}; return { PcmRing };`)(
  class {},
  () => {},
  48000,
) as { PcmRing: new (capacity: number, target: number) => Ring };

const ramp = (from: number, n: number) => Float32Array.from({ length: n }, (_, i) => (from + i) / 1000);
const block = () => [new Float32Array(128), new Float32Array(128)] as const;

describe('PcmRing', () => {
  it('plays silence until it has buffered the target, then plays the audio in order', () => {
    const ring = new PcmRing(4800, 512);
    const [l, r] = block();
    ring.push(ramp(0, 256), ramp(0, 256));
    ring.pull(l, r, 1);
    expect(l.every((v) => v === 0)).toBe(true);
    ring.push(ramp(256, 512), ramp(256, 512));
    ring.pull(l, r, 1);
    expect(l[0]).toBeCloseTo(0, 5);
    // ratio 1 plus a small fill trim: samples advance by ~1 each and stay in order
    for (let i = 1; i < 128; i++) expect(l[i]!).toBeGreaterThan(l[i - 1]!);
    expect(ring.underruns).toBe(0);
  });

  it('plays silence, counts an underrun and re-primes when it runs dry', () => {
    const ring = new PcmRing(4800, 128);
    const [l, r] = block();
    ring.push(ramp(0, 200), ramp(0, 200));
    ring.pull(l, r, 1);
    ring.pull(l, r, 1);
    expect(ring.underruns).toBe(1);
    expect(l[127]).toBe(0);
    expect(ring.primed).toBe(false);
  });

  it('drops audio when the buffer grows far past the target', () => {
    const ring = new PcmRing(1000, 100);
    ring.push(ramp(0, 950), ramp(0, 950));
    expect(ring.drops).toBe(1);
    expect(ring.fill).toBe(100);
  });

  it('plays faster when over target and slower when under, to follow a drifting clock', () => {
    const run = (preload: number) => {
      const ring = new PcmRing(48000, 1000);
      ring.push(ramp(0, preload), ramp(0, preload));
      ring.primed = true;
      const [l, r] = block();
      const before = ring.fill;
      ring.pull(l, r, 1);
      return before - ring.fill; // frames consumed
    };
    expect(run(2000)).toBeGreaterThan(128);
    expect(run(1000)).toBeCloseTo(128, 0);
    expect(run(500)).toBeLessThan(128);
  });

  it('resamples when the sender runs at a different rate', () => {
    const ring = new PcmRing(48000, 100);
    ring.push(ramp(0, 1000), ramp(0, 1000));
    ring.primed = true;
    const [l, r] = block();
    ring.pull(l, r, 44100 / 48000);
    expect(ring.fill).toBeGreaterThan(1000 - 128);
  });
});

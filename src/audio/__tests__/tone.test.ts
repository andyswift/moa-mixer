import { describe, expect, it } from 'vitest';
import { TONE_SOURCE } from '../toneWorklet';
import { UNICORN_PRESETS } from '../../domain/devices/unicornSynth';

interface Core {
  voices: unknown[];
  setPreset(p: unknown): void;
  noteOn(note: number, velocity: number, frame?: number): void;
  noteOff(note: number, frame?: number): void;
  drum(kind: string, velocity: number, frame?: number): void;
  process(out: Float32Array, n: number, level: number): void;
}
const { ToneCore } = new Function(`${TONE_SOURCE}; return { ToneCore };`)() as { ToneCore: new (sr: number, role?: string) => Core };
const SR = 48000;
const run = (c: Core, seconds: number) => {
  const n = Math.round(seconds * SR), out = new Float32Array(n), b = new Float32Array(128);
  for (let at = 0; at < n; at += 128) { c.process(b, 128, 1); out.set(b.subarray(0, Math.min(128, n - at)), at); }
  return out;
};
const rms = (x: Float32Array, a = 0, b = x.length) => { let s = 0; for (let i = a; i < b; i++) s += x[i]! ** 2; return Math.sqrt(s / (b - a)); };
const pitch = (x: Float32Array, a: number, b: number) => {
  let n = 0, first = -1, last = -1;
  for (let i = a + 1; i < b; i++) if (x[i - 1]! < 0 && x[i]! >= 0) { if (first < 0) first = i; last = i; n++; }
  return ((n - 1) * SR) / (last - first);
};

describe('MOA-UNICORN voices', () => {
  it('play in tune on every preset (A4 is 440 Hz)', () => {
    for (const p of UNICORN_PRESETS) {
      const c = new ToneCore(SR);
      c.setPreset({ ...p.sound, vib: 0, mix2: 0 });
      c.noteOn(69, 1);
      const out = run(c, 0.4);
      expect(pitch(out, 2400, 19000), p.name).toBeCloseTo(440, 0);
      expect(rms(out, 2400, 4800), p.name).toBeGreaterThan(0.02);
    }
  });

  it('start on the frame they are placed at, and a key let go fades by its release', () => {
    const c = new ToneCore(SR);
    c.setPreset({ ...UNICORN_PRESETS[1]!.sound }); // Organ: full sustain, short release
    c.noteOn(60, 1, 1000);
    c.noteOff(60, 1000 + 4800);
    const out = run(c, 0.5);
    expect(out.slice(0, 1000).every((v) => v === 0)).toBe(true);
    expect(out[1001]).not.toBe(0);
    expect(rms(out, 3000, 5800)).toBeGreaterThan(0.05);
    expect(rms(out, 5800 + 9600, 5800 + 12000)).toBeLessThan(0.002);
    expect(c.voices).toHaveLength(0);
  });

  it('eight voices; a ninth note takes the oldest', () => {
    const c = new ToneCore(SR);
    for (let i = 0; i < 9; i++) c.noteOn(60 + i, 1);
    run(c, 0.01);
    expect(c.voices).toHaveLength(8);
    expect((c.voices as { note: number }[]).map((v) => v.note)).not.toContain(60);
  });

  it('the bright waves are band-limited: a high square note is almost all its own harmonics, little folded back', () => {
    const c = new ToneCore(SR);
    c.setPreset({ w1: 'square', mix2: 0, a: 0.001, s: 1, d: 1, vib: 0 });
    c.noteOn(100, 1); // 2637 Hz: its 19th harmonic would fold far down without band-limiting
    const out = run(c, 0.5);
    // the note's own harmonics (odd, up to Nyquist), measured with a Hann window; whatever is left over is aliasing
    const x = out.subarray(4800, 4800 + 32768), N = x.length, f0 = 440 * 2 ** ((100 - 69) / 12);
    let total = 0; for (const v of x) total += v * v; total /= N;
    let harmonics = 0;
    for (let k = 1; k * f0 < SR / 2; k += 2) {
      let re = 0, im = 0;
      for (let i = 0; i < N; i++) { const w = 0.5 - 0.5 * Math.cos((2 * Math.PI * i) / N); re += x[i]! * w * Math.cos((2 * Math.PI * k * f0 * i) / SR); im += x[i]! * w * Math.sin((2 * Math.PI * k * f0 * i) / SR); }
      const amp = (2 * Math.hypot(re, im)) / (N * 0.5);
      harmonics += (amp * amp) / 2;
    }
    expect(10 * Math.log10(Math.max(1e-12, total - harmonics) / total)).toBeLessThan(-25);
  });
});

describe('MOA-UNICORN drums', () => {
  it('every drum sounds, short, and stops on its own', () => {
    for (const kind of ['kick', 'snare', 'hat', 'clap', 'wood', 'bell']) {
      const c = new ToneCore(SR, 'drums');
      c.drum(kind, 1, 0);
      const out = run(c, 0.5);
      expect(rms(out, 0, 2400), kind).toBeGreaterThan(0.005);
      expect(rms(out, 20000, 24000), kind).toBe(0);
    }
  });

  it('the kick is low and the hi-hat bright', () => {
    const play = (kind: string) => { const c = new ToneCore(SR, 'drums'); c.drum(kind, 1, 0); return run(c, 0.1); };
    const crossings = (x: Float32Array) => { let n = 0; for (let i = 1; i < 4800; i++) if ((x[i - 1]! < 0) !== (x[i]! < 0)) n++; return n; };
    expect(crossings(play('kick'))).toBeLessThan(40);
    expect(crossings(play('hat'))).toBeGreaterThan(1500);
  });
});

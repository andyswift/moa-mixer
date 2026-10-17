import { describe, expect, it } from 'vitest';
import { FOLD_SOURCE } from '../foldWorklet';

type Params = { fold: number; even: number; harmonics: number; pitch: number };
interface Core { process(input: Float32Array, output: Float32Array, n: number, p: Params): void }
const { FoldCore } = new Function(`${FOLD_SOURCE}; return { FoldCore };`)() as { FoldCore: new (sr: number) => Core };

const SR = 48000;
const cents = (hz: number) => 1200 * Math.log2(hz / 440);

/** A sine at `hz` through the folder; returns the output after it has settled. */
function render(hz: number, p: Partial<Params>, n = 9600, settle = 4800): Float32Array {
  const core = new FoldCore(SR);
  const total = n + settle;
  const input = Float32Array.from({ length: total }, (_, i) => 0.8 * Math.sin((2 * Math.PI * hz * i) / SR));
  const out = new Float32Array(total);
  for (let at = 0; at < total; at += 128) {
    const len = Math.min(128, total - at);
    core.process(input.subarray(at, at + len), out.subarray(at, at + len), len, { fold: 1, even: 0, harmonics: 16, pitch: cents(hz), ...p });
  }
  return out.subarray(settle);
}

/** The same sine through a plain sin() folder: no antialiasing, no oversampling, no filter. */
function naive(hz: number, fold: number, n = 9600): Float32Array {
  return Float32Array.from({ length: n }, (_, i) => Math.sin(fold * Math.PI * 0.5 * 0.8 * Math.sin((2 * Math.PI * hz * i) / SR)));
}

/** Power per DFT bin over a window that holds a whole number of periods (so harmonics fall exactly on bins). */
function spectrum(x: Float32Array): Float64Array {
  const n = x.length;
  const p = new Float64Array(n / 2);
  for (let k = 0; k < n / 2; k++) {
    let re = 0, im = 0;
    for (let i = 0; i < n; i++) {
      const a = (2 * Math.PI * k * i) / n;
      re += x[i]! * Math.cos(a);
      im -= x[i]! * Math.sin(a);
    }
    p[k] = re * re + im * im;
  }
  return p;
}
const db = (r: number) => 10 * Math.log10(r);

/** Energy away from the note's harmonics (aliases folded back from above Nyquist), relative to all of it. */
function inharmonic(x: Float32Array, hz: number): number {
  const p = spectrum(x);
  const step = (hz * x.length) / SR; // bins per harmonic
  let all = 0, off = 0;
  p.forEach((v, k) => {
    if (k === 0) return;
    all += v;
    if (Math.abs(k / step - Math.round(k / step)) > 0.02) off += v;
  });
  return db(off / all);
}

describe('wavefolder', () => {
  it('keeps aliasing far below a plain folder on a high note folded hard', () => {
    // 9600 samples hold exactly 401 periods, but 48 kHz is not a whole number of them, so aliases land between the
    // harmonics, as they do for any real note (at 2000 Hz every alias would hide on a harmonic)
    const hz = 2005;
    const ours = inharmonic(render(hz, { fold: 8, harmonics: 64 }), hz);
    const plain = inharmonic(naive(hz, 8), hz);
    expect(ours).toBeLessThan(-65); // measured -73 dB, against -23.5 dB for the plain folder
    expect(ours).toBeLessThan(plain - 40);
  });

  it('a symmetric fold makes odd harmonics only; Even adds the octave and other even ones', () => {
    const hz = 200;
    const harmonic = (x: Float32Array, h: number) => spectrum(x)[(h * hz * x.length) / SR]!;
    const sym = render(hz, { fold: 4 });
    expect(db(harmonic(sym, 2) / harmonic(sym, 1))).toBeLessThan(-60);
    const biased = render(hz, { fold: 4, even: 0.5 });
    expect(db(harmonic(biased, 2) / harmonic(biased, 1))).toBeGreaterThan(-25);
  });

  it('the harmonics control keeps that many harmonics of the note and takes out the fizz above', () => {
    const hz = 200;
    const above = (x: Float32Array, from: number) => {
      const p = spectrum(x);
      let hi = 0, all = 0;
      p.forEach((v, k) => { all += v; if ((k * SR) / x.length > from) hi += v; });
      return hi / all;
    };
    const few = above(render(hz, { fold: 6, harmonics: 4 }), 2400);
    const many = above(render(hz, { fold: 6, harmonics: 48 }), 2400);
    expect(db(few / many)).toBeLessThan(-25);
  });

  it('more fold brings in more harmonics, gradually', () => {
    const hz = 200;
    const bright = (fold: number) => {
      const p = spectrum(render(hz, { fold, harmonics: 64 }));
      let hi = 0, all = 0;
      p.forEach((v, k) => { all += v; if ((k * SR) / 9600 > 1000) hi += v; });
      return hi / all;
    };
    const levels = [1, 2, 4, 8].map(bright);
    for (let i = 1; i < levels.length; i++) expect(levels[i]!).toBeGreaterThan(levels[i - 1]!);
  });

  it('stays bounded and centred (no DC), even with the bias at full', () => {
    for (const p of [{ fold: 12, even: 1, harmonics: 64 }, { fold: 0.5, even: 0, harmonics: 2 }]) {
      const out = render(110, p, 19200, 24000);
      let peak = 0, sum = 0;
      for (const v of out) { peak = Math.max(peak, Math.abs(v)); sum += v; }
      expect(peak).toBeLessThan(1.5);
      expect(Math.abs(sum / out.length)).toBeLessThan(0.01);
      expect(out.every(Number.isFinite)).toBe(true);
    }
  });
});

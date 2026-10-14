import { describe, expect, it } from 'vitest';
import { DF_SOURCE } from '../dfWorklet';

type Params = Record<string, number>;
interface DFCoreI {
  e1: { v: number };
  sh: number;
  setKeys(on: boolean): void;
  setOpen(which: number, on: boolean): void;
  process(inL: Float32Array | null, inR: Float32Array | null, l: Float32Array, r: Float32Array, n: number, p: Params): void;
}

const mod = new Function(`${DF_SOURCE}; return { DFCore, DF_DEFAULTS };`)() as {
  DFCore: new (sr: number, random?: () => number) => DFCoreI;
  DF_DEFAULTS: Params;
};

const SR = 48000;
function seeded(seed = 7): () => number {
  let s = seed;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 4294967296;
  };
}

/** A clean, open, dry setup: both filters wide open LP with no resonance, no delay; tests override what they need. */
const base = (extra: Params = {}): Params => ({
  ...mod.DF_DEFAULTS, f1Cut: 20000, f2Cut: 20000, f1Res: 0, f2Res: 0, f1Type: 0, f2Type: 0, dlLevel: 0, dlRep: 0,
  mixA: 1, mixB: 1, vol: 1, ...extra,
});

function run(core: DFCoreI, inL: Float32Array | null, inR: Float32Array | null, seconds: number, p: Params) {
  const n = Math.floor(seconds * SR);
  const l = new Float32Array(n);
  const r = new Float32Array(n);
  for (let at = 0; at < n; at += 128) {
    const len = Math.min(128, n - at);
    core.process(inL && inL.subarray(at, at + len), inR && inR.subarray(at, at + len), l.subarray(at, at + len), r.subarray(at, at + len), len, p);
  }
  return { l, r };
}
const sine = (hz: number, seconds: number, amp = 0.1, sr = SR): Float32Array => {
  const out = new Float32Array(Math.floor(seconds * sr));
  for (let i = 0; i < out.length; i++) out[i] = amp * Math.sin((2 * Math.PI * hz * i) / sr);
  return out;
};
const rms = (a: Float32Array, from = 0): number => {
  let s = 0;
  for (let i = from; i < a.length; i++) s += a[i]! * a[i]!;
  return Math.sqrt(s / (a.length - from));
};
/** Gain of filter I (left) at one frequency, with the settling transient skipped. */
function gainAt(p: Params, hz: number): number {
  const x = sine(hz, 0.4);
  const { l } = run(new mod.DFCore(SR, seeded()), x, null, 0.4, p);
  return rms(l, Math.floor(0.2 * SR)) / rms(x, Math.floor(0.2 * SR));
}
const maxAbs = (a: Float32Array): number => {
  let m = 0;
  for (let i = 0; i < a.length; i++) m = Math.max(m, Math.abs(a[i]!));
  return m;
};
const db = (g: number): number => 20 * Math.log10(Math.max(g, 1e-9));

describe('filter shapes', () => {
  it('the GEN R-8 low-pass falls about 12 dB/oct and the 2045 about 24 dB/oct', () => {
    const slope = (type: number) => {
      const p = base({ f1Cut: 1000, f1Type: type });
      return db(gainAt(p, 4000)) - db(gainAt(p, 8000));
    };
    expect(slope(0)).toBeGreaterThan(9);
    expect(slope(0)).toBeLessThan(15);
    expect(slope(4)).toBeGreaterThan(20);
  });

  it('band-pass peaks at the cutoff, high-pass blocks the lows, notch rejects the cutoff', () => {
    const bp = base({ f1Cut: 1000, f1Type: 1, f1Res: 0.6 });
    expect(gainAt(bp, 1000)).toBeGreaterThan(gainAt(bp, 100) * 3);
    expect(gainAt(bp, 1000)).toBeGreaterThan(gainAt(bp, 10000) * 3);
    const hp = base({ f1Cut: 1000, f1Type: 2 });
    expect(gainAt(hp, 8000)).toBeGreaterThan(0.7);
    expect(db(gainAt(hp, 100))).toBeLessThan(-15);
    const nt = base({ f1Cut: 1000, f1Type: 3, f1Res: 0.3 });
    expect(gainAt(nt, 1000)).toBeLessThan(gainAt(nt, 250) * 0.15);
    expect(gainAt(nt, 4000)).toBeGreaterThan(0.5);
  });

  it('BANDSTOP+ rejects a wide band between its two edges', () => {
    const p = base({ f1Cut: 1000, f1Type: 7, f1Res: 0.2 });
    expect(gainAt(p, 1000)).toBeLessThan(gainAt(p, 80) * 0.5);
    expect(gainAt(p, 1000)).toBeLessThan(gainAt(p, 10000) * 0.5);
  });

  it('BP+ shows two peaks when resonant', () => {
    const p = base({ f1Cut: 1000, f1Type: 5, f1Res: 0.85 });
    const freqs: number[] = [];
    for (let i = 0; i <= 40; i++) freqs.push(100 * Math.pow(100, i / 40));
    const g = freqs.map((f) => gainAt(p, f));
    let peaks = 0;
    for (let i = 1; i < g.length - 1; i++) if (g[i]! > g[i - 1]! && g[i]! > g[i + 1]! && g[i]! > 0.05) peaks++;
    expect(peaks).toBeGreaterThanOrEqual(2);
  });

  it('every type stays quiet for silence at moderate resonance', () => {
    for (let type = 0; type < 8; type++) {
      const { l } = run(new mod.DFCore(SR, seeded()), null, null, 0.5, base({ f1Type: type, f1Cut: 1000, f1Res: 0.5 }));
      expect(rms(l, SR / 4)).toBeLessThan(1e-3);
    }
  });
});

describe('self-oscillation', () => {
  const crossings = (a: Float32Array, from: number): number => {
    let c = 0;
    for (let i = from + 1; i < a.length; i++) if (a[i - 1]! < 0 && a[i]! >= 0) c++;
    return c;
  };
  for (const [name, type] of [['GEN R-8', 0], ['2045', 4]] as const) {
    it(`${name} rings at the cutoff with no input, and stays bounded`, () => {
      const p = base({ f1Type: type, f1Cut: 1000, f1Res: 1 });
      const { l } = run(new mod.DFCore(SR, seeded()), null, null, 2, p);
      const from = SR;
      expect(rms(l, from)).toBeGreaterThan(0.05);
      expect(maxAbs(l.subarray(from))).toBeLessThan(1.12);
      const hz = crossings(l, from) / ((l.length - from) / SR);
      expect(hz).toBeGreaterThan(700);
      expect(hz).toBeLessThan(1300);
    });
  }
  it('both filters oscillate independently (right channel is filter II)', () => {
    const p = base({ f1Res: 0.3, f2Type: 4, f2Cut: 500, f2Res: 1 });
    const { l, r } = run(new mod.DFCore(SR, seeded()), null, null, 2, p);
    expect(rms(r, SR)).toBeGreaterThan(0.05);
    expect(rms(l, SR)).toBeLessThan(1e-3);
  });
});

describe('stability', () => {
  it('stays finite and bounded for extreme settings, every type, several sample rates', () => {
    for (const sr of [44100, 48000, 96000]) {
      const rnd = seeded(99);
      for (let trial = 0; trial < 12; trial++) {
        const p = base({
          f1Type: trial % 8, f2Type: (trial * 3) % 8, f1Cut: 10 + rnd() * 21990, f2Cut: 10 + rnd() * 21990,
          f1Res: rnd() > 0.4 ? 1 : rnd(), f2Res: rnd() > 0.4 ? 1 : rnd(), f1Depth: rnd() * 2 - 1, f2Depth: rnd() * 2 - 1,
          f1Noise: rnd(), f2Noise: rnd(), f1Vca: rnd() > 0.5 ? 1 : 0, dlRep: 1, dlLevel: 1, dlTime: 0.02 + rnd() * 0.5,
          dlMod: rnd() * 2 - 1, e1Loop: 1, e1Atk: 0.001, e1Rel: 0.01, shRate: 40, shSlew: 0, mixA: 1.5, mixB: 1.5, vol: 1.5,
          f1Src: trial % 2, f2Src: (trial + 1) % 2,
        });
        const core = new mod.DFCore(sr, seeded(trial));
        const x = new Float32Array(sr);
        const y = new Float32Array(sr);
        for (let i = 0; i < sr; i++) { x[i] = rnd() * 2 - 1; y[i] = rnd() * 2 - 1; }
        const l = new Float32Array(sr), r = new Float32Array(sr);
        for (let at = 0; at < sr; at += 128) {
          const len = Math.min(128, sr - at);
          core.process(x.subarray(at, at + len), y.subarray(at, at + len), l.subarray(at, at + len), r.subarray(at, at + len), len, p);
        }
        for (const ch of [l, r]) for (let i = 0; i < ch.length; i++) {
          if (!Number.isFinite(ch[i]!) || Math.abs(ch[i]!) > 1.12) throw new Error(`bad sample ${ch[i]} at ${i}, sr ${sr}, trial ${trial}`);
        }
      }
    }
  });
});

describe('envelopes and gates', () => {
  const tone = sine(440, 3, 0.3);
  it('with the VCA on, the keys gate opens and releases the sound', () => {
    const core = new mod.DFCore(SR, seeded());
    const p = base({ f1Vca: 1, e1Atk: 0.005, e1Sus: 1, e1Rel: 0.05, e1Trig: 0 });
    const a = run(core, tone.subarray(0, SR / 2), null, 0.5, p);
    expect(rms(a.l, SR / 4)).toBeLessThan(1e-4);
    core.setKeys(true);
    const b = run(core, tone.subarray(0, SR / 2), null, 0.5, p);
    expect(rms(b.l, SR / 4)).toBeGreaterThan(0.1);
    core.setKeys(false);
    const c = run(core, tone.subarray(0, SR), null, 1, p);
    expect(rms(c.l, SR / 2)).toBeLessThan(1e-4);
  });

  it('the OPEN button gates the envelope too', () => {
    const core = new mod.DFCore(SR, seeded());
    const p = base({ f1Vca: 1, e1Atk: 0.005, e1Sus: 1 });
    core.setOpen(0, true);
    const { l } = run(core, tone.subarray(0, SR / 2), null, 0.5, p);
    expect(rms(l, SR / 4)).toBeGreaterThan(0.1);
  });

  it('the audio threshold opens the envelope for loud input only', () => {
    const p = base({ f1Vca: 1, e1Trig: 1, f1Gate: 1, f1Thr: 0.6, e1Atk: 0.002, e1Sus: 1 });
    const quiet = run(new mod.DFCore(SR, seeded()), sine(440, 0.5, 0.005), null, 0.5, p);
    expect(rms(quiet.l, SR / 4)).toBeLessThan(1e-4);
    const loud = run(new mod.DFCore(SR, seeded()), sine(440, 0.5, 0.5), null, 0.5, p);
    expect(rms(loud.l, SR / 4)).toBeGreaterThan(0.1);
    const off = run(new mod.DFCore(SR, seeded()), sine(440, 0.5, 0.5), null, 0.5, { ...p, f1Gate: 0 });
    expect(rms(off.l, SR / 4)).toBeLessThan(1e-4);
  });

  it('a looping AR cycles at 1 / (attack + release)', () => {
    const core = new mod.DFCore(SR, seeded());
    const p = base({ e1Loop: 1, e1Atk: 0.05, e1Rel: 0.15 });
    let rises = 0, was = 0;
    const l = new Float32Array(16), r = new Float32Array(16);
    for (let i = 0; i < (2 * SR) / 16; i++) {
      core.process(null, null, l, r, 16, p);
      if (was < 0.5 && core.e1.v >= 0.5) rises++;
      was = core.e1.v;
    }
    expect(rises).toBeGreaterThanOrEqual(9);
    expect(rises).toBeLessThanOrEqual(11);
  });

  it('exponential and linear envelopes both reach full level and fall back to zero', () => {
    for (const exp of [0, 1]) {
      const core = new mod.DFCore(SR, seeded());
      const p = base({ e1Exp: exp, e1Atk: 0.02, e1Dec: 0.05, e1Sus: 0.5, e1Rel: 0.1 });
      const l = new Float32Array(128), r = new Float32Array(128);
      core.setOpen(0, true);
      let peak = 0;
      for (let i = 0; i < 200; i++) { core.process(null, null, l, r, 128, p); peak = Math.max(peak, core.e1.v); }
      expect(peak).toBeCloseTo(1, 1);
      expect(core.e1.v).toBeCloseTo(0.5, 1);
      core.setOpen(0, false);
      for (let i = 0; i < 400; i++) core.process(null, null, l, r, 128, p);
      expect(core.e1.v).toBeLessThan(0.01);
    }
  });

  it('the envelope sweeps the cutoff: a positive depth brightens the note on the gate', () => {
    const core = new mod.DFCore(SR, seeded());
    const x = sine(4000, 1, 0.2);
    const p = base({ f1Cut: 200, f1Depth: 1, e1Atk: 0.001, e1Sus: 1 });
    const closed = run(core, x.subarray(0, SR / 2), null, 0.5, p);
    core.setOpen(0, true);
    const open = run(core, x.subarray(0, SR / 2), null, 0.5, p);
    expect(rms(open.l, SR / 4)).toBeGreaterThan(rms(closed.l, SR / 4) * 20);
  });

  it('ENV I LINK makes filter II follow envelope I', () => {
    const x = sine(440, 1, 0.3);
    const p = base({ f2Vca: 1, e1Sus: 1, e1Atk: 0.002, e2Sus: 1 });
    const core = new mod.DFCore(SR, seeded());
    core.setOpen(0, true);
    const unlinked = run(core, null, x.subarray(0, SR / 2), 0.5, p);
    expect(rms(unlinked.r, SR / 4)).toBeLessThan(1e-4);
    const core2 = new mod.DFCore(SR, seeded());
    core2.setOpen(0, true);
    const linked = run(core2, null, x.subarray(0, SR / 2), 0.5, { ...p, envLink: 1 });
    expect(rms(linked.r, SR / 4)).toBeGreaterThan(0.1);
  });

  it('C.OFF LINK makes filter II take filter I’s cutoff', () => {
    const x = sine(4000, 0.5, 0.2);
    const p = base({ f1Cut: 20000, f2Cut: 100 });
    const apart = run(new mod.DFCore(SR, seeded()), null, x, 0.5, p);
    const linked = run(new mod.DFCore(SR, seeded()), null, x, 0.5, { ...p, cutLink: 1 });
    expect(rms(linked.r, SR / 4)).toBeGreaterThan(rms(apart.r, SR / 4) * 20);
  });
});

describe('sample and hold', () => {
  const maxStep = (slew: number): number => {
    const core = new mod.DFCore(SR, seeded(3));
    const p = base({ shRate: 30, shSlew: slew });
    const l = new Float32Array(1), r = new Float32Array(1);
    let prev = 0, max = 0;
    for (let i = 0; i < SR; i++) {
      core.process(null, null, l, r, 1, p);
      max = Math.max(max, Math.abs(core.sh - prev));
      prev = core.sh;
    }
    return max;
  };
  it('steps without slew and glides with it', () => {
    expect(maxStep(0)).toBeGreaterThan(0.1);
    expect(maxStep(0.8)).toBeLessThan(maxStep(0) / 20);
  });
  it('samples noise into -1..1 and envelope I into the same range', () => {
    const core = new mod.DFCore(SR, seeded(5));
    const l = new Float32Array(128), r = new Float32Array(128);
    let lo = 1, hi = -1;
    for (let i = 0; i < 400; i++) {
      core.process(null, null, l, r, 128, base({ shRate: 40, shSlew: 0 }));
      lo = Math.min(lo, core.sh); hi = Math.max(hi, core.sh);
    }
    expect(lo).toBeLessThan(-0.5);
    expect(hi).toBeGreaterThan(0.5);
    expect(lo).toBeGreaterThanOrEqual(-1);
    expect(hi).toBeLessThanOrEqual(1);
  });
});

describe('noise, mixer and delay', () => {
  it('the NOISE knob puts noise through the filter even with no input', () => {
    const quiet = run(new mod.DFCore(SR, seeded()), null, null, 0.3, base());
    const noisy = run(new mod.DFCore(SR, seeded()), null, null, 0.3, base({ f1Noise: 1 }));
    expect(rms(quiet.l, 4800)).toBeLessThan(1e-4);
    expect(rms(noisy.l, 4800)).toBeGreaterThan(0.05);
  });

  it('stereo keeps the filters apart, mono sums them to both sides', () => {
    const x = sine(440, 0.5, 0.3);
    const st = run(new mod.DFCore(SR, seeded()), x, null, 0.5, base());
    expect(rms(st.l, SR / 4)).toBeGreaterThan(0.1);
    expect(rms(st.r, SR / 4)).toBeLessThan(1e-4);
    const mono = run(new mod.DFCore(SR, seeded()), x, null, 0.5, base({ mono: 1 }));
    expect(rms(mono.l, SR / 4)).toBeGreaterThan(0.1);
    expect(rms(mono.r, SR / 4)).toBeCloseTo(rms(mono.l, SR / 4), 3);
  });

  it('the delay repeats a click after the set time, quieter each time, and is centred', () => {
    const click = new Float32Array(SR * 2);
    click[100] = 0.8;
    const p = base({ dlTime: 0.1, dlRep: 0.5, dlLevel: 1, mixA: 0, mixB: 1, f2Cut: 20000 });
    const wet = run(new mod.DFCore(SR, seeded()), null, click, 2, { ...p, mixB: 1 });
    const peakAround = (a: Float32Array, centre: number, half: number): number => {
      let m = 0;
      for (let i = centre - half; i < centre + half; i++) m = Math.max(m, Math.abs(a[i]!));
      return m;
    };
    const first = peakAround(wet.r, 100 + 0.1 * SR, 0.004 * SR);
    const second = peakAround(wet.r, 100 + 0.2 * SR, 0.006 * SR);
    expect(first).toBeGreaterThan(0.02);
    expect(second).toBeGreaterThan(0.002);
    expect(second).toBeLessThan(first);
    const centred = peakAround(wet.l, 100 + 0.1 * SR, 0.004 * SR);
    expect(centred).toBeGreaterThan(0.02);
  });

  it('the delay loop stays bounded at full repeats', () => {
    const x = sine(220, 6, 0.9);
    const { l } = run(new mod.DFCore(SR, seeded()), x, x, 6, base({ dlRep: 1, dlLevel: 1, dlTime: 0.15, vol: 1 }));
    expect(maxAbs(l)).toBeLessThan(1.12);
  });

  it('the delay darkens as the time grows', () => {
    const hiss = new Float32Array(SR);
    const rnd = seeded(11);
    for (let i = 0; i < 2400; i++) hiss[i] = rnd() * 2 - 1;
    const brightness = (time: number): number => {
      const { l } = run(new mod.DFCore(SR, seeded()), hiss, hiss, 1, base({ mixA: 0, mixB: 1, dlLevel: 1, dlTime: time, dlRep: 0 }));
      let hf = 0, all = 0;
      for (let i = 1; i < l.length; i++) { const d = l[i]! - l[i - 1]!; hf += d * d; all += l[i]! * l[i]!; }
      return hf / Math.max(all, 1e-12);
    };
    expect(brightness(0.5)).toBeLessThan(brightness(0.05));
  });
});

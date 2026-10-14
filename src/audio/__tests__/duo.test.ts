import { describe, expect, it } from 'vitest';
import { DUO_SOURCE } from '../duoWorklet';

type Params = Record<string, number>;
interface DuoCoreI {
  m1: { v: number };
  m2: { v: number };
  mv: { v: number };
  play(n1: number, n2: number, gate: boolean, retrig: boolean): void;
  process(l: Float32Array, r: Float32Array, n: number, p: Params): void;
}
const mod = new Function(`${DUO_SOURCE}; return { DuoCore, DUO_DEFAULTS };`)() as {
  DuoCore: new (sr: number, random?: () => number) => DuoCoreI;
  DUO_DEFAULTS: Params;
};

const SR = 48000;
function seeded(seed = 3): () => number {
  let s = seed;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 4294967296;
  };
}
/** An open, dry setup: osc 1 only, filters wide open, VCA held open, no reverb. */
const base = (extra: Params = {}): Params => ({
  ...mod.DUO_DEFAULTS, o1Off: 0, o1Lvl: 1, o2Lvl: 0, cutoff: 20000, res: 0, vcaHold: 1, vcaRise: 0.001, level: 1, rvMix: 0, ...extra,
});
function run(core: DuoCoreI, seconds: number, p: Params, block = 128) {
  const n = Math.floor(seconds * SR);
  const l = new Float32Array(n), r = new Float32Array(n);
  for (let at = 0; at < n; at += block) {
    const len = Math.min(block, n - at);
    core.process(l.subarray(at, at + len), r.subarray(at, at + len), len, p);
  }
  return { l, r };
}
const rms = (a: Float32Array, from = 0): number => {
  let s = 0;
  for (let i = from; i < a.length; i++) s += a[i]! * a[i]!;
  return Math.sqrt(s / (a.length - from));
};
const maxAbs = (a: Float32Array, from = 0): number => {
  let m = 0;
  for (let i = from; i < a.length; i++) m = Math.max(m, Math.abs(a[i]!));
  return m;
};
/** Frequency by counting rising zero crossings. */
function pitch(a: Float32Array, from = 0): number {
  let first = -1, last = -1, count = 0;
  for (let i = from + 1; i < a.length; i++) if (a[i - 1]! < 0 && a[i]! >= 0) {
    if (first < 0) first = i; last = i; count++;
  }
  return count < 2 ? 0 : ((count - 1) * SR) / (last - first);
}
/** Level of a sine probe through the box: the oscillators are not used, so test filters with noise instead. */
function newCore(): DuoCoreI { return new mod.DuoCore(SR, seeded()); }

describe('oscillators', () => {
  it('osc 1 plays the note in tune, octave switch included', () => {
    for (const [note, off, hz] of [[69, 0, 440], [57, 12, 440], [69, -12, 220], [60, 0, 261.63]] as const) {
      const core = newCore();
      core.play(note, note, true, true);
      const { l } = run(core, 0.6, base({ o1Off: off }));
      expect(Math.abs(pitch(l, SR / 4) / hz - 1)).toBeLessThan(0.01);
    }
  });

  it('osc 2 follows its own note, the detune slider raises it, and tune moves both', () => {
    const core = newCore();
    core.play(60, 69, true, true);
    const p = base({ o1Lvl: 0, o2Lvl: 1 });
    expect(Math.abs(pitch(run(core, 0.6, p).l, SR / 4) / 440 - 1)).toBeLessThan(0.01);
    const up = newCore();
    up.play(60, 57, true, true);
    expect(Math.abs(pitch(run(up, 0.6, { ...p, o2Dtn: 12 }).l, SR / 4) / 440 - 1)).toBeLessThan(0.01);
    const tuned = newCore();
    tuned.play(69, 69, true, true);
    const sharp = pitch(run(tuned, 0.6, base({ tune: 100 })).l, SR / 4);
    expect(sharp / 440).toBeGreaterThan(1.05);
    expect(sharp / 440).toBeLessThan(1.07);
  });

  it('hard sync locks osc 2 to osc 1’s pitch', () => {
    const core = newCore();
    core.play(57, 78, true, true); // osc 2 far above osc 1, not a whole multiple
    const p = base({ o1Lvl: 0, o2Lvl: 1, sync: 1 });
    // osc 1 is silent in the mix but still resets osc 2: the output repeats at osc 1's rate
    const { l } = run(core, 0.5, { ...p, o1Off: 0 });
    const free = newCore();
    free.play(57, 78, true, true);
    const unsynced = run(free, 0.5, { ...p, sync: 0 }).l;
    const lag = Math.round(SR / 220);
    const correlation = (a: Float32Array): number => {
      let num = 0, den = 0;
      for (let i = SR / 4; i + lag < a.length; i++) { num += a[i]! * a[i + lag]!; den += a[i]! * a[i]!; }
      return num / den;
    };
    expect(correlation(l)).toBeGreaterThan(0.9);
    expect(correlation(unsynced)).toBeLessThan(0.8);
  });

  it('glide takes time to reach the new note', () => {
    const core = newCore();
    core.play(60, 60, true, true);
    run(core, 0.2, base());
    core.play(72, 72, true, false);
    const slow = run(core, 0.08, base({ o1Gld: 0.7 }));
    expect(pitch(slow.l, 0)).toBeLessThan(400);
    const fast = newCore();
    fast.play(60, 60, true, true);
    run(fast, 0.2, base());
    fast.play(72, 72, true, false);
    expect(Math.abs(pitch(run(fast, 0.3, base()).l, SR / 10) / 523.25 - 1)).toBeLessThan(0.02);
  });

  it('vibrato modulates the pitch', () => {
    const core = newCore();
    core.play(69, 69, true, true);
    const { l } = run(core, 1, base({ vibLvl: 1, vibRate: 5 }));
    const half = (from: number, to: number) => pitch(l.subarray(from, to));
    const f = [0, 1, 2, 3, 4, 5, 6, 7, 8, 9].map((k) => half((k * SR) / 10, ((k + 1) * SR) / 10));
    expect(Math.max(...f) - Math.min(...f)).toBeGreaterThan(5);
  });
});

describe('filters and routing', () => {
  const noiseCore = () => newCore();
  /** Spectral tilt: energy of the highest differences versus the whole, for a noise-only source. */
  const brightness = (p: Params): number => {
    const core = noiseCore();
    core.play(60, 60, true, true);
    const { l } = run(core, 0.6, { ...base({ o1Lvl: 0, noise: 1, ...p }) });
    let hf = 0, all = 0;
    for (let i = SR / 4 + 1; i < l.length; i++) { const d = l[i]! - l[i - 1]!; hf += d * d; all += l[i]! * l[i]!; }
    return hf / Math.max(all, 1e-12);
  };

  it('the cutoff darkens the sound and the filters are 12 dB each, 24 dB in series', () => {
    expect(brightness({ cutoff: 500, vcfRoute: 2 })).toBeLessThan(brightness({ cutoff: 8000, vcfRoute: 2 }) * 0.5);
    // series low-pass (24 dB) is darker than a single filter at the same cutoff
    const single = brightness({ cutoff: 800, vcoRoute: 0, vcfRoute: 2, post: 4 }); // filter 2 held open and unused
    const series = brightness({ cutoff: 800, vcfRoute: 0 });
    expect(series).toBeLessThan(single);
  });

  it('LPF vs HPF routing: low-pass keeps the lows, high-pass the highs', () => {
    expect(brightness({ cutoff: 1000, vcfRoute: 1 })).toBeGreaterThan(brightness({ cutoff: 1000, vcfRoute: 0 }) * 3);
  });

  it('ODD (low-pass plus high-pass in parallel) is brighter than EVEN (two low-passes)', () => {
    expect(brightness({ cutoff: 1000, vcoRoute: 2, vcfRoute: 3 })).toBeGreaterThan(brightness({ cutoff: 1000, vcoRoute: 2, vcfRoute: 2 }) * 3);
  });

  it('VCO route SPLIT sends each oscillator to its own filter, and VCA bypasses the filters', () => {
    // with filter 1 closed and filter 2 open (POST up), SPLIT passes osc 2 but not osc 1
    const mk = (extra: Params) => {
      const core = newCore();
      core.play(69, 69, true, true);
      return run(core, 0.4, base({ vcoRoute: 1, vcfRoute: 2, cutoff: 20, post: 8, ...extra }));
    };
    const oneOnly = mk({ o1Lvl: 1, o2Lvl: 0 });
    const twoOnly = mk({ o1Lvl: 0, o2Lvl: 1 });
    expect(rms(twoOnly.l, SR / 4)).toBeGreaterThan(rms(oneOnly.l, SR / 4) * 10);
    // VCA route ignores the filters entirely
    const core = newCore();
    core.play(69, 69, true, true);
    const direct = run(core, 0.4, base({ vcoRoute: 3, cutoff: 20 }));
    expect(rms(direct.l, SR / 4)).toBeGreaterThan(0.1);
  });

  it('both filters self-oscillate at full resonance (VCA route, no input to the filters)', () => {
    const core = newCore();
    core.play(60, 60, true, true);
    const { l } = run(core, 2, base({ vcoRoute: 3, o1Lvl: 0, res: 1, cutoff: 800, vcfRoute: 2 }));
    expect(rms(l, SR)).toBeGreaterThan(0.05);
    expect(maxAbs(l, SR)).toBeLessThan(1.12);
    expect(Math.abs(pitch(l, SR) / 800 - 1)).toBeLessThan(0.35);
  });

  it('MOD route: SPLIT lets modulator 2 move only filter 2', () => {
    const run2 = (p: Params) => {
      const core = newCore();
      core.play(60, 60, true, true);
      return run(core, 0.5, base({ o1Lvl: 0, noise: 1, vcfRoute: 2, vcoRoute: 0, cutoff: 200, m1Lvl: 0, m1Rise: 0.001, m2Rise: 0.001, m2Fall: 5, m2Hold: 1, m2Lvl: 1, ...p }));
    };
    // all noise goes to filter 1 (NOR): with SPLIT, mod 2 only opens filter 2, so filter 1 stays dark
    const split = run2({ modRoute: 2 });
    const dual = run2({ modRoute: 1 });
    expect(rms(dual.l, SR / 4)).toBeGreaterThan(rms(split.l, SR / 4) * 3);
  });
});

describe('modulators', () => {
  const blockRun = (core: DuoCoreI, seconds: number, p: Params, sample: (t: number) => void) => {
    const l = new Float32Array(32), r = new Float32Array(32);
    for (let i = 0; i < (seconds * SR) / 32; i++) { core.process(l, r, 32, p); sample(i * 32 / SR); }
  };
  it('gate with HOLD on: rise, hold at the top, release on fall; HOLD off: rise then decay on its own', () => {
    for (const hold of [1, 0]) {
      const core = newCore();
      const p = base({ vcaRise: 0.05, vcaFall: 0.3, vcaHold: hold });
      core.play(60, 60, true, true);
      let atGate = 0;
      blockRun(core, 0.8, p, () => { atGate = core.mv.v; });
      if (hold) expect(atGate).toBeGreaterThan(0.95);
      else expect(atGate).toBeLessThan(0.05);
      core.play(60, 60, false, false);
      let after = 1;
      blockRun(core, 1.5, p, () => { after = core.mv.v; });
      expect(after).toBeLessThan(0.01);
    }
  });

  it('LFO mode loops without a gate; with HOLD on, the gate pins it at the top', () => {
    const core = newCore();
    const p = base({ m1Lfo: 1, m1Rise: 0.05, m1Fall: 0.15 });
    let rises = 0, was = 0;
    blockRun(core, 2, p, () => { if (was < 0.5 && core.m1.v >= 0.5) rises++; was = core.m1.v; });
    expect(rises).toBeGreaterThanOrEqual(8);
    expect(rises).toBeLessThanOrEqual(13);
    const held = newCore();
    held.play(60, 60, true, true);
    blockRun(held, 0.5, { ...p, m1Hold: 1 }, () => {});
    expect(held.m1.v).toBe(1);
  });

  it('legato (no retrigger) does not restart the envelope', () => {
    const core = newCore();
    const p = base({ vcaRise: 0.01, vcaFall: 1, vcaHold: 0 });
    core.play(60, 60, true, true);
    blockRun(core, 0.6, p, () => {});
    const before = core.mv.v;
    core.play(64, 64, true, false);
    blockRun(core, 0.01, p, () => {});
    expect(core.mv.v).toBeLessThanOrEqual(before);
    core.play(67, 67, true, true);
    blockRun(core, 0.05, p, () => {});
    expect(core.mv.v).toBeGreaterThan(before);
  });
});

describe('reverb and stability', () => {
  it('the reverb adds a tail that decays, and infinite decay stays bounded', () => {
    const tail = (decay: number, seconds: number) => {
      const core = newCore();
      core.play(60, 60, true, true);
      run(core, 0.3, base({ rvMix: 1, rvDecay: decay, vcaHold: 1 }));
      core.play(60, 60, false, false);
      return run(core, seconds, base({ rvMix: 1, rvDecay: decay, vcaFall: 0.05, vcaHold: 1 })).l;
    };
    const short = tail(0.1, 3);
    const long = tail(0.7, 3);
    expect(rms(long, 2 * SR)).toBeGreaterThan(rms(short, 2 * SR) * 3);
    const inf = tail(1, 8);
    expect(maxAbs(inf)).toBeLessThan(1.12);
    expect(rms(inf, 6 * SR)).toBeGreaterThan(0.001); // still ringing
  });

  it('stays finite and bounded for extreme settings across routings and sample rates', () => {
    const rnd = seeded(41);
    for (const sr of [44100, 48000, 96000]) {
      for (let trial = 0; trial < 10; trial++) {
        const p: Params = {
          ...mod.DUO_DEFAULTS, o1Lvl: 1, o2Lvl: 1, noise: rnd(), o1Wave: trial % 2, o2Wave: (trial >> 1) % 2, sync: trial % 2,
          o2Dtn: rnd() * 24, vcoRoute: trial % 4, vcfRoute: (trial * 3) % 4, modRoute: (trial * 5) % 4,
          cutoff: 20 + rnd() * 19980, res: 1, post: rnd() * 8 - 4, m1Lvl: 1, m2Lvl: 1, m1Lfo: 1, m2Lfo: trial % 2,
          m1Rise: 0.001, m1Fall: 0.01, vcaLfo: trial % 2, vcaRise: 0.001, vcaFall: 0.01, rvMix: 1, rvDecay: 1, rvTime: rnd(),
          level: 1.5, vibLvl: 1, vibRate: 20, o1Gld: rnd(), bend: 3,
        };
        const core = new mod.DuoCore(sr, seeded(trial));
        core.play(36 + trial * 5, 80 - trial * 3, true, true);
        const n = sr;
        const l = new Float32Array(n), r = new Float32Array(n);
        for (let at = 0; at < n; at += 128) {
          const len = Math.min(128, n - at);
          core.process(l.subarray(at, at + len), r.subarray(at, at + len), len, p);
        }
        for (const ch of [l, r]) for (let i = 0; i < n; i++) {
          if (!Number.isFinite(ch[i]!) || Math.abs(ch[i]!) > 1.12) throw new Error(`bad sample ${ch[i]} at ${i}, sr ${sr}, trial ${trial}`);
        }
      }
    }
  });
});

import { describe, expect, it } from 'vitest';
import { M2600_PARAMS } from '../../domain/devices/m2600Params';
import { M2600_SOURCE } from '../m2600Worklet';

type Params = Record<string, number>;
interface CoreI {
  probe: number;
  view: { gate: boolean; lfo: boolean; clk: boolean; esw: number; adsr: number; ar: number };
  play(n1: number, n2: number, gate: boolean, retrig: boolean): void;
  manual(on: boolean): void;
  setCords(list: { from: string; to: string }[]): void;
  process(l: Float32Array, r: Float32Array, n: number, p: Params): void;
}
const mod = new Function(`${M2600_SOURCE}; return { M26Core, M26_DEFAULTS, M26_O };`)() as {
  M26Core: new (sr: number, random?: () => number) => CoreI;
  M26_DEFAULTS: Params;
  M26_O: Record<string, number>;
};

const SR = 48000;
function seeded(seed = 3): () => number {
  let s = seed;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 4294967296;
  };
}
const newCore = (): CoreI => new mod.M26Core(SR, seeded());
const opt = (id: string, v: string): number => M2600_PARAMS.find((p) => p.id === id)!.options!.indexOf(v);

/** Init, with the VCF wide open and flat, the SEM off, the VCA held open and no reverb: VCO 1 pulse goes straight out. */
const open = (extra: Params = {}): Params => ({
  ...mod.M26_DEFAULTS, 'vcf.freq': 16000, 'vcf.cv.adsr': 0, 'vcf.res': 0, 'sem.route': opt('sem.route', 'off'),
  'vca.gain': 1, 'vca.cv.adsr': 0, 'reverb.left': 0, 'reverb.right': 0, ...extra,
});
function run(core: CoreI, seconds: number, p: Params, block = 128) {
  const n = Math.floor(seconds * SR);
  const l = new Float32Array(n), r = new Float32Array(n);
  for (let at = 0; at < n; at += block) {
    const len = Math.min(block, n - at);
    core.process(l.subarray(at, at + len), r.subarray(at, at + len), len, p);
  }
  return { l, r };
}
/** Runs with one output jack sent straight out (volts / 5). */
function probe(core: CoreI, jack: string, seconds: number, p: Params): Float32Array {
  core.probe = mod.M26_O[jack]!;
  return run(core, seconds, p).l;
}
const rms = (a: Float32Array, from = 0, to = a.length): number => {
  let s = 0;
  for (let i = from; i < to; i++) s += a[i]! * a[i]!;
  return Math.sqrt(s / (to - from));
};
const maxAbs = (a: Float32Array): number => a.reduce((m, x) => Math.max(m, Math.abs(x)), 0);
/** Frequency by counting rising zero crossings. */
function pitch(a: Float32Array, from = 0): number {
  let first = -1, last = -1, count = 0;
  for (let i = from + 1; i < a.length; i++) if (a[i - 1]! < 0 && a[i]! >= 0) {
    if (first < 0) first = i;
    last = i;
    count++;
  }
  return count < 2 ? 0 : ((count - 1) * SR) / (last - first);
}
/** Mean power at one frequency (Goertzel over 1024-sample windows, averaged): a band level for noise through filters. */
function band(a: Float32Array, hz: number, from = SR / 10): number {
  const N = 1024, w = 2 * Math.cos((2 * Math.PI * hz) / SR);
  let total = 0, count = 0;
  for (let at = from; at + N <= a.length; at += N) {
    let s1 = 0, s2 = 0;
    for (let i = 0; i < N; i++) {
      const s0 = a[at + i]! + w * s1 - s2;
      s2 = s1;
      s1 = s0;
    }
    total += s1 * s1 + s2 * s2 - w * s1 * s2;
    count++;
  }
  return total / count;
}
const near = (got: number, want: number, tol = 0.01) => expect(Math.abs(got / want - 1)).toBeLessThan(tol);

describe('oscillators', () => {
  it('each VCO tracks the keyboard in tune at 1 V per octave', () => {
    for (const [jack, note, hz] of [['vco1.saw', 69, 440], ['vco1.pulse', 48, 130.81], ['vco2.sine', 72, 523.25], ['vco3.tri', 57, 220]] as const) {
      const core = newCore();
      core.play(note, note, true, true);
      near(pitch(probe(core, jack, 0.5, open()), SR / 10), hz);
    }
  });

  it('initial frequency and fine tune set the pitch at middle C', () => {
    const core = newCore();
    core.play(60, 60, true, true);
    near(pitch(probe(core, 'vco2.saw', 0.5, open({ 'vco2.freq': 400, 'vco2.fine': 12 * Math.log2(1.5) })), SR / 10), 600);
  });

  it('the LF range ignores the keyboard and runs 333 times slower', () => {
    const lowNote = newCore(), highNote = newCore();
    lowNote.play(48, 48, true, true);
    highNote.play(84, 84, true, true);
    const p = open({ 'vco1.range': opt('vco1.range', 'lf'), 'vco1.freq': 3333.3 });
    const a = pitch(probe(lowNote, 'vco1.saw', 2.2, p), 100);
    const b = pitch(probe(highNote, 'vco1.saw', 2.2, p), 100);
    near(a, 10, 0.03);
    near(b, a, 0.01);
  });

  it('duo: the upper voice moves VCO 2 and 3, VCO 1 keeps the lower note', () => {
    for (const [jack, hz] of [['vco1.saw', 261.63], ['vco2.saw', 523.25], ['vco3.saw', 523.25]] as const) {
      const core = newCore();
      core.play(60, 72, true, true);
      near(pitch(probe(core, jack, 0.5, open()), SR / 10), hz);
    }
  });

  it('sync locks VCO 2 to VCO 1\'s period', () => {
    const P = 100; // VCO 1 at 480 Hz: 100 samples a cycle
    const diff = (sync: number) => {
      const core = newCore();
      core.play(60, 60, true, true);
      const a = probe(core, 'vco2.saw', 0.3, open({ 'vco1.freq': 480, 'vco2.freq': 480 * 1.37, 'vco2.sync': sync }));
      let d = 0;
      for (let i = SR / 10; i < a.length - P; i++) d += Math.abs(a[i]! - a[i + P]!);
      return d / (a.length - P - SR / 10) / rms(a, SR / 10);
    };
    expect(diff(1)).toBeLessThan(0.05);
    expect(diff(0)).toBeGreaterThan(0.3);
  });

  it('the ADSR on VCO 1 FM sweeps the pitch up', () => {
    const core = newCore();
    core.play(60, 60, true, true);
    // sustain 5 V at 0.2 on the slider: one octave up
    const a = probe(core, 'vco1.saw', 1, open({ 'vco1.fm.adsr': 0.2, 'adsr.sustain': 0.5, 'adsr.decay': 0.01 }));
    near(pitch(a, SR / 2), 523.25, 0.02);
  });
});

describe('VCF', () => {
  const noiseIn = (extra: Params) => open({ 'vcf.in.vco1': 0, 'vcf.in.noise': 1, ...extra });

  for (const mode of ['4012', '4072']) {
    it(`${mode}: closed, it takes the highs out of noise`, () => {
      const core = newCore();
      const a = probe(core, 'vcf.out', 1, noiseIn({ 'vcf.mode': opt('vcf.mode', mode), 'vcf.freq': 400, 'vcf.cv.kybd': 0 }));
      expect(band(a, 4000) / band(a, 150)).toBeLessThan(0.001);
    });

    it(`${mode}: self-oscillates at its cutoff at full resonance, and stays bounded`, () => {
      const core = newCore();
      const p = open({ 'vcf.in.vco1': 0, 'vcf.mode': opt('vcf.mode', mode), 'vcf.freq': 1000, 'vcf.res': 1 });
      const a = probe(core, 'vcf.out', 1, p);
      near(pitch(a, SR / 2), 1000, 0.06);
      expect(rms(a, SR / 2)).toBeGreaterThan(0.2);
      core.probe = -1;
      core.play(60, 60, true, true);
      const out = run(core, 1, { ...p, 'vcf.in.vco1': 1, 'vcf.in.noise': 1, 'vcf.in.ring': 1, 'mix.vcf': 1 }).l;
      expect(maxAbs(out)).toBeLessThanOrEqual(1);
    });
  }

  it('4012 loses bass as resonance rises, 4072 keeps it', () => {
    const low = (mode: string, res: number) => {
      const core = newCore();
      return band(probe(core, 'vcf.out', 1, noiseIn({ 'vcf.mode': opt('vcf.mode', mode), 'vcf.freq': 2000, 'vcf.cv.kybd': 0, 'vcf.res': res })), 100);
    };
    const drop4012 = low('4012', 0.8) / low('4012', 0);
    const drop4072 = low('4072', 0.8) / low('4072', 0);
    expect(drop4012).toBeLessThan(0.3);
    expect(drop4072).toBeGreaterThan(drop4012 * 2);
  });
});

describe('SEM', () => {
  /** Noise through a wide-open VCF into the SEM in series at 1 kHz. */
  const sem = (extra: Params) => {
    const core = newCore();
    return probe(core, 'sem.out', 1.2, open({
      'vcf.in.vco1': 0, 'vcf.in.noise': 1, 'vcf.cv.kybd': 0, 'sem.route': opt('sem.route', 'series'),
      'sem.freq': 1000, 'sem.cv.kybd': 0, 'sem.res': 0.3, ...extra,
    }));
  };

  it('LP passes lows, HP passes highs', () => {
    const lp = sem({ 'sem.mode': 0 });
    const hp = sem({ 'sem.mode': 1 });
    expect(band(lp, 150) / band(lp, 8000)).toBeGreaterThan(100);
    expect(band(hp, 8000) / band(hp, 150)).toBeGreaterThan(100);
  });

  it('the notch takes out the cutoff and keeps both sides', () => {
    const a = sem({ 'sem.mode': 0.5 });
    expect(band(a, 1000)).toBeLessThan(band(a, 150) * 0.1);
    expect(band(a, 1000)).toBeLessThan(band(a, 8000) * 0.1);
  });

  it('BP keeps the cutoff and takes out both sides', () => {
    const a = sem({ 'sem.bp': 1, 'sem.res': 0.6 });
    expect(band(a, 1000)).toBeGreaterThan(band(a, 100) * 10);
    expect(band(a, 1000)).toBeGreaterThan(band(a, 10000) * 10);
  });

  it('routing: off is a stock 2600, series puts the SEM after the VCF, parallel gives it its own inputs', () => {
    const out = (route: string, extra: Params = {}) => {
      const core = newCore();
      core.play(60, 60, true, true);
      return run(core, 1, open({
        'vcf.in.vco1': 0, 'vcf.in.noise': 1, 'vcf.cv.kybd': 0, 'sem.route': opt('sem.route', route), 'sem.freq': 200, 'sem.cv.kybd': 0, ...extra,
      })).l;
    };
    const bright = (a: Float32Array) => band(a, 6000) / band(a, 100);
    const off = out('off');
    const series = out('series');
    expect(bright(series)).toBeLessThan(bright(off) * 0.01);
    // parallel: the VCA's VCF slider hears the VCF alone, its SEM slider the SEM fed by its own sliders
    expect(bright(out('parallel'))).toBeGreaterThan(bright(off) * 0.5);
    const semOnly = out('parallel', { 'vca.in.vcf': 0, 'vca.in.sem': 1, 'sem.in.noise': 1 });
    expect(rms(semOnly, SR / 10)).toBeGreaterThan(0.02);
    expect(bright(semOnly)).toBeLessThan(bright(off) * 0.01);
    // the SEM slider on the VCA hears nothing when the SEM is off or in series
    for (const route of ['off', 'series']) expect(rms(out(route, { 'vca.in.vcf': 0, 'vca.in.sem': 1, 'sem.in.noise': 1 }), SR / 10)).toBeLessThan(1e-3);
  });
});

describe('envelopes and VCA', () => {
  const timeTo = (a: Float32Array, volts: number) => a.findIndex((x) => x * 5 >= volts) / SR;

  it('ADSR attack takes its time, decays to the sustain, and the x2 factor doubles it', () => {
    const p = open({ 'adsr.attack': 0.1, 'adsr.decay': 0.2, 'adsr.sustain': 0.5 });
    const core = newCore();
    core.play(60, 60, true, true);
    const a = probe(core, 'adsr.out', 1, p);
    near(timeTo(a, 9.99), 0.1, 0.05);
    near(a[Math.round(0.9 * SR)]! * 5, 5, 0.02);
    const slow = newCore();
    slow.play(60, 60, true, true);
    near(timeTo(probe(slow, 'adsr.out', 1, { ...p, 'adsr.factor': opt('adsr.factor', 'x2') }), 9.99), 0.2, 0.05);
  });

  it('ADSR releases when the gate closes', () => {
    const core = newCore();
    core.play(60, 60, true, true);
    const p = open({ 'adsr.sustain': 1, 'adsr.release': 0.1 });
    probe(core, 'adsr.out', 0.2, p);
    core.play(60, 60, false, false);
    const a = probe(core, 'adsr.out', 0.3, p);
    expect(a[Math.round(0.1 * SR)]! * 5).toBeLessThan(0.2);
  });

  it('the AR follows the manual button', () => {
    const core = newCore();
    core.manual(true);
    const a = probe(core, 'ar.out', 0.3, open({ 'ar.attack': 0.05 }));
    near(timeTo(a, 9.99), 0.05, 0.05);
  });

  it('with init settings the VCA is silent until a key is played, then a held note sounds at a sensible level', () => {
    const core = newCore();
    const p = { ...mod.M26_DEFAULTS };
    expect(rms(run(core, 0.5, p).l)).toBeLessThan(1e-4);
    core.play(60, 60, true, true);
    const { l, r } = run(core, 1, p);
    const level = rms(l, SR / 10);
    expect(level).toBeGreaterThan(0.05);
    expect(level).toBeLessThan(0.8);
    expect(l.every(Number.isFinite) && r.every(Number.isFinite)).toBe(true);
  });
});

describe('modulation', () => {
  it('the sample-and-hold steps at its clock rate', () => {
    const core = newCore();
    const a = probe(core, 'sh.out', 2, open({ 'sh.rate': 10 }));
    let steps = 0;
    for (let i = 1; i < a.length; i++) if (a[i] !== a[i - 1]) steps++;
    expect(steps).toBeGreaterThanOrEqual(19);
    expect(steps).toBeLessThanOrEqual(21);
  });

  it('a patch cord overrides a normal', () => {
    const core = newCore();
    core.play(69, 69, true, true);
    core.setCords([{ from: 'vco2.sine', to: 'vcf.in.vco1' }]);
    // the VCF's VCO 1 input now hears VCO 2, tuned a fifth up
    const a = probe(core, 'vcf.out', 0.5, open({ 'vco2.freq': 261.63 * 1.5 }));
    near(pitch(a, SR / 10), 660, 0.01);
  });
});

describe('safety', () => {
  it('nothing leaves ±1 with every control at its maximum', () => {
    const p: Params = {};
    for (const d of M2600_PARAMS) p[d.id] = d.max;
    p.bend = 2;
    p.modw = 1;
    const core = newCore();
    core.play(36, 96, true, true);
    const { l, r } = run(core, 2, p);
    expect(l.every(Number.isFinite) && r.every(Number.isFinite)).toBe(true);
    expect(Math.max(maxAbs(l), maxAbs(r))).toBeLessThanOrEqual(1);
    expect(rms(l, SR)).toBeGreaterThan(0.01);
  });
});

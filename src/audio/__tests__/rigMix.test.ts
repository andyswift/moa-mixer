import { describe, expect, it } from 'vitest';
import { RIG_MIX_SOURCE } from '../rigMixWorklet';

interface MixerI {
  set(id: string, value: number): void;
  process(pl: Float32Array[], pr: Float32Array[], l: Float32Array, r: Float32Array, n: number, bpm: number): void;
  meters(): { strips: Float32Array; rms: Float32Array; master: number[]; masterRms: number[]; gr: number };
}
const { RigMixer } = new Function(`${RIG_MIX_SOURCE}; return { RigMixer };`)() as { RigMixer: new (sr: number, parts?: number) => MixerI };

const SR = 48000;
const B = 128;
type Source = (t: number, i: number) => number;
/** Runs the mixer for `seconds`, each part fed by its source (mono, both sides); returns the master out. */
function run(mixer: MixerI, seconds: number, parts: Record<number, Source>, opts: { bpm?: number; during?: (t: number) => void; stereo?: Record<number, [Source, Source]> } = {}) {
  const n = Math.floor(seconds * SR);
  const l = new Float32Array(n), r = new Float32Array(n);
  const pl = Array.from({ length: 16 }, () => new Float32Array(B)), pr = Array.from({ length: 16 }, () => new Float32Array(B));
  for (let at = 0; at < n; at += B) {
    opts.during?.(at / SR);
    const len = Math.min(B, n - at);
    for (let p = 0; p < 16; p++) {
      pl[p]!.fill(0); pr[p]!.fill(0);
      const src = parts[p], st = opts.stereo?.[p];
      for (let i = 0; i < len; i++) {
        const t = (at + i) / SR;
        if (src) { const x = src(t, at + i); pl[p]![i] = x; pr[p]![i] = x; }
        if (st) { pl[p]![i] = st[0](t, at + i); pr[p]![i] = st[1](t, at + i); }
      }
    }
    mixer.process(pl, pr, l.subarray(at, at + len), r.subarray(at, at + len), len, opts.bpm ?? 120);
  }
  return { l, r };
}
const sine = (hz: number, amp = 0.5): Source => (t) => amp * Math.sin(2 * Math.PI * hz * t);
const click: Source = (_t, i) => (i === 0 ? 1 : 0);
const rms = (a: Float32Array, from = 0, to = a.length) => {
  let s = 0;
  for (let i = from; i < to; i++) s += a[i]! * a[i]!;
  return Math.sqrt(s / Math.max(1, to - from));
};
const db = (x: number) => 20 * Math.log10(x);
const fresh = () => new RigMixer(SR);
/** Index of the first sample over `level` at or after `from`. */
const firstOver = (a: Float32Array, level: number, from = 0) => { for (let i = from; i < a.length; i++) if (Math.abs(a[i]!) > level) return i; return -1; };

describe('MOA-RIG mixer: strips', () => {
  it('passes a part at unity with every strip at its defaults, and nothing from the effects', () => {
    const { l, r } = run(fresh(), 0.3, { 2: sine(440) });
    expect(rms(l, 4800)).toBeCloseTo(0.5 / Math.SQRT2, 3);
    expect(rms(r, 4800)).toBeCloseTo(0.5 / Math.SQRT2, 3);
  });

  it('fades, balances, mutes and solos', () => {
    let m = fresh();
    m.set('p1.fader', 0.5);
    m.set('p1.pan', -1);
    let o = run(m, 0.2, { 0: sine(440) });
    expect(rms(o.l, 4800) / (0.5 / Math.SQRT2)).toBeCloseTo(0.5, 2);
    expect(rms(o.r, 4800)).toBeLessThan(1e-6);
    m = fresh();
    m.set('p1.mute', 1);
    expect(rms(run(m, 0.2, { 0: sine(440) }).l, 4800)).toBeLessThan(1e-6);
    m = fresh();
    m.set('p2.solo', 1);
    o = run(m, 0.2, { 0: sine(440), 1: sine(660) });
    expect(rms(o.l, 4800)).toBeCloseTo(0.5 / Math.SQRT2, 3); // only part 2
  });

  it('EQ: a kill takes its band down by 20 dB or more and leaves the others', () => {
    const m = fresh();
    m.set('p1.lo', -30);
    const low = run(m, 0.3, { 0: sine(60) }).l, mid = run(m, 0.3, { 0: sine(2000) }).l;
    expect(db(rms(low, 4800) / (0.5 / Math.SQRT2))).toBeLessThan(-20);
    expect(Math.abs(db(rms(mid, 4800) / (0.5 / Math.SQRT2)))).toBeLessThan(1);
  });

  it('the filter knob: to the left a low-pass closes, to the right a high-pass opens, and the middle is off', () => {
    const level = (knob: number, hz: number) => {
      const m = fresh();
      m.set('p1.filter', knob);
      return db(rms(run(m, 0.4, { 0: sine(hz) }).l, 9600) / (0.5 / Math.SQRT2));
    };
    expect(level(-0.8, 5000)).toBeLessThan(-20);
    expect(level(-0.8, 80)).toBeGreaterThan(-1.5);
    expect(level(0.8, 80)).toBeLessThan(-20);
    expect(level(0.8, 8000)).toBeGreaterThan(-1.5);
    expect(Math.abs(level(0, 5000))).toBeLessThan(0.01);
  });
});

describe('MOA-RIG mixer: sends and returns', () => {
  it('send A to the dub delay: the echo comes back on return A a tempo division later, each repeat quieter', () => {
    const m = fresh();
    m.set('p1.a', 1);
    m.set('dub.wow', 0);
    m.set('dub.fdbk', 0.5);
    const { l } = run(m, 1.3, { 0: click }, { bpm: 120 }); // 3/16 at 120 = 0.375 s
    const first = firstOver(l, 0.05, 100);
    expect(first / SR).toBeCloseTo(0.375, 2);
    const second = firstOver(l, 0.01, first + 4800);
    expect(second / SR).toBeCloseTo(0.75, 2);
    const peak = (from: number) => Math.max(...Array.from(l.subarray(from - 200, from + 400), Math.abs));
    expect(peak(second)).toBeLessThan(peak(first));
  });

  it('THROW A sends the strip into the delay while held, whatever its send knob', () => {
    const m = fresh();
    m.set('dub.sync', 0);
    m.set('dub.time', 0.1);
    m.set('dub.wow', 0);
    m.set('p1.throw', 1);
    const { l } = run(m, 0.3, { 0: click });
    expect(firstOver(l, 0.05, 100) / SR).toBeCloseTo(0.1, 2);
  });

  it('a return sent into itself grows into a bounded roar, never past the ceiling', () => {
    const m = fresh();
    m.set('p1.a', 1);
    m.set('rA.a', 1);
    m.set('dub.fdbk', 1.2);
    m.set('dub.sync', 0);
    m.set('dub.time', 0.05);
    const { l, r } = run(m, 4, { 0: (t) => (t < 0.05 ? 0.8 * Math.sin(2 * Math.PI * 220 * t) : 0) });
    for (const x of [l, r]) for (let i = 0; i < x.length; i++) { expect(Number.isFinite(x[i]!)).toBe(true); expect(Math.abs(x[i]!)).toBeLessThan(1); }
    expect(rms(l, l.length - 9600)).toBeGreaterThan(0.05); // still roaring
  });

  it('the BBD in ping-pong answers left, then right', () => {
    const m = fresh();
    m.set('p1.b', 1);
    m.set('bbd.time', 0.1);
    m.set('bbd.mod', 0);
    m.set('bbd.age', 0);
    m.set('bbd.fdbk', 0.6);
    const { l, r } = run(m, 0.35, { 0: click });
    const at = (x: Float32Array, s: number) => rms(x, Math.round((s - 0.02) * SR), Math.round((s + 0.03) * SR));
    expect(at(l, 0.1)).toBeGreaterThan(10 * at(r, 0.1));
    expect(at(r, 0.2)).toBeGreaterThan(10 * at(l, 0.2));
  });

  it('the reverb: a tail that lasts about as long as its size says, longer for a hall than a plate, and FREEZE holds it', () => {
    const tail = (type: number, size: number): [number, number] => {
      const m = fresh();
      m.set('p1.c', 1);
      m.set('rev.type', type);
      m.set('rev.size', size);
      m.set('rev.pre', 0);
      const { l } = run(m, 4, { 0: (t) => (t < 0.01 ? 0.5 * Math.sin(2 * Math.PI * 300 * t) : 0) });
      return [rms(l, Math.round(0.2 * SR), Math.round(0.4 * SR)), rms(l, Math.round(1.6 * SR), Math.round(1.8 * SR))];
    };
    const [hallEarly, hallLate] = tail(2, 0.6);
    const [plateEarly, plateLate] = tail(1, 0.2);
    expect(hallEarly).toBeGreaterThan(0.001);
    expect(db(hallLate / hallEarly)).toBeGreaterThan(db(plateLate / plateEarly) + 10);
    for (const type of [0, 1, 2]) expect(tail(type, 1).every(Number.isFinite)).toBe(true);
    const m = fresh();
    m.set('p1.c', 1);
    const { l } = run(m, 3, { 0: (t) => (t < 0.3 ? 0.3 * Math.sin(2 * Math.PI * 300 * t) : 0) }, { during: (t) => m.set('rev.freeze', t > 0.4 ? 1 : 0) });
    expect(rms(l, Math.round(2.6 * SR))).toBeGreaterThan(0.3 * rms(l, Math.round(0.5 * SR), Math.round(0.7 * SR)));
  });

  it('the chorus comes back wide: the two sides differ', () => {
    const m = fresh();
    m.set('p1.d', 1);
    const { l, r } = run(m, 1, { 0: sine(330) });
    const diff = new Float32Array(l.length).map((_, i) => l[i]! - r[i]!);
    expect(rms(l, SR / 2)).toBeGreaterThan(0.1);
    expect(rms(diff, SR / 2)).toBeGreaterThan(0.02);
  });
});

describe('MOA-RIG mixer: drive, compressor, master', () => {
  it('the drive adds harmonics to its part only', () => {
    const third = (x: Float32Array) => {
      // the 3rd harmonic of 200 Hz, by a single DFT bin over whole cycles
      let re = 0, im = 0;
      for (let i = 9600; i < 9600 + 24000; i++) { re += x[i]! * Math.cos(2 * Math.PI * 600 * i / SR); im += x[i]! * Math.sin(2 * Math.PI * 600 * i / SR); }
      return Math.hypot(re, im) / 12000;
    };
    const m = fresh();
    m.set('drv.part', 3);
    m.set('drv.drive', 0.8);
    m.set('drv.tone', 1);
    expect(third(run(m, 0.8, { 2: sine(200, 0.3) }).l)).toBeGreaterThan(0.02);
    expect(third(run(m, 0.8, { 1: sine(200, 0.3) }).l)).toBeLessThan(1e-4);
  });

  it('the compressor keyed by a part ducks the mix under it, and is out of the way at 1:1', () => {
    const m = fresh();
    m.set('cmp.key', 2);
    m.set('cmp.ratio', 10);
    m.set('cmp.thresh', -30);
    m.set('cmp.atk', 1);
    m.set('p2.mute', 1); // the key is taken before the fader: a muted kick still ducks
    const kick: Source = (t) => (t % 0.5 < 0.1 ? 0.8 * Math.sin(2 * Math.PI * 60 * t) : 0);
    const { l } = run(m, 1, { 0: sine(440, 0.3), 1: kick });
    const under = rms(l, Math.round(0.52 * SR), Math.round(0.58 * SR)), free = rms(l, Math.round(0.85 * SR), Math.round(0.95 * SR));
    expect(db(under / free)).toBeLessThan(-10);
    expect(m.meters().gr).toBeLessThan(-10);
    expect(rms(run(fresh(), 0.3, { 0: sine(440, 0.3) }).l, 4800)).toBeCloseTo(0.3 / Math.SQRT2, 3);
  });

  it('the master never passes full scale, however hot', () => {
    const m = fresh();
    m.set('master.fader', 2);
    const { l } = run(m, 0.2, { 0: sine(100, 0.9), 1: sine(150, 0.9), 2: sine(200, 0.9) });
    expect(Math.max(...Array.from(l, Math.abs))).toBeLessThan(1);
    expect(m.meters().master[0]).toBeGreaterThan(0.9);
  });

  it('runs sixteen busy strips and all four effects well faster than real time', () => {
    const m = fresh();
    for (let p = 1; p <= 16; p++) { m.set(`p${p}.a`, 0.3); m.set(`p${p}.c`, 0.3); m.set(`p${p}.d`, 0.2); m.set(`p${p}.lo`, -6); m.set(`p${p}.filter`, -0.3); }
    m.set('p1.b', 0.4);
    m.set('cmp.ratio', 4);
    m.set('drv.part', 1);
    const pl = Array.from({ length: 16 }, () => Float32Array.from({ length: B }, () => Math.random() - 0.5));
    const l = new Float32Array(B), r = new Float32Array(B);
    const t0 = performance.now();
    for (let b = 0; b < SR / B; b++) m.process(pl, pl, l, r, B, 120);
    expect(1000 / (performance.now() - t0)).toBeGreaterThan(3);
  });

  it('meters RMS as well as peaks: a sine at 0.5 reads 0.354 on its strip and the master', () => {
    const m = fresh();
    run(m, 0.05, { 0: sine(440) });
    m.meters();
    run(m, 0.2, { 0: sine(440) });
    const r = m.meters();
    expect(r.rms[0]).toBeCloseTo(0.5 / Math.SQRT2, 2);
    expect(r.strips[0]).toBeCloseTo(0.5, 2);
    expect(r.masterRms[0]).toBeCloseTo(0.5 / Math.SQRT2, 2);
  });
});


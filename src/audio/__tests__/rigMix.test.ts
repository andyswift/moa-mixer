import { describe, expect, it } from 'vitest';
import { pedalParams } from '../../domain/devices/rigPedals';
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
const setAll = (m: MixerI, values: Record<string, number>) => { for (const [id, v] of Object.entries(values)) m.set(id, v); };
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

  it('the second reverb comes back on D, wide: the two sides differ', () => {
    const m = fresh();
    m.set('p1.d', 1);
    const { l, r } = run(m, 1, { 0: sine(330) });
    const diff = new Float32Array(l.length).map((_, i) => l[i]! - r[i]!);
    expect(rms(l, SR / 2)).toBeGreaterThan(0.1);
    expect(rms(diff, SR / 2)).toBeGreaterThan(0.02);
  });
});

describe('MOA-RIG mixer: drive, compressor, master', () => {
  it('a DRIVE pedal adds harmonics to its part only', () => {
    const third = (x: Float32Array) => {
      // the 3rd harmonic of 200 Hz, by a single DFT bin over whole cycles
      let re = 0, im = 0;
      for (let i = 9600; i < 9600 + 24000; i++) { re += x[i]! * Math.cos(2 * Math.PI * 600 * i / SR); im += x[i]! * Math.sin(2 * Math.PI * 600 * i / SR); }
      return Math.hypot(re, im) / 12000;
    };
    const m = fresh();
    setAll(m, pedalParams(3, 1, 'DRIVE', { Drive: 0.8, Tone: 1 }));
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
    setAll(m, pedalParams(1, 1, 'DRIVE'));
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


describe('MOA-RIG mixer: tape', () => {
  const peak = (a: Float32Array, from = 0) => { let p = 0; for (let i = from; i < a.length; i++) p = Math.max(p, Math.abs(a[i]!)); return p; };

  it('is off at 0 dB of drive: the master passes untouched', () => {
    const m = fresh();
    expect(m.set('tape.drive', 0)).toBeUndefined();
    expect(rms(run(m, 0.3, { 2: sine(440) }).l, 4800)).toBeCloseTo(0.5 / Math.SQRT2, 3);
  });

  it('driven, brings quiet passages up by half the drive and rounds the peaks, so the mix is less peaky', () => {
    const quiet = (drive: number) => { const m = fresh(); m.set('tape.drive', drive); return rms(run(m, 0.3, { 0: sine(220, 0.02) }).l, 4800); };
    expect(db(quiet(12) / quiet(0))).toBeCloseTo(6, 0);
    // a kick's spike every half second over a quiet bed: its peak over its level falls
    const kicky: Source = (t) => 0.05 * Math.sin(2 * Math.PI * 330 * t) + (t % 0.5 < 0.02 ? 0.9 * Math.sin(2 * Math.PI * 55 * t) : 0);
    const crest = (drive: number) => { const m = fresh(); m.set('tape.drive', drive); const { l } = run(m, 2, { 0: kicky }); return db(peak(l, SR) / rms(l, SR)); };
    expect(crest(12)).toBeLessThan(crest(0) - 1.5);
    const m = fresh();
    m.set('tape.drive', 18);
    expect(peak(run(m, 0.5, { 0: sine(100, 1) }).l)).toBeLessThan(1);
  });

  it('TONE takes off the highs, and the lop-sided curve leaves no DC', () => {
    const high = (tone: number) => { const m = fresh(); m.set('tape.drive', 6); m.set('tape.tone', tone); return rms(run(m, 0.3, { 0: sine(12000, 0.05) }).l, 4800); };
    expect(db(high(1) / high(0))).toBeLessThan(-4);
    const m = fresh();
    m.set('tape.drive', 18);
    const { l } = run(m, 2, { 0: sine(100, 0.8) });
    let sum = 0;
    for (let i = SR; i < 2 * SR; i++) sum += l[i]!;
    expect(Math.abs(sum / SR)).toBeLessThan(1e-3);
  });
});

describe('MOA-RIG mixer: Mutable Instruments\' effects', () => {
  const burst: Source = (t, i) => (t < 0.3 ? ((Math.imul(i + 1, 2654435761) >>> 0) / 2 ** 32 - 0.5) * 0.5 : 0);
  const energy = (a: Float32Array, from: number, to: number) => rms(a, Math.round(from * SR), Math.round(to * SR));
  const cloudsTail = (settings: Record<string, number>, seconds = 2.5) => {
    const m = fresh();
    m.set('p1.c', 1); m.set('rev.type', 3); m.set('rev.pre', 0);
    for (const [k, v] of Object.entries(settings)) m.set(k, v);
    return run(m, seconds, { 0: burst });
  };

  it('CLOUDS rings on after the sound stops, longer with SIZE, darker with DAMP, in stereo; FREEZE holds it', () => {
    const short = cloudsTail({ 'rev.size': 0.2 }), long = cloudsTail({ 'rev.size': 0.9 });
    expect(db(energy(long.l, 1, 1.5))).toBeGreaterThan(-60);
    expect(db(energy(long.l, 1, 1.5) / energy(short.l, 1, 1.5))).toBeGreaterThan(10);
    // the two sides are different taps of the loop
    let d = 0, s = 0;
    for (let i = Math.round(0.4 * SR); i < SR; i++) { d += (long.l[i]! - long.r[i]!) ** 2; s += long.l[i]! ** 2; }
    expect(d / s).toBeGreaterThan(0.2);
    // DAMP: the loop's low-pass takes the highs out of the tail
    const hi = (x: Float32Array) => { let e = 0; for (let i = Math.round(0.6 * SR); i < SR; i++) e += (x[i]! - x[i - 1]!) ** 2; return e / energy(x, 0.6, 1) ** 2; };
    expect(hi(cloudsTail({ 'rev.size': 0.7, 'rev.damp': 1 }, 1).l)).toBeLessThan(hi(cloudsTail({ 'rev.size': 0.7, 'rev.damp': 0 }, 1).l) * 0.7);
    // FREEZE from half a second on: two seconds later it is still there, as loud as it was
    const m = fresh();
    m.set('p1.c', 1); m.set('rev.type', 3); m.set('rev.pre', 0); m.set('rev.size', 0.5);
    const { l } = run(m, 3, { 0: burst }, { during: (t) => m.set('rev.freeze', t >= 0.5 ? 1 : 0) });
    // (it fades a little, as Clouds' does: the modulated taps' interpolation and the 16-bit memory lose a hair each pass)
    expect(Math.abs(db(energy(l, 2.5, 3) / energy(l, 0.6, 1.1)))).toBeLessThan(10);
  });

  it('an ENSEMBLE pedal adds a moving copy of a held note, a mono one spread left to right; at half MIX the dry stays', () => {
    const m = fresh();
    setAll(m, pedalParams(1, 1, 'CHORUS', { Mode: 'ENSEMBLE', Depth: 1, Width: 1 }, 0.5));
    const dry = run(fresh(), 1, { 0: sine(440, 0.3) }).l;
    const { l, r } = run(m, 1, { 0: sine(440, 0.3) });
    const wetL = l.map((v, i) => v - dry[i]!), wetR = r.map((v, i) => v - dry[i]!);
    expect(rms(wetL, SR / 2)).toBeGreaterThan(0.02);
    let d = 0, s = 0;
    for (let i = SR / 2; i < SR; i++) { d += (wetL[i]! - wetR[i]!) ** 2; s += wetL[i]! ** 2; }
    expect(d / s).toBeGreaterThan(0.05);
  });

  it('FLUTTER bends the dub delay\'s repeats, and at zero leaves the delay exactly as it was', () => {
    const echo = (flutter: number) => {
      const m = fresh();
      m.set('p1.a', 1); m.set('p1.fader', 0.0001); m.set('dub.sync', 0); m.set('dub.time', 0.1); m.set('dub.fdbk', 0.6); m.set('dub.wow', 0);
      if (flutter >= 0) m.set('dub.flutter', flutter);
      return run(m, 1.5, { 0: (t) => (t < 0.05 ? 0.4 * Math.sin(2 * Math.PI * 600 * t) : 0) }).l;
    };
    const plain = echo(-1), off = echo(0), on = echo(1);
    expect(off).toEqual(plain);
    let d = 0, s = 0;
    for (let i = Math.round(0.3 * SR); i < Math.round(1.2 * SR); i++) { d += (on[i]! - plain[i]!) ** 2; s += plain[i]! ** 2; }
    expect(d / s).toBeGreaterThan(0.05);
  });

  it('the tape\'s WOW wavers the master\'s pitch; at zero the master is untouched', () => {
    const play = (w: number) => { const m = fresh(); m.set('tape.wow', w); return run(m, 4, { 2: sine(1000) }).l; };
    const off = play(0), on = play(1);
    expect(rms(off, 4800)).toBeCloseTo(0.5 / Math.SQRT2, 3);
    // the period between upward zero crossings wanders when the tape does
    const periods = (x: Float32Array) => { const p: number[] = []; let last = -1; for (let i = SR; i < 4 * SR; i++) if (x[i - 1]! < 0 && x[i]! >= 0) { const at = i - x[i]! / (x[i]! - x[i - 1]!); if (last >= 0) p.push(at - last); last = at; } return p; };
    const spread = (p: number[]) => Math.max(...p) - Math.min(...p);
    expect(spread(periods(off))).toBeLessThan(0.01);
    expect(spread(periods(on))).toBeGreaterThan(0.1);
  });
});

describe('MOA-RIG mixer: Beads\' delay on send B', () => {
  /** A click of 1 kHz at 2 s (after the clock has learnt B's time), through send B in BEADS mode. */
  const beads = (settings: Record<string, number>, seconds = 3.5, tone = 1000) => {
    const m = fresh();
    m.set('p1.b', 1); m.set('p1.fader', 0.0001); m.set('bbd.mode', 1); m.set('bbd.sync', 0); m.set('bbd.time', 0.25); m.set('bbd.fdbk', 0);
    for (const [k, v] of Object.entries(settings)) m.set(k, v);
    const click: Source = (t) => (t >= 2 && t < 2.02 ? 0.5 * Math.sin(2 * Math.PI * tone * t) : 0);
    // the send is after the fader: a fader near zero would send nothing, so the send goes at full and the dry is muted by level
    m.set('p1.fader', 1);
    return run(m, seconds, { 0: click });
  };
  const at = (x: Float32Array, from: number, to: number) => rms(x, Math.round(from * SR), Math.round(to * SR));

  it('repeats at B\'s time, and again with FEEDBACK; BBD mode is as it was', () => {
    const once = beads({}).l, again = beads({ 'bbd.fdbk': 0.7 }).l;
    // the dry click at 2 s, its repeat a quarter of a second later; nothing in between
    expect(db(at(once, 2.25, 2.28) / at(once, 2.0, 2.02))).toBeGreaterThan(-12);
    expect(db(at(once, 2.1, 2.2) / at(once, 2.0, 2.02))).toBeLessThan(-40);
    expect(db(at(once, 2.5, 2.53) / at(once, 2.0, 2.02))).toBeLessThan(-40);
    expect(db(at(again, 2.5, 2.53) / at(again, 2.0, 2.02))).toBeGreaterThan(-24);
  });

  it('PITCH +12 plays the repeats an octave up; MULTIPLY moves them to a multiple of the time; FILTER low darkens them', () => {
    const zeroCrossingRate = (x: Float32Array, from: number, to: number) => {
      let c = 0;
      for (let i = Math.round(from * SR) + 1; i < to * SR; i++) if ((x[i - 1]! < 0) !== (x[i]! < 0)) c++;
      return c / 2 / (to - from);
    };
    const up = beads({ 'bds.pitch': 12 }).l;
    // the shifted repeat (a 20 ms click, through the pitch window's crossfades) sounds near 2 kHz at its middle
    const f = zeroCrossingRate(up, 2.25, 2.27);
    expect(f).toBeGreaterThan(1600);
    expect(f).toBeLessThan(2400);
    // MULTIPLY moves the repeat to a multiple of the time: at a quarter, five times it (1.25 s), none at one time
    const more = beads({ 'bds.multiply': 0.25 }).l;
    expect(db(at(more, 3.25, 3.28) / at(more, 2.0, 2.02))).toBeGreaterThan(-12);
    expect(db(at(more, 2.25, 2.28) / at(more, 2.0, 2.02))).toBeLessThan(-40);
    const dark = beads({ 'bds.filter': 0.1 }, 3.5, 3000).l, open = beads({}, 3.5, 3000).l;
    expect(db(at(dark, 2.25, 2.28) / at(open, 2.25, 2.28))).toBeLessThan(-6);
  });
});

import { describe, expect, it } from 'vitest';
import { FINGER, GAUGES, GUITAR_GAUGES, GUITAR_SCALES, SCALES, midiToHz, pluckAmplitudes, tensionFor, voiceConfig } from '../../domain/devices/bassPhysics';
import { rigStringParams, rigStringPresets, rigStringSetup, type RigStringInstrument } from '../../domain/devices/rigStrings';
import { RIG_SOURCE } from '../rigWorklet';
import { SAMPLER_SOURCE } from '../samplerWorklet';
import { STRING_SOURCE } from '../stringWorklet';

interface StringsI {
  events: { due: number; i: number; mute?: boolean }[];
  strings: { note?: number; fret: number; hz: number[]; core: { re: Float64Array; im: Float64Array } }[];
  modes(i: number, fret: number): { length: number; hz: number[]; sigma: number[]; pickup: Float64Array; strainK: Float64Array; stretch: number; palm: Float64Array; mute: Float64Array };
}
interface CoreI {
  partL: Float32Array[];
  strs: (StringsI | null)[];
  post(m: Record<string, unknown>, frame?: number): void;
  setControl(part: number, name: string, value: number): void;
  process(l: Float32Array, r: Float32Array, n: number): void;
}
const mod = new Function(`${STRING_SOURCE}\n${SAMPLER_SOURCE}\n${RIG_SOURCE}; return { RigCore };`)() as { RigCore: new (sr: number, voices?: number) => CoreI };

const SR = 48000;
const B = 128;
const setupOf = (instrument: RigStringInstrument, params: Record<string, number | string> = {}) =>
  rigStringSetup({ instrument, params: rigStringParams(instrument, params) });
function core(instrument: RigStringInstrument, params: Record<string, number | string> = {}, part = 2) {
  const c = new mod.RigCore(SR, 8);
  c.post({ type: 'kind', part, kind: instrument });
  c.post({ type: 'strings', part, setup: setupOf(instrument, params) });
  return c;
}
/** Runs the core for `seconds`, returning part `part`'s bus (left). */
function run(c: CoreI, seconds: number, part = 2, at?: (frame: number) => void): Float32Array {
  const n = Math.round(seconds * SR), out = new Float32Array(n), l = new Float32Array(B), r = new Float32Array(B);
  for (let f = 0; f < n; f += B) {
    at?.(f);
    l.fill(0); r.fill(0);
    c.process(l, r, B);
    out.set(c.partL[part]!.subarray(0, Math.min(B, n - f)), f);
  }
  return out;
}
const rms = (x: Float32Array, from = 0, to = x.length) => {
  let s = 0;
  for (let i = from; i < to; i++) s += x[i]! * x[i]!;
  return Math.sqrt(s / Math.max(1, to - from));
};
/** The fundamental by autocorrelation between `lo` and `hi` Hz, over a window. */
function pitch(x: Float32Array, lo: number, hi: number, from = Math.round(0.1 * SR), len = Math.round(0.25 * SR)): number {
  let best = 0, bestLag = 0;
  for (let lag = Math.floor(SR / hi); lag <= Math.ceil(SR / lo); lag++) {
    let s = 0;
    for (let i = from; i < from + len; i++) s += x[i]! * x[i + lag]!;
    if (s > best) { best = s; bestLag = lag; }
  }
  // parabolic refinement
  const ac = (lag: number) => { let s = 0; for (let i = from; i < from + len; i++) s += x[i]! * x[i + lag]!; return s; };
  const a = ac(bestLag - 1), b = ac(bestLag), c = ac(bestLag + 1);
  return SR / (bestLag + (0.5 * (a - c)) / (a - 2 * b + c));
}
const cents = (f: number, note: number) => 1200 * Math.log2(f / midiToHz(note));

describe('MOA-RIG string parts', () => {
  it('works a fretted string out as voiceConfig does, and a pluck as pluckAmplitudes does', () => {
    const c = core('bass');
    const s = c.strs[2]!;
    const T = tensionFor(GAUGES.A, SCALES.long, midiToHz(33));
    const want = voiceConfig({ spec: GAUGES.A, scale: SCALES.long, tension: T, fret: 5, pickup: 0.15, palm: { position: 0.03, amount: 0 }, sampleRate: SR });
    const got = s.modes(1, 5);
    expect(got.hz.length).toBe(want.hz.length);
    for (let k = 0; k < want.hz.length; k++) {
      expect(got.hz[k]!).toBeCloseTo(want.hz[k]!, 6);
      expect(got.sigma[k]!).toBeCloseTo(want.sigma[k]!, 6);
      expect(got.pickup[k]!).toBeCloseTo(want.pickup[k]!, 9);
      expect(got.mute[k]!).toBeCloseTo(want.mute[k]!, 6);
    }
    expect(got.stretch).toBeCloseTo(want.stretch, 9);
    // the pluck: D2 on the open D string, a finger at 0.12 m, half strength (the factory sound)
    c.post({ type: 'on', part: 2, note: 38, vel: 96 / 127 });
    run(c, B / SR);
    const open = voiceConfig({ spec: GAUGES.D, scale: SCALES.long, tension: tensionFor(GAUGES.D, SCALES.long, midiToHz(38)), fret: 0, pickup: 0.15, palm: { position: 0.03, amount: 0 }, sampleRate: SR });
    const height = 0.0003 * Math.pow(0.006 / 0.0003, 0.5);
    const amps = pluckAmplitudes(open.length, open.hz, { position: 0.12, height, ...FINGER });
    expect(s.strings[2]!.fret).toBe(0);
    const got1 = Math.hypot(s.strings[2]!.core.re[0]!, s.strings[2]!.core.im[0]!);
    expect(got1 / Math.abs(amps[0]!)).toBeGreaterThan(0.95); // one block of decay later
    expect(got1 / Math.abs(amps[0]!)).toBeLessThan(1.0001);
  });

  it('a guitar string hears its pickups’ coils as the standalone guitar does', () => {
    const c = core('guitar', { pickups: 'BRIDGE+MIDDLE', coils: 'HUMBUCKER' });
    const T = tensionFor(GUITAR_GAUGES.G, GUITAR_SCALES['25.5"'], midiToHz(55));
    const gain = 0.6 * Math.pow(midiToHz(40) / midiToHz(55), 0.7);
    const coils = [0.042, 0.1].flatMap((p) => [{ position: p - 0.009, gain: 0.8 * gain }, { position: p + 0.009, gain: 0.8 * gain }]);
    const want = voiceConfig({ spec: GUITAR_GAUGES.G, scale: GUITAR_SCALES['25.5"'], tension: T, fret: 3, pickup: coils, palm: { position: 0.02, amount: 0 }, sampleRate: SR });
    const got = c.strs[2]!.modes(3, 3);
    for (let k = 0; k < want.hz.length; k++) expect(got.pickup[k]!).toBeCloseTo(want.pickup[k]!, 9);
  });

  it('plays in tune on the part’s bus, an octave up when below the bass’s range', () => {
    for (const [inst, note, play] of [['bass', 33, 33], ['bass', 45, 45], ['guitar', 57, 57], ['bass', 21, 33]] as const) {
      const c = core(inst, { blend: 0 }); // the DI, so the cabinet's low cut leaves the fundamental be
      c.post({ type: 'on', part: 2, note, vel: 0.8 });
      const out = run(c, 0.5);
      expect(rms(out)).toBeGreaterThan(0.005);
      expect(Math.abs(cents(pitch(out, midiToHz(play) / 1.5, midiToHz(play) * 1.4), play))).toBeLessThan(8);
    }
  });

  it('spreads a chord across the strings and strums it: low to high down, high to low up', () => {
    for (const [mode, order] of [['DOWN', 1], ['UP', -1]] as const) {
      const c = core('guitar', { strum: mode, strumTime: 10 });
      for (const note of [52, 56, 59, 64]) c.post({ type: 'on', part: 2, note, vel: 0.8 });
      const s = c.strs[2]!;
      const ev = [...s.events].sort((a, b) => a.i - b.i);
      expect(new Set(ev.map((e) => e.i)).size).toBe(4); // four strings
      const dues = ev.map((e) => e.due);
      for (let k = 1; k < dues.length; k++) expect(order * (dues[k]! - dues[k - 1]!)).toBeGreaterThan(0);
      expect(Math.max(...dues) - Math.min(...dues)).toBeLessThanOrEqual(Math.round(0.01 * SR * 5));
    }
  });

  it('a note off damps the string; a soft note is a dead note', () => {
    const held = core('bass'), cut = core('bass'), dead = core('bass');
    held.post({ type: 'on', part: 2, note: 40, vel: 0.8 });
    cut.post({ type: 'on', part: 2, note: 40, vel: 0.8 });
    dead.post({ type: 'on', part: 2, note: 40, vel: 0.25 });
    const h = run(held, 0.6), d = run(dead, 0.6);
    const c = run(cut, 0.6, 2, (f) => { if (f === Math.round(0.1 * SR / B) * B) cut.post({ type: 'off', part: 2, note: 40 }); });
    const late = (x: Float32Array) => rms(x, Math.round(0.45 * SR), Math.round(0.6 * SR));
    expect(late(c)).toBeLessThan(late(h) * 0.05);
    expect(late(d)).toBeLessThan(late(h) * 0.02);
    expect(rms(d, 0, Math.round(0.02 * SR))).toBeGreaterThan(0); // but it is heard
  });

  it('the bend raises the pitch (a bass only up, a guitar down too); the MOD wheel palm-mutes', () => {
    const up = core('bass', { blend: 0 });
    up.setControl(2, 'bend', 1);
    up.post({ type: 'on', part: 2, note: 33, vel: 0.8 });
    expect(cents(pitch(run(up, 0.5), 40, 90), 35)).toBeCloseTo(0, -1);
    const down = core('bass', { blend: 0 });
    down.setControl(2, 'bend', -1);
    down.post({ type: 'on', part: 2, note: 33, vel: 0.8 });
    expect(Math.abs(cents(pitch(run(down, 0.5), 40, 90), 33))).toBeLessThan(10);
    const arm = core('guitar', { blend: 0 });
    arm.setControl(2, 'bend', -1);
    arm.post({ type: 'on', part: 2, note: 57, vel: 0.8 });
    expect(Math.abs(cents(pitch(run(arm, 0.5), 150, 260), 55))).toBeLessThan(10);
    const open = core('bass'), palm = core('bass');
    palm.setControl(2, 'mod', 1);
    open.post({ type: 'on', part: 2, note: 40, vel: 0.8 });
    palm.post({ type: 'on', part: 2, note: 40, vel: 0.8 });
    const tail = (x: Float32Array) => rms(x, Math.round(0.3 * SR), Math.round(0.5 * SR));
    expect(tail(run(palm, 0.5))).toBeLessThan(tail(run(open, 0.5)) * 0.3);
  });

  it('every factory sound plays clean: no NaN, peaks in range, silent once stopped', () => {
    for (const p of rigStringPresets('bass').concat(rigStringPresets('guitar'))) {
      const c = new mod.RigCore(SR, 8);
      c.post({ type: 'kind', part: 0, kind: p.instrument });
      c.post({ type: 'strings', part: 0, setup: rigStringSetup(p) });
      const notes = p.instrument === 'bass' ? [28, 40] : [52, 56, 59, 64];
      for (const note of notes) c.post({ type: 'on', part: 0, note, vel: 1 });
      const out = run(c, 1, 0, (f) => { if (f === 0.5 * SR - ((0.5 * SR) % B)) c.post({ type: 'panic' }); });
      let peak = 0;
      for (const x of out) { expect(Number.isFinite(x)).toBe(true); peak = Math.max(peak, Math.abs(x)); }
      expect(peak, p.name).toBeGreaterThan(0.02);
      expect(peak, p.name).toBeLessThan(1.5);
      expect(rms(out, Math.round(0.95 * SR)), p.name).toBeLessThan(rms(out, 0, Math.round(0.2 * SR)) * 0.03);
    }
  });

  it('the factory sounds are level-matched: each bass (a low C) and each guitar (a chord) within 5 dB of its batch’s middle', () => {
    const loudest = (x: Float32Array) => {
      let best = 0;
      for (let s = 0; s + SR / 10 <= x.length; s += SR / 20) best = Math.max(best, rms(x, s, s + SR / 10));
      return 20 * Math.log10(best);
    };
    for (const inst of ['bass', 'guitar'] as const) {
      const levels = rigStringPresets(inst).map((p) => {
        const c = new mod.RigCore(SR, 8);
        c.post({ type: 'kind', part: 0, kind: inst });
        c.post({ type: 'strings', part: 0, setup: rigStringSetup(p) });
        for (const note of inst === 'bass' ? [36] : [52, 56, 59, 64]) c.post({ type: 'on', part: 0, note, vel: inst === 'bass' ? 0.9 : 0.8 });
        return [p.name, loudest(run(c, 1.5, 0))] as const;
      });
      const sorted = levels.map(([, db]) => db).sort((a, b) => a - b);
      const middle = (sorted[Math.floor((sorted.length - 1) / 2)]! + sorted[Math.ceil((sorted.length - 1) / 2)]!) / 2;
      for (const [name, db] of levels) expect(Math.abs(db - middle), name).toBeLessThan(5);
      // and near the synth basses and keys (about -22 dB measured the same way)
      expect(Math.abs(middle + 22), inst).toBeLessThan(3);
    }
  });
});

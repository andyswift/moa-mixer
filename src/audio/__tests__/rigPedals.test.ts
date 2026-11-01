import { describe, expect, it } from 'vitest';
import { PEDAL_NAMES, PEDAL_TYPES, type PedalName, pedalKnob, pedalParams, pedalValue } from '../../domain/devices/rigPedals';
import { RIG_MIX_SOURCE } from '../rigMixWorklet';

interface MixerI {
  set(id: string, value: number): void;
  process(pl: Float32Array[], pr: Float32Array[], l: Float32Array, r: Float32Array, n: number, bpm: number): void;
}
const { RigMixer } = new Function(`${RIG_MIX_SOURCE}; return { RigMixer };`)() as { RigMixer: new (sr: number, parts?: number) => MixerI };

const SR = 48000;
const B = 128;
type Source = (t: number, i: number) => number;
/** The mixer for `seconds`, part 1 (index 0) fed by `src` on both sides; the master out. */
function run(m: MixerI, seconds: number, src: Source, bpm = 120) {
  const n = Math.floor(seconds * SR), l = new Float32Array(n), r = new Float32Array(n);
  const pl = Array.from({ length: 16 }, () => new Float32Array(B)), pr = Array.from({ length: 16 }, () => new Float32Array(B));
  for (let at = 0; at < n; at += B) {
    const len = Math.min(B, n - at);
    pl[0]!.fill(0); pr[0]!.fill(0);
    for (let i = 0; i < len; i++) { const x = src((at + i) / SR, at + i); pl[0]![i] = x; pr[0]![i] = x; }
    m.process(pl, pr, l.subarray(at, at + len), r.subarray(at, at + len), len, bpm);
  }
  return { l, r };
}
const mixer = (...pedals: Record<string, number>[]) => {
  const m = new RigMixer(SR);
  for (const p of pedals) for (const [id, v] of Object.entries(p)) m.set(id, v);
  return m;
};
const sine = (hz: number, amp = 0.3): Source => (t) => amp * Math.sin(2 * Math.PI * hz * t);
const noisy: Source = (t, i) => 0.25 * Math.sin(2 * Math.PI * 220 * t) + 0.15 * (((Math.imul(i + 1, 2654435761) >>> 0) / 2 ** 32) - 0.5);
const click: Source = (_t, i) => (i === 0 ? 0.5 : 0);
const peakOf = (...xs: Float32Array[]) => { let p = 0; for (const x of xs) for (let i = 0; i < x.length; i++) p = Math.max(p, Math.abs(x[i]!)); return p; };
const rms = (a: Float32Array, from = 0, to = a.length) => { let s = 0; for (let i = from; i < to; i++) s += a[i]! * a[i]!; return Math.sqrt(s / Math.max(1, to - from)); };
const db = (x: number) => 20 * Math.log10(x + 1e-12);
const same = (a: Float32Array, b: Float32Array) => a.every((x, i) => x === b[i]);

describe('MOA-RIG pedals', () => {
  it('a knob turns into what it means and back', () => {
    for (const t of PEDAL_TYPES) for (const k of t.knobs) expect(pedalValue(k, pedalKnob(k, k.def)), `${t.name} ${k.label}`).toBeCloseTo(k.def, 6);
  });

  it('an empty slot, a switched-off pedal and a pedal at MIX 0 leave the part untouched', () => {
    const dry = run(mixer(), 0.5, noisy).l;
    expect(same(run(mixer(pedalParams(1, 1, 'OFF')), 0.5, noisy).l, dry)).toBe(true);
    expect(same(run(mixer({ ...pedalParams(1, 2, 'DELAY'), 'p1.fx2.on': 0 }), 0.5, noisy).l, dry)).toBe(true);
    expect(same(run(mixer(pedalParams(1, 3, 'FLANGER', {}, 0)), 0.5, noisy).l, dry)).toBe(true);
  });

  it('every pedal, at its defaults and pushed to its extremes, sounds, stays finite and stays bounded', () => {
    for (const name of PEDAL_NAMES.slice(1) as PedalName[]) {
      const t = PEDAL_TYPES.find((x) => x.name === name)!;
      const extremes = [Object.fromEntries(t.knobs.map((k) => [k.label, k.options ? k.options.length - 1 : k.max])),
        Object.fromEntries(t.knobs.map((k) => [k.label, k.options ? 0 : k.min]))];
      for (const knobs of [{}, ...extremes]) {
        const { l, r } = run(mixer(pedalParams(1, 1, name, knobs)), 1.5, noisy);
        const peak = peakOf(l, r);
        expect(Number.isFinite(peak), `${name} ${JSON.stringify(knobs)}`).toBe(true);
        expect(peak, `${name} ${JSON.stringify(knobs)}`).toBeLessThan(4);
      }
      expect(rms(run(mixer(pedalParams(1, 1, name)), 1, noisy).l, SR / 2), name).toBeGreaterThan(0.01);
    }
  });

  it('the order matters: a drive into a delay is not a delay into a drive', () => {
    const drive = { Drive: 1 }, delay = { Feedback: 0.6 };
    const a = run(mixer(pedalParams(1, 1, 'DRIVE', drive), pedalParams(1, 2, 'DELAY', delay)), 1, sine(220)).l;
    const b = run(mixer(pedalParams(1, 1, 'DELAY', delay), pedalParams(1, 2, 'DRIVE', drive)), 1, sine(220)).l;
    expect(Math.abs(db(rms(a, SR / 2)) - db(rms(b, SR / 2))) + rms(a.map((x, i) => x - b[i]!), SR / 2)).toBeGreaterThan(0.05);
  });

  it('a delay synced to the tempo lands on the beat: a quarter at 120 BPM echoes half a second later', () => {
    const { l } = run(mixer(pedalParams(1, 1, 'DELAY', { Sync: '1/4', Feedback: 0, Mod: 0 }, 1)), 0.8, click, 120);
    let at = 0;
    for (let i = 1; i < l.length; i++) if (Math.abs(l[i]!) > Math.abs(l[at]!)) at = i;
    expect(at / SR).toBeCloseTo(0.5, 2);
    const slow = run(mixer(pedalParams(1, 1, 'DELAY', { Sync: '1/4', Feedback: 0, Mod: 0 }, 1)), 0.8, click, 100).l;
    let at2 = 0;
    for (let i = 1; i < slow.length; i++) if (Math.abs(slow[i]!) > Math.abs(slow[at2]!)) at2 = i;
    expect(at2 / SR).toBeCloseTo(0.6, 2);
  });

  it('MIX at a half keeps the dry at full and adds the wet', () => {
    const { l } = run(mixer(pedalParams(1, 1, 'DELAY', { Sync: '1/4', Feedback: 0, Mod: 0 }, 0.5)), 0.8, click, 120);
    expect(l[0]).toBeCloseTo(0.5, 4); // the click itself, untouched
    expect(peakOf(l.subarray(Math.round(0.45 * SR)))).toBeGreaterThan(0.1);
  });

  it('a synced tremolo pulses with the tempo: an eighth at 120 BPM dips four times a second', () => {
    const { l } = run(mixer(pedalParams(1, 1, 'TREMOLO', { Sync: '1/8', Depth: 1, Shape: 'SQUARE' })), 2, sine(1000));
    const w = SR / 100, lv: number[] = [];
    for (let at = SR / 2; at + w <= l.length; at += w) lv.push(rms(l, at, at + w));
    let dips = 0;
    for (let i = 1; i < lv.length; i++) if (lv[i]! < 0.05 && lv[i - 1]! >= 0.05) dips++;
    expect(dips).toBeGreaterThanOrEqual(5);
    expect(dips).toBeLessThanOrEqual(7);
  });

  it('the filter cuts what is above it; the compressor holds a loud part down', () => {
    const lp = run(mixer(pedalParams(1, 1, 'FILTER', { Cutoff: 300, Depth: 0, Res: 0 })), 0.5, sine(4000)).l;
    expect(db(rms(lp, SR / 4) / rms(run(mixer(), 0.5, sine(4000)).l, SR / 4))).toBeLessThan(-30);
    const loud = run(mixer(pedalParams(1, 1, 'COMP', { Threshold: -30, Ratio: 10, 'Make-up': 0 })), 1, sine(200, 0.8)).l;
    expect(db(rms(loud, SR / 2) / rms(run(mixer(), 1, sine(200, 0.8)).l, SR / 2))).toBeLessThan(-15);
  });

  it('noise on the filter roughens a held note: its level wanders where the LFO-less filter holds still', () => {
    const wobble = (depth: number, rate: number) => {
      const { l } = run(mixer(pedalParams(1, 1, 'FILTER', { Mode: 'LP', Cutoff: 600, Res: 0.3, Source: 'NOISE', Depth: depth, Rate: rate })), 2, sine(600));
      const w = SR / 50, lv: number[] = [];
      for (let at = SR / 2; at + w <= l.length; at += w) lv.push(db(rms(l, at, at + w)));
      return Math.max(...lv) - Math.min(...lv);
    };
    expect(wobble(0, 0.1)).toBeLessThan(0.5);
    expect(wobble(0.4, 0.1)).toBeGreaterThan(4); // slow noise: the level wanders
    // fast noise: a grit on the note, far from the clean one
    const through = (depth: number) => run(mixer(pedalParams(1, 1, 'FILTER', { Mode: 'LP', Cutoff: 600, Res: 0.3, Source: 'NOISE', Depth: depth, Rate: 15 })), 1, sine(600)).l;
    const clean = through(0), gritty = through(0.4);
    expect(rms(gritty.map((x, i) => x - clean[i]!), SR / 2) / rms(clean, SR / 2)).toBeGreaterThan(0.3);
  });

  it('runs all sixteen parts with four pedals each in real time several times over', () => {
    const m = new RigMixer(SR);
    const chain: PedalName[] = ['DRIVE', 'CHORUS', 'DELAY', 'FILTER'];
    for (let p = 1; p <= 16; p++) chain.forEach((name, s) => { for (const [id, v] of Object.entries(pedalParams(p, s + 1, p === 1 && s === 2 ? 'BEADS' : name))) m.set(id, v); });
    const pl = Array.from({ length: 16 }, () => Float32Array.from({ length: B }, (_, i) => Math.sin(i / 7) * 0.2));
    const l = new Float32Array(B), r = new Float32Array(B);
    const blocks = Math.ceil(SR / B), t0 = performance.now();
    for (let b = 0; b < blocks; b++) m.process(pl, pl, l, r, B, 120);
    const ms = performance.now() - t0;
    expect(ms).toBeLessThan(1000 / 2); // a second of audio in under half a second
  }, 20_000);
});

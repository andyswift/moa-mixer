import { describe, expect, it } from 'vitest';
import { BRAIDS_SOURCE } from '../../audio/braids';
import { PLAITS_SOURCE } from '../../audio/plaits';
import { RIG_SOURCE } from '../../audio/rigWorklet';
import type { RigSide } from '../devices/rigParams';
import { RIG_CATEGORIES, RIG_PRESETS } from '../devices/rigPresets';

interface Core { setPatch(p: number, a: RigSide, b?: RigSide): void; noteOn(p: number, n: number, v: number): void; noteOff(p: number, n: number): void; process(l: Float32Array, r: Float32Array, n: number): void }
const { RigCore } = new Function(`${PLAITS_SOURCE}; ${BRAIDS_SOURCE}; ${RIG_SOURCE}; return { RigCore };`)() as { RigCore: new (sr: number) => Core };
const SR = 48000;

/** A second of a sound holding a note: its loudest 100 ms (dB) and how much of it is under 250 Hz. */
function measure(a: RigSide, note: number) {
  const core = new RigCore(SR);
  core.setPatch(0, a);
  core.noteOn(0, note, 0.9);
  const l = new Float32Array(SR), r = new Float32Array(SR);
  for (let at = 0; at < SR; at += 128) core.process(l.subarray(at, at + 128), r.subarray(at, at + 128), Math.min(128, SR - at));
  let loudest = 0, all = 0, low = 0, y = 0;
  const k = Math.exp((-2 * Math.PI * 250) / SR), w = SR / 10;
  for (let s = 0; s + w <= SR; s += w / 2) {
    let e = 0;
    for (let i = s; i < s + w; i++) e += ((l[i]! + r[i]!) / 2) ** 2;
    loudest = Math.max(loudest, Math.sqrt(e / w));
  }
  for (let i = 0; i < SR; i++) {
    const x = (l[i]! + r[i]!) / 2;
    y = (1 - k) * x + k * y;
    all += x * x;
    low += y * y;
  }
  return { db: 20 * Math.log10(loudest), low: low / all };
}

/** A sound playing `notes` for `secs` (all 48 voices to it), the MOD wheel and velocity as given: its loudest 100 ms
 * (dB), how far under that its first 50 ms and its last 500 ms are (long enough to ride out detune beating), its
 * peak, and whether it stayed finite. */
function play(a: RigSide, b: RigSide | undefined, notes: number[], secs: number, wheel = 0, vel = 0.8) {
  const core = new RigCore(SR) as Core & { setLayout(c: number[]): void; setControl(p: number, n: string, v: number): void };
  const counts = new Array<number>(16).fill(0);
  counts[0] = 48;
  core.setLayout(counts);
  core.setPatch(0, a, b);
  core.setControl(0, 'mod', wheel);
  for (const n of notes) core.noteOn(0, n, vel);
  const n = Math.floor(secs * SR), l = new Float32Array(n), r = new Float32Array(n);
  for (let at = 0; at < n; at += 128) core.process(l.subarray(at, at + 128), r.subarray(at, at + 128), Math.min(128, n - at));
  let peak = 0, finite = true;
  for (let i = 0; i < n; i++) {
    if (!Number.isFinite(l[i]!) || !Number.isFinite(r[i]!)) finite = false;
    peak = Math.max(peak, Math.abs(l[i]!), Math.abs(r[i]!));
  }
  const win = (from: number, len: number) => {
    let e = 0;
    for (let i = from; i < from + len; i++) e += ((l[i]! + r[i]!) / 2) ** 2;
    return Math.sqrt(e / len);
  };
  let loud = 0;
  for (let s = 0; s + SR / 10 <= n; s += SR / 20) loud = Math.max(loud, win(s, SR / 10));
  const db = (x: number) => 20 * Math.log10(x + 1e-12);
  return { loud: db(loud), first: db(win(0, SR / 20)) - db(loud), last: db(win(n - SR / 2, SR / 2)) - db(loud), peak: db(peak), finite };
}
const byName = (name: string) => RIG_PRESETS.find((p) => p.name === name)!;
/** Each within 5 dB of the middle of its batch. */
function levelMatched(names: string[], measure: (name: string) => number) {
  const levels = names.map((name) => [name, measure(name)] as const);
  const sorted = levels.map(([, db]) => db).sort((x, y) => x - y);
  const middle = sorted[sorted.length >> 1]!;
  for (const [name, db] of levels) expect(Math.abs(db - middle), name).toBeLessThan(5);
}

const LEAD_BATCH = ['Saw Lead', 'Square Lead', 'Sync Scream', 'Hoover', 'Mini Lead', 'Whistle Lead', 'Chip Lead', 'Acid Lead', 'Brass Lead', 'Vowel Lead',
  'FM Lead', 'Distorted Lead'];
const PAD_BATCH = ['Warm Pad', 'Juno Pad', 'Sweep Pad', 'Dark Pad', 'Air Pad', 'Wavetable Pad', 'Chord Pad', 'Swarm Pad', 'Shimmer Pad', 'Granular Pad',
  'Evolving Pad', 'Ice Pad'];
const KEYS_BATCH = ['Wurly', 'Organ', 'Toy Piano', 'Clav', 'House Keys', 'Harpsi', 'Glass EP', 'Lofi Keys'];
const PLUCK_BATCH = ['Saw Pluck', 'Square Pluck', 'String Pluck', 'Pizzicato', 'Harp', 'Chord Pluck', 'Rubber Pluck', 'Glass Pluck', 'Bit Pluck', 'Kalimba'];
const CHORD = [48, 55, 60, 64];
/** A pad is played as a chord, or one key if it is mono (its chord comes from the one key, like Chord Pad). */
const padNotes = (a: RigSide) => ((a.params['voice.mode'] ?? 0) >= 1 ? [60] : CHORD);

/** The bass batch, level-matched to each other (the older basses were set for the multis that use them). */
const BASS_BATCH = ['Moog Bass', 'Reese', '808 Sub', 'Square Bass', 'House Pluck', 'Wobble Bass', 'Fold Bass', 'Rubber Bass', 'DX Slap', 'Deep Bass',
  'Dirty Bass', 'Synth Pop Bass'];

describe('MOA-RIG factory sound families', () => {
  it('every factory sound but Init is in a family the picker knows, and names are not repeated', () => {
    const families = new Set<string>(RIG_CATEGORIES.map(([id]) => id));
    for (const p of RIG_PRESETS.slice(1)) expect(families.has(p.category ?? ''), p.name).toBe(true);
    expect(RIG_PRESETS[0]!.category).toBeUndefined();
    expect(new Set(RIG_PRESETS.map((p) => p.name)).size).toBe(RIG_PRESETS.length);
  });

  it('every bass has its weight low (most of it under 250 Hz on a low C)', () => {
    for (const p of RIG_PRESETS.filter((x) => x.category === 'bass')) expect(measure(p.a, 36).low, p.name).toBeGreaterThan(0.7);
  });

  it('808 Sub does not click when notes follow each other (no burst over 2 kHz)', () => {
    const core = new RigCore(SR);
    core.setPatch(0, RIG_PRESETS.find((p) => p.name === '808 Sub')!.a);
    const blocks = 360, l = new Float32Array(blocks * 128), r = new Float32Array(blocks * 128);
    for (let b = 0; b < blocks; b++) {
      // eighths, and the same note again straight after its release
      if (b % 44 === 0) core.noteOn(0, b % 88 ? 43 : 36, 0.9);
      if (b % 44 === 20) core.noteOff(0, b % 88 > 44 ? 43 : 36);
      core.process(l.subarray(b * 128, b * 128 + 128), r.subarray(b * 128, b * 128 + 128), 128);
    }
    const k = Math.exp((-2 * Math.PI * 2000) / SR);
    let y1 = 0, x1 = 0, y2 = 0, z1 = 0, all = 0, worst = 0, win = 0;
    for (let i = 0; i < l.length; i++) {
      const a = k * (y1 + l[i]! - x1); x1 = l[i]!; y1 = a;
      const h = k * (y2 + a - z1); z1 = a; y2 = h;
      all += l[i]! ** 2;
      win += h * h;
      if (i % 240 === 239) { worst = Math.max(worst, Math.sqrt(win / 240)); win = 0; }
    }
    expect(20 * Math.log10(worst / Math.sqrt(all / l.length))).toBeLessThan(-40);
  });

  it('the bass batch is level-matched: each within 5 dB of the others’ middle', () => {
    const levels = BASS_BATCH.map((name) => [name, measure(RIG_PRESETS.find((p) => p.name === name)!.a, 36).db] as const);
    const sorted = levels.map(([, db]) => db).sort((x, y) => x - y);
    const middle = sorted[sorted.length >> 1]!;
    for (const [name, db] of levels) expect(Math.abs(db - middle), name).toBeLessThan(5);
  }, 20_000);

  it('every lead speaks at once and holds while held; the lead batch is level-matched', () => {
    for (const p of RIG_PRESETS.filter((x) => x.category === 'lead')) {
      const m = play(p.a, p.b, [60], 1.5);
      expect(m.first, `${p.name}: speaks at once`).toBeGreaterThan(-6);
      expect(m.last, `${p.name}: holds`).toBeGreaterThan(-9);
    }
    levelMatched(LEAD_BATCH, (name) => play(byName(name).a, byName(name).b, [60], 1.5).loud);
  }, 30_000);

  it('every pad swells in and sustains; the pad batch is level-matched', () => {
    for (const p of RIG_PRESETS.filter((x) => x.category === 'pad')) {
      const m = play(p.a, p.b, padNotes(p.a), 3);
      expect(m.first, `${p.name}: swells in`).toBeLessThan(-10);
      expect(m.last, `${p.name}: sustains`).toBeGreaterThan(-6);
    }
    levelMatched(PAD_BATCH, (name) => play(byName(name).a, byName(name).b, padNotes(byName(name).a), 3).loud);
  }, 30_000);

  it('every keys sound speaks at once; every pluck dies away; both batches are level-matched', () => {
    for (const p of RIG_PRESETS.filter((x) => x.category === 'keys')) expect(play(p.a, p.b, [60], 1.5).first, `${p.name}: speaks at once`).toBeGreaterThan(-6);
    for (const p of RIG_PRESETS.filter((x) => x.category === 'pluck')) {
      const m = play(p.a, p.b, [60], 1.5);
      expect(m.first, `${p.name}: speaks at once`).toBeGreaterThan(-6);
      expect(m.last, `${p.name}: dies away`).toBeLessThan(-20);
    }
    levelMatched(KEYS_BATCH, (name) => play(byName(name).a, byName(name).b, [60], 1.5).loud);
    levelMatched(PLUCK_BATCH, (name) => play(byName(name).a, byName(name).b, [60], 1.5).loud);
  }, 30_000);

  it('the new sounds played hard with the MOD wheel up stay sound: finite, under full scale, and not starved', () => {
    for (const name of [...LEAD_BATCH, ...PAD_BATCH, ...KEYS_BATCH, ...PLUCK_BATCH]) {
      const p = byName(name), pad = p.category === 'pad';
      const rest = play(p.a, p.b, pad ? CHORD : [60], pad ? 3 : 1.5), hard = play(p.a, p.b, pad ? CHORD : [60], pad ? 3 : 1.5, 1, 1);
      expect(hard.finite, name).toBe(true);
      expect(hard.peak, name).toBeLessThan(0);
      expect(hard.loud, `${name}: the wheel does not starve it`).toBeGreaterThan(rest.loud - 6);
    }
  }, 60_000);
});

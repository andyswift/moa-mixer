import { describe, expect, it } from 'vitest';
import type { RigRoute } from '../../domain/devices/rigParams';
import { defaultPad } from '../../domain/devices/mpc60';
import { RIG_MIX_SOURCE } from '../rigMixWorklet';
import { RIG_SOURCE } from '../rigWorklet';
import { SAMPLER_SOURCE } from '../samplerWorklet';

type Params = Record<string, number>;
interface Side { params: Params; matrix: RigRoute[] }
interface CoreI {
  bpm: number;
  partL: Float32Array[];
  partR: Float32Array[];
  setPatch(part: number, a: Side, b?: Side): void;
  setLayout(counts: number[]): void;
  noteOn(part: number, note: number, vel?: number): void;
  noteOff(part: number, note: number): void;
  setControl(part: number, name: string, value: number): void;
  sounding(part: number): number;
  setLocks(part: number, locks: Params): void;
  post(m: Record<string, unknown>, frame?: number): void;
  parts: { a: Float64Array; b: Float64Array }[];
  process(l: Float32Array, r: Float32Array, n: number): void;
}
const mod = new Function(`${RIG_SOURCE}; return { RigCore, rigFft };`)() as {
  RigCore: new (sr: number, voices?: number, parts?: number, random?: () => number) => CoreI;
  rigFft: (re: Float64Array, im: Float64Array, inverse: boolean) => void;
};

const SR = 48000;
function seeded(seed = 3): () => number {
  let s = seed;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 4294967296;
  };
}
const newCore = (voices = 24): CoreI => new mod.RigCore(SR, voices, 16, seeded());
/** OSC 1 saw straight through: the ladder wide open with no envelope on it, the SEM off. */
const OPEN: Params = { 'lad.cutoff': 20000, 'lad.eg1': 0 };
const side = (params: Params = {}, matrix: RigRoute[] = []): Side => ({ params: { ...OPEN, ...params }, matrix });

/** Renders `seconds`, with `during` called before each block (for timed note changes); returns both channels and each part's bus. */
function run(core: CoreI, seconds: number, during?: (t: number) => void) {
  const n = Math.floor(seconds * SR);
  const l = new Float32Array(n), r = new Float32Array(n);
  const parts = core.partL.map(() => new Float32Array(n));
  for (let at = 0; at < n; at += 128) {
    during?.(at / SR);
    const len = Math.min(128, n - at);
    core.process(l.subarray(at, at + len), r.subarray(at, at + len), len);
    core.partL.forEach((b, p) => parts[p]!.set(b.subarray(0, len), at));
  }
  return { l, r, parts };
}
function play(params: Params = {}, matrix: RigRoute[] = [], note = 69, seconds = 0.5, vel = 1) {
  const core = newCore();
  core.setPatch(0, side(params, matrix));
  core.noteOn(0, note, vel);
  return run(core, seconds);
}
const rms = (a: Float32Array, from = 0, to = a.length): number => {
  let s = 0;
  for (let i = from; i < to; i++) s += a[i]! * a[i]!;
  return Math.sqrt(s / (to - from));
};
/** Frequency by counting rising zero crossings. */
function pitch(a: Float32Array, from = SR / 10): number {
  let first = -1, last = -1, count = 0;
  for (let i = from + 1; i < a.length; i++) if (a[i - 1]! < 0 && a[i]! >= 0) {
    if (first < 0) first = i;
    last = i;
    count++;
  }
  return count < 2 ? 0 : ((count - 1) * SR) / (last - first);
}
/** Power spectrum of 65536 samples (Hann window) from `from`. */
function spectrum(a: Float32Array, from = SR / 10): Float64Array {
  const N = 65536;
  const re = Float64Array.from({ length: N }, (_, i) => (a[from + i] ?? 0) * (0.5 - 0.5 * Math.cos((2 * Math.PI * i) / N)));
  const im = new Float64Array(N);
  mod.rigFft(re, im, false);
  return Float64Array.from({ length: N / 2 }, (_, k) => re[k]! ** 2 + im[k]! ** 2);
}
const bin = (hz: number) => Math.round((hz * 65536) / SR);
/** Mean power per bin in a band, in dB (so bands of different widths compare). */
function band(spec: Float64Array, lo: number, hi: number): number {
  let s = 0;
  for (let k = bin(lo); k <= bin(hi); k++) s += spec[k]!;
  return 10 * Math.log10(s / (bin(hi) - bin(lo) + 1) + 1e-30);
}
/** Energy between the harmonics of f0 against energy on them, in dB: how much aliasing there is. */
function aliasing(a: Float32Array, f0: number): number {
  const spec = spectrum(a);
  let on = 0, off = 0;
  for (let k = 1; k < spec.length; k++) {
    const h = (k * SR) / 65536 / f0;
    if (Math.round(h) >= 1 && Math.abs(h - Math.round(h)) * f0 < (4 * SR) / 65536) on += spec[k]!; else off += spec[k]!;
  }
  return 10 * Math.log10(off / on);
}
const SECONDS_FOR_SPECTRUM = 65536 / SR + 0.2;

describe('MOA-RIG oscillators', () => {
  it('play in tune, and octave and tune move them', () => {
    expect(pitch(play().l)).toBeCloseTo(440, 0);
    expect(pitch(play({ 'osc1.oct': 3 }).l)).toBeCloseTo(880, 0);
    expect(pitch(play({ 'osc1.tune': 7 }).l)).toBeCloseTo(659.26, 0);
  });

  it('turn the pulse into a square an octave down with the sub', () => {
    expect(pitch(play({ 'osc1.blend': 1, 'osc1.sub': 1 }).l)).toBeCloseTo(220, 0);
  });

  it('morph the saw into a triangle with width: odd harmonics only', () => {
    const tri = spectrum(play({ 'osc1.width': 1 }, [], 57, SECONDS_FOR_SPECTRUM).l);
    const saw = spectrum(play({}, [], 57, SECONDS_FOR_SPECTRUM).l);
    // A3 is 220 Hz: the triangle has almost no second harmonic, the saw has it 6 dB down
    expect(band(tri, 218, 222) - band(tri, 438, 442)).toBeGreaterThan(40);
    expect(band(saw, 218, 222) - band(saw, 438, 442)).toBeLessThan(10);
  });

  it('sync OSC 2 to OSC 1: it repeats at OSC 1 whatever its own tune', () => {
    const p = { 'mix.osc1': 0, 'mix.osc2': 1, 'osc2.tune': 5, 'osc2.sync': 1 };
    expect(pitch(play(p).l)).toBeCloseTo(440, 0);
    expect(pitch(play({ ...p, 'osc2.sync': 0 }).l)).toBeCloseTo(587.33, 0);
  });

  it('are band-limited: little energy between the harmonics of a high note', () => {
    const f0 = 440 * 2 ** ((100 - 69) / 12);
    expect(aliasing(play({}, [], 100, SECONDS_FOR_SPECTRUM).l, f0)).toBeLessThan(-28);
    expect(aliasing(play({ 'osc1.blend': 1 }, [], 100, SECONDS_FOR_SPECTRUM).l, f0)).toBeLessThan(-26);
    expect(aliasing(play({ 'osc1.width': 1 }, [], 100, SECONDS_FOR_SPECTRUM).l, f0)).toBeLessThan(-38);
    // at a moderate level: driven hard, the ladder's input saturation (at 1x, not oversampled) adds some aliasing of its own
    for (let t = 0; t < 6; t++) {
      const wt = play({ 'mix.osc1': 0, 'mix.osc3': 0.3, 'osc3.table': t, 'osc3.pos': 0.7 }, [], 100, SECONDS_FOR_SPECTRUM).l;
      expect(aliasing(wt, f0)).toBeLessThan(-40);
    }
  });

  it('scan the wavetable with position: the vowel table moves its formants', () => {
    // at the table's own pitch (A2, 110 Hz), F2 against F1's region: A has F2 near 1.1 kHz, I near 2.3 kHz
    const f2 = (pos: number) => {
      const s = spectrum(play({ 'mix.osc1': 0, 'mix.osc3': 1, 'osc3.table': 4, 'osc3.pos': pos }, [], 45, SECONDS_FOR_SPECTRUM).l);
      return band(s, 2100, 2500) - band(s, 950, 1250);
    };
    expect(f2(0.5)).toBeGreaterThan(f2(0) + 10);
  });

  it('can be FMed by OSC 3 at audio rate (WAVE into tune)', () => {
    const p = { 'mix.osc3': 0, 'osc3.oct': 3 };
    const dry = spectrum(play(p, [], 57, SECONDS_FOR_SPECTRUM).l);
    const fm = spectrum(play(p, [{ source: 'wave', dest: 'osc1.tune', amount: 0.15 }], 57, SECONDS_FOR_SPECTRUM).l);
    // sidebands appear between the saw's harmonics
    expect(band(fm, 300, 400) - band(dry, 300, 400)).toBeGreaterThan(20);
  });
});

describe('MOA-RIG filters', () => {
  const noise = { 'mix.osc1': 0, 'mix.noise': 1 };
  it('ladder: a steep low-pass, about 24 dB an octave', () => {
    const s = spectrum(play({ ...noise, 'lad.cutoff': 800 }, [], 60, SECONDS_FOR_SPECTRUM).l);
    expect(band(s, 200, 300) - band(s, 3000, 4000)).toBeGreaterThan(35);
  });

  it('ladder: rings on its own at full resonance', () => {
    const out = play({ 'mix.osc1': 0, 'mix.noise': 0.002, 'lad.cutoff': 1000, 'lad.res': 1, 'filter.key': 0 }, [], 60, 1).l;
    expect(rms(out, SR / 2)).toBeGreaterThan(0.01);
    expect(pitch(out, SR / 2)).toBeGreaterThan(800);
    expect(pitch(out, SR / 2)).toBeLessThan(1200);
  });

  it('SEM: low-pass, high-pass and band-pass after the ladder', () => {
    const sem = (p: Params) => spectrum(play({ ...noise, 'filter.route': 1, 'sem.cutoff': 1000, 'filter.key': 0, ...p }, [], 60, SECONDS_FOR_SPECTRUM).l);
    const lp = sem({ 'sem.mode': 0 }), hp = sem({ 'sem.mode': 1 }), bp = sem({ 'sem.bp': 1, 'sem.res': 0.8 });
    expect(band(lp, 100, 200) - band(lp, 6000, 8000)).toBeGreaterThan(25);
    expect(band(hp, 6000, 8000) - band(hp, 100, 200)).toBeGreaterThan(25);
    expect(band(bp, 900, 1100)).toBeGreaterThan(band(bp, 100, 120) + 15);
    expect(band(bp, 900, 1100)).toBeGreaterThan(band(bp, 8000, 9000) + 15);
  });

  it('routing off leaves the SEM out; parallel adds it beside the ladder', () => {
    const p = { ...noise, 'sem.cutoff': 100, 'filter.key': 0 };
    const off = spectrum(play({ ...p, 'filter.route': 0 }, [], 60, SECONDS_FOR_SPECTRUM).l);
    const series = spectrum(play({ ...p, 'filter.route': 1 }, [], 60, SECONDS_FOR_SPECTRUM).l);
    const par = spectrum(play({ ...p, 'filter.route': 2 }, [], 60, SECONDS_FOR_SPECTRUM).l);
    expect(band(off, 4000, 6000) - band(series, 4000, 6000)).toBeGreaterThan(30);
    expect(band(par, 4000, 6000) - band(series, 4000, 6000)).toBeGreaterThan(20);
  });
});

describe('MOA-RIG envelopes and LFOs', () => {
  it('EG 2 shapes the amp: attack rises, release falls to silence and frees the voice', () => {
    const core = newCore();
    core.setPatch(0, side({ 'eg2.a': 0.1, 'eg2.r': 0.1 }));
    core.noteOn(0, 60);
    const { l } = run(core, 0.6, (t) => { if (t >= 0.3 && t < 0.3 + 128 / SR) core.noteOff(0, 60); });
    expect(rms(l, 0.02 * SR, 0.04 * SR)).toBeLessThan(rms(l, 0.15 * SR, 0.25 * SR) * 0.6);
    expect(rms(l, 0.5 * SR, 0.6 * SR)).toBeLessThan(1e-3);
    expect(core.sounding(0)).toBe(0);
  });

  it('drone keeps the amp open after the note ends', () => {
    const core = newCore();
    core.setPatch(0, side({ 'eg2.drone': 1, 'eg2.r': 0.05 }));
    core.noteOn(0, 60);
    const { l } = run(core, 1, (t) => { if (t >= 0.1 && t < 0.1 + 128 / SR) core.noteOff(0, 60); });
    expect(rms(l, 0.8 * SR)).toBeGreaterThan(0.05);
  });

  it('an LFO synced to the tempo: a square at 1/4 swings the pan every half second at 120 bpm', () => {
    const core = newCore();
    core.bpm = 120;
    core.setPatch(0, side({ 'lfo1.sync': 1, 'lfo1.div': 4, 'lfo1.shape': 2 }, [{ source: 'lfo1', dest: 'out.pan', amount: 0.4 }]));
    core.noteOn(0, 60);
    const { l, r } = run(core, 2);
    let changes = 0, prev = 0;
    for (let at = 0; at + 480 <= l.length; at += 480) {
      const side = Math.sign(rms(l, at, at + 480) - rms(r, at, at + 480));
      if (prev !== 0 && side !== prev) changes++;
      prev = side;
    }
    expect(changes).toBeGreaterThanOrEqual(7);
    expect(changes).toBeLessThanOrEqual(8);
  });
});

describe('MOA-RIG mod matrix and morph', () => {
  it('KBD at -1 into tune cancels the keyboard: every key plays middle C', () => {
    const m: RigRoute[] = [{ source: 'kbd', dest: 'osc1.tune', amount: -1 }];
    expect(pitch(play({}, m, 48).l)).toBeCloseTo(261.63, 0);
    expect(pitch(play({}, m, 84).l)).toBeCloseTo(261.63, 0);
  });

  it('velocity into EG 2 level is a sensitivity: a soft note is quieter', () => {
    const m: RigRoute[] = [{ source: 'vel', dest: 'eg2.level', amount: 1 }];
    const loud = rms(play({}, m, 60, 0.3, 1).l, SR / 10);
    const soft = rms(play({}, m, 60, 0.3, 0.25).l, SR / 10);
    expect(soft / loud).toBeCloseTo(0.25, 1);
  });

  it('morph blends side A into side B, and the mod wheel can do it through the matrix', () => {
    const core = newCore();
    const b = side({ 'osc1.oct': 3 });
    core.setPatch(0, side(), b);
    core.noteOn(0, 69);
    expect(pitch(run(core, 0.3).l)).toBeCloseTo(440, 0);
    core.setPatch(0, side({ 'out.morph': 1 }), side({ 'osc1.oct': 3, 'out.morph': 1 }));
    expect(pitch(run(core, 0.3).l)).toBeCloseTo(880, 0);
    core.setPatch(0, side({}, [{ source: 'mod', dest: 'out.morph', amount: 1 }]), b);
    core.setControl(0, 'mod', 1);
    expect(pitch(run(core, 0.3).l)).toBeCloseTo(880, 0);
  });

  it('pans past the edge into anti-phase (infinite panning)', () => {
    const { l, r } = play({ 'out.pan': 1 }, [{ source: 'set', dest: 'out.pan', amount: 0.5 }]);
    let lr = 0, ll = 0, rr = 0;
    for (let i = SR / 10; i < l.length; i++) { lr += l[i]! * r[i]!; ll += l[i]! ** 2; rr += r[i]! ** 2; }
    expect(lr / Math.sqrt(ll * rr)).toBeLessThan(-0.9);
  });
});

describe('MOA-RIG parts and the voice pool', () => {
  it('each part has its own voices: a full part steals its oldest note, not another part\'s voice', () => {
    const core = newCore(4);
    core.setLayout([2, 1]);
    core.setPatch(0, side());
    core.setPatch(1, side({ 'osc1.oct': 4 }));
    core.noteOn(0, 60); core.noteOn(0, 64); core.noteOn(0, 67);
    core.noteOn(1, 60);
    const { parts } = run(core, 0.4);
    expect(core.sounding(0)).toBe(2);
    expect(core.sounding(1)).toBe(1);
    // part 0 holds 64 and 67 (60 was stolen); part 1 alone is two octaves up
    const s0 = spectrum(Float32Array.from({ length: 70000 }, (_, i) => parts[0]![i % parts[0]!.length]!), 0);
    expect(band(s0, 326, 333) - band(s0, 258, 265)).toBeGreaterThan(20);
    expect(pitch(parts[1]!)).toBeCloseTo(1046.5, 0);
    expect(rms(parts[2]!)).toBe(0);
  });

  it('a part with no voices is silent', () => {
    const core = newCore(4);
    core.setLayout([0, 4]);
    core.noteOn(0, 60);
    expect(rms(run(core, 0.2).l)).toBe(0);
  });

  it('legato: a second key glides on without restarting the envelope, and letting it go returns to the first', () => {
    const core = newCore();
    core.setPatch(0, side({ 'voice.mode': 2, 'eg2.a': 0.2, 'eg2.d': 5, 'eg2.s': 1 }));
    core.noteOn(0, 57);
    const { l } = run(core, 0.9, (t) => {
      if (t >= 0.3 && t < 0.3 + 128 / SR) core.noteOn(0, 69);
      if (t >= 0.6 && t < 0.6 + 128 / SR) core.noteOff(0, 69);
    });
    expect(pitch(l.subarray(0, 0.3 * SR), 0.1 * SR)).toBeCloseTo(220, 0);
    expect(pitch(l.subarray(0, 0.6 * SR), 0.35 * SR)).toBeCloseTo(440, 0);
    expect(pitch(l, 0.65 * SR)).toBeCloseTo(220, 0);
    // no restart: the level just after the second key is not back near zero
    expect(rms(l, 0.3 * SR, 0.32 * SR)).toBeGreaterThan(rms(l, 0.27 * SR, 0.29 * SR) * 0.8);
  });

  it('unison stacks voices on one note', () => {
    const core = newCore(8);
    core.setLayout([4]);
    core.setPatch(0, side({ 'voice.unison': 2 }));
    core.noteOn(0, 60);
    run(core, 0.1);
    expect(core.sounding(0)).toBe(3);
  });
});

describe('MOA-RIG robustness', () => {
  it('stays finite and bounded with random patches and routings', () => {
    const rnd = seeded(11);
    const sources = ['eg1', 'eg2', 'lfo1', 'lfo2', 'wave', 'kbd', 'vel', 'rand', 'set'] as const;
    const dests = ['osc1.tune', 'osc3.pos', 'lad.cutoff', 'lad.res', 'sem.cutoff', 'sem.mode', 'drive', 'out.pan', 'out.morph', 'eg2.a'] as const;
    for (let trial = 0; trial < 6; trial++) {
      const core = newCore(8);
      core.setLayout([8]);
      const p: Params = {
        'mix.osc2': rnd(), 'mix.osc3': rnd(), 'mix.noise': rnd() * 0.5, 'osc3.table': Math.floor(rnd() * 6), 'osc2.sync': rnd() > 0.5 ? 1 : 0,
        drive: rnd(), overdrive: rnd() > 0.5 ? 1 : 0, 'lad.res': rnd(), 'sem.res': rnd(), 'filter.route': Math.floor(rnd() * 3),
        'lad.cutoff': 50 + rnd() * 8000, 'sem.cutoff': 50 + rnd() * 8000, 'voice.unison': Math.floor(rnd() * 4),
      };
      const matrix = Array.from({ length: 6 }, () => ({ source: sources[Math.floor(rnd() * sources.length)]!, dest: dests[Math.floor(rnd() * dests.length)]!, amount: rnd() * 2 - 1 }));
      core.setPatch(0, { params: p, matrix }, { params: { ...p, 'lad.res': 1 }, matrix: [] });
      for (let k = 0; k < 4; k++) core.noteOn(0, 36 + Math.floor(rnd() * 60), rnd());
      const { l, r } = run(core, 0.5);
      for (const x of [l, r]) for (let i = 0; i < x.length; i++) {
        expect(Number.isFinite(x[i]!)).toBe(true);
        expect(Math.abs(x[i]!)).toBeLessThan(4);
      }
    }
  });

  it('runs 24 voices well faster than real time', () => {
    const core = newCore();
    core.setPatch(0, side({ 'mix.osc2': 0.5, 'mix.osc3': 0.5, 'filter.route': 1, 'lad.res': 0.5 }, [{ source: 'lfo1', dest: 'lad.cutoff', amount: 0.2 }]));
    for (let i = 0; i < 24; i++) core.noteOn(0, 40 + i, 0.8);
    const l = new Float32Array(128), r = new Float32Array(128);
    const t0 = performance.now();
    for (let b = 0; b < (SR / 128) * 2; b++) core.process(l, r, 128);
    expect(2000 / (performance.now() - t0)).toBeGreaterThan(3);
  });

  it('starts a timed note on its own sample, inside a block', () => {
    const core = newCore();
    core.setPatch(0, side({ 'eg2.a': 0 }));
    core.post({ type: 'on', part: 0, note: 69, vel: 1 }, 200);
    const { l } = run(core, 0.02);
    for (let i = 0; i < 200; i++) expect(l[i]).toBe(0);
    expect(rms(l, 200, 400)).toBeGreaterThan(0.01);
  });

  it('holds a lock over both sides until the next step, and keeps it through a patch change', () => {
    const core = newCore();
    const P = core.parts[0]!;
    const cut = (new Function(`${RIG_SOURCE}; return RIG_P;`)() as Params)['lad.cutoff']!;
    core.setPatch(0, side({ 'lad.cutoff': 1000 }), side({ 'lad.cutoff': 3000 }));
    core.setLocks(0, { 'lad.cutoff': 400 });
    expect([P.a[cut], P.b[cut]]).toEqual([400, 400]);
    core.setPatch(0, side({ 'lad.cutoff': 2000 }), side({ 'lad.cutoff': 3000 }));
    expect(P.a[cut]).toBe(400);
    core.setLocks(0, {});
    expect([P.a[cut], P.b[cut]]).toEqual([2000, 3000]);
  });

  it('plays a kit part’s pads from the MOA-60 sampler, on their own samples and onto the part’s bus', () => {
    const { RigCore } = new Function(`${SAMPLER_SOURCE}; ${RIG_SOURCE}; return { RigCore };`)() as { RigCore: new (sr: number) => CoreI };
    const core = new RigCore(SR);
    core.post({ type: 'kind', part: 9, kind: 'kit' });
    const tone = Float32Array.from({ length: 4800 }, (_, i) => Math.sin((2 * Math.PI * 440 * i) / SR));
    core.post({ type: 'sample', id: 'tone', rate: SR, channels: [tone] });
    core.post({ type: 'pad', part: 9, pad: 2, settings: { ...defaultPad(), sample: 'tone' } });
    core.post({ type: 'on', part: 9, note: 38, vel: 1 }, 300); // pad 3
    core.post({ type: 'on', part: 9, note: 60, vel: 1 }, 300); // not a pad: nothing
    const { l, parts } = run(core, 0.05);
    for (let i = 0; i < 300; i++) expect(l[i]).toBe(0);
    expect(rms(l, 300, 1300)).toBeGreaterThan(0.1);
    expect(rms(parts[9]!, 300, 1300)).toBeCloseTo(rms(l, 300, 1300), 6);
    expect(core.sounding(9)).toBe(0); // no synth voices
    core.post({ type: 'kind', part: 9, kind: 'synth' });
    core.post({ type: 'on', part: 9, note: 38, vel: 1 });
    expect(rms(run(core, 0.02).l)).toBe(0);
  });

  it('goes through the mixer when the mixer’s source is there: a muted strip silences its part', () => {
    const { RigCore } = new Function(`${RIG_MIX_SOURCE}; ${RIG_SOURCE}; return { RigCore };`)() as { RigCore: new (sr: number) => CoreI };
    const core = new RigCore(SR);
    core.setPatch(0, side());
    core.noteOn(0, 69, 1);
    expect(rms(run(core, 0.1).l)).toBeGreaterThan(0.05);
    core.post({ type: 'mix', id: 'p1.mute', value: 1 });
    run(core, 0.02); // the fader glides down over a block
    expect(rms(run(core, 0.1).l)).toBeLessThan(1e-6);
  });
});


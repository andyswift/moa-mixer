import { describe, expect, it } from 'vitest';
import { M2600_PARAMS } from '../../domain/devices/m2600Params';
import { M2600_SOURCE } from '../m2600Worklet';

type Params = Record<string, number>;
interface CoreI {
  probe: number;
  sig: Float64Array;
  view: { sq: { step: number; running: boolean; clk: boolean } };
  play(n1: number, n2: number, gate: boolean, retrig: boolean): void;
  setCords(list: { from: string; to: string }[]): void;
  seqMessage(m: unknown): void;
  process(l: Float32Array, r: Float32Array, n: number, p: Params): void;
}
const mod = new Function(`${M2600_SOURCE}; return { M26Core, M26_DEFAULTS, M26_O };`)() as {
  M26Core: new (sr: number, random?: () => number) => CoreI;
  M26_DEFAULTS: Params;
  M26_O: Record<string, number>;
};
const O = mod.M26_O;
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
/** Steps 1..16 at 0.05, 0.1, ... so each step's A output (x 10 V) tells which step it is: step k -> k * 0.5 V. */
const ramp = (): Params => Object.fromEntries(Array.from({ length: 16 }, (_, i) => [`sq.step.${i + 1}`, (i + 1) * 0.05]));
const params = (extra: Params = {}): Params => ({ ...mod.M26_DEFAULTS, ...ramp(), 'sq.rate': 100, ...extra });
const stepOf = (core: CoreI): number => Math.round(core.sig[O['sq.a']!]! / 0.5);

/** Runs sample by sample-blocks, recording a signal (or the current step) once per block of `every` samples. */
function record(core: CoreI, seconds: number, p: Params, read: (c: CoreI) => number, block = 16): number[] {
  const out: number[] = [];
  const l = new Float32Array(block), r = new Float32Array(block);
  const blocks = Math.floor((seconds * SR) / block);
  for (let i = 0; i < blocks; i++) {
    core.process(l, r, block, p);
    out.push(read(core));
  }
  return out;
}
/** The distinct values in order, without repeats in a row. */
const runs = (xs: number[]): number[] => xs.filter((x, i) => i === 0 || x !== xs[i - 1]);

describe('clock and stepping', () => {
  it('is stopped by default: the clock runs, the steps and gates do not', () => {
    const core = newCore();
    const p = params();
    const clk = record(core, 0.1, p, (c) => c.sig[O['sq.clk']!]!);
    expect(Math.max(...clk)).toBe(10);
    expect(Math.min(...clk)).toBe(0);
    expect(runs(record(core, 0.1, p, stepOf))).toEqual([1]);
    expect(Math.max(...record(core, 0.1, p, (c) => c.sig[O['sq.bus1']!]! + c.sig[O['sq.cgate1']!]!))).toBe(0);
  });

  it('runs at the clock rate, starting on step 1, and loops 16 steps', () => {
    const core = newCore();
    core.seqMessage({ type: 'sq', action: 'run' });
    const steps = runs(record(core, 0.2, params(), stepOf));
    expect(steps.slice(0, 18)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 1, 2]);
    // 100 Hz for 0.2 s: about 20 steps
    expect(steps.length).toBeGreaterThanOrEqual(19);
    expect(steps.length).toBeLessThanOrEqual(21);
  });

  it('after reset the next clock lands on the first step; step and jump work while stopped', () => {
    const core = newCore();
    const p = params();
    core.seqMessage({ type: 'sq', action: 'jump', index: 6 });
    record(core, 0.01, p, stepOf);
    expect(stepOf(core)).toBe(7);
    core.seqMessage({ type: 'sq', action: 'step' });
    record(core, 0.001, p, stepOf);
    expect(stepOf(core)).toBe(8);
    core.seqMessage({ type: 'sq', action: 'reset' });
    core.seqMessage({ type: 'sq', action: 'run' });
    const steps = runs(record(core, 0.035, p, stepOf));
    expect(steps.slice(0, 3)).toEqual([1, 2, 3]);
  });

  it('8x2 plays 8 steps with step i on A and step i + 8 on B', () => {
    const core = newCore();
    core.seqMessage({ type: 'sq', action: 'run' });
    const p = params({ 'sq.mode': opt('sq.mode', '8x2') });
    const pairs = runs(record(core, 0.1, p, (c) => stepOf(c) * 100 + Math.round(c.sig[O['sq.b']!]! / 0.5)));
    expect(pairs.slice(0, 9)).toEqual([109, 210, 311, 412, 513, 614, 715, 816, 109]);
  });

  it('reverse and ping-pong orders, and random stays on the active steps', () => {
    const rev = newCore();
    rev.seqMessage({ type: 'sq', action: 'run' });
    expect(runs(record(rev, 0.06, params({ 'sq.dir': opt('sq.dir', 'rev') }), stepOf)).slice(0, 4)).toEqual([16, 15, 14, 13]);
    const ping = newCore();
    ping.seqMessage({ type: 'sq', action: 'run' });
    const pp = runs(record(ping, 0.2, params({ 'sq.dir': opt('sq.dir', 'pingpong'), 'sq.mode': opt('sq.mode', '8x2') }), stepOf));
    expect(pp.slice(0, 16)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 7, 6, 5, 4, 3, 2, 1, 2]);
    const rnd = newCore();
    rnd.seqMessage({ type: 'sq', action: 'run' });
    const rs = record(rnd, 0.5, params({ 'sq.dir': opt('sq.dir', 'random'), 'sq.mode': opt('sq.mode', '8x2') }), stepOf);
    expect(Math.min(...rs)).toBeGreaterThanOrEqual(1);
    expect(Math.max(...rs)).toBeLessThanOrEqual(8);
    expect(new Set(rs).size).toBeGreaterThan(4);
  });

  it('a step on bus 3 skips, or resets the loop to step 1 (shortening it)', () => {
    const bus3 = { 'sq.gate.5': opt('sq.gate.5', '3') };
    const skip = newCore();
    skip.seqMessage({ type: 'sq', action: 'run' });
    const s = runs(record(skip, 0.1, params({ ...bus3, 'sq.skip': opt('sq.skip', 'skip') }), stepOf));
    expect(s.slice(0, 6)).toEqual([1, 2, 3, 4, 6, 7]);
    const reset = newCore();
    reset.seqMessage({ type: 'sq', action: 'run' });
    const r = runs(record(reset, 0.1, params({ ...bus3, 'sq.skip': opt('sq.skip', 'reset') }), stepOf));
    expect(r.slice(0, 9)).toEqual([1, 2, 3, 4, 1, 2, 3, 4, 1]);
    const off = newCore();
    off.seqMessage({ type: 'sq', action: 'run' });
    expect(runs(record(off, 0.07, params(bus3), stepOf)).slice(0, 6)).toEqual([1, 2, 3, 4, 5, 6]);
  });
});

describe('gates', () => {
  it('bus outputs follow each step\'s assignment for the whole step; clocked gate 1 only while the clock is high', () => {
    const core = newCore();
    core.seqMessage({ type: 'sq', action: 'run' });
    const p = params({ 'sq.gate.2': opt('sq.gate.2', '2'), 'sq.gate.3': opt('sq.gate.3', 'off'), 'sq.pw': 0.25 });
    const rows = record(core, 0.16, p, (c) => [stepOf(c), c.sig[O['sq.bus1']!]!, c.sig[O['sq.bus2']!]!, c.sig[O['sq.cgate1']!]!, c.sig[O['sq.clk']!]!, c.sig[O['sq.pos1']!]!] as never, 8) as unknown as number[][];
    const at = (step: number) => rows.filter((r) => r[0] === step);
    expect(at(1).every((r) => r[1] === 10 && r[2] === 0 && r[5] === 10)).toBe(true);
    expect(at(2).every((r) => r[1] === 0 && r[2] === 10 && r[5] === 0)).toBe(true);
    expect(at(3).every((r) => r[1] === 0 && r[2] === 0 && r[3] === 0)).toBe(true);
    // clocked gate 1 equals bus 1 AND clock, high about a quarter of step 1
    const s4 = at(4);
    expect(s4.every((r) => r[3] === (r[4] === 10 ? 10 : 0))).toBe(true);
    const frac = s4.filter((r) => r[3] === 10).length / s4.length;
    expect(frac).toBeGreaterThan(0.15);
    expect(frac).toBeLessThan(0.35);
  });
});

describe('quantizers', () => {
  const quantOf = (p: Params, cords: { from: string; to: string }[] = []) => {
    const core = newCore();
    core.setCords(cords);
    record(core, 0.002, p, () => 0);
    return core.sig[O['sq.qa']!]!;
  };
  it('snap the step to the scale over the range, at 1 V per octave, and add the CV input', () => {
    const p = (step: number, extra: Params = {}) => params({ 'sq.step.1': step, 'sq.range': opt('sq.range', '1'), ...extra });
    expect(quantOf(p(0.5))).toBeCloseTo(0.5, 6); // chromatic: 6 semitones
    expect(quantOf(p(0.52))).toBeCloseTo(0.5, 6); // 6.24 snaps to 6
    expect(quantOf(p(1 / 12, { 'sq.scale': opt('sq.scale', 'major') }))).toBeCloseTo(0, 6); // 1 semitone -> 0 (or 2)
    expect(quantOf(p(1.5 / 12, { 'sq.scale': opt('sq.scale', 'major') }))).toBeCloseTo(2 / 12, 6);
    expect(quantOf(params({ 'sq.step.1': 0.5, 'sq.range': opt('sq.range', '4') }))).toBeCloseTo(2, 6);
    // the keyboard CV patched into the CV input transposes it
    const core = newCore();
    core.setCords([{ from: 'kb.cv', to: 'sq.cvin' }]);
    core.play(72, 72, true, true);
    record(core, 0.002, p(0.5), () => 0);
    expect(core.sig[O['sq.qa']!]!).toBeCloseTo(1.5, 6);
  });

  it('input B quantizes another source when patched (the 2600 S/H here)', () => {
    const core = newCore();
    core.setCords([{ from: 'sh.out', to: 'sq.inb' }]);
    const p = params({ 'sq.scale': opt('sq.scale', 'pent') });
    const vals = record(core, 0.5, p, (c) => c.sig[O['sq.qb']!]!);
    const pent = [0, 3, 5, 7, 10];
    for (const v of vals) expect(pent).toContain(Math.round(v * 12) % 12);
  });
});

describe('clock sources', () => {
  it('a cord into the clock input drives the steps (the LFO square here)', () => {
    const core = newCore();
    core.setCords([{ from: 'lfo.square', to: 'sq.extclk' }]);
    core.seqMessage({ type: 'sq', action: 'run' });
    const p = params({ 'sq.rate': 0.2, 'lfo.speed': 20 });
    const steps = runs(record(core, 0.5, p, stepOf));
    expect(steps.length).toBeGreaterThanOrEqual(9);
    expect(steps.length).toBeLessThanOrEqual(11);
  });

  it('in MIDI mode only ticks step it', () => {
    const core = newCore();
    core.seqMessage({ type: 'sq', action: 'run' });
    const p = params({ 'sq.sync': opt('sq.sync', 'midi') });
    record(core, 0.1, p, stepOf);
    expect(stepOf(core)).toBe(1);
    for (let k = 0; k < 3; k++) {
      core.seqMessage({ type: 'sqtick' });
      record(core, 0.02, p, stepOf);
    }
    expect(stepOf(core)).toBe(3);
  });

  it('start, stop and start/stop jacks (trig and gate modes)', () => {
    const core = newCore();
    core.setCords([{ from: 'lfo.square', to: 'sq.startstop' }]);
    const p = params({ 'lfo.speed': 4, 'sq.trig': opt('sq.trig', 'gate') });
    // gate mode: runs while the LFO square is high (half of each 0.25 s cycle)
    const running = record(core, 1, p, (c) => (c.view.sq.running ? 1 : 0), 128);
    const frac = running.reduce((a, b) => a + b, 0) / running.length;
    expect(frac).toBeGreaterThan(0.4);
    expect(frac).toBeLessThan(0.6);
  });
});

describe('playing the 2600', () => {
  /** Frequency by rising zero crossings. */
  function pitch(a: Float32Array): number {
    let first = -1, last = -1, count = 0;
    for (let i = 1; i < a.length; i++) if (a[i - 1]! < 0 && a[i]! >= 0) { if (first < 0) first = i; last = i; count++; }
    return count < 2 ? 0 : ((count - 1) * SR) / (last - first);
  }
  const render = (core: CoreI, seconds: number, p: Params) => {
    const n = Math.floor(seconds * SR);
    const l = new Float32Array(n), r = new Float32Array(n);
    for (let at = 0; at < n; at += 128) core.process(l.subarray(at, at + 128), r.subarray(at, at + 128), Math.min(128, n - at), p);
    return l;
  };

  it('quantized A into the keyboard input plays the steps as notes, gated by clocked gate 1', () => {
    const core = newCore();
    core.setCords([{ from: 'sq.qa', to: 'vco1.fm.kybd' }, { from: 'sq.cgate1', to: 'adsr.gate' }]);
    core.probe = O['vco1.saw']!;
    const p = params({ 'sq.rate': 4, 'sq.range': opt('sq.range', '1'), 'sq.step.1': 0, 'sq.step.2': 1, 'sq.step.3': 7 / 12 });
    core.seqMessage({ type: 'sq', action: 'run' });
    // each step lasts 0.25 s; measure the middle of steps 1-3: C4, C5, G4 (VCO 1 at middle C)
    const audio = render(core, 0.75, p);
    const mid = (k: number) => audio.subarray(Math.floor((k * 0.25 + 0.05) * SR), Math.floor((k * 0.25 + 0.2) * SR));
    expect(pitch(mid(0)) / 261.63).toBeCloseTo(1, 1);
    expect(pitch(mid(1)) / 523.25).toBeCloseTo(1, 1);
    expect(pitch(mid(2)) / 392).toBeCloseTo(1, 1);
    // and the ADSR follows clocked gate 1: something sounds through the VCA
    const out = newCore();
    out.setCords([{ from: 'sq.qa', to: 'vco1.fm.kybd' }, { from: 'sq.cgate1', to: 'adsr.gate' }]);
    out.seqMessage({ type: 'sq', action: 'run' });
    const a = render(out, 0.5, p);
    expect(Math.max(...a.map(Math.abs))).toBeGreaterThan(0.05);
  });

  it('with only gate bus 1 in the ADSR gate, the keyboard sets the pitch and the sequencer the rhythm', () => {
    const core = newCore();
    core.setCords([{ from: 'sq.bus1', to: 'adsr.gate' }]);
    const p = params({ 'sq.rate': 8, 'sq.gate.2': opt('sq.gate.2', 'off'), 'sq.gate.4': opt('sq.gate.4', 'off'), 'vcf.freq': 16000, 'vcf.cv.adsr': 0 });
    core.play(69, 69, true, true); // the key: A4
    // stopped: no gate, so silence, though the key is held
    const silent = render(core, 0.2, p);
    expect(Math.max(...silent.slice(SR * 0.1).map(Math.abs))).toBeLessThan(0.01);
    core.seqMessage({ type: 'sq', action: 'run' });
    const audio = render(core, 1, p);
    // pitch is the key's, whatever the step sliders say
    core.probe = -1;
    const env = (from: number, to: number) => Math.max(...audio.slice(Math.floor(from * SR), Math.floor(to * SR)).map(Math.abs));
    // steps last 0.125 s: step 1 gated (loud), step 2 off (decays to quiet by its end)
    expect(env(0.05, 0.12)).toBeGreaterThan(0.05);
    expect(env(0.23, 0.25)).toBeLessThan(env(0.05, 0.12) * 0.5);
    const pc = newCore();
    pc.setCords([{ from: 'sq.bus1', to: 'adsr.gate' }]);
    pc.probe = O['vco1.saw']!;
    pc.play(69, 69, true, true);
    pc.seqMessage({ type: 'sq', action: 'run' });
    expect(pitch(render(pc, 0.5, p)) / 440).toBeCloseTo(1, 2);
  });
});

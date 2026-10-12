import { describe, expect, it } from 'vitest';
import { GRANULAR_SOURCE } from '../granularWorklet';

interface Params {
  position: number; size: number; pitch: number; rate: number; spread: number; cloud: number;
  detune: number; shape: number; reverse: number; feedback: number; freeze: number;
  play: number; attack: number; decay: number; sustain: number; release: number;
}
interface Core {
  w: number;
  filled: number;
  activeGrains: number;
  activeVoices: number;
  noteOn(note: number, velocity: number): void;
  noteOff(note: number): void;
  allNotesOff(): void;
  snapshot(): { peaks: Float32Array; grains: number[] };
  process(input: Float32Array | null, l: Float32Array, r: Float32Array, n: number, p: Params): void;
}
type CoreClass = new (sampleRate: number, seconds: number, random?: () => number) => Core;

// The worklet source is plain text; evaluating it outside the audio thread gives the same GrainCore the app uses.
const GrainCore = new Function(`${GRANULAR_SOURCE}; return GrainCore;`)() as CoreClass;

const SR = 8000;
const base: Params = {
  position: 0.5, size: 0.05, pitch: 0, rate: 20, spread: 0, cloud: 0, detune: 0, shape: 0, reverse: 0, feedback: 0, freeze: 0,
  play: 0, attack: 0.01, decay: 0.1, sustain: 0.8, release: 0.2,
};
const sine = (n: number, hz: number) => Float32Array.from({ length: n }, (_, i) => Math.sin((2 * Math.PI * hz * i) / SR));

/** Feeds `input` through a core in 128-sample blocks and returns what came out. */
function run(core: Core, input: Float32Array | null, n: number, p: Params): { l: Float32Array; r: Float32Array } {
  const l = new Float32Array(n);
  const r = new Float32Array(n);
  for (let at = 0; at < n; at += 128) {
    const len = Math.min(128, n - at);
    core.process(input ? input.subarray(at, at + len) : null, l.subarray(at, at + len), r.subarray(at, at + len), len, p);
  }
  return { l, r };
}
const rms = (a: Float32Array) => Math.sqrt(a.reduce((s, v) => s + v * v, 0) / a.length);
const peak = (a: Float32Array) => a.reduce((m, v) => Math.max(m, Math.abs(v)), 0);
// A seeded generator keeps the random choices (pan, scatter) repeatable.
const seeded = () => { let s = 1234567; return () => ((s = (s * 1664525 + 1013904223) >>> 0) / 4294967296); };

describe('GrainCore', () => {
  it('is silent with nothing recorded', () => {
    const core = new GrainCore(SR, 4, seeded());
    const { l, r } = run(core, null, SR, base);
    expect(peak(l)).toBe(0);
    expect(peak(r)).toBe(0);
  });

  it('plays back what it recorded, and stays finite and bounded', () => {
    const core = new GrainCore(SR, 4, seeded());
    const { l } = run(core, sine(SR * 2, 220), SR * 2, base);
    const tail = l.subarray(SR);
    expect(rms(tail)).toBeGreaterThan(0.05);
    for (const v of l) expect(Number.isFinite(v)).toBe(true);
    expect(peak(l)).toBeLessThan(2);
  });

  it('freeze holds the buffer: new input is no longer recorded', () => {
    const core = new GrainCore(SR, 4, seeded());
    run(core, sine(SR, 220), SR, base);
    const writeHead = core.w;
    run(core, sine(SR, 330), SR, { ...base, freeze: 1 });
    expect(core.w).toBe(writeHead);
    // ...and the frozen audio keeps sounding with no input at all
    const { l } = run(core, null, SR, { ...base, freeze: 1 });
    expect(rms(l)).toBeGreaterThan(0.05);
  });

  it('spread 0 is centred; spread 1 scatters grains across the stereo field', () => {
    const input = sine(SR * 2, 220);
    const centre = run(new GrainCore(SR, 4, seeded()), input, SR * 2, { ...base, spread: 0 });
    for (let i = 0; i < centre.l.length; i++) expect(centre.l[i]).toBeCloseTo(centre.r[i]!, 5);
    const wide = run(new GrainCore(SR, 4, seeded()), input, SR * 2, { ...base, spread: 1 });
    let differs = 0;
    for (let i = SR; i < wide.l.length; i++) if (Math.abs(wide.l[i]! - wide.r[i]!) > 0.01) differs++;
    expect(differs).toBeGreaterThan(SR / 10);
  });

  it('keeps the level steady as grains get longer and denser (overlap is normalised)', () => {
    const input = sine(SR * 3, 220);
    const sparse = rms(run(new GrainCore(SR, 4, seeded()), input, SR * 3, { ...base, size: 0.05, rate: 10 }).l.subarray(SR));
    const dense = rms(run(new GrainCore(SR, 4, seeded()), input, SR * 3, { ...base, size: 0.4, rate: 60 }).l.subarray(SR));
    expect(dense / sparse).toBeLessThan(4);
    expect(dense / sparse).toBeGreaterThan(0.25);
  });

  it('feedback sustains the sound after the input stops, and stays bounded', () => {
    const noFb = new GrainCore(SR, 2, seeded());
    const withFb = new GrainCore(SR, 2, seeded());
    const burst = sine(SR, 220);
    const p = { ...base, position: 0.05, size: 0.1, rate: 40 };
    run(noFb, burst, SR, p);
    run(withFb, burst, SR, { ...p, feedback: 0.9 });
    const silence = new Float32Array(SR * 3);
    const a = run(noFb, silence, SR * 3, p).l.subarray(SR * 2);
    const b = run(withFb, silence, SR * 3, { ...p, feedback: 0.9 }).l.subarray(SR * 2);
    expect(rms(b)).toBeGreaterThan(rms(a));
    expect(peak(b)).toBeLessThan(5);
  });

  it('never starts more grains than its pool holds', () => {
    const core = new GrainCore(SR, 4, seeded());
    run(core, sine(SR, 220), SR, { ...base, size: 2, rate: 100 });
    expect(core.activeGrains).toBeLessThanOrEqual(128);
  });

  it('copes with extreme settings without producing NaN', () => {
    const core = new GrainCore(SR, 4, seeded());
    const extreme: Params = {
      position: 1, size: 4, pitch: 48, rate: 200, spread: 1, cloud: 1, detune: 1200, shape: 1, reverse: 1, feedback: 1, freeze: 0,
      play: 0, attack: 0.01, decay: 0.1, sustain: 0.8, release: 0.2,
    };
    const { l, r } = run(core, sine(SR * 2, 220), SR * 2, extreme);
    for (const v of [...l, ...r]) expect(Number.isFinite(v)).toBe(true);
  });

  it('reports buffer peaks oldest to newest, and where its live grains are, for the display', () => {
    const core = new GrainCore(SR, 4, seeded());
    const quiet = new Float32Array(SR).fill(0);
    run(core, quiet, SR, base);
    run(core, sine(SR, 220), SR, { ...base, size: 0.5, rate: 40 });
    const view = core.snapshot();
    expect(view.peaks).toHaveLength(96);
    expect(view.peaks[95]).toBeGreaterThan(0.5); // the newest slice holds the loud sine
    expect(view.peaks[0]).toBeLessThan(0.05); // the oldest is still the unrecorded start
    expect(view.grains.length).toBeGreaterThan(0);
    expect(view.grains.length % 2).toBe(0);
    for (let i = 0; i < view.grains.length; i += 2) {
      expect(view.grains[i]).toBeGreaterThanOrEqual(0);
      expect(view.grains[i]).toBeLessThanOrEqual(1);
    }
  });
});

describe('GrainCore voices', () => {
  // freeze holds the recorded second still: with no input, a live buffer would fill with silence.
  const keys: Params = { ...base, play: 1, size: 0.1, rate: 20, spread: 0, freeze: 1 };
  const feed = sine(SR * 3, 220);
  /** A core with a second of recorded sine and the keys mode on, ready for notes. */
  function primed(): Core {
    const core = new GrainCore(SR, 4, seeded());
    run(core, feed, SR, { ...keys, play: 0, freeze: 0 });
    run(core, null, 2000, keys); // Keys on: the free-running cloud fades out and its grains finish
    return core;
  }
  /** Zero crossings per second: a rough pitch measure for a steady tone. */
  const crossings = (a: Float32Array) => {
    let n = 0;
    for (let i = 1; i < a.length; i++) if ((a[i - 1]! < 0) !== (a[i]! < 0)) n++;
    return n;
  };

  it('is silent in keys mode until a note arrives, and sounds while it is held', () => {
    const core = primed();
    expect(peak(run(core, null, SR / 2, keys).l)).toBe(0);
    core.noteOn(60, 1);
    expect(core.activeVoices).toBe(1);
    expect(rms(run(core, null, SR / 2, keys).l)).toBeGreaterThan(0.02);
  });

  it('releases after the note ends, and the voice frees itself', () => {
    const core = primed();
    core.noteOn(60, 1);
    run(core, null, SR / 4, keys);
    core.noteOff(60);
    run(core, null, SR, { ...keys, release: 0.1 });
    expect(core.activeVoices).toBe(0);
    expect(peak(run(core, null, SR / 2, { ...keys, release: 0.1 }).l.subarray(SR / 4))).toBeLessThan(0.001);
  });

  it('transposes by the note: an octave up plays about twice as fast', () => {
    const slow = primed();
    slow.noteOn(60, 1);
    const high = primed();
    high.noteOn(72, 1);
    const p = { ...keys, size: 0.3, rate: 8, attack: 0.001 };
    const a = crossings(run(slow, null, SR, p).l.subarray(SR / 2));
    const b = crossings(run(high, null, SR, p).l.subarray(SR / 2));
    expect(b / a).toBeGreaterThan(1.7);
    expect(b / a).toBeLessThan(2.3);
  });

  it('velocity scales the level', () => {
    const loud = primed();
    loud.noteOn(60, 1);
    const soft = primed();
    soft.noteOn(60, 0.25);
    const p = { ...keys, attack: 0.001 };
    const a = rms(run(loud, null, SR, p).l.subarray(SR / 2));
    const b = rms(run(soft, null, SR, p).l.subarray(SR / 2));
    expect(b / a).toBeGreaterThan(0.15);
    expect(b / a).toBeLessThan(0.4);
  });

  it('the attack fades a note in and the sustain level holds it', () => {
    const core = primed();
    core.noteOn(60, 1);
    const p = { ...keys, attack: 0.5, decay: 0.05, sustain: 0.5 };
    const out = run(core, null, SR, p).l;
    const early = rms(out.subarray(0, SR / 10));
    const late = rms(out.subarray(SR * 0.8));
    expect(late).toBeGreaterThan(early * 2);
  });

  it('plays a chord about as loud as one note, and never sounds more than 8 voices', () => {
    const one = primed();
    one.noteOn(60, 1);
    const chord = primed();
    for (const n of [60, 64, 67, 71]) chord.noteOn(n, 1);
    const p = { ...keys, attack: 0.001 };
    const a = rms(run(one, null, SR * 2, p).l.subarray(SR));
    const b = rms(run(chord, null, SR * 2, p).l.subarray(SR));
    expect(b / a).toBeLessThan(2.5);
    const many = primed();
    for (let n = 40; n < 60; n++) many.noteOn(n, 1);
    expect(many.activeVoices).toBe(8);
    const out = run(many, null, SR, p);
    for (const v of [...out.l, ...out.r]) expect(Number.isFinite(v)).toBe(true);
  });

  it('the same note again retriggers its voice instead of taking another', () => {
    const core = primed();
    core.noteOn(60, 1);
    core.noteOn(60, 1);
    expect(core.activeVoices).toBe(1);
  });

  it('allNotesOff releases everything', () => {
    const core = primed();
    for (const n of [60, 64, 67]) core.noteOn(n, 1);
    run(core, null, SR / 10, keys);
    core.allNotesOff();
    run(core, null, SR, { ...keys, release: 0.1 });
    expect(core.activeVoices).toBe(0);
  });

  it('with keys off, notes are ignored and the cloud runs on its own', () => {
    const core = primed();
    core.noteOn(72, 1);
    expect(rms(run(core, null, SR / 2, { ...keys, play: 0 }).l)).toBeGreaterThan(0.02);
  });
});

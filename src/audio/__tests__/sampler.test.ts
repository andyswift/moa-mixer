import { describe, expect, it } from 'vitest';
import { SAMPLER_SOURCE } from '../samplerWorklet';

interface Core {
  frame: number;
  voices: unknown[];
  addSample(id: string, rate: number, channels: Float32Array[]): void;
  setPad(i: number, p: Record<string, unknown>): void;
  hit(i: number, velocity: number, frame?: number): void;
  release(i: number, frame?: number): void;
  process(L: Float32Array, R: Float32Array, n: number, level: number): void;
}
const { SamplerCore } = new Function(`${SAMPLER_SOURCE}; return { SamplerCore };`)() as { SamplerCore: new (sr: number) => Core };

const SR = 48000;
const sine = (hz: number, rate: number, seconds: number) => Float32Array.from({ length: Math.round(rate * seconds) }, (_, i) => Math.sin((2 * Math.PI * hz * i) / rate));
function run(core: Core, seconds: number, block = 128) {
  const n = Math.round(seconds * SR);
  const L = new Float32Array(n), R = new Float32Array(n);
  const l = new Float32Array(block), r = new Float32Array(block);
  for (let at = 0; at < n; at += block) {
    core.process(l, r, block, 1);
    L.set(l.subarray(0, Math.min(block, n - at)), at);
    R.set(r.subarray(0, Math.min(block, n - at)), at);
  }
  return { L, R };
}
/** Frequency by counting upward zero crossings in [from, to). */
const pitch = (x: Float32Array, from: number, to: number) => {
  let n = 0, first = -1, last = -1;
  for (let i = from + 1; i < to; i++) if (x[i - 1]! < 0 && x[i]! >= 0) { if (first < 0) first = i; last = i; n++; }
  return ((n - 1) * SR) / (last - first);
};
const rms = (x: Float32Array, from: number, to: number) => { let s = 0; for (let i = from; i < to; i++) s += x[i]! ** 2; return Math.sqrt(s / (to - from)); };
const firstSound = (x: Float32Array) => x.findIndex((v) => Math.abs(v) > 1e-6);
const core = (pads: Record<string, unknown>[] = [{}], sound = sine(440, 44100, 1)) => {
  const c = new SamplerCore(SR);
  c.addSample('s', 44100, [sound]);
  pads.forEach((p, i) => c.setPad(i, { sample: 's', pan: 0, ...p }));
  return c;
};

describe('MOA-60 voices', () => {
  it('plays a sound recorded at another rate at its own pitch, and tune moves it in semitones', () => {
    for (const [tune, hz] of [[0, 440], [12, 880], [-7, 440 * 2 ** (-7 / 12)]] as const) {
      const c = core([{ tune }]);
      c.hit(0, 1);
      expect(pitch(run(c, 0.5).L, 100, 20000)).toBeCloseTo(hz, 0);
    }
  });

  it('a hit placed ahead starts on its frame exactly, inside a block', () => {
    const c = core();
    c.hit(0, 1, 1000);
    expect(firstSound(run(c, 0.1).L)).toBe(1001); // a sine starts at 0, so its first sound is one frame in
  });

  it('pans with equal power, and velocity sets the level as the pad asks', () => {
    const once = (pad: Record<string, unknown>, vel = 1) => { const c = core([pad]); c.hit(0, vel); return run(c, 0.2); };
    expect(rms(once({ pan: -1 }).R, 0, 9000)).toBeLessThan(1e-6);
    const o = once({ pan: 0 });
    expect(rms(o.L, 0, 9000)).toBeCloseTo(rms(o.R, 0, 9000), 6);
    expect(rms(o.L, 0, 9000)).toBeCloseTo(Math.SQRT1_2 * Math.SQRT1_2, 2);
    // a stereo sound is balanced, not panned: at the centre each side plays whole
    const st = new SamplerCore(SR);
    st.addSample('st', 44100, [sine(440, 44100, 1), sine(440, 44100, 1)]);
    st.setPad(0, { sample: 'st', pan: 0 });
    st.hit(0, 1);
    expect(rms(run(st, 0.2).L, 0, 9000)).toBeCloseTo(Math.SQRT1_2, 2);
    const soft = rms(once({ velLevel: 1 }, 0.25).L, 0, 9000);
    const flat = rms(once({ velLevel: 0 }, 0.25).L, 0, 9000);
    expect(soft / flat).toBeCloseTo(0.25 ** 1.5, 2);
  });

  it('a mute group cuts the other pad within a few milliseconds (open hat by closed hat)', () => {
    const c = core([{ group: 1 }, { group: 1, tune: 12 }]);
    c.hit(0, 1);
    c.hit(1, 1, 4800);
    const { L } = run(c, 0.3);
    expect(pitch(L, 4800 + 480, 14000)).toBeCloseTo(880, 0); // only the second pad after 10 ms
    expect(c.voices).toHaveLength(1);
  });

  it('one shot plays to the end; Note On stops on release, by its decay', () => {
    let c = core([{}]);
    c.hit(0, 1);
    c.release(0, 100);
    expect(rms(run(c, 0.95).L, 40000, 43000)).toBeCloseTo(0.5, 2);
    c = core([{}, { mode: 'noteon', decay: 0.05 }]);
    c.hit(1, 1);
    c.release(1, 4800);
    const { L } = run(c, 0.5);
    expect(rms(L, 0, 4800)).toBeGreaterThan(0.3);
    expect(rms(L, 4800 + 2400, 4800 + 4800)).toBeLessThan(rms(L, 0, 4800) * 0.03); // 50 ms to -60 dB
  });

  it('start, end, reverse and loop', () => {
    const ramp = Float32Array.from({ length: 48000 }, (_, i) => i / 48000);
    const make = () => {
      const c = new SamplerCore(SR);
      c.addSample('r', SR, [ramp]);
      c.setPad(0, { sample: 'r', start: 12000, end: 24000, pan: 0 });
      c.setPad(1, { sample: 'r', reverse: true, pan: 0 });
      c.setPad(2, { sample: 'r', start: 0, end: 4800, loop: true, pan: 0 });
      return c;
    };
    const g = Math.SQRT1_2;
    let c = make();
    c.hit(0, 1);
    let { L } = run(c, 0.6);
    expect(L[1]! / g).toBeCloseTo(12001 / 48000, 3);
    expect(L[12000]).toBe(0); // stopped at the end point
    c = make();
    c.hit(1, 1);
    ({ L } = run(c, 0.1));
    expect(L[0]! / g).toBeCloseTo(47999 / 48000, 3);
    expect(L[100]! / g).toBeCloseTo(47899 / 48000, 3);
    c = make();
    c.hit(2, 1);
    ({ L } = run(c, 0.25));
    expect(L[4800 + 10]! / g).toBeCloseTo(10 / 48000, 3); // round again
  });

  it('the filter takes the top off, and velocity opens it', () => {
    const bright = sine(8000, SR, 0.5);
    const level = (pad: Record<string, unknown>, vel: number) => {
      const c = core([pad], bright);
      c.hit(0, vel);
      return rms(run(c, 0.3).L, 2000, 12000);
    };
    const open = level({}, 1);
    expect(level({ cutoff: 1000 }, 1) / open).toBeLessThan(0.03); // 3 octaves over a 12 dB/oct filter
    expect(level({ cutoff: 1000, velFilter: 1 }, 0.5) / open).toBeLessThan(level({ cutoff: 4000, velFilter: 0 }, 1) / open * 1.2);
  });

  it('32 voices; one more takes the oldest', () => {
    const c = core(Array.from({ length: 40 }, () => ({})));
    for (let i = 0; i < 40; i++) c.hit(i, 1);
    run(c, 0.01);
    expect(c.voices).toHaveLength(32);
    expect((c.voices[0] as { pad: number }).pad).toBe(8);
  });
});

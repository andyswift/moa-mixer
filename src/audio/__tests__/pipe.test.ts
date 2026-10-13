import { describe, expect, it } from 'vitest';
import { PIPE_SOURCE } from '../pipeWorklet';

type Params = Record<string, number>;
interface PipeCoreI {
  activeVoices: number;
  voices: { active: boolean; gate: boolean; note: number }[];
  noteOn(note: number, velocity: number, p?: Params | null): void;
  noteOff(note: number): void;
  allNotesOff(): void;
  sustainPedal(down: boolean): void;
  process(l: Float32Array, r: Float32Array, n: number, p: Params): void;
}
interface SpringCoreI {
  process(input: Float32Array | null, l: Float32Array, r: Float32Array, n: number, p: Params): void;
}

// The worklet source is plain text; evaluating it outside the audio thread gives the same classes the app uses.
const mod = new Function(`${PIPE_SOURCE}; return { PipeCore, SpringCore, PIPE_DEFAULTS, SPRING_DEFAULTS };`)() as {
  PipeCore: new (sr: number, random?: () => number) => PipeCoreI;
  SpringCore: new (sr: number) => SpringCoreI;
  PIPE_DEFAULTS: Params;
  SPRING_DEFAULTS: Params;
};

const SR = 48000;
/** A seeded random source so noise-driven tests are repeatable. */
function seeded(seed = 12345): () => number {
  let s = seed;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 4294967296;
  };
}
/** A plucked-string setup: a short noise burst into a ringing loop. */
const pluck = (extra: Params = {}): Params => ({
  ...mod.PIPE_DEFAULTS, noise: 1, atk: 0.0005, dec: 0.01, sus: 0, rel: 0.02, nCut: 130, nKey: 0, nRes: 0,
  gain: 1, fbDec: 1.5, fbRel: 0.3, lp: 48, hp: -48, volume: 1, vel: 0, ...extra,
});

function render(core: PipeCoreI, seconds: number, p: Params): { l: Float32Array; r: Float32Array } {
  const n = Math.floor(seconds * SR);
  const l = new Float32Array(n);
  const r = new Float32Array(n);
  for (let at = 0; at < n; at += 128) {
    const len = Math.min(128, n - at);
    core.process(l.subarray(at, at + len), r.subarray(at, at + len), len, p);
  }
  return { l, r };
}

const rms = (a: Float32Array, from: number, to: number): number => {
  let s = 0;
  for (let i = from; i < to; i++) s += a[i]! * a[i]!;
  return Math.sqrt(s / Math.max(1, to - from));
};
const db = (x: number): number => 20 * Math.log10(Math.max(x, 1e-9));
const hz = (note: number): number => 440 * Math.pow(2, (note - 69) / 12);

/** Frequency of the strongest partial within +/-6% of `expected`, from a fine scan of a windowed DFT. */
function pitchOf(x: Float32Array, from: number, expected: number): number {
  const L = 16384;
  let best = 0, bestF = expected;
  for (let f = expected * 0.94; f <= expected * 1.06; f += expected * 0.0004) {
    const m = magAt(x, from, L, f);
    if (m > best) { best = m; bestF = f; }
  }
  return bestF;
}
const cents = (f: number, target: number): number => 1200 * Math.log2(f / target);

/** Magnitude of one frequency in a segment (a Goertzel-style single-bin DFT). */
function magAt(x: Float32Array, from: number, len: number, f: number): number {
  let re = 0, im = 0;
  for (let i = 0; i < len; i++) {
    const w = 0.5 - 0.5 * Math.cos((2 * Math.PI * i) / len);
    const a = (2 * Math.PI * f * i) / SR;
    re += x[from + i]! * w * Math.cos(a);
    im -= x[from + i]! * w * Math.sin(a);
  }
  return Math.hypot(re, im) / len;
}

describe('PipeCore', () => {
  it('plays in tune across the keyboard', () => {
    for (const note of [36, 48, 60, 72, 84]) {
      const core = new mod.PipeCore(SR, seeded());
      const p = pluck();
      core.noteOn(note, 1, p);
      const { l } = render(core, 0.6, p);
      const f = pitchOf(l, Math.floor(0.2 * SR), hz(note));
      expect(Math.abs(cents(f, hz(note))), `note ${note}: ${f.toFixed(2)} Hz`).toBeLessThan(10);
    }
  });

  it('stays in tune when the filters and stiffness change, thanks to the delay compensation', () => {
    for (const extra of [{ lp: 12 }, { hp: -12 }, { harm: 0.4 }, { lp: 24, hp: -12, harm: 0.2 }] as Params[]) {
      const core = new mod.PipeCore(SR, seeded());
      const p = pluck(extra);
      core.noteOn(60, 1, p);
      const { l } = render(core, 0.7, p);
      const f = pitchOf(l, Math.floor(0.2 * SR), hz(60));
      expect(Math.abs(cents(f, hz(60))), JSON.stringify(extra)).toBeLessThan(18);
    }
  });

  it('transposes with Tune and Fine, and follows the pitch bend', () => {
    const run = (extra: Params) => {
      const core = new mod.PipeCore(SR, seeded());
      const p = pluck(extra);
      core.noteOn(60, 1, p);
      return pitchOf(render(core, 0.6, p).l, Math.floor(0.2 * SR), hz(60 + (extra.tune ?? 0) + (extra.bend ?? 0)));
    };
    expect(Math.abs(cents(run({ tune: 7 }), hz(67)))).toBeLessThan(12);
    expect(Math.abs(cents(run({ bend: 2 }), hz(62)))).toBeLessThan(12);
  });

  it('rings for about the decay time, and dies faster after release', () => {
    const core = new mod.PipeCore(SR, seeded());
    const p = pluck({ fbDec: 1, lp: 36, hp: -48 });
    core.noteOn(60, 1, p);
    const { l } = render(core, 1.6, p);
    const f = hz(60);
    const early = magAt(l, Math.floor(0.1 * SR), 8192, f);
    const late = magAt(l, Math.floor(1.1 * SR), 8192, f);
    // Decay is the 60 dB time of the fundamental, so one second later it should be about 60 dB down
    expect(db(late) - db(early)).toBeLessThan(-48);
    expect(db(late) - db(early)).toBeGreaterThan(-72);

    const core2 = new mod.PipeCore(SR, seeded());
    const p2 = pluck({ fbDec: 5, fbRel: 0.1 });
    core2.noteOn(60, 1, p2);
    const a2 = render(core2, 0.3, p2).l;
    core2.noteOff(60);
    const b2 = render(core2, 0.5, p2).l;
    expect(db(rms(b2, Math.floor(0.4 * SR), Math.floor(0.5 * SR))) - db(rms(a2, Math.floor(0.2 * SR), Math.floor(0.3 * SR)))).toBeLessThan(-40);
  });

  it('never blows up, even with maximum feedback, push and hard saturation', () => {
    const core = new mod.PipeCore(SR, seeded());
    const p = { ...pluck({ fbDec: 30, push: 1.5, satHard: 1, satSym: 1, noise: 0.5, sus: 1, gain: 2, hp: -60, lp: 90 }) };
    for (const n of [36, 48, 60, 72, 84]) core.noteOn(n, 1, p);
    const { l, r } = render(core, 3, p);
    let peak = 0;
    for (let i = 0; i < l.length; i++) {
      expect(Number.isFinite(l[i]!) && Number.isFinite(r[i]!)).toBe(true);
      peak = Math.max(peak, Math.abs(l[i]!), Math.abs(r[i]!));
    }
    expect(peak).toBeLessThan(8);
  });

  it('push makes the pipe oscillate on its own', () => {
    const sustained = (push: number) => {
      const core = new mod.PipeCore(SR, seeded());
      const p = { ...mod.PIPE_DEFAULTS, noise: 0.05, atk: 0.05, sus: 1, gain: 0.3, nCut: 120, vel: 0, volume: 1, fbDec: 4, push, lp: 30, hp: -36, satHard: 0.1 };
      core.noteOn(57, 1, p);
      const { l } = render(core, 3, p);
      return rms(l, Math.floor(2.5 * SR), Math.floor(3 * SR));
    };
    const off = sustained(0);
    const on = sustained(1.2);
    expect(on).toBeGreaterThan(0.05);
    expect(on).toBeGreaterThan(off * 4);
  });

  it('polarity removes the even harmonics', () => {
    const ratio = (pol: number) => {
      const core = new mod.PipeCore(SR, seeded());
      const p = pluck({ pol, satHard: 0, lp: 60, fbDec: 3 });
      core.noteOn(48, 1, p);
      const { l } = render(core, 0.8, p);
      const f = hz(48);
      const from = Math.floor(0.2 * SR);
      const fund = magAt(l, from, 16384, f);
      const second = magAt(l, from, 16384, 2 * f);
      return second / fund;
    };
    expect(ratio(1)).toBeLessThan(ratio(0) * 0.4);
  });

  it('split mode makes the partials inharmonic', () => {
    const second = (extra: Params) => {
      const core = new mod.PipeCore(SR, seeded());
      const p = pluck({ lp: 60, fbDec: 3, ...extra });
      core.noteOn(48, 1, p);
      const { l } = render(core, 1, p);
      const f = hz(48);
      const from = Math.floor(0.25 * SR);
      let best = 0, bestF = 0;
      for (let q = 1.6 * f; q <= 2.6 * f; q += 0.5) {
        const m = magAt(l, from, 16384, q);
        if (m > best) { best = m; bestF = q; }
      }
      return bestF / f;
    };
    const plain = second({ split: 0, harm: 0 });
    const split = second({ split: 1, harm: 0.5, splitPt: 0.3 });
    expect(Math.abs(plain - 2)).toBeLessThan(0.03);
    expect(Math.abs(split - 2)).toBeGreaterThan(0.05);
  });

  it('allocates voices in poly, mono and unison modes', () => {
    const poly = new mod.PipeCore(SR, seeded());
    const p = pluck({ mode: 0, fbDec: 5 });
    for (let i = 0; i < 8; i++) poly.noteOn(50 + i, 1, p);
    expect(poly.activeVoices).toBe(8);
    poly.noteOn(70, 1, p); // a ninth note steals
    expect(poly.activeVoices).toBe(8);
    expect(poly.voices.some((v) => v.note === 70)).toBe(true);

    const mono = new mod.PipeCore(SR, seeded());
    const pm = pluck({ mode: 1 });
    mono.noteOn(60, 1, pm);
    mono.noteOn(64, 1, pm);
    expect(mono.activeVoices).toBe(1);

    const uni = new mod.PipeCore(SR, seeded());
    const pu = pluck({ mode: 2 });
    uni.noteOn(60, 1, pu);
    expect(uni.activeVoices).toBe(8);
  });

  it('mono returns to the held note when the newer one is released', () => {
    const core = new mod.PipeCore(SR, seeded());
    const p = pluck({ mode: 1, glideOn: 0, fbDec: 3 });
    core.noteOn(60, 1, p);
    core.noteOn(67, 1, p);
    core.noteOff(67);
    const { l } = render(core, 0.9, p);
    expect(Math.abs(cents(pitchOf(l, Math.floor(0.5 * SR), hz(60)), hz(60)))).toBeLessThan(20);
  });

  it('the sustain pedal holds released notes until it is lifted', () => {
    const core = new mod.PipeCore(SR, seeded());
    const p = pluck({ fbDec: 3, fbRel: 0.05 });
    core.sustainPedal(true);
    core.noteOn(60, 1, p);
    core.noteOff(60);
    expect(core.voices.some((v) => v.active && v.gate)).toBe(true);
    core.sustainPedal(false);
    expect(core.voices.some((v) => v.active && v.gate)).toBe(false);
  });

  it('goes quiet and frees its voices once everything has rung out', () => {
    const core = new mod.PipeCore(SR, seeded());
    const p = pluck({ fbDec: 0.3, fbRel: 0.05, rel: 0.02 });
    core.noteOn(60, 1, p);
    render(core, 0.3, p);
    core.noteOff(60);
    const { l } = render(core, 2, p);
    expect(core.activeVoices).toBe(0);
    expect(rms(l, l.length - 4800, l.length)).toBeLessThan(1e-4);
  });

  it('the LFO changes the sound, and zero amount leaves it alone', () => {
    const take = (lfoAmt: number, lfoDest: number) => {
      const core = new mod.PipeCore(SR, seeded());
      const p = pluck({ sus: 1, atk: 0.01, noise: 0.3, lfoAmt, lfoDest, lfoRate: 6, fbDec: 4 });
      core.noteOn(60, 1, p);
      return render(core, 0.5, p).l;
    };
    const flat = take(0, 0);
    const vib = take(1, 0);
    const base = take(0, 0);
    let diffFlat = 0, diffVib = 0;
    for (let i = 0; i < flat.length; i++) { diffFlat += Math.abs(flat[i]! - base[i]!); diffVib += Math.abs(flat[i]! - vib[i]!); }
    expect(diffFlat).toBe(0);
    expect(diffVib).toBeGreaterThan(1);
  });
});

describe('SpringCore', () => {
  const impulse = (p: Params, seconds: number, amp = 1) => {
    const core = new mod.SpringCore(SR);
    const n = Math.floor(seconds * SR);
    const input = new Float32Array(n);
    input[0] = amp;
    const l = new Float32Array(n);
    const r = new Float32Array(n);
    for (let at = 0; at < n; at += 128) {
      const len = Math.min(128, n - at);
      core.process(input.subarray(at, at + len), l.subarray(at, at + len), r.subarray(at, at + len), len, p);
    }
    return { l, r };
  };
  const sp = (extra: Params = {}): Params => ({ ...mod.SPRING_DEFAULTS, ...extra });

  it('is silent for silence', () => {
    const core = new mod.SpringCore(SR);
    const l = new Float32Array(4800);
    const r = new Float32Array(4800);
    core.process(new Float32Array(4800), l, r, 4800, sp());
    expect(rms(l, 0, 4800)).toBeLessThan(1e-6);
  });

  it('rings and then decays: the tail is far quieter after the decay time', () => {
    const { l } = impulse(sp({ decay: 1, dwell: 0.2 }), 4);
    const early = rms(l, Math.floor(0.05 * SR), Math.floor(0.55 * SR));
    const late = rms(l, Math.floor(3.4 * SR), Math.floor(3.9 * SR));
    expect(early).toBeGreaterThan(1e-4);
    expect(db(late) - db(early)).toBeLessThan(-40);
  });

  it('a longer Length keeps more tail', () => {
    const tail = (decay: number) => {
      const { l } = impulse(sp({ decay }), 3);
      return rms(l, Math.floor(1.5 * SR), Math.floor(2.5 * SR));
    };
    expect(tail(4)).toBeGreaterThan(tail(0.8) * 3);
  });

  it('stays bounded at the extremes', () => {
    const { l, r } = impulse({ tension: 0, drip: 1, decay: 12, tilt: 1, dwell: 1 }, 3, 1);
    for (let i = 0; i < l.length; i++) {
      expect(Number.isFinite(l[i]!) && Number.isFinite(r[i]!)).toBe(true);
      expect(Math.abs(l[i]!)).toBeLessThan(4);
      expect(Math.abs(r[i]!)).toBeLessThan(4);
    }
  });

  it('Tilt moves the tail between dark and bright', () => {
    const bright = (tilt: number) => {
      const { l } = impulse(sp({ tilt, decay: 2 }), 3);
      // crude split: energy of the difference signal (highs) against the running average (lows)
      let lo = 0, hi = 0, avg = 0;
      for (let i = Math.floor(0.5 * SR); i < Math.floor(2.5 * SR); i++) {
        avg += 0.1 * (l[i]! - avg);
        lo += avg * avg;
        hi += (l[i]! - avg) * (l[i]! - avg);
      }
      return hi / lo;
    };
    expect(bright(1)).toBeGreaterThan(bright(-1) * 1.2);
  });

  it('the two springs give a decorrelated stereo tail', () => {
    const { l, r } = impulse(sp(), 1);
    let same = 0, ll = 0, rr = 0;
    for (let i = 0; i < l.length; i++) { same += l[i]! * r[i]!; ll += l[i]! * l[i]!; rr += r[i]! * r[i]!; }
    expect(Math.abs(same) / Math.sqrt(ll * rr)).toBeLessThan(0.6);
  });
});

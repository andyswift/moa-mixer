import { describe, expect, it } from 'vitest';
import { VOWELS, VoxSinger, vowelShape } from '../../domain/devices/voxSinger';
import { VOICE_SOURCE } from '../voiceWorklet';

interface Core {
  n: number; hz: number; amp: number; air: number; scoopOff: number; onsetBreath: number; jitter: number; shimmer: number; vibRateMul: number; exhale: number;
  onset: number; scoop: number; roughness: number;
  setShape(s: object, jump?: boolean): void; setLength(cm: number): void; updateTract(seconds: number): void;
  step(input: number, frac: number): number; noteOn(hz: number, intensity: number, legato: boolean): void; noteOff(): void;
  process(out: Float32Array, n: number, p: { level: number }): void;
  vibDepth: number; glide: number; breath: number; tension: number;
}
const { VoiceCore } = new Function(`${VOICE_SOURCE}; return { VoiceCore };`)() as { VoiceCore: new (sr: number, cm?: number) => Core };
const SR = 48000;

function fft(re: Float64Array, im: Float64Array): void {
  const n = re.length;
  for (let i = 1, j = 0; i < n; i++) {
    let bit = n >> 1;
    for (; j & bit; bit >>= 1) j ^= bit;
    j ^= bit;
    if (i < j) { [re[i], re[j]] = [re[j]!, re[i]!]; [im[i], im[j]] = [im[j]!, im[i]!]; }
  }
  for (let len = 2; len <= n; len <<= 1) {
    const a = (-2 * Math.PI) / len;
    for (let i = 0; i < n; i += len) for (let k = 0; k < len / 2; k++) {
      const wr = Math.cos(a * k), wi = Math.sin(a * k), u = i + k, v = u + len / 2;
      const xr = re[v]! * wr - im[v]! * wi, xi = re[v]! * wi + im[v]! * wr;
      re[v] = re[u]! - xr; im[v] = im[u]! - xi; re[u] = re[u]! + xr; im[u] = im[u]! + xi;
    }
  }
}

/** The tract's spectrum (magnitude per bin of 48000 / 8192 Hz), from its impulse response. */
function spectrum(shape: object, cm = 17): number[] {
  const v = new VoiceCore(SR, cm);
  v.setShape({ velum: 0.01, ...shape }, true);
  v.updateTract(1); v.updateTract(1);
  const N = 8192, re = new Float64Array(N), im = new Float64Array(N);
  for (let i = 0; i < N; i++) re[i] = 0.5 * (v.step(i === 0 ? 1 : 0, 0) + v.step(0, 0));
  fft(re, im);
  return Array.from({ length: N / 2 }, (_, k) => Math.hypot(re[k]!, im[k]!));
}

/** The tract's resonances below 4.5 kHz: the peaks of its spectrum. */
function formants(shape: object, cm = 17): number[] {
  const N = 8192, mag = spectrum(shape, cm);
  const hz = (k: number) => (k * SR) / N;
  const peaks: number[] = [];
  for (let k = 2; k < N / 2 - 2 && hz(k) < 4500; k++) {
    if (hz(k) > 150 && mag[k]! > mag[k - 1]! && mag[k]! >= mag[k + 1]! && mag[k]! > mag[k - 2]! && mag[k]! > mag[k + 2]!) peaks.push(hz(k));
  }
  return peaks;
}

/** Sings a note for `seconds` and returns the output. */
function sing(core: Core, seconds: number, level = 0.8): Float32Array {
  const n = Math.round(seconds * SR), out = new Float32Array(n);
  for (let at = 0; at < n; at += 128) core.process(out.subarray(at, Math.min(n, at + 128)), Math.min(128, n - at), { level });
  return out;
}

/** The pitch of a stretch of sound, by autocorrelation between 60 and 1000 Hz. */
function pitch(x: Float32Array): number {
  let best = 0, bestLag = 0;
  for (let lag = Math.floor(SR / 1000); lag < SR / 60; lag++) {
    let s = 0;
    for (let i = 0; i + lag < x.length; i++) s += x[i]! * x[i + lag]!;
    if (s > best) { best = s; bestLag = lag; }
  }
  return SR / bestLag;
}

describe('MOA-VOX: the vocal tract', () => {
  it('shapes each vowel: its first two resonances within 8 % of the average man\'s', () => {
    for (const v of VOWELS) {
      const f = formants(v.shape);
      expect(f.length, v.name).toBeGreaterThanOrEqual(2);
      expect(Math.abs(f[0]! / v.formants[0] - 1), `${v.name} F1 ${f[0]}`).toBeLessThan(0.08);
      expect(Math.abs(f[1]! / v.formants[1] - 1), `${v.name} F2 ${f[1]}`).toBeLessThan(0.08);
    }
  });

  it('is as long as asked: a shorter tract has fewer sections and every resonance higher (a smaller voice)', () => {
    const long = new VoiceCore(SR, 17), short = new VoiceCore(SR, 14);
    expect(long.n).toBe(Math.round(0.17 / (350 / (2 * SR))));
    expect(short.n).toBeLessThan(long.n);
    const fl = formants(VOWELS[2]!.shape, 17), fs = formants(VOWELS[2]!.shape, 14);
    expect(fs[0]!).toBeGreaterThan(fl[0]! * 1.1);
    expect(fs[1]!).toBeGreaterThan(fl[1]! * 1.1);
  });
});

describe('MOA-VOX: singing', () => {
  it('sings the note asked for, at a healthy level, and falls silent after it is let go', () => {
    const core = new VoiceCore(SR, 17);
    core.vibDepth = 0;
    core.noteOn(220, 0.9, false);
    const out = sing(core, 1);
    const tail = out.subarray(SR / 2);
    expect(Math.abs(pitch(tail) / 220 - 1)).toBeLessThan(0.02);
    const rms = Math.sqrt(tail.reduce((a, x) => a + x * x, 0) / tail.length);
    expect(rms).toBeGreaterThan(0.02);
    expect(Math.max(...Array.from(out, Math.abs))).toBeLessThan(1);
    core.noteOff();
    const after = sing(core, 2);
    expect(Math.max(...Array.from(after.subarray(SR), Math.abs))).toBeLessThan(1e-3);
  });

  it('glides legato from one note to the next, and jumps when the note starts afresh', () => {
    const core = new VoiceCore(SR, 17);
    core.vibDepth = 0;
    core.glide = 0.1;
    core.noteOn(220, 0.9, false);
    sing(core, 0.5);
    core.noteOn(330, 0.9, true);
    sing(core, 0.05);
    expect(core.hz).toBeGreaterThan(225);
    expect(core.hz).toBeLessThan(320);
    sing(core, 1);
    expect(Math.abs(core.hz / 330 - 1)).toBeLessThan(0.01);
    core.noteOn(196, 0.9, false);
    expect(core.hz).toBe(196);
  });

  it('stays stable whatever is asked: every vowel, nasal, all tension and breath, low and high', () => {
    for (const v of [0, 1.5, 2, 3.7, 4]) for (const nasal of [0, 1]) for (const hz of [80, 600]) {
      const core = new VoiceCore(SR, 13);
      core.setShape(vowelShape(v, nasal), true);
      core.tension = 1; core.breath = 1;
      core.noteOn(hz, 1, false);
      const out = sing(core, 0.5, 2);
      for (const x of out) expect(Number.isFinite(x) && Math.abs(x) <= 1).toBe(true);
    }
  });
});

describe('MOA-VOX: the singer', () => {
  type Sent = { type: string; hz?: number; legato?: boolean; shape?: object };
  const watch = (v: VoxSinger) => {
    const sent: Sent[] = [];
    v.circuit.onChange((c) => { if (c.type === 'message') sent.push(c.data as Sent); });
    return sent;
  };

  it('sings one note at a time: a second key is legato, and letting it go glides back to the one held', () => {
    const v = new VoxSinger();
    const sent = watch(v);
    v.keyDown(57);
    v.keyDown(60);
    v.keyUp(60);
    v.keyUp(57);
    expect(sent.filter((m) => m.type !== 'configure').map((m) => `${m.type}${m.hz ? ` ${Math.round(m.hz)}` : ''}${m.legato ? ' legato' : ''}`))
      .toEqual(['note 220', 'note 262 legato', 'note 220 legato', 'off']);
  });

  it('blends the vowels along its Vowel knob, and keeps its setup for a voice built later', () => {
    expect(vowelShape(2, 0)).toEqual({ ...VOWELS[2]!.shape, velum: 0.01 });
    const half = vowelShape(2.5, 0);
    expect(half.tongueIndex).toBeCloseTo((VOWELS[2]!.shape.tongueIndex + VOWELS[3]!.shape.tongueIndex) / 2, 9);
    const v = new VoxSinger();
    (v.control('vowel') as { set(x: number): void }).set(4);
    (v.control('size') as { set(x: number): void }).set(15);
    const config = JSON.parse(v.circuit.node('voice').options.config!) as { shape: { tongueIndex: number }; length: number; vibDepth: number };
    expect(config.shape.tongueIndex).toBe(VOWELS[4]!.shape.tongueIndex);
    expect(config.length).toBe(15);
    expect(config.vibDepth).toBe(30);
  });
});

describe('MOA-VOX: expression', () => {
  const quiet = (core: Core) => { core.vibDepth = 0; core.roughness = 0; return core; };

  it('rings: narrowing the tube above the folds lifts the 3 kHz peak against the vowel, for every vowel', () => {
    const peak = (mag: number[], lo: number, hi: number) => 20 * Math.log10(Math.max(...mag.slice(Math.round((lo * 8192) / SR), Math.round((hi * 8192) / SR))));
    const ring = (shape: object, r: number) => { const m = spectrum({ ...shape, ring: r }); return peak(m, 2300, 3500) - peak(m, 100, 1500); };
    for (const v of VOWELS) expect(ring(v.shape, 1) - ring(v.shape, 0), v.name).toBeGreaterThan(4);
  });

  it('scoops up into a fresh note, but not into a legato one', () => {
    const core = quiet(new VoiceCore(SR, 17));
    core.scoop = 50;
    core.noteOn(220, 0.9, false);
    expect(core.scoopOff).toBe(-50);
    sing(core, 0.4);
    expect(Math.abs(core.scoopOff)).toBeLessThan(0.5);
    core.noteOn(247, 0.9, true);
    expect(Math.abs(core.scoopOff)).toBeLessThan(0.5);
  });

  it('starts a note as asked: a breathy onset leads with air and lets the tone in late, a hard one starts at once', () => {
    const start = (onset: number) => {
      const core = quiet(new VoiceCore(SR, 17));
      core.onset = onset;
      core.noteOn(220, 0.9, false);
      sing(core, 0.03);
      return core;
    };
    const breathy = start(0), hard = start(1);
    expect(breathy.air).toBeGreaterThan(0.8);
    expect(breathy.onsetBreath).toBeGreaterThan(0.5);
    expect(hard.amp).toBeGreaterThan(breathy.amp * 2);
  });

  it('is never quite even: each period a little off in length and height with roughness, its vibrato wandering', () => {
    const periods = (roughness: number) => {
      const core = new VoiceCore(SR, 17);
      core.roughness = roughness;
      core.noteOn(220, 0.9, false);
      const jitters = new Set<number>(), shimmers: number[] = [], rates = new Set<number>();
      for (let b = 0; b < 400; b++) { sing(core, 128 / SR); jitters.add(core.jitter); shimmers.push(core.shimmer); rates.add(core.vibRateMul); }
      return { jitters: [...jitters], shimmers, rates: [...rates] };
    };
    expect(periods(0).jitters).toEqual([0]);
    const rough = periods(1);
    expect(rough.jitters.length).toBeGreaterThan(50);
    for (const j of rough.jitters) expect(Math.abs(j)).toBeLessThanOrEqual(0.006); // 0.6 % at most, as a real voice's
    for (const s of rough.shimmers) expect(Math.abs(s - 1)).toBeLessThanOrEqual(0.08);
    expect(rough.rates.length).toBeGreaterThan(3);
    for (const r of rough.rates) expect(Math.abs(r - 1)).toBeLessThanOrEqual(0.08);
  });

  it('breathes out after a note, then is silent', () => {
    const core = new VoiceCore(SR, 17);
    core.noteOn(220, 0.9, false);
    sing(core, 0.5);
    core.noteOff();
    expect(core.exhale).toBeGreaterThan(0.08);
    sing(core, 1.5);
    expect(core.exhale).toBeLessThan(1e-3);
  });

  it('takes a breath controller, an expression pedal and a vowel from MIDI', () => {
    const v = new VoxSinger();
    const sent: { type: string; expression?: number }[] = [];
    v.circuit.onChange((c) => { if (c.type === 'message') sent.push(c.data as { type: string; expression?: number }); });
    v.handleMidi({ type: 'cc', channel: 0, controller: 74, value: 127 });
    v.handleMidi({ type: 'cc', channel: 0, controller: 2, value: 0 });
    v.handleMidi({ type: 'cc', channel: 0, controller: 11, value: 64 });
    expect(v.control('vowel').value).toBe(4);
    expect(v.control('breath').value).toBe(0);
    expect(sent.at(-1)!.expression).toBeCloseTo(64 / 127, 9);
  });

  it('breathes as a voice does: the default about 22 dB of tone over noise (clear), full breath about 10 (very breathy)', () => {
    const run = (breath: number) => {
      const core = quiet(new VoiceCore(SR, 17));
      core.breath = breath;
      core.noteOn(220, 0.8, false);
      return sing(core, 1).subarray(SR / 2);
    };
    const clean = run(0);
    const hnr = (breath: number) => {
      const x = run(breath);
      let tone = 0, noise = 0;
      for (let i = 0; i < x.length; i++) { tone += clean[i]! ** 2; noise += (x[i]! - clean[i]!) ** 2; }
      return 10 * Math.log10(tone / noise);
    };
    expect(hnr(0.25)).toBeGreaterThan(19);
    expect(hnr(0.25)).toBeLessThan(26);
    expect(hnr(1)).toBeGreaterThan(7);
    expect(hnr(1)).toBeLessThan(14);
  });
});

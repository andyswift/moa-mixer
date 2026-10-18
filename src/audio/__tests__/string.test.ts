import { describe, expect, it } from 'vitest';
import {
  FINGER, GAUGES, PICK, SCALES, inharmonicity, midiToHz, pluckAmplitudes, tensionFor, voiceConfig, type VoiceSetup,
} from '../../domain/devices/bassPhysics';
import { STRING_SOURCE } from '../stringWorklet';

interface Core {
  re: Float64Array; im: Float64Array; pitchScale: number;
  configure(m: unknown): void; pluck(amps: number[], grab?: number[]): void; setMuted(on: boolean): void;
  process(out: Float32Array, n: number, p: { level: number; tone: number }): void;
}
const { StringCore } = new Function(`${STRING_SOURCE}; return { StringCore };`)() as { StringCore: new (sr: number) => Core };

const SR = 48000;
const L = SCALES.long;
const T = tensionFor(GAUGES.E, L, midiToHz(28));
const setup = (over: Partial<VoiceSetup> = {}): VoiceSetup => ({
  spec: GAUGES.E, scale: L, tension: T, fret: 0, pickup: 0.15, palm: { position: 0.03, amount: 0 }, sampleRate: SR, ...over,
});

function play(over: Partial<VoiceSetup> = {}, pluck: { position?: number; height?: number; finger?: boolean } = {}, seconds = 1) {
  const cfg = voiceConfig(setup(over));
  const core = new StringCore(SR);
  core.configure(cfg);
  const amps = pluckAmplitudes(cfg.length, cfg.hz, { position: pluck.position ?? 0.12, height: pluck.height ?? 0.002, ...(pluck.finger === false ? PICK : FINGER) });
  core.pluck(amps);
  const n = Math.round(seconds * SR);
  const out = new Float32Array(n);
  for (let at = 0; at < n; at += 128) core.process(out.subarray(at, Math.min(n, at + 128)), Math.min(128, n - at), { level: 0.5, tone: 12000 });
  return { core, cfg, out };
}

/** Power at a frequency over a window (a Hann-windowed single-bin DFT). */
function powerAt(x: Float32Array, hz: number, from = 0, len = x.length - from): number {
  let re = 0, im = 0;
  for (let i = 0; i < len; i++) {
    const w = 0.5 - 0.5 * Math.cos((2 * Math.PI * i) / (len - 1));
    const a = (2 * Math.PI * hz * (from + i)) / SR;
    re += x[from + i]! * w * Math.cos(a);
    im -= x[from + i]! * w * Math.sin(a);
  }
  return re * re + im * im;
}
/** The strongest frequency near `hz` (within +/- 3 %), searched in 0.02 % steps. */
function peakNear(x: Float32Array, hz: number, from = 0, len?: number): number {
  let best = hz, bestP = -1;
  for (let f = hz * 0.97; f <= hz * 1.03; f *= 1.0002) {
    const p = powerAt(x, f, from, len);
    if (p > bestP) { bestP = p; best = f; }
  }
  return best;
}

describe('the string engine', () => {
  // a gentle pluck (0.5 mm) for the tuning tests, so tension modulation does not move the pitch
  const gentle = { height: 0.0005 };

  it('sounds the open E (41.2 Hz) and its stretched partials where the physics says', () => {
    const { out, cfg } = play({}, gentle, 2);
    expect(Math.abs(peakNear(out, 41.2, SR / 2, SR) / cfg.hz[0]! - 1)).toBeLessThan(0.002);
    // partials sit at n f1 sqrt(1 + B n^2), not at plain multiples
    const B = inharmonicity(GAUGES.E, L, T);
    for (const n of [3, 6, 10]) {
      const expected = n * cfg.hz[0]! / Math.sqrt(1 + B) * Math.sqrt(1 + B * n * n);
      expect(Math.abs(peakNear(out, expected, SR / 2, SR) / expected - 1)).toBeLessThan(0.002);
    }
  });

  it('fret 12 plays the octave, fret 7 the fifth', () => {
    const open = play({}, gentle, 2).cfg.hz[0]!;
    const twelfth = play({ fret: 12 }, gentle, 2);
    expect(Math.abs(peakNear(twelfth.out, 2 * open, SR / 2, SR) / (2 * open) - 1)).toBeLessThan(0.003);
    const seventh = play({ fret: 7 }, gentle, 2);
    const fifth = open * Math.pow(2, 7 / 12);
    expect(Math.abs(peakNear(seventh.out, fifth, SR / 2, SR) / fifth - 1)).toBeLessThan(0.003);
  });

  it('plucked in the middle, the even harmonics are missing', () => {
    const { out, cfg } = play({}, { position: L / 2 }, 1.5);
    const p = (h: number) => powerAt(out, cfg.hz[h - 1]!, SR / 4, SR);
    expect(p(2) / p(3)).toBeLessThan(1e-3);
    expect(p(4) / p(3)).toBeLessThan(1e-3);
  });

  it('each mode decays at its own rate, the highs first', () => {
    const { core, cfg } = play({}, {}, 1);
    const start = play({}, {}, 1 / SR).core; // the amplitudes just after the pluck
    const kept = (k: number) => Math.hypot(core.re[k]!, core.im[k]!) / Math.hypot(start.re[k]!, start.im[k]!);
    expect(kept(0)).toBeCloseTo(Math.exp(-cfg.sigma[0]!), 2);
    expect(kept(20)).toBeLessThan(kept(0) * 0.5);
  });

  it('a palm mute shortens the note, the highs most; releasing the note mutes it fast', () => {
    const rms = (x: Float32Array, from: number) => Math.sqrt(x.subarray(from).reduce((s, v) => s + v * v, 0) / (x.length - from));
    const open = play({}, {}, 1).out;
    const muted = play({ palm: { position: 0.03, amount: 1 } }, {}, 1).out;
    expect(rms(muted, SR / 2)).toBeLessThan(rms(open, SR / 2) * 0.5);
    const { core } = play({}, {}, 0.2);
    core.setMuted(true);
    const after = new Float32Array(SR / 4);
    for (let at = 0; at < after.length; at += 128) core.process(after.subarray(at, at + 128), 128, { level: 0.5, tone: 12000 });
    expect(rms(after, after.length - 2400)).toBeLessThan(rms(open, SR / 5) * 0.01); // 40 dB down in a quarter second
  });

  it('a hard pluck starts sharp and settles (tension modulation); a soft one does not', () => {
    const glide = (height: number) => {
      const { core } = play({}, { height }, 0.02);
      const early = core.pitchScale;
      const late = play({}, { height }, 2).core.pitchScale;
      return { early, late };
    };
    const hard = glide(0.008), soft = glide(0.0005);
    expect(hard.early).toBeGreaterThan(1.001); // a few cents sharp
    expect(hard.late).toBeLessThan(hard.early);
    expect(soft.early - 1).toBeLessThan(0.0006); // under a cent
  });

  it('stays finite and bounded, even plucked very hard near the bridge with a pick', () => {
    const { out } = play({}, { position: 0.02, height: 0.012, finger: false }, 1);
    expect(out.every(Number.isFinite)).toBe(true);
    expect(Math.max(...Array.from(out, Math.abs))).toBeLessThanOrEqual(1);
  });
});

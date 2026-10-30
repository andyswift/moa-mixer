import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { PLAITS_SOURCE } from '../index';

/**
 * Each engine against Mutable Instruments' own: the fixtures are its C++ rendered by tools/plaits/reference.cc
 * (build-reference.sh), through the automation below, the same in both. The port runs in double precision where the
 * module ran in single, so the two drift apart a little; a port that is wrong drifts a lot.
 */
const BLOCK = 24;
const BLOCKS = 200;
const N = BLOCK * BLOCKS;
const MODULE_A0 = 55 / 47872.34;

interface EngineI { reset(): void; render(p: Params, out: Float32Array, aux: Float32Array, size: number): boolean }
interface Params { trigger: number; note: number; timbre: number; morph: number; harmonics: number; accent: number }
const lib = new Function(`${PLAITS_SOURCE}; return { plSetSampleRate, PlVirtualAnalogEngine, PlWaveshapingEngine, PlFMEngine, PlGrainEngine, PlAdditiveEngine, PlWavetableEngine, PlChordEngine };`)() as {
  plSetSampleRate(sr: number, a0?: number): void;
  [engine: string]: unknown;
};
lib.plSetSampleRate(48000, MODULE_A0);

const f = Math.fround;
function render(engine: EngineI): { out: Float32Array; aux: Float32Array } {
  const out = new Float32Array(N), aux = new Float32Array(N);
  for (let b = 0; b < BLOCKS; b++) {
    const phase = b % 50;
    const p: Params = {
      note: f(48 + 12 * (Math.floor(b / 67) % 3) + f(0.37)),
      timbre: f(0.5 + f(0.45) * f(Math.sin(f(b * f(0.05))))),
      morph: f(0.5 + f(0.45) * f(Math.sin(f(f(b * f(0.031)) + 1)))),
      harmonics: f(0.5 + f(0.45) * f(Math.sin(f(f(b * f(0.023)) + 2)))),
      accent: f(0.8),
      trigger: phase === 0 ? 1 | 4 : phase < 25 ? 4 : 0,
    };
    engine.render(p, out.subarray(b * BLOCK, (b + 1) * BLOCK), aux.subarray(b * BLOCK, (b + 1) * BLOCK), BLOCK);
  }
  return { out, aux };
}

function reference(name: string): { out: Float32Array; aux: Float32Array } {
  const buf = readFileSync(new URL(`./fixtures/${name}.f32`, import.meta.url));
  const all = new Float32Array(buf.buffer, buf.byteOffset, buf.byteLength / 4);
  return { out: all.slice(0, N), aux: all.slice(N, 2 * N) };
}

/** How far apart two renders are: the error's RMS against the reference's, and the largest single difference. */
function compare(got: Float32Array, want: Float32Array) {
  let e = 0, s = 0, max = 0;
  for (let i = 0; i < want.length; i++) {
    const d = got[i]! - want[i]!;
    e += d * d; s += want[i]! * want[i]!;
    max = Math.max(max, Math.abs(d));
  }
  return { relative: Math.sqrt(e / Math.max(s, 1e-12)), max, rms: Math.sqrt(s / want.length) };
}

const ENGINES: [fixture: string, cls: string, tolerance: number][] = [
  ['va', 'PlVirtualAnalogEngine', 3e-3],
  ['waveshaping', 'PlWaveshapingEngine', 3e-3],
  ['fm', 'PlFMEngine', 3e-3],
  ['grain', 'PlGrainEngine', 3e-3],
  ['additive', 'PlAdditiveEngine', 3e-3],
  ['wavetable', 'PlWavetableEngine', 3e-3],
  ['chord', 'PlChordEngine', 3e-3],
];

describe('Plaits engines, against the module', () => {
  for (const [fixture, cls, tolerance] of ENGINES) {
    it(`${fixture}: OUT and AUX match the original`, () => {
      const Engine = lib[cls] as new () => EngineI;
      const engine = new Engine();
      engine.reset(); // as the module does after Init
      const got = render(engine);
      const want = reference(fixture);
      for (const ch of ['out', 'aux'] as const) {
        const c = compare(got[ch], want[ch]);
        console.log(fixture, ch, JSON.stringify(c));
        expect(c.rms, `${fixture} ${ch} is not silent`).toBeGreaterThan(0.01);
        expect(c.relative, `${fixture} ${ch}: relative error`).toBeLessThan(tolerance);
      }
    });
  }
});

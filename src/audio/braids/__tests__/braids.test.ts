import { existsSync, readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { BRAIDS_SOURCE } from '../index';

/**
 * Braids' models against Mutable Instruments' own: the fixtures are its C++ rendered by tools/braids/reference.cc
 * (build-reference.sh), through the automation below, the same in both. Braids is fixed point, so the port matches it
 * sample for sample; a model whose fixture has not been rendered is skipped there, and checked by ear and below.
 */
const BLOCK = 24;
const BLOCKS = 600;
const SR = 96000; // Braids' own rate

interface MacroI {
  init(): void;
  setShape(shape: number): void;
  setPitch(pitch: number): void;
  setParameters(p0: number, p1: number): void;
  strike(): void;
  render(sync: Uint8Array, buffer: Int16Array, size: number): void;
}
const lib = new Function(`${BRAIDS_SOURCE}; return { BrMacroOscillator, brRandomSeed, BR_MODELS };`)() as {
  BrMacroOscillator: new () => MacroI;
  brRandomSeed(seed: number): void;
  BR_MODELS: number;
};

function fresh(shape: number): MacroI {
  lib.brRandomSeed(0x21);
  const osc = new lib.BrMacroOscillator();
  osc.init();
  osc.setShape(shape);
  return osc;
}

/** The reference's automation: pitch steps through C3, G3, C4, G4; TIMBRE and COLOR on slow sines; a strike every 150 blocks. */
function automated(shape: number): Int16Array {
  const osc = fresh(shape), sync = new Uint8Array(BLOCK), out = new Int16Array(BLOCK * BLOCKS);
  const notes = [48, 55, 60, 67];
  for (let b = 0; b < BLOCKS; b++) {
    osc.setPitch((notes[Math.floor(b / 150) % 4]! << 7) + 37);
    osc.setParameters(Math.trunc(16384 + 15000 * Math.sin(b * 0.05)), Math.trunc(16384 + 15000 * Math.sin(b * 0.031 + 1)));
    if (b % 150 === 0) osc.strike();
    osc.render(sync, out.subarray(b * BLOCK, (b + 1) * BLOCK), BLOCK);
  }
  return out;
}

/** Holds a note at fixed TIMBRE and COLOR for `seconds`. */
function held(shape: number, note: number, timbre: number, color: number, seconds = 0.2): Int16Array {
  const osc = fresh(shape), sync = new Uint8Array(BLOCK), n = Math.floor((seconds * SR) / BLOCK);
  const out = new Int16Array(n * BLOCK);
  for (let b = 0; b < n; b++) {
    osc.setPitch(note << 7);
    osc.setParameters(timbre, color);
    osc.render(sync, out.subarray(b * BLOCK, (b + 1) * BLOCK), BLOCK);
  }
  return out;
}

const rms = (x: Int16Array, from = 0) => { let s = 0; for (let i = from; i < x.length; i++) s += x[i]! * x[i]!; return Math.sqrt(s / (x.length - from)); };
/** The strongest partial between 100 and 1000 Hz, to half a hertz (a DFT swept across the range). */
function pitchOf(x: Int16Array, from: number): number {
  const seg = x.subarray(from, from + 9600);
  let best = 0, at = 0;
  for (let f = 100; f < 1000; f += 0.5) {
    let re = 0, im = 0;
    for (let i = 0; i < seg.length; i++) { re += seg[i]! * Math.cos((2 * Math.PI * f * i) / SR); im += seg[i]! * Math.sin((2 * Math.PI * f * i) / SR); }
    const m = Math.hypot(re, im);
    if (m > best) { best = m; at = f; }
  }
  return at;
}
/** How different two renders are, relative to their level. */
function difference(a: Int16Array, b: Int16Array, from: number): number {
  let d = 0, s = 0;
  for (let i = from; i < a.length; i++) { d += (a[i]! - b[i]!) ** 2; s += a[i]! ** 2 + b[i]! ** 2; }
  return Math.sqrt(d / Math.max(1, s));
}

const NAMES = ['CSAW', 'MORPH', 'SAW/SQUARE', 'FOLD', 'BUZZ', 'SQUARE SUB', 'SAW SUB', 'SQUARE SYNC', 'SAW SYNC', 'SAW x3', 'SQUARE x3', 'TRIANGLE x3', 'SINE x3', 'RING MOD', 'SAW SWARM', 'SAW COMB', 'TOY', 'FILTER LP', 'FILTER PEAK', 'FILTER BP', 'FILTER HP', 'VOSIM', 'VOWEL', 'VOWEL FOF', 'HARMONICS', 'FM', 'FEEDBACK FM', 'CHAOTIC FM', 'PLUCKED', 'BOWED', 'BLOWN', 'FLUTED', 'BELL', 'DRUM', 'KICK', 'CYMBAL', 'SNARE', 'WAVETABLES', 'WAVE MAP', 'WAVE LINE', 'WAVE PARAPHONIC', 'FILTERED NOISE', 'TWIN PEAKS', 'CLOCKED NOISE', 'GRANULAR CLOUD', 'PARTICLE NOISE', 'DIGITAL MODULATION', '???'];

describe('Braids models, against the module', () => {
  for (let m = 0; m < lib.BR_MODELS; m++) {
    const fixture = new URL(`./fixtures/${m}.i16`, import.meta.url);
    it.skipIf(!existsSync(fixture))(`${m} ${NAMES[m]}: matches the original sample for sample`, () => {
      const buf = readFileSync(fixture);
      const want = new Int16Array(buf.buffer, buf.byteOffset, buf.byteLength / 2);
      const got = automated(m);
      expect(got.length).toBe(want.length);
      let first = -1;
      for (let i = 0; i < want.length; i++) if (got[i] !== want[i]) { first = i; break; }
      expect(first, first >= 0 ? `first difference at sample ${first}: ${got[first]} vs ${want[first]}` : '').toBe(-1);
    });
  }
});

describe('Braids models, by ear and by measure', () => {
  for (let m = 0; m < lib.BR_MODELS; m++) {
    it(`${m} ${NAMES[m]}: sounds through the automation, within 16 bits`, () => {
      const x = automated(m);
      expect(rms(x), NAMES[m]).toBeGreaterThan(300); // BOWED, the quietest, sits some 35 dB down
    });
    it(`${m} ${NAMES[m]}: TIMBRE and COLOR each change the sound`, () => {
      // DIGITAL MODULATION sends a preamble first, and the Morse waits a second before its first dit: they need longer
      const seconds = m >= 46 ? 3 : 0.2;
      const base = held(m, 48, 8000, 8000, seconds), from = 4800;
      expect(difference(base, held(m, 48, 26000, 8000, seconds), from), `${NAMES[m]} TIMBRE`).toBeGreaterThan(0.05);
      // (DIGITAL MODULATION's COLOR is its data, sent after a 64-symbol preamble: at a faster symbol rate, high TIMBRE)
      const t = m === 46 ? 26000 : 8000;
      expect(difference(held(m, 48, t, 8000, seconds), held(m, 48, t, 26000, seconds), from), `${NAMES[m]} COLOR`).toBeGreaterThan(0.05);
    });
  }

  it('plays in tune: A4 is 440 Hz at the module\'s 96 kHz (SAW/SQUARE, FOLD; CSAW an octave down)', () => {
    const near = (got: number, want: number) => expect(got, `${got} Hz`).toBeCloseTo(want, 0);
    near(pitchOf(held(2, 69, 0, 0), 4800), 440);
    near(pitchOf(held(3, 69, 0, 0), 4800), 440);
    near(pitchOf(held(0, 57, 0, 32767), 4800), 220);
  });
});

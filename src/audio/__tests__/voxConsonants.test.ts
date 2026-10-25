import { describe, expect, it } from 'vitest';
import { VoxSinger } from '../../domain/devices/voxSinger';
import { parseLyrics, parseSyllable, VOWEL_SHAPES } from '../../domain/devices/voxPhonemes';
import { VOICE_SOURCE } from '../voiceWorklet';

interface Core {
  on: boolean; velumNow: number; diameter: Float64Array; target: Float64Array; vg: number;
  vibDepth: number; roughness: number; scoop: number;
  noteOn(hz: number, intensity: number, legato: boolean, syllable?: object): void; noteOff(): void;
  process(out: Float32Array, n: number, p: { level: number }): void;
}
const { VoiceCore } = new Function(`${VOICE_SOURCE}; return { VoiceCore };`)() as { VoiceCore: new (sr: number, cm?: number) => Core };
const SR = 48000;

/** A syllable as the singer sends it: its vowels as shapes. */
const message = (text: string) => {
  const s = parseSyllable(text);
  const shape = (v: string) => ({ ...VOWEL_SHAPES[v]!, velum: 0.01, ring: 0.5 });
  return { onset: s.onset, vowel: shape(s.vowel), vowel2: s.vowel2 ? shape(s.vowel2) : undefined, coda: s.coda };
};
const voice = () => { const c = new VoiceCore(SR, 17); c.vibDepth = 0; c.roughness = 0; c.scoop = 0; return c; };
function sing(core: Core, seconds: number): Float32Array {
  const n = Math.round(seconds * SR), out = new Float32Array(n);
  for (let at = 0; at < n; at += 128) core.process(out.subarray(at, Math.min(n, at + 128)), Math.min(128, n - at), { level: 0.8 });
  return out;
}
const rms = (x: Float32Array) => Math.sqrt(x.reduce((a, v) => a + v * v, 0) / x.length);
const db = (a: number, b: number) => 20 * Math.log10(a / b);
/** The sound's centre of brightness: the mean frequency of its zero crossings, a rough but steady measure. */
const crossings = (x: Float32Array) => { let c = 0; for (let i = 1; i < x.length; i++) if ((x[i - 1]! < 0) !== (x[i]! < 0)) c++; return (c * SR) / (2 * x.length); };
/** How loud a plain sung ah is. */
const ahLevel = () => { const c = voice(); c.noteOn(220, 0.9, false, message('ah')); return rms(sing(c, 1).subarray(SR / 2)); };

describe('MOA-VOX: syllables written down', () => {
  it('reads consonants, a vowel and consonants, diphthongs, hums and hisses', () => {
    const show = (t: string) => { const s = parseSyllable(t); return `${s.onset.length}:${s.vowel}${s.vowel2 ? `>${s.vowel2}` : ''}:${s.coda.length}`; };
    expect(show('la')).toBe('1:ah:0');
    expect(show('doo')).toBe('1:oo:0');
    expect(show('ooh')).toBe('0:oo:0');
    expect(show('aah')).toBe('0:ah:0');
    expect(show('bay')).toBe('1:eh>ee:0');
    expect(show('on')).toBe('0:oh:1');
    expect(show('pa')).toBe('2:ah:0'); // the closure, then the breath after it
    expect(parseSyllable('mm').onset[0]!.dur).toBe(Infinity);
    expect(parseSyllable('hmm').onset[0]!.velum).toBeGreaterThan(0.3);
    expect(parseSyllable('shh').onset[0]!.noise).toBe(1);
    expect(parseLyrics('la la, bay-bee').map((s) => s.text)).toEqual(['la', 'la,', 'bay', 'bee']);
    expect(parseLyrics('grandma hello baby').map((s) => s.text)).toEqual(['grand', 'ma', 'hel', 'lo', 'ba', 'by']);
    expect(parseLyrics('la _ _').map((s) => s.hold ?? false)).toEqual([false, true, true]);
    expect(show('grand')).toBe('2:ae:2');
    expect(show('by')).toBe('1:ee:0');
    expect(parseLyrics('astra').map((s) => s.text)).toEqual(['as', 'tra']); // st cannot keep the r: s t r is split s | tr
  });
});

describe('MOA-VOX: consonants, from the physics', () => {
  it('is silent while a p holds the lips shut, then sings the vowel', () => {
    const c = voice();
    c.noteOn(220, 0.9, false, message('pa'));
    const out = sing(c, 0.6);
    const ah = ahLevel();
    expect(db(rms(out.subarray(Math.round(0.01 * SR), Math.round(0.06 * SR))), ah)).toBeLessThan(-30);
    expect(db(rms(out.subarray(Math.round(0.4 * SR))), ah)).toBeGreaterThan(-3);
  });

  it('hums an m out of the nose with the lips shut', () => {
    const c = voice();
    c.noteOn(220, 0.9, false, message('mm'));
    const out = sing(c, 0.8);
    expect(c.diameter[c.diameter.length - 1]!).toBeLessThan(0.01);
    expect(c.velumNow).toBeGreaterThan(0.3);
    const level = db(rms(out.subarray(Math.round(0.4 * SR))), ahLevel());
    expect(level).toBeGreaterThan(-25); // a hum: quieter than the vowel, but there
    expect(level).toBeLessThan(-3);
  });

  it('hisses an s brighter than an sh (its gap further forward, less mouth in front of it), both well under the vowel', () => {
    const hiss = (text: string) => { const c = voice(); c.noteOn(220, 0.9, false, message(text)); return sing(c, 0.6).subarray(Math.round(0.2 * SR)); };
    const s = hiss('ss'), sh = hiss('shh'), ah = ahLevel();
    expect(crossings(s)).toBeGreaterThan(crossings(sh) * 1.15);
    for (const x of [s, sh]) {
      expect(db(rms(x), ah)).toBeLessThan(-6);
      expect(db(rms(x), ah)).toBeGreaterThan(-30);
    }
  });

  it('bursts as a t is let go: noise after the release, out of a silent closure', () => {
    const c = voice();
    c.noteOn(220, 0.9, false, message('ta'));
    const out = sing(c, 0.3);
    const closure = rms(out.subarray(Math.round(0.02 * SR), Math.round(0.06 * SR)));
    const release = rms(out.subarray(Math.round(0.072 * SR), Math.round(0.11 * SR)));
    expect(db(release, closure + 1e-9)).toBeGreaterThan(20);
  });

  it("sings on to the end of a syllable after the note is let go: a diphthong's second vowel, then its last consonant", () => {
    const c = voice();
    c.noteOn(220, 0.9, false, message('ayn'));
    sing(c, 0.4);
    c.noteOff();
    expect(c.on).toBe(true);
    sing(c, 0.15);
    expect(c.on).toBe(true); // the n
    expect(c.velumNow).toBeGreaterThan(0.2);
    sing(c, 0.2);
    expect(c.on).toBe(false);
  });
});

describe('MOA-VOX: smooth articulation', () => {
  /** Sings words a note each and returns the sound. */
  const phrase = (words: string[], gap = 0.2) => {
    const c = voice();
    const out: number[] = [];
    const run = (sec: number) => { const b = sing(c, sec); out.push(...b); };
    for (const w of words) { c.noteOn(220, 0.9, false, message(w)); run(0.35); c.noteOff(); run(gap); }
    return Float32Array.from(out);
  };
  /** The worst click: the largest jump in the waveform's slope against its typical size (a plain ah scores about 2.5). */
  const click = (x: Float32Array) => {
    const d2 = Array.from({ length: x.length - 2 }, (_, i) => Math.abs(x[i + 2]! - 2 * x[i + 1]! + x[i]!));
    const sorted = [...d2].sort((a, b) => a - b);
    return Math.max(...d2) / sorted[Math.floor(sorted.length * 0.99)]!;
  };

  it('moves between consonants without clicking: each articulator lets go as the next closes', () => {
    expect(click(phrase(['ah']))).toBeLessThan(4);
    for (const words of [['grandma'], ['grand', 'ma'], ['ma'], ['na', 'na', 'na'], ['la', 'la']]) expect(click(phrase(words)), words.join(' ')).toBeLessThan(9);
  });

  it('starts a repeated na on the n, not on a flash of the last vowel (the mouth closes before the voice comes back)', () => {
    const x = phrase(['na', 'na'], 0.15);
    const second = Math.round(0.5 * SR); // the second note starts after 0.35 s and a 0.15 s gap
    const start = rms(x.subarray(second, second + Math.round(0.03 * SR)));
    const vowel = rms(x.subarray(second + Math.round(0.2 * SR), second + Math.round(0.3 * SR)));
    expect(db(start, vowel)).toBeLessThan(-6);
  });
});

describe('MOA-VOX: the singer with lyrics', () => {
  it('sings the next syllable on every note, legato too, round and round; an _ holds the vowel', () => {
    const v = new VoxSinger();
    const sent: { type: string; legato?: boolean; syllable?: { vowel: { tongueIndex: number } } }[] = [];
    v.circuit.onChange((c) => { if (c.type === 'message') sent.push(c.data as typeof sent[number]); });
    (v.control('lyrics') as { set(x: string): void }).set('la lee _');
    const vowels = () => sent.filter((m) => m.type === 'note').map((m) => `${m.syllable?.vowel.tongueIndex ?? 'hold'}${m.legato ? ' legato' : ''}`);
    v.keyDown(60); v.keyUp(60);
    v.keyDown(62); v.keyDown(64); v.keyUp(64); v.keyUp(62);
    v.keyDown(65); v.keyUp(65);
    // la, lee, the _ held legato, back to the held key (its pitch only), then la again
    expect(vowels()).toEqual([`${VOWEL_SHAPES.ah!.tongueIndex}`, `${VOWEL_SHAPES.ee!.tongueIndex}`, 'hold legato', 'hold legato', `${VOWEL_SHAPES.ah!.tongueIndex}`]);
    expect(v.lyricIndex).toBe(0);
  });
});

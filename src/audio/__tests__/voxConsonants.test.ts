import { describe, expect, it } from 'vitest';
import { VoxSinger } from '../../domain/devices/voxSinger';
import { fitEndings, parseLyrics, parseSyllable, VOWEL_SHAPES } from '../../domain/devices/voxPhonemes';
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
    expect(parseSyllable('shh').onset[0]!.noise).toBeGreaterThan(1); // sh is the loudest fricative
    expect(parseLyrics('la la, bay-bee').map((s) => s.text)).toEqual(['la', 'la,', 'bay', 'bee']);
    expect(parseLyrics('grandma hello baby').map((s) => s.text)).toEqual(['grand', 'ma', 'hel', 'lo', 'ba', 'by']);
    expect(parseLyrics('la _ _').map((s) => s.hold ?? false)).toEqual([false, true, true]);
    expect(show('grand')).toBe('2:ae:2');
    expect(show('by')).toBe('1:ee:0');
    expect(show('lift')).toBe('1:ih:3'); // f, then t's closure and its breath
    expect(show('up')).toBe('0:uh:2');
    expect(show('mi')).toBe('1:ee:0');
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

describe('MOA-VOX CHOIR: a backing section', () => {
  type Sent = { type: string; voice?: number; hz?: number; syllable?: { vowel: { tongueIndex: number } } };
  const section = () => {
    let t = 0;
    const v = new VoxSinger('MOA-VOX CHOIR', 3, () => t);
    const sent: Sent[] = [];
    v.circuit.onChange((c) => { if (c.type === 'message') sent.push(c.data as Sent); });
    return { v, sent, at: (ms: number) => { t = ms; } };
  };

  it('gives each note of a chord to a different singer, each keeping its part (the soprano the top line)', () => {
    const { v, sent, at } = section();
    const voiceOf = (note: number) => sent.filter((m) => m.type === 'note' && Math.round(m.hz!) === Math.round(440 * 2 ** ((note - 69) / 12))).at(-1)!.voice;
    for (const n of [60, 64, 67]) v.keyDown(n);
    expect([voiceOf(67), voiceOf(64), voiceOf(60)]).toEqual([0, 1, 2]);
    for (const n of [60, 64, 67]) v.keyUp(n);
    at(500);
    for (const n of [69, 65, 62]) v.keyDown(n); // the next chord, struck in another order
    expect([voiceOf(69), voiceOf(65), voiceOf(62)]).toEqual([0, 1, 2]);
  });

  it('sings one syllable to a chord, the next to the next chord', () => {
    const { v, sent, at } = section();
    (v.control('lyrics') as { set(x: string): void }).set('ooh ah');
    at(0); v.keyDown(60); at(10); v.keyDown(64); at(20); v.keyDown(67);
    for (const n of [60, 64, 67]) v.keyUp(n);
    at(600); v.keyDown(62); v.keyDown(65);
    const vowels = sent.filter((m) => m.type === 'note').map((m) => m.syllable!.vowel.tongueIndex);
    expect(vowels).toEqual([...Array(3).fill(VOWEL_SHAPES.oo!.tongueIndex), ...Array(2).fill(VOWEL_SHAPES.ah!.tongueIndex)]);
  });

  it('tunes its singers apart: a soprano\'s short tract to the tenor\'s, each with its own randomness', () => {
    const { v } = section();
    const config = JSON.parse(v.circuit.node('voice').options.config!) as { voices: number; lengths: number[] };
    expect(config.voices).toBe(3);
    expect(config.lengths).toEqual([14.5, 15.75, 17]);
    const { VoiceChoir } = new Function(`${VOICE_SOURCE}; return { VoiceChoir };`)() as { VoiceChoir: new (sr: number, cfg: object) => { cores: Core[]; noteOn(v: number, hz: number, i: number, l: boolean): void; process(o: Float32Array, n: number, p: { level: number }): void } };
    const choir = new VoiceChoir(SR, config);
    [0, 1, 2].forEach((k) => choir.noteOn(k, 220, 0.9, false));
    const out = new Float32Array(SR / 2);
    for (let at = 0; at < out.length; at += 128) choir.process(out.subarray(at, at + 128), 128, { level: 0.8 });
    const [a, b] = choir.cores as unknown as { drift: number; diameter: Float64Array }[];
    expect(a!.diameter.length).toBeLessThan(b!.diameter.length);
    expect(a!.drift).not.toBe(b!.drift);
    for (const x of out) expect(Number.isFinite(x) && Math.abs(x) <= 1).toBe(true);
  });
});

describe('MOA-VOX: endings sung inside the note', () => {
  it('lets a note go early enough for its last consonants before the next note, but sings on into a hold', () => {
    const notes = [{ t: 0, len: 1 }, { t: 1, len: 1 }, { t: 2, len: 1 }, { t: 3, len: 1 }];
    const fitted = fitEndings(notes, 'wahnt ah _ ah', 120); // "want" ends on n and t: about a fifth of a second
    expect(fitted[0]!.len).toBeLessThan(0.7);
    expect(fitted[1]!.len).toBe(1); // sung on into its hold
    expect(fitted[3]!.len).toBe(1); // the last: nothing after it to make room for
  });
});

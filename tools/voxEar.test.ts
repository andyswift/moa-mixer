import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { homedir, tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, it } from 'vitest';
import { endingSeconds, parseLyrics, VOWEL_SHAPES } from '../src/domain/devices/voxPhonemes';
import { VOICE_SOURCE } from '../src/audio/voiceWorklet';

/**
 * An ear for MOA-VOX, to tune its words by: phrases sung with the voice's own code, written to WAV, and heard by a
 * speech recogniser (whisper.cpp, `brew install whisper-cpp`, with its small English model in ~/.cache/whisper-cpp);
 * the word error rate against what was meant, phrase by phrase and overall. A tool, not a test: it runs only with
 * EAR=1 (`EAR=1 npx vitest run tools/voxEar.test.ts`), as it needs the recogniser and takes a while.
 */
const env = (globalThis as { process?: { env: Record<string, string | undefined> } }).process?.env ?? {};
const MODEL = join(homedir(), '.cache/whisper-cpp/ggml-small.en.bin');
const SR = 48000;

/** The phrases: what they say, and as the voice spells them. */
export const PHRASES: [string, string][] = [
  ['I want to see sun', 'ai wahnt too see suhn'],
  ['here I am at work', 'heer ai aem aet wuhrk'],
  ['carry me home', 'kae ree mee hohm'],
  ['lift me up high', 'lift mee uhp hai'],
  ['when my road is long', 'wen mai rohd iz lahng'],
  ['I will not let go', 'ai wil naht let goh'],
  ['boss wants it by Friday', 'bahs wahnts it bai frai day'],
  ['Oslo in November', 'ahz loh in noh vem buhr'],
  ['yes Lord', 'yes lohrd'],
  ['can I get a witness', 'kan ai get uh wit ness'],
  ['I sign a form again', 'ai sain uh fohrm uh gen'],
  ['shine on Oslo too', 'shain ahn ahz loh too'],
];

interface Core {
  vibDepth: number; scoop: number; glide: number; roughness: number;
  noteOn(hz: number, intensity: number, legato: boolean, syllable?: object): void; noteOff(): void;
  process(out: Float32Array, n: number, p: { level: number }): void;
}
type Style = 'speech' | 'sung';

/** Sings a phrase a syllable to a note: spoken (quick, falling pitch, no vibrato) or sung (held notes, a tune, vibrato). */
export function render(spelled: string, style: Style, source = VOICE_SOURCE): Float32Array {
  const { VoiceCore } = new Function(`${source}; return { VoiceCore };`)() as { VoiceCore: new (sr: number, cm: number) => Core };
  const v = new VoiceCore(SR, 17);
  v.vibDepth = style === 'sung' ? 30 : 0;
  v.scoop = style === 'sung' ? 40 : 15;
  v.glide = 0.05;
  const syllables = parseLyrics(spelled);
  const step = style === 'sung' ? 0.5 : 0.26;
  const out = new Float32Array(Math.round((0.3 + syllables.length * step + 0.6) * SR));
  let at = Math.round(0.3 * SR);
  const run = (seconds: number) => {
    const n = Math.round(seconds * SR);
    for (let k = 0; k < n; k += 128) v.process(out.subarray(at + k, at + Math.min(n, k + 128)), Math.min(128, n - k), { level: 0.8 });
    at += n;
  };
  const tune = [0, 2, 4, 2, 0, -1, 0, 2];
  syllables.forEach((s, k) => {
    const shape = (name: string) => ({ ...VOWEL_SHAPES[name]!, velum: 0.01, ring: 0.5 });
    const hz = style === 'sung' ? 196 * 2 ** (tune[k % tune.length]! / 12) : 125 * 2 ** (-k / syllables.length / 4);
    v.noteOn(hz, 0.85, false, { onset: s.onset, vowel: shape(s.vowel), vowel2: s.vowel2 ? shape(s.vowel2) : undefined, coda: s.coda });
    // let go early enough for the syllable's ending (a diphthong's glide, its last consonants) to fit before the next
    const ending = endingSeconds(s);
    const held = Math.max(step * 0.35, step * 0.92 - ending);
    run(held);
    v.noteOff();
    run(step - held);
  });
  run(Math.max(0, out.length / SR - at / SR - 0.01));
  return out;
}

/** 16 kHz, 16-bit mono WAV of a 48 kHz signal (averaged in threes: the voice has little above 8 kHz). */
function wav(x: Float32Array): Buffer {
  const n = Math.floor(x.length / 3), data = Buffer.alloc(n * 2);
  let peak = 1e-9;
  for (const v of x) peak = Math.max(peak, Math.abs(v));
  for (let i = 0; i < n; i++) data.writeInt16LE(Math.round((((x[3 * i]! + x[3 * i + 1]! + x[3 * i + 2]!) / 3) / peak) * 0.8 * 32767), i * 2);
  const h = Buffer.alloc(44);
  h.write('RIFF', 0); h.writeUInt32LE(36 + data.length, 4); h.write('WAVE', 8); h.write('fmt ', 12);
  h.writeUInt32LE(16, 16); h.writeUInt16LE(1, 20); h.writeUInt16LE(1, 22); h.writeUInt32LE(16000, 24); h.writeUInt32LE(32000, 28);
  h.writeUInt16LE(2, 32); h.writeUInt16LE(16, 34); h.write('data', 36); h.writeUInt32LE(data.length, 40);
  return Buffer.concat([h, data]);
}

const words = (s: string) => s.toLowerCase().replace(/[^a-z' ]/g, ' ').split(/\s+/).filter(Boolean);
/** Word error rate: the edits (substitutions, insertions, deletions) to turn what was heard into what was meant, per word meant. */
function wer(meant: string, heard: string): number {
  const a = words(meant), b = words(heard);
  const d = Array.from({ length: a.length + 1 }, (_, i) => Array.from({ length: b.length + 1 }, (_, j) => (i === 0 ? j : j === 0 ? i : 0)));
  for (let i = 1; i <= a.length; i++) for (let j = 1; j <= b.length; j++) d[i]![j] = Math.min(d[i - 1]![j]! + 1, d[i]![j - 1]! + 1, d[i - 1]![j - 1]! + (a[i - 1] === b[j - 1] ? 0 : 1));
  return d[a.length]![b.length]! / a.length;
}

/** What the recogniser hears in a phrase. */
export function hear(x: Float32Array, name: string): string {
  const dir = join(tmpdir(), 'moa-vox-ear');
  mkdirSync(dir, { recursive: true });
  const file = join(dir, `${name}.wav`);
  writeFileSync(file, wav(x));
  return execFileSync('whisper-cli', ['-m', MODEL, '-f', file, '-nt', '-np', '-l', 'en'], { encoding: 'utf8' }).trim();
}

/** Every phrase in a style, heard: the overall word error rate, and each phrase's. */
export function score(style: Style, source = VOICE_SOURCE, log = true): number {
  let errors = 0, total = 0;
  for (const [meant, spelled] of PHRASES) {
    const heard = hear(render(spelled, style, source), `${style}-${spelled.replace(/\s+/g, '_')}`);
    const e = wer(meant, heard);
    errors += e * words(meant).length;
    total += words(meant).length;
    if (log) console.log(`${style.padEnd(6)} ${(e * 100).toFixed(0).padStart(3)}%  ${meant.padEnd(24)} -> ${heard}`);
  }
  return errors / total;
}

describe.skipIf(!env.EAR || !existsSync(MODEL))('MOA-VOX, heard by a speech recogniser', () => {
  it('scores the phrases, spoken and sung', () => {
    const speech = score('speech'), sung = score('sung');
    console.log(`WER  speech ${(speech * 100).toFixed(1)}%  sung ${(sung * 100).toFixed(1)}%`);
  }, 600000);
});

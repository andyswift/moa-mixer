import type { TractShape } from './voxSinger';

/**
 * Sung syllables for MOA-VOX: the consonants as gestures of the vocal tract, the vowels as its shapes, and a small
 * notation to write a line of them in.
 *
 * A gesture is what the mouth does for a moment: a constriction somewhere along the tract (a place on Pink Trombone's
 * 44-section grid, from the throat at 0 to the lips at 39 and on), how far it closes (0 shut), the velum open or not,
 * the folds voicing or not, turbulence made at the constriction (a fricative's hiss) or at the glottis (an h, a
 * breath after p t k), and how long it lasts. The voice works the sound out from that: a closed tract is silent at
 * the lips, an open velum lets it out of the nose, air through a narrow gap hisses, and a closure let go bursts.
 */
export interface Gesture {
  /** Where the constriction is, on the 44-section grid (39 and on: the lips); -1 for none. */
  index: number;
  /** How far it closes the tract: 0 shut, about 0.2 a fricative's gap, 0.5 an approximant's. */
  diameter: number;
  /** The lips, if this gesture rounds or closes them besides (an sh, a w). */
  lips?: number;
  /** The velum's opening (0.01 shut; 0.4 open: a nasal). */
  velum: number;
  voiced: boolean;
  /**
   * How strongly the folds keep buzzing (1 unless said): behind a closed mouth with the velum shut the air has
   * nowhere to go, the pressure builds and the voicing all but stops (a b d g's closure is a faint voice bar).
   */
  voicing?: number;
  /** Turbulence made at the constriction (0..1): a fricative. */
  noise: number;
  /** Turbulence made at the glottis (0..1): an h, the breath after a p t k. */
  aspirate: number;
  /** How long, s; Infinity holds it until the note ends (a hum, a hiss). */
  dur: number;
}

type Place = 'lips' | 'teeth' | 'alveolar' | 'postalveolar' | 'palatal' | 'velar';
/** Where each place is, on the grid. */
const PLACE: Record<Place, number> = { lips: 41, teeth: 40, alveolar: 36, postalveolar: 33.5, palatal: 30, velar: 22 };

const gesture = (g: Partial<Gesture> & Pick<Gesture, 'index' | 'diameter'>): Gesture => ({ velum: 0.01, voiced: true, noise: 0, aspirate: 0, dur: 0.06, ...g });
const stop = (place: Place, voiced: boolean): Gesture[] => voiced
  ? [gesture({ index: PLACE[place], diameter: 0, voicing: 0.3, dur: 0.06 })]
  : [gesture({ index: PLACE[place], diameter: 0, voiced: false, dur: 0.07 }), gesture({ index: -1, diameter: 0, voiced: false, aspirate: 0.8, dur: 0.045 })];
const nasal = (place: Place): Gesture[] => [gesture({ index: PLACE[place], diameter: 0, velum: 0.4, dur: 0.08 })];
const fricative = (place: Place, diameter: number, voiced: boolean, lips?: number): Gesture[] =>
  [gesture({ index: PLACE[place], diameter, voiced, noise: voiced ? 0.6 : 1, lips, dur: voiced ? 0.09 : 0.11 })];
const approximant = (place: Place, diameter: number, lips?: number): Gesture[] => [gesture({ index: PLACE[place], diameter, lips, dur: 0.05 })];

/** The consonants, by how they are written: the longest first when reading. */
export const CONSONANTS: Record<string, Gesture[]> = {
  b: stop('lips', true), p: stop('lips', false),
  d: stop('alveolar', true), t: stop('alveolar', false),
  g: stop('velar', true), k: stop('velar', false),
  m: nasal('lips'), n: nasal('alveolar'), ng: nasal('velar'),
  f: fricative('teeth', 0.15, false), v: fricative('teeth', 0.15, true),
  s: fricative('alveolar', 0.12, false), z: fricative('alveolar', 0.12, true),
  sh: fricative('postalveolar', 0.25, false, 0.9),
  l: approximant('alveolar', 0.45), r: approximant('palatal', 0.6, 0.8),
  w: approximant('velar', 0.8, 0.35), y: approximant('palatal', 0.5),
  h: [gesture({ index: -1, diameter: 0, voiced: false, aspirate: 1, dur: 0.07 })],
};

/** The vowels' shapes (as the Vowel knob's five; uh, the tract at rest; ae and ih), by name. */
export const VOWEL_SHAPES: Record<string, Omit<TractShape, 'velum'>> = {
  oo: { tongueIndex: 25, tongueDiameter: 2.25, lips: 0.5 },
  oh: { tongueIndex: 19, tongueDiameter: 2.4, lips: 0.7 },
  ah: { tongueIndex: 11, tongueDiameter: 2.25, lips: 1.5 },
  eh: { tongueIndex: 28, tongueDiameter: 3.3, lips: 1.3 },
  ee: { tongueIndex: 35.5, tongueDiameter: 2.5, lips: 0.7 },
  uh: { tongueIndex: 20, tongueDiameter: 3, lips: 1.2 },
  // the a of "grand": between ah and eh; the i of "lift": between ee and eh
  ae: { tongueIndex: 19.5, tongueDiameter: 2.75, lips: 1.4 },
  ih: { tongueIndex: 31.75, tongueDiameter: 2.9, lips: 1 },
};

/** How vowels are written: each to its vowel, and for a diphthong the vowel it glides to as the note ends. */
const VOWEL_SPELLINGS: [string, string, string?][] = [
  ['ooh', 'oo'], ['aah', 'ah'], ['oo', 'oo'], ['ee', 'ee'], ['aa', 'ah'], ['ah', 'ah'], ['eh', 'eh'], ['oh', 'oh'], ['uh', 'uh'], ['ae', 'ae'], ['ih', 'ih'],
  ['ay', 'eh', 'ee'], ['ai', 'ah', 'ee'], ['oy', 'oh', 'ee'], ['ow', 'ah', 'oo'],
  ['a', 'ah'], ['e', 'eh'], ['i', 'ee'], ['o', 'oh'], ['u', 'oo'],
];
const CONSONANT_SPELLINGS = Object.keys(CONSONANTS).sort((a, b) => b.length - a.length);

/** A sung syllable: the consonants before its vowel, the vowel (and a second it glides to), the consonants after. */
export interface Syllable {
  text: string;
  onset: Gesture[];
  vowel: string;
  vowel2?: string;
  coda: Gesture[];
  /** A hold (written _): the note carries on the vowel before it, as a singer holds a syllable over several notes. */
  hold?: boolean;
}

/** A piece of a written word: a consonant, or a vowel (and the vowel a diphthong glides to), as spelled. */
type Token = { kind: 'c'; spelled: string } | { kind: 'v'; spelled: string; vowel: string; vowel2?: string };

/** Reads a word into consonants and vowels. A y ending a word after a consonant is sung ee (baby, happy). */
function tokenize(word: string): Token[] {
  const s = word.toLowerCase().replace(/[^a-z]/g, '');
  const out: Token[] = [];
  for (let i = 0; i < s.length;) {
    if (s[i] === 'y' && i === s.length - 1 && out.at(-1)?.kind === 'c') { out.push({ kind: 'v', spelled: 'y', vowel: 'ee' }); i++; continue; }
    const v = VOWEL_SPELLINGS.find(([x]) => s.startsWith(x, i));
    // a vowel spelling, unless it is a consonant's start (the y of "ya" is a consonant before the a)
    if (v && !(s[i] === 'y')) { out.push({ kind: 'v', spelled: v[0], vowel: v[1], vowel2: v[2] }); i += v[0].length; continue; }
    const c = CONSONANT_SPELLINGS.find((x) => s.startsWith(x, i));
    if (c) { out.push({ kind: 'c', spelled: c }); i += c.length; continue; }
    i++;
  }
  return out;
}

/** Two consonants that can start a syllable together (gr, bl, st, sp...): they stay with the vowel after them. */
const startsTogether = (a: string, b: string) =>
  (['r', 'l', 'w', 'y'].includes(b) && ['b', 'p', 'd', 't', 'g', 'k', 'f', 'sh'].includes(a)) || (a === 's' && ['t', 'p', 'k', 'm', 'n', 'l', 'w'].includes(b));

/**
 * Splits a word into its syllables, one to a note ("grandma": grand, ma; "hello": hel, lo): each vowel starts a new
 * one, taking the consonant before it (two, if they can start a syllable together), the rest closing the syllable
 * before.
 */
export function syllabify(word: string): string[] {
  const t = tokenize(word);
  const vowels = t.map((x, k) => (x.kind === 'v' ? k : -1)).filter((k) => k >= 0);
  if (vowels.length < 2) return [word];
  const cuts: number[] = [];
  for (let v = 1; v < vowels.length; v++) {
    const between = vowels[v]! - vowels[v - 1]! - 1;
    const at = vowels[v]!;
    if (between <= 1) cuts.push(at - between);
    else cuts.push(startsTogether(t[at - 2]!.spelled, t[at - 1]!.spelled) ? at - 2 : at - 1);
  }
  const parts: string[] = [];
  let from = 0;
  for (const cut of [...cuts, t.length]) { parts.push(t.slice(from, cut).map((x) => x.spelled).join('')); from = cut; }
  return parts;
}

/**
 * Reads a syllable as it is written: consonants, a vowel, consonants ("la", "doo", "bay", "on", "shh", "mm"). A
 * single a, i or u closing on consonants is sung short (grand, lift, up). With no vowel, a nasal is hummed and
 * a fricative hissed for the whole note; anything else unknown is sung as ah.
 */
export function parseSyllable(text: string): Syllable {
  const tokens = tokenize(text);
  const v = tokens.findIndex((x) => x.kind === 'v');
  const onset = (v < 0 ? tokens : tokens.slice(0, v)).map((x) => x.spelled);
  const coda: string[] = [];
  for (const x of v < 0 ? [] : tokens.slice(v + 1)) if (x.kind === 'c' && coda.at(-1) !== x.spelled) coda.push(x.spelled); // a doubled letter is one sound
  const gestures = (list: string[]) => list.flatMap((c) => CONSONANTS[c]!.map((g) => ({ ...g })));
  if (v < 0) {
    // no vowel: hum a nasal, hiss a fricative, for as long as the note lasts
    const held = onset.find((c) => ['m', 'n', 'ng', 's', 'sh', 'f', 'z', 'v'].includes(c)); // "hmm" hums, "shh" hisses
    if (held) {
      const g = { ...CONSONANTS[held]!.at(-1)!, dur: Infinity };
      return { text, onset: [g], vowel: held === 'm' ? 'uh' : 'eh', coda: [] };
    }
    return { text, onset: gestures(onset), vowel: 'ah', coda: [] };
  }
  const vt = tokens[v] as Extract<Token, { kind: 'v' }>;
  // a single a, i or u closing on consonants is short: the a of grand, the i of lift, the u of up
  const short: Record<string, string> = { a: 'ae', i: 'ih', u: 'uh' };
  const vowel = coda.length && short[vt.spelled] ? short[vt.spelled]! : vt.vowel;
  return { text, onset: gestures(onset), vowel, vowel2: vt.vowel2, coda: gestures(coda) };
}

/**
 * A line of lyrics, as syllables, one to a note: words split at spaces and hyphens ("la la la", "bay-bee"), and each
 * word into its syllables ("grandma": grand, ma). An _ holds the vowel before it over another note.
 */
export function parseLyrics(line: string): Syllable[] {
  return line.split(/[\s\-]+/).flatMap((w): Syllable[] => {
    if (/^_+$/.test(w)) return [...w].map(() => ({ text: '_', onset: [], vowel: 'ah', coda: [], hold: true }));
    return /[a-z]/i.test(w) ? syllabify(w).map(parseSyllable) : [];
  });
}

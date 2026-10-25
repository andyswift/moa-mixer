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
  ? [gesture({ index: PLACE[place], diameter: 0, dur: 0.06 })]
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

/** The vowels' shapes (as the Vowel knob's five, and uh: the tract at rest), by name. */
export const VOWEL_SHAPES: Record<string, Omit<TractShape, 'velum'>> = {
  oo: { tongueIndex: 25, tongueDiameter: 2.25, lips: 0.5 },
  oh: { tongueIndex: 19, tongueDiameter: 2.4, lips: 0.7 },
  ah: { tongueIndex: 11, tongueDiameter: 2.25, lips: 1.5 },
  eh: { tongueIndex: 28, tongueDiameter: 3.3, lips: 1.3 },
  ee: { tongueIndex: 35.5, tongueDiameter: 2.5, lips: 0.7 },
  uh: { tongueIndex: 20, tongueDiameter: 3, lips: 1.2 },
};

/** How vowels are written: each to its vowel, and for a diphthong the vowel it glides to as the note ends. */
const VOWEL_SPELLINGS: [string, string, string?][] = [
  ['ooh', 'oo'], ['aah', 'ah'], ['oo', 'oo'], ['ee', 'ee'], ['aa', 'ah'], ['ah', 'ah'], ['eh', 'eh'], ['oh', 'oh'], ['uh', 'uh'],
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
}

/**
 * Reads a syllable as it is written: consonants, a vowel, consonants ("la", "doo", "bay", "on", "shh", "mm"). With no
 * vowel, a nasal is hummed and a fricative hissed for the whole note; anything else unknown is sung as ah.
 */
export function parseSyllable(text: string): Syllable {
  const s = text.toLowerCase().replace(/[^a-z]/g, '');
  const onset: string[] = [], coda: string[] = [];
  let vowel: string | undefined, vowel2: string | undefined;
  let i = 0;
  const readConsonant = (): string | undefined => {
    const c = CONSONANT_SPELLINGS.find((x) => s.startsWith(x, i));
    if (c) i += c.length;
    return c;
  };
  while (i < s.length && !vowel) {
    const v = VOWEL_SPELLINGS.find(([x]) => s.startsWith(x, i));
    if (v) { vowel = v[1]; vowel2 = v[2]; i += v[0].length; break; }
    const c = readConsonant();
    if (c) onset.push(c);
    else i++;
  }
  while (i < s.length) {
    const c = readConsonant();
    if (c) { if (coda.at(-1) !== c) coda.push(c); } // a doubled letter is one sound
    else i++;
  }
  const gestures = (list: string[]) => list.flatMap((c) => CONSONANTS[c]!.map((g) => ({ ...g })));
  if (!vowel) {
    // no vowel: hum a nasal, hiss a fricative, for as long as the note lasts
    const held = onset.find((c) => ['m', 'n', 'ng', 's', 'sh', 'f', 'z', 'v'].includes(c)); // "hmm" hums, "shh" hisses
    if (held) {
      const g = { ...CONSONANTS[held]!.at(-1)!, dur: Infinity };
      return { text, onset: [g], vowel: held === 'm' ? 'uh' : 'eh', coda: [] };
    }
    return { text, onset: gestures(onset), vowel: 'ah', coda: [] };
  }
  return { text, onset: gestures(onset), vowel, vowel2, coda: gestures(coda) };
}

/** A line of lyrics, as syllables: split at spaces and hyphens ("la la la", "bay-bee"). */
export function parseLyrics(line: string): Syllable[] {
  return line.split(/[\s\-]+/).filter((w) => /[a-z]/i.test(w)).map(parseSyllable);
}

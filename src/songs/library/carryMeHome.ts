import { GAUGES, SCALES, midiToHz, tensionFor } from '../../domain/devices/bassPhysics';
import { seeded, withDynamics } from '../feel';
import { note } from '../generators';
import type { NoteEvent, Song, SungLine } from '../types';

/**
 * An original gospel song for the band, a lead singer and three backing singers (MOA-VOX and MOA-VOX CHOIR), with
 * MOA-PIPE's reed organ: a swung 4/4 at 92 bpm in A flat, call and response throughout, and the key going up a
 * semitone for the last chorus.
 *
 * Intro, Verse, Chorus, Verse′, Chorus′, Shout, Chorus″, Amen (`PLAN`).
 *
 * The verses are the lead's ("When my road is long, and my heart is low..."), the choir under them on chord pads (ooh,
 * then hummed). In the choruses the choir sings the words in three parts ("Carry me home...") and the lead answers in
 * the gaps (oh yeah, yes Lord). The shout is the call and response at its plainest, over the amen chords (IV to I):
 * the lead calls ("Can I get a witness"), the choir answers ("Yes Lord"), the kit building to a snare on every beat.
 * Then the last chorus a semitone up, and a held amen.
 *
 * The lyrics are written as the singers sing them (`voxPhonemes.ts`: "mai" for my, "hohm" for home), a syllable to a
 * note, and are made from the same lists as the notes, so each page's line of lyrics matches its notes one to one.
 */
type Section = 'intro' | 'V' | 'C' | 'S' | 'end';
const PLAN: [Section, number][] = [['intro', 4], ['V', 8], ['C', 8], ['V', 8], ['C', 8], ['S', 8], ['C', 8], ['end', 3]];

interface Bar {
  section: Section;
  /** The bar's place in its block, and which time round the section is. */
  i: number;
  n: number;
  /** Where it starts, in beats, and the key (semitones above A flat: the last chorus and the amen a semitone up). */
  start: number;
  key: number;
}
const BARS: Bar[] = [];
{
  const times = new Map<Section, number>();
  for (const [section, count] of PLAN) {
    const n = times.get(section) ?? 0;
    times.set(section, n + 1);
    const key = (section === 'C' && n === 2) || section === 'end' ? 1 : 0;
    for (let i = 0; i < count; i++) BARS.push({ section, i, n, start: BARS.length * 4, key });
  }
}
const BLOCKS = BARS.filter((bar) => bar.i === 0);
const barsOf = (block: Bar): Bar[] => BARS.slice(BARS.indexOf(block), BARS.indexOf(block) + PLAN[BLOCKS.indexOf(block)]![1]);

const KIT = { kick: 36, stick: 37, snare: 38, floor: 41, hat: 42, tom: 47, openHat: 46, crash: 49, ride: 51 } as const;

// ---- the harmony, in A flat (offsets from A flat; the key adds to them) ----

/** A chord: its root and its tones, as semitones above A flat. */
interface Chord { root: number; tones: readonly number[] }
const CH: Record<string, Chord> = {
  Ab: { root: 0, tones: [0, 4, 7] },
  Db: { root: 5, tones: [5, 9, 0] },
  Fm: { root: 9, tones: [9, 0, 4] },
  Bbm7: { root: 2, tones: [2, 5, 9, 0] },
  Eb7: { root: 7, tones: [7, 11, 2, 5] },
  Eb: { root: 7, tones: [7, 11, 2] },
};
/** Each section's chords, a bar each (two to a bar where a pair is given: the first for beats 0 to 2). */
const CHORDS: Record<Section, (string | [string, string])[]> = {
  intro: ['Ab', 'Db', 'Ab', 'Eb7'],
  V: ['Ab', 'Db', 'Ab', 'Fm', 'Bbm7', 'Eb7', 'Ab', 'Eb7'],
  C: ['Db', 'Ab', 'Fm', 'Eb', 'Db', 'Ab', ['Bbm7', 'Eb7'], 'Ab'],
  S: ['Db', 'Ab', 'Db', 'Ab', 'Db', 'Ab', 'Db', 'Ab'],
  end: ['Db', 'Ab', 'Ab'], // the last bar for the amen to ring in
};
/** The chord at a beat of a bar. */
function chordAt(bar: Bar, beat = 0): Chord {
  const c = CHORDS[bar.section][bar.i % CHORDS[bar.section].length]!;
  return CH[typeof c === 'string' ? c : beat < 2 ? c[0] : c[1]]!;
}
/** A chord's tones as notes between `low` and `high`, in the bar's key. */
function tonesIn(chord: Chord, key: number, low: number, high: number): number[] {
  const out: number[] = [];
  for (let m = low; m <= high; m++) if (chord.tones.some((t) => (((m - 56 - key - t) % 12) + 12) % 12 === 0)) out.push(m);
  return out;
}
/** A three-note chord around a middle note (the choir's pad, the organ's chord), its notes nearest the middle. */
function voicing(chord: Chord, key: number, middle: number): number[] {
  return tonesIn(chord, key, middle - 8, middle + 8).sort((a, b) => Math.abs(a - middle) - Math.abs(b - middle)).slice(0, 3).sort((a, b) => a - b);
}
/** The two parts under a top line: the chord's tones below it, the alto close under the soprano, the tenor under her. */
function harmony(top: number, chord: Chord, key: number): number[] {
  const below = tonesIn(chord, key, top - 10, top - 1).reverse();
  const alto = below[0] ?? top - 3;
  const tenor = below.find((m) => m < alto - 1) ?? alto - 4;
  return [top, alto, tenor];
}

/** A note `len` beats long at `beat` of a bar. */
const at = (bar: Bar, beat: number, len: number, pitch: number, vel: number): NoteEvent => note(bar.start + beat, len, pitch, vel);

// ---- the words and the tunes ([beat across the two bars of a line, note in A flat, length in beats, syllable]) ----

type Line = [number, number, number, string][];
/** The verse's tune, a line of it every two bars; the two verses' words. */
const VERSE_TUNE: [number, number, number][][] = [
  [[1, 60, 0.5], [1.5, 63, 0.5], [2, 65, 1], [3, 63, 1], [4, 63, 2.5]],
  [[1, 60, 0.5], [1.5, 63, 0.5], [2, 68, 1], [3, 65, 1], [4, 63, 3]],
  [[1, 63, 0.5], [1.5, 65, 0.5], [2, 68, 1], [3, 68, 1], [4, 65, 2.5]],
  [[1, 63, 0.5], [1.5, 65, 0.5], [2, 63, 1], [3, 60, 1], [4, 56, 3]],
];
const VERSE_WORDS = [
  ['wen mai rohd iz lahng', 'and mai hahrt iz loh', 'ai wil lift mai aiz', 'ai wil naht let goh'],
  ['wen aim week and wohrn', 'wen ai looz mai way', 'ai wil rayz mai voys', 'ai wil sing and pray'],
];
/** The chorus: the choir's top line (sung in three parts) and the lead's answers in its gaps. */
const CHORUS: Line[] = [
  [[0, 63, 0.5, 'kae'], [0.5, 65, 0.5, 'ree'], [1, 68, 1, 'mee'], [2, 68, 2.5, 'hohm']],
  [[0, 63, 0.5, 'kae'], [0.5, 65, 0.5, 'ree'], [1, 68, 1, 'mee'], [2, 67, 2.5, 'hohm']],
  [[0, 68, 0.5, 'lift'], [0.5, 70, 0.5, 'mee'], [1, 72, 1, 'uhp'], [2, 72, 2.5, 'hai']],
  [[0, 70, 0.5, 'aim'], [0.5, 68, 0.5, 'naht'], [1, 67, 1, 'uh'], [2, 68, 3, 'lohn']],
];
const ANSWERS: Line[] = [
  [[5, 70, 0.5, 'oh'], [5.5, 68, 2, 'yeh']],
  [[5, 70, 0.5, 'yes'], [5.5, 68, 2, 'lohrd']],
  [[5, 70, 0.5, 'oh'], [5.5, 68, 2, 'yeh']],
  [],
];
/** The shout: the lead's calls (the first bar of each pair) and the choir's answers (the second). */
const CALLS: Line[] = [
  [[0, 63, 0.5, 'kan'], [0.5, 65, 0.5, 'ai'], [1, 68, 0.5, 'get'], [1.5, 68, 0.5, 'uh'], [2, 70, 0.5, 'wit'], [2.5, 68, 1.5, 'ness']],
  [[0, 68, 0.5, 'say'], [0.5, 68, 0.5, 'it'], [1, 70, 0.5, 'uh'], [1.5, 70, 1, 'gen'], [2.5, 68, 1.5, 'now']],
  [[0, 70, 1, 'oh'], [1, 68, 0.5, 'lift'], [1.5, 68, 0.5, 'mee'], [2, 70, 2, 'uhp']],
  [[0, 68, 1, 'oh'], [1, 70, 1, 'oh'], [2, 70, 2, 'yeh']],
];
const RESPONSES: Line[] = [
  [[0, 68, 1, 'yes'], [1, 72, 2.5, 'lohrd']],
  [[0, 68, 1, 'yes'], [1, 72, 2.5, 'lohrd']],
  [[0, 68, 0.5, 'lift'], [0.5, 70, 0.5, 'mee'], [1, 72, 2.5, 'uhp']],
  [[0, 68, 1, 'yes'], [1, 72, 2.5, 'lohrd']],
];

/** The words as they read, for the band page to show (the lines above, as written). */
const VERSE_LINES = [
  ['When my road is long', 'and my heart is low', 'I will lift my eyes', 'I will not let go'],
  ['When I’m weak and worn', 'when I lose my way', 'I will raise my voice', 'I will sing and pray'],
];
const CHORUS_LINES = ['Carry me home', 'carry me home', 'lift me up high', 'I’m not alone'];
const ANSWER_LINES = ['oh yeah', 'yes Lord', 'oh yeah', ''];
const CALL_LINES = ['Can I get a witness?', 'Say it again now', 'Oh, lift me up', 'Oh, oh, yeah'];
const RESPONSE_LINES = ['Yes Lord!', 'Yes Lord!', 'Lift me up!', 'Yes Lord!'];

/** The words, a line at a time, timed as they are sung, and who sings each. */
function words(): SungLine[] {
  const out: SungLine[] = [];
  for (const bar of BARS) {
    const { section, i, n } = bar, pair = Math.floor(i / 2);
    if (section === 'V' && i % 2 === 0) out.push({ from: bar.start, to: bar.start + 8, text: VERSE_LINES[n]![pair]!, who: 'lead' });
    else if (section === 'C' && i % 2 === 0) {
      out.push({ from: bar.start, to: bar.start + 5, text: CHORUS_LINES[pair]!, who: 'choir' });
      if (ANSWER_LINES[pair]) out.push({ from: bar.start + 5, to: bar.start + 8, text: ANSWER_LINES[pair]!, who: 'lead' });
    } else if (section === 'S') out.push({ from: bar.start, to: bar.start + 4, text: (i % 2 ? RESPONSE_LINES : CALL_LINES)[pair]!, who: i % 2 ? 'choir' : 'lead' });
    else if (section === 'end' && i < 2) out.push({ from: bar.start, to: bar.start + (i ? 8 : 4), text: i ? 'A-men' : 'Ah…', who: 'everyone' });
  }
  return out;
}

/** A sung part: its notes, and the syllable of each, in the order they start (its line of lyrics). */
interface Part { notes: NoteEvent[]; words: string[] }
const sung = (): Part => ({ notes: [], words: [] });
/** Puts a sung note (or a chord, one syllable) in a part. */
function sing(part: Part, events: NoteEvent[], syllable: string): void {
  part.notes.push(...events);
  part.words.push(syllable);
}
/** A part's line of lyrics, its syllables in the order its notes start (a chord's syllable once). */
const lyricsOf = (part: Part) => part.words.join(' ');

/** The lead and the choir, and their lyrics. */
function voices(): { lead: Part; choir: Part } {
  const lead = sung(), choir = sung();
  const pad = (bar: Bar, syllable: string, vel: number) => sing(choir, voicing(chordAt(bar), bar.key, 64).map((m) => at(bar, 0, 3.8, m, vel)), syllable);
  for (const bar of BARS) {
    const { section, i, n, key } = bar;
    const pair = Math.floor(i / 2);
    if (section === 'intro') pad(bar, 'ooh', 70);
    else if (section === 'V') {
      pad(bar, n === 0 ? 'ooh' : 'hmm', 66);
      if (i % 2 === 0) {
        const words = VERSE_WORDS[n]![pair]!.split(' ');
        VERSE_TUNE[pair]!.forEach(([beat, m, len], k) => sing(lead, [at(bar, beat, len * 0.95, m + key, 96)], words[k]!));
      }
    } else if (section === 'C' && i % 2 === 0) {
      for (const [beat, top, len, syl] of CHORUS[pair]!) {
        const where = beat < 4 ? bar : BARS[BARS.indexOf(bar) + 1]!;
        sing(choir, harmony(top + key, chordAt(where, beat % 4), key).map((m) => at(bar, beat, len * 0.95, m, 92)), syl);
      }
      for (const [beat, m, len, syl] of ANSWERS[pair]!) sing(lead, [at(bar, beat, len * 0.95, m + key, 94)], syl);
    } else if (section === 'S') {
      if (i % 2 === 0) for (const [beat, m, len, syl] of CALLS[pair]!) sing(lead, [at(bar, beat, len * 0.95, m + key, 98)], syl);
      else for (const [beat, top, len, syl] of RESPONSES[pair]!) sing(choir, harmony(top + key, chordAt(bar, beat), key).map((m) => at(bar, beat, len * 0.95, m, 100)), syl);
    } else if (section === 'end' && i < 2) {
      // a-men: the IV, then the I, all of them, held into the last bar
      const top = i === 0 ? 68 : 72, syl = i === 0 ? 'ah' : 'men', len = i === 0 ? 3.8 : 7.4;
      sing(choir, harmony(top + key, chordAt(bar), key).map((m) => at(bar, 0, len, m, 100)), syl);
      sing(lead, [at(bar, 0, len, (i === 0 ? 65 : 68) + key, 100)], syl);
    }
  }
  return { lead, choir };
}

// ---- the band ----

/** The organ: the chord held each bar under the choir, swelling with the song; soft, and low enough to leave the voices room. */
function organ(): NoteEvent[] {
  const out: NoteEvent[] = [];
  for (const bar of BARS) {
    const vel = { intro: 60, V: 48, C: 58, S: 64, end: 68 }[bar.section];
    if (bar.section === 'end' && bar.i === 2) continue;
    const len = bar.section === 'end' ? (bar.i === 0 ? 3.9 : 7.4) : 3.9;
    const split = CHORDS[bar.section][bar.i % CHORDS[bar.section].length];
    if (Array.isArray(split)) {
      for (const [beat, l] of [[0, 1.9], [2, 1.9]] as const) for (const m of voicing(chordAt(bar, beat), bar.key, 55)) out.push(at(bar, beat, l, m, vel));
    } else for (const m of voicing(chordAt(bar), bar.key, 55)) out.push(at(bar, 0, len, m, vel));
  }
  return out;
}

/** The dub bass: the root on 1, the fifth on 3, a walk into the next chord on 4 (the root throughout the shout, driving). */
function dubBass(): NoteEvent[] {
  const out: NoteEvent[] = [];
  const low = (chord: Chord, key: number) => { const m = 32 + ((chord.root + key) % 12); return m > 40 ? m - 12 : m; };
  BARS.forEach((bar, k) => {
    const chord = chordAt(bar), root = low(chord, bar.key);
    if (bar.section === 'end') { if (bar.i < 2) out.push(at(bar, 0, bar.i === 0 ? 3.8 : 7.4, root, 108)); return; }
    if (bar.section === 'S') { for (let b = 0; b < 4; b += 0.5) out.push(at(bar, b, 0.4, b % 1 ? root + 12 : root, b % 1 ? 88 : 104)); return; }
    out.push(at(bar, 0, 1.4, root, 106));
    out.push(at(bar, 2, 0.9, root + 7 > 47 ? root - 5 : root + 7, 94));
    const next = BARS[k + 1];
    if (next) {
      const to = low(chordAt(next), next.key);
      out.push(at(bar, 3, 0.45, to - 2 >= 28 ? to - 2 : to + 2, 86), at(bar, 3.5, 0.45, to - 1 >= 28 ? to - 1 : to + 1, 90)); // the walk, chromatic into it
    }
  });
  return out;
}

/** The free bass: a run up into each new line (and each section), fills in the gaps; never picked hard. */
function freeBass(): NoteEvent[] {
  const out: NoteEvent[] = [];
  BARS.forEach((bar, k) => {
    const next = BARS[k + 1];
    if (!next || bar.section === 'end' || bar.i % 2 === 0) return;
    const to = 44 + ((chordAt(next).root + next.key) % 12);
    const scale = [-5, -3, -1, 0]; // up the scale to the next root
    scale.forEach((d, s) => out.push(at(bar, 3 + s / 4, 0.24, to + d, 80 + s * 4)));
    out.push(at(next, 0, 0.9, to, 92));
  });
  return out;
}

/** The guitar: the chord's top on 2 and 4, short and clean, a soft offbeat chop in the choruses and the shout. */
function guitar(): NoteEvent[] {
  const out: NoteEvent[] = [];
  const random = seeded(1957);
  for (const bar of BARS) {
    if (bar.section === 'end') { if (bar.i === 0) for (const m of voicing(chordAt(bar), bar.key, 67)) out.push(at(bar, 0, 3.8, m, 96)); continue; }
    for (const beat of [1, 3]) for (const m of voicing(chordAt(bar, beat), bar.key, 67)) out.push(at(bar, beat, 0.3, m, 92));
    if (bar.section === 'C' || bar.section === 'S') {
      for (const beat of [0.5, 1.5, 2.5, 3.5]) if (random() < 0.7) for (const m of voicing(chordAt(bar, beat), bar.key, 70).slice(1)) out.push(at(bar, beat, 0.15, m, 62));
    }
  }
  return out;
}

/** The kit: a gospel shuffle, the backbeat heavy, fills into each section; the shout building to a snare on every beat. */
function kit(): NoteEvent[] {
  const out: NoteEvent[] = [];
  const random = seeded(1958);
  const hit = (bar: Bar, beat: number, n: number, vel: number) => out.push(at(bar, beat, 0.2, n, Math.round(vel * (0.95 + 0.1 * random()))));
  const fill = (bar: Bar) => [KIT.snare, KIT.snare, KIT.tom, KIT.tom, KIT.floor, KIT.floor].forEach((n, s) => hit(bar, 2 + s / 3, n, 86 + s * 5));
  for (const bar of BARS) {
    const { section, i } = bar;
    const last = BARS[BARS.indexOf(bar) + 1]?.i === 0;
    if (section === 'end') {
      if (i === 0) { hit(bar, 0, KIT.crash, 118); hit(bar, 0, KIT.kick, 120); for (let s = 0; s < 12; s++) hit(bar, 1 + s / 4, KIT.floor, 60 + s * 4); }
      else if (i === 1) { hit(bar, 0, KIT.crash, 124); hit(bar, 0, KIT.kick, 124); hit(bar, 0, KIT.snare, 118); }
      continue;
    }
    if (section === 'intro' && i < 2) { // the cross-stick and the hats alone at first
      for (let b = 0; b < 4; b += 0.5) hit(bar, b, KIT.hat, b % 1 ? 44 : 64);
      for (const b of [1, 3]) hit(bar, b, KIT.stick, 80);
      continue;
    }
    const cymbal = section === 'C' || section === 'S' ? KIT.ride : KIT.hat;
    for (let b = 0; b < 4; b += 0.5) hit(bar, b, cymbal, b % 1 ? 52 : 80);
    if (section !== 'C' && i % 2 === 1) hit(bar, 3.5, KIT.openHat, 70);
    hit(bar, 0, KIT.kick, 112); hit(bar, 2, KIT.kick, 104);
    if (random() < 0.5) hit(bar, 1.5, KIT.kick, 84);
    if (section === 'S' && i >= 4) {
      for (const b of [0, 1, 2, 3]) { hit(bar, b, KIT.snare, 100 + (i - 4) * 5); hit(bar, b, KIT.kick, 110); } // the shout: every beat
      hit(bar, 0, KIT.crash, 110);
      continue;
    }
    hit(bar, 1, KIT.snare, 112);
    if (last && section !== 'intro') fill(bar);
    else { hit(bar, 3, KIT.snare, 114); if (random() < 0.4) hit(bar, 2.5, KIT.snare, 30); }
    if (i === 0) hit(bar, 0, KIT.crash, 110);
    if (last && section === 'intro') for (let s = 0; s < 4; s++) hit(bar, 3 + s / 4, KIT.snare, 70 + s * 10);
  }
  return out;
}

// ---- the whole ----

const NAMES = ['Intro', 'Verse', 'Chorus', 'Verse′', 'Chorus′', 'Shout', 'Chorus″', 'Amen'];
const HEAT = [0.1, 0.3, 0.5, 0.35, 0.55, 0.75, 0.7, 0.6];

/** How loud the band plays at a beat (1 as written): each block's level, the shout building, every phrase swelling into its last bar. */
function level(beat: number): number {
  const k = Math.min(BARS.length - 1, Math.floor(beat / 4));
  const bar = BARS[k]!;
  const block = BLOCKS.filter((b) => b.start <= bar.start).length - 1;
  const through = (beat - bar.start) / 4;
  const base = [0.8, 0.82, 0.96, 0.86, 1, 0.9 + (0.2 * bar.i) / 7, 1.1, 1.08][block]!;
  const p = bar.i % 4, last = BARS[k + 1]?.i === 0;
  return base * ([1, 0.94, 0.96, 0.98][p]! + (p === 3 || last ? 0.08 * through : 0));
}

export function carryMeHome(): Song {
  const { lead, choir } = voices();
  const flat = (name: keyof typeof GAUGES) => Math.round(tensionFor({ ...GAUGES[name], winding: 'flat' }, SCALES.long, midiToHz(GAUGES[name].note)) * 10) / 10;
  return {
    id: 'carry-me-home',
    title: 'Carry Me Home',
    artist: 'The MOA Band',
    bpm: 92,
    key: 'A flat major',
    bars: BARS.length,
    beatsPerBar: 4,
    sleeve: { art: 'sunrise', colors: ['#2a1d12', '#ffd25e', '#e8742c', '#f1eee6'] },
    band: ['guitar', 'kit', 'bass', 'bass2', 'vox', 'choir', 'pipe', 'reverb', 'delay'],
    inputs: { ch1: 'MOA-BASS', ch2: 'MOA-BASS 2', ch3: 'MOA-GUITAR', ch4: 'MOA-VOX', ch5: 'MOA-VOX CHOIR', line1: 'MOA-KIT', line4: 'MOA-PIPE' },
    setup: {
      // the lead: a tenor, a gospel singer's scoops, ring and vibrato
      vox: { vox: { controls: {
        lyrics: lyricsOf(lead), size: 17, tension: 0.62, breath: 0.2, roughness: 0.35, ring: 0.65,
        'vibrato.depth': 35, 'vibrato.rate': 5.3, 'vibrato.delay': 0.3, scoop: 55, onset: 0.55, glide: 0.08, attack: 0.06, release: 0.2, level: 0.9,
      } } },
      // the backing three: softer, less vibrato, slower in, the pads swelling
      choir: { vox: { controls: {
        lyrics: lyricsOf(choir), size: 17, tension: 0.5, breath: 0.28, roughness: 0.3, ring: 0.55,
        'vibrato.depth': 20, 'vibrato.rate': 5.2, 'vibrato.delay': 0.4, scoop: 25, onset: 0.4, glide: 0.06, attack: 0.12, release: 0.3, level: 0.9,
      } } },
      pipe: { pipe: { preset: 10 } }, // Reed Organ
      guitar: { guitar: { controls: {
        'pickup.select': 'middle+neck', 'pickup.type': 'single', tone: 9, 'pluck.style': 'pick', 'pluck.position': 0.12, 'pluck.strength': 0.45,
        strum: 'down', 'strum.time': 6, 'drive.mix': 0, 'chorus.mix': 0.2, 'amp.gain': 0.22, 'amp.treble': 2, 'cab.type': '2x12', level: 0.6,
      } } },
      bass: { bass: { controls: {
        'string.winding': 'flat', 'E.tension': flat('E'), 'A.tension': flat('A'), 'D.tension': flat('D'), 'G.tension': flat('G'),
        'pluck.style': 'finger', 'pluck.position': 0.15, 'pluck.strength': 0.55, tone: 1500, 'amp.bass': 3, 'amp.treble': -4, 'cab.type': '8x10', level: 0.9,
      } } },
      bass2: { bass: { controls: { 'drive.mix': 0, 'pluck.style': 'finger', 'pluck.position': 0.1, tone: 4000, 'amp.mid': 3, level: 0.8 } } },
      kit: { kit: { controls: { 'snare.wires': 0.5 } } },
      // a church: a large room, the voices well into it; a touch of echo on the lead
      reverb: { reverb: { controls: { 'reverb.size': 'large', 'reverb.lowcut': 250, 'reverb.damp': 6000, 'reverb.predelay': 30 } } },
      delay: { delay: { controls: { 'delay.time': 489, 'delay.feedback': 0.25, 'delay.tone': 3000, 'delay.wobble': 0.05 } } },
      mixer: { mixer: { controls: {
        'ch1.fader': 0.55, 'ch1.pan': 0.15, 'ch1.aux1': 0.05,
        'ch2.fader': 0.3, 'ch2.pan': 0.4, 'ch2.aux1': 0.1,
        'ch3.fader': 0.18, 'ch3.pan': -0.5, 'ch3.aux1': 0.15,
        // the voices on top (the lead 3.5 dB up, the choir 4 after a listen), the organ well under them (12 dB down)
        'ch4.fader': 1.2, 'ch4.pan': 0, 'ch4.aux1': 0.3, 'ch4.aux2': 0.08,
        'ch5.fader': 0.95, 'ch5.pan': -0.15, 'ch5.aux1': 0.4,
        'line1.fader': 1.3, 'line1.aux1': 0.12,
        'line4.fader': 0.09, 'line4.pan': 0.3, 'line4.aux1': 0.1,
        'ret1.fader': 0.9, 'ret2.fader': 0.6,
      } } },
    },
    tracks: {
      vox: withDynamics(lead.notes, (b) => 0.5 + 0.5 * level(b), 127),
      choir: withDynamics(choir.notes, (b) => 0.5 + 0.5 * level(b), 127),
      pipe: withDynamics(organ(), level),
      guitar: withDynamics(guitar(), level),
      kit: withDynamics(kit(), level),
      bass: withDynamics(dubBass(), level),
      bass2: withDynamics(freeBass(), level, 100),
    },
    automation: [],
    sections: BLOCKS.map((block, k) => ({ name: NAMES[k]!, from: block.start, to: block.start + barsOf(block).length * 4, meter: '4/4', heat: HEAT[k]! })),
    words: words(),
    // the shuffle: every offbeat eighth late, the whole band together
    swung: [{ from: 0, to: BARS.length * 4, amount: 64, grid: 8 }],
    humanise: { timing: { kit: 4, bass: 6, bass2: 6, guitar: 5, pipe: 8, vox: 6, choir: 10 }, velocity: 0.05, layback: { kit: { 38: 6 } } },
  };
}

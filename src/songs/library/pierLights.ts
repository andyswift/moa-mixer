import { GAUGES, SCALES, midiToHz, tensionFor } from '../../domain/devices/bassPhysics';
import { seeded, withDynamics } from '../feel';
import { note } from '../generators';
import type { Automation, NoteEvent, Song, SungLine } from '../types';

/**
 * An original jangle-pop song for two basses, a guitar, a drum kit and a singer (working title): bright and quick, the
 * chords changing nearly every bar. MOA-VOX sings, a baritone crooner, lazy behind the beat, scooping into long held
 * notes that turn up and over at the ends of lines (Oslo in November, a form to sign, the Solomon Islands' sun); the
 * guitar picks across open-string chords (the open B and E ringing on top of every shape); the free bass runs a
 * melodic line under the singer; the dub bass holds the roots and walks into each chord; the kit drives. 132 bpm, A
 * major, all in 4/4.
 *
 * Played, not sequenced: the guitar picks from a handful of figures bar by bar (space in them, dyads let ring, muted
 * scratches between, a run into each new section, now and then a note left out), the kit's hats, ghost notes, kicks
 * and fills vary, and the whole band follows one dynamics curve (`level`): each section its level, every four-bar
 * phrase swelling into its last bar, the second verse dropping back, the bridge building to a stop before the last
 * chorus, the outro fading. The band swings the sixteenths a little, together.
 *
 * Intro, Verse, Chorus, Verse′, Chorus′, Bridge, Chorus″, Outro, a last chord (`PLAN`).
 *
 * Intro: the guitar alone, then the band. Verse: A F#m D E A C#m D E. Chorus: D E C#m F#m D E A, the guitar strumming,
 * the tune higher, the kit on the ride. Bridge: Bm E F#m D E, the guitar taking the tune in octaves over the floor tom
 * and a cross-stick, to a stop. The Outro rings out on A and F#m.
 */
type Section = 'intro' | 'V' | 'C' | 'M' | 'O' | 'end';
const PLAN: [Section, number][] = [['intro', 8], ['V', 16], ['C', 8], ['V', 16], ['C', 8], ['M', 8], ['C', 8], ['O', 8], ['end', 2]];

interface Bar {
  section: Section;
  /** The bar's place in its block, from 0. */
  i: number;
  /** Which time round this section is (0 the first time it is played). */
  n: number;
  /** Whether it is its block's last bar, and the section that comes next. */
  last: boolean;
  next?: Section;
  /** Where it starts, in beats. */
  start: number;
}
const BARS: Bar[] = [];
{
  const times = new Map<Section, number>();
  PLAN.forEach(([section, count], k) => {
    const n = times.get(section) ?? 0;
    times.set(section, n + 1);
    for (let i = 0; i < count; i++) BARS.push({ section, i, n, last: i === count - 1, next: PLAN[k + 1]?.[0], start: BARS.length * 4 });
  });
}
/** Each block's first bar: where the band changes section. */
const BLOCKS = BARS.filter((bar) => bar.i === 0);
/** A block's bars. */
const barsOf = (block: Bar): Bar[] => BARS.slice(BARS.indexOf(block), BARS.indexOf(block) + PLAN[BLOCKS.indexOf(block)]![1]);

/** A note `len` eighths long at eighth `at` of a bar (or several, for a chord or a double-stop). */
function play(out: NoteEvent[], bar: Bar, at: number, pitches: number | readonly number[], len: number, vel: number): void {
  for (const p of typeof pitches === 'number' ? [pitches] : pitches) out.push(note(bar.start + at / 2, len / 2, p, vel));
}
/** A muted note: the string touched, not let ring (soft enough to be played dead: a pitchless chk). */
const scratch = (out: NoteEvent[], bar: Bar, at: number, n: number) => play(out, bar, at, n, 0.12, 34);

const KIT = { kick: 36, stick: 37, snare: 38, floor: 41, hat: 42, pedal: 44, tom: 47, openHat: 46, crash: 49, ride: 51, bell: 53 } as const;

// ---- the band's dynamics ----

/**
 * How loud the band plays at a beat (1 as written): the section's level (the second verse dropping back and building
 * again, the bridge growing, the last chorus biggest, the outro fading), every four-bar phrase easing off after its
 * first bar and swelling through its last, more so into a chorus.
 */
function level(beat: number): number {
  const bar = BARS[Math.min(BARS.length - 1, Math.floor(beat / 4))]!;
  const { section, i, n } = bar;
  const through = (beat - bar.start) / 4;
  const base = {
    intro: i < 4 ? 0.88 : 0.84,
    V: n === 0 ? 0.86 : i < 4 ? 0.74 : 0.74 + (0.14 * i) / 15,
    C: [1, 1.03, 1.08][n] ?? 1,
    M: i === 7 ? 1.05 : 0.72 + (0.28 * i) / 7,
    O: 0.92 - (0.4 * (i + through)) / 8,
    end: 0.9,
  }[section];
  const p = i % 4;
  const phrase = [1, 0.93, 0.96, 0.98][p]! + (p === 3 ? through * (bar.next === 'C' && bar.last ? 0.16 : 0.08) : 0);
  return base * phrase;
}

// ---- the harmony ----

type Chord = 'A' | 'Bm' | 'C#m' | 'D' | 'E' | 'F#m';
/** A major's notes, as pitch classes. */
const KEY = new Set([9, 11, 1, 2, 4, 6, 8]);
/** A note moved down into the key if it is not in it. */
const inKey = (n: number): number => (KEY.has(((n % 12) + 12) % 12) ? n : n - 1);
/**
 * Each chord: the guitar's open-string voicing (the open B and E ringing on top wherever the shape allows), the free
 * bass's root (mid register) and its third, and the dub bass's root (low).
 */
const CHORDS: Record<Chord, { voicing: readonly number[]; root: number; third: number; low: number }> = {
  A: { voicing: [45, 52, 57, 59, 64], root: 45, third: 4, low: 33 }, // Aadd9: x02200
  'F#m': { voicing: [42, 49, 54, 59, 64], root: 42, third: 3, low: 30 }, // F#m11: 244x00
  D: { voicing: [50, 57, 62, 64, 66], root: 50, third: 4, low: 38 }, // Dadd9
  E: { voicing: [40, 47, 52, 56, 59, 64], root: 52, third: 4, low: 28 }, // open E
  'C#m': { voicing: [49, 56, 61, 64, 68], root: 49, third: 3, low: 37 },
  Bm: { voicing: [47, 54, 57, 62, 64], root: 47, third: 3, low: 35 }, // Bm7add11: x24230
};
/** Each section's chords, a bar each. */
const PROGRESSION: Record<Section, Chord[]> = {
  intro: ['A', 'F#m', 'D', 'E'],
  V: ['A', 'F#m', 'D', 'E', 'A', 'C#m', 'D', 'E'],
  C: ['D', 'E', 'C#m', 'F#m', 'D', 'E', 'A', 'A'],
  M: ['Bm', 'Bm', 'E', 'E', 'F#m', 'F#m', 'D', 'E'],
  O: ['A', 'F#m'],
  end: ['A'],
};
const chordOf = (bar: Bar): Chord => {
  const p = PROGRESSION[bar.section];
  return p[bar.i % p.length]!;
};
const nextChord = (bar: Bar): Chord => {
  const k = BARS.indexOf(bar);
  return k + 1 < BARS.length ? chordOf(BARS[k + 1]!) : 'A';
};

// ---- the guitar's figures ----

/**
 * A bar of picking, in sixteenths: [sixteenth, which of the voicing's top five notes (0 the lowest; several for a
 * dyad), length in sixteenths, accent], and where the muted scratches go between.
 */
interface Figure {
  notes: [number, number | number[], number, number][];
  scratches: number[];
}
const FIGURES: Record<'roll' | 'ring' | 'drive' | 'sparse' | 'run', Figure> = {
  // rolling across the strings with gaps, the bass note held
  roll: { notes: [[0, 0, 4, 1], [2, 2, 2, 0.75], [3, 4, 3, 0.85], [5, 3, 1, 0.6], [6, [2, 3], 2, 0.8], [8, 1, 4, 0.9], [10, 4, 2, 0.7], [11, 3, 3, 0.75], [14, 2, 2, 0.65], [15, 4, 1, 0.6]], scratches: [7, 13] },
  // dyads let ring, single notes picked between
  ring: { notes: [[0, [0, 2], 6, 1], [3, 4, 3, 0.75], [6, 3, 2, 0.7], [8, 1, 3, 0.85], [10, [3, 4], 4, 0.9], [13, 2, 1, 0.55], [14, 3, 2, 0.7]], scratches: [5, 12] },
  // busier, pushing the off-beats
  drive: { notes: [[0, 0, 2, 1], [1, 2, 1, 0.6], [2, 4, 2, 0.8], [3, 3, 1, 0.55], [4, 1, 2, 0.85], [6, 4, 2, 0.8], [7, 2, 1, 0.5], [8, 0, 2, 0.95], [9, 2, 1, 0.55], [10, 4, 3, 0.85], [12, 3, 2, 0.7], [14, [2, 4], 2, 0.8]], scratches: [5] },
  // dropped back: a chord let ring, a few notes over it
  sparse: { notes: [[0, [0, 3, 4], 8, 0.9], [6, 4, 2, 0.6], [8, 2, 4, 0.75], [11, 3, 2, 0.6], [14, 4, 2, 0.7]], scratches: [4, 12] },
  // into a new section: up the strings, then the top three together
  run: { notes: [[0, 0, 2, 0.9], [2, 1, 2, 0.7], [4, 2, 2, 0.75], [6, 3, 2, 0.8], [8, 4, 2, 0.85], [10, 3, 1, 0.6], [11, 4, 1, 0.7], [12, [2, 3, 4], 4, 1]], scratches: [] },
};
/** The usual order of figures through a four-bar phrase. */
const PHRASE: (keyof typeof FIGURES)[] = ['roll', 'ring', 'roll', 'drive'];

/**
 * The chorus's strumming, a bar of eighths each way round: [eighth, the full chord or its top three strings, length in
 * eighths, accent], and where the scratches go.
 */
const STRUMS: { notes: [number, 'full' | 'top', number, number][]; scratches: number[] }[] = [
  { notes: [[0, 'full', 1.5, 1], [1.5, 'top', 0.5, 0.6], [3, 'full', 1, 0.88], [4, 'top', 1, 0.62], [6, 'full', 1.5, 0.82], [7.5, 'top', 0.5, 0.55]], scratches: [2, 5] },
  { notes: [[0, 'full', 2, 1], [2, 'top', 1, 0.65], [3, 'full', 1.5, 0.85], [5, 'top', 0.5, 0.55], [5.5, 'full', 1, 0.8], [7, 'top', 1, 0.65]], scratches: [4.5] },
];
/** The guitar's melody in the Bridge, in octaves, a figure per two bars: [eighth, note, length in eighths]. */
const OCTAVES_M: [number, number, number][][] = [
  [[0, 66, 3], [3, 69, 1], [4, 71, 4], [8, 69, 2], [10, 66, 2], [12, 64, 4]], // Bm
  [[0, 68, 4], [4, 71, 2], [6, 68, 2], [8, 64, 8]], // E
  [[0, 69, 3], [3, 68, 1], [4, 66, 4], [8, 61, 4], [12, 64, 4]], // F#m
  [[0, 66, 4], [4, 62, 4]], // D (then the stop)
];

// ---- the song (MOA-VOX, a crooner): [beat in the line, note, length in beats, '_' to hold the syllable before] ----

type Sung = [number, number, number, '_'?][];
/** The verse, a line every four bars: long notes, held, the second and fourth lines turning up and over at their ends. */
const VERSE_SONG: Sung[] = [
  [[0.5, 57, 1.5], [2, 61, 1.5], [4, 59, 1], [5, 57, 1], [6, 54, 2], [8, 52, 6]],
  [[0.5, 57, 1.5], [2, 59, 1.5], [4, 61, 2], [6, 59, 1], [8, 57, 4.1], [12, 64, 2.1, '_'], [14, 61, 1.8, '_']],
  [[0.5, 57, 1], [1.5, 59, 1.5], [3, 61, 1], [4, 64, 1.5], [5.5, 62, 1.5], [8, 61, 6]],
  [[0.5, 59, 1], [1.5, 57, 1.5], [3, 56, 1], [4, 54, 2], [8, 57, 4.1], [12, 52, 3.5, '_']],
];
/** The words, written as sung (`voxPhonemes.ts`), a syllable to each note that is not a hold. */
const VERSE_WORDS = [
  ['ahz loh in noh vem buhr', 'gray ahn ev ree street', 'ai sain uh fohrm uh gen', 'aend ai dreem uhv suhn'],
  ['suhn ahn sah loh muhn saendz', 'heer ai aem aet wuhrk', 'bahs wahnts it bai frai day', 'ai wahnt too see suhn'],
];
/** The chorus, a line every two bars, up to the F sharp on "sun". */
const CHORUS_SONG: Sung[] = [
  [[0, 62, 1.5], [1.5, 64, 1], [2.5, 62, 1.5], [4, 64, 1], [5, 66, 3]],
  [[0, 64, 1.5], [1.5, 61, 1.5], [3, 59, 1], [4, 57, 1], [5, 54, 3]],
  [[0, 62, 1], [1, 64, 1], [2, 62, 1], [3, 66, 1.5], [4.5, 64, 1], [5.5, 64, 2.5]],
  [[0, 61, 1], [1, 62, 1], [2, 61, 1], [3, 59, 1.5], [4.5, 57, 1], [5.5, 57, 2.5]],
];
const CHORUS_WORDS = ['oh sah loh muhn suhn', 'shain ahn ahz loh too', 'aim fahr too payl too stay', 'aend fahr too pohr too goh'];
/** The same words as they read. */
const VERSE_LINES = [
  ['Oslo in November', 'grey on every street', 'I sign a form again', 'and I dream of sun'],
  ['Sun on Solomon sands', 'here I am at work', 'Boss wants it by Friday', 'I want to see sun'],
];
const CHORUS_LINES = ['Oh, Solomon sun', 'shine on Oslo too', 'I’m far too pale to stay', 'and far too poor to go'];

/** The words as they read, a line at a time, timed as the singer sings them. */
function words(): SungLine[] {
  const out: SungLine[] = [];
  for (const block of BLOCKS) {
    if (block.section === 'V') VERSE_LINES[block.n]!.forEach((text, k) => out.push({ from: block.start + 16 * k, to: block.start + 16 * (k + 1), text }));
    else if (block.section === 'C') CHORUS_LINES.forEach((text, k) => out.push({ from: block.start + 8 * k, to: block.start + 8 * (k + 1), text }));
    else if (block.section === 'O') for (const k of [0, 1]) out.push({ from: block.start + 16 * k, to: block.start + 16 * k + 12, text: 'Oslo…' });
  }
  return out;
}
/** The outro: the city's name, twice, let ring. */
const OUTRO_SONG: Sung = [[0.5, 57, 1.5], [2, 61, 6]];

/**
 * The singer's notes and his line of lyrics, made together so they match one to one: a syllable to a note, an _ to a
 * held one (sung legato from the note before, which it overlaps). He sits behind the beat, a crooner's lazy phrasing.
 */
function singer(): { notes: NoteEvent[]; lyrics: string } {
  const notes: NoteEvent[] = [], words: string[] = [];
  const lazy = 0.12;
  const sing = (from: number, line: Sung, text: string, vel: number) => {
    const syllables = text.split(' ');
    let k = 0;
    for (const [beat, m, len, hold] of line) {
      notes.push(note(from + beat + lazy, len, m, hold ? vel - 4 : vel));
      words.push(hold ? '_' : syllables[k++]!);
    }
  };
  for (const block of BLOCKS) {
    if (block.section === 'V') VERSE_SONG.forEach((line, k) => sing(block.start + 16 * k, line, VERSE_WORDS[block.n]![k]!, 88));
    else if (block.section === 'C') CHORUS_SONG.forEach((line, k) => sing(block.start + 8 * k, line, CHORUS_WORDS[k]!, 96));
    else if (block.section === 'O') for (const k of [0, 1]) sing(block.start + 16 * k, OUTRO_SONG, 'ahz loh', 84);
  }
  return { notes, lyrics: words.join(' ') };
}

function guitar(): NoteEvent[] {
  const out: NoteEvent[] = [];
  const random = seeded(1983);
  /** A bar of picking: the figure's notes on the chord, a quiet one now and then left out, the accents not quite even. */
  const pick = (bar: Bar, figure: Figure, soft: number) => {
    const voicing = CHORDS[chordOf(bar)].voicing;
    const string = (k: number) => voicing[k + voicing.length - 5]!;
    for (const [s, which, len, accent] of figure.notes) {
      if (accent < 0.7 && random() < 0.15) continue;
      const vel = Math.round(80 * accent * soft * (0.93 + 0.14 * random()));
      play(out, bar, s / 2, typeof which === 'number' ? string(which) : which.map(string), len / 2, vel);
    }
    for (const s of figure.scratches) scratch(out, bar, s / 2, string(3));
  };
  for (const bar of BARS) {
    const { section, i, n } = bar;
    if (section === 'intro' || section === 'V' || section === 'O') {
      let figure = FIGURES[PHRASE[i % 4]!];
      if (bar.last && section !== 'O') figure = FIGURES.run;
      else if (section === 'V' && n === 1 && i < 4) figure = FIGURES.sparse; // the band dropping back
      else if (random() < 0.3) figure = FIGURES[(['roll', 'ring', 'drive'] as const)[Math.floor(random() * 3)]!];
      pick(bar, figure, section === 'O' ? 0.95 : 1);
    } else if (section === 'C') {
      const voicing = CHORDS[chordOf(bar)].voicing;
      const strum = STRUMS[(i + (random() < 0.25 ? 1 : 0)) % 2]!;
      for (const [e, which, len, accent] of strum.notes) {
        play(out, bar, e, which === 'full' ? voicing : voicing.slice(-3), len, Math.round(88 * accent * (0.94 + 0.12 * random())));
      }
      for (const e of strum.scratches) scratch(out, bar, e, voicing.at(-2)!);
    } else if (section === 'M') {
      if (i === 7) play(out, bar, 0, CHORDS.E.voicing, 3, 100); // the stop: one chord, let ring
      else if (i % 2 === 0) for (const [e, p, len] of OCTAVES_M[i / 2]!) play(out, bar, e, [p, p + 12], len, e === 0 ? 96 : 88);
    } else if (i === 0) {
      play(out, bar, 0, CHORDS.A.voicing, 15, 92); // the last chord, strummed and left to ring
    }
  }
  return out;
}

function dubBass(): NoteEvent[] {
  const out: NoteEvent[] = [];
  for (const bar of BARS) {
    const { section, i, n } = bar;
    const low = CHORDS[chordOf(bar)].low;
    if (section === 'intro' && i < 4) continue;
    if (section === 'end') {
      if (i === 0) play(out, bar, 0, low, 15, 104);
    } else if (section === 'M' && i === 7) {
      play(out, bar, 0, low, 2, 108); // the stop
    } else if (section === 'V' && n === 1 && i < 4) {
      for (const e of [0, 4]) play(out, bar, e, low, 3.8, e === 0 ? 100 : 88); // dropped back to half notes
    } else {
      // the root on the beats; into a new chord, a step from below (from above onto the low E); else an octave pop
      for (const e of [0, 2, 4]) play(out, bar, e, low, 1.8, e === 0 ? 104 : 90);
      play(out, bar, 6, low, 1, 90);
      const next = CHORDS[nextChord(bar)].low;
      play(out, bar, 7, next === low ? low + 12 : next - 1 < 28 ? inKey(next + 2) : inKey(next - 1), 0.5, 88);
    }
  }
  return out;
}

/**
 * The free bass, under the singer: a melodic line through each chord, quarters in the verses (eighths, climbing, in
 * the choruses), each bar stepping into the next chord; half notes where the band drops back; never picked hard (a
 * bass picked hard by the bridge goes sharp).
 */
function freeBass(): NoteEvent[] {
  const out: NoteEvent[] = [];
  /** Steps through the chord: root, third, fifth, octave, ninth. */
  const LINES = { verse: [0, 2, 3, 2], chorus: [[3, 2, 4, 3, 1, 2, 0], [3, 4, 3, 2, 3, 1, 2]] };
  for (const bar of BARS) {
    const { section, i, n } = bar;
    const c = CHORDS[chordOf(bar)];
    const tones = [c.root, c.root + c.third, c.root + 7, c.root + 12, inKey(c.root + 14)];
    const next = CHORDS[nextChord(bar)];
    const step = next === c ? tones[2]! : inKey(next.root - 1);
    if (section === 'V' && n === 1 && i < 4) {
      for (const e of [0, 4]) play(out, bar, e, tones[e ? 2 : 0]!, 3.6, 76);
    } else if (section === 'V' || (section === 'O' && i < 6) || section === 'intro' && i >= 4) {
      LINES.verse.forEach((k, q) => play(out, bar, q * 2, q === 3 ? step : tones[k]!, 1.8, q === 0 ? 84 : 76));
    } else if (section === 'C') {
      LINES.chorus[i % 2]!.forEach((k, e) => play(out, bar, e, tones[k]!, 0.9, e === 0 ? 88 : e % 2 ? 76 : 82));
      play(out, bar, 7, step, 0.9, 80);
    } else if (section === 'M') {
      if (i === 7) play(out, bar, 0, c.root, 2, 92);
      else for (const [e, s2, len] of [[0, 0, 2], [2, 7, 2], [4, 12, 2], [6, 7, 1.5]] as const) play(out, bar, e, c.root + s2, len, e === 0 ? 86 : 78);
    } else if (section === 'end' && i === 0) {
      play(out, bar, 0, c.root + 7, 15, 84);
    }
  }
  return out;
}

function kit(): NoteEvent[] {
  const out: NoteEvent[] = [];
  const random = seeded(1984);
  const hit = (bar: Bar, e: number, n: number, vel: number) => play(out, bar, e, n, 0.4, Math.round(vel * (0.95 + 0.1 * random())));
  /** A fill on the last two beats, one of three. */
  const fill = (bar: Bar) => {
    const shapes = [
      [KIT.snare, KIT.snare, KIT.tom, KIT.tom, KIT.floor, KIT.floor, KIT.snare, KIT.snare],
      [KIT.snare, 0, KIT.snare, KIT.tom, KIT.tom, KIT.floor, KIT.floor, KIT.kick],
      [KIT.tom, KIT.tom, KIT.floor, KIT.floor, KIT.snare, KIT.snare, KIT.snare, KIT.snare],
    ];
    shapes[Math.floor(random() * 3)]!.forEach((n, s) => { if (n) hit(bar, 4 + s / 2, n, 82 + s * 4); });
  };
  /**
   * The drive: eighths on the hats (or the ride), leaned on the beat, a sixteenth skip here and there; the kick on 1,
   * the and of 2 and 3 (now and then pushing into the next bar), the backbeat hard with ghost notes round it. Dropped
   * back, a cross-stick for the backbeat and the hats lighter.
   */
  const drive = (bar: Bar, cymbal: number, filled: boolean, light = false) => {
    for (let e = 0; e < (filled ? 4 : 8); e++) {
      if (cymbal === KIT.hat && e === 7 && bar.i % 2 === 1) hit(bar, e, KIT.openHat, 74);
      else hit(bar, e, cymbal, (e % 2 === 0 ? 82 : 56) * (light ? 0.8 : 1));
      if (cymbal === KIT.hat && e % 2 === 1 && random() < 0.15) hit(bar, e + 0.5, KIT.hat, 36);
    }
    hit(bar, 0, KIT.kick, 110); hit(bar, 3, KIT.kick, 90); hit(bar, 4, KIT.kick, 104);
    if (!filled && random() < 0.3) hit(bar, 7.5, KIT.kick, 84);
    const back = light ? KIT.stick : KIT.snare;
    hit(bar, 2, back, light ? 90 : 106);
    if (filled) return fill(bar);
    hit(bar, 6, back, light ? 92 : 110);
    if (!light) {
      hit(bar, 5.5, KIT.snare, 30);
      if (random() < 0.4) hit(bar, random() < 0.5 ? 1.5 : 3.5, KIT.snare, 26);
    }
  };
  for (const bar of BARS) {
    const { section, i, n } = bar;
    if (section === 'intro') {
      if (i === 3) for (let s = 0; s < 4; s++) hit(bar, 6 + s / 2, KIT.snare, 70 + s * 10); // a pick-up into the band
      else if (i >= 4) drive(bar, KIT.hat, bar.last);
      if (i === 4) hit(bar, 0, KIT.crash, 108);
    } else if (section === 'V') {
      drive(bar, KIT.hat, i % 8 === 7, n === 1 && i < 4);
      if (i === 0 || (n === 1 && i === 4)) hit(bar, 0, KIT.crash, 104);
    } else if (section === 'C') {
      drive(bar, KIT.ride, bar.last);
      if (i % 2 === 0) hit(bar, 0, KIT.crash, i === 0 ? 114 : 100);
    } else if (section === 'M') {
      if (i === 7) {
        // the stop: one hit with the band, then the snare picks up into the last chorus
        hit(bar, 0, KIT.kick, 116); hit(bar, 0, KIT.crash, 112);
        for (let s = 0; s < 4; s++) hit(bar, 6 + s / 2, KIT.snare, 64 + s * 12);
        continue;
      }
      // the floor tom driving eighths, the kick under it, a cross-stick for the backbeat
      for (let e = 0; e < 8; e++) hit(bar, e, KIT.floor, e % 2 ? 60 : 80);
      hit(bar, 0, KIT.kick, 106); hit(bar, 3, KIT.kick, 90); hit(bar, 4, KIT.kick, 102);
      for (const e of [2, 6]) hit(bar, e, KIT.stick, 94);
    } else if (section === 'O') {
      drive(bar, KIT.hat, false, i >= 4);
      if (i === 0) hit(bar, 0, KIT.crash, 104);
    } else if (i === 0) {
      hit(bar, 0, KIT.kick, 120); hit(bar, 0, KIT.crash, 118);
    }
  }
  return out;
}

/** How heavy each block is: never all out (the guitarist stays calm), building through the choruses. */
const HEAT: number[] = [0.1, 0.35, 0.55, 0.4, 0.6, 0.45, 0.7, 0.3, 0.2];
const NAMES: string[] = ['Intro', 'Verse', 'Chorus', 'Verse′', 'Chorus′', 'Bridge', 'Chorus″', 'Outro', 'End'];

function automation(): Automation[] {
  /** A control set to a value for each section, stepping at every change of section. */
  const per = (page: Automation['page'], device: string, control: string, value: Partial<Record<Section, number>> & { rest: number }): Automation => {
    const points: [number, number][] = [];
    let last: number | undefined;
    for (const block of BLOCKS) {
      const v = value[block.section] ?? value.rest;
      if (last !== undefined && v !== last) points.push([block.start - 0.05, last]);
      if (v !== last) points.push([block.start, v]);
      last = v;
    }
    return { page, device, control, points };
  };
  return [
    // the singer has the tune; in the Bridge the guitar takes it
    per('mixer', 'mixer', 'ch3.fader', { M: 0.3, rest: 0.19 }),
    // the guitar: a light chorus on the accompaniment, more and an echo for the Bridge's octaves
    per('guitar', 'guitar', 'chorus.mix', { M: 0.6, rest: 0.35 }),
    per('mixer', 'mixer', 'ch3.aux2', { M: 0.3, rest: 0.12 }),
  ];
}

export function pierLights(): Song {
  // the dub bass on flatwounds, each string pulled to the tension that tunes it (as in Odd Hours)
  const flat = (name: keyof typeof GAUGES) => Math.round(tensionFor({ ...GAUGES[name], winding: 'flat' }, SCALES.long, midiToHz(GAUGES[name].note)) * 10) / 10;
  const voice = singer();
  return {
    id: 'pier-lights',
    title: 'Pier Lights',
    artist: 'The MOA Band',
    bpm: 132,
    key: 'A major',
    bars: BARS.length,
    beatsPerBar: 4,
    sleeve: { art: 'garden', colors: ['#1a1c22', '#f2a7c3', '#ffd25e', '#7fc8a9'] },
    band: ['guitar', 'kit', 'bass', 'bass2', 'vox', 'reverb', 'delay'],
    inputs: { ch1: 'MOA-BASS', ch2: 'MOA-BASS 2', ch3: 'MOA-GUITAR', ch4: 'MOA-VOX', line1: 'MOA-KIT' },
    setup: {
      // the singer: a baritone (a long tract), soft and a little breathy, a wide slow vibrato late into each note, big
      // scoops, a glide from note to note
      vox: { vox: { controls: {
        lyrics: voice.lyrics, size: 18, tension: 0.55, breath: 0.3, roughness: 0.3, ring: 0.45,
        'vibrato.depth': 45, 'vibrato.rate': 4.8, 'vibrato.delay': 0.45, scoop: 70, glide: 0.12, onset: 0.4, attack: 0.08, release: 0.35, level: 0.9,
      } } },
      guitar: { guitar: { controls: {
        // the bridge and middle single coils, clean and bright, a light chorus: jangle
        'pickup.select': 'bridge+middle', 'pickup.type': 'single', tone: 10, 'pluck.style': 'pick', 'pluck.position': 0.08, 'pluck.strength': 0.5,
        strum: 'down', 'strum.time': 9, 'drive.mix': 0,
        'chorus.mix': 0.35, 'chorus.rate': 1.1, 'chorus.depth': 0.45, 'chorus.flange': 0,
        'amp.gain': 0.22, 'amp.bass': -3, 'amp.mid': 1, 'amp.treble': 5, 'cab.type': '2x12', 'cab.blend': 0.75, level: 0.6,
      } } },
      bass: { bass: { controls: {
        'string.winding': 'flat', 'E.tension': flat('E'), 'A.tension': flat('A'), 'D.tension': flat('D'), 'G.tension': flat('G'),
        'pluck.style': 'finger', 'pluck.position': 0.15, 'pluck.strength': 0.5, 'pickup.position': 0.16, tone: 1600, palm: 0.1,
        'amp.gain': 0.3, 'amp.bass': 3, 'amp.mid': -1, 'amp.treble': -4, 'cab.type': '8x10', 'cab.mic': 'off-axis', 'cab.blend': 0.6, level: 0.9,
      } } },
      // the free bass, singing the tune: roundwounds, fingers by the bridge for the mids to cut, a little chorus
      bass2: { bass: { controls: {
        'drive.mix': 0, 'chorus.mix': 0.3, 'chorus.rate': 0.8, 'chorus.depth': 0.5, 'chorus.flange': 0,
        'pluck.style': 'finger', 'pluck.position': 0.09, 'pluck.strength': 0.55, 'pickup.position': 0.08, tone: 5000,
        'amp.gain': 0.3, 'amp.mid': 4, 'amp.treble': 3, 'cab.type': '4x10', 'cab.blend': 0.5, level: 0.8,
      } } },
      kit: { kit: { controls: { 'snare.wires': 0.45 } } },
      // a dotted eighth at 132 bpm (341 ms), short and clean
      delay: { delay: { controls: { 'delay.time': 341, 'delay.feedback': 0.3, 'delay.tone': 4000, 'delay.wobble': 0.08, 'delay.drive': 0.05, 'delay.spread': 0.8 } } },
      reverb: { reverb: { controls: { 'reverb.size': 'medium', 'reverb.lowcut': 300, 'reverb.damp': 7000, 'reverb.predelay': 20 } } },
      mixer: { mixer: { controls: {
        // as Odd Hours' places; the accompaniment down (the guitar 3 dB, the dub bass 2, the kit 1); the tune where it was
        'ch1.fader': 0.52, 'ch1.pan': 0.15, 'ch1.aux1': 0.05,
        // the singer in front, a plate's worth of reverb and a little echo; the free bass under him now
        'ch4.fader': 1.1, 'ch4.pan': 0, 'ch4.aux1': 0.28, 'ch4.aux2': 0.12,
        'ch2.fader': 0.3, 'ch2.pan': 0.5, 'ch2.aux1': 0.12, 'ch2.aux2': 0.08,
        'ch3.fader': 0.19, 'ch3.pan': -0.5, 'ch3.aux1': 0.18, 'ch3.aux2': 0.12,
        'line1.fader': 1.3, 'line1.aux1': 0.1,
        'ret1.fader': 0.8, 'ret2.fader': 0.7,
      } } },
    },
    tracks: {
      guitar: withDynamics(guitar(), level),
      kit: withDynamics(kit(), level),
      bass: withDynamics(dubBass(), level),
      // the tune swells with the band, half as much (a singer rides over it), and never so soft it thins out
      bass2: withDynamics(freeBass(), level, 100),
      // the singer swells with the band, half as much (he rides over it)
      vox: withDynamics(voice.notes, (beat) => 0.5 + 0.5 * level(beat), 127),
    },
    automation: automation(),
    sections: BLOCKS.map((block, k) => ({ name: NAMES[k]!, from: block.start, to: block.start + barsOf(block).length * 4, meter: '4/4', heat: HEAT[k]! })),
    words: words(),
    // the band swings the sixteenths a little, together
    swung: [{ from: 0, to: BARS.length * 4, amount: 54, grid: 16 }],
    humanise: { timing: { kit: 4, bass: 6, bass2: 7, guitar: 6, vox: 8 }, velocity: 0.05, layback: { kit: { 38: 3 } } },
  };
}

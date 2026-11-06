import { at16 } from '../../songs/generators';
import type { NoteEvent } from '../../songs/types';
import type { DrumVoice } from '../devices/drumMachine';
import { voiceTriad } from './drills';
import type { Role } from './progress';

/**
 * The band's songs: originals, written as data. Every song has the same shape (intro, verse, chorus, verse, chorus,
 * end), drums, and a bass part and a synth part; whichever member the player is not playing, the engine plays. The
 * parts use only what the lessons teach: H1's triads on the synth, B-H1's roots and fifths on the bass, played on the
 * beats B-T2 trains. Times are in beats from the start of the song; bass notes are as the bass sounds.
 */

export interface DrumHit {
  readonly t: number;
  readonly voice: DrumVoice;
  readonly vel: number;
}

export interface SongSection {
  readonly name: string;
  readonly from: number;
  readonly to: number;
}

export interface ChordChange {
  readonly t: number;
  readonly name: string;
  readonly root: number;
  readonly quality: 'major' | 'minor';
}

export interface GameSong {
  readonly id: string;
  readonly title: string;
  readonly bpm: number;
  readonly bars: number;
  readonly sections: readonly SongSection[];
  readonly chords: readonly ChordChange[];
  readonly drums: readonly DrumHit[];
  readonly parts: Readonly<Record<Role, readonly NoteEvent[]>>;
  /** Beat ranges the bass plays with the palm on the strings (the bandmate lifts the mod wheel; a lesson can judge it). */
  readonly palm?: readonly (readonly [number, number])[];
}

export const BEATS_PER_BAR = 4;

type ChordName = 'C' | 'G' | 'Am' | 'F' | 'Dm';
const CHORD: Record<ChordName, { root: number; quality: 'major' | 'minor' }> = {
  C: { root: 0, quality: 'major' }, G: { root: 7, quality: 'major' }, Am: { root: 9, quality: 'minor' }, F: { root: 5, quality: 'major' },
  Dm: { root: 2, quality: 'minor' },
};
/** Where each chord's root sits on the bass (as it sounds): C2, G1, A1, F1, D2. */
const BASS_ROOT: Record<ChordName, number> = { C: 36, G: 31, Am: 33, F: 29, Dm: 38 };
/** A dead note's velocity: soft enough that the bass plays it damped. */
const DEAD = 30;

/** One bar of a part: the notes it plays over a chord, at 16th-note steps. */
type BarWriter = (bar: number, chord: ChordName) => NoteEvent[];

const ev = (t: number, len: number, note: number, vel: number): NoteEvent => ({ t, len, note, vel });
const triad = (c: ChordName) => voiceTriad({ kind: 'chord', ...CHORD[c] }).map((n) => n + 12); // around middle C, as H1 shows them

/** Bass: the root on these steps, each lasting `len` steps. */
const bassOn = (stepList: readonly number[], len: number, vel = 100): BarWriter => (bar, c) =>
  stepList.map((s) => ev(at16(bar, s), len / 4, BASS_ROOT[c], vel));
/** Bass: root and fifth, a note per entry: [step, 'root' | 'fifth']. */
const bassRootFifth = (pattern: readonly (readonly [number, 'root' | 'fifth'])[], len: number, vel = 100): BarWriter => (bar, c) =>
  pattern.map(([s, which]) => ev(at16(bar, s), len / 4, BASS_ROOT[c] + (which === 'fifth' ? 7 : 0), vel));
/** Bass: the root on these steps, and dead notes (the root, damped) on those. */
const bassWithDead = (roots: readonly number[], dead: readonly number[], len: number): BarWriter => (bar, c) =>
  [...roots.map((s) => ev(at16(bar, s), len / 4, BASS_ROOT[c], 100)), ...dead.map((s) => ev(at16(bar, s), 0.2, BASS_ROOT[c], DEAD))]
    .sort((a, b) => a.t - b.t);
/** Synth: the chord on these steps, each lasting `len` steps. */
const chordsOn = (stepList: readonly number[], len: number, vel = 92): BarWriter => (bar, c) =>
  stepList.flatMap((s) => triad(c).map((n) => ev(at16(bar, s), len / 4, n, vel)));

interface SongPlan {
  id: string;
  title: string;
  bpm: number;
  verse: readonly ChordName[];
  chorus: readonly ChordName[];
  bass: { verse: BarWriter; chorus: BarWriter };
  synth: { verse: BarWriter; chorus: BarWriter };
  /** The bass plays the verses with the palm on the strings. */
  palmVerses?: boolean;
}

const INTRO_BARS = 2;
const VERSE_BARS = 4;
const CHORUS_BARS = 4;

/** Lays a plan out: intro (drums), verse, chorus, verse, chorus, and a last bar of the chorus's first chord, held. */
function writeSong(p: SongPlan): GameSong {
  const layout: { name: string; bars: number; kind: 'intro' | 'verse' | 'chorus' | 'end' }[] = [
    { name: 'Intro', bars: INTRO_BARS, kind: 'intro' },
    { name: 'Verse 1', bars: VERSE_BARS, kind: 'verse' },
    { name: 'Chorus 1', bars: CHORUS_BARS, kind: 'chorus' },
    { name: 'Verse 2', bars: VERSE_BARS, kind: 'verse' },
    { name: 'Chorus 2', bars: CHORUS_BARS, kind: 'chorus' },
    { name: 'End', bars: 1, kind: 'end' },
  ];
  const sections: SongSection[] = [];
  const chords: ChordChange[] = [];
  const drums: DrumHit[] = [];
  const bass: NoteEvent[] = [];
  const synth: NoteEvent[] = [];
  let bar = 0;
  for (const s of layout) {
    sections.push({ name: s.name, from: bar * BEATS_PER_BAR, to: (bar + s.bars) * BEATS_PER_BAR });
    for (let i = 0; i < s.bars; i++, bar++) {
      const t0 = bar * BEATS_PER_BAR;
      const hit = (beat: number, voice: DrumVoice, vel: number) => drums.push({ t: t0 + beat, voice, vel });
      if (s.kind === 'intro') {
        for (let e = 0; e < 8; e++) hit(e / 2, 'closedHat', e % 2 ? 0.3 : 0.5);
        if (i === INTRO_BARS - 1) for (let b = 0; b < 4; b++) hit(b, 'kick', 0.9);
        continue;
      }
      const prog = s.kind === 'verse' ? p.verse : p.chorus;
      const chord: ChordName = s.kind === 'end' ? p.chorus[0]! : prog[i % prog.length]!;
      chords.push({ t: t0, name: chord, ...CHORD[chord] });
      if (s.kind === 'end') {
        hit(0, 'kick', 1);
        hit(0, 'openHat', 0.7);
        bass.push(ev(t0, 3.5, BASS_ROOT[chord], 100));
        synth.push(...triad(chord).map((n) => ev(t0, 3.5, n, 92)));
        continue;
      }
      for (let b = 0; b < 4; b++) hit(b, 'kick', 1);
      hit(1, 'clap', 0.8);
      hit(3, 'clap', 0.8);
      for (let e = 0; e < 8; e++) {
        if (s.kind === 'chorus' && e % 2) hit(e / 2, 'openHat', 0.45);
        else hit(e / 2, 'closedHat', e % 2 ? 0.3 : 0.45);
      }
      bass.push(...(s.kind === 'verse' ? p.bass.verse : p.bass.chorus)(bar, chord));
      synth.push(...(s.kind === 'verse' ? p.synth.verse : p.synth.chorus)(bar, chord));
    }
  }
  const palm = p.palmVerses ? sections.filter((x) => x.name.startsWith('Verse')).map((x) => [x.from, x.to] as const) : undefined;
  return { id: p.id, title: p.title, bpm: p.bpm, bars: bar, sections, chords, drums, parts: { bass, synth }, ...(palm ? { palm } : {}) };
}

/** A bar of the band's groove: kick on every beat, clap on 2 and 4, hi-hat on the eighths. */
function grooveBar(drums: DrumHit[], t0: number): void {
  for (let b = 0; b < 4; b++) drums.push({ t: t0 + b, voice: 'kick', vel: 1 });
  drums.push({ t: t0 + 1, voice: 'clap', vel: 0.8 }, { t: t0 + 3, voice: 'clap', vel: 0.8 });
  for (let e = 0; e < 8; e++) drums.push({ t: t0 + e / 2, voice: 'closedHat', vel: e % 2 ? 0.3 : 0.45 });
}

/**
 * A short song for a lesson: one bar of hi-hat to count in, then bars in named sections, each with its chord and
 * what the player's part plays over it. `palm` names the sections played with the palm on the strings.
 */
export function lessonSong(id: string, title: string, bpm: number, role: Role,
  bars: readonly { section: string; chord: ChordName; part: BarWriter }[], palm: readonly string[] = []): GameSong {
  const drums: DrumHit[] = [];
  for (let e = 0; e < 8; e++) drums.push({ t: e / 2, voice: 'closedHat', vel: e % 2 ? 0.3 : 0.6 });
  const sections: SongSection[] = [{ name: 'Count-in', from: 0, to: BEATS_PER_BAR }];
  const chords: ChordChange[] = [];
  const part: NoteEvent[] = [];
  bars.forEach((b, i) => {
    const bar = i + 1;
    const t0 = bar * BEATS_PER_BAR;
    const last = sections[sections.length - 1]!;
    if (last.name === b.section) sections[sections.length - 1] = { ...last, to: t0 + BEATS_PER_BAR };
    else sections.push({ name: b.section, from: t0, to: t0 + BEATS_PER_BAR });
    chords.push({ t: t0, name: b.chord, ...CHORD[b.chord] });
    grooveBar(drums, t0);
    part.push(...b.part(bar, b.chord));
  });
  const palmRanges = sections.filter((x) => palm.includes(x.name)).map((x) => [x.from, x.to] as const);
  const empty: NoteEvent[] = [];
  return {
    id, title, bpm, bars: bars.length + 1, sections, chords, drums,
    parts: role === 'bass' ? { bass: part, synth: empty } : { synth: part, bass: empty },
    ...(palmRanges.length ? { palm: palmRanges } : {}),
  };
}

/** The parts the length lessons are built from. */
export const PARTS = {
  /** A chord held through the bar, let go just before the next. */
  pad: chordsOn([0], 15),
  /** Short chords on each beat: struck and let go. */
  stab: chordsOn([0, 4, 8, 12], 1),
  /** The root held through the bar. */
  longRoot: bassOn([0], 15),
  /** Short roots on each beat. */
  shortRoot: bassOn([0, 4, 8, 12], 1),
  /** Roots on the eighths, for the palm. */
  eighthRoot: bassOn([0, 2, 4, 6, 8, 10, 12, 14], 1.6),
  /** Roots on the beats with a dead note on each "and". */
  deadEighths: bassWithDead([0, 4, 8, 12], [2, 6, 10, 14], 1.2),
  /** Roots on every beat, for the palm at a learning pace. */
  quarterRoot: bassOn([0, 4, 8, 12], 2.5),
  /** Roots on beats 1 and 3, a dead note on 2 and 4. */
  deadBackbeat: bassWithDead([0, 8], [4, 12], 3),
  /** Only the dead notes on 2 and 4: practising the soft touch on its own. */
  deadOnly: bassWithDead([], [4, 12], 3),
};

export const SONGS: readonly GameSong[] = [
  writeSong({
    id: 'first-light', title: 'First Light', bpm: 112,
    verse: ['C', 'G', 'Am', 'F'], chorus: ['C', 'G', 'Am', 'F'],
    bass: { verse: bassOn([0, 8], 7), chorus: bassOn([0, 8], 7) },
    synth: { verse: chordsOn([0], 15), chorus: chordsOn([0], 15) },
  }),
  writeSong({
    id: 'night-bus', title: 'Night Bus', bpm: 116,
    verse: ['Am', 'F', 'C', 'G'], chorus: ['Am', 'F', 'C', 'G'],
    bass: { verse: bassOn([0, 4, 8, 12], 3), chorus: bassOn([0, 4, 8, 12], 3) },
    synth: { verse: chordsOn([0, 8], 7), chorus: chordsOn([0, 8], 7) },
  }),
  writeSong({
    id: 'static-hearts', title: 'Static Hearts', bpm: 120,
    verse: ['F', 'G', 'C', 'Am'], chorus: ['C', 'G', 'Am', 'F'],
    bass: {
      verse: bassRootFifth([[0, 'root'], [4, 'root'], [8, 'fifth'], [12, 'root']], 3),
      chorus: bassOn([0, 2, 4, 6, 8, 10, 12, 14], 1.6),
    },
    synth: { verse: chordsOn([0, 8], 7), chorus: chordsOn([2, 6, 10, 14], 1.5) },
  }),
  // Northside Club: pads against stabs, the palm and dead notes, and a song in a minor key.
  writeSong({
    id: 'glasshouse', title: 'Glasshouse', bpm: 118,
    verse: ['Dm', 'F', 'C', 'G'], chorus: ['F', 'C', 'Dm', 'G'],
    bass: { verse: PARTS.eighthRoot, chorus: bassOn([0, 8], 7) },
    synth: { verse: chordsOn([0], 15), chorus: chordsOn([0, 4, 8, 12], 1) },
    palmVerses: true,
  }),
  writeSong({
    id: 'paper-planes', title: 'Paper Planes', bpm: 122,
    verse: ['C', 'Am', 'F', 'G'], chorus: ['Am', 'F', 'C', 'G'],
    bass: { verse: bassOn([0, 4, 8, 12], 1), chorus: bassWithDead([0, 4, 8, 12], [2, 6, 10, 14], 1.2) },
    synth: { verse: chordsOn([2, 6, 10, 14], 1), chorus: chordsOn([0], 15) },
  }),
  writeSong({
    id: 'last-train-home', title: 'Last Train Home', bpm: 126,
    verse: ['Am', 'G', 'F', 'G'], chorus: ['C', 'G', 'Dm', 'F'],
    bass: { verse: bassOn([0], 15), chorus: bassRootFifth([[0, 'root'], [2, 'root'], [4, 'fifth'], [6, 'root'], [8, 'root'], [10, 'root'], [12, 'fifth'], [14, 'root']], 1.6) },
    synth: { verse: chordsOn([0], 15), chorus: chordsOn([0, 4, 8, 12], 1) },
  }),
];

export function songById(id: string): GameSong {
  const s = SONGS.find((x) => x.id === id);
  if (!s) throw new Error(`No song ${id}`);
  return s;
}

/** The song's length in beats. */
export function songBeats(s: GameSong): number {
  return s.bars * BEATS_PER_BAR;
}

/** The chord at a beat (the last change at or before it). */
export function chordAt(s: GameSong, beat: number): ChordChange | undefined {
  let found: ChordChange | undefined;
  for (const c of s.chords) if (c.t <= beat + 1e-9) found = c;
  return found;
}

/** The section a beat falls in. */
export function sectionAt(s: GameSong, beat: number): SongSection | undefined {
  return s.sections.find((x) => beat >= x.from && beat < x.to);
}

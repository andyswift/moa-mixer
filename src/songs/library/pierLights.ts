import { GAUGES, SCALES, midiToHz, tensionFor } from '../../domain/devices/bassPhysics';
import { note } from '../generators';
import type { Automation, NoteEvent, Song } from '../types';

/**
 * An original jangle-pop instrumental for two basses, a guitar and a drum kit (working title): bright and quick, the
 * chords changing nearly every bar. The guitar rings sixteenth-note arpeggios across open-string chords (the open B and
 * E left ringing on top of every shape), the free bass runs a busy melodic line through each chord into the next, the
 * dub bass holds the roots, and the kit drives. 132 bpm, A major, all in 4/4.
 *
 * Intro, Verse, Chorus, Verse′, Chorus′, Bridge, Chorus″, Outro, a last chord (`PLAN`).
 *
 * Intro: the guitar's arpeggios alone, then the band. Verse: A F#m D E A C#m D E. Chorus: D E C#m F#m D E A, the guitar
 * strumming eighths, the free bass up the neck, the kit on the ride. Bridge: Bm E F#m D E, the guitar's melody in
 * octaves, the kit on the floor tom and a cross-stick. The Outro rings out on A and F#m.
 */
type Section = 'intro' | 'V' | 'C' | 'M' | 'O' | 'end';
const PLAN: [Section, number][] = [['intro', 8], ['V', 16], ['C', 8], ['V', 16], ['C', 8], ['M', 8], ['C', 8], ['O', 8], ['end', 2]];

interface Bar {
  section: Section;
  /** The bar's place in its block, from 0. */
  i: number;
  /** Where it starts, in beats. */
  start: number;
}
const BARS: Bar[] = [];
for (const [section, count] of PLAN) for (let i = 0; i < count; i++) BARS.push({ section, i, start: BARS.length * 4 });
/** Each block's first bar: where the band changes section. */
const BLOCKS = BARS.filter((bar) => bar.i === 0);
/** A block's bars. */
const barsOf = (block: Bar): Bar[] => BARS.slice(BARS.indexOf(block), BARS.indexOf(block) + PLAN[BLOCKS.indexOf(block)]![1]);

/** A note `len` eighths long at eighth `at` of a bar (or several, for a chord or a double-stop). */
function play(out: NoteEvent[], bar: Bar, at: number, pitches: number | readonly number[], len: number, vel: number): void {
  for (const p of typeof pitches === 'number' ? [pitches] : pitches) out.push(note(bar.start + at / 2, len / 2, p, vel));
}

const KIT = { kick: 36, stick: 37, snare: 38, floor: 41, hat: 42, pedal: 44, tom: 47, openHat: 46, crash: 49, ride: 51, bell: 53 } as const;

// ---- the harmony ----

type Chord = 'A' | 'Bm' | 'C#m' | 'D' | 'E' | 'F#m';
/** A major's notes, as pitch classes. */
const KEY = new Set([9, 11, 1, 2, 4, 6, 8]);
/** A note moved down into the key if it is not in it. */
const inKey = (n: number): number => (KEY.has(((n % 12) + 12) % 12) ? n : n - 1);
/**
 * Each chord: the guitar's open-string voicing (the open B and E ringing on top wherever the shape allows), the free
 * bass's root (mid register, where its line runs), its third, and the dub bass's root (low).
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

// ---- the parts' figures ----

/** Which of a voicing's notes each sixteenth of the arpeggio plays: across the strings and back, never the same twice running. */
const ARPEGGIO = [0, 2, 4, 3, 1, 3, 4, 2, 0, 3, 2, 4, 1, 4, 3, 2];
/** The guitar's arpeggio for a bar: each note let ring three sixteenths, the beats leaned on. */
function jangle(out: NoteEvent[], bar: Bar, soft: number): void {
  const voicing = CHORDS[chordOf(bar)].voicing;
  ARPEGGIO.forEach((k, s) => play(out, bar, s / 2, voicing[Math.min(k + voicing.length - 5, voicing.length - 1)]!, 1.5, Math.round((s % 4 === 0 ? 88 : s % 2 === 0 ? 74 : 66) * soft)));
}
/** The guitar's melody in the Bridge, in octaves, a figure per two bars: [eighth, note, length in eighths]. */
const OCTAVES_M: [number, number, number][][] = [
  [[0, 66, 3], [3, 69, 1], [4, 71, 4], [8, 69, 2], [10, 66, 2], [12, 64, 4]], // Bm
  [[0, 68, 4], [4, 71, 2], [6, 68, 2], [8, 64, 8]], // E
  [[0, 69, 3], [3, 68, 1], [4, 66, 4], [8, 61, 4], [12, 64, 4]], // F#m
  [[0, 66, 4], [4, 62, 4], [8, 64, 4], [12, 68, 4]], // D, E
];
/**
 * The free bass's line, a bar of eighths, as steps through the chord ([root, third, fifth, octave, ninth]); the last
 * eighth is left for the step into the next chord. Two shapes in the verses, one climbing higher for the choruses.
 */
const LINES = { verse: [[0, 2, 3, 2, 4, 3, 2], [0, 1, 2, 3, 2, 1, 0]], chorus: [[3, 2, 4, 3, 1, 2, 0], [3, 4, 3, 2, 3, 1, 2]] };

function guitar(): NoteEvent[] {
  const out: NoteEvent[] = [];
  for (const bar of BARS) {
    const { section, i } = bar;
    if (section === 'intro' || section === 'V') {
      jangle(out, bar, section === 'intro' && i < 4 ? 0.9 : 1);
    } else if (section === 'C') {
      // strummed eighths, the chord rung out on the beat, lighter between
      const voicing = CHORDS[chordOf(bar)].voicing;
      for (let e = 0; e < 8; e++) play(out, bar, e, voicing, 0.9, e === 0 ? 100 : e % 2 ? 70 : 84);
    } else if (section === 'M') {
      if (i % 2 === 0) for (const [e, p, len] of OCTAVES_M[i / 2]!) play(out, bar, e, [p, p + 12], len, e === 0 ? 94 : 84);
    } else if (section === 'O') {
      jangle(out, bar, 1 - i * 0.07);
    } else if (i === 0) {
      play(out, bar, 0, CHORDS.A.voicing, 15, 92); // the last chord, strummed and left to ring
    }
  }
  return out;
}

function dubBass(): NoteEvent[] {
  const out: NoteEvent[] = [];
  for (const bar of BARS) {
    const { section, i } = bar;
    const low = CHORDS[chordOf(bar)].low;
    if (section === 'intro' && i < 4) continue;
    if (section === 'end') {
      if (i === 0) play(out, bar, 0, low, 15, 104);
      continue;
    }
    // the root on the beats, an octave pop on the and of four
    for (const e of [0, 2, 4]) play(out, bar, e, low, 1.8, e === 0 ? 104 : 92);
    play(out, bar, 6, low, 1, 92);
    play(out, bar, 7, low + 12, 0.5, 88);
  }
  return out;
}

function freeBass(): NoteEvent[] {
  // never picked hard: a bass picked hard by the bridge goes sharp
  const out: NoteEvent[] = [];
  for (const bar of BARS) {
    const { section, i } = bar;
    if (section === 'intro' && i < 4) continue;
    const c = CHORDS[chordOf(bar)];
    const tones = [c.root, c.root + c.third, c.root + 7, c.root + 12, inKey(c.root + 14)];
    if (section === 'end') {
      if (i === 0) play(out, bar, 0, [45, 52], 15, 90);
      continue;
    }
    if (section === 'M') {
      // the bridge: quarter notes, root, fifth, octave, fifth, under the guitar's melody
      for (const [e, k, len] of [[0, 0, 2], [2, 2, 2], [4, 3, 2], [6, 2, 1.5]] as const) play(out, bar, e, tones[k]!, len, e === 0 ? 92 : 84);
      continue;
    }
    const line = (section === 'C' ? LINES.chorus : LINES.verse)[i % 2]!;
    line.forEach((k, e) => play(out, bar, e, tones[k]!, 0.9, e === 0 ? 96 : e % 2 ? 82 : 88));
    // the last eighth steps into the next chord: from a step below its root, or to the fifth if the chord stays
    const next = CHORDS[nextChord(bar)];
    play(out, bar, 7, next === c ? tones[2]! : inKey(next.root - 1), 0.9, 86);
  }
  return out;
}

function kit(): NoteEvent[] {
  const out: NoteEvent[] = [];
  const hit = (bar: Bar, e: number, n: number, vel: number) => play(out, bar, e, n, 0.4, vel);
  const fill = (bar: Bar) => [KIT.snare, KIT.snare, KIT.tom, KIT.tom, KIT.floor, KIT.floor, KIT.snare, KIT.snare].forEach((n, s) => hit(bar, 4 + s / 2, n, 84 + s * 4));
  /** The drive: eighths on the hats (or the ride), the kick on 1, the and of 2 and 3, the backbeat hard, a ghost before it. */
  const drive = (bar: Bar, cymbal: number, filled: boolean) => {
    for (let e = 0; e < (filled ? 4 : 8); e++) {
      if (cymbal === KIT.hat && e === 7 && bar.i % 2 === 1) hit(bar, e, KIT.openHat, 76);
      else hit(bar, e, cymbal, e % 2 === 0 ? 84 : 58);
    }
    hit(bar, 0, KIT.kick, 112); hit(bar, 3, KIT.kick, 94); hit(bar, 4, KIT.kick, 106);
    hit(bar, 2, KIT.snare, 108);
    if (filled) fill(bar);
    else { hit(bar, 5.5, KIT.snare, 34); hit(bar, 6, KIT.snare, 110); }
  };
  for (const bar of BARS) {
    const { section, i } = bar;
    if (section === 'intro') {
      if (i === 3) for (let s = 0; s < 4; s++) hit(bar, 6 + s / 2, KIT.snare, 70 + s * 10); // a pick-up into the band
      else if (i >= 4) drive(bar, KIT.hat, i === 7);
      if (i === 4) hit(bar, 0, KIT.crash, 108);
    } else if (section === 'V') {
      drive(bar, KIT.hat, i % 8 === 7);
      if (i === 0) hit(bar, 0, KIT.crash, 106);
    } else if (section === 'C') {
      drive(bar, KIT.ride, i === 7);
      if (i % 2 === 0) hit(bar, 0, KIT.crash, i === 0 ? 114 : 102);
    } else if (section === 'M') {
      // the floor tom driving eighths, the kick under it, a cross-stick for the backbeat
      for (let e = 0; e < 8; e++) hit(bar, e, KIT.floor, e % 2 ? 62 : 82);
      hit(bar, 0, KIT.kick, 108); hit(bar, 3, KIT.kick, 92); hit(bar, 4, KIT.kick, 104);
      if (i === 7) fill(bar);
      else for (const e of [2, 6]) hit(bar, e, KIT.stick, 96);
    } else if (section === 'O') {
      drive(bar, KIT.hat, false);
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
    // the guitar: a light chorus on the arpeggios, more and an echo for the Bridge's octaves
    per('guitar', 'guitar', 'chorus.mix', { M: 0.6, rest: 0.35 }),
    per('mixer', 'mixer', 'ch3.aux2', { M: 0.3, rest: 0.12 }),
    // the free bass up a little in the choruses, where his line climbs
    per('mixer', 'mixer', 'ch2.fader', { C: 0.46, rest: 0.4 }),
  ];
}

export function pierLights(): Song {
  // the dub bass on flatwounds, each string pulled to the tension that tunes it (as in Odd Hours)
  const flat = (name: keyof typeof GAUGES) => Math.round(tensionFor({ ...GAUGES[name], winding: 'flat' }, SCALES.long, midiToHz(GAUGES[name].note)) * 10) / 10;
  return {
    id: 'pier-lights',
    title: 'Pier Lights',
    artist: 'The MOA Band',
    bpm: 132,
    key: 'A major',
    bars: BARS.length,
    beatsPerBar: 4,
    sleeve: { art: 'garden', colors: ['#1a1c22', '#f2a7c3', '#ffd25e', '#7fc8a9'] },
    band: ['guitar', 'kit', 'bass', 'bass2', 'reverb', 'delay'],
    inputs: { ch1: 'MOA-BASS', ch2: 'MOA-BASS 2', ch3: 'MOA-GUITAR', line1: 'MOA-KIT' },
    setup: {
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
      // the free bass: roundwounds, fingers, bright and a touch of chorus, for a line that sings
      bass2: { bass: { controls: {
        'drive.mix': 0, 'chorus.mix': 0.25, 'chorus.rate': 0.8, 'chorus.depth': 0.5, 'chorus.flange': 0,
        'pluck.style': 'finger', 'pluck.position': 0.1, 'pluck.strength': 0.55, 'pickup.position': 0.1, tone: 4500,
        'amp.gain': 0.3, 'amp.mid': 3, 'amp.treble': 3, 'cab.type': '4x10', 'cab.blend': 0.5, level: 0.8,
      } } },
      kit: { kit: { controls: { 'snare.wires': 0.45 } } },
      // a dotted eighth at 132 bpm (341 ms), short and clean
      delay: { delay: { controls: { 'delay.time': 341, 'delay.feedback': 0.3, 'delay.tone': 4000, 'delay.wobble': 0.08, 'delay.drive': 0.05, 'delay.spread': 0.8 } } },
      reverb: { reverb: { controls: { 'reverb.size': 'medium', 'reverb.lowcut': 300, 'reverb.damp': 7000, 'reverb.predelay': 20 } } },
      mixer: { mixer: { controls: {
        // as Odd Hours: the guitar left, the kit in the middle, the basses right of it
        'ch1.fader': 0.65, 'ch1.pan': 0.15, 'ch1.aux1': 0.05,
        'ch2.fader': 0.4, 'ch2.pan': 0.5, 'ch2.aux1': 0.12, 'ch2.aux2': 0.08,
        'ch3.fader': 0.26, 'ch3.pan': -0.5, 'ch3.aux1': 0.18, 'ch3.aux2': 0.12,
        'line1.fader': 1.5, 'line1.aux1': 0.1,
        'ret1.fader': 0.8, 'ret2.fader': 0.7,
      } } },
    },
    tracks: { guitar: guitar(), kit: kit(), bass: dubBass(), bass2: freeBass() },
    automation: automation(),
    sections: BLOCKS.map((block, k) => ({ name: NAMES[k]!, from: block.start, to: block.start + barsOf(block).length * 4, meter: '4/4', heat: HEAT[k]! })),
    humanise: { timing: { kit: 4, bass: 6, bass2: 7, guitar: 5 }, velocity: 0.07, layback: { kit: { 38: 3 } } },
  };
}

import { GAUGES, GUITAR_GAUGES, GUITAR_SCALES, SCALES, midiToHz, tensionFor } from '../../domain/devices/bassPhysics';
import { GUITAR_STRINGS } from '../../domain/devices/electricGuitar';
import { note } from '../generators';
import type { Automation, NoteEvent, Song } from '../types';

/**
 * An original math-rock instrumental for two basses, a guitar and a drum kit (working title): odd meters, interlocking
 * riffs, a clean guitar over a ringing drone, a dub bassist holding the bottom with space, and a second bassist playing
 * free, high counter-lines against it; then a section that falls apart and locks back in. 138 bpm, A major / F# minor.
 *
 * Short blocks, so the band keeps switching: intro, A, B, A, D, B, A', C, D, B', A', a last chord (`PLAN`).
 *
 * Intro (7/8): the guitar's figure alone, then the hats and the dub bass. A (7/8, grouped 2+2+3): the full band;
 * the free bass comes in halfway the first time, answering the guitar a beat late. B (5/4, grouped 3+3+2+2): F#m11 to
 * Dmaj7#11, guitar dyads into the delay, the free bass climbing the neck (higher the second time), the kit on the ride
 * with the backbeat moved. A' (7/8): the first riff back, its echo pushed, the free bass doubling the guitar an octave
 * down. C (4/4): the guitar into crunch with an angular line, both basses in unison, the kit on the toms coming apart,
 * a snare build and three hits. D (4/4): straight rock, F#m D A E: the guitar on power chords, the dub bass pumping
 * roots, the free bass leading low through its overdrive. B' (5/4): the 5/4 riff doubled by
 * both basses. The last chord is left to ring.
 */
type Section = 'intro' | 'A' | 'B' | 'A2' | 'C' | 'D' | 'B2' | 'end';
/** The sections: name, bars, eighth notes a bar. Short blocks, so the band keeps switching between them. */
const PLAN: [Section, number, number][] = [
  ['intro', 4, 7], ['A', 8, 7], ['B', 4, 10], ['A', 4, 7], ['D', 8, 8], ['B', 4, 10],
  ['A2', 8, 7], ['C', 8, 8], ['D', 8, 8], ['B2', 8, 10], ['A2', 4, 7], ['end', 1, 8],
];

interface Bar {
  section: Section;
  /** The bar's place in its block, from 0. */
  i: number;
  /** Which time round this section is (0 the first time it is played). */
  n: number;
  eighths: number;
  /** Where it starts, in beats (quarter notes). */
  start: number;
}
const BARS: Bar[] = [];
{
  let start = 0;
  const times = new Map<Section, number>();
  for (const [section, count, eighths] of PLAN) {
    const n = times.get(section) ?? 0;
    times.set(section, n + 1);
    for (let i = 0; i < count; i++) {
      BARS.push({ section, i, n, eighths, start });
      start += eighths / 2;
    }
  }
}

/** A note `len` eighths long at eighth `at` of a bar (or several, for a chord or a double-stop). */
function play(out: NoteEvent[], bar: Bar, at: number, pitches: number | readonly number[], len: number, vel: number): void {
  for (const p of typeof pitches === 'number' ? [pitches] : pitches) out.push(note(bar.start + at / 2, len / 2, p, vel));
}

/** Plays a part's notes harder the hotter the section: `by` more at full heat. */
const harder = (notes: NoteEvent[], by: number, heat: (beat: number) => number): NoteEvent[] =>
  notes.map((n) => ({ ...n, vel: Math.min(127, Math.round(n.vel * (1 + by * heat(n.t)))) }));
/** The heat at a beat. */
const heatAt = (beat: number): number => {
  const bar = [...BARS].reverse().find((b) => b.start <= beat + 1e-9) ?? BARS[0]!;
  return HEAT[bar.section];
};

const KIT = { kick: 36, stick: 37, snare: 38, floor: 41, hat: 42, pedal: 44, tom: 47, openHat: 46, crash: 49, ride: 51, bell: 53 } as const;

// ---- the riffs ----

/** The A riff, two bars of 7/8 (2+2+3), with E5 ringing through it like an open string: Amaj9, then F#m11. */
const RIFF_A = [[69, 76, 71, 76, 73, 76, 68], [66, 73, 71, 73, 76, 69, 71]] as const;
/** Every fourth bar the last group climbs instead: D, E, F#. */
const RIFF_A_TURN = [74, 76, 78] as const;
/** The A riff for the i-th bar of a section. */
function riffA(i: number): number[] {
  const riff: number[] = [...RIFF_A[i % 2]!];
  if (i % 4 === 3) riff.splice(4, 3, ...RIFF_A_TURN);
  return riff;
}
/** The B riff, two bars of 5/4 (3+3+2+2): a fourth on each group's first eighth, single notes between. */
const RIFF_B: [number, readonly number[]][][] = [
  [[0, [69, 74]], [1, [73]], [2, [76]], [3, [69, 74]], [4, [71]], [5, [73]], [6, [76, 81]], [7, [78]], [8, [73, 78]], [9, [76]]],
  [[0, [66, 71]], [1, [69]], [2, [73]], [3, [66, 71]], [4, [68]], [5, [69]], [6, [73, 78]], [7, [76]], [8, [69, 74]], [9, [73]]],
];
/** C's line: angular, wide leaps, against the beat ([eighth, note, length in eighths]). */
const LINE_C: [number, number, number][] = [[0, 64, 1], [1, 70, 0.5], [1.5, 63, 0.5], [2, 69, 1], [3.5, 58, 0.5], [4, 65, 1.5], [6, 71, 0.5], [6.5, 64, 0.5], [7, 70, 1]];
/** The basses' unison in C: [eighth, note (the dub bass's octave), length]. */
const UNISON_C: [number, number, number][] = [[0, 40, 1], [1, 46, 1], [2.5, 39, 0.5], [3, 45, 1], [4.5, 34, 1], [6, 41, 0.5], [6.5, 47, 0.5], [7, 40, 1]];
/** C's unison, bar by bar: straight, then pushed an eighth late (wrapping round the bar), then only every other note. */
function unisonC(i: number): [number, number, number][] {
  if (i < 2) return UNISON_C;
  if (i < 4) return UNISON_C.map(([e, n, len]) => [(e + 1) % 8, n, len]);
  return UNISON_C.filter(([e]) => e % 2 === 0);
}
/** The dub bass's A and B parts: [eighth, note, length]. Space, the root and an octave pop. */
const DUB_A: [number, number, number][][] = [
  [[0, 33, 2.5], [3, 45, 0.5], [4, 40, 3]],
  [[0, 30, 2.5], [3, 42, 0.5], [4, 37, 1.5], [6, 40, 1]],
];
const DUB_B: [number, number, number][][] = [
  [[0, 30, 2.5], [3, 30, 2], [5, 42, 0.5], [6, 38, 1.5], [8, 33, 1.5]],
  [[0, 38, 2.5], [3, 38, 2], [5, 50, 0.5], [6, 45, 1.5], [8, 40, 1.5]],
];
/** The free bass: a counter-line answering the guitar a beat late in A, climbing in B ([eighth, notes, length]). */
const FREE_A: [number, readonly number[], number][][] = [
  [[1, [61], 2], [3.5, [59], 1], [5, [57, 61], 2]],
  [[0.5, [64], 1.5], [2, [61], 1], [4, [59], 3]],
];
const FREE_B: [number, readonly number[], number][][] = [
  [[0, [57], 3], [3, [61], 3], [6, [59, 64], 2], [8, [62], 2]],
  [[0, [59], 3], [3, [62], 3], [6, [66], 2], [8, [64], 2]],
];

// ---- the parts ----

/** D's chords, two bars each: power chords (root, fifth, octave) for the guitar, and their roots low for the dub bass. */
const CHORDS_D: { guitar: readonly number[]; root: number }[] = [
  { guitar: [42, 49, 54], root: 30 }, // F#5
  { guitar: [50, 57, 62], root: 38 }, // D5
  { guitar: [45, 52, 57], root: 33 }, // A5
  { guitar: [40, 47, 52], root: 28 }, // E5
];
const chordD = (i: number) => CHORDS_D[Math.floor(i / 2) % 4]!;
/** The free bass's lead in D, two bars (F# minor pentatonic over the chords): [eighth, note, length]. */
const LEAD_D: [number, number, number][][] = [
  [[0, 61, 1], [1, 59, 0.5], [1.5, 57, 0.5], [2, 54, 1], [3, 57, 1], [4, 59, 0.5], [4.5, 61, 0.5], [5, 64, 1], [6, 61, 0.5], [6.5, 59, 0.5], [7, 57, 1]],
  [[0, 59, 1.5], [1.5, 57, 0.5], [2, 54, 2], [4, 52, 0.5], [4.5, 54, 0.5], [5, 57, 1], [6, 59, 0.5], [6.5, 61, 1.5]],
];
/** Over the E chord, the lead climbs out of the turn instead. */
const LEAD_D_TURN: [number, number, number][] = [[0, 59, 1.5], [1.5, 57, 0.5], [2, 54, 2], [4, 57, 0.5], [4.5, 59, 0.5], [5, 61, 1], [6, 64, 0.5], [6.5, 66, 1.5]];

/** Whether a bar is one of the swung breaks: the A riff's turn bars and B's fill bars (every fourth). */
const swungBar = (bar: Bar) => (bar.section === 'A' || bar.section === 'A2' || bar.section === 'B' || bar.section === 'B2') && bar.i % 4 === 3;
/** A muted note: the string touched, not let ring (a scratch on the guitar, a dead note on a bass). */
const ghost = (out: NoteEvent[], bar: Bar, at: number, n: number, vel = 38) => play(out, bar, at, n, 0.12, vel);

function guitar(): NoteEvent[] {
  const out: NoteEvent[] = [];
  for (const bar of BARS) {
    const { section, i } = bar;
    if (section === 'intro' || section === 'A' || section === 'A2') {
      riffA(i).forEach((n, e) => play(out, bar, e, n, 0.95, e === 0 || e === 2 || e === 4 ? 92 : 72));
      // scratches between the riff's notes (not in the bare first bars): the funk under the arpeggio
      if (section !== 'intro' || i >= 2) for (const at of [2.5, 4.5, 5.5]) ghost(out, bar, at, 52);
    } else if (section === 'B' || section === 'B2') {
      for (const [e, ns] of RIFF_B[i % 2]!) play(out, bar, e, ns, ns.length > 1 ? 1.4 : 0.9, ns.length > 1 ? 96 : 76);
      for (const at of [1.5, 4.5, 7.5, 9.5]) ghost(out, bar, at, i % 2 ? 50 : 54);
    } else if (section === 'C') {
      if (i < 4) for (const [e, n, len] of LINE_C) play(out, bar, e, n + (i >= 2 ? 1 : 0), len, 100); // a semitone up the second time
      else if (i < 6) for (const e of [0, 1.5, 5, 6.5]) play(out, bar, e, [40, 47, 52], 0.8, 112); // E5 stabs, off the beat
      else if (i === 6) for (let s = 0; s < 16; s++) play(out, bar, s / 2, 64, 0.45, 50 + s * 4); // tremolo, building
      else for (const e of [0, 3, 6]) play(out, bar, e, [40, 47, 52], 1.5, 120);
    } else if (section === 'D') {
      // rock rhythm: the chord rung out on 1, the and of 2 and 4, palm-muted chugs on the root and fifth between
      const chord = chordD(i).guitar;
      const last = i % 8 === 7;
      for (let e = 0; e < 8; e++) {
        if (last && e > 3) break; // the drums fill
        if (e === 0) play(out, bar, e, chord, 1.5, 114);
        else if (e === 3 || e === 6) play(out, bar, e, chord, 1, 104);
        else if (e !== 1 && e !== 4 && e !== 7) continue;
        else play(out, bar, e, chord.slice(0, 2), 0.35, 74);
      }
    } else {
      play(out, bar, 0, [45, 52, 57, 61, 64], 7.5, 90); // Amaj9 (A, E, A, C#, E), strummed and left to ring
    }
  }
  return out;
}

function dubBass(): NoteEvent[] {
  const out: NoteEvent[] = [];
  for (const bar of BARS) {
    const { section, i } = bar;
    if (section === 'intro') {
      if (i >= 2) { play(out, bar, 0, 33, 3, 100); play(out, bar, 4, 40, 2.5, 90); }
    } else if (section === 'A' || section === 'A2') {
      const part = DUB_A[i % 2]!;
      for (const [e, n, len] of part) play(out, bar, e, n, len, e === 0 ? 108 : 90);
      // dead notes in the gaps, and the next root pushed a sixteenth early at the end of the even bars
      ghost(out, bar, 2.5, part[0]![1], 50);
      if (i % 4 === 3) play(out, bar, 6, 44, 0.9, 92); // G#, leading back to A
      else if (i % 2 === 0) play(out, bar, 6.5, 30, 0.5, 96);
    } else if (section === 'B' || section === 'B2') {
      for (const [e, n, len] of DUB_B[i % 2]!) play(out, bar, e, n, len, e === 0 || e === 3 ? 108 : 90);
      for (const at of [2.5, 7.5]) ghost(out, bar, at, i % 2 ? 38 : 30, 52);
      play(out, bar, 9.5, i % 2 ? 42 : 45, 0.5, 94); // a pop into the next bar
    } else if (section === 'C') {
      if (i < 6) for (const [e, n, len] of unisonC(i)) play(out, bar, e, n, len, 104);
      else if (i === 6) for (let s = 0; s < 16; s++) play(out, bar, s / 2, 28, 0.45, 60 + s * 4);
      else for (const e of [0, 3, 6]) play(out, bar, e, 28, 1.5, 120);
    } else if (section === 'D') {
      // pumping roots in eighths, an octave pop to end each bar
      const root = chordD(i).root;
      for (let e = 0; e < 7; e++) play(out, bar, e, root, 0.8, e === 0 ? 112 : e % 2 === 0 ? 98 : 86);
      play(out, bar, 7, root + 12, 0.6, 96);
    } else {
      play(out, bar, 0, 33, 7.5, 110);
    }
  }
  return out;
}

function freeBass(): NoteEvent[] {
  // mostly in the bass register, a line above the dub bass's roots; the high answers kept for the turn bars
  const down = (ns: readonly number[], by: number) => ns.map((n) => n - by);
  const out: NoteEvent[] = [];
  for (const bar of BARS) {
    const { section, i, n: time } = bar;
    const turn = i % 4 === 3;
    if (section === 'A' && (time > 0 || i >= 4)) {
      for (const [e, ns, len] of FREE_A[i % 2]!) play(out, bar, e, turn ? ns : down(ns, 12), len, 86); // an octave down, but the turn answers high
    } else if (section === 'A2') {
      if (time === 0 && i < 4) for (const [e, ns, len] of FREE_A[i % 2]!) play(out, bar, e, turn ? ns : down(ns, 12), len, 86);
      else riffA(i).forEach((n, e) => play(out, bar, e, n - 24, 0.9, e === 0 ? 92 : 78)); // the guitar's riff two octaves down
    } else if (section === 'B') {
      // the climb, from an octave lower (a tone higher the second time)
      for (const [e, ns, len] of FREE_B[i % 2]!) play(out, bar, e, down(ns, time > 0 ? 10 : 12), len, 88);
      // stabs off the beat, a double-stop cut short
      for (const at of [2.5, 7.5]) play(out, bar, at, i % 2 ? [45, 50] : [42, 47], 0.3, 96);
    } else if (section === 'B2') {
      // doubling the riff: an octave up for the first half, then with the dub bass, together
      const up = i < 4 ? 12 : 0;
      for (const [e, n, len] of DUB_B[i % 2]!) play(out, bar, e, n + up, len, e === 0 || e === 3 ? 104 : 88);
      play(out, bar, 9.5, (i % 2 ? 42 : 45) + up, 0.5, 96);
    } else if (section === 'C') {
      if (i < 6) for (const [e, n, len] of unisonC(i)) play(out, bar, e, n, len, 100); // in unison with the dub bass
      else if (i === 7) for (const e of [0, 3, 6]) play(out, bar, e, 40, 1.5, 118);
    } else if (section === 'D') {
      // the lead, an octave down: a driving line in the bass register through its overdrive (single notes: double-
      // stops through a driven bass go muddy). Accents are leant on only a little: a bass string picked hard by the
      // bridge goes sharp (measured: 30 cents and more)
      const riff = Math.floor(i / 2) % 4 === 3 && i % 2 === 1 ? LEAD_D_TURN : LEAD_D[i % 2]!;
      for (const [e, n, len] of riff) play(out, bar, e, n - 12, len, e === 0 || e === 3 ? 100 : 90);
    } else if (section === 'end') {
      play(out, bar, 0, [40, 45], 7.5, 96); // E and A, low
    }
  }
  return out;
}

function kit(): NoteEvent[] {
  const out: NoteEvent[] = [];
  const hit = (bar: Bar, e: number, n: number, vel: number) => play(out, bar, e, n, 0.4, vel);
  for (const bar of BARS) {
    const { section, i } = bar;
    if (section === 'intro') {
      if (i >= 2) for (let e = 0; e < 7; e++) hit(bar, e, KIT.hat, e % 2 === 0 ? 62 : 46);
      if (i === 3) for (let s = 0; s < 6; s++) hit(bar, 4 + s / 2, KIT.snare, 55 + s * 10); // into A
    } else if (section === 'A' || section === 'A2') {
      // sixteenths on the hat, the eighths leaned on and the groups' first beats most
      for (let s = 0; s < 14; s++) {
        const e = s / 2;
        if (i % 4 === 3 && e === 6) hit(bar, e, KIT.openHat, 80);
        else if (!(i % 4 === 3 && e === 6.5)) hit(bar, e, KIT.hat, e === 0 || e === 2 || e === 4 ? 84 : s % 2 === 0 ? 62 : 40);
      }
      hit(bar, 0, KIT.kick, 112); hit(bar, 4, KIT.kick, 100);
      if (i % 2 === 1) hit(bar, 5.5, KIT.kick, 84);
      if (i % 4 === 1) hit(bar, 1.5, KIT.kick, 78); // a push before the snare
      hit(bar, 2, KIT.snare, 104); hit(bar, 5, KIT.snare, 100);
      for (const g of [0.5, 1.5, 3.5, 4.5, 6.5]) hit(bar, g, KIT.snare, g === 1.5 ? 36 : 26); // ghost notes
      if (i === 0 || i === 8) hit(bar, 0, KIT.crash, 100);
    } else if (section === 'B' || section === 'B2') {
      for (let e = 0; e < 10; e++) hit(bar, e, KIT.ride, [0, 3, 6, 8].includes(e) ? 86 : 60);
      for (const e of [3, 8]) hit(bar, e, KIT.pedal, 70); // the hi-hat's foot on the groups
      if (i % 2 === 1) hit(bar, 9, KIT.bell, 80);
      hit(bar, 0, KIT.kick, 112); hit(bar, 3, KIT.kick, 100); hit(bar, 5.5, KIT.kick, 86); hit(bar, 8, KIT.kick, 96);
      hit(bar, 6, KIT.snare, 108); // the backbeat, moved to the third group
      for (const g of [1.5, 4.5, 7.5, 9.5]) hit(bar, g, KIT.snare, 30);
      if (i % 4 === 0) hit(bar, 0, KIT.crash, section === 'B2' ? 110 : 96);
      if (i % 4 === 3) [KIT.snare, KIT.snare, KIT.tom, KIT.tom, KIT.floor, KIT.floor, KIT.floor, KIT.kick].forEach((n, s) => hit(bar, 6 + s / 2, n, 80 + s * 4));
    } else if (section === 'C') {
      if (i === 0) hit(bar, 0, KIT.crash, 110);
      if (i < 2) {
        // half time on the toms
        hit(bar, 0, KIT.kick, 112); hit(bar, 3, KIT.kick, 96); hit(bar, 2, KIT.floor, 100); hit(bar, 6, KIT.floor, 104); hit(bar, 5, KIT.tom, 92);
      } else if (i < 4) {
        // coming apart: the kick and snare off the beat
        hit(bar, 0, KIT.kick, 110); hit(bar, 1.5, KIT.kick, 92); hit(bar, 5, KIT.kick, 100); hit(bar, 3, KIT.snare, 106); hit(bar, 7.5, KIT.snare, 98);
        if (i === 3) { hit(bar, 4, KIT.crash, 104); for (let s = 0; s < 4; s++) hit(bar, 6 + s / 2, s % 2 ? KIT.floor : KIT.tom, 90); }
      } else if (i < 6) {
        // all over the kit, crashes where they fall
        [KIT.tom, KIT.snare, KIT.floor, KIT.kick, KIT.tom, KIT.floor, KIT.snare, KIT.kick, KIT.floor, KIT.tom, KIT.snare, KIT.floor].forEach((n, s) => hit(bar, (s * 2) / 3, n, 92 + (s % 3) * 8));
        hit(bar, i === 4 ? 0 : 5, KIT.crash, 112);
      } else if (i === 6) {
        for (let s = 0; s < 16; s++) hit(bar, s / 2, KIT.snare, 40 + s * 5); // the build
      } else {
        for (const e of [0, 3, 6]) { hit(bar, e, KIT.kick, 124); hit(bar, e, KIT.crash, 120); hit(bar, e, KIT.snare, 118); }
      }
    } else if (section === 'D') {
      // straight rock: eighths on the ride, the kick on 1, 3 and the and of 3, the snare on 2 and 4, a crash every two bars
      const fill = i % 8 === 7;
      for (let e = 0; e < (fill ? 4 : 8); e++) hit(bar, e, KIT.ride, e % 2 === 0 ? 90 : 66);
      if (i % 2 === 0) hit(bar, 0, KIT.crash, i === 0 ? 118 : 104);
      hit(bar, 0, KIT.kick, 116); hit(bar, 4, KIT.kick, 108); hit(bar, 5, KIT.kick, 94);
      hit(bar, 2, KIT.snare, 112);
      if (fill) [KIT.snare, KIT.snare, KIT.tom, KIT.tom, KIT.floor, KIT.floor, KIT.kick, KIT.floor].forEach((n, s) => hit(bar, 4 + s / 2, n, 92 + s * 3));
      else { hit(bar, 6, KIT.snare, 114); hit(bar, 6.5, KIT.snare, 34); }
    } else {
      hit(bar, 0, KIT.kick, 124); hit(bar, 0, KIT.crash, 124); hit(bar, 0, KIT.floor, 118);
    }
  }
  return out;
}

/** How long a block lasts, in beats (to the next block's first bar). */
const blockBeats = (first: Bar): number => {
  const k = BARS.indexOf(first);
  let beats = 0;
  for (let j = k; j < BARS.length && (j === k || BARS[j]!.i > 0); j++) beats += BARS[j]!.eighths / 2;
  return beats;
};

/** Each block's first bar: where the band changes section. */
const BLOCKS = BARS.filter((bar) => bar.i === 0);

/** How heavy each section is: the guitarist freaks out in C and D (and plays like it), the free bass in D. */
const HEAT: Record<Section, number> = { intro: 0, A: 0.2, B: 0.35, A2: 0.4, C: 1, D: 0.85, B2: 0.6, end: 0.3 };
const NAMES: Record<Section, string> = { intro: 'Intro', A: 'A', B: 'B', A2: 'A′', C: 'C', D: 'D', B2: 'B′', end: 'End' };
/** The guitar's strings at the tension that tunes them (as the guitar comes). */
const GUITAR_TUNED = GUITAR_STRINGS.map((n) => Math.round(tensionFor(GUITAR_GAUGES[n], GUITAR_SCALES['25.5"'], midiToHz(GUITAR_GAUGES[n].note)) * 10) / 10);

/**
 * The guitarist freaking out when it gets heavy: in C and D he leans on the strings (each one drifts up to 10 cents,
 * a new way every bar, back in tune after), digs in harder and nearer the bridge. Seeded, so every pass is the same.
 */
function freakOut(): Automation[] {
  let seed = 1977;
  const random = () => { seed = (seed * 1664525 + 1013904223) >>> 0; return seed / 4294967296 - 0.5; };
  const heavy = (bar: Bar) => HEAT[bar.section] >= 0.8;
  const strings: Automation[] = GUITAR_STRINGS.map((n, k) => {
    const points: [number, number][] = [[0, GUITAR_TUNED[k]!]];
    for (const bar of BARS) {
      const was = points.at(-1)![1];
      const cents = heavy(bar) ? random() * 20 : 0;
      const tension = Math.round(GUITAR_TUNED[k]! * Math.pow(2, (2 * cents) / 1200) * 10) / 10; // pitch goes as sqrt(tension)
      if (tension !== was) points.push([bar.start - 0.02, was], [bar.start, tension]);
    }
    return { page: 'guitar', device: 'guitar', control: `${n}.tension`, points };
  });
  const per = (control: string, value: (heat: number) => number): Automation => {
    const points: [number, number][] = [];
    for (const block of BLOCKS) {
      const v = Math.round(value(HEAT[block.section]) * 1000) / 1000;
      if (points.length) points.push([block.start - 0.05, points.at(-1)![1]]);
      points.push([block.start, v]);
    }
    return { page: 'guitar', device: 'guitar', control, points };
  };
  return [...strings, per('pluck.strength', (h) => 0.5 + 0.4 * h), per('pluck.position', (h) => 0.1 - 0.05 * h)];
}

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
    // the guitar's amp and pedal: driven throughout, both pushed hard for C, a rhythm crunch for D
    per('guitar', 'guitar', 'amp.gain', { C: 0.9, D: 0.7, rest: 0.45 }),
    per('guitar', 'guitar', 'drive.gain', { C: 0.85, D: 0.6, rest: 0.35 }),
    // its echo: a touch in A, more in B, most in A' (the riff answering itself), dry in C and D
    per('mixer', 'mixer', 'ch3.aux2', { intro: 0.18, A: 0.22, B: 0.32, A2: 0.45, C: 0.08, D: 0.08, B2: 0.3, rest: 0.18 }),
    // D is the free bass's: its overdrive on and its fader up (4 dB) to lead
    per('bass2', 'bass', 'drive.mix', { D: 1, rest: 0 }),

    per('mixer', 'mixer', 'ch2.fader', { D: 0.57, rest: 0.36 }),
    ...freakOut(),
  ];
}

export function oddHours(): Song {
  // the dub bass on flatwounds, each string pulled to the tension that tunes it (as in Steppers Sermon)
  const flat = (name: keyof typeof GAUGES) => Math.round(tensionFor({ ...GAUGES[name], winding: 'flat' }, SCALES.long, midiToHz(GAUGES[name].note)) * 10) / 10;
  return {
    id: 'odd-hours',
    title: 'Odd Hours',
    artist: 'The MOA Band',
    bpm: 138,
    key: 'A major',
    bars: BARS.length,
    beatsPerBar: 4,
    barBeats: BARS.map((bar) => bar.eighths / 2),
    sleeve: { art: 'flats', colors: ['#1d1e22', '#e8742c', '#ffd25e', '#4a9be0'] },
    // as they stand on stage: guitar, drums, the dub bass, the free bass
    band: ['guitar', 'kit', 'bass', 'bass2', 'reverb', 'delay'],
    inputs: { ch1: 'MOA-BASS', ch2: 'MOA-BASS 2', ch3: 'MOA-GUITAR', line1: 'MOA-KIT' },
    setup: {
      guitar: { guitar: { controls: {
        // the bridge humbucker into the overdrive into a pushed amp: less polite
        'pickup.select': 'bridge', 'pickup.type': 'humbucker', tone: 8, 'pluck.style': 'pick', 'pluck.position': 0.1, 'pluck.strength': 0.55,
        strum: 'down', 'strum.time': 8, 'drive.mix': 1, 'drive.gain': 0.35, 'drive.tone': 2800, 'drive.level': 0.45,
        'amp.gain': 0.45, 'amp.mid': 2, 'amp.treble': 1, 'cab.type': '2x12', 'cab.blend': 0.9, level: 0.6,
      } } },
      bass: { bass: { controls: {
        'string.winding': 'flat', 'E.tension': flat('E'), 'A.tension': flat('A'), 'D.tension': flat('D'), 'G.tension': flat('G'),
        'pluck.style': 'finger', 'pluck.position': 0.17, 'pluck.strength': 0.55, 'pickup.position': 0.16, tone: 1400, palm: 0.12,
        'amp.gain': 0.3, 'amp.bass': 3, 'amp.mid': -2, 'amp.treble': -5, 'cab.type': '8x10', 'cab.mic': 'off-axis', 'cab.blend': 0.65, level: 0.9,
      } } },
      // the free bass: roundwounds, a pick near the bridge, the pickup by the bridge, the amp pushed a little
      bass2: { bass: { controls: {
        'drive.gain': 0.25, 'drive.tone': 2400, 'drive.level': 0.55, // stamped on for D: growl, not fuzz
        'pluck.style': 'pick', 'pluck.position': 0.07, 'pluck.strength': 0.5, 'pickup.position': 0.08, tone: 5000,
        'amp.gain': 0.4, 'amp.mid': 3, 'amp.treble': 2, 'cab.type': '4x10', 'cab.blend': 0.5, level: 0.8,
      } } },
      kit: { kit: { controls: { 'snare.wires': 0.35 } } },
      // a dotted eighth at 138 bpm (326 ms), bright enough to hear the guitar's notes come back
      delay: { delay: { controls: { 'delay.time': 326, 'delay.feedback': 0.4, 'delay.tone': 3800, 'delay.wobble': 0.12, 'delay.drive': 0.1, 'delay.spread': 0.6 } } },
      reverb: { reverb: { controls: { 'reverb.size': 'medium', 'reverb.lowcut': 250, 'reverb.damp': 6000, 'reverb.predelay': 20 } } },
      mixer: { mixer: { controls: {
        // panned as they stand: the guitar left, the kit in the middle, the basses right of it. Balanced by measured
        // level over a full pass (each strip's meter, post-fader): the guitar 5 dB under the kit, the dub bass 1, the free bass 4
        'ch1.fader': 0.69, 'ch1.pan': 0.15, 'ch1.aux1': 0.05,
        'ch2.fader': 0.36, 'ch2.pan': 0.5, 'ch2.aux1': 0.15, 'ch2.aux2': 0.15,
        'ch3.fader': 0.23, 'ch3.pan': -0.5, 'ch3.aux1': 0.06, 'ch3.aux2': 0.18,
        'line1.fader': 1.5, 'line1.aux1': 0.12,
        'ret1.fader': 0.8, 'ret2.fader': 0.7,
      } } },
    },
    tracks: { guitar: harder(guitar(), 0.15, heatAt), kit: kit(), bass: dubBass(), bass2: freeBass() },
    automation: automation(),
    sections: BLOCKS.map((block) => ({
      name: NAMES[block.section], from: block.start, to: block.start + blockBeats(block),
      meter: `${block.eighths % 2 === 0 ? block.eighths / 2 : block.eighths}/${block.eighths % 2 === 0 ? 4 : 8}`, heat: HEAT[block.section],
    })),
    // straight, except the breaks, which the whole band swings: the A riff's turn bars in eighths, B's fills in sixteenths
    swung: BARS.filter(swungBar).map((bar) => ({
      from: bar.start, to: bar.start + bar.eighths / 2, amount: bar.section === 'B' || bar.section === 'B2' ? 62 : 60, grid: bar.section === 'B' || bar.section === 'B2' ? 16 : 8,
    })),
    humanise: { timing: { kit: 4, bass: 9, bass2: 8, guitar: 5 }, velocity: 0.07, layback: { kit: { 38: 5 } } },
  };
}

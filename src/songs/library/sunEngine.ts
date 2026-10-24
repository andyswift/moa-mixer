import { GAUGES, GUITAR_GAUGES, GUITAR_SCALES, SCALES, midiToHz, tensionFor } from '../../domain/devices/bassPhysics';
import { GUITAR_STRINGS } from '../../domain/devices/electricGuitar';
import { seeded, withDynamics } from '../feel';
import { note } from '../generators';
import type { Automation, NoteEvent, Song } from '../types';

/**
 * An original psych jam for two basses, a guitar and a drum kit (working title): a motorik groove, a one-chord vamp on
 * E, the guitar wandering through a long tape echo, and fuzz at the peaks. 120 bpm, E dorian, all in 4/4.
 *
 * Intro, V, J, P, S, V′, P′, a last chord (`PLAN`).
 *
 * Intro: the guitar's volume swells into the echo, a floor tom pulse coming up under them. V (the vamp): motorik on
 * the hats, the dub bass driving eighths on E, the free bass's three-note figure in dotted eighths across the bar, the
 * guitar's theme over its open low E. J (the jam): E to A every four bars, the kit on the ride, the guitar's lead
 * bending notes up into the echo. P (the peak): fuzz, a stoner riff on power chords with both basses under it, the
 * guitarist freaking out, ending on three stops. S (space): the kit down to the bell, the echo running away, the free
 * bass taking off through its drive, then a build. V′: the vamp back, the theme an octave up, sixteenths on the hats.
 * P′: the riff again. The last chord rings into the echo.
 */
type Section = 'intro' | 'V' | 'J' | 'P' | 'S' | 'V2' | 'end';
const PLAN: [Section, number][] = [['intro', 8], ['V', 16], ['J', 16], ['P', 8], ['S', 8], ['V2', 16], ['P', 8], ['end', 2]];

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

/** The jam's chord for a bar: E for four bars, then A (the dorian IV, major). As a shift from E. */
const chordJ = (bar: Bar) => (bar.section === 'J' && Math.floor(bar.i / 4) % 2 === 1 ? 5 : 0);

// ---- the parts' figures ----

/** The guitar's theme, two bars ([eighth, note, length in eighths]), over the open low E: E dorian, the C# its colour. */
const THEME: [number, number, number][][] = [
  [[0, 64, 1], [1, 67, 1], [2, 69, 1], [3, 71, 2], [5, 74, 1], [6, 71, 1], [7, 69, 1]],
  [[0, 67, 1], [1, 69, 1], [2, 73, 2], [4, 71, 2], [6, 69, 1], [7, 67, 1]],
];
/**
 * The guitar's lead in the jam, two bars a phrase ([eighth, note, length in eighths, bend in semitones]): the note is
 * fretted, then bent up (by string tension) and let down after it ends. A bent note always has a rest after it, so the
 * strings are back in tune before the next is picked.
 */
const LEAD: [number, number, number, number?][][] = [
  [[0, 71, 3], [4, 74, 1], [5, 74, 3, 2], [10, 71, 1], [11, 69, 1], [12, 67, 3]],
  [[0, 64, 1], [1, 67, 1], [2, 69, 1], [3, 71, 2], [6, 74, 1], [7, 71, 1], [8, 69, 4, 2], [14, 67, 1], [15, 64, 1]],
  [[0, 73, 2], [2, 76, 2], [4, 78, 1], [5, 76, 1], [6, 73, 2], [8, 69, 1], [9, 71, 5, 2]],
  [[0, 81, 3], [3, 79, 1], [4, 78, 1], [5, 76, 1], [6, 73, 2], [8, 74, 4, 2], [14, 76, 1], [15, 78, 1]],
  [[0, 79, 1], [1, 81, 1], [2, 83, 4, 2], [8, 83, 1], [9, 81, 1], [10, 79, 1], [11, 78, 1], [12, 76, 4]],
  [
    ...[76, 74, 71, 74, 76, 79, 76, 74].map((n, k): [number, number, number] => [k / 2, n, 0.5]),
    [4, 71, 1], [5, 69, 1], [6, 67, 2], [8, 64, 1], [9, 67, 1], [10, 69, 5, 2],
  ],
  [[0, 81, 6, 2], [8, 83, 1], [9, 81, 1], [10, 78, 1], [11, 76, 1], [12, 73, 2], [14, 76, 2]],
  [[0, 74, 2], [2, 73, 2], [4, 71, 1], [5, 69, 1], [6, 71, 4, 2], [12, 69, 1], [13, 67, 1], [14, 64, 2]],
];
/** The peak's riff, two bars, by root (the guitar plays power chords on it, the basses the roots): [eighth, root, length]. */
const RIFF_P: [number, number, number][][] = [
  [[0, 40, 1.5], [1.5, 40, 0.5], [2, 43, 1], [3, 45, 1], [4, 40, 1], [5, 46, 1], [6, 45, 1], [7, 43, 1]],
  [[0, 40, 2], [2, 40, 0.5], [2.5, 40, 0.5], [3, 43, 1], [4, 45, 1], [5, 46, 0.5], [5.5, 45, 0.5], [6, 43, 1], [7, 40, 0.5], [7.5, 40, 0.5]],
];
/** The peak's last bar: three stops, then nothing. */
const STOPS = [0, 1.5, 3];
const power = (root: number) => [root, root + 7, root + 12];
/** The dub bass's vamp, two bars on E (shifted up for A): driving eighths, the octave, a walk up into the next. */
const VAMP: [number, number, number][][] = [
  [[0, 28, 1.5], [1.5, 40, 0.5], [2, 28, 1], [3, 38, 0.5], [3.5, 40, 0.5], [4, 28, 1.5], [5.5, 40, 0.5], [6, 31, 1], [7, 33, 1]],
  [[0, 28, 1.5], [1.5, 40, 0.5], [2, 28, 1], [3, 38, 0.5], [3.5, 40, 0.5], [4, 28, 1.5], [5.5, 40, 0.5], [6, 35, 1], [7, 38, 1]],
];
/** The free bass's figure: three notes in dotted eighths, so it turns against the bar (E, D, B; shifted up for A). */
const FIGURE = [52, 50, 47] as const;
/** The free bass's line in S, two bars ([eighth, note, length]): taking off through the drive and the echo. */
const FLIGHT: [number, number, number][] = [
  [0, 52, 1], [1, 55, 0.5], [1.5, 57, 0.5], [2, 59, 1], [3, 62, 1], [4, 64, 2], [6, 62, 0.5], [6.5, 59, 0.5], [7, 57, 1],
  [8, 55, 1], [9, 52, 0.5], [9.5, 50, 0.5], [10, 47, 2], [12, 49, 1], [13, 50, 1], [14, 52, 2],
];

function guitar(): NoteEvent[] {
  const out: NoteEvent[] = [];
  const random = seeded(1969);
  for (const bar of BARS) {
    const { section, i } = bar;
    if (section === 'intro') {
      // a swell every two bars (the volume pedal is the fader's automation), the last over the open E
      const swells = [[71, 76], [69, 74], [73, 76], [40, 71, 76]];
      if (i % 2 === 0) play(out, bar, 0, swells[i / 2]!, 15, 70);
    } else if (section === 'V' || section === 'V2') {
      const up = section === 'V2' && i < 8 ? 12 : 0;
      for (const [e, p, len] of THEME[i % 2]!) play(out, bar, e, p + up, len, e === 0 || e === 3 ? 90 : 76);
      // the open low E under it, let ring or struck again on 3 (as it falls under the hand)
      if (random() < 0.35) { play(out, bar, 0, 40, 3.5, 84); play(out, bar, 4, 40, 3.5, 70); } else play(out, bar, 0, 40, 4, 84);
    } else if (section === 'J') {
      if (i % 2 === 0) for (const [e, p, len] of LEAD[i / 2]!) play(out, bar, e, p, len, len >= 3 ? 96 : 84);
    } else if (section === 'P') {
      if (i === 7) for (const e of STOPS) play(out, bar, e, power(40), 0.9, 120);
      else for (const [e, root, len] of RIFF_P[i % 2]!) play(out, bar, e, power(root), len * 0.9, e === 0 ? 118 : 106);
    } else if (section === 'S') {
      // a few chords left to the runaway echo, then tremolo picking up into V′
      const stabs: Record<number, [number, number[]]> = { 0: [0, [64, 71, 74, 78]], 2: [3, [69, 73, 76]], 4: [0, [67, 71, 74, 78]] };
      if (stabs[i]) play(out, bar, stabs[i]![0], stabs[i]![1], 1, 72);
      if (i >= 6) for (let s = 0; s < 16; s++) play(out, bar, s / 2, 64, 0.45, 40 + (i - 6) * 32 + s * 2);
    } else if (section === 'end') {
      if (i === 0) play(out, bar, 0, [40, 47, 52, 54, 59, 64], 15, 100); // Eadd9, left to ring
    }
  }
  return out;
}

function dubBass(): NoteEvent[] {
  const out: NoteEvent[] = [];
  const random = seeded(1970);
  for (const bar of BARS) {
    const { section, i } = bar;
    if (section === 'intro') {
      if (i === 6) play(out, bar, 0, 28, 15, 96);
    } else if (section === 'V' || section === 'V2' || section === 'J') {
      const shift = chordJ(bar);
      const inKey = (p: number) => (p % 12 === 0 ? p + 1 : p); // on A, the walk up from G moves to C: the dorian's C#
      for (const [e, p, len] of VAMP[i % 2]!) {
        if (e % 1 && random() < 0.15) continue; // an octave pop let go now and then
        play(out, bar, e, inKey(p + shift), len, e === 0 ? 108 : e % 1 ? 84 : 94);
      }
      if (random() < 0.4) play(out, bar, 2.5, 28 + shift, 0.12, 36); // a dead note in the gap
    } else if (section === 'P') {
      if (i === 7) for (const e of STOPS) play(out, bar, e, 28, 0.9, 118);
      else for (const [e, root, len] of RIFF_P[i % 2]!) play(out, bar, e, root - 12, len * 0.9, e === 0 ? 116 : 104);
    } else if (section === 'S') {
      if (i < 6 && i % 2 === 0) play(out, bar, 0, 28, 15, 84); // a long low E
      else if (i >= 6) for (let e = 0; e < 8; e++) play(out, bar, e, 28, 0.8, 70 + (i - 6) * 20 + e * 3);
    } else {
      if (i === 0) play(out, bar, 0, 28, 15, 112);
    }
  }
  return out;
}

function freeBass(): NoteEvent[] {
  const out: NoteEvent[] = [];
  for (const block of BLOCKS) {
    const bars = barsOf(block);
    const { section } = block;
    if (section === 'V' || section === 'V2' || section === 'J') {
      // the figure in dotted eighths (three sixteenths) right through the block, the first of every four leaned on
      const from = section === 'V' ? 4 : 0; // in V, it comes in on the fifth bar
      const end = block.start + bars.length * 4;
      for (let k = 0, t = block.start + from * 4; t < end - 1e-9; k++, t += 0.75) {
        const bar = bars[Math.floor((t - block.start) / 4)]!;
        const up = section === 'V2' ? 12 : 0;
        out.push(note(t, 0.6, FIGURE[k % 3]! + chordJ(bar) + up, k % 4 === 0 ? 96 : 82));
      }
    }
    for (const bar of bars) {
      const { i } = bar;
      if (section === 'intro') {
        if (i === 4 || i === 6) play(out, bar, 0, i === 4 ? 52 : 47, 15, 72);
      } else if (section === 'P') {
        // the riff with the dub bass, an octave up; single notes (a driven bass goes muddy on double-stops)
        if (i === 7) for (const e of STOPS) play(out, bar, e, 40, 0.9, 100);
        else for (const [e, root, len] of RIFF_P[i % 2]!) play(out, bar, e, root, len * 0.9, e === 0 ? 100 : 92);
      } else if (section === 'S') {
        // his flight, the second time round dropped an octave for the first half; then pumping into the build. Never
        // hard: a bass picked hard by the bridge goes sharp
        if (i < 6 && i % 2 === 0) for (const [e, p, len] of FLIGHT) play(out, bar, e, p - (i === 2 && e < 8 ? 12 : 0), len, e % 2 === 0 ? 96 : 86);
        else if (i >= 6) for (let e = 0; e < 8; e++) play(out, bar, e, 40, 0.8, 70 + (i - 6) * 14 + e * 2);
      } else if (section === 'end') {
        if (i === 0) play(out, bar, 0, [40, 47], 15, 96);
      }
    }
  }
  return out;
}

function kit(): NoteEvent[] {
  const out: NoteEvent[] = [];
  const random = seeded(1971);
  // every stroke a little different, as a drummer's are
  const hit = (bar: Bar, e: number, n: number, vel: number) => play(out, bar, e, n, 0.4, Math.round(vel * (0.94 + 0.12 * random())));
  /** A fill on the last two beats, one of three, picked as the drummer feels it. */
  const fills = [
    [KIT.snare, KIT.snare, KIT.tom, KIT.tom, KIT.floor, KIT.floor, KIT.floor, KIT.kick],
    [KIT.snare, KIT.tom, KIT.snare, KIT.tom, KIT.floor, KIT.kick, KIT.floor, KIT.floor],
    [KIT.tom, KIT.tom, KIT.tom, KIT.floor, KIT.floor, KIT.snare, KIT.snare, KIT.kick],
  ];
  const fill = (bar: Bar, from: number) => fills[Math.floor(random() * fills.length)]!.forEach((n, s) => hit(bar, from + s / 2, n, 84 + s * 4));
  for (const bar of BARS) {
    const { section, i } = bar;
    if (section === 'intro') {
      // a floor tom pulse coming up under the swells, then a roll into V
      if (i >= 4) for (const e of [0, 2, 4, 6]) hit(bar, e, KIT.floor, 44 + (i - 4) * 12 + e * 2);
      if (i === 7) for (let s = 0; s < 8; s++) hit(bar, 4 + s / 2, KIT.snare, 60 + s * 7);
    } else if (section === 'V' || section === 'V2') {
      // motorik: the hats straight through (sixteenths in V′), the kick on 1, the and of 2 and 3, the snare on 2 and 4
      const per = section === 'V2' ? 2 : 1;
      for (let s = 0; s < 8 * per; s++) {
        const e = s / per;
        if (i % 4 === 3 && e === 7) hit(bar, e, KIT.openHat, 78);
        else if (e === 3 && random() < 0.12) hit(bar, e, KIT.openHat, 66); // a hat lifted on the and of 2
        else if (e % 1 && random() < 0.12) continue; // a sixteenth left out
        else if (!(i % 4 === 3 && e > 7)) hit(bar, e, KIT.hat, e % 2 === 0 ? 76 : e % 1 ? 40 : 56);
      }
      hit(bar, 0, KIT.kick, 110); hit(bar, 3, KIT.kick, 92); hit(bar, 4, KIT.kick, 104);
      hit(bar, 2, KIT.snare, 104);
      if (random() < 0.35) hit(bar, random() < 0.5 ? 3.5 : 5.5, KIT.snare, 28); // a ghost note
      if (i % 8 === 7) fill(bar, 4);
      else hit(bar, 6, KIT.snare, 106);
      if (i === 0) hit(bar, 0, KIT.crash, 108);
    } else if (section === 'J') {
      // the same groove opened up on the ride, ghost notes on the snare, a crash at every change of chord
      // (the bell now and then on 4, the kick's push and the ghost notes not every bar)
      for (let e = 0; e < 8; e++) hit(bar, e, e === 6 && random() < 0.25 ? KIT.bell : KIT.ride, e % 2 === 0 ? 84 : 62);
      hit(bar, 0, KIT.kick, 110); hit(bar, 3, KIT.kick, 92); hit(bar, 4, KIT.kick, 104);
      if (random() < 0.6) hit(bar, 5.5, KIT.kick, 80);
      hit(bar, 2, KIT.snare, 106);
      for (const g of [1.5, 3.5, 4.5, 7.5]) if (random() < 0.65) hit(bar, g, KIT.snare, 30);
      if (i % 4 === 0) hit(bar, 0, KIT.crash, 104);
      if (i % 4 === 3) fill(bar, 4);
      else hit(bar, 6, KIT.snare, 108);
    } else if (section === 'P') {
      if (i === 7) {
        for (const e of STOPS) { hit(bar, e, KIT.kick, 124); hit(bar, e, KIT.crash, 120); hit(bar, e, KIT.snare, 118); }
        continue;
      }
      // heavy: the kick with the riff, the snare on 2 and 4 hard, washing on the ride, a crash every bar
      for (let e = 0; e < 8; e++) hit(bar, e, KIT.ride, e % 2 === 0 ? 98 : 80);
      hit(bar, 0, KIT.crash, 116);
      for (const e of i % 2 ? [0, 2.5, 4, 7] : [0, 1.5, 4, 5]) hit(bar, e, KIT.kick, 118);
      hit(bar, 2, KIT.snare, 118);
      if (i === 6) fill(bar, 4);
      else hit(bar, 6, KIT.snare, 118);
    } else if (section === 'S') {
      // down to the bell and a soft floor tom, then a snare build into V′
      if (i < 6) {
        for (const e of [0, 2, 4, 6]) hit(bar, e, KIT.bell, e === 0 ? 62 : 46);
        hit(bar, 0, KIT.floor, 58); hit(bar, 5, KIT.floor, 48);
      } else for (let s = 0; s < 16; s++) hit(bar, s / 2, KIT.snare, 40 + (i - 6) * 40 + s * 2);
    } else {
      if (i === 0) { hit(bar, 0, KIT.kick, 124); hit(bar, 0, KIT.crash, 124); hit(bar, 0, KIT.floor, 118); }
    }
  }
  return out;
}

/** How heavy each section is: the guitarist freaks out at the peaks; the free bass takes off in S (`lead`). */
const HEAT: Record<Section, number> = { intro: 0.05, V: 0.3, J: 0.55, P: 1, S: 0.15, V2: 0.45, end: 0.3 };
/**
 * How loud the band plays at a beat (1 as written), all of them together: the vamp and the jam slowly building (a
 * motorik groove climbs, it does not jump), the peaks all out, the space down low until its build, and every four-bar
 * phrase easing off after its first bar and swelling through its last, and into each new section.
 */
function level(beat: number): number {
  const k = Math.min(BARS.length - 1, Math.floor(beat / 4));
  const bar = BARS[k]!;
  const { section, i } = bar;
  const through = (beat - bar.start) / 4;
  const base = {
    intro: 0.85 + (0.1 * i) / 7, V: 0.86 + (0.1 * i) / 15, J: 0.92 + (0.1 * i) / 15, P: 1.08,
    S: i < 6 ? 0.62 : 0.62 + (0.4 * (i - 6 + through)) / 2, V2: 0.94 + (0.08 * i) / 15, end: 1,
  }[section];
  const last = BARS[k + 1]?.i === 0;
  const p = i % 4;
  return base * ([1, 0.94, 0.96, 0.98][p]! + (p === 3 || last ? 0.08 * through : 0));
}
const NAMES: Record<Section, string> = { intro: 'Intro', V: 'Vamp', J: 'Jam', P: 'Peak', S: 'Space', V2: 'Vamp′', end: 'End' };
/** The guitar's strings at the tension that tunes them (as the guitar comes). */
const GUITAR_TUNED = GUITAR_STRINGS.map((n) => Math.round(tensionFor(GUITAR_GAUGES[n], GUITAR_SCALES['25.5"'], midiToHz(GUITAR_GAUGES[n].note)) * 10) / 10);
/** Tension for a pitch shift in cents (pitch goes as the square root of tension). */
const tensionAt = (k: number, cents: number) => Math.round(GUITAR_TUNED[k]! * Math.pow(2, (2 * cents) / 1200) * 10) / 10;

/** The lead's bent notes: where each is struck and how long it lasts (in beats), and by how many semitones. */
function bends(): { t: number; len: number; by: number }[] {
  const out: { t: number; len: number; by: number }[] = [];
  for (const bar of BARS) {
    if (bar.section !== 'J' || bar.i % 2 !== 0) continue;
    for (const [e, , len, by] of LEAD[bar.i / 2]!) if (by) out.push({ t: bar.start + e / 2, len: len / 2, by });
  }
  return out;
}

/**
 * The guitar's six string tensions over the song: in the jam, every string pulled up together for a bent note (the
 * lead is single notes, so whichever string it is on bends) and let down after it; at the peaks the guitarist freaking
 * out, each string drifting up to 10 cents a new way every bar, back in tune after. Seeded, so every pass is the same.
 */
function strings(): Automation[] {
  let seed = 1969;
  const random = () => { seed = (seed * 1664525 + 1013904223) >>> 0; return seed / 4294967296 - 0.5; };
  const drifts = BARS.map((bar) => GUITAR_STRINGS.map(() => (HEAT[bar.section] >= 0.8 ? random() * 20 : 0)));
  return GUITAR_STRINGS.map((n, k) => {
    const points: [number, number][] = [[0, GUITAR_TUNED[k]!]];
    const to = (beat: number, tension: number) => {
      const was = points.at(-1)![1];
      if (tension === was) return;
      points.push([beat - 0.02, was], [beat, tension]);
    };
    BARS.forEach((bar, b) => to(bar.start, tensionAt(k, drifts[b]![k]!)));
    for (const { t, len, by } of bends()) {
      // held a moment, pulled up over an eighth, held to the note's end, let down (the note is released by then)
      points.push([t + 0.12, GUITAR_TUNED[k]!], [t + 0.4, tensionAt(k, by * 100)], [t + len, tensionAt(k, by * 100)], [t + len + 0.15, GUITAR_TUNED[k]!]);
    }
    points.sort((a, b) => a[0] - b[0]);
    return { page: 'guitar', device: 'guitar', control: `${n}.tension`, points };
  });
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
  const level = per('mixer', 'mixer', 'ch3.fader', { J: 0.3, P: 0.2, rest: 0.24 });
  // the intro's swells: the guitar's fader (a volume pedal) up from nothing over each chord, down before the next
  const swells: [number, number][] = [];
  for (let k = 0; k < 4; k++) swells.push([k * 8, 0], [k * 8 + 3, 0.24], ...(k < 3 ? [[k * 8 + 7.6, 0.24] as [number, number]] : []));
  level.points = [...swells, ...level.points.filter(([b]) => b >= 32)];
  // the echo running away in S: the feedback climbing for six bars, then pulled back for the build
  const space = BLOCKS.find((b) => b.section === 'S')!.start;
  const feedback: Automation = {
    page: 'delay', device: 'delay', control: 'delay.feedback',
    points: [[0, 0.6], [32, 0.5], [space, 0.5], [space + 24, 0.88], [space + 26, 0.45], [space + 32, 0.5], [BLOCKS.at(-1)!.start, 0.65]],
  };
  return [
    level,
    feedback,
    // the guitar: the drive on all the way, into fuzz with the amp cranked at the peaks
    per('guitar', 'guitar', 'drive.gain', { intro: 0.3, J: 0.55, P: 0.95, S: 0.35, end: 0.5, rest: 0.45 }),
    per('guitar', 'guitar', 'amp.gain', { J: 0.6, P: 0.9, rest: 0.5 }),
    per('guitar', 'guitar', 'pluck.strength', { P: 0.9, J: 0.6, rest: 0.5 }),
    // its echo: deep for the swells and the space, a good deal for the lead, little at the peaks; reverb with it
    per('mixer', 'mixer', 'ch3.aux2', { intro: 0.55, V: 0.22, J: 0.4, P: 0.1, S: 0.6, V2: 0.28, end: 0.5, rest: 0.25 }),
    per('mixer', 'mixer', 'ch3.aux1', { intro: 0.3, S: 0.3, end: 0.3, rest: 0.1 }),
    // the free bass: its drive on for the peaks and his flight, and into the echo for it
    per('bass2', 'bass', 'drive.mix', { P: 1, S: 1, rest: 0 }),
    per('mixer', 'mixer', 'ch2.aux2', { S: 0.4, rest: 0.1 }),
    per('mixer', 'mixer', 'ch2.fader', { S: 0.5, rest: 0.33 }), // his figure is accompaniment: a touch under
    ...strings(),
  ];
}

export function sunEngine(): Song {
  // the dub bass on flatwounds, each string pulled to the tension that tunes it (as in Odd Hours)
  const flat = (name: keyof typeof GAUGES) => Math.round(tensionFor({ ...GAUGES[name], winding: 'flat' }, SCALES.long, midiToHz(GAUGES[name].note)) * 10) / 10;
  return {
    id: 'sun-engine',
    title: 'Sun Engine',
    artist: 'The MOA Band',
    bpm: 120,
    key: 'E dorian',
    bars: BARS.length,
    beatsPerBar: 4,
    sleeve: { art: 'aurora', colors: ['#24103a', '#ff6b2c', '#ffd23f', '#9b4dca'] },
    band: ['guitar', 'kit', 'bass', 'bass2', 'reverb', 'delay'],
    inputs: { ch1: 'MOA-BASS', ch2: 'MOA-BASS 2', ch3: 'MOA-GUITAR', line1: 'MOA-KIT' },
    setup: {
      guitar: { guitar: { controls: {
        // the bridge humbucker, the overdrive into a pushed amp and a 4x12: fuzzy, warm, thick
        'pickup.select': 'bridge', 'pickup.type': 'humbucker', tone: 6, 'pluck.style': 'pick', 'pluck.position': 0.12, 'pluck.strength': 0.5,
        strum: 'down', 'strum.time': 10, 'drive.mix': 1, 'drive.gain': 0.3, 'drive.tone': 2200, 'drive.level': 0.4,
        'amp.gain': 0.5, 'amp.bass': 2, 'amp.mid': 3, 'amp.treble': -1, 'cab.type': '4x12', 'cab.blend': 0.95, level: 0.6,
      } } },
      bass: { bass: { controls: {
        'string.winding': 'flat', 'E.tension': flat('E'), 'A.tension': flat('A'), 'D.tension': flat('D'), 'G.tension': flat('G'),
        'pluck.style': 'pick', 'pluck.position': 0.14, 'pluck.strength': 0.55, 'pickup.position': 0.16, tone: 1600, palm: 0.08,
        'amp.gain': 0.4, 'amp.bass': 4, 'amp.mid': 0, 'amp.treble': -4, 'cab.type': '8x10', 'cab.mic': 'off-axis', 'cab.blend': 0.65, level: 0.9,
      } } },
      // the free bass: roundwounds, a pick, the drive stamped on at the peaks and for his flight
      bass2: { bass: { controls: {
        'drive.gain': 0.4, 'drive.tone': 2000, 'drive.level': 0.5,
        'pluck.style': 'pick', 'pluck.position': 0.08, 'pluck.strength': 0.5, 'pickup.position': 0.08, tone: 4500,
        'amp.gain': 0.4, 'amp.mid': 3, 'amp.treble': 1, 'cab.type': '4x10', 'cab.blend': 0.5, level: 0.8,
      } } },
      kit: { kit: { controls: { 'snare.wires': 0.4 } } },
      // a dotted eighth at 120 bpm (375 ms), darker and wobblier than Odd Hours': a tape echo
      delay: { delay: { controls: { 'delay.time': 375, 'delay.feedback': 0.5, 'delay.tone': 2600, 'delay.wobble': 0.35, 'delay.drive': 0.3, 'delay.spread': 0.8 } } },
      reverb: { reverb: { controls: { 'reverb.size': 'large', 'reverb.lowcut': 300, 'reverb.damp': 5000, 'reverb.predelay': 40 } } },
      mixer: { mixer: { controls: {
        // as Odd Hours: the guitar left, the kit in the middle, the basses right of it
        'ch1.fader': 0.69, 'ch1.pan': 0.15, 'ch1.aux1': 0.05,
        'ch2.fader': 0.36, 'ch2.pan': 0.5, 'ch2.aux1': 0.15, 'ch2.aux2': 0.1,
        'ch3.fader': 0, 'ch3.pan': -0.5, 'ch3.aux1': 0.3, 'ch3.aux2': 0.55,
        'line1.fader': 1.5, 'line1.aux1': 0.14,
        'ret1.fader': 0.85, 'ret2.fader': 0.75,
      } } },
    },
    tracks: {
      guitar: withDynamics(guitar(), level),
      kit: withDynamics(kit(), level),
      bass: withDynamics(dubBass(), level),
      bass2: withDynamics(freeBass(), level, 100),
    },
    automation: automation(),
    sections: BLOCKS.map((block) => ({
      name: NAMES[block.section], from: block.start, to: block.start + barsOf(block).length * 4, meter: '4/4', heat: HEAT[block.section],
    })),
    humanise: { timing: { kit: 5, bass: 8, bass2: 9, guitar: 7 }, velocity: 0.08, layback: { kit: { 38: 6 } } },
  };
}

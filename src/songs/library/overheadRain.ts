import { at16, chordAt, note, steps } from '../generators';
import { mixerSettings } from '../mixes';
import type { NoteEvent, Song } from '../types';

/**
 * An original atmospheric jungle tune on Gaute's live breaks: 170 bpm, F minor, Fm9 - Dbmaj9 - Bbm9 - Csus two bars
 * each. The drums are the MOA-60's "Gaute Breaks" kit: the 170 roller cut in eighths and played back in order, edited,
 * and doubled with the 135 funk break pitched up to 170 for the busier parts, with snare-slice rolls into each section.
 * Under it a rolling sub, a choir pad, glass bells and a pan flute, all deep in the reverb.
 *
 * Bars 1-8: the pad and bells, the sparse break fading in. 9-16: the roller. 17-24: the roller and the funk break.
 * 25-28: the break-down, a snare build. 29-32: everything, into a last hit.
 */
const BARS = 32;
const MPC = 36; // MIDI note of pad A01; pad i is note 36 + i
const ROLLER = 0, FUNK = 16, WHOLE = 48; // first pads of bank A (roller), B (funk) and D (whole loops)
const SPARSE_LOOP = WHOLE + 4;
const section = (bar: number) => (bar < 8 ? 'intro' : bar < 16 ? 'roll' : bar < 24 ? 'roll2' : bar < 28 ? 'break' : 'final');

const ROOTS = [41, 37, 34, 36]; // F2 Db2 Bb1 C2
const PADS = [[56, 60, 63, 67], [56, 60, 63, 65], [56, 60, 61, 65], [55, 58, 60, 65]]; // Fm9, Dbmaj9, Bbm9, Csus
// the bells: four bars, [bar, step, length, note]
const BELLS: [number, number, number, number][] = [
  [0, 0, 4, 84], [0, 6, 2, 80], [0, 8, 8, 79], [1, 4, 4, 77], [1, 10, 6, 75],
  [2, 0, 6, 77], [2, 8, 8, 72], [3, 4, 4, 75], [3, 10, 6, 77],
];
const FLUTE: [number, number, number, number][] = [
  [0, 0, 12, 72], [0, 12, 4, 75], [1, 0, 16, 77], [2, 0, 8, 80], [2, 8, 8, 79], [3, 0, 16, 75],
];

/** A two-bar phrase of slices: [step 0-31, pad, velocity]. */
type Phrase = [number, number, number][];
/** The roller as it was played: its sixteen eighth-note slices in order. */
const rollerAsPlayed: Phrase = Array.from({ length: 16 }, (_, k) => [2 * k, ROLLER + k, 112]);
/** An edit: the second bar's kicks moved, the pickup snare doubled, a ghost slice pushed late. */
const rollerEdit: Phrase = [
  [0, ROLLER, 115], [2, ROLLER + 1, 100], [4, ROLLER + 2, 100], [6, ROLLER + 3, 110], [8, ROLLER + 4, 118], [10, ROLLER + 5, 100],
  [12, ROLLER + 6, 100], [14, ROLLER + 7, 110], [16, ROLLER + 8, 115], [19, ROLLER + 3, 100], [22, ROLLER + 10, 108],
  [24, ROLLER + 12, 118], [26, ROLLER + 13, 100], [28, ROLLER + 6, 96], [30, ROLLER + 15, 110], [31, ROLLER + 7, 92],
];
const funkAsPlayed: Phrase = Array.from({ length: 16 }, (_, k) => [2 * k, FUNK + k, 88]);
/** The last bar of a section: the roller's first bar, then a snare-slice roll getting louder and faster. */
const fill: Phrase = [
  ...rollerAsPlayed.filter(([s]) => s < 16),
  [16, ROLLER + 8, 112], [20, ROLLER + 4, 80], [22, ROLLER + 4, 88], [24, ROLLER + 4, 94], [26, ROLLER + 4, 100],
  [27, ROLLER + 4, 104], [28, ROLLER + 4, 108], [29, ROLLER + 4, 112], [30, ROLLER + 4, 118], [31, ROLLER + 4, 124],
];

function drums(): NoteEvent[] {
  const out: NoteEvent[] = [];
  const play = (bar: number, phrase: Phrase) => {
    for (const [s, pad, vel] of phrase) out.push(note(at16(bar + Math.floor(s / 16), s % 16), steps(2), MPC + pad, vel));
  };
  for (let bar = 0; bar < BARS; bar += 2) {
    const sec = section(bar);
    const last = bar % 8 === 6; // the last two bars of every eight
    if (sec === 'intro') {
      if (bar >= 4) out.push(note(at16(bar, 0), steps(32), MPC + SPARSE_LOOP, 90)); // the sparse loop, whole, fading in
    } else if (sec === 'roll') play(bar, last ? fill : bar % 4 === 0 ? rollerAsPlayed : rollerEdit);
    else if (sec === 'roll2' || sec === 'final') {
      if (bar === BARS - 2) {
        play(bar, rollerAsPlayed.filter(([s]) => s < 16));
        out.push(note(at16(bar + 1, 0), steps(4), MPC + ROLLER, 124)); // the last hit
        continue;
      }
      play(bar, last ? fill : bar % 4 === 0 ? rollerAsPlayed : rollerEdit);
      if (!last) play(bar, funkAsPlayed);
    } else if (bar === 26) {
      // the build: the roller's snare slice in eighths, then sixteenths
      play(bar, [...Array.from({ length: 8 }, (_, k): [number, number, number] => [2 * k, ROLLER + 4, 70 + 3 * k]),
        ...Array.from({ length: 16 }, (_, k): [number, number, number] => [16 + k, ROLLER + 4, 94 + 2 * k])]);
    }
  }
  return out;
}

/** The sub: long notes on the root that roll with the break, out for the first bars of the break-down. */
function bass(): NoteEvent[] {
  const out: NoteEvent[] = [];
  for (let bar = 4; bar < BARS; bar++) {
    if (bar === 24 || bar === 25) continue;
    const root = chordAt(ROOTS, bar, 2);
    if (bar === BARS - 1) { out.push(note(at16(bar, 0), steps(8), root, 110)); continue; }
    if (bar % 2 === 0) out.push(note(at16(bar, 0), steps(9), root, 110), note(at16(bar, 10), steps(5.5), root, 100));
    else out.push(note(at16(bar, 0), steps(5.5), root, 108), note(at16(bar, 6), steps(3.5), root + 7, 96), note(at16(bar, 10), steps(5.5), root, 104));
  }
  return out;
}

function pad(): NoteEvent[] {
  const out: NoteEvent[] = [];
  for (let bar = 0; bar < BARS; bar += 2) for (const n of chordAt(PADS, bar, 2)) out.push(note(at16(bar, 0), steps(31), n, bar < 4 ? 50 : 62));
  return out;
}

function bells(): NoteEvent[] {
  const out: NoteEvent[] = [];
  for (let bar = 0; bar < BARS - 1; bar += 4) {
    if (section(bar) === 'break') continue;
    for (const [b, s, len, n] of BELLS) out.push(note(at16(bar + b, s), steps(len), n, 70 + (b % 2 === 0 ? 8 : 0)));
  }
  return out;
}

function flute(): NoteEvent[] {
  const out: NoteEvent[] = [];
  for (const start of [16, 24, 28]) for (const [b, s, len, n] of FLUTE) out.push(note(at16(start + b, s), steps(len), n, 80));
  return out;
}

export function overheadRain(): Song {
  const mix = mixerSettings({
    duck: 0,
    reverb: { ch1: 0, ch2: 0.35, line1: 0.45, line2: 0.1, line4: 0.4 },
    delay: { line1: 0.25, line4: 0.2 },
    // balanced by measured RMS (headless Chrome, a full pass) around the breaks, which lead: the sub 6 dB under them,
    // the pad 12, the flute 13 and the bells 13
    faders: { ch1: 0.26, ch2: 0.17, line1: 0.52, line2: 1.5, line4: 0.1 },
  });
  return {
    id: 'overhead-rain',
    title: 'Overhead Rain',
    artist: 'MOA Swift feat. Gaute',
    bpm: 170,
    key: 'F minor',
    bars: BARS,
    beatsPerBar: 4,
    sleeve: { art: 'aurora', colors: ['#0b1d2a', '#3e7c8c', '#c9e4de', '#f2c14e'] },
    band: ['mpc', 'synth', 'poly', 'lynch', 'pipe', 'reverb', 'delay', 'buscomp'],
    inputs: { line2: 'MOA-60' }, // the breaks on the second stereo strip (no DUO in this one)
    setup: {
      mpc: { mpc: { preset: 1, controls: { 'mpc.level': 1.5 } } }, // Gaute Breaks
      synth: { synth: { preset: 1 } }, // Sub Bass
      poly: { poly: { preset: 10 } }, // Choir Air
      lynch: { lynch: { preset: 22 } }, // Glass
      pipe: { pipe: { preset: 8 } }, // Pan Flute
      delay: { delay: { controls: { 'delay.time': 264.7, 'delay.feedback': 0.4 } } }, // a dotted eighth at 170
      reverb: { reverb: { controls: { 'reverb.size': 'large', 'reverb.lowcut': 250, 'reverb.predelay': 25 } } },
      ...mix,
    },
    tracks: { mpc: drums(), synth: bass(), poly: pad(), lynch: bells(), pipe: flute() },
    automation: [
      // the sparse break fades in under the intro
      { page: 'mixer', device: 'mixer', control: 'line2.fader', points: [[0, 0.4], [16, 0.4], [32, 1.5]] },
    ],
    humanise: { timing: { synth: 2, poly: 8, lynch: 4, pipe: 6 }, velocity: 0.08 },
    localOnly: true, // a candidate until it is approved
  };
}

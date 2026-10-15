import { at16, chordAt, DRUM, note, steps } from '../generators';
import { mixerSettings } from '../mixes';
import type { NoteEvent, Song } from '../types';

/** An original driving trance tune: 138 bpm, F# minor, the loop F#m - D - A - E, a bar a chord. Sixteen bars. */
const BARS = 16;
const ROOTS = [30, 26, 33, 28]; // F#1 D1 A1 E1
const PADS = [[54, 57, 61, 66], [50, 54, 57, 62], [57, 61, 64, 69], [56, 59, 64, 68]];
const TOPS = [78, 74, 76, 71]; // the pulsing riff's pitch on each chord
// the riff's accent pattern over a bar of 16ths (1 = loud, 0 = ghost, -1 = rest)
const ACCENT = [1, 0, 0, 1, 0, 0, 1, 0, 1, 0, 0, 1, 0, 1, 0, -1];
const section = (bar: number) => (bar < 4 ? 'build' : bar < 8 ? 'drop' : bar < 10 ? 'break' : bar < 12 ? 'build2' : 'drop2');
const isDrop = (bar: number) => section(bar) === 'drop' || section(bar) === 'drop2';

const parts = {
  drums(): NoteEvent[] {
    const out: NoteEvent[] = [];
    for (let bar = 0; bar < BARS; bar++) {
      const sec = section(bar);
      for (let s = 0; s < 16; s++) {
        const t = at16(bar, s);
        const hit = (len: number, pitch: number, vel: number) => out.push(note(t, steps(len), pitch, vel));
        if (sec === 'break') { if (s % 4 === 2 && bar === 9) hit(1, DRUM.closedHat, 50); continue; }
        if (s % 4 === 0 && (bar > 0 || sec !== 'build')) hit(1, DRUM.kick, isDrop(bar) ? 125 : 100);
        if (s % 4 === 2) hit(1, DRUM.closedHat, isDrop(bar) ? 92 : 66);
        if (bar >= 2 && (s === 4 || s === 12)) hit(1, DRUM.clap, isDrop(bar) ? 112 : 84);
        if (isDrop(bar) && s === 14) hit(2, DRUM.openHat, 80);
        if ((bar === 3 || bar === 11) && s >= 8) hit(1, DRUM.snare, 62 + (s - 8) * 8);
        if (isDrop(bar) && bar !== BARS - 1 && s % 2 === 1 && bar % 2 === 1) hit(1, DRUM.closedHat, 44);
        if ((bar === 4 || bar === 12) && s === 0) hit(6, DRUM.ride, 118);
      }
    }
    return out;
  },
  bass(): NoteEvent[] {
    const out: NoteEvent[] = [];
    for (let bar = 2; bar < BARS; bar++) {
      if (section(bar) === 'break') continue;
      for (const s of [2, 6, 10, 14]) out.push(note(at16(bar, s), steps(1.8), chordAt(ROOTS, bar, 1) + 12, 108)); // offbeat bass
    }
    return out;
  },
  pad(): NoteEvent[] {
    const out: NoteEvent[] = [];
    for (let bar = 0; bar < BARS; bar++) for (const n of chordAt(PADS, bar, 1)) out.push(note(at16(bar, 0), steps(15.5), n, isDrop(bar) ? 56 : 44));
    return out;
  },
  riff(): NoteEvent[] {
    const out: NoteEvent[] = [];
    for (let bar = 4; bar < BARS; bar++) {
      if (!isDrop(bar)) continue;
      for (let s = 0; s < 16; s++) {
        const a = ACCENT[s]!;
        if (a < 0) continue;
        out.push(note(at16(bar, s), steps(0.8), chordAt(TOPS, bar, 1) + (s % 8 === 6 ? 12 : 0), a === 1 ? 104 : 62));
      }
    }
    return out;
  },
  acid(): NoteEvent[] {
    const out: NoteEvent[] = [];
    for (let bar = 8; bar < 12; bar++) for (let s = 0; s < 16; s += 2) out.push(note(at16(bar, s), steps(1.4), chordAt(PADS, bar, 1)[(s / 2) % 3]! + 24, 40 + s * 2)); // rising arpeggio through the break and build
    return out;
  },
  strings(): NoteEvent[] {
    const out: NoteEvent[] = [];
    for (let bar = 8; bar < BARS; bar += 2) out.push(note(at16(bar, 0), steps(31), chordAt(PADS, bar, 1)[3]! + 12, 70));
    return out;
  },
  bell(): NoteEvent[] {
    const out: NoteEvent[] = [];
    for (let bar = 4; bar < BARS; bar += 2) out.push(note(at16(bar, 0), steps(14), chordAt(PADS, bar, 1)[2]! + 24, 74));
    return out;
  },
};

export function saltFlats(): Song {
  return {
    id: 'salt-flats',
    title: 'Salt Flats',
    artist: 'MOA Swift',
    bpm: 138,
    key: 'F# minor',
    bars: BARS,
    beatsPerBar: 4,
    sleeve: { art: 'flats', colors: ['#f3e3c1', '#e6c88e', '#3a1d46'] },
    band: ['drums', 'synth', 'poly', 'lynch', 'duo', 'df2', 'pipe'],
    setup: {
      synth: { synth: { preset: 6 } }, // Rubber Bass
      poly: { poly: { preset: 9 } }, // Analog Poly
      lynch: { lynch: { preset: 12 } }, // Lead Pulse
      duo: { duo: { preset: 2 } }, // Hard Sync Lead (rising arpeggio)
      df2: { lynch: { preset: 3 }, box: { preset: 3, controls: { 'f1.res': 0.3, 'f2.res': 0.26, 'delay.level': 0.08 } } }, // String Ensemble into Screaming Madman
      pipe: { pipe: { preset: 5 } }, // Glass Bell
      mixer: mixerSettings({
        drums: { kick: 1.15, snare: 1.0, clap: 1.1, rest: 1.0 },
        duck: 0.3,
        reverb: { ch5: 0.3, ch2: 0.18, line1: 0.2, line2: 0.2, line3: 0.25, line4: 0.35 },
        delay: { line1: 0.14, line2: 0.1, line3: 0.16 },
        faders: { line1: 0.55, line2: 0.6, line3: 0.8 },
      }),
    },
    tracks: { drums: parts.drums(), synth: parts.bass(), poly: parts.pad(), lynch: parts.riff(), duo: parts.acid(), df2: parts.strings(), pipe: parts.bell() },
    automation: [
      { page: 'df2', device: 'box', control: 'f1.cutoff', curve: 'exp', points: [[0, 700], [32, 700], [36, 2200], [40, 2200], [40.1, 600], [48, 4200], [48.1, 900], [64, 900]] },
      { page: 'df2', device: 'box', control: 'f2.cutoff', curve: 'exp', points: [[0, 900], [32, 900], [36, 2800], [40, 2800], [40.1, 750], [48, 5000], [48.1, 1100], [64, 1100]] },
    ],
    humanise: { timing: { drums: 5, synth: 6, poly: 11, lynch: 6, duo: 8, pipe: 9, df2: 9 }, velocity: 0.1, swing: 0.02, layback: { drums: { 39: 3 } } },
  };
}

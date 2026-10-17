import { arpeggio, at16, chordAt, DRUM, note, steps } from '../generators';
import { DRUM_PUNCH, mixerSettings, STANDARD_EFFECTS } from '../mixes';
import type { NoteEvent, Song } from '../types';

/** An original dream-trance tune: 132 bpm, B minor, the loop Bm - G - D - A, two bars a chord. Sixteen bars. */
const BARS = 16;
const ROOTS = [35, 31, 38, 33]; // B1 G1 D2 A1
const PADS = [[59, 62, 66, 69], [55, 59, 62, 66], [57, 62, 66, 69], [57, 61, 64, 69]];
// the tune: eighth-note steps (0-7) in a bar, pitches over each chord, stepwise like a piano line
const LINE = [
  [78, 76, 74, 76, 78, 81, 78, 76],
  [74, 73, 71, 73, 74, 78, 76, 74],
  [78, 76, 74, 73, 74, 76, 78, 81],
  [76, 74, 73, 74, 76, 73, 71, 73],
];
const section = (bar: number) => (bar < 4 ? 'intro' : bar < 8 ? 'verse' : bar < 12 ? 'lift' : 'outro');

const parts = {
  drums(): NoteEvent[] {
    const out: NoteEvent[] = [];
    for (let bar = 2; bar < BARS; bar++) {
      const sec = section(bar);
      for (let s = 0; s < 16; s++) {
        const t = at16(bar, s);
        const hit = (len: number, pitch: number, vel: number) => out.push(note(t, steps(len), pitch, vel));
        if (s % 4 === 0 && (sec !== 'outro' || bar < 15)) hit(1, DRUM.kick, sec === 'intro' ? 100 : 122);
        if (bar >= 4 && (s === 4 || s === 12)) { hit(1, DRUM.snare, 100); hit(1, DRUM.clap, 90); }
        if (bar >= 3 && s % 4 === 2) hit(1, DRUM.closedHat, 80);
        if (sec === 'lift' && s % 2 === 1) hit(1, DRUM.closedHat, 46);
        if (bar >= 6 && s === 14) hit(2, DRUM.openHat, 74);
        if (bar === 7 && s >= 8) hit(1, DRUM.snare, 60 + (s - 8) * 9);
        if (bar === 8 && s === 0) hit(6, DRUM.ride, 110);
      }
    }
    return out;
  },
  bass(): NoteEvent[] {
    const out: NoteEvent[] = [];
    for (let bar = 3; bar < BARS; bar++) for (let s = 0; s < 16; s += 2) out.push(note(at16(bar, s), steps(1.8), chordAt(ROOTS, bar, 2) + (s % 4 === 2 ? 12 : 0), 100));
    return out;
  },
  pad(): NoteEvent[] {
    const out: NoteEvent[] = [];
    for (let bar = 0; bar < BARS; bar += 2) for (const n of chordAt(PADS, bar, 2)) out.push(note(at16(bar, 0), steps(31), n, bar < 4 ? 40 : 52));
    return out;
  },
  line(): NoteEvent[] {
    const out: NoteEvent[] = [];
    for (let bar = 0; bar < BARS; bar++) {
      if (section(bar) === 'outro' && bar > 13) continue;
      const pitches = LINE[Math.floor(bar / 2) % 4]!;
      for (let e = 0; e < 8; e++) out.push(note(at16(bar, e * 2), steps(3), pitches[e]! - (section(bar) === 'intro' ? 0 : 0), section(bar) === 'intro' ? 64 : 80));
    }
    return out;
  },
  bells(): NoteEvent[] {
    const out: NoteEvent[] = [];
    for (let bar = 4; bar < BARS; bar += 2) out.push(note(at16(bar, 8), steps(8), chordAt(PADS, bar, 2)[2]! + 24, 66));
    return out;
  },
  hold(): NoteEvent[] {
    const out: NoteEvent[] = [];
    for (let bar = 8; bar < 14; bar += 2) out.push(note(at16(bar, 0), steps(31), chordAt(PADS, bar, 2)[1]! + 12, 62));
    return out;
  },
  double(): NoteEvent[] {
    const out: NoteEvent[] = [];
    for (let bar = 8; bar < 12; bar++) { const pitches = LINE[Math.floor(bar / 2) % 4]!; for (let e = 0; e < 8; e += 2) out.push(note(at16(bar, e * 2), steps(5), pitches[e]! - 12, 58)); }
    return out;
  },
  arp(): NoteEvent[] {
    const out: NoteEvent[] = [];
    for (let bar = 8; bar < 12; bar++) out.push(...arpeggio(bar, chordAt(PADS, bar, 2).map((n) => n + 12), 2, 1.5, 40));
    return out;
  },
};

export function glassGarden(): Song {
  return {
    id: 'glass-garden',
    title: 'Glass Garden',
    artist: 'MOA Swift',
    bpm: 132,
    key: 'B minor',
    bars: BARS,
    beatsPerBar: 4,
    sleeve: { art: 'garden', colors: ['#1f7a74', '#ff8fb1', '#fff4df'] },
    band: ['drums', 'synth', 'poly', 'lynch', 'duo', 'df2', 'pipe', ...STANDARD_EFFECTS],
    setup: {
      drums: DRUM_PUNCH,
      synth: { synth: { preset: 1 } }, // Sub Bass
      poly: { poly: { preset: 0 } }, // Soft Pad
      lynch: { lynch: { preset: 17 } }, // Harp
      duo: { duo: { preset: 11 } }, // Infinite Cathedral
      df2: { lynch: { preset: 6 }, box: { preset: 13, controls: { 'f1.res': 0.22, 'f2.res': 0.2, 'delay.level': 0.1 } } }, // Slow Pad into Ghost Pad
      pipe: { pipe: { preset: 5 } }, // Glass Bell
      ...mixerSettings({
        drums: { kick: 1.05, snare: 1.0, clap: 1.0, rest: 0.9 },
        duck: 0.3,
        reverb: { ch4: 0.3, ch5: 0.32, ch2: 0.3, line1: 0.3, line2: 0.3, line3: 0.28, line4: 0.4 },
        delay: { line1: 0.2, line3: 0.18 },
        faders: { line1: 0.6, line2: 0.55 },
      }),
    },
    tracks: { drums: parts.drums(), synth: parts.bass(), poly: parts.pad(), lynch: parts.line(), pipe: parts.bells(), df2: parts.hold(), duo: parts.arp() },
    automation: [
      { page: 'df2', device: 'box', control: 'f1.cutoff', curve: 'exp', points: [[0, 500], [28, 500], [32, 2600], [44, 3200], [52, 700], [64, 700]] },
      { page: 'df2', device: 'box', control: 'f2.cutoff', curve: 'exp', points: [[0, 650], [28, 650], [32, 3200], [44, 4000], [52, 900], [64, 900]] },
    ],
    humanise: { timing: { drums: 5, synth: 6, poly: 12, lynch: 8, duo: 9, pipe: 9, df2: 9 }, velocity: 0.1, swing: 0.03, layback: { drums: { 38: 4, 39: 4 } } },
  };
}

import { at16, chordAt, DRUM, note, steps } from '../generators';
import { DRUM_PUNCH, mixerSettings, STANDARD_EFFECTS } from '../mixes';
import type { NoteEvent, Song } from '../types';

/**
 * A dev-only loop for tweaking the MOA-1: the Squelch Theory acid line (slides and accents) over a kick and a soft
 * off-beat hat, with no automation, so every fader stays where you put it. Open the MOA-1 from the record's band
 * chips while it plays. Never published (localOnly).
 */
const BARS = 8;
const ROOT = 45; // A2
const SHIFT = [0, 0, -4, -2]; // A A F G, a bar each
const SLIDE = 1.25, SHORT = 0.55;
const ACID: [number, number, number][][] = [
  [[0, 0, SHORT], [1, 0, SHORT], [2, 12, SLIDE], [3, 0, SHORT], [5, 0, SHORT], [6, 3, SLIDE], [7, 5, SHORT],
    [8, 0, SHORT], [9, 12, SHORT], [10, 0, SHORT], [11, 10, SLIDE], [12, 12, SHORT], [14, 7, SHORT], [15, 3, SHORT]],
  [[0, 0, SHORT], [2, 0, SHORT], [3, 12, SHORT], [4, 0, SLIDE], [5, -2, SHORT], [6, 0, SHORT], [8, 15, SLIDE],
    [9, 12, SHORT], [10, 0, SHORT], [12, 0, SHORT], [13, 3, SLIDE], [14, 5, SHORT], [15, 7, SHORT]],
];
const ACCENTS = [new Set([2, 7, 9, 12]), new Set([3, 8, 13])];

function acid(): NoteEvent[] {
  const out: NoteEvent[] = [];
  for (let bar = 0; bar < BARS; bar++) {
    const root = ROOT + chordAt(SHIFT, bar, 1);
    const which = bar % 2;
    for (const [s, semis, len] of ACID[which]!) out.push(note(at16(bar, s), steps(len), root + semis, ACCENTS[which]!.has(s) ? 127 : 96));
  }
  return out;
}

function drums(): NoteEvent[] {
  const out: NoteEvent[] = [];
  for (let bar = 0; bar < BARS; bar++) {
    for (let s = 0; s < 16; s += 4) out.push(note(at16(bar, s), steps(1), DRUM.kick, 118));
    for (let s = 2; s < 16; s += 4) out.push(note(at16(bar, s), steps(1), DRUM.openHat, 60));
  }
  return out;
}

export function acidWorkbench(): Song {
  return {
    id: 'acid-workbench',
    title: 'Acid Workbench',
    artist: 'MOA Swift (dev loop)',
    bpm: 124,
    key: 'A minor',
    bars: BARS,
    beatsPerBar: 4,
    sleeve: { art: 'frost', colors: ['#101010', '#f4dd1e', '#3dd6ff'] },
    band: ['drums', 'synth', ...STANDARD_EFFECTS],
    setup: {
      drums: DRUM_PUNCH,
      synth: { synth: { preset: 19 } }, // Acid Fold: Acid Squelch through the wavefolder
      ...mixerSettings({ drums: { kick: 1.0, snare: 1.0, clap: 1.0, rest: 0.8 }, duck: 0.15, delay: { ch1: 0.1 }, faders: { ch1: 0.95 } }),
    },
    tracks: { drums: drums(), synth: acid() },
    automation: [],
    humanise: { timing: { drums: 2, synth: 2 }, velocity: 0.04, swing: 0.07 },
    localOnly: true,
  };
}

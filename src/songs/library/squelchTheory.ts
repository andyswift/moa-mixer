import { at16, chordAt, DRUM, note, steps } from '../generators';
import { DRUM_PUNCH, mixerSettings, STANDARD_EFFECTS } from '../mixes';
import type { NoteEvent, Song } from '../types';

/**
 * An original acid house tune, 124 bpm, A minor, the loop Am - Am - F - G, two bars a chord. Twenty-four bars: an
 * intro of kick, hats and a murmuring acid line; a groove with clap and stabs as the filter opens; a breakdown with
 * no kick, a choir pad and a resonant sweep ending in a snare roll; and a peak with a second acid line on top, whose
 * filter closes again over the last two bars so the loop runs back into the intro.
 *
 * The acid line is the MOA-1 on Acid Squelch. It slides like a 303: a note held over the start of the next one
 * glides into it without retriggering (legato), so slides are written as notes a little longer than a step.
 */
const BARS = 24;
const ROOT = 45; // A2 (the patch's 16' range puts it an octave lower)
const SHIFT = [0, 0, -4, -2]; // Am Am F G: the bass line moves with the chord, two bars each
const STABS = [[57, 60, 64, 67], [57, 60, 64, 67], [57, 60, 65, 69], [55, 59, 62, 67]]; // Am7 Am7 F G (voiced around middle C)
const PAD = [[57, 64, 69, 72], [57, 64, 69, 72], [53, 60, 65, 69], [55, 62, 67, 71]];
const section = (bar: number) => (bar < 4 ? 'intro' : bar < 12 ? 'groove' : bar < 16 ? 'break' : 'peak');

// acid patterns: [step, semitones above the root, length in steps]; a length over 1 slides into the next note
const SLIDE = 1.25, SHORT = 0.55;
const ACID: [number, number, number][][] = [
  [[0, 0, SHORT], [1, 0, SHORT], [2, 12, SLIDE], [3, 0, SHORT], [5, 0, SHORT], [6, 3, SLIDE], [7, 5, SHORT],
    [8, 0, SHORT], [9, 12, SHORT], [10, 0, SHORT], [11, 10, SLIDE], [12, 12, SHORT], [14, 7, SHORT], [15, 3, SHORT]],
  [[0, 0, SHORT], [2, 0, SHORT], [3, 12, SHORT], [4, 0, SLIDE], [5, -2, SHORT], [6, 0, SHORT], [8, 15, SLIDE],
    [9, 12, SHORT], [10, 0, SHORT], [12, 0, SHORT], [13, 3, SLIDE], [14, 5, SHORT], [15, 7, SHORT]],
];
// the DUO's counter-line in the peak, an octave and a half up: [step, semitones above A3, length]
const COUNTER: [number, number, number][] = [[0, 0, 1.5], [3, 3, 1], [6, 7, 1.5], [8, 0, 1], [10, 10, 1.5], [12, 7, 1], [14, 3, 1.5]];

const parts = {
  drums(): NoteEvent[] {
    const out: NoteEvent[] = [];
    for (let bar = 0; bar < BARS; bar++) {
      const sec = section(bar);
      for (let s = 0; s < 16; s++) {
        const hit = (pitch: number, vel: number, len = 1) => out.push(note(at16(bar, s), steps(len), pitch, vel));
        const fill = bar === BARS - 1 && s >= 12;
        if (sec !== 'break' && s % 4 === 0 && !fill) hit(DRUM.kick, s === 0 ? 124 : 116);
        if ((sec === 'groove' || sec === 'peak') && (s === 4 || s === 12)) hit(DRUM.clap, 112);
        // hats: 16ths with the off-beat 8ths opening from bar 3; just the off-beats in the first two bars
        const openBeat = s % 4 === 2;
        if (openBeat && bar >= 2 && sec !== 'break') hit(DRUM.openHat, 86, 1);
        else if (openBeat) hit(DRUM.closedHat, sec === 'break' ? 70 : 92);
        else if (s % 2 === 1 && bar >= 2) hit(DRUM.closedHat, sec === 'break' ? 40 : 58);
        if (sec === 'peak' && s % 4 === 0) hit(DRUM.ride, 64);
        // the build at the end of the breakdown, and a short fill to close the loop
        if (bar === 15) hit(DRUM.snare, Math.round(46 + s * 5));
        if (bar === 11 && s >= 12) hit(DRUM.snare, 70 + (s - 12) * 12);
        if (fill) hit(DRUM.snare, 80 + (s - 12) * 12);
      }
    }
    return out;
  },
  acid(): NoteEvent[] {
    const out: NoteEvent[] = [];
    for (let bar = 0; bar < BARS; bar++) {
      const root = ROOT + chordAt(SHIFT, bar, 2);
      const pattern = ACID[section(bar) === 'break' ? 0 : bar % 2]!;
      for (const [s, semis, len] of pattern) out.push(note(at16(bar, s), steps(len), root + semis, 100));
    }
    return out;
  },
  stabs(): NoteEvent[] {
    const out: NoteEvent[] = [];
    for (let bar = 4; bar < BARS; bar++) {
      const sec = section(bar);
      if (sec === 'break') continue;
      const chord = chordAt(STABS, bar, 2);
      const hits = sec === 'peak' ? [2, 6, 10, 13] : [2, 6, 10];
      for (const s of hits) for (const n of chord) out.push(note(at16(bar, s), steps(0.9), n, sec === 'peak' ? 96 : 88));
    }
    return out;
  },
  pad(): NoteEvent[] {
    const out: NoteEvent[] = [];
    for (let bar = 12; bar < 20; bar += 2) {
      const vel = bar < 16 ? 70 : 48; // full in the breakdown, a soft bed under the first half of the peak
      for (const n of chordAt(PAD, bar, 2)) out.push(note(at16(bar, 0), steps(31.5), n, vel));
    }
    return out;
  },
  counter(): NoteEvent[] {
    const out: NoteEvent[] = [];
    for (let bar = 16; bar < 22; bar++) {
      const root = 57 + chordAt(SHIFT, bar, 2);
      for (const [s, semis, len] of COUNTER) out.push(note(at16(bar, s), steps(len), root + semis, 96));
    }
    return out;
  },
};

export function squelchTheory(): Song {
  return {
    id: 'squelch-theory',
    title: 'Squelch Theory',
    artist: 'MOA Swift',
    bpm: 124,
    key: 'A minor',
    bars: BARS,
    beatsPerBar: 4,
    sleeve: { art: 'hands', colors: ['#121212', '#f4dd1e', '#ff3d8b'] },
    band: ['drums', 'synth', 'lynch', 'poly', 'duo', ...STANDARD_EFFECTS],
    setup: {
      drums: DRUM_PUNCH,
      synth: { synth: { preset: 2, controls: { 'perf.notes': 'legato', 'perf.glide': 0.07 } } }, // Acid Squelch, slides on overlapping notes
      lynch: { lynch: { preset: 23 } }, // Funk Stab
      poly: { poly: { preset: 10 } }, // Choir Air
      duo: { duo: { preset: 4 } }, // Resonant Squelch
      delay: { delay: { controls: { 'delay.time': 363, 'delay.feedback': 0.42, 'delay.tone': 2600 } } }, // a dotted eighth at 124 bpm
      ...mixerSettings({
        drums: { kick: 1.15, snare: 1.0, clap: 1.0, rest: 0.9 },
        duck: 0.2,
        reverb: { ch5: 0.25, ch2: 0.35, line1: 0.22, line2: 0.15 },
        delay: { ch1: 0.12, line1: 0.18, line2: 0.2 },
        faders: { ch1: 0.62, ch2: 0.45, line1: 0.5, line2: 0.42 },
      }),
    },
    tracks: { drums: parts.drums(), synth: parts.acid(), lynch: parts.stabs(), poly: parts.pad(), duo: parts.counter() },
    // the acid filter is the song: it opens through the groove, sweeps the breakdown, opens wide at the peak and closes for the loop
    automation: [
      { page: 'synth', device: 'synth', control: 'filter.cutoff', curve: 'exp',
        points: [[0, 170], [16, 240], [46, 1100], [48, 480], [62, 1900], [64, 650], [84, 2600], [90, 1200], [96, 170]] },
      { page: 'synth', device: 'synth', control: 'filter.resonance', points: [[0, 11], [48, 13], [62, 18], [64, 14], [84, 16], [96, 11]] },
      { page: 'synth', device: 'synth', control: 'filterEnv.amount', points: [[0, 2.6], [46, 4.2], [64, 3.8], [84, 5.4], [96, 2.6]] },
    ],
    humanise: { timing: { drums: 3, synth: 2, lynch: 6, poly: 10, duo: 4 }, velocity: 0.06, swing: 0.07, layback: { drums: { 39: 4 } } },
    localOnly: true, // a candidate until approved
  };
}

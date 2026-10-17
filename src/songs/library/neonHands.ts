import { arpeggio, at16, chordAt, DRUM, note, steps } from '../generators';
import { DRUM_PUNCH, mixerSettings, STANDARD_EFFECTS } from '../mixes';
import { pluck2600 } from '../m2600Sounds';
import type { NoteEvent, Song } from '../types';

/** An original synth-pop tune: 118 bpm, D minor, the loop Dm - Bb - F - C, a bar a chord. Twelve bars. */
const BARS = 12;
const ROOTS = [38, 34, 41, 36]; // D2 Bb1 F2 C2
const PADS = [[62, 65, 69], [58, 62, 65], [60, 65, 69], [60, 64, 67]];
const PLUCKS = [[65, 69, 74], [62, 65, 70], [65, 69, 72], [64, 67, 72]]; // marimba broken chords
// the hook, one phrase over the four chords: [step, length in steps, pitch]
const HOOK: [number, number, number][][] = [
  [[0, 2, 69], [2, 2, 69], [4, 2, 74], [6, 2, 77], [8, 4, 76], [12, 4, 74]],
  [[0, 2, 70], [2, 2, 70], [4, 2, 74], [6, 2, 77], [8, 4, 74], [12, 4, 70]],
  [[0, 2, 72], [2, 2, 72], [4, 2, 77], [6, 2, 81], [8, 4, 79], [12, 4, 77]],
  [[0, 2, 72], [2, 2, 76], [4, 2, 79], [6, 2, 76], [8, 8, 72]],
];
const section = (bar: number) => (bar < 2 ? 'intro' : bar < 6 ? 'verse' : bar < 10 ? 'chorus' : 'outro');

function drums(): NoteEvent[] {
  const out: NoteEvent[] = [];
  for (let bar = 2; bar < BARS; bar++) {
    const fade = bar >= 10;
    for (let s = 0; s < 16; s++) {
      const t = at16(bar, s);
      const hit = (len: number, pitch: number, vel: number) => out.push(note(t, steps(len), pitch, Math.round(vel * (fade ? 0.8 : 1))));
      if (s === 0 || s === 8 || (s === 6 && bar % 2 === 1)) hit(1, DRUM.kick, 118);
      if (s === 4 || s === 12) { hit(1, DRUM.snare, 112); hit(1, DRUM.clap, 100); }
      if (s % 2 === 0) hit(1, DRUM.closedHat, s % 4 === 2 ? 88 : 66);
      if (s === 14 && bar % 2 === 0) hit(2, DRUM.openHat, 80);
      if (bar === 5 && s >= 12) hit(1, DRUM.snare, 70 + (s - 12) * 14); // roll into the chorus
    }
  }
  return out;
}

const lines = {
  bass(): NoteEvent[] {
    const out: NoteEvent[] = [];
    for (let bar = 2; bar < BARS; bar++) for (let s = 0; s < 16; s += 2) out.push(note(at16(bar, s), steps(1.8), chordAt(ROOTS, bar, 1) + (s % 4 === 2 ? 12 : 0), 104));
    return out;
  },
  pad(): NoteEvent[] {
    const out: NoteEvent[] = [];
    for (let bar = 0; bar < BARS; bar++) for (const n of chordAt(PADS, bar, 1)) out.push(note(at16(bar, 0), steps(15.5), n, bar < 2 ? 45 : 58));
    return out;
  },
  plucks(): NoteEvent[] {
    const out: NoteEvent[] = [];
    for (let bar = 0; bar < BARS; bar++) if (section(bar) !== 'chorus') out.push(...arpeggio(bar, chordAt(PLUCKS, bar, 1), 2, 1.6, section(bar) === 'intro' ? 62 : 74));
    return out;
  },
  hook(): NoteEvent[] {
    const out: NoteEvent[] = [];
    for (let bar = 6; bar < 10; bar++) for (const [s, len, n] of HOOK[bar % 4]!) out.push(note(at16(bar, s), steps(len * 0.9), n, 92));
    for (const [s, len, n] of HOOK[0]!) out.push(note(at16(10, s), steps(len * 0.9), n, 80)); // one more time to finish
    out.push(note(at16(11, 0), steps(14), 74, 70));
    return out;
  },
  arp(): NoteEvent[] {
    const out: NoteEvent[] = [];
    for (let bar = 6; bar < 10; bar++) out.push(...arpeggio(bar, chordAt(PLUCKS, bar, 1).map((n) => n + 12), 1, 0.9, 52));
    return out;
  },
  box(): NoteEvent[] {
    const out: NoteEvent[] = [];
    for (let bar = 6; bar < 10; bar++) for (const [s, len, n] of HOOK[bar % 4]!) out.push(note(at16(bar, s), steps(len * 0.9), n - 12, 66));
    return out;
  },
};

/** The MOA-2600: a sparkly sixteenth arp over the chord, high above the DUO's, in the chorus. */
function sparkle2600(): NoteEvent[] {
  const out: NoteEvent[] = [];
  for (let bar = 6; bar < 10; bar++) {
    const [a, b, c] = chordAt(PADS, bar, 1).map((n) => n + 12);
    out.push(...arpeggio(bar, [a!, b!, c!, a! + 12, c!, b!], 1, 0.6, 72));
  }
  return out;
}

export function neonHands(): Song {
  return {
    id: 'neon-hands',
    title: 'Neon Hands',
    artist: 'MOA Swift',
    bpm: 118,
    key: 'D minor',
    bars: BARS,
    beatsPerBar: 4,
    sleeve: { art: 'hands', colors: ['#3a1d6e', '#ff4fa3', '#59d8e6'] },
    band: ['drums', 'synth', 'poly', 'lynch', 'duo', 'df2', 'pipe', 'm2600', ...STANDARD_EFFECTS],
    setup: {
      drums: DRUM_PUNCH,
      synth: { synth: { preset: 3 } }, // Fat Pulse Bass
      poly: { poly: { preset: 4 } }, // Slow Strings
      lynch: { lynch: { preset: 11 } }, // Lead Saw
      duo: { duo: { preset: 12 } }, // Pulse Sweep
      m2600: pluck2600({ 'vcf.freq': 3000, 'vcf.res': 0.25, 'adsr.decay': 0.1, 'vco2.fine': 0.12 }),
      df2: { lynch: { preset: 11 }, box: { preset: 4, controls: { 'f1.res': 0.25, 'f2.res': 0.22, 'delay.level': 0.08 } } },
      pipe: { pipe: { preset: 4 } }, // Marimba
      ...mixerSettings({
        drums: { kick: 1.1, snare: 1.1, clap: 1.05, rest: 0.95 },
        duck: 0.25,
        reverb: { ch4: 0.28, ch5: 0.3, ch2: 0.25, line1: 0.22, line4: 0.35, line3: 0.22, line5: 0.25 },
        delay: { line1: 0.14, line3: 0.16, line5: 0.18 },
        faders: { line1: 0.6, line2: 0.75, line5: 0.45 },
      }),
    },
    tracks: { drums: drums(), synth: lines.bass(), poly: lines.pad(), pipe: lines.plucks(), lynch: lines.hook(), duo: lines.arp(), df2: lines.box(), m2600: sparkle2600() },
    automation: [
      { page: 'df2', device: 'box', control: 'f1.cutoff', curve: 'exp', points: [[0, 600], [24, 600], [32, 3000], [40, 3000], [48, 900]] },
      { page: 'df2', device: 'box', control: 'f2.cutoff', curve: 'exp', points: [[0, 760], [24, 760], [32, 3800], [40, 3800], [48, 1100]] },
    ],
    humanise: { timing: { drums: 5, synth: 6, poly: 12, lynch: 8, duo: 8, pipe: 9, df2: 9, m2600: 4 }, velocity: 0.1, swing: 0.04, layback: { drums: { 38: 4, 39: 4 } } },
  };
}

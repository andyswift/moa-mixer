import { arpeggio, at16, chordAt, DRUM, note, steps } from '../generators';
import { DRUM_PUNCH, mixerSettings } from '../mixes';
import type { NoteEvent, Song } from '../types';

/**
 * An original dark-synthwave tune, 100 bpm, C minor, the loop Cm - Ab - Bb - Gm, a bar a chord.
 * Twelve bars: a pan-flute intro, a pulsing verse, a lead-and-flute chorus and an outro.
 */
const BARS = 12;
const ROOTS = [36, 32, 34, 31]; // C2 Ab1 Bb1 G1
const PADS = [[48, 55, 60, 63], [44, 51, 56, 60], [46, 53, 58, 62], [43, 50, 55, 58]];
const BRIGHT = [[72, 75, 79], [72, 77, 80], [74, 77, 82], [70, 74, 79]]; // upper chord tones for the arpeggio
// the lead, one bar per chord: [step, length in steps, pitch]
const LEAD: [number, number, number][][] = [
  [[0, 6, 79], [6, 2, 77], [8, 4, 75], [12, 4, 72]],
  [[0, 6, 80], [6, 2, 79], [8, 4, 77], [12, 4, 75]],
  [[0, 6, 82], [6, 2, 80], [8, 4, 79], [12, 4, 77]],
  [[0, 8, 79], [8, 4, 75], [12, 4, 74]],
];
// the flute's intro phrase, two bars
const FLUTE: [number, number, number, number][] = [
  [0, 0, 4, 72], [0, 4, 4, 75], [0, 8, 6, 79], [1, 0, 4, 77], [1, 4, 4, 75], [1, 8, 4, 74], [1, 12, 4, 72], // [bar, step, length, pitch]
];
const section = (bar: number) => (bar < 2 ? 'intro' : bar < 6 ? 'verse' : bar < 10 ? 'chorus' : 'outro');

const parts = {
  drums(): NoteEvent[] {
    const out: NoteEvent[] = [];
    for (let bar = 2; bar < BARS; bar++) {
      const fade = section(bar) === 'outro';
      for (let s = 0; s < 16; s++) {
        const t = at16(bar, s);
        const hit = (len: number, pitch: number, vel: number) => out.push(note(t, steps(len), pitch, Math.round(vel * (fade ? 0.75 : 1))));
        if (s === 0 || s === 6 || (s === 10 && bar % 2 === 1)) hit(1, DRUM.kick, 120);
        if (s === 8) { hit(1, DRUM.snare, 122); hit(1, DRUM.clap, 108); } // half-time: the gated crack lands on the third beat
        if (s % 2 === 0) hit(1, DRUM.closedHat, s % 4 === 2 ? 84 : 62);
        if (s === 14 && bar % 2 === 1) hit(2, DRUM.openHat, 74);
        if (bar === 5 && s >= 12) hit(1, DRUM.snare, 64 + (s - 12) * 14);
      }
    }
    return out;
  },
  bass(): NoteEvent[] {
    const out: NoteEvent[] = [];
    for (let bar = 2; bar < BARS; bar++) for (let s = 0; s < 16; s++) out.push(note(at16(bar, s), steps(0.85), chordAt(ROOTS, bar, 1) + (s % 8 === 6 ? 12 : s % 4 === 3 ? 7 : 0), s % 4 === 0 ? 108 : 86)); // pulsing 16ths
    return out;
  },
  pad(): NoteEvent[] {
    const out: NoteEvent[] = [];
    for (let bar = 0; bar < BARS; bar++) for (const n of chordAt(PADS, bar, 1)) out.push(note(at16(bar, 0), steps(15.5), n, section(bar) === 'intro' ? 40 : 54));
    return out;
  },
  lead(): NoteEvent[] {
    const out: NoteEvent[] = [];
    for (let bar = 6; bar < 10; bar++) for (const [s, len, n] of LEAD[bar % 4]!) out.push(note(at16(bar, s), steps(len * 0.92), n, 94));
    for (const [s, len, n] of LEAD[0]!) out.push(note(at16(10, s), steps(len * 0.92), n, 78)); // once more to close
    out.push(note(at16(11, 0), steps(14), 72, 66));
    return out;
  },
  flute(): NoteEvent[] {
    const out: NoteEvent[] = [];
    for (const [bar, s, len, n] of FLUTE) out.push(note(at16(bar, s), steps(len * 0.95), n, 78));
    for (let bar = 6; bar < 10; bar++) for (const [s, len, n] of LEAD[bar % 4]!) out.push(note(at16(bar, s), steps(len * 0.92), n + 12, 60)); // doubles the lead an octave up in the chorus
    return out;
  },
  cathedral(): NoteEvent[] {
    const out: NoteEvent[] = [];
    for (let bar = 0; bar < BARS; bar += 2) out.push(note(at16(bar, 0), steps(31), chordAt(PADS, bar, 1)[2]! + 12, section(bar) === 'intro' ? 58 : 50));
    return out;
  },
  arp(): NoteEvent[] {
    const out: NoteEvent[] = [];
    for (let bar = 6; bar < 10; bar++) out.push(...arpeggio(bar, chordAt(BRIGHT, bar, 1), 2, 1.5, 44));
    return out;
  },
  box(): NoteEvent[] {
    const out: NoteEvent[] = [];
    for (let bar = 2; bar < 10; bar += 2) out.push(note(at16(bar, 0), steps(31), chordAt(PADS, bar, 1)[1]! + 12, 70));
    return out;
  },
};

export function fjordLight(): Song {
  return {
    id: 'fjord-light',
    title: 'Fjord Light',
    artist: 'MOA Swift',
    bpm: 100,
    key: 'C minor',
    bars: BARS,
    beatsPerBar: 4,
    sleeve: { art: 'aurora', colors: ['#0b2a4a', '#5cffb1', '#e9eef5'] },
    band: ['drums', 'synth', 'poly', 'lynch', 'duo', 'df2', 'pipe'],
    setup: {
      drums: DRUM_PUNCH,
      synth: { synth: { preset: 6 } }, // Rubber Bass
      poly: { poly: { preset: 9 } }, // Analog Poly
      lynch: { lynch: { preset: 11 } }, // Lead Saw
      duo: { duo: { preset: 11 } }, // Infinite Cathedral
      df2: { lynch: { preset: 6 }, box: { preset: 13, controls: { 'f1.res': 0.22, 'f2.res': 0.2, 'delay.level': 0.1 } } }, // Slow Pad into Ghost Pad
      pipe: { pipe: { preset: 8 } }, // Pan Flute
      mixer: mixerSettings({
        drums: { kick: 1.1, snare: 1.05, clap: 1.0, rest: 0.9 },
        duck: 0.28,
        reverb: { ch4: 0.34, ch5: 0.38, ch2: 0.3, line1: 0.3, line2: 0.3, line3: 0.3, line4: 0.4 },
        delay: { line1: 0.2, line3: 0.18, line4: 0.14 },
        faders: { line1: 0.6, line2: 0.55, line4: 0.8 },
      }),
    },
    tracks: { drums: parts.drums(), synth: parts.bass(), poly: parts.pad(), lynch: parts.lead(), pipe: parts.flute(), duo: parts.cathedral(), df2: parts.box() },
    automation: [
      { page: 'df2', device: 'box', control: 'f1.cutoff', curve: 'exp', points: [[0, 500], [8, 500], [24, 2400], [36, 2400], [48, 700]] },
      { page: 'df2', device: 'box', control: 'f2.cutoff', curve: 'exp', points: [[0, 650], [8, 650], [24, 3000], [36, 3000], [48, 900]] },
    ],
    humanise: { timing: { drums: 5, synth: 5, poly: 12, lynch: 8, duo: 9, pipe: 9, df2: 9 }, velocity: 0.1, swing: 0.03, layback: { drums: { 38: 5, 39: 5 } } },
  };
}

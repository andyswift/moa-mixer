import { at16, chordAt, DRUM, note, steps } from '../generators';
import { DRUM_PUNCH, mixerSettings, STANDARD_EFFECTS } from '../mixes';
import type { Automation, NoteEvent, Song } from '../types';

/**
 * An original acid house tune, 124 bpm, A minor, the bass moving A - A - F - G, two bars each. Kept minimal: the 909,
 * the acid line and the MOA-2600. Twenty-four bars: an intro of kick, hats and a murmuring acid line; a groove with
 * the clap and a sparse 2600 bleep hook (the delay fills the gaps) as the acid filter opens; a breakdown with no kick
 * where the same 2600 becomes a white-noise riser into a snare roll; and a peak, whose acid filter closes again over
 * the last bars so the loop runs back into the intro.
 *
 * The acid line is the MOA-1 on Acid Squelch. It slides like a 303: a note held over the start of the next one
 * glides into it without retriggering (legato), so slides are written as notes a little longer than a step.
 */
const BARS = 24;
const ROOT = 45; // A2 (the patch's 16' range puts it an octave lower)
const SHIFT = [0, 0, -4, -2]; // Am Am F G: the bass line moves with the chord, two bars each
const section = (bar: number) => (bar < 4 ? 'intro' : bar < 12 ? 'groove' : bar < 16 ? 'break' : 'peak');

// acid patterns: [step, semitones above the root, length in steps]; a length over 1 slides into the next note.
// Accented steps (the octave jumps and the notes slid into) play at velocity 127, which the MOA-1 accents.
const SLIDE = 1.25, SHORT = 0.55;
const ACCENTS = [new Set([2, 7, 9, 12]), new Set([3, 8, 13])];
const ACID: [number, number, number][][] = [
  [[0, 0, SHORT], [1, 0, SHORT], [2, 12, SLIDE], [3, 0, SHORT], [5, 0, SHORT], [6, 3, SLIDE], [7, 5, SHORT],
    [8, 0, SHORT], [9, 12, SHORT], [10, 0, SHORT], [11, 10, SLIDE], [12, 12, SHORT], [14, 7, SHORT], [15, 3, SHORT]],
  [[0, 0, SHORT], [2, 0, SHORT], [3, 12, SHORT], [4, 0, SLIDE], [5, -2, SHORT], [6, 0, SHORT], [8, 15, SLIDE],
    [9, 12, SHORT], [10, 0, SHORT], [12, 0, SHORT], [13, 3, SLIDE], [14, 5, SHORT], [15, 7, SHORT]],
];
// the 2600's hook, two bars long: [bar of the pair, step, pitch]; the peak adds the third note
const HOOK: [number, number, number][] = [[0, 3, 76], [0, 10, 72], [1, 6, 69]];
const HOOK_PEAK: [number, number, number] = [1, 13, 74];
const BREAK = [48, 64] as const; // the breakdown in beats: bars 13-16

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
        // percussion, sparingly: a soft rimshot in the peak, and a tom run under the closing fill
        if (sec === 'peak' && (s === 7 || s === 15) && !fill) hit(DRUM.rim, 70);
        if (fill) hit([DRUM.highTom, DRUM.highTom, DRUM.midTom, DRUM.lowTom][s - 12]!, 96);
      }
    }
    return out;
  },
  acid(): NoteEvent[] {
    const out: NoteEvent[] = [];
    for (let bar = 0; bar < BARS; bar++) {
      const root = ROOT + chordAt(SHIFT, bar, 2);
      const which = section(bar) === 'break' ? 0 : bar % 2;
      for (const [s, semis, len] of ACID[which]!) out.push(note(at16(bar, s), steps(len), root + semis, ACCENTS[which]!.has(s) ? 127 : 96));
    }
    return out;
  },
  /** The 2600: a sparse bleep hook in the groove and peak, and one held note the breakdown's automation makes a riser. */
  m2600(): NoteEvent[] {
    const out: NoteEvent[] = [];
    for (let bar = 4; bar < BARS; bar++) {
      const sec = section(bar);
      if (sec === 'break') continue;
      for (const [half, s, n] of [...HOOK, ...(sec === 'peak' ? [HOOK_PEAK] : [])]) {
        if (bar % 2 === half) out.push(note(at16(bar, s), steps(1), n, 100));
      }
    }
    out.push(note(BREAK[0], BREAK[1] - BREAK[0] - 0.25, 57, 100));
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
    band: ['drums', 'synth', 'm2600', ...STANDARD_EFFECTS],
    setup: {
      drums: DRUM_PUNCH,
      synth: { synth: { preset: 2, controls: { 'perf.notes': 'legato', 'perf.glide': 0.07 } } }, // Acid Squelch, slides on overlapping notes
      // the 2600 from Init: VCO 1's pulse and a hard-synced VCO 2 through the 4072, a short plucky envelope
      m2600: { m2600: { preset: 0, controls: {
        'vco2.sync': 1, 'vco2.freq': 654, 'vcf.in.vco1': 0.7, 'vcf.in.vco2': 0.5, 'vcf.freq': 2200, 'vcf.res': 0.45, 'vcf.cv.adsr': 0.25,
        'adsr.attack': 0.001, 'adsr.decay': 0.14, 'adsr.sustain': 0, 'adsr.release': 0.12, 'noise.color': 0, 'reverb.left': 0.12, 'reverb.right': 0.12,
      } } },
      delay: { delay: { controls: { 'delay.time': 363, 'delay.feedback': 0.42, 'delay.tone': 2600 } } }, // a dotted eighth at 124 bpm
      ...mixerSettings({
        drums: { kick: 1.15, snare: 1.0, clap: 1.0, rest: 0.9 },
        duck: 0.2,
        reverb: { ch5: 0.25, ch9: 0.12, line5: 0.15 },
        delay: { ch1: 0.12, line5: 0.32 },
        faders: { ch1: 0.62, ch9: 0.8, line5: 0.5 },
      }),
    },
    tracks: { drums: parts.drums(), synth: parts.acid(), m2600: parts.m2600() },
    // the acid filter is the song: it opens through the groove, sweeps the breakdown, opens wide at the peak and closes for the loop
    automation: [
      { page: 'synth', device: 'synth', control: 'filter.cutoff', curve: 'exp',
        points: [[0, 170], [16, 240], [46, 1100], [48, 480], [62, 1900], [64, 650], [84, 2600], [90, 1200], [96, 170]] },
      { page: 'synth', device: 'synth', control: 'filter.resonance', points: [[0, 11], [48, 13], [62, 18], [64, 14], [84, 16], [96, 11]] },
      { page: 'synth', device: 'synth', control: 'filterEnv.amount', points: [[0, 2.6], [46, 4.2], [64, 3.8], [84, 5.4], [96, 2.6]] },
      // the 2600's breakdown: oscillators out, noise in, the envelope held open and a resonant sweep up into the snare roll
      ...m2600Riser(),
    ],
    // a 6 % velocity spread keeps the 127s above the accent line (110) and the 96s below it
    humanise: { timing: { drums: 3, synth: 2, m2600: 3 }, velocity: 0.06, swing: 0.07, layback: { drums: { 39: 4 } } },
  };
}

/** Automation that turns the 2600's bleep into a noise riser for the breakdown and back again after it. */
function m2600Riser(): Automation[] {
  const [a, b] = BREAK;
  const swap = (control: string, normal: number, during: number): Automation => ({
    page: 'm2600', device: 'm2600', control, points: [[0, normal], [a - 0.1, normal], [a, during], [b - 0.1, during], [b, normal]],
  });
  return [
    swap('adsr.sustain', 0, 1),
    swap('vcf.in.vco1', 0.7, 0),
    swap('vcf.in.vco2', 0.5, 0),
    { page: 'm2600', device: 'm2600', control: 'vcf.in.noise', points: [[0, 0], [a - 0.1, 0], [a, 0.15], [b - 0.5, 0.65], [b, 0]] },
    { page: 'm2600', device: 'm2600', control: 'vcf.freq', curve: 'exp', points: [[0, 2200], [a - 0.1, 2200], [a, 300], [b - 0.5, 9000], [b, 2200], [84, 3200], [96, 2200]] },
    { page: 'm2600', device: 'm2600', control: 'vcf.res', points: [[0, 0.45], [a - 0.1, 0.45], [a, 0.5], [b - 0.5, 0.78], [b, 0.45]] },
  ];
}

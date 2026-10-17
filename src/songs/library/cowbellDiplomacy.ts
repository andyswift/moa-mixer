import { at16, chordAt, DRUM, note, steps } from '../generators';
import { DRUM_PUNCH, mixerSettings, STANDARD_EFFECTS } from '../mixes';
import type { Automation, NoteEvent, Song } from '../types';

/**
 * An original, silly acid house tune, 128 bpm, F major. Kept on one root, as acid is: six bars on F and two a fifth up
 * on C, and the bass jumps an octave for the last two bars before the trombone. The cowbell keeps getting busier
 * (syncopated, with ghost notes and an echo, rather than louder), the MOA-2600 plays a robot who answers the bass line, and it all ends in a sad trombone before the loop
 * starts again on a lonely cowbell. It shows off the ladder filter's drive (Acid Ladder), the mixer's Tape and the
 * new percussion.
 *
 * Bars 1-4: cowbell alone, then the kick and the robot saying hello. 5-12: the groove (bass, clap, hats, cowbell
 * in an 808-style syncopation, the robot answering every phrase). 13-16: breakdown: cowbell, toms and a robot
 * conversation over a filter sweep. 17-22: MORE COWBELL (a busier, funkier pattern, then ghost notes in between).
 * 23-24: everything stops; sad trombone.
 */
const BARS = 24;
const ROOT = 53; // F3 (the patch's 16' range puts it an octave lower: it sounds at F2)
const SHIFT = [0, 0, 0, 7]; // two bars each: F F F, then up a fifth to C
const section = (bar: number) => (bar < 4 ? 'intro' : bar < 12 ? 'groove' : bar < 16 ? 'break' : bar < 22 ? 'cowbell' : 'trombone');

// a bouncy major bass line: [step, semitones, length]; lengths over a step slide
const SLIDE = 1.25, SHORT = 0.5;
const BASS: [number, number, number][] = [
  [0, 0, SHORT], [2, 12, SHORT], [3, 0, SHORT], [4, 7, SHORT], [6, 0, SHORT], [7, 12, SLIDE], [8, 9, SHORT],
  [10, 7, SHORT], [11, 4, SHORT], [12, 0, SHORT], [13, 12, SLIDE], [14, 14, SHORT], [15, 7, SHORT],
];
const BASS_ACCENTS = new Set([2, 7, 13]);

// the robot's replies (2600): [bar of the pair, step, pitch]; and its conversation in the breakdown
const REPLY: [number, number, number][] = [[1, 12, 84], [1, 13, 91], [1, 14, 88], [1, 15, 96]];
const HELLO: [number, number, number][] = [[2, 8, 79], [2, 10, 84], [3, 0, 91], [3, 2, 88], [3, 4, 96]];
const CHAT = [96, 91, 88, 93, 84, 98, 86, 90, 95, 83, 92, 100];
// the sad trombone: four notes falling a semitone each, the last long, with vibrato (bars 23-24)
const TROMBONE: [number, number, number][] = [[22, 0, 60], [22, 6, 59], [22, 12, 58], [23, 2, 57]];
const TROMBONE_LEN = [5, 5, 5.5, 12.5]; // steps

const parts = {
  drums(): NoteEvent[] {
    const out: NoteEvent[] = [];
    for (let bar = 0; bar < BARS; bar++) {
      const sec = section(bar);
      for (let s = 0; s < 16; s++) {
        const hit = (pitch: number, vel: number) => out.push(note(at16(bar, s), steps(1), pitch, vel));
        const full = sec === 'groove' || sec === 'cowbell';
        // the cowbell: syncopated patterns with accents and ghost notes, getting busier, not louder
        const bell = (pattern: Record<number, number>) => { if (pattern[s]) hit(DRUM.cowbell, pattern[s]!); };
        if (sec === 'intro') bell(bar < 2 ? { 0: 96, 10: 80 } : { 0: 96, 6: 70, 10: 84 });
        if (sec === 'groove') bell(bar % 2 === 0 ? { 3: 92, 6: 76, 10: 96, 15: 60 } : { 2: 80, 6: 92, 11: 70, 14: 96 });
        if (sec === 'break') bell({ 0: 88, 7: 60 });
        if (sec === 'cowbell') {
          bell({ 0: 104, 3: 90, 6: 96, 8: 70, 10: 100, 13: 84, 14: 64 });
          if (bar >= 20 && [1, 5, 9, 12].includes(s)) hit(DRUM.cowbell, 44); // ghost notes in between
        }
        if ((full || (sec === 'intro' && bar >= 2)) && s % 4 === 0) hit(DRUM.kick, s === 0 ? 124 : 116);
        if (full && (s === 4 || s === 12)) hit(DRUM.clap, 110);
        if (full && s % 4 === 2) hit(DRUM.closedHat, 86);
        if (full && s === 14) hit(DRUM.openHat, 80);
        if ((bar === 4 || bar === 16) && s === 0) hit(DRUM.crash, 100);
        // tom cascades into the breakdown, out of it, and into the trombone
        if ((bar === 11 || bar === 15 || bar === 21) && s >= 10) hit([DRUM.highTom, DRUM.highTom, DRUM.midTom, DRUM.midTom, DRUM.lowTom, DRUM.lowTom][s - 10]!, 90 + (s - 10) * 5);
        if (sec === 'break' && (s === 6 || s === 14)) hit(s === 6 ? DRUM.highTom : DRUM.lowTom, 70);
      }
    }
    return out;
  },
  bass(): NoteEvent[] {
    const out: NoteEvent[] = [];
    for (let bar = 4; bar < 22; bar++) {
      const root = ROOT + chordAt(SHIFT, bar, 2) + (bar >= 20 ? 12 : 0); // an octave up to lift into the ending
      for (const [s, semis, len] of BASS) out.push(note(at16(bar, s), steps(len), root + semis, BASS_ACCENTS.has(s) ? 127 : 96));
    }
    return out;
  },
  robot(): NoteEvent[] {
    const out: NoteEvent[] = [];
    for (const [bar, s, n] of HELLO) out.push(note(at16(bar, s), steps(1), n, 100));
    for (let bar = 4; bar < 12; bar++) for (const [half, s, n] of REPLY) if (bar % 2 === half) out.push(note(at16(bar, s), steps(0.9), n + chordAt(SHIFT, bar, 2), 100));
    // the breakdown: a conversation, a few bleeps a bar
    CHAT.forEach((n, i) => out.push(note(at16(12 + Math.floor(i / 3), [3, 6, 11][i % 3]!), steps(1), n, 100)));
    for (let bar = 16; bar < 22; bar++) for (const [half, s, n] of REPLY) if (bar % 2 === half) out.push(note(at16(bar, s), steps(0.9), n + 12, 100));
    TROMBONE.forEach(([bar, s, n], i) => out.push(note(at16(bar, s), steps(TROMBONE_LEN[i]!), n, 100)));
    return out;
  },
};

/** The 2600 is a bleeping robot until the end, where glide, a long envelope, vibrato and a wah turn it into a trombone. */
function robotToTrombone(): Automation[] {
  const t = 22 * 4; // the trombone starts here (beats)
  const swap = (control: string, robot: number, trombone: number): Automation => ({
    page: 'm2600', device: 'm2600', control, points: [[0, robot], [t - 0.1, robot], [t, trombone], [BARS * 4 - 0.25, trombone], [BARS * 4, robot]],
  });
  return [
    swap('adsr.sustain', 0, 0.85),
    swap('adsr.attack', 0.001, 0.04),
    swap('adsr.release', 0.05, 0.25),
    swap('kb.porta', 0, 0.35),
    swap('vcf.freq', 3200, 700),
    swap('vcf.cv.adsr', 0, 0.35),
    // the vibrato wobbles in on the last, long note
    { page: 'm2600', device: 'm2600', control: 'lfo.depth', points: [[0, 0], [t + 6.5, 0], [t + 7.5, 0.55], [BARS * 4 - 0.25, 0.55], [BARS * 4, 0]] },
  ];
}

export function cowbellDiplomacy(): Song {
  const mix = mixerSettings({
    drums: { kick: 1.1, snare: 1.0, clap: 1.0, rest: 0.85 },
    duck: 0.3,
    reverb: { ch5: 0.22, ch9: 0.22, line5: 0.2 },
    delay: { line5: 0.3, ch9: 0.3 }, // the cowbell's echo makes its own rhythm under the dry hits
    faders: { ch1: 0.9, ch9: 0.6, line5: 0.55 },
  });
  // Tape on the bass, the kick and the cowbell: warmth and weight, not fuzz
  Object.assign(mix.mixer.mixer!.controls!, { 'ch1.tape': 0.55, 'ch3.tape': 0.4, 'ch9.tape': 0.35 });
  return {
    id: 'cowbell-diplomacy',
    title: 'Cowbell Diplomacy',
    artist: 'MOA Swift',
    bpm: 128,
    key: 'F major',
    bars: BARS,
    beatsPerBar: 4,
    sleeve: { art: 'sunrise', colors: ['#2b1d0e', '#ffb627', '#ff4f79'] },
    band: ['drums', 'synth', 'm2600', ...STANDARD_EFFECTS],
    setup: {
      drums: { drums: { controls: { ...DRUM_PUNCH.drums!.controls, 'cowbell.level': 0.8, 'cowbell.decay': 0.18 } } },
      synth: { synth: { preset: 20 } }, // Acid Ladder: the ladder filter driven
      // the 2600 from Init: a bright pulse through the 4072, a short blip; portamento on (the automation sets how much)
      m2600: { m2600: { preset: 0, controls: {
        'vcf.in.vco1': 0.8, 'vcf.in.vco2': 0.3, 'vco2.fine': 0.1, 'vcf.freq': 3200, 'vcf.res': 0.35, 'vcf.cv.adsr': 0,
        'adsr.attack': 0.001, 'adsr.decay': 0.09, 'adsr.sustain': 0, 'adsr.release': 0.05, 'kb.portaOn': 1, 'kb.porta': 0,
        'lfo.speed': 5.5, 'lfo.depth': 0, 'reverb.left': 0.15, 'reverb.right': 0.15,
      } } },
      delay: { delay: { controls: { 'delay.time': 352, 'delay.feedback': 0.35 } } }, // a dotted eighth at 128 bpm
      ...mix,
    },
    tracks: { drums: parts.drums(), synth: parts.bass(), m2600: parts.robot() },
    automation: [
      // the bass line's filter: a little movement, a sweep through the breakdown, open for the cowbell section
      { page: 'synth', device: 'synth', control: 'filter.cutoff', curve: 'exp', points: [[0, 260], [16, 260], [46, 700], [48, 350], [62, 1800], [64, 600], [86, 1400], [96, 260]] },
      ...robotToTrombone(),
    ],
    humanise: { timing: { drums: 3, synth: 2, m2600: 4 }, velocity: 0.06, swing: 0.05 },
  };
}

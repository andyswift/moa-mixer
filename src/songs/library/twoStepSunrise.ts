import { arpeggio, at16, chordAt, DRUM, note, steps } from '../generators';
import { DRUM_PUNCH } from '../mixes';
import type { NoteEvent, Song } from '../types';

/**
 * An original liquid drum and bass tune: 174 bpm, A minor, the loop Am - F - G - Em two bars a chord. Sixteen bars:
 * intro, build, drop, break, build, drop and a thinned-out last bar for the pad to ring over.
 */
const BARS = 16;
const ROOTS = [33, 29, 31, 28]; // A1 F1 G1 E1
const PADS = [[57, 60, 64, 71], [53, 57, 60, 64], [55, 59, 62, 64], [52, 55, 59, 66]]; // Am9, Fmaj7, G6, Em9
const ARPS = [[69, 72, 76, 72, 69, 72, 76, 79], [65, 69, 72, 69, 65, 69, 72, 76], [67, 71, 74, 71, 67, 71, 74, 79], [64, 67, 71, 67, 64, 67, 71, 74]];
const STABS = [[57, 64], [53, 60], [55, 62], [52, 59]];
const BELLS = [81, 76, 79, 76];

const section = (bar: number) => (bar < 2 ? 'intro' : bar < 4 ? 'build' : bar < 8 ? 'drop' : bar < 10 ? 'break' : bar < 12 ? 'build2' : 'drop2');
const isDrop = (bar: number) => section(bar) === 'drop' || section(bar) === 'drop2';

function drums(): NoteEvent[] {
  const out: NoteEvent[] = [];
  for (let bar = 0; bar < BARS; bar++) {
    const sec = section(bar);
    const fill = bar === 3 || bar === 7 || bar === 11 || bar === 15;
    const thin = bar === BARS - 1;
    for (let s = 0; s < 16; s++) {
      const t = at16(bar, s);
      const push = (len: number, pitch: number, vel: number) => out.push(note(t, steps(len), pitch, vel));
      if (isDrop(bar) && !(thin && s >= 8)) {
        if (s === 0 || s === 10) push(1, DRUM.kick, 127);
        if (s === 7 && bar % 2 === 1) push(1, DRUM.kick, 100); // an extra kick pushes the second bar of a pair
        if ((s === 4 || s === 12) && !(fill && s === 12)) { push(1, DRUM.snare, 125); push(1, DRUM.clap, 105); }
        if ((s === 7 || s === 15) && !fill) push(1, DRUM.snare, 42); // ghost snares
        if (s % 2 === 0) push(1, DRUM.closedHat, s % 4 === 2 ? 105 : 78);
        if (s % 2 === 1 && bar >= 6) push(1, DRUM.closedHat, 48); // 16th hats lift the second half of the drop
        if (s === 14 && !fill) push(2, DRUM.openHat, 85);
        if (s === 0 && (bar === 4 || bar === 12)) push(6, DRUM.ride, 118); // crash on the downbeat of each drop
      } else if (sec === 'build' || sec === 'build2' || sec === 'break' || sec === 'intro') {
        if (sec !== 'intro' && s % 4 === 2) push(1, DRUM.closedHat, 55 + bar * 2);
        if (sec === 'build' && bar === 2 && s % 4 === 0) push(1, DRUM.kick, 90);
        if (sec === 'build2' && s % 4 === 0) push(1, DRUM.kick, 100);
      }
      if (fill && s >= 8 && !thin) push(1, DRUM.snare, 62 + (s - 8) * 8); // snare roll into the next section
    }
  }
  return out;
}

function bass(): NoteEvent[] {
  const out: NoteEvent[] = [];
  for (let bar = 0; bar < BARS; bar++) {
    const root = chordAt(ROOTS, bar, 2);
    if (isDrop(bar)) {
      if (bar === BARS - 1) { out.push(note(at16(bar, 0), steps(8), root, 112)); continue; }
      out.push(note(at16(bar, 0), steps(6.2), root, 115), note(at16(bar, 6), steps(1.8), root + 12, 100), note(at16(bar, 10), steps(3.5), root, 115), note(at16(bar, 14), steps(1.8), root + 7, 100));
    } else if (bar % 2 === 0 && bar >= 2) out.push(note(at16(bar, 0), steps(30), root, 100)); // long sub through the builds and the break
  }
  return out;
}

function pad(): NoteEvent[] {
  const out: NoteEvent[] = [];
  for (let bar = 0; bar < BARS; bar += 2) for (const n of chordAt(PADS, bar, 2)) out.push(note(at16(bar, 0), steps(31), n, bar < 2 ? 42 : 55));
  return out;
}

function vibes(): NoteEvent[] {
  const out: NoteEvent[] = [];
  for (let bar = 0; bar < BARS; bar++) {
    const chord = Math.floor(bar / 2) % 4;
    if (section(bar) === 'intro') out.push(...arpeggio(bar, ARPS[chord]!, 8, 7, 55)); // slow, spread out
    else if (isDrop(bar) && bar < BARS - 1) out.push(...arpeggio(bar, ARPS[chord]!, 2, 1.6, 78, bar % 2 === 1 ? 1 : 0));
    else if (section(bar) === 'break') out.push(...arpeggio(bar, ARPS[chord]!, 4, 3.4, 60));
  }
  return out;
}

function stabs(): NoteEvent[] {
  const out: NoteEvent[] = [];
  for (let bar = 0; bar < BARS; bar++) {
    if (!isDrop(bar) || bar === BARS - 1) continue;
    const chord = STABS[Math.floor(bar / 2) % 4]!;
    for (const s of [3, 10]) for (const n of chord) out.push(note(at16(bar, s), steps(1.6), n + 24, 92));
  }
  return out;
}

function bells(): NoteEvent[] {
  const out: NoteEvent[] = [];
  for (let bar = 0; bar < BARS; bar += 2) {
    const n = BELLS[(bar / 2) % 4]!;
    if (bar < 4 || section(bar) === 'break') out.push(note(at16(bar, 0), steps(14), n, 72), note(at16(bar + 1, 8), steps(6), n - 5, 62));
  }
  out.push(note(at16(BARS - 1, 0), steps(15), 93, 70));
  return out;
}

/** The filter box takes long chord notes through the builds and break while its cutoff sweeps. */
function filterBox(): NoteEvent[] {
  const out: NoteEvent[] = [];
  for (let bar = 0; bar < BARS; bar += 2) {
    const sec = section(bar);
    if (sec === 'build' || sec === 'break' || sec === 'build2') for (const n of [PADS[Math.floor(bar / 2) % 4]![0]! + 12, PADS[Math.floor(bar / 2) % 4]![2]! + 12]) out.push(note(at16(bar, 0), steps(31), n, 85));
  }
  return out;
}

export function twoStepSunrise(): Song {
  return {
    id: 'two-step-sunrise',
    title: 'Two-Step Sunrise',
    artist: 'MOA Swift',
    bpm: 174,
    key: 'A minor',
    bars: BARS,
    beatsPerBar: 4,
    sleeve: { art: 'sunrise', colors: ['#ff7a3d', '#ffd25e', '#3a1d46'] },
    band: ['drums', 'synth', 'poly', 'lynch', 'duo', 'df2', 'pipe', 'reverb', 'delay', 'buscomp'],
    setup: {
      drums: DRUM_PUNCH,
      synth: { synth: { preset: 1 } }, // Sub Bass
      poly: { poly: { preset: 13 } }, // Dream Wash
      lynch: { lynch: { preset: 21 } }, // Vibes
      duo: { duo: { preset: 3 } }, // Dual Fifths
      df2: { lynch: { preset: 7 }, box: { preset: 4, controls: { 'f1.res': 0.28, 'f2.res': 0.25, 'delay.level': 0.1, 'delay.repeats': 0.25, 'delay.time': 0.32 } } }, // Sweep Pad into Silk Sweep
      pipe: { pipe: { preset: 5 } }, // Glass Bell
      mixer: {
        mixer: {
          controls: {
            // drums up and hard: kick, snare, clap in front
            'ch3.fader': 1.15, 'ch4.fader': 1.1, 'ch5.fader': 1.1, 'ch6.fader': 1.0, 'ch7.fader': 1.0, 'ch8.fader': 1.0,
            // bass and pad sit under the compressor on bus B, which the kick (channel 3) ducks gently
            'ch1.busA': false, 'ch1.busB': true, 'ch2.busA': false, 'ch2.busB': true, 'key.source': '3',
            // the vibes strip is turned down; space from the reverb (aux 1) and delay (aux 2)
            'line1.fader': 0.55,
            'ch4.aux1': 0.3, 'ch5.aux1': 0.35, 'ch2.aux1': 0.22, 'line1.aux1': 0.25, 'line2.aux1': 0.2, 'line3.aux1': 0.25, 'line4.aux1': 0.4,
            'line1.aux2': 0.15, 'line2.aux2': 0.12, 'line3.aux2': 0.2,
            'ret1.fader': 0.8, 'ret2.fader': 0.7, 'ret4.fader': 0.9,
          },
        },
      },
      buscomp: { buscomp: { controls: { 'bc.duck.depth': 0.3, 'bc.duck.release': 220, 'bc.threshold': -10, 'bc.ratio': 2, 'bc.makeup': 1 } } },
    },
    tracks: { drums: drums(), synth: bass(), poly: pad(), lynch: vibes(), duo: stabs(), pipe: bells(), df2: filterBox() },
    automation: [
      // the filter box opens through each build and the break, and closes again at the drops
      { page: 'df2', device: 'box', control: 'f1.cutoff', curve: 'exp', points: [[0, 400], [8, 400], [16, 4500], [16.1, 700], [32, 700], [36, 1800], [40, 1800], [40.1, 500], [48, 4500], [48.1, 900], [64, 900]] },
      { page: 'df2', device: 'box', control: 'f2.cutoff', curve: 'exp', points: [[0, 520], [8, 520], [16, 5200], [16.1, 900], [32, 900], [36, 2300], [40, 2300], [40.1, 650], [48, 5200], [48.1, 1100], [64, 1100]] },
    ],
    humanise: {
      timing: { drums: 5, synth: 7, poly: 12, lynch: 9, duo: 10, pipe: 10, df2: 9 },
      velocity: 0.12,
      swing: 0.06,
      layback: { drums: { 38: 4, 39: 4 } },
    },
  };
}

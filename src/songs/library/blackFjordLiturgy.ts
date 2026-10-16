import { at16, DRUM, note, steps } from '../generators';
import { mixerSettings } from '../mixes';
import type { NoteEvent, Song } from '../types';

/**
 * An original instrumental in a raw, cold, noisy black-metal style: 176 bpm, E phrygian, tremolo-picked riffs made of
 * a repeated note and its chromatic neighbours, blast beats, a slow dirge, choir and organ drones, wind and noise.
 * The "guitars" are two saw leads pushed through the Ouroboros bit-crusher and clipper. Twenty-four bars.
 */
const BARS = 24;
const section = (bar: number) => (bar < 2 ? 'intro' : bar < 8 ? 'riffA' : bar < 12 ? 'dirge' : bar < 18 ? 'riffB' : 'outro');
const blast = (bar: number) => section(bar) === 'riffA' || section(bar) === 'riffB' || bar === 18 || bar === 19;

// Tremolo riffs: one pitch per 16th step of a bar (every step is picked).
const rep = (pitch: number, n: number) => Array<number>(n).fill(pitch);
const A1 = [...rep(64, 8), ...rep(65, 4), ...rep(64, 2), ...rep(63, 2)]; // E, F, E, D#
const A2 = [...rep(67, 4), ...rep(66, 4), ...rep(65, 4), ...rep(64, 4)]; // G, F#, F, E: a chromatic fall
const B1 = [...rep(76, 4), ...rep(75, 4), ...rep(74, 4), ...rep(72, 4)]; // E5 D#5 D5 C5
const B2 = [...rep(71, 4), ...rep(70, 4), ...rep(69, 4), ...rep(71, 4)]; // B4 A#4 A4 B4: ends upward, unresolved

/** The riff for a bar, or none. */
function riffFor(bar: number): number[] | undefined {
  if (section(bar) === 'riffA') return (bar - 2) % 2 === 0 ? A1 : A2;
  if (section(bar) === 'riffB') return (bar - 12) % 2 === 0 ? B1 : B2;
  if (bar === 18) return A1;
  if (bar === 19) return A2;
  return undefined;
}

const fade = (bar: number) => (bar === 18 ? 0.7 : bar === 19 ? 0.5 : 1);

function guitar(offset: number, velocity: number): NoteEvent[] {
  const out: NoteEvent[] = [];
  for (let bar = 0; bar < BARS; bar++) {
    const riff = riffFor(bar);
    if (riff) for (let s = 0; s < 16; s++) out.push(note(at16(bar, s), steps(0.9), riff[s]! + offset, Math.round(velocity * fade(bar) * (s % 4 === 0 ? 1 : 0.82))));
    else if (section(bar) === 'dirge') {
      // slow, heavy: a whole-bar chord note, then a burst of tremolo on the last beat
      const held = [64, 65, 64, 58][bar - 8]!;
      out.push(note(at16(bar, 0), steps(11.5), held + offset, velocity));
      for (let s = 12; s < 16; s++) out.push(note(at16(bar, s), steps(0.9), held + offset, Math.round(velocity * 0.9)));
    }
  }
  if (offset === 0) out.push(note(at16(20, 0), steps(16 * 4 - 1), 52, 70)); // the last riff note rings out as a drone
  return out;
}

function drums(): NoteEvent[] {
  const out: NoteEvent[] = [];
  for (let bar = 0; bar < BARS; bar++) {
    const sec = section(bar);
    for (let s = 0; s < 16; s++) {
      const hit = (pitch: number, len: number, vel: number) => out.push(note(at16(bar, s), steps(len), pitch, Math.min(127, Math.round(vel))));
      const f = fade(bar);
      if (sec === 'intro') {
        if (bar === 1 && s >= 8) hit(DRUM.snare, 1, 56 + (s - 8) * 9); // a roll that launches the first riff
        if (bar === 1 && s === 0) hit(DRUM.ride, 6, 70);
      } else if (blast(bar)) {
        const kickRun = (bar === 14 || bar === 16) && s >= 8 || bar === 17 && s >= 8; // double-kick bursts, no snare
        const snareRoll = bar === 7 && s >= 12;
        if (kickRun) hit(DRUM.kick, 1, 112 * f);
        else if (snareRoll) hit(DRUM.snare, 1, 80 + (s - 12) * 12);
        else if (s % 2 === 0) { hit(DRUM.kick, 1, 126 * f); if (s % 4 === 0) hit(DRUM.closedHat, 1, 90 * f); } // blast: kick on the even 16ths ...
        else { hit(DRUM.snare, 1, 122 * f); if (s % 4 === 1) hit(DRUM.clap, 1, 92 * f); } // ... snare on the odd ones, a clap on every other for crack
        if (s === 0 && (bar === 2 || bar === 12)) hit(DRUM.ride, 8, 110); // crash into each riff
      } else if (sec === 'dirge') {
        if (s === 0 || (s === 6 && bar % 2 === 1)) hit(DRUM.kick, 1, 127);
        if (s === 8) { hit(DRUM.snare, 1, 127); hit(DRUM.clap, 1, 112); }
        if (s === 4 || s === 12) hit(DRUM.openHat, 2, 66);
        if (s === 0 && bar === 8) hit(DRUM.ride, 10, 108);
        if (bar === 11 && s >= 12) hit(DRUM.kick, 1, 104 + (s - 12) * 5); // a double-kick run into the second riff
      } else if (bar === 20 || bar === 21) {
        if (s === 0) { hit(DRUM.kick, 1, 96); hit(DRUM.ride, 10, 80); }
      }
    }
  }
  return out;
}

function bass(): NoteEvent[] {
  const out: NoteEvent[] = [];
  const eighths = (bar: number, pitch: number, vel: number) => { for (let s = 0; s < 16; s += 2) out.push(note(at16(bar, s), steps(1.8), pitch, Math.round(vel * (s % 4 === 0 ? 1 : 0.8)))); };
  for (let bar = 2; bar < BARS; bar++) {
    const sec = section(bar);
    if (sec === 'riffA') { if ((bar - 2) % 2 === 0) eighths(bar, 40, 108); else [43, 42, 41, 40].forEach((p, i) => out.push(note(at16(bar, i * 4), steps(3.8), p, 104))); }
    else if (sec === 'dirge') out.push(note(at16(bar, 0), steps(15.5), [28, 29, 28, 34][bar - 8]!, 112));
    else if (sec === 'riffB') eighths(bar, (bar - 12) % 2 === 0 ? 40 : 35, 108);
    else if (bar < 20) eighths(bar, 40, bar === 18 ? 80 : 60);
  }
  out.push(note(at16(20, 0), steps(16 * 4 - 1), 28, 90)); // the low drone to finish
  return out;
}

function choir(): NoteEvent[] {
  const out: NoteEvent[] = [];
  const chord = (bar: number, notes: number[], len: number, vel: number) => { for (const n of notes) out.push(note(at16(bar, 0), steps(len), n, vel)); };
  chord(0, [52, 59, 65], 31, 44); // an E-F cluster: a minor second held cold
  for (const bar of [2, 4, 6]) chord(bar, [52, 59, 64, 65], 31, 48);
  for (const bar of [8, 10]) chord(bar, [52, 58, 64], 31, 54); // E and B-flat: the tritone
  for (const bar of [12, 14, 16]) chord(bar, [52, 59, 65], 31, 46);
  chord(18, [52, 59, 65, 70], 16 * 6 - 1, 40);
  return out;
}

function organ(): NoteEvent[] {
  const out: NoteEvent[] = [];
  for (const [bar, len, pitches] of [[0, 31, [52, 59]], [8, 31, [52, 58]], [10, 31, [52, 58]], [20, 63, [52, 59]]] as [number, number, number[]][]) {
    for (const n of pitches) out.push(note(at16(bar, 0), steps(len), n, 60));
  }
  return out;
}

function wind(): NoteEvent[] {
  return [note(at16(0, 0), steps(31), 64, 70), note(at16(8, 0), steps(63), 64, 66), note(at16(18, 0), steps(16 * 6 - 1), 64, 64)];
}

export function blackFjordLiturgy(): Song {
  const base = mixerSettings({
    drums: { kick: 1.0, snare: 1.5, clap: 1.5, rest: 1.5 }, // balanced by RMS: the snare, clap and cymbals lifted so the kit snaps
    duck: 0, // no pumping: this one is meant to be relentless
    reverb: { ch5: 0.3, ch2: 0.5, line1: 0.1, line2: 0.5, line3: 0.1, line4: 0.4 },
    delay: {},
    faders: { line1: 0.55, line3: 0.5, line2: 0.7, line4: 0.8 }, // guitars tucked back so the kit cuts through
  });
  const mixerControls = base.mixer.mixer!.controls!;
  Object.assign(mixerControls, {
    // both guitars go to bus C, which feeds Ouroboros as the distortion; aux 3 sends noise to the granular effect
    'line1.busA': false, 'line1.busC': true, 'line3.busA': false, 'line3.busC': true,
    'line4.aux3': 0.7, 'ch7.aux3': 0.5, 'ch8.aux3': 0.5, 'ch6.aux3': 0.25,
    'ret3.fader': 0.5, 'ret5.fader': 0.8, // the guitars come back from the distortion here: about 6 dB down so they sit just under the drums
  });
  return {
    id: 'black-fjord-liturgy',
    title: 'Black Fjord Liturgy',
    artist: 'MOA Swift',
    bpm: 176,
    key: 'E phrygian',
    bars: BARS,
    beatsPerBar: 4,
    sleeve: { art: 'frost', colors: ['#08080d', '#e8eef7', '#8aa0b8'] },
    band: ['drums', 'synth', 'poly', 'lynch', 'duo', 'df2', 'pipe', 'reverb', 'buscomp', 'ouroboros', 'granular'],
    setup: {
      drums: { drums: { controls: { 'snare.level': 1, 'clap.level': 1, 'closedHat.level': 1, 'openHat.level': 1, 'ride.level': 1 } } },
      synth: { synth: { preset: 3 } }, // Fat Pulse Bass
      poly: { poly: { preset: 10 } }, // Choir Air
      lynch: { lynch: { preset: 11 } }, // Lead Saw: the rhythm guitar
      duo: { duo: { preset: 11 } }, // Infinite Cathedral
      df2: { lynch: { preset: 11 }, box: { preset: 3, controls: { 'f1.res': 0.6, 'f2.res': 0.55, 'delay.level': 0 } } }, // the second guitar, through Screaming Madman
      pipe: { pipe: { preset: 14 } }, // Steam Drone: wind
      mixer: base.mixer,
      buscomp: base.buscomp,
      ouroboros: { ouroboros: {
        controls: {
          // used as a distortion: fully wet, bit-crushed and clipped, no echo and no wobble
          'ouro.routing': 'parallel', 'ouro.mix': 1, 'ouro.input': 1.6, 'ouro.output': 0.6,
          'ouro.a.delay': 10, 'ouro.b.delay': 14, 'ouro.a.grit': 0.9, 'ouro.b.grit': 0.85, 'ouro.a.clip': 0.9, 'ouro.b.clip': 0.85,
          'ouro.a.cutoff': 6500, 'ouro.b.cutoff': 5200, 'ouro.a.resonance': 1, 'ouro.b.resonance': 1,
          'ouro.fb.aa': 0, 'ouro.fb.bb': 0, 'ouro.fb.ab': 0, 'ouro.fb.ba': 0,
          'ouro.mod.depth': 0, 'ouro.mod.dlyA': 0, 'ouro.mod.dlyB': 0,
        },
        },
      },
      granular: { granular: {
        controls: {
          // a dusty, driven grain cloud for the noise
          'gr.position': 0.6, 'gr.size': 25, 'gr.rate': 70, 'gr.spread': 1, 'gr.cloud': 0.9, 'gr.detune': 40, 'gr.shape': 0.8,
          'gr.reverse': 0.3, 'gr.drive': 0.6, 'gr.filter': 9000, 'gr.reso': 3, 'gr.mix': 1,
        },
        },
      },
    },
    tracks: { drums: drums(), synth: bass(), poly: choir(), lynch: guitar(0, 112), df2: guitar(-5, 100), duo: organ(), pipe: wind() },
    automation: [
      // the filter box on the second guitar: slow rise through the dirge, bright through the second riff, closing in the outro
      { page: 'df2', device: 'box', control: 'f1.cutoff', curve: 'exp', points: [[0, 3000], [32, 700], [48, 2600], [49, 3600], [72, 3600], [96, 300]] },
      { page: 'df2', device: 'box', control: 'f2.cutoff', curve: 'exp', points: [[0, 3500], [32, 900], [48, 3000], [49, 4200], [72, 4200], [96, 400]] },
    ],
    humanise: { timing: { drums: 3, synth: 4, poly: 8, lynch: 3, duo: 6, pipe: 8, df2: 3 }, velocity: 0.07 },
  };
}

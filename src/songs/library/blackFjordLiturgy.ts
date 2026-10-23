import { at16, DRUM, note, steps } from '../generators';
import { mixerSettings } from '../mixes';
import { drone2600 } from '../m2600Sounds';
import type { Automation, NoteEvent, Song } from '../types';

/**
 * An original instrumental in a raw, cold, noisy black-metal style: 176 bpm, E phrygian, tremolo-picked riffs made of
 * a repeated note and its chromatic neighbours, blast beats, a slow dirge, a pipe organ, a choir and a drone, and noise.
 * Two guitars (MOA-GUITAR and a second guitarist on it, panned wide: an octave apart in the A riff, for weight, a
 * fourth apart elsewhere) through their overdrives into
 * scooped, fizzy amps, and MOA-BASS on a pick; the synths are kept to the cold edges: a choir in the
 * intro and the end, MOA-PIPE's pipe organ under the dirge and the end, the 2600's drone. Twenty-four bars.
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

/** The slow section's arpeggio, from the bar's note: the root an octave down, the fifth, the root, the flat ninth's rub, back down. */
const DIRGE_ARPEGGIO = [-12, -5, 0, 1, 0, -5];

const fade = (bar: number) => (bar === 18 ? 0.7 : bar === 19 ? 0.5 : 1);

/**
 * How hard each tremolo pick is: hardest on the beat, hard where the riff moves to a new note, the picks between
 * light. Never as soft as a dead note (`DEAD_NOTE_VELOCITY`), or the fades would turn into chks.
 */
const pick = (velocity: number, riff: number[], s: number) => (s % 4 === 0 ? 1 : riff[s] !== riff[s - 1] ? 0.85 : 0.5) * velocity;

/** A guitar's part, `offset` semitones from the first guitar's (`offsetA` in the A riff, wherever it is played). */
function guitar(offset: number, velocity: number, offsetA = offset): NoteEvent[] {
  const out: NoteEvent[] = [];
  for (let bar = 0; bar < BARS; bar++) {
    const riff = riffFor(bar);
    const by = riff === A1 || riff === A2 ? offsetA : offset;
    // each pick cut short (the next one stops the string): picked, not legato
    if (riff) for (let s = 0; s < 16; s++) out.push(note(at16(bar, s), steps(0.55), riff[s]! + by, Math.max(44, Math.round(pick(velocity, riff, s) * fade(bar)))));
    else if (section(bar) === 'dirge') {
      // slow and heavy, the palm off so it rings (see `palmOff`): the first guitar picks the chord out in eighths, each
      // note left ringing; the second strums it as a power chord; then both burst into tremolo on the last beat
      const held = [64, 65, 64, 58][bar - 8]!;
      if (offset === 0) DIRGE_ARPEGGIO.forEach((by, i) => out.push(note(at16(bar, i * 2), steps(11.5 - i * 2), held + by, Math.round(velocity * (i % 2 === 0 ? 0.95 : 0.75)))));
      else for (const by of [-12, -5, 0]) out.push(note(at16(bar, 0), steps(11.5), held + by, velocity));
      for (let s = 12; s < 16; s++) out.push(note(at16(bar, s), steps(0.55), held + offset, Math.round(velocity * (s === 12 ? 1 : 0.6))));
    }
  }
  // the end: an E power chord strummed and left to ring out
  if (offset === 0) for (const n of [40, 47, 52]) out.push(note(at16(20, 0), steps(16 * 4 - 1), n, 84));
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
  // the riffs are the guitars' alone
  chord(18, [52, 59, 65, 70], 31, 40); // the end: three chords, thinning out
  chord(20, [52, 59, 64, 71], 31, 36);
  chord(22, [52, 59], 31, 32);
  return out;
}

function organ(): NoteEvent[] {
  const out: NoteEvent[] = [];
  for (const [bar, len, pitches] of [[0, 31, [52, 59]], [8, 31, [52, 58]], [10, 31, [52, 58]], [20, 63, [52, 59]]] as [number, number, number[]][]) {
    for (const n of pitches) out.push(note(at16(bar, 0), steps(len), n, 60));
  }
  return out;
}

/** The MOA-2600: a cold drone on E (noise and a ring-modulated tone, a slowly sweeping filter) under the dirge and the outro. */
function drone(): NoteEvent[] {
  return [note(at16(8, 0), 4 * 4 - 0.25, 40, 100), note(at16(18, 0), 6 * 4 - 0.5, 40, 100)];
}

/** The picking hand: resting on the strings for the riffs (so the tremolo is picked, not smeared), lifted in the dirge and the end to let chords ring. */
function palmOff(page: 'guitar' | 'guitar2'): Automation {
  const on = 0.3;
  return { page, device: 'guitar', control: 'palm', points: [[0, on], [at16(8, 0) - 0.05, on], [at16(8, 0), 0], [at16(12, 0) - 0.05, 0], [at16(12, 0), on], [at16(20, 0) - 0.05, on], [at16(20, 0), 0]] };
}

export function blackFjordLiturgy(): Song {
  const base = mixerSettings({
    drums: { kick: 1.0, snare: 1.5, clap: 1.5, rest: 1.5 }, // balanced by RMS: the snare, clap and cymbals lifted so the kit snaps
    duck: 0, // no pumping: this one is meant to be relentless
    reverb: { ch5: 0.3, ch2: 0.5, line1: 0.1, line3: 0.1, line4: 0.4, line5: 0.45 },
    delay: {},
    faders: { ch1: 0.75, ch2: 0.4, line1: 0.36, line3: 0.32, line4: 0.35, line5: 0.4 }, // guitars tucked back so the kit cuts through; the choir under them
  });
  const mixerControls = base.mixer.mixer!.controls!;
  Object.assign(mixerControls, {
    'line1.pan': -0.7, 'line3.pan': 0.7, // the two guitars wide, left and right
    // aux 3 sends noise to the granular effect
    'line4.aux3': 0.3, 'ch7.aux3': 0.5, 'ch8.aux3': 0.5, 'ch6.aux3': 0.25,
    'ret5.fader': 0.8,
  });
  /**
   * A black-metal guitar: the bridge humbucker, picked hard by the bridge, the overdrive into a pushed amp, the mids
   * scooped. The overdrive short of flat out, so the accents in the picking still come through, and the picking hand
   * resting lightly on the strings, so each pick dies before the next (a lifted finger alone leaves a tail the drive
   * brings back up, and the tremolo smears).
   */
  const guitarTone = (driveTone: number) => ({ guitar: { controls: {
    'pickup.select': 'bridge', 'pickup.type': 'humbucker', tone: 8, 'pluck.style': 'pick', 'pluck.position': 0.05, 'pluck.strength': 0.7, palm: 0.3, // the palm lifts and rests with the song (`palmOff`)
    strum: 'down', 'strum.time': 12, 'drive.mix': 1, 'drive.gain': 0.7, 'drive.tone': driveTone, 'drive.level': 0.5,
    'amp.gain': 0.8, 'amp.bass': 4, 'amp.mid': -3, 'amp.treble': 6, 'cab.type': '4x12', 'cab.blend': 0.9, level: 0.6,
  } } });
  return {
    id: 'black-fjord-liturgy',
    title: 'Black Fjord Liturgy',
    artist: 'MOA Swift',
    bpm: 176,
    key: 'E phrygian',
    bars: BARS,
    beatsPerBar: 4,
    sleeve: { art: 'frost', colors: ['#08080d', '#e8eef7', '#8aa0b8'] },
    band: ['drums', 'bass', 'guitar', 'guitar2', 'poly', 'pipe', 'm2600', 'reverb', 'buscomp', 'granular'],
    inputs: { ch1: 'MOA-BASS', line1: 'MOA-GUITAR', line3: 'MOA-GUITAR 2' },
    setup: {
      drums: { drums: { controls: { 'snare.level': 1, 'clap.level': 1, 'closedHat.level': 1, 'openHat.level': 1, 'ride.level': 1 } } },
      // the bass: roundwounds, a pick, half its overdrive in, so it growls under the guitars
      bass: { bass: { controls: {
        'pluck.style': 'pick', 'pluck.position': 0.08, 'pluck.strength': 0.65, 'drive.mix': 0.5, 'drive.gain': 0.4, 'drive.tone': 2000,
        'amp.gain': 0.4, 'amp.mid': 2, 'cab.type': '8x10', level: 0.9,
      } } },
      guitar: guitarTone(5000),
      guitar2: guitarTone(4200), // a little darker, so the two stay apart
      poly: { poly: { preset: 10 } }, // Choir Air
      m2600: drone2600(),
      pipe: { pipe: { preset: 11 } }, // Pipe Organ
      mixer: base.mixer,
      buscomp: base.buscomp,
      granular: { granular: {
        controls: {
          // a dusty, driven grain cloud for the noise
          'gr.position': 0.6, 'gr.size': 25, 'gr.rate': 70, 'gr.spread': 1, 'gr.cloud': 0.9, 'gr.detune': 40, 'gr.shape': 0.8,
          'gr.reverse': 0.3, 'gr.drive': 0.6, 'gr.filter': 9000, 'gr.reso': 3, 'gr.mix': 1,
        },
        },
      },
    },
    tracks: { drums: drums(), bass: bass(), poly: choir(), guitar: guitar(0, 112), guitar2: guitar(-5, 100, -12), pipe: organ(), m2600: drone() },
    automation: [
      // the second guitar's tone knob: dark into the dirge, opening through it, bright through the second riff, closing in the outro
      palmOff('guitar'), palmOff('guitar2'),
      { page: 'guitar2', device: 'guitar', control: 'tone', points: [[0, 8], [32, 3], [48, 7], [49, 9], [72, 9], [96, 1]] },
    ],
    humanise: { timing: { drums: 3, bass: 4, poly: 8, guitar: 3, pipe: 6, guitar2: 3, m2600: 4 }, velocity: 0.07 },
  };
}

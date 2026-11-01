import type { RigSide } from './rigParams';

/** The families the factory sounds are grouped in, in the picker's order. */
export const RIG_CATEGORIES = [
  ['bass', 'Bass'], ['lead', 'Lead'], ['pad', 'Pad'], ['keys', 'Keys'], ['pluck', 'Pluck'], ['bell', 'Bell & Mallet'],
  ['strings', 'Strings & Brass'], ['stab', 'Chord & Stab'], ['arp', 'Arp & Seq'], ['perc', 'Drum & Perc'], ['fx', 'FX & Noise'],
  ['voice', 'Voice & Texture'],
] as const;
export type RigCategory = (typeof RIG_CATEGORIES)[number][0];

/** A part's sound: side A, and side B for the morph (a copy of A when absent); a factory sound has its family. */
export interface RigPreset {
  name: string;
  category?: RigCategory;
  a: RigSide;
  b?: RigSide;
}

const side = (params: Record<string, number>, matrix: RigSide['matrix'] = []): RigSide => ({ params, matrix });

// Choices are option indices (see RIG_PARAMS): octaves 0..4 are -2..+2; tables 0 PPG RESO, 1 PPG SYNC, 2 PPG DIGI,
// 3 PPG PULSE, 4 VOX AEIOU, 5 VOX CHOIR; voice.mode 0 poly, 1 mono, 2 legato; voice.unison n means n + 1 voices;
// filter.route 0 off, 1 series, 2 parallel; noise.type 0 white, 1 pink, 2 xor; panner.mode 0 off, 1 spread.
export const RIG_PRESETS: readonly RigPreset[] = [
  { name: 'Init', a: side({}) },
  {
    name: 'Acid Line',
    category: 'bass',
    a: side({
      'voice.mode': 2, 'voice.glide': 0.06, 'lad.cutoff': 300, 'lad.res': 0.75, 'lad.eg1': 0.45, drive: 0.35,
      'eg1.d': 0.25, 'eg1.s': 0, 'eg2.a': 0.002, 'eg2.d': 0.3, 'eg2.s': 0.8, 'eg2.r': 0.08, 'filter.key': 0.3,
    }, [{ source: 'vel', dest: 'lad.cutoff', amount: 0.15 }]),
  },
  {
    name: 'Sub Bass',
    category: 'bass',
    a: side({
      'voice.mode': 1, 'osc1.blend': 1, 'osc1.sub': 1, 'mix.osc1': 0.8, 'osc2.oct': 1, 'mix.osc2': 0.3,
      'lad.cutoff': 400, 'lad.res': 0.2, 'lad.eg1': 0.2, 'eg1.d': 0.2, 'eg2.r': 0.1,
    }),
  },
  {
    name: 'Glass Pad',
    category: 'pad',
    a: side({
      'out.level': 1, 'mix.osc1': 0.3, 'osc1.width': 1, 'mix.osc3': 0.7, 'osc3.table': 0, 'osc3.pos': 0.2,
      'lad.cutoff': 3500, 'lad.res': 0.2, 'lad.eg1': 0.1, 'filter.route': 2, 'sem.cutoff': 1200, 'sem.res': 0.5, 'sem.bp': 1,
      'eg1.a': 1.5, 'eg1.d': 3, 'eg1.s': 0.5, 'eg1.r': 2, 'eg2.a': 1.2, 'eg2.d': 2, 'eg2.s': 0.8, 'eg2.r': 2.5,
      'lfo1.rate': 0.15, 'voice.unison': 1, 'voice.detune': 0.25, 'panner.mode': 1,
    }, [{ source: 'lfo1', dest: 'osc3.pos', amount: 0.3 }]),
  },
  {
    // (as the user voiced it) the VOX AEIOU table, its vowel drifting with LFO 1 and a vibrato creeping in as a note is
    // held; the SEM beside the ladder on both sides (so the morph never switches it): A dark, a low-pass; B opened up,
    // the SEM a high-pass that EG 1 sweeps down, slower, deeper drift and vibrato. The MOD wheel morphs A into B, and on
    // A velocity pushes the morph a little
    name: 'Vox Table',
    category: 'voice',
    a: side({
      'mix.osc1': 0, 'mix.osc3': 1, 'osc3.table': 4, 'osc3.pos': 0.5, 'lad.cutoff': 420, 'lad.eg1': 0, 'filter.route': 2, 'sem.cutoff': 555,
      'eg2.a': 0.15, 'eg2.s': 1, 'eg2.r': 0.6, 'lfo1.rate': 0.3, 'lfo2.rate': 5, 'lfo2.shape': 0, 'lfo2.level': 0, 'mod.time': 1.5,
    }, [
      { source: 'lfo1', dest: 'osc3.pos', amount: 0.5 },
      { source: 'lfo2', dest: 'osc3.tune', amount: 0.003 },
      { source: 'time', dest: 'lfo2.level', amount: 1 },
      { source: 'vel', dest: 'out.morph', amount: 0.281 }, { source: 'mod', dest: 'out.morph', amount: 1 },
    ]),
    b: side({
      'mix.osc1': 0, 'mix.osc3': 1, 'osc3.table': 4, 'osc3.pos': 0.5, 'lad.cutoff': 1288, 'lad.eg1': 0,
      'filter.route': 2, 'sem.mode': 0.874, 'sem.cutoff': 387, 'sem.eg1': -0.312,
      'eg2.a': 0.15, 'eg2.s': 1, 'eg2.r': 0.6, 'lfo1.rate': 0.062, 'lfo1.level': 0.257, 'lfo1.retrig': 1,
      'lfo2.rate': 0.936, 'lfo2.shape': 0, 'lfo2.level': 0.127, 'lfo2.retrig': 1, 'mod.time': 1.5,
    }, [
      { source: 'lfo1', dest: 'osc3.pos', amount: 0.5 },
      { source: 'lfo2', dest: 'osc3.tune', amount: 0.003 },
      { source: 'time', dest: 'lfo2.level', amount: 1 },
      { source: 'mod', dest: 'out.morph', amount: 1 },
    ]),
  },
  {
    name: 'Choir',
    category: 'voice',
    a: side({
      'mix.osc1': 0, 'mix.osc3': 1, 'osc3.table': 5, 'osc3.pos': 0.3, 'lad.cutoff': 5000, 'lad.eg1': 0,
      'eg2.a': 0.8, 'eg2.s': 1, 'eg2.r': 1.5, 'lfo1.rate': 0.07, 'voice.unison': 2, 'voice.detune': 0.5, 'panner.mode': 1,
    }, [{ source: 'lfo1', dest: 'osc3.pos', amount: 0.4 }]),
  },
  {
    name: 'Sync Lead',
    category: 'lead',
    // played (the user's version): each note opens with a long sync "zeeow" (EG 1 sweeps
    // osc 2 down over ~2 s); the MOD wheel brings in a bar-long falling ramp on osc 2's pitch,
    // locked to the tempo, for the classic rising-and-falling sync tone.
    a: side({
      'voice.mode': 2, 'voice.glide': 0.03, 'mix.osc1': 0.3, 'mix.osc2': 1, 'osc2.sync': 1, 'lad.cutoff': 2750, 'lad.res': 0.3,
      'lad.eg1': 0.1, 'eg1.d': 1.91, 'eg1.s': 0, 'eg2.r': 0.2,
      'lfo2.rate': 5.5, 'lfo2.shape': 4, 'lfo2.level': 0, 'lfo2.sync': 1, 'lfo2.div': 2, 'lfo2.retrig': 0,
    }, [
      { source: 'eg1', dest: 'osc2.tune', amount: 0.264 },
      { source: 'mod', dest: 'lfo2.level', amount: 1 },
      { source: 'lfo2', dest: 'osc1.tune', amount: 0.004 },
      { source: 'lfo2', dest: 'osc2.tune', amount: 0.349 },
    ]),
  },
  {
    name: 'Dub Chord',
    category: 'stab',
    a: side({
      'mix.osc1': 0.7, 'mix.osc2': 0.7, 'osc2.tune': 0.08, 'lad.cutoff': 4000, 'lad.eg1': 0, 'filter.route': 1,
      'sem.cutoff': 900, 'sem.res': 0.6, 'sem.bp': 1, 'sem.eg1': 0.15, 'eg1.d': 0.35,
      'eg2.a': 0.002, 'eg2.d': 0.45, 'eg2.s': 0, 'eg2.r': 0.35,
    }),
  },
  {
    name: 'Digi Keys',
    category: 'keys',
    a: side({
      'mix.osc1': 0, 'mix.osc3': 1, 'osc3.table': 2, 'osc3.pos': 0.6, 'osc3.interp': 0, 'lad.cutoff': 8000, 'lad.eg1': 0,
      'eg1.d': 0.6, 'eg2.d': 1.2, 'eg2.s': 0.3, 'eg2.r': 0.5,
    }, [{ source: 'eg1', dest: 'osc3.pos', amount: -0.5 }]),
  },
  {
    name: 'Morph Pad',
    category: 'pad',
    a: side({ 'mix.osc1': 0.8, 'lad.cutoff': 800, 'lad.eg1': 0.1, 'eg2.a': 0.6, 'eg2.r': 1.5, 'voice.unison': 1, 'voice.detune': 0.3 },
      [{ source: 'mod', dest: 'out.morph', amount: 1 }]),
    b: side({
      'mix.osc1': 0.2, 'mix.osc3': 0.8, 'osc3.table': 1, 'osc3.pos': 0.7, 'lad.cutoff': 6000, 'lad.res': 0.3, 'lad.eg1': 0.1,
      'eg2.a': 0.6, 'eg2.r': 1.5, 'voice.unison': 1, 'voice.detune': 0.3,
    }, [{ source: 'mod', dest: 'out.morph', amount: 1 }]),
  },
  {
    name: 'XOR Bell',
    category: 'bell',
    a: side({
      'mix.osc1': 0.2, 'mix.noise': 0.6, 'noise.type': 2, 'osc2.tune': 7, 'lad.cutoff': 6000, 'lad.eg1': 0,
      'eg2.d': 1.5, 'eg2.s': 0, 'eg2.r': 1,
    }),
  },
  {
    name: 'Wave FM',
    category: 'bell',
    a: side({
      'osc1.width': 1, 'osc3.oct': 3, 'osc3.table': 0, 'mix.osc3': 0, 'lad.cutoff': 9000, 'lad.eg1': 0,
      'eg2.d': 2, 'eg2.s': 0, 'eg2.r': 1.5,
    }, [{ source: 'wave', dest: 'osc1.tune', amount: 0.08 }]),
  },
  {
    name: 'Drone',
    category: 'voice',
    a: side({
      'voice.mode': 1, 'eg2.drone': 1, 'mix.osc1': 0.6, 'mix.osc2': 0.6, 'osc2.tune': -0.1, 'osc2.oct': 1,
      'lad.cutoff': 600, 'lad.res': 0.6, 'lad.eg1': 0, 'lfo1.rate': 0.05, 'lfo1.shape': 0,
    }, [{ source: 'lfo1', dest: 'lad.cutoff', amount: 0.3 }]),
  },
  // ---- techno: short, dry and driven, to sit in a loop with a kick (SCALPEL is built on them)
  {
    // a saw and the sub an octave down, the ladder snapping shut in 90 ms, overdriven: a thud with a bark on top
    name: 'Techno Bass',
    category: 'bass',
    a: side({
      'voice.mode': 1, 'osc1.oct': 1, 'osc1.blend': 0.25, 'osc1.sub': 1, 'mix.osc1': 1,
      drive: 0.7, overdrive: 1, 'lad.cutoff': 90, 'lad.res': 0.35, 'lad.eg1': 0.42, 'filter.key': 0.3,
      'eg1.a': 0.001, 'eg1.d': 0.09, 'eg1.s': 0, 'eg1.reset': 1,
      'eg2.a': 0.001, 'eg2.d': 0.18, 'eg2.s': 0, 'eg2.r': 0.05, 'eg2.reset': 1,
    }, [{ source: 'vel', dest: 'lad.cutoff', amount: 0.12 }]),
  },
  {
    // two pulses at a clashing interval, ring-modulated (XOR), through a resonant band-pass: a clang, gone in 110 ms
    name: 'Metal Hit',
    category: 'perc',
    a: side({
      'mix.osc1': 0, 'mix.noise': 1, 'noise.type': 2, 'osc1.width': 0.3, 'osc2.oct': 3, 'osc2.tune': 5.6, 'osc2.width': 0.55,
      drive: 0.4, 'lad.cutoff': 14000, 'lad.eg1': 0, 'filter.route': 1, 'sem.bp': 1, 'sem.cutoff': 3200, 'sem.res': 0.55, 'sem.eg1': 0.1,
      'eg1.d': 0.05, 'eg2.a': 0.001, 'eg2.d': 0.11, 'eg2.s': 0, 'eg2.r': 0.08,
    }, [{ source: 'rand', dest: 'sem.cutoff', amount: 0.08 }]),
  },
  {
    // Plaits' CHORDS (a minor seventh), the low end high-passed away, the ladder closing fast, driven: for the delay
    name: 'Techno Stab',
    category: 'stab',
    a: side({
      'osc3.mode': 1, 'osc3.model': 6, 'osc3.harm': 0.41, 'osc3.timbre': 0.55, 'osc3.morph': 0.1, 'mix.osc1': 0, 'mix.osc3': 1,
      drive: 0.7, overdrive: 1, 'lad.cutoff': 900, 'lad.res': 0.2, 'lad.eg1': 0.3, 'filter.route': 1, 'sem.mode': 1, 'sem.cutoff': 250, 'sem.res': 0.2,
      'eg1.d': 0.2, 'eg2.a': 0.001, 'eg2.d': 0.28, 'eg2.s': 0, 'eg2.r': 0.22,
    }),
  },
  {
    // white noise into a resonant ladder held shut; the SEQ mod lane (or MOD) opens it
    name: 'Noise Sweep',
    category: 'fx',
    a: side({
      'mix.osc1': 0, 'mix.noise': 1, drive: 0.3, 'lad.cutoff': 200, 'lad.res': 0.55, 'lad.eg1': 0, 'filter.key': 0,
      'eg2.a': 0.5, 'eg2.s': 1, 'eg2.r': 0.8,
    }, [{ source: 'seq', dest: 'lad.cutoff', amount: 0.85 }, { source: 'mod', dest: 'lad.cutoff', amount: 0.85 }]),
  },
  {
    // a rolling sixteenth bass that bubbles: a resonant ladder snapping on each note, velocity opening it (the accents
    // pop), a little glide between notes
    name: 'Bubbly Bass',
    category: 'bass',
    a: side({
      'voice.mode': 2, 'voice.glide': 0.03, 'osc1.blend': 0.3, 'osc1.sub': 1, 'mix.osc1': 1, drive: 0.5,
      'lad.cutoff': 180, 'lad.res': 0.72, 'lad.eg1': 0.38, 'filter.key': 0.5,
      'eg1.a': 0.001, 'eg1.d': 0.11, 'eg1.s': 0, 'eg1.reset': 1,
      'eg2.a': 0.001, 'eg2.d': 0.16, 'eg2.s': 0.25, 'eg2.r': 0.05,
    }, [{ source: 'vel', dest: 'lad.cutoff', amount: 0.2 }]),
  },
  {
    // a wavetable poly whose envelopes are played: the SEQ mod lane (or MOD) stretches the filter's and the amp's
    // decay and lifts the sustain, from short stabs at 0 to a lush wash at 1. PPG RESO over a saw and a pulse an
    // octave down, with a breath of pink noise, overdriven; the ladder held almost shut and a snappy envelope
    // opening it wide on each note; each note sweeping the table, the table drifting with a slow LFO, a band-pass on
    // the mids drifting with another; two voices a note, detuned and spread
    name: 'Table Poly',
    category: 'stab',
    a: side({
      // (the oscillators, drive and ladder as the user set them by ear)
      'mix.osc1': 0.84, 'osc1.width': 0.22, 'osc1.blend': 0.06, 'mix.osc2': 0.37, 'osc2.oct': 1, 'osc2.blend': 0.55, 'osc2.width': 0.66,
      'mix.osc3': 0.8, 'osc3.table': 0, 'osc3.pos': 0.25, 'mix.noise': 0.18, 'noise.type': 1, drive: 0.74, overdrive: 1,
      'lad.cutoff': 140, 'lad.res': 0.33, 'lad.eg1': 0.59, 'filter.key': 0.4,
      'eg1.a': 0.002, 'eg1.d': 0.1, 'eg1.s': 0, 'eg1.r': 0.15, 'eg2.a': 0.002, 'eg2.d': 0.3, 'eg2.s': 0, 'eg2.r': 0.2,
      'lfo1.rate': 0.11, 'lfo1.retrig': 2, 'voice.unison': 1, 'voice.detune': 0.2, 'panner.mode': 1, 'panner.width': 0.8,
      // the SEM after the ladder, a band-pass round the mids, drifting a little with its own LFO against the table's
      'filter.route': 1, 'sem.bp': 1, 'sem.mode': 1, 'sem.cutoff': 940, 'sem.res': 0, 'lfo2.rate': 0.23, 'lfo2.retrig': 2,
    }, [
      { source: 'lfo2', dest: 'sem.cutoff', amount: 0.08 }, { source: 'seq', dest: 'sem.cutoff', amount: -0.05 },
      { source: 'seq', dest: 'eg1.d', amount: 0.45 }, { source: 'seq', dest: 'eg2.d', amount: 0.45 },
      { source: 'seq', dest: 'eg2.s', amount: 0.6 }, { source: 'seq', dest: 'eg2.r', amount: 0.35 },
      { source: 'mod', dest: 'eg1.d', amount: 0.45 }, { source: 'mod', dest: 'eg2.d', amount: 0.45 },
      { source: 'eg1', dest: 'osc3.pos', amount: 0.3 }, { source: 'lfo1', dest: 'osc3.pos', amount: 0.2 },
      { source: 'vel', dest: 'lad.cutoff', amount: 0.12 },
    ]),
  },
  {
    // aliased digital blips: PPG DIGI stepped (no interpolation between frames) an octave up, so it aliases; every
    // note lands on another frame; short and dry, for polyrhythms; a low high-pass (the SEM) breathing under it
    name: 'Digi Blip',
    category: 'pluck',
    a: side({
      'mix.osc1': 0, 'mix.osc3': 1, 'osc3.table': 2, 'osc3.interp': 0, 'osc3.oct': 3, 'osc3.pos': 0.4, drive: 0.3,
      'lad.cutoff': 9000, 'lad.eg1': 0, 'eg2.a': 0.001, 'eg2.d': 0.09, 'eg2.s': 0, 'eg2.r': 0.05,
      'filter.route': 1, 'sem.mode': 1, 'sem.cutoff': 250, 'sem.res': 0.1, 'lfo2.rate': 0.4, 'lfo2.retrig': 2,
    }, [
      { source: 'rand', dest: 'osc3.pos', amount: 0.5 }, { source: 'vel', dest: 'osc3.pos', amount: 0.2 },
      { source: 'lfo2', dest: 'sem.cutoff', amount: 0.08 },
    ]),
  },
  {
    // a shaker: noise through a band-pass up high, the beads' soft attack and a short fall; velocity is the hand
    // (accents louder and brighter), and every shake a little different
    name: 'Shaker',
    category: 'perc',
    a: side({
      'mix.osc1': 0, 'mix.noise': 1, 'lad.cutoff': 20000, 'lad.eg1': 0, 'filter.route': 1, 'sem.bp': 1, 'sem.cutoff': 7000, 'sem.res': 0.2,
      'filter.key': 0, 'eg2.a': 0.006, 'eg2.d': 0.07, 'eg2.s': 0, 'eg2.r': 0.04,
    }, [
      { source: 'vel', dest: 'eg2.level', amount: 0.7 }, { source: 'vel', dest: 'sem.cutoff', amount: 0.06 },
      { source: 'rand', dest: 'sem.cutoff', amount: 0.04 }, { source: 'rand', dest: 'eg2.d', amount: 0.05 },
    ]),
  },
  {
    // Mellotron-style strings: two saws a little apart, band-limited like tape (no lows, no highs), a slow bow, and
    // the tape's wow (0.7 Hz) and flutter (5.8 Hz) on the pitch, free-running so the voices drift apart
    name: 'Tape Strings',
    category: 'strings',
    a: side({
      'osc1.width': 0.3, 'mix.osc1': 0.6, 'mix.osc2': 0.6, 'osc2.width': 0.3, 'osc2.tune': 0.06, 'mix.noise': 0.03, 'noise.type': 1,
      drive: 0.15, 'lad.cutoff': 4500, 'lad.res': 0.1, 'lad.eg1': 0, 'filter.route': 1, 'sem.mode': 1, 'sem.cutoff': 180,
      'eg2.a': 0.15, 'eg2.d': 1, 'eg2.s': 0.9, 'eg2.r': 0.45,
      'lfo1.rate': 5.8, 'lfo1.shape': 0, 'lfo1.retrig': 1, 'lfo2.rate': 0.7, 'lfo2.shape': 0, 'lfo2.retrig': 1,
      'voice.unison': 1, 'voice.detune': 0.15, 'panner.mode': 1,
    }, [
      { source: 'lfo1', dest: 'osc1.tune', amount: 0.002 }, { source: 'lfo1', dest: 'osc2.tune', amount: 0.002 },
      { source: 'lfo2', dest: 'osc1.tune', amount: 0.003 }, { source: 'lfo2', dest: 'osc2.tune', amount: 0.003 },
    ]),
  },
  // ---- dark, mid-tempo post-punk house (DARK ROOM is built on them): analogue machines played slow and heavy
  {
    // the chugging sequencer bass: a saw and a pulse an octave down, a little apart, the ladder half shut and a short
    // snap of envelope on each note; the amp holds a little, so sixteenths run into a drone; velocity is the accent
    name: 'Post-Punk Bass',
    category: 'bass',
    a: side({
      'voice.mode': 1, 'osc1.oct': 1, 'mix.osc1': 0.9, 'osc2.oct': 1, 'osc2.blend': 1, 'osc2.width': 0.4, 'osc2.tune': 0.07, 'mix.osc2': 0.5,
      drive: 0.45, 'lad.cutoff': 260, 'lad.res': 0.3, 'lad.eg1': 0.33, 'filter.key': 0.4,
      'eg1.a': 0.001, 'eg1.d': 0.14, 'eg1.s': 0.1, 'eg1.reset': 1,
      'eg2.a': 0.001, 'eg2.d': 0.25, 'eg2.s': 0.4, 'eg2.r': 0.05,
    }, [{ source: 'vel', dest: 'lad.cutoff', amount: 0.15 }, { source: 'vel', dest: 'eg2.level', amount: 0.5 }]),
  },
  {
    // a string machine: saws in 8' and 4' (an octave up, quieter), no lows (the SEM high-passing), a slow bow and a
    // long fade, two voices a note and a breath of vibrato; the mixer's ENSEMBLE does the rest
    name: 'String Machine',
    category: 'strings',
    a: side({
      'mix.osc1': 0.7, 'osc2.oct': 3, 'osc2.tune': 0.05, 'mix.osc2': 0.45,
      'lad.cutoff': 2600, 'lad.res': 0.05, 'lad.eg1': 0, 'filter.route': 1, 'sem.mode': 1, 'sem.cutoff': 220,
      'eg2.a': 0.35, 'eg2.d': 1, 'eg2.s': 0.9, 'eg2.r': 1.2,
      'lfo1.rate': 5.2, 'lfo1.shape': 0, 'lfo1.retrig': 1, 'voice.unison': 1, 'voice.detune': 0.18, 'panner.mode': 1,
    }, [{ source: 'lfo1', dest: 'osc1.tune', amount: 0.0015 }, { source: 'lfo1', dest: 'osc2.tune', amount: 0.0015 }]),
  },
  {
    // Braids' PLUCKED string, two voices a note, the notes thrown wide left and right: for patterns into a delay (TIMBRE,
    // COLOR, the ladder and the width as the user set them by ear)
    name: 'Cosmic Pluck',
    category: 'pluck',
    a: side({
      'out.level': 1,
      'osc3.mode': 2, 'osc3.braids': 28, 'osc3.timbre': 0.178, 'osc3.morph': 0.787, 'mix.osc1': 0, 'mix.osc3': 1,
      'lad.cutoff': 3010, 'lad.res': 0.15, 'lad.eg1': 0.15, 'eg1.d': 0.2,
      'eg2.a': 0.001, 'eg2.d': 0.4, 'eg2.s': 0, 'eg2.r': 0.3, 'panner.mode': 2, 'panner.width': 0.915, 'voice.unison': 1,
    }, [{ source: 'vel', dest: 'lad.cutoff', amount: 0.1 }]),
  },
  {
    // a minor seventh from one key (Plaits' CHORDS), dark and short, the lows taken off: thrown into the dub delay
    name: 'Minor Stab',
    category: 'stab',
    a: side({
      'osc3.mode': 1, 'osc3.model': 6, 'osc3.harm': 0.41, 'osc3.timbre': 0.4, 'osc3.morph': 0.15, 'mix.osc1': 0, 'mix.osc3': 1,
      drive: 0.25, 'lad.cutoff': 1100, 'lad.res': 0.25, 'lad.eg1': 0.25, 'filter.route': 1, 'sem.mode': 1, 'sem.cutoff': 180,
      'eg1.d': 0.25, 'eg2.a': 0.001, 'eg2.d': 0.4, 'eg2.s': 0, 'eg2.r': 0.3,
    }),
  },
  {
    // a voice from Plaits' SPEECH word banks (MORPH picks the word, TIMBRE the throat: lock them per step), three
    // voices in unison, fading in and letting go slowly, narrowed to a band (as the user set it by ear)
    name: 'Dub Words',
    category: 'voice',
    a: side({
      'osc3.mode': 1, 'osc3.model': 7, 'osc3.harm': 0.762, 'osc3.timbre': 0.528, 'osc3.morph': 0.17, 'mix.osc1': 0, 'mix.osc3': 1,
      'lad.cutoff': 5730, 'lad.eg1': 0, 'filter.route': 1, 'sem.mode': 1, 'sem.cutoff': 778,
      'eg2.a': 0.08, 'eg2.d': 1, 'eg2.s': 0.8, 'eg2.r': 0.6, 'voice.unison': 2,
    }),
  },
  {
    // a hand drum: a triangle that drops in pitch as it is struck, a slap of noise, a quick fall; tuned by the key
    name: 'Hand Conga',
    category: 'perc',
    a: side({
      'osc1.width': 1, 'mix.osc1': 1, 'mix.noise': 0.08, 'lad.cutoff': 1500, 'lad.eg1': 0.3, 'filter.key': 1,
      'eg1.a': 0.001, 'eg1.d': 0.04, 'eg1.s': 0, 'eg1.reset': 1, 'eg2.a': 0.001, 'eg2.d': 0.2, 'eg2.s': 0, 'eg2.r': 0.12, 'eg2.reset': 1,
    }, [{ source: 'eg1', dest: 'osc1.tune', amount: 0.04 }, { source: 'vel', dest: 'eg2.level', amount: 0.6 }]),
  },
  // ---- festival EDM
  {
    // the supersaw: two saws a little apart, four voices a note spread wide and detuned, the ladder nearly open with a
    // touch of envelope; for a hook or (with a shorter amp) chord stabs
    name: 'Supersaw',
    category: 'lead',
    a: side({
      'out.level': 0.36,
      'mix.osc1': 0.7, 'mix.osc2': 0.7, 'osc2.tune': 0.12, drive: 0.2, 'lad.cutoff': 9000, 'lad.res': 0.1, 'lad.eg1': 0.1, 'eg1.d': 0.3,
      'eg2.a': 0.005, 'eg2.d': 0.3, 'eg2.s': 0.8, 'eg2.r': 0.25, 'voice.unison': 3, 'voice.detune': 0.234, 'panner.mode': 1, 'panner.width': 1,
      'lfo1.rate': 0.92, 'lfo1.level': 0, 'lfo1.retrig': 1, 'lfo2.rate': 0.2, 'lfo2.level': 0, 'lfo2.retrig': 1,
    }, [
      // played (the user's version): velocity is the brightness and weight (cutoff and both saws up) and the life
      // (more and faster detune wobble); the MOD wheel brings in a slow detune wobble between the saws and a
      // wandering swell of level and cutoff that speeds itself up and down
      { source: 'vel', dest: 'lad.cutoff', amount: 0.156 },
      { source: 'vel', dest: 'mix.osc1', amount: 0.276 },
      { source: 'vel', dest: 'mix.osc2', amount: 0.219 },
      { source: 'vel', dest: 'lfo1.level', amount: 0.2 },
      { source: 'vel', dest: 'lfo1.rate', amount: 0.242 },
      { source: 'mod', dest: 'lfo1.level', amount: 0.289 },
      { source: 'mod', dest: 'lfo2.level', amount: 0.259 },
      { source: 'lfo1', dest: 'osc1.tune', amount: -0.011 },
      { source: 'lfo1', dest: 'osc2.tune', amount: 0.014 },
      { source: 'lfo2', dest: 'mix.osc1', amount: 0.199 },
      { source: 'lfo2', dest: 'mix.osc2', amount: 0.225 },
      { source: 'lfo2', dest: 'lad.cutoff', amount: 0.209 },
      { source: 'lfo2', dest: 'lfo2.rate', amount: 0.43 },
    ]),
  },
  // ---- FM: Plaits' two-operator FM on OSC 3 (HARMONICS the ratio, TIMBRE the amount, MORPH the feedback), EG 1 on
  // the amount so each note is bright as it is struck and mellows as it dies
  {
    // a bell: an inharmonic ratio, the amount falling slowly, a long ring
    name: 'FM Bell',
    category: 'bell',
    a: side({
      'osc3.mode': 1, 'osc3.model': 2, 'osc3.harm': 0.62, 'osc3.timbre': 0.25, 'osc3.morph': 0.1, 'mix.osc1': 0, 'mix.osc3': 1,
      'lad.cutoff': 12000, 'lad.eg1': 0, 'eg1.a': 0.001, 'eg1.d': 1.2, 'eg1.s': 0, 'eg2.a': 0.001, 'eg2.d': 2.5, 'eg2.s': 0, 'eg2.r': 1.5,
    }, [{ source: 'eg1', dest: 'osc3.timbre', amount: 0.35 }, { source: 'vel', dest: 'osc3.timbre', amount: 0.15 }]),
  },
  {
    // an electric piano (as the user voiced it): a low ratio, half the AUX (Plaits' FM sub) under it, a short bright
    // tine on the attack; velocity is the bite: harder adds feedback and edge and nudges the ratio, and closes the ladder
    name: 'FM Keys',
    category: 'keys',
    a: side({
      'osc3.mode': 1, 'osc3.model': 2, 'osc3.harm': 0.213, 'osc3.timbre': 0.241, 'osc3.morph': 0, 'osc3.aux': 0.497, 'mix.osc1': 0, 'mix.osc3': 1,
      'lad.cutoff': 9000, 'lad.eg1': 0, 'eg1.a': 0.001, 'eg1.d': 0.35, 'eg1.s': 0, 'eg2.a': 0.002, 'eg2.d': 1.6, 'eg2.s': 0.25, 'eg2.r': 0.4,
      'lfo1.rate': 4.5, 'lfo1.shape': 0, 'voice.unison': 1, 'voice.detune': 0.08, 'panner.mode': 1, 'panner.width': 0.5,
    }, [
      { source: 'eg1', dest: 'osc3.timbre', amount: 0.169 }, { source: 'vel', dest: 'osc3.timbre', amount: 0.136 },
      { source: 'lfo1', dest: 'out.pan', amount: 0.15 }, { source: 'vel', dest: 'osc3.morph', amount: 0.379 },
      { source: 'vel', dest: 'osc3.harm', amount: 0.097 }, { source: 'vel', dest: 'lad.cutoff', amount: -0.186 },
    ]),
  },
  {
    // a bass: the modulator an octave below, feedback for grit, the amount snapping shut; mono, a little glide
    name: 'FM Bass',
    category: 'bass',
    a: side({
      'voice.mode': 1, 'voice.glide': 0.03, 'osc3.mode': 1, 'osc3.model': 2, 'osc3.harm': 0.38, 'osc3.timbre': 0.2, 'osc3.morph': 0.35,
      'mix.osc1': 0, 'mix.osc3': 1, 'osc1.sub': 1, 'osc1.blend': 1, 'mix.osc2': 0, drive: 0.3, 'lad.cutoff': 3000, 'lad.eg1': 0,
      'eg1.a': 0.001, 'eg1.d': 0.18, 'eg1.s': 0, 'eg2.a': 0.001, 'eg2.d': 0.4, 'eg2.s': 0.5, 'eg2.r': 0.08,
    }, [{ source: 'eg1', dest: 'osc3.timbre', amount: 0.45 }, { source: 'vel', dest: 'osc3.timbre', amount: 0.15 }]),
  },
  // ---- BASS: the classics, one recipe each (mono unless said; velocity is the accent)
  {
    // a saw and a saw an octave down into a 24 dB ladder snapping open on each note, a little drive and glide
    // played: velocity snaps the ladder's envelope harder, the MOD wheel adds resonance, the second saw drifts a hair
    name: 'Moog Bass',
    category: 'bass',
    a: side({
      'lfo2.rate': 0.27, 'lfo2.retrig': 1,
      'out.level': 0.67,
      'voice.mode': 1, 'voice.glide': 0.02, 'mix.osc1': 0.8, 'mix.osc2': 0.6, 'osc2.oct': 1, 'osc2.tune': 0.05, drive: 0.25,
      'lad.cutoff': 320, 'lad.res': 0.25, 'lad.eg1': 0.38, 'filter.key': 0.4,
      'eg1.a': 0.001, 'eg1.d': 0.25, 'eg1.s': 0.2, 'eg2.a': 0.002, 'eg2.d': 0.5, 'eg2.s': 0.75, 'eg2.r': 0.08,
    }, [
      { source: 'vel', dest: 'lad.cutoff', amount: 0.12 }, { source: 'vel', dest: 'eg1.level', amount: 0.4 },
      { source: 'mod', dest: 'lad.res', amount: 0.25 }, { source: 'lfo2', dest: 'osc2.tune', amount: 0.002 },
    ]),
  },
  {
    // two saws a little apart beating, each doubled and detuned, driven, the ladder drifting with a slow LFO (drum & bass)
    // played: velocity drives it a touch harder, the MOD wheel pulls the saws further apart (more beating)
    name: 'Reese',
    category: 'bass',
    a: side({
      'out.level': 0.29,
      'voice.mode': 2, 'mix.osc1': 0.8, 'mix.osc2': 0.8, 'osc2.tune': 0.22, 'voice.unison': 1, 'voice.detune': 0.3, drive: 0.45,
      'lad.cutoff': 700, 'lad.res': 0.15, 'lad.eg1': 0, 'filter.key': 0.3, 'eg2.a': 0.005, 'eg2.s': 1, 'eg2.r': 0.12,
      'lfo1.rate': 0.15, 'lfo1.shape': 0, 'lfo1.retrig': 2,
    }, [
      { source: 'lfo1', dest: 'lad.cutoff', amount: 0.15 }, { source: 'vel', dest: 'drive', amount: 0.2 },
      { source: 'mod', dest: 'osc2.tune', amount: 0.05 },
    ]),
  },
  {
    // nearly a sine (a triangle under a shut ladder), its pitch dropping as it is struck, a long boom, a little grit; the
    // amp carries on from where it is into the next note (a reset to zero clicks)
    // played: velocity deepens the pitch drop, the MOD wheel adds grit
    name: '808 Sub',
    category: 'bass',
    a: side({
      'out.level': 1,
      'voice.mode': 1, 'voice.glide': 0.05, 'osc1.width': 1, 'mix.osc1': 1, drive: 0.35, 'lad.cutoff': 400, 'lad.eg1': 0, 'filter.key': 0.5,
      'eg1.a': 0.001, 'eg1.d': 0.06, 'eg1.s': 0, 'eg1.reset': 1, 'eg2.a': 0.005, 'eg2.d': 1.8, 'eg2.s': 0, 'eg2.r': 0.3,
    }, [
      { source: 'eg1', dest: 'osc1.tune', amount: 0.03 }, { source: 'vel', dest: 'eg1.level', amount: 0.5 },
      { source: 'mod', dest: 'drive', amount: 0.4 },
    ]),
  },
  {
    // a square and its sub through a resonant ladder with a short sweep (the SH-101 and the Juno's bass)
    // played: the MOD wheel brings in a slow pulse-width sweep
    name: 'Square Bass',
    category: 'bass',
    a: side({
      'lfo1.rate': 0.8, 'lfo1.level': 0,
      'out.level': 0.59,
      'voice.mode': 1, 'osc1.blend': 1, 'osc1.width': 0.5, 'osc1.sub': 1, 'mix.osc1': 1, 'lad.cutoff': 600, 'lad.res': 0.2, 'lad.eg1': 0.3,
      'eg1.d': 0.2, 'eg1.s': 0.15, 'eg2.a': 0.002, 'eg2.d': 0.4, 'eg2.s': 0.6, 'eg2.r': 0.06,
    }, [
      { source: 'vel', dest: 'lad.cutoff', amount: 0.1 }, { source: 'mod', dest: 'lfo1.level', amount: 0.8 },
      { source: 'lfo1', dest: 'osc1.width', amount: 0.35 },
    ]),
  },
  {
    // a saw and its sub plucked by the ladder, nothing held (house)
    // played: velocity lets the pluck ring longer, the MOD wheel adds resonance
    name: 'House Pluck',
    category: 'bass',
    a: side({
      'out.level': 1,
      'voice.mode': 1, 'osc1.sub': 1, 'osc1.blend': 0.3, 'mix.osc1': 1, drive: 0.5, 'lad.cutoff': 250, 'lad.res': 0.35, 'lad.eg1': 0.55, 'filter.key': 0.4,
      'eg1.a': 0.001, 'eg1.d': 0.12, 'eg1.s': 0, 'eg1.reset': 1, 'eg2.a': 0.003, 'eg2.d': 0.3, 'eg2.s': 0, 'eg2.r': 0.05,
    }, [
      { source: 'vel', dest: 'lad.cutoff', amount: 0.15 }, { source: 'vel', dest: 'eg2.d', amount: 0.15 },
      { source: 'mod', dest: 'lad.res', amount: 0.3 },
    ]),
  },
  {
    // (as the user built it) a saw and a square an octave down with the pulses' XOR ring-mod over them, three voices
    // detuned and spread a little, driven into a ladder that follows the keys; LFO 1 wobbles the ladder, free, faster
    // the higher and the harder it is played; LFO 2, slower, pulses the oscillators' levels (the tremolo); the MOD wheel
    // deepens both and speeds the wobble up; a long glide between notes. Its level matched to the other basses
    name: 'Wobble Bass',
    category: 'bass',
    a: side({
      'out.level': 0.42, 'voice.mode': 2, 'voice.glide': 0.42, 'voice.unison': 2, 'voice.detune': 0.537, 'panner.mode': 1, 'panner.width': 0.285,
      'mix.osc1': 0.8, 'osc2.oct': 1, 'osc2.blend': 1, 'mix.osc2': 0.7, 'mix.noise': 0.627, 'noise.type': 2, drive: 0.7, overdrive: 1,
      'lad.cutoff': 1440, 'lad.res': 0.374, 'lad.eg1': 0, 'filter.key': 1, 'eg1.s': 1, 'eg1.r': 0.619, 'eg2.a': 0.003, 'eg2.s': 1, 'eg2.r': 0.08,
      'lfo1.rate': 2.655, 'lfo1.level': 0.759, 'lfo1.shape': 0, 'lfo1.div': 9, 'lfo2.rate': 0.332, 'lfo2.level': 0.805, 'lfo2.div': 6, 'mod.time': 0.184,
    }, [
      { source: 'lfo1', dest: 'lad.cutoff', amount: 0.244 }, { source: 'lfo2', dest: 'mix.osc1', amount: 0.41 },
      { source: 'lfo2', dest: 'mix.osc2', amount: 0.442 }, { source: 'vel', dest: 'lfo1.rate', amount: 0.436 },
      { source: 'kbd', dest: 'lfo1.rate', amount: 0.495 }, { source: 'mod', dest: 'lfo2.level', amount: 0.328 },
      { source: 'mod', dest: 'lfo1.level', amount: 0.33 }, { source: 'mod', dest: 'lfo1.rate', amount: 0.295 },
    ]),
  },
  {
    // Braids' wavefolder, the fold swept down on each note, a sub under it
    // played: the MOD wheel moves Braids' COLOR
    name: 'Fold Bass',
    category: 'bass',
    a: side({
      'voice.mode': 1, 'osc3.mode': 2, 'osc3.braids': 3, 'osc3.timbre': 0.25, 'osc3.morph': 0.5, 'mix.osc1': 0.5, 'osc1.sub': 1, 'osc1.blend': 1,
      'mix.osc3': 1, 'lad.cutoff': 2500, 'lad.eg1': 0, 'eg1.a': 0.001, 'eg1.d': 0.25, 'eg1.s': 0.1, 'eg2.a': 0.002, 'eg2.d': 0.5, 'eg2.s': 0.6, 'eg2.r': 0.08,
    }, [
      { source: 'eg1', dest: 'osc3.timbre', amount: 0.4 }, { source: 'vel', dest: 'osc3.timbre', amount: 0.1 },
      { source: 'mod', dest: 'osc3.morph', amount: 0.3 },
    ]),
  },
  {
    // Plaits' waveshaper over a sub, round and bouncy, the shape pushed by each note; glide
    // played: velocity pushes the shape further, the MOD wheel moves Plaits' MORPH
    name: 'Rubber Bass',
    category: 'bass',
    a: side({
      'voice.mode': 2, 'voice.glide': 0.06, 'osc3.mode': 1, 'osc3.model': 1, 'osc3.harm': 0.3, 'osc3.timbre': 0.35, 'osc3.morph': 0.2,
      'osc1.sub': 1, 'osc1.blend': 1, 'mix.osc1': 0.6, 'mix.osc3': 1, 'lad.cutoff': 3000, 'lad.eg1': 0, 'eg1.a': 0.001, 'eg1.d': 0.18, 'eg1.s': 0,
      'eg2.a': 0.002, 'eg2.d': 0.5, 'eg2.s': 0.6, 'eg2.r': 0.08,
    }, [
      { source: 'eg1', dest: 'osc3.timbre', amount: 0.3 }, { source: 'vel', dest: 'osc3.timbre', amount: 0.2 },
      { source: 'mod', dest: 'osc3.morph', amount: 0.4 },
    ]),
  },
  {
    // Plaits' FM, a burst of brightness on the attack falling away at once: a slap
    // played: the MOD wheel adds FM feedback (grit)
    name: 'DX Slap',
    category: 'bass',
    a: side({
      'out.level': 1,
      'voice.mode': 1, 'osc3.mode': 1, 'osc3.model': 2, 'osc3.harm': 0.7, 'osc3.timbre': 0.1, 'osc3.morph': 0.2, 'mix.osc1': 0, 'mix.osc3': 1,
      'lad.cutoff': 6000, 'lad.eg1': 0, 'eg1.a': 0.001, 'eg1.d': 0.08, 'eg1.s': 0, 'eg2.a': 0.001, 'eg2.d': 0.6, 'eg2.s': 0.4, 'eg2.r': 0.1,
    }, [
      { source: 'eg1', dest: 'osc3.timbre', amount: 0.55 }, { source: 'vel', dest: 'osc3.timbre', amount: 0.15 },
      { source: 'mod', dest: 'osc3.morph', amount: 0.4 },
    ]),
  },
  {
    // between a saw and a triangle with its sub, a gentle ladder: round and warm; velocity is how hard it is played
    // played: velocity and the MOD wheel open the ladder, the pitch drifts a hair
    name: 'Deep Bass',
    category: 'bass',
    a: side({
      'lfo2.rate': 0.23, 'lfo2.retrig': 1,
      'voice.mode': 1, 'osc1.width': 0.6, 'osc1.sub': 1, 'osc1.blend': 0.5, 'mix.osc1': 1, 'lad.cutoff': 220, 'lad.res': 0.1, 'lad.eg1': 0.15,
      'eg1.d': 0.3, 'eg1.s': 0.3, 'eg2.a': 0.003, 'eg2.d': 0.8, 'eg2.s': 0.7, 'eg2.r': 0.15,
    }, [
      { source: 'vel', dest: 'eg2.level', amount: 0.3 }, { source: 'vel', dest: 'lad.cutoff', amount: 0.1 },
      { source: 'mod', dest: 'lad.cutoff', amount: 0.15 }, { source: 'lfo2', dest: 'osc1.tune', amount: 0.002 },
    ]),
  },
  {
    // a square, a saw and noise overdriven, a band-pass growling beside the ladder
    // played: velocity opens it, the MOD wheel sweeps the growling band-pass
    name: 'Dirty Bass',
    category: 'bass',
    a: side({
      'out.level': 1,
      'voice.mode': 1, 'osc1.blend': 1, 'mix.osc1': 1, 'mix.osc2': 0.8, 'osc2.tune': 0.07, 'mix.noise': 0.08, drive: 0.9, overdrive: 1,
      'lad.cutoff': 1800, 'lad.res': 0.3, 'lad.eg1': 0.25, 'filter.route': 2, 'sem.bp': 1, 'sem.cutoff': 900, 'sem.res': 0.35,
      'eg1.d': 0.2, 'eg1.s': 0.3, 'eg2.a': 0.002, 'eg2.d': 0.4, 'eg2.s': 0.9, 'eg2.r': 0.06,
    }, [{ source: 'vel', dest: 'lad.cutoff', amount: 0.15 }, { source: 'mod', dest: 'sem.cutoff', amount: 0.3 }]),
  },
  {
    // a saw and a pulse, a punchy ladder, tight (eighties synth pop)
    // played: velocity snaps the envelope harder, the MOD wheel brings in a pulse-width sweep, the pitch drifts a hair
    name: 'Synth Pop Bass',
    category: 'bass',
    a: side({
      'lfo1.rate': 0.6, 'lfo1.level': 0, 'lfo2.rate': 0.31, 'lfo2.retrig': 1,
      'out.level': 1,
      'voice.mode': 1, 'mix.osc1': 1, 'mix.osc2': 0.8, 'osc2.blend': 1, 'osc2.width': 0.3, drive: 0.4, 'lad.cutoff': 900, 'lad.res': 0.25, 'lad.eg1': 0.35,
      'eg1.d': 0.15, 'eg1.s': 0.2, 'eg2.a': 0.001, 'eg2.d': 0.25, 'eg2.s': 0.5, 'eg2.r': 0.05,
    }, [
      { source: 'vel', dest: 'lad.cutoff', amount: 0.12 }, { source: 'vel', dest: 'eg1.level', amount: 0.3 },
      { source: 'mod', dest: 'lfo1.level', amount: 0.8 }, { source: 'lfo1', dest: 'osc2.width', amount: 0.3 },
      { source: 'lfo2', dest: 'osc1.tune', amount: 0.002 },
    ]),
  },
  // ---- KEYS
  {
    // (as the user played it into being, from Digi Keys) the stepped PPG DIGI table swept down on each note under a dark
    // ladder plucked by EG 1; played, not just pressed: velocity is its dynamics (the table's level from soft to full,
    // the ladder a touch brighter, a little more drift); the MOD wheel brings in a tremolo on the table's level (LFO 1,
    // silent until the wheel moves); LFO 2, barely there and wandering its own rate, keeps the pitch alive
    name: 'Dream Keys',
    category: 'keys',
    a: side({
      'mix.osc1': 0, 'mix.osc3': 0.379, 'osc3.table': 2, 'osc3.pos': 0.6, 'osc3.interp': 0, 'lad.cutoff': 624, 'lad.eg1': 0.306,
      'eg1.d': 0.6, 'eg2.d': 1.2, 'eg2.s': 0.3, 'eg2.r': 0.5, 'lfo1.level': 0, 'lfo2.rate': 3.452, 'lfo2.level': 0.021, 'panner.mode': 1,
    }, [
      { source: 'eg1', dest: 'osc3.pos', amount: -0.5 },
      { source: 'vel', dest: 'mix.osc3', amount: 1 }, { source: 'vel', dest: 'lad.cutoff', amount: 0.111 }, { source: 'vel', dest: 'lfo2.level', amount: 0.053 },
      { source: 'mod', dest: 'lfo1.level', amount: 0.866 }, { source: 'lfo1', dest: 'mix.osc3', amount: 0.782 },
      { source: 'lfo2', dest: 'osc3.tune', amount: 0.065 }, { source: 'lfo2', dest: 'lfo2.rate', amount: -0.336 },
    ]),
  },
  // ---- LEAD: mono and legato unless said; velocity does more than loudness, the MOD wheel brings in movement
  {
    // two saws a hair apart into a ladder with a little envelope, a short glide
    // played: velocity opens the ladder and sharpens its envelope, the MOD wheel brings in vibrato, the second saw drifts
    name: 'Saw Lead',
    category: 'lead',
    a: side({
      'voice.mode': 2, 'voice.glide': 0.04, 'mix.osc1': 0.8, 'mix.osc2': 0.7, 'osc2.tune': 0.08, drive: 0.2,
      'lad.cutoff': 2500, 'lad.res': 0.2, 'lad.eg1': 0.2, 'eg1.d': 0.4, 'eg1.s': 0.4, 'eg2.a': 0.003, 'eg2.d': 0.5, 'eg2.s': 0.85, 'eg2.r': 0.2,
      'lfo1.rate': 0.2, 'lfo1.retrig': 1, 'lfo2.rate': 5.5, 'lfo2.shape': 0, 'lfo2.level': 0,
    }, [
      { source: 'vel', dest: 'lad.cutoff', amount: 0.15 }, { source: 'vel', dest: 'eg1.level', amount: 0.3 },
      { source: 'mod', dest: 'lfo2.level', amount: 0.8 }, { source: 'lfo2', dest: 'osc1.tune', amount: 0.004 },
      { source: 'lfo2', dest: 'osc2.tune', amount: 0.004 }, { source: 'lfo1', dest: 'osc2.tune', amount: 0.002 },
    ]),
  },
  {
    // a square, a vibrato creeping in as a note is held
    // played: velocity opens the ladder, the MOD wheel brings in a pulse-width sweep
    name: 'Square Lead',
    category: 'lead',
    a: side({
      'out.level': 0.62,
      'voice.mode': 2, 'voice.glide': 0.03, 'osc1.blend': 1, 'osc1.width': 0.5, 'mix.osc1': 1, 'lad.cutoff': 2000, 'lad.res': 0.15, 'lad.eg1': 0.25,
      'eg1.d': 0.3, 'eg1.s': 0.3, 'eg2.a': 0.003, 'eg2.s': 0.9, 'eg2.r': 0.15, 'lfo1.rate': 0.7, 'lfo1.level': 0,
      'lfo2.rate': 5.2, 'lfo2.shape': 0, 'lfo2.level': 0, 'mod.time': 1.5,
    }, [
      { source: 'vel', dest: 'lad.cutoff', amount: 0.15 }, { source: 'mod', dest: 'lfo1.level', amount: 0.8 },
      { source: 'lfo1', dest: 'osc1.width', amount: 0.35 }, { source: 'time', dest: 'lfo2.level', amount: 0.5 },
      { source: 'lfo2', dest: 'osc1.tune', amount: 0.003 },
    ]),
  },
  {
    // OSC 2 hard-synced to OSC 1, its pitch swept down by EG 1 on each note: the classic sync scream; vibrato as it holds
    // played: velocity sweeps it further, the MOD wheel raises the synced pitch (it screams)
    name: 'Sync Scream',
    category: 'lead',
    a: side({
      'out.level': 0.68,
      'voice.mode': 2, 'voice.glide': 0.03, 'mix.osc1': 0, 'mix.osc2': 1, 'osc2.sync': 1, drive: 0.4, 'lad.cutoff': 4000, 'lad.res': 0.25, 'lad.eg1': 0.1,
      'eg1.d': 0.5, 'eg1.s': 0.2, 'eg2.a': 0.003, 'eg2.s': 0.9, 'eg2.r': 0.2, 'lfo2.rate': 5.5, 'lfo2.shape': 0, 'lfo2.level': 0, 'mod.time': 1.2,
    }, [
      { source: 'eg1', dest: 'osc2.tune', amount: 0.25 }, { source: 'vel', dest: 'eg1.level', amount: 0.4 },
      { source: 'mod', dest: 'osc2.tune', amount: 0.15 }, { source: 'time', dest: 'lfo2.level', amount: 0.5 },
      { source: 'lfo2', dest: 'osc1.tune', amount: 0.003 },
    ]),
  },
  {
    // the rave hoover: a saw and a pulse an octave down, four voices a note detuned wide and spread, each note swooping
    // up from below (EG 1 on the pitch), a long glide
    // played: velocity deepens the swoop, the MOD wheel brings in a rasping pulse-width
    name: 'Hoover',
    category: 'lead',
    a: side({
      'out.level': 0.3,
      'voice.mode': 2, 'voice.glide': 0.15, 'mix.osc1': 0.8, 'osc2.oct': 1, 'osc2.blend': 1, 'osc2.width': 0.3, 'mix.osc2': 0.7, drive: 0.3,
      'voice.unison': 3, 'voice.detune': 0.6, 'panner.mode': 1, 'panner.width': 1, 'lad.cutoff': 3500, 'lad.eg1': 0,
      'eg1.a': 0.001, 'eg1.d': 0.25, 'eg1.s': 0, 'eg2.a': 0.01, 'eg2.s': 1, 'eg2.r': 0.3, 'lfo1.rate': 4, 'lfo1.level': 0,
    }, [
      { source: 'eg1', dest: 'osc1.tune', amount: -0.04 }, { source: 'eg1', dest: 'osc2.tune', amount: -0.04 },
      { source: 'vel', dest: 'eg1.level', amount: 0.4 }, { source: 'mod', dest: 'lfo1.level', amount: 0.7 },
      { source: 'lfo1', dest: 'osc2.width', amount: 0.4 },
    ]),
  },
  {
    // two saws an octave apart into a resonant ladder that follows the keys, a long glide (the classic mono lead)
    // played: velocity opens the ladder, the MOD wheel brings in vibrato, a hair of drift
    name: 'Mini Lead',
    category: 'lead',
    a: side({
      'out.level': 0.96,
      'voice.mode': 2, 'voice.glide': 0.08, 'mix.osc1': 0.8, 'mix.osc2': 0.7, 'osc2.oct': 3, 'osc2.tune': 0.06, 'lad.cutoff': 1800, 'lad.res': 0.35,
      'lad.eg1': 0.3, 'filter.key': 0.6, 'eg1.d': 0.5, 'eg1.s': 0.5, 'eg2.a': 0.005, 'eg2.s': 0.9, 'eg2.r': 0.15,
      'lfo1.rate': 0.17, 'lfo1.retrig': 1, 'lfo2.rate': 5, 'lfo2.shape': 0, 'lfo2.level': 0,
    }, [
      { source: 'vel', dest: 'lad.cutoff', amount: 0.12 }, { source: 'mod', dest: 'lfo2.level', amount: 0.7 },
      { source: 'lfo2', dest: 'osc1.tune', amount: 0.004 }, { source: 'lfo2', dest: 'osc2.tune', amount: 0.004 },
      { source: 'lfo1', dest: 'osc1.tune', amount: 0.002 },
    ]),
  },
  {
    // a near-sine an octave up, a long glide, a vibrato growing as it holds and a breath of noise (the g-funk whistle)
    // played: velocity adds breath, the MOD wheel deepens the vibrato
    name: 'Whistle Lead',
    category: 'lead',
    a: side({
      'out.level': 0.92,
      'voice.mode': 2, 'voice.glide': 0.12, 'osc1.width': 1, 'osc1.oct': 3, 'mix.osc1': 1, 'mix.noise': 0.02, 'noise.type': 1,
      'lad.cutoff': 5000, 'lad.eg1': 0, 'eg2.a': 0.03, 'eg2.s': 1, 'eg2.r': 0.2, 'lfo2.rate': 5.8, 'lfo2.shape': 0, 'lfo2.level': 0, 'mod.time': 0.8,
    }, [
      { source: 'time', dest: 'lfo2.level', amount: 0.6 }, { source: 'lfo2', dest: 'osc1.tune', amount: 0.004 },
      { source: 'mod', dest: 'lfo2.level', amount: 0.4 }, { source: 'vel', dest: 'mix.noise', amount: 0.05 },
    ]),
  },
  {
    // a pulse with nothing in its way (the eight-bit lead)
    // played: velocity narrows the pulse, the MOD wheel brings in a semitone trill (a square LFO on the pitch)
    name: 'Chip Lead',
    category: 'lead',
    a: side({
      'out.level': 0.72,
      'voice.mode': 2, 'osc1.blend': 1, 'osc1.width': 0.5, 'mix.osc1': 0.9, 'lad.cutoff': 12000, 'lad.eg1': 0,
      'eg2.a': 0.001, 'eg2.d': 0.3, 'eg2.s': 0.7, 'eg2.r': 0.05, 'lfo2.rate': 6, 'lfo2.shape': 2, 'lfo2.level': 0,
    }, [
      { source: 'vel', dest: 'osc1.width', amount: 0.2 }, { source: 'mod', dest: 'lfo2.level', amount: 0.8 },
      { source: 'lfo2', dest: 'osc1.tune', amount: 0.016 },
    ]),
  },
  {
    // a saw driven into a ladder near self-oscillation, snapping on each note, sliding between legato ones (a 303 up high)
    // played: velocity is the accent (brighter, a bigger snap), the MOD wheel opens the ladder
    name: 'Acid Lead',
    category: 'lead',
    a: side({
      'out.level': 1,
      'voice.mode': 2, 'voice.glide': 0.05, 'mix.osc1': 1, drive: 0.6, overdrive: 1, 'lad.cutoff': 500, 'lad.res': 0.8, 'lad.eg1': 0.5, 'filter.key': 0.5,
      'eg1.d': 0.25, 'eg1.s': 0, 'eg2.a': 0.002, 'eg2.d': 0.4, 'eg2.s': 0.7, 'eg2.r': 0.06,
    }, [
      { source: 'vel', dest: 'lad.cutoff', amount: 0.2 }, { source: 'vel', dest: 'eg1.level', amount: 0.5 },
      { source: 'mod', dest: 'lad.cutoff', amount: 0.3 },
    ]),
  },
  {
    // two saws apart, the ladder blatting open on the attack (EG 1 a little slow), a vibrato as it holds (a brass lead)
    // played: velocity blats harder and sooner, the MOD wheel brightens it
    name: 'Brass Lead',
    category: 'lead',
    a: side({
      'voice.mode': 2, 'voice.glide': 0.02, 'mix.osc1': 0.8, 'mix.osc2': 0.7, 'osc2.tune': 0.1, 'lad.cutoff': 700, 'lad.res': 0.1, 'lad.eg1': 0.35,
      'eg1.a': 0.06, 'eg1.d': 0.5, 'eg1.s': 0.5, 'eg2.a': 0.03, 'eg2.s': 0.9, 'eg2.r': 0.2, 'lfo2.rate': 5, 'lfo2.shape': 0, 'lfo2.level': 0, 'mod.time': 1.2,
    }, [
      { source: 'vel', dest: 'eg1.level', amount: 0.5 }, { source: 'vel', dest: 'eg1.a', amount: -0.2 },
      { source: 'time', dest: 'lfo2.level', amount: 0.4 }, { source: 'lfo2', dest: 'osc1.tune', amount: 0.003 },
      { source: 'lfo2', dest: 'osc2.tune', amount: 0.003 }, { source: 'mod', dest: 'lad.cutoff', amount: 0.2 },
    ]),
  },
  {
    // Braids' VOWEL FOF singing, a vibrato as it holds
    // played: velocity shifts the formants, the MOD wheel changes the vowel
    name: 'Vowel Lead',
    category: 'lead',
    a: side({
      'out.level': 1,
      'voice.mode': 2, 'voice.glide': 0.06, 'osc3.mode': 2, 'osc3.braids': 23, 'osc3.timbre': 0.4, 'osc3.morph': 0.5, 'mix.osc1': 0, 'mix.osc3': 1, drive: 0.6,
      'lad.cutoff': 6000, 'lad.eg1': 0, 'eg2.a': 0.02, 'eg2.s': 1, 'eg2.r': 0.25, 'lfo2.rate': 5.2, 'lfo2.shape': 0, 'lfo2.level': 0, 'mod.time': 1,
    }, [
      { source: 'mod', dest: 'osc3.timbre', amount: 0.4 }, { source: 'vel', dest: 'osc3.morph', amount: 0.2 },
      { source: 'time', dest: 'lfo2.level', amount: 0.5 }, { source: 'lfo2', dest: 'osc3.tune', amount: 0.003 },
    ]),
  },
  {
    // Plaits' FM, bright as each note starts (EG 1 on the amount)
    // played (the user's version): a lot of feedback at rest for a raspy edge; velocity brightens it, the MOD wheel
    // pulls the feedback back to a purer tone and adds vibrato
    name: 'FM Lead',
    category: 'lead',
    a: side({
      'out.level': 1,
      'voice.mode': 2, 'voice.glide': 0.04, 'osc3.mode': 1, 'osc3.model': 2, 'osc3.harm': 0.5, 'osc3.timbre': 0.176, 'osc3.morph': 0.546,
      'mix.osc1': 0, 'mix.osc3': 1, 'lad.cutoff': 8000, 'lad.eg1': 0, 'eg1.d': 0.4, 'eg1.s': 0.3, 'eg2.a': 0.005, 'eg2.s': 0.9, 'eg2.r': 0.2,
      'lfo2.rate': 5.5, 'lfo2.shape': 0, 'lfo2.level': 0,
    }, [
      { source: 'eg1', dest: 'osc3.timbre', amount: 0.2 }, { source: 'vel', dest: 'osc3.timbre', amount: 0.15 },
      { source: 'mod', dest: 'osc3.morph', amount: -0.322 }, { source: 'mod', dest: 'lfo2.level', amount: 0.5 },
      { source: 'lfo2', dest: 'osc3.tune', amount: 0.003 },
    ]),
  },
  {
    // a square and a saw apart, driven hard, a resonant band-pass beside the ladder (the body stays as the band moves)
    // played: velocity drives it harder, the MOD wheel sweeps the band, the saw drifts
    name: 'Distorted Lead',
    category: 'lead',
    a: side({
      'out.level': 0.8,
      'voice.mode': 2, 'voice.glide': 0.03, 'osc1.blend': 1, 'mix.osc1': 1, 'mix.osc2': 0.8, 'osc2.tune': 0.15, drive: 0.7,
      'lad.cutoff': 3000, 'lad.res': 0.2, 'lad.eg1': 0.1, 'filter.route': 2, 'sem.bp': 1, 'sem.cutoff': 1400, 'sem.res': 0.15,
      'eg2.a': 0.003, 'eg2.s': 0.9, 'eg2.r': 0.15, 'lfo1.rate': 0.19, 'lfo1.retrig': 1,
    }, [
      { source: 'vel', dest: 'drive', amount: 0.2 }, { source: 'vel', dest: 'lad.cutoff', amount: 0.1 },
      { source: 'mod', dest: 'sem.cutoff', amount: 0.3 }, { source: 'lfo1', dest: 'osc2.tune', amount: 0.003 },
    ]),
  },
  // ---- PAD: slow bows and long fades; velocity is how hard the bow, the MOD wheel opens or moves them, they drift
  {
    // two saws apart, two voices a note spread, a slow bow under a gentle ladder
    // played: velocity brightens it and plays it louder, the MOD wheel opens the ladder, the second saw drifts
    name: 'Warm Pad',
    category: 'pad',
    a: side({
      'out.level': 0.55,
      'mix.osc1': 0.7, 'mix.osc2': 0.7, 'osc2.tune': 0.1, 'lad.cutoff': 1200, 'lad.res': 0.1, 'lad.eg1': 0.1,
      'eg1.a': 1, 'eg1.d': 2, 'eg1.s': 0.6, 'eg2.a': 0.8, 'eg2.d': 2, 'eg2.s': 0.85, 'eg2.r': 2,
      'voice.unison': 1, 'voice.detune': 0.25, 'panner.mode': 1, 'lfo2.rate': 0.21, 'lfo2.retrig': 1,
    }, [
      { source: 'vel', dest: 'lad.cutoff', amount: 0.1 }, { source: 'vel', dest: 'eg2.level', amount: 0.3 },
      { source: 'mod', dest: 'lad.cutoff', amount: 0.25 }, { source: 'lfo2', dest: 'osc2.tune', amount: 0.003 },
    ]),
  },
  {
    // a pulse whose width breathes (LFO 1, shared by all the voices), the lows taken off (the Juno's string pad)
    // played: velocity brightens it, the MOD wheel quickens the breathing
    name: 'Juno Pad',
    category: 'pad',
    a: side({
      'out.level': 0.56,
      'osc1.blend': 1, 'osc1.width': 0.4, 'mix.osc1': 1, 'lad.cutoff': 2000, 'lad.res': 0.1, 'lad.eg1': 0,
      'filter.route': 1, 'sem.mode': 1, 'sem.cutoff': 150, 'eg2.a': 0.5, 'eg2.d': 1.5, 'eg2.s': 0.8, 'eg2.r': 1.5,
      'lfo1.rate': 0.6, 'lfo1.retrig': 2, 'panner.mode': 1,
    }, [
      { source: 'lfo1', dest: 'osc1.width', amount: 0.25 }, { source: 'mod', dest: 'lfo1.rate', amount: 0.4 },
      { source: 'vel', dest: 'lad.cutoff', amount: 0.15 },
    ]),
  },
  {
    // saws under a resonant ladder that a slow LFO sweeps open and shut
    // played: velocity brightens it, the MOD wheel quickens the sweep
    name: 'Sweep Pad',
    category: 'pad',
    a: side({
      'out.level': 0.43,
      'mix.osc1': 0.7, 'mix.osc2': 0.7, 'osc2.tune': 0.12, 'lad.cutoff': 600, 'lad.res': 0.45, 'lad.eg1': 0,
      'eg2.a': 1.2, 'eg2.d': 2, 'eg2.s': 0.9, 'eg2.r': 2.5, 'voice.unison': 1, 'voice.detune': 0.2, 'panner.mode': 1,
      'lfo1.rate': 0.07, 'lfo1.retrig': 2,
    }, [
      { source: 'lfo1', dest: 'lad.cutoff', amount: 0.3 }, { source: 'mod', dest: 'lfo1.rate', amount: 0.5 },
      { source: 'vel', dest: 'lad.cutoff', amount: 0.1 },
    ]),
  },
  {
    // a triangle, a saw an octave down and pink noise, low and closed, no lows under it
    // played: velocity plays it louder, the MOD wheel opens it, the saw drifts
    name: 'Dark Pad',
    category: 'pad',
    a: side({
      'out.level': 1,
      'osc1.width': 1, 'mix.osc1': 0.7, 'osc2.oct': 1, 'mix.osc2': 0.5, 'mix.noise': 0.1, 'noise.type': 1, 'lad.cutoff': 500, 'lad.eg1': 0,
      'filter.route': 1, 'sem.mode': 1, 'sem.cutoff': 120, 'eg2.a': 1.5, 'eg2.d': 2, 'eg2.s': 0.9, 'eg2.r': 3,
      'lfo2.rate': 0.17, 'lfo2.retrig': 1,
    }, [
      { source: 'mod', dest: 'lad.cutoff', amount: 0.25 }, { source: 'vel', dest: 'eg2.level', amount: 0.3 },
      { source: 'lfo2', dest: 'osc2.tune', amount: 0.003 },
    ]),
  },
  {
    // white noise through a high band-pass that follows the keys, over a whisper of sine; the band drifting
    // played: velocity adds air, the MOD wheel raises the band
    name: 'Air Pad',
    category: 'pad',
    a: side({
      'out.level': 1,
      'osc1.width': 1, 'mix.osc1': 0.3, 'mix.noise': 1, 'lad.cutoff': 12000, 'lad.eg1': 0, 'filter.route': 1, 'sem.bp': 1,
      'sem.cutoff': 2500, 'sem.res': 0.4, 'filter.key': 0.8, 'eg2.a': 1, 'eg2.s': 1, 'eg2.r': 2.5, 'lfo1.rate': 0.13, 'lfo1.retrig': 1,
    }, [
      { source: 'lfo1', dest: 'sem.cutoff', amount: 0.15 }, { source: 'mod', dest: 'sem.cutoff', amount: 0.2 },
      { source: 'vel', dest: 'mix.noise', amount: 0.2 },
    ]),
  },
  {
    // the PPG SYNC table drifting through its frames, two voices a note detuned and spread
    // played: velocity brightens it, the MOD wheel scans the table
    name: 'Wavetable Pad',
    category: 'pad',
    a: side({
      'out.level': 0.59,
      'mix.osc1': 0, 'mix.osc3': 1, 'osc3.table': 1, 'osc3.pos': 0.3, 'lad.cutoff': 5000, 'lad.eg1': 0,
      'eg2.a': 0.9, 'eg2.d': 2, 'eg2.s': 0.9, 'eg2.r': 2, 'voice.unison': 1, 'voice.detune': 0.2, 'panner.mode': 1,
      'lfo1.rate': 0.11, 'lfo1.retrig': 2,
    }, [
      { source: 'lfo1', dest: 'osc3.pos', amount: 0.25 }, { source: 'mod', dest: 'osc3.pos', amount: 0.4 },
      { source: 'vel', dest: 'lad.cutoff', amount: 0.1 },
    ]),
  },
  {
    // Plaits' CHORDS (the user's version): one chord from each key, played mono, half the AUX under it
    // played: velocity brightens it; the MOD wheel brings in random voicings stepping in 1/16 triplets with the
    // tempo (LFO 1 on MORPH) and a slower bar-by-bar random shift of the chord's colour (LFO 2 on TIMBRE)
    name: 'Chord Pad',
    category: 'pad',
    a: side({
      // a touch of drive lifts Plaits (quiet from one key) to sit with the other pads
      'out.level': 1, drive: 0.4, 'voice.mode': 1,
      'osc3.mode': 1, 'osc3.model': 6, 'osc3.harm': 0.338, 'osc3.timbre': 0, 'osc3.morph': 0.095, 'osc3.aux': 0.483, 'mix.osc1': 0, 'mix.osc3': 1,
      'lad.cutoff': 4000, 'lad.eg1': 0, 'eg2.a': 0.7, 'eg2.d': 2, 'eg2.s': 0.9, 'eg2.r': 2, 'panner.mode': 1,
      'lfo1.shape': 5, 'lfo1.sync': 1, 'lfo1.div': 9, 'lfo1.level': 0, 'lfo1.retrig': 1,
      'lfo2.shape': 5, 'lfo2.sync': 1, 'lfo2.div': 2, 'lfo2.level': 0, 'lfo2.retrig': 1,
    }, [
      { source: 'vel', dest: 'lad.cutoff', amount: 0.1 },
      { source: 'mod', dest: 'lfo1.level', amount: 1 }, { source: 'lfo1', dest: 'osc3.morph', amount: 1 },
      { source: 'mod', dest: 'lfo2.level', amount: 0.208 }, { source: 'lfo2', dest: 'osc3.timbre', amount: 1 },
    ]),
  },
  {
    // Plaits' SWARM (the user's version): a tight cloud of saws round each note, TIMBRE and MORPH full up
    // played: velocity brightens it; the MOD wheel spreads the swarm wide (HARMONICS up) while pulling MORPH and
    // TIMBRE back, from a dense unison to a scattered cloud
    name: 'Swarm Pad',
    category: 'pad',
    a: side({
      'out.level': 1,
      'osc3.mode': 1, 'osc3.model': 8, 'osc3.harm': 0.184, 'osc3.timbre': 1, 'osc3.morph': 1, 'mix.osc1': 0, 'mix.osc3': 1,
      'lad.cutoff': 4500, 'lad.eg1': 0, 'eg2.a': 1, 'eg2.d': 2, 'eg2.s': 0.9, 'eg2.r': 2.5, 'lfo2.rate': 0.15, 'lfo2.retrig': 1,
    }, [
      { source: 'vel', dest: 'lad.cutoff', amount: 0.1 },
      { source: 'mod', dest: 'osc3.harm', amount: 1 },
      { source: 'mod', dest: 'osc3.morph', amount: -0.597 },
      { source: 'mod', dest: 'osc3.timbre', amount: -0.229 },
    ]),
  },
  {
    // Plaits' ADDITIVE, its harmonics slowly turning
    // played: velocity brightens it, the MOD wheel brings in more harmonics
    name: 'Shimmer Pad',
    category: 'pad',
    a: side({
      'out.level': 1,
      'osc3.mode': 1, 'osc3.model': 4, 'osc3.harm': 0.6, 'osc3.timbre': 0.5, 'osc3.morph': 0.5, 'mix.osc1': 0, 'mix.osc3': 1,
      'lad.cutoff': 9000, 'lad.eg1': 0, 'eg2.a': 1, 'eg2.d': 2, 'eg2.s': 0.9, 'eg2.r': 2.5, 'panner.mode': 1, 'lfo1.rate': 0.09, 'lfo1.retrig': 2,
    }, [
      { source: 'lfo1', dest: 'osc3.timbre', amount: 0.2 }, { source: 'mod', dest: 'osc3.harm', amount: 0.25 },
      { source: 'vel', dest: 'lad.cutoff', amount: 0.1 },
    ]),
  },
  {
    // Braids' GRANULAR CLOUD, a long swell and fade
    // played: velocity colours the grains, the MOD wheel thickens the cloud
    name: 'Granular Pad',
    category: 'pad',
    a: side({
      'out.level': 1,
      'osc3.mode': 2, 'osc3.braids': 44, 'osc3.timbre': 0.5, 'osc3.morph': 0.5, 'mix.osc1': 0, 'mix.osc3': 1,
      'lad.cutoff': 6000, 'lad.eg1': 0, 'eg2.a': 1, 'eg2.d': 2, 'eg2.s': 0.9, 'eg2.r': 3, 'panner.mode': 1,
    }, [
      { source: 'mod', dest: 'osc3.timbre', amount: 0.35 }, { source: 'vel', dest: 'osc3.morph', amount: 0.15 },
    ]),
  },
  {
    // a dark saw pad (A) turning into a bright wavetable one (B) over eight seconds of each held note (TIME on the morph)
    // played: velocity plays it louder, the MOD wheel pushes the morph on
    name: 'Evolving Pad',
    category: 'pad',
    a: side({
      'out.level': 0.72,
      'mix.osc1': 0.7, 'mix.osc2': 0.7, 'osc2.tune': 0.1, 'mix.osc3': 0, 'osc3.table': 1, 'osc3.pos': 0.4, 'lad.cutoff': 500, 'lad.eg1': 0,
      'eg2.a': 1, 'eg2.d': 2, 'eg2.s': 0.9, 'eg2.r': 2.5, 'voice.unison': 1, 'voice.detune': 0.2, 'panner.mode': 1, 'mod.time': 8,
      'lfo1.rate': 0.1, 'lfo1.retrig': 2,
    }, [
      { source: 'time', dest: 'out.morph', amount: 1 }, { source: 'mod', dest: 'out.morph', amount: 0.5 },
      { source: 'vel', dest: 'eg2.level', amount: 0.3 }, { source: 'lfo1', dest: 'osc3.pos', amount: 0.2 },
    ]),
    b: side({
      'out.level': 0.72,
      'mix.osc1': 0.1, 'mix.osc2': 0, 'osc2.tune': 0.1, 'mix.osc3': 1, 'osc3.table': 1, 'osc3.pos': 0.4, 'lad.cutoff': 6000, 'lad.eg1': 0,
      'eg2.a': 1, 'eg2.d': 2, 'eg2.s': 0.9, 'eg2.r': 2.5, 'voice.unison': 1, 'voice.detune': 0.2, 'panner.mode': 1, 'mod.time': 8,
      'lfo1.rate': 0.1, 'lfo1.retrig': 2,
    }, [
      { source: 'time', dest: 'out.morph', amount: 1 }, { source: 'mod', dest: 'out.morph', amount: 0.5 },
      { source: 'vel', dest: 'eg2.level', amount: 0.3 }, { source: 'lfo1', dest: 'osc3.pos', amount: 0.2 },
    ]),
  },
  {
    // Plaits' FM at a bell's ratio, swelling in and brightening as it swells (a slow EG 1 on the amount), spread
    // (the user's version): much more FM and feedback, run through a low, fully resonant ladder beside a resonant SEM
    // up high (parallel), both swept down slowly by LFO 1 so the two resonances drift
    // played: velocity brightens it, the MOD wheel adds feedback
    name: 'Ice Pad',
    category: 'pad',
    a: side({
      'out.level': 0.48,
      'osc3.mode': 1, 'osc3.model': 2, 'osc3.harm': 0.62, 'osc3.timbre': 0.664, 'osc3.morph': 0.647, 'mix.osc1': 0, 'mix.osc3': 1,
      'filter.route': 2, 'lad.cutoff': 624, 'lad.res': 1, 'lad.eg1': 0, 'sem.cutoff': 2851, 'sem.res': 1, 'sem.mode': 0.285,
      'eg1.a': 1, 'eg1.d': 2, 'eg1.s': 0.5, 'eg2.a': 0.6, 'eg2.d': 2, 'eg2.s': 0.85, 'eg2.r': 3,
      'voice.unison': 2, 'voice.detune': 0.15, 'panner.mode': 1, 'lfo1.rate': 0.268, 'lfo1.level': 0.206, 'lfo1.retrig': 1,
    }, [
      { source: 'eg1', dest: 'osc3.timbre', amount: 0.2 }, { source: 'vel', dest: 'osc3.timbre', amount: 0.1 },
      { source: 'mod', dest: 'osc3.morph', amount: 0.3 },
      { source: 'lfo1', dest: 'lad.cutoff', amount: -0.973 }, { source: 'lfo1', dest: 'sem.cutoff', amount: -0.751 },
    ]),
  },
  // ---- KEYS: struck and played; velocity is the touch, the MOD wheel the effect a keyboard player reaches for
  {
    // (the user's version) Plaits' ADDITIVE on its ORGAN output, the keyboard opening up its harmonics as it climbs,
    // a resonant SEM in series below it (lower on higher keys) for the body, held while the key is down
    // played: velocity drives it harder; the MOD wheel brings in a stereo tremolo (LFO 2 sweeping the pan, all voices
    // in step) and a slow LFO 1 turning the tone and level, the voices spun across the stereo field
    name: 'Wurly',
    category: 'keys',
    a: side({
      'out.level': 0.698, 'out.pan': -1, 'out.spin': 1, 'panner.width': 1,
      'osc1.blend': 1, 'osc1.width': 0.2, 'mix.osc1': 0, 'osc2.width': 1, 'mix.osc2': 0,
      'osc3.mode': 1, 'osc3.model': 4, 'osc3.harm': 0, 'osc3.timbre': 0.025, 'osc3.morph': 0, 'osc3.aux': 1, 'mix.osc3': 0.721,
      drive: 0.3, 'lad.cutoff': 20000, 'lad.res': 0.1, 'lad.eg1': 0.3,
      'filter.route': 1, 'sem.cutoff': 86, 'sem.res': 0.753, 'sem.mode': 1,
      'eg1.level': 1, 'eg1.d': 0.25, 'eg1.s': 0, 'eg1.r': 0.001, 'eg2.a': 0.001, 'eg2.d': 0.001, 'eg2.s': 1, 'eg2.r': 0.001,
      'voice.unison': 1, 'voice.detune': 0.192,
      'lfo1.rate': 0.12, 'lfo1.level': 0, 'lfo1.retrig': 1, 'lfo2.rate': 3.91, 'lfo2.level': 0.183, 'lfo2.retrig': 2,
    }, [
      { source: 'vel', dest: 'drive', amount: 0.3 },
      { source: 'kbd', dest: 'osc3.harm', amount: 0.692 }, { source: 'kbd', dest: 'sem.cutoff', amount: -0.514 },
      { source: 'mod', dest: 'lfo2.level', amount: 0.861 }, { source: 'lfo2', dest: 'out.pan', amount: 0.818 },
      { source: 'mod', dest: 'lfo1.level', amount: 1 },
      { source: 'lfo1', dest: 'osc3.timbre', amount: 0.202 }, { source: 'lfo1', dest: 'osc3.morph', amount: 0.311 },
      { source: 'lfo1', dest: 'mix.osc3', amount: 0.494 },
    ]),
  },
  {
    // Plaits' ADDITIVE on its ORGAN output: drawbars; no envelope to speak of, as an organ
    // played: the MOD wheel spins a speaker (LFO 1 on the pan and a hair on the pitch)
    name: 'Organ',
    category: 'keys',
    a: side({
      'osc3.mode': 1, 'osc3.model': 4, 'osc3.harm': 0.45, 'osc3.timbre': 0.55, 'osc3.morph': 0.5, 'osc3.aux': 1, 'mix.osc1': 0, 'mix.osc3': 1,
      drive: 0.15, 'lad.cutoff': 9000, 'lad.eg1': 0, 'eg2.a': 0.004, 'eg2.s': 1, 'eg2.r': 0.06, 'lfo1.rate': 6, 'lfo1.level': 0, 'lfo1.retrig': 2,
    }, [
      { source: 'mod', dest: 'lfo1.level', amount: 0.9 }, { source: 'lfo1', dest: 'out.pan', amount: 0.25 },
      { source: 'lfo1', dest: 'osc3.tune', amount: 0.0015 },
    ]),
  },
  {
    // Plaits' MODAL struck, short and bright (a toy piano's tine)
    // played: velocity strikes it brighter, the MOD wheel lets it ring longer
    name: 'Toy Piano',
    category: 'keys',
    a: side({
      'out.level': 1, drive: 0.6,
      'osc3.mode': 1, 'osc3.model': 12, 'osc3.harm': 0.6, 'osc3.timbre': 0.6, 'osc3.morph': 0.35, 'mix.osc1': 0, 'mix.osc3': 1,
      'lad.cutoff': 10000, 'lad.eg1': 0, 'eg2.a': 0.001, 'eg2.d': 1.2, 'eg2.s': 0, 'eg2.r': 0.5,
    }, [
      { source: 'vel', dest: 'osc3.timbre', amount: 0.2 }, { source: 'mod', dest: 'osc3.morph', amount: 0.4 },
      { source: 'mod', dest: 'eg2.d', amount: 0.2 },
    ]),
  },
  {
    // a narrow pulse through a band-pass snapping shut (a clavinet, funky)
    // played: velocity snaps it harder, the MOD wheel sweeps the band (as a wah would)
    name: 'Clav',
    category: 'keys',
    a: side({
      'out.level': 1, drive: 0.4,
      'osc1.blend': 1, 'osc1.width': 0.75, 'mix.osc1': 1, 'lad.cutoff': 6000, 'lad.eg1': 0, 'filter.route': 1, 'sem.bp': 1, 'sem.cutoff': 900,
      'sem.res': 0.3, 'sem.eg1': 0.3, 'eg1.d': 0.12, 'eg1.s': 0, 'eg2.a': 0.001, 'eg2.d': 0.5, 'eg2.s': 0.2, 'eg2.r': 0.08,
    }, [
      { source: 'vel', dest: 'eg1.level', amount: 0.5 }, { source: 'mod', dest: 'sem.cutoff', amount: 0.2 },
    ]),
  },
  {
    // (the user's version) Braids' SAW SUB an octave up over two detuned oscillators an octave down, a ladder and a
    // resonant SEM side by side, both opened by a fast EG 1 that settles part way (the strike, then the held tone)
    // played: velocity opens the ladder; the MOD wheel opens both filters. Two slow LFOs wobble the tuning and the
    // resonances and push each other's rates about (slower up the keyboard), so no two chords sound quite alike
    name: 'House Keys',
    category: 'keys',
    a: side({
      'out.level': 0.33, // three oscillators driven: down 8 dB to sit with the other keys
      'osc1.oct': 1, 'osc1.tune': 0.126, 'osc1.width': 1, 'mix.osc1': 0.453, 'osc2.tune': -0.112, 'mix.osc2': 0.494,
      'osc3.mode': 2, 'osc3.braids': 6, 'osc3.oct': 3, 'osc3.model': 2, 'osc3.harm': 0.55, 'osc3.timbre': 0.15, 'osc3.morph': 0.1, 'mix.osc3': 0.539,
      drive: 0.391, 'filter.route': 2, 'filter.key': 1, 'lad.cutoff': 20, 'lad.res': 0.061, 'lad.eg1': 1,
      'sem.cutoff': 50, 'sem.res': 0.562, 'sem.eg1': 0.862,
      'eg1.a': 0.001, 'eg1.d': 0.283, 'eg1.s': 0.412, 'eg2.a': 0.001, 'eg2.d': 1.435, 'eg2.s': 0.54, 'eg2.r': 0.033,
      'voice.unison': 1, 'voice.detune': 0.254, 'panner.width': 0.921, 'mod.time': 0.254,
      'lfo1.rate': 0.891, 'lfo1.level': 0.074, 'lfo1.retrig': 1, 'lfo2.rate': 1.097, 'lfo2.level': 0.065, 'lfo2.retrig': 1,
    }, [
      { source: 'vel', dest: 'lad.cutoff', amount: 0.243 },
      { source: 'mod', dest: 'lad.cutoff', amount: 0.413 }, { source: 'mod', dest: 'sem.cutoff', amount: 0.201 },
      { source: 'lfo1', dest: 'osc1.tune', amount: 0.031 }, { source: 'lfo2', dest: 'osc2.tune', amount: 0.019 },
      { source: 'lfo2', dest: 'osc3.tune', amount: 0.03 }, { source: 'lfo1', dest: 'osc3.tune', amount: -0.02 },
      { source: 'lfo1', dest: 'lfo2.rate', amount: 0.501 }, { source: 'lfo2', dest: 'lfo1.rate', amount: 0.49 },
      { source: 'kbd', dest: 'lfo1.rate', amount: -0.771 }, { source: 'kbd', dest: 'lfo2.rate', amount: -1 },
      { source: 'lfo2', dest: 'sem.mode', amount: 1 }, { source: 'lfo1', dest: 'sem.mode', amount: 1 },
      { source: 'lfo1', dest: 'sem.res', amount: 0.489 }, { source: 'lfo2', dest: 'lad.res', amount: 0.399 },
    ]),
  },
  {
    // Braids' PLUCKED over a narrow pulse, bright and quick (a harpsichord)
    // played: velocity brightens it, the MOD wheel detunes a second string against it
    name: 'Harpsi',
    category: 'keys',
    a: side({
      'out.level': 0.9, drive: 0.35,
      'osc3.mode': 2, 'osc3.braids': 28, 'osc3.timbre': 0.75, 'osc3.morph': 0.6, 'mix.osc3': 1, 'osc1.blend': 1, 'osc1.width': 0.8, 'mix.osc1': 0.25,
      'lad.cutoff': 8000, 'lad.eg1': 0, 'eg2.a': 0.001, 'eg2.d': 0.9, 'eg2.s': 0, 'eg2.r': 0.4,
    }, [
      { source: 'vel', dest: 'osc3.timbre', amount: 0.15 }, { source: 'mod', dest: 'osc1.tune', amount: 0.002 },
    ]),
  },
  {
    // Plaits' ADDITIVE as soft bell tones (an electric piano made of glass)
    // played: velocity brightens it, the MOD wheel brings in more harmonics
    name: 'Glass EP',
    category: 'keys',
    a: side({
      'out.level': 1, drive: 0.55,
      'osc3.mode': 1, 'osc3.model': 4, 'osc3.harm': 0.3, 'osc3.timbre': 0.35, 'osc3.morph': 0.3, 'mix.osc1': 0, 'mix.osc3': 1,
      'lad.cutoff': 8000, 'lad.eg1': 0, 'eg2.a': 0.002, 'eg2.d': 2, 'eg2.s': 0.2, 'eg2.r': 0.6, 'panner.mode': 1, 'panner.width': 0.4,
    }, [
      { source: 'vel', dest: 'osc3.timbre', amount: 0.2 }, { source: 'mod', dest: 'osc3.harm', amount: 0.3 },
    ]),
  },
  {
    // the PPG RESO table through a worn tape: wow on the pitch, a little hiss, the top rolled off
    // played: velocity brightens it, the MOD wheel wobbles the tape more
    name: 'Lofi Keys',
    category: 'keys',
    a: side({
      'out.level': 1, drive: 0.45,
      'mix.osc1': 0, 'mix.osc3': 1, 'osc3.table': 0, 'osc3.pos': 0.35, 'mix.noise': 0.03, 'noise.type': 1, 'lad.cutoff': 2200, 'lad.eg1': 0.15,
      'eg1.d': 0.4, 'eg1.s': 0.2, 'eg2.a': 0.003, 'eg2.d': 1.5, 'eg2.s': 0.3, 'eg2.r': 0.5, 'lfo1.rate': 0.8, 'lfo1.level': 0.6, 'lfo1.retrig': 2,
    }, [
      { source: 'lfo1', dest: 'osc3.tune', amount: 0.0015 }, { source: 'mod', dest: 'lfo1.level', amount: 0.4 },
      { source: 'mod', dest: 'lfo1.rate', amount: 0.3 }, { source: 'vel', dest: 'lad.cutoff', amount: 0.12 },
    ]),
  },
  // ---- PLUCK: short and struck; velocity is the pluck, the MOD wheel how it rings
  {
    // two saws apart, a sharp snap of the ladder, nothing held (the trance pluck)
    // played: velocity brightens it, the MOD wheel lengthens the pluck
    name: 'Saw Pluck',
    category: 'pluck',
    a: side({
      'out.level': 0.43,
      'mix.osc1': 0.8, 'mix.osc2': 0.8, 'osc2.tune': 0.12, 'lad.cutoff': 400, 'lad.res': 0.2, 'lad.eg1': 0.45, 'eg1.d': 0.18, 'eg1.s': 0,
      'eg2.a': 0.001, 'eg2.d': 0.35, 'eg2.s': 0, 'eg2.r': 0.2, 'voice.unison': 1, 'voice.detune': 0.2, 'panner.mode': 1,
    }, [
      { source: 'vel', dest: 'lad.cutoff', amount: 0.15 }, { source: 'mod', dest: 'eg1.d', amount: 0.25 }, { source: 'mod', dest: 'eg2.d', amount: 0.25 },
    ]),
  },
  {
    // a square, short and round
    // played: velocity brightens it, the MOD wheel adds resonance
    name: 'Square Pluck',
    category: 'pluck',
    a: side({
      'out.level': 0.5,
      'osc1.blend': 1, 'osc1.width': 0.5, 'mix.osc1': 1, 'lad.cutoff': 600, 'lad.res': 0.15, 'lad.eg1': 0.35, 'eg1.d': 0.15, 'eg1.s': 0,
      'eg2.a': 0.001, 'eg2.d': 0.3, 'eg2.s': 0, 'eg2.r': 0.15,
    }, [
      { source: 'vel', dest: 'lad.cutoff', amount: 0.15 }, { source: 'mod', dest: 'lad.res', amount: 0.4 },
    ]),
  },
  {
    // Plaits' STRING: a plucked string, modelled
    // played: velocity plucks it brighter, the MOD wheel changes its damping
    name: 'String Pluck',
    category: 'pluck',
    a: side({
      'out.level': 1, drive: 0.7,
      'osc3.mode': 1, 'osc3.model': 11, 'osc3.harm': 0.5, 'osc3.timbre': 0.55, 'osc3.morph': 0.45, 'mix.osc1': 0, 'mix.osc3': 1,
      'lad.cutoff': 9000, 'lad.eg1': 0, 'eg2.a': 0.001, 'eg2.d': 1, 'eg2.s': 0, 'eg2.r': 0.5,
    }, [
      { source: 'vel', dest: 'osc3.timbre', amount: 0.2 }, { source: 'mod', dest: 'osc3.morph', amount: 0.35 },
    ]),
  },
  {
    // Braids' PLUCKED, dark and short (strings plucked, not bowed)
    // played: velocity plucks harder, the MOD wheel opens the body
    name: 'Pizzicato',
    category: 'pluck',
    a: side({
      'out.level': 1, drive: 0.85,
      'osc3.mode': 2, 'osc3.braids': 28, 'osc3.timbre': 0.6, 'osc3.morph': 0.3, 'mix.osc1': 0, 'mix.osc3': 1, 'lad.cutoff': 6000, 'lad.eg1': 0,
      'eg2.a': 0.001, 'eg2.d': 0.5, 'eg2.s': 0, 'eg2.r': 0.2,
    }, [
      { source: 'vel', dest: 'osc3.timbre', amount: 0.25 }, { source: 'mod', dest: 'lad.cutoff', amount: 0.25 },
    ]),
  },
  {
    // Braids' PLUCKED ringing long, two voices a note spread (a harp)
    // played: velocity brightens it, the MOD wheel lets it ring longer
    name: 'Harp',
    category: 'pluck',
    a: side({
      'out.level': 1, drive: 0.5,
      'osc3.mode': 2, 'osc3.braids': 28, 'osc3.timbre': 0.55, 'osc3.morph': 0.7, 'mix.osc1': 0, 'mix.osc3': 1, 'lad.cutoff': 7000, 'lad.eg1': 0,
      'eg2.a': 0.001, 'eg2.d': 1.6, 'eg2.s': 0, 'eg2.r': 1, 'voice.unison': 1, 'voice.detune': 0.1, 'panner.mode': 1,
    }, [
      { source: 'vel', dest: 'osc3.timbre', amount: 0.2 }, { source: 'mod', dest: 'eg2.d', amount: 0.3 },
    ]),
  },
  {
    // a saw stack plucked by the ladder, two voices a note (house chords, plucked)
    // played: velocity brightens it, the MOD wheel lengthens it
    name: 'Chord Pluck',
    category: 'pluck',
    a: side({
      'out.level': 0.42,
      'mix.osc1': 0.8, 'mix.osc2': 0.6, 'osc2.tune': 0.08, 'lad.cutoff': 700, 'lad.res': 0.15, 'lad.eg1': 0.35, 'eg1.d': 0.22, 'eg1.s': 0,
      'eg2.a': 0.001, 'eg2.d': 0.45, 'eg2.s': 0, 'eg2.r': 0.25, 'voice.unison': 1, 'voice.detune': 0.15, 'panner.mode': 1,
    }, [
      { source: 'vel', dest: 'lad.cutoff', amount: 0.15 }, { source: 'mod', dest: 'eg1.d', amount: 0.3 }, { source: 'mod', dest: 'eg2.d', amount: 0.3 },
    ]),
  },
  {
    // a resonant ladder snapping shut on a saw (a rubbery bloop)
    // played: velocity snaps it harder, the MOD wheel adds resonance
    name: 'Rubber Pluck',
    category: 'pluck',
    a: side({
      'mix.osc1': 1, 'lad.cutoff': 250, 'lad.res': 0.6, 'lad.eg1': 0.5, 'filter.key': 0.6, 'eg1.d': 0.12, 'eg1.s': 0, 'eg1.reset': 1,
      'eg2.a': 0.001, 'eg2.d': 0.3, 'eg2.s': 0, 'eg2.r': 0.12,
    }, [
      { source: 'vel', dest: 'eg1.level', amount: 0.5 }, { source: 'mod', dest: 'lad.res', amount: 0.3 },
    ]),
  },
  {
    // Plaits' FM, very short, bright
    // played: velocity brightens it, the MOD wheel adds feedback
    name: 'Glass Pluck',
    category: 'pluck',
    a: side({
      'osc3.mode': 1, 'osc3.model': 2, 'osc3.harm': 0.68, 'osc3.timbre': 0.2, 'osc3.morph': 0, 'mix.osc1': 0, 'mix.osc3': 1,
      'lad.cutoff': 10000, 'lad.eg1': 0, 'eg1.d': 0.1, 'eg1.s': 0, 'eg2.a': 0.001, 'eg2.d': 0.4, 'eg2.s': 0, 'eg2.r': 0.2,
    }, [
      { source: 'eg1', dest: 'osc3.timbre', amount: 0.35 }, { source: 'vel', dest: 'osc3.timbre', amount: 0.15 },
      { source: 'mod', dest: 'osc3.morph', amount: 0.35 },
    ]),
  },
  {
    // Braids' TOY: lo-fi, aliased, short
    // played: velocity adds grit, the MOD wheel changes its colour
    name: 'Bit Pluck',
    category: 'pluck',
    a: side({
      'osc3.mode': 2, 'osc3.braids': 16, 'osc3.timbre': 0.5, 'osc3.morph': 0.4, 'mix.osc1': 0, 'mix.osc3': 1, 'lad.cutoff': 9000, 'lad.eg1': 0,
      'eg2.a': 0.001, 'eg2.d': 0.3, 'eg2.s': 0, 'eg2.r': 0.12,
    }, [
      { source: 'vel', dest: 'osc3.timbre', amount: 0.25 }, { source: 'mod', dest: 'osc3.morph', amount: 0.4 },
    ]),
  },
  {
    // Plaits' MODAL struck softly (a thumb on a metal tine)
    // played: velocity brightens it, the MOD wheel lets it ring longer
    name: 'Kalimba',
    category: 'pluck',
    a: side({
      'out.level': 1, drive: 0.4,
      'osc3.mode': 1, 'osc3.model': 12, 'osc3.harm': 0.35, 'osc3.timbre': 0.35, 'osc3.morph': 0.5, 'mix.osc1': 0, 'mix.osc3': 1,
      'lad.cutoff': 6000, 'lad.eg1': 0, 'eg2.a': 0.001, 'eg2.d': 0.9, 'eg2.s': 0, 'eg2.r': 0.4,
    }, [
      { source: 'vel', dest: 'osc3.timbre', amount: 0.2 }, { source: 'mod', dest: 'osc3.morph', amount: 0.3 },
    ]),
  },
];

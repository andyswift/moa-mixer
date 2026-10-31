import type { RigSide } from './rigParams';

/** A part's sound: side A, and side B for the morph (a copy of A when absent). */
export interface RigPreset {
  name: string;
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
    a: side({
      'voice.mode': 2, 'voice.glide': 0.06, 'lad.cutoff': 300, 'lad.res': 0.75, 'lad.eg1': 0.45, drive: 0.35,
      'eg1.d': 0.25, 'eg1.s': 0, 'eg2.a': 0.002, 'eg2.d': 0.3, 'eg2.s': 0.8, 'eg2.r': 0.08, 'filter.key': 0.3,
    }, [{ source: 'vel', dest: 'lad.cutoff', amount: 0.15 }]),
  },
  {
    name: 'Sub Bass',
    a: side({
      'voice.mode': 1, 'osc1.blend': 1, 'osc1.sub': 1, 'mix.osc1': 0.8, 'osc2.oct': 1, 'mix.osc2': 0.3,
      'lad.cutoff': 400, 'lad.res': 0.2, 'lad.eg1': 0.2, 'eg1.d': 0.2, 'eg2.r': 0.1,
    }),
  },
  {
    name: 'Glass Pad',
    a: side({
      'mix.osc1': 0.3, 'osc1.width': 1, 'mix.osc3': 0.7, 'osc3.table': 0, 'osc3.pos': 0.2,
      'lad.cutoff': 3500, 'lad.res': 0.2, 'lad.eg1': 0.1, 'filter.route': 2, 'sem.cutoff': 1200, 'sem.res': 0.5, 'sem.bp': 1,
      'eg1.a': 1.5, 'eg1.d': 3, 'eg1.s': 0.5, 'eg1.r': 2, 'eg2.a': 1.2, 'eg2.d': 2, 'eg2.s': 0.8, 'eg2.r': 2.5,
      'lfo1.rate': 0.15, 'voice.unison': 1, 'voice.detune': 0.25, 'panner.mode': 1,
    }, [{ source: 'lfo1', dest: 'osc3.pos', amount: 0.3 }]),
  },
  {
    name: 'Vox Table',
    a: side({
      'mix.osc1': 0, 'mix.osc3': 1, 'osc3.table': 4, 'osc3.pos': 0.5, 'lad.cutoff': 6000, 'lad.eg1': 0,
      'eg2.a': 0.15, 'eg2.s': 1, 'eg2.r': 0.6, 'lfo1.rate': 0.3, 'lfo2.rate': 5, 'lfo2.shape': 0, 'lfo2.level': 0, 'mod.time': 1.5,
    }, [
      { source: 'lfo1', dest: 'osc3.pos', amount: 0.5 },
      { source: 'lfo2', dest: 'osc3.tune', amount: 0.003 },
      { source: 'time', dest: 'lfo2.level', amount: 1 },
    ]),
  },
  {
    name: 'Choir',
    a: side({
      'mix.osc1': 0, 'mix.osc3': 1, 'osc3.table': 5, 'osc3.pos': 0.3, 'lad.cutoff': 5000, 'lad.eg1': 0,
      'eg2.a': 0.8, 'eg2.s': 1, 'eg2.r': 1.5, 'lfo1.rate': 0.07, 'voice.unison': 2, 'voice.detune': 0.5, 'panner.mode': 1,
    }, [{ source: 'lfo1', dest: 'osc3.pos', amount: 0.4 }]),
  },
  {
    name: 'Sync Lead',
    a: side({
      'voice.mode': 2, 'voice.glide': 0.03, 'mix.osc1': 0.3, 'mix.osc2': 1, 'osc2.sync': 1, 'lad.cutoff': 5000, 'lad.res': 0.3,
      'lad.eg1': 0.1, 'eg1.d': 0.4, 'eg1.s': 0.2, 'eg2.r': 0.2, 'lfo2.rate': 5.5, 'lfo2.shape': 0, 'lfo2.level': 0,
    }, [
      { source: 'eg1', dest: 'osc2.tune', amount: 0.25 },
      { source: 'mod', dest: 'lfo2.level', amount: 1 },
      { source: 'lfo2', dest: 'osc1.tune', amount: 0.004 },
      { source: 'lfo2', dest: 'osc2.tune', amount: 0.004 },
    ]),
  },
  {
    name: 'Dub Chord',
    a: side({
      'mix.osc1': 0.7, 'mix.osc2': 0.7, 'osc2.tune': 0.08, 'lad.cutoff': 4000, 'lad.eg1': 0, 'filter.route': 1,
      'sem.cutoff': 900, 'sem.res': 0.6, 'sem.bp': 1, 'sem.eg1': 0.15, 'eg1.d': 0.2,
      'eg2.a': 0.002, 'eg2.d': 0.25, 'eg2.s': 0, 'eg2.r': 0.2,
    }),
  },
  {
    name: 'Digi Keys',
    a: side({
      'mix.osc1': 0, 'mix.osc3': 1, 'osc3.table': 2, 'osc3.pos': 0.6, 'osc3.interp': 0, 'lad.cutoff': 8000, 'lad.eg1': 0,
      'eg1.d': 0.6, 'eg2.d': 1.2, 'eg2.s': 0.3, 'eg2.r': 0.5,
    }, [{ source: 'eg1', dest: 'osc3.pos', amount: -0.5 }]),
  },
  {
    name: 'Morph Pad',
    a: side({ 'mix.osc1': 0.8, 'lad.cutoff': 800, 'lad.eg1': 0.1, 'eg2.a': 0.6, 'eg2.r': 1.5, 'voice.unison': 1, 'voice.detune': 0.3 },
      [{ source: 'mod', dest: 'out.morph', amount: 1 }]),
    b: side({
      'mix.osc1': 0.2, 'mix.osc3': 0.8, 'osc3.table': 1, 'osc3.pos': 0.7, 'lad.cutoff': 6000, 'lad.res': 0.3, 'lad.eg1': 0.1,
      'eg2.a': 0.6, 'eg2.r': 1.5, 'voice.unison': 1, 'voice.detune': 0.3,
    }, [{ source: 'mod', dest: 'out.morph', amount: 1 }]),
  },
  {
    name: 'XOR Bell',
    a: side({
      'mix.osc1': 0.2, 'mix.noise': 0.6, 'noise.type': 2, 'osc2.tune': 7, 'lad.cutoff': 6000, 'lad.eg1': 0,
      'eg2.d': 1.5, 'eg2.s': 0, 'eg2.r': 1,
    }),
  },
  {
    name: 'Wave FM',
    a: side({
      'osc1.width': 1, 'osc3.oct': 3, 'osc3.table': 0, 'mix.osc3': 0, 'lad.cutoff': 9000, 'lad.eg1': 0,
      'eg2.d': 2, 'eg2.s': 0, 'eg2.r': 1.5,
    }, [{ source: 'wave', dest: 'osc1.tune', amount: 0.08 }]),
  },
  {
    name: 'Drone',
    a: side({
      'voice.mode': 1, 'eg2.drone': 1, 'mix.osc1': 0.6, 'mix.osc2': 0.6, 'osc2.tune': -0.1, 'osc2.oct': 1,
      'lad.cutoff': 600, 'lad.res': 0.6, 'lad.eg1': 0, 'lfo1.rate': 0.05, 'lfo1.shape': 0,
    }, [{ source: 'lfo1', dest: 'lad.cutoff', amount: 0.3 }]),
  },
  // ---- techno: short, dry and driven, to sit in a loop with a kick (SCALPEL is built on them)
  {
    // a saw and the sub an octave down, the ladder snapping shut in 90 ms, overdriven: a thud with a bark on top
    name: 'Techno Bass',
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
    a: side({
      'mix.osc1': 0, 'mix.noise': 1, 'noise.type': 2, 'osc1.width': 0.3, 'osc2.oct': 3, 'osc2.tune': 5.6, 'osc2.width': 0.55,
      drive: 0.4, 'lad.cutoff': 14000, 'lad.eg1': 0, 'filter.route': 1, 'sem.bp': 1, 'sem.cutoff': 3200, 'sem.res': 0.55, 'sem.eg1': 0.1,
      'eg1.d': 0.05, 'eg2.a': 0.001, 'eg2.d': 0.11, 'eg2.s': 0, 'eg2.r': 0.08,
    }, [{ source: 'rand', dest: 'sem.cutoff', amount: 0.08 }]),
  },
  {
    // Plaits' CHORDS (a minor seventh), the low end high-passed away, the ladder closing fast, driven: for the delay
    name: 'Techno Stab',
    a: side({
      'osc3.mode': 1, 'osc3.model': 6, 'osc3.harm': 0.41, 'osc3.timbre': 0.55, 'osc3.morph': 0.1, 'mix.osc1': 0, 'mix.osc3': 1,
      drive: 0.7, overdrive: 1, 'lad.cutoff': 900, 'lad.res': 0.2, 'lad.eg1': 0.3, 'filter.route': 1, 'sem.mode': 1, 'sem.cutoff': 250, 'sem.res': 0.2,
      'eg1.d': 0.12, 'eg2.a': 0.001, 'eg2.d': 0.14, 'eg2.s': 0, 'eg2.r': 0.12,
    }),
  },
  {
    // white noise into a resonant ladder held shut; the SEQ mod lane (or MOD) opens it
    name: 'Noise Sweep',
    a: side({
      'mix.osc1': 0, 'mix.noise': 1, drive: 0.3, 'lad.cutoff': 200, 'lad.res': 0.55, 'lad.eg1': 0, 'filter.key': 0,
      'eg2.a': 0.5, 'eg2.s': 1, 'eg2.r': 0.8,
    }, [{ source: 'seq', dest: 'lad.cutoff', amount: 0.85 }, { source: 'mod', dest: 'lad.cutoff', amount: 0.85 }]),
  },
  {
    // a rolling sixteenth bass that bubbles: a resonant ladder snapping on each note, velocity opening it (the accents
    // pop), a little glide between notes
    name: 'Bubbly Bass',
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
    a: side({
      // (the oscillators, drive and ladder as the user set them by ear)
      'mix.osc1': 0.84, 'osc1.width': 0.22, 'osc1.blend': 0.06, 'mix.osc2': 0.37, 'osc2.oct': 1, 'osc2.blend': 0.55, 'osc2.width': 0.66,
      'mix.osc3': 0.8, 'osc3.table': 0, 'osc3.pos': 0.25, 'mix.noise': 0.18, 'noise.type': 1, drive: 0.74, overdrive: 1,
      'lad.cutoff': 140, 'lad.res': 0.33, 'lad.eg1': 0.59, 'filter.key': 0.4,
      'eg1.a': 0.002, 'eg1.d': 0.06, 'eg1.s': 0, 'eg1.r': 0.15, 'eg2.a': 0.002, 'eg2.d': 0.15, 'eg2.s': 0, 'eg2.r': 0.1,
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
    a: side({
      'osc3.mode': 2, 'osc3.braids': 28, 'osc3.timbre': 0.178, 'osc3.morph': 0.787, 'mix.osc1': 0, 'mix.osc3': 1,
      'lad.cutoff': 3010, 'lad.res': 0.15, 'lad.eg1': 0.15, 'eg1.d': 0.2,
      'eg2.a': 0.001, 'eg2.d': 0.4, 'eg2.s': 0, 'eg2.r': 0.3, 'panner.mode': 2, 'panner.width': 0.915, 'voice.unison': 1,
    }, [{ source: 'vel', dest: 'lad.cutoff', amount: 0.1 }]),
  },
  {
    // a minor seventh from one key (Plaits' CHORDS), dark and short, the lows taken off: thrown into the dub delay
    name: 'Minor Stab',
    a: side({
      'osc3.mode': 1, 'osc3.model': 6, 'osc3.harm': 0.41, 'osc3.timbre': 0.4, 'osc3.morph': 0.15, 'mix.osc1': 0, 'mix.osc3': 1,
      drive: 0.25, 'lad.cutoff': 1100, 'lad.res': 0.25, 'lad.eg1': 0.25, 'filter.route': 1, 'sem.mode': 1, 'sem.cutoff': 180,
      'eg1.d': 0.15, 'eg2.a': 0.001, 'eg2.d': 0.2, 'eg2.s': 0, 'eg2.r': 0.15,
    }),
  },
  {
    // a voice from Plaits' SPEECH word banks (MORPH picks the word, TIMBRE the throat: lock them per step), three
    // voices in unison, fading in and letting go slowly, narrowed to a band (as the user set it by ear)
    name: 'Dub Words',
    a: side({
      'osc3.mode': 1, 'osc3.model': 7, 'osc3.harm': 0.762, 'osc3.timbre': 0.528, 'osc3.morph': 0.17, 'mix.osc1': 0, 'mix.osc3': 1,
      'lad.cutoff': 5730, 'lad.eg1': 0, 'filter.route': 1, 'sem.mode': 1, 'sem.cutoff': 778,
      'eg2.a': 0.08, 'eg2.d': 1, 'eg2.s': 0.8, 'eg2.r': 0.6, 'voice.unison': 2,
    }),
  },
  {
    // a hand drum: a triangle that drops in pitch as it is struck, a slap of noise, a quick fall; tuned by the key
    name: 'Hand Conga',
    a: side({
      'osc1.width': 1, 'mix.osc1': 1, 'mix.noise': 0.08, 'lad.cutoff': 1500, 'lad.eg1': 0.3, 'filter.key': 1,
      'eg1.a': 0.001, 'eg1.d': 0.04, 'eg1.s': 0, 'eg1.reset': 1, 'eg2.a': 0.001, 'eg2.d': 0.2, 'eg2.s': 0, 'eg2.r': 0.12, 'eg2.reset': 1,
    }, [{ source: 'eg1', dest: 'osc1.tune', amount: 0.04 }, { source: 'vel', dest: 'eg2.level', amount: 0.6 }]),
  },
];

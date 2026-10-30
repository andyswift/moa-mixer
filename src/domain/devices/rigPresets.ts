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
];

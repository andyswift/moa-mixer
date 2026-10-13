import type { PresetValues, SynthPreset } from './synthPresets';

/**
 * The full default state of MOA-PIPE: every control id, so loading a patch always resets everything.
 * Init is a plain plucked string: a short noise burst into a ringing pipe.
 */
export const PIPE_INIT: PresetValues = {
  'env.attack': 1, 'env.decay': 30, 'env.sustain': 0, 'env.release': 200, 'env.keytrack': 0, 'env.velocity': 0.5, 'env.legato': 0,
  'gen.noise': 1, 'gen.cutoff': 100, 'gen.reso': 0.2, 'gen.keytrack': 0.5, 'gen.envAmt': 0, 'gen.onePole': 0, 'gen.gain': 1.5,
  'fb.push': 0, 'fb.decay': 2, 'fb.release': 0.4,
  'sat.hardness': 0.3, 'sat.symmetry': 0,
  'patch.volume': 0.8,
  'delay.tune': 0, 'delay.fine': 0, 'delay.harmonics': 0, 'delay.split': 0, 'delay.splitPoint': 0.5, 'delay.polarity': 0,
  'filter.highpass': -36, 'filter.lowpass': 36, 'filter.hpComp': 1, 'filter.lpComp': 1,
  'voice.mode': 'poly', 'voice.detune': 12, 'voice.glide': 100, 'voice.glideOn': 0,
  'lfo.wave': 'sine', 'lfo.rate': 5, 'lfo.sync': 0, 'lfo.division': '1/8', 'lfo.delay': 0, 'lfo.amount': 0, 'lfo.dest': 'pitch',
  'rev.mix': 0.25, 'rev.bass': 120, 'rev.treble': 8000, 'rev.size': 'medium', 'rev.spread': 0.5,
};

const p = (name: string, values: PresetValues): SynthPreset => ({ name, values });

/** A blown pipe: mostly DC pressure with a hint of noise, pushed so the loop sings on its own. */
const BLOWN: PresetValues = {
  'env.attack': 60, 'env.decay': 200, 'env.sustain': 1, 'env.release': 250, 'gen.noise': 0.06, 'gen.gain': 0.3,
  'fb.push': 1.2, 'fb.decay': 4, 'fb.release': 0.3, 'sat.hardness': 0.1, 'filter.highpass': -36, 'filter.lowpass': 30,
};

/** A struck or plucked string: a hot, short burst, because a short burst carries little energy. */
const STRUCK: PresetValues = { 'gen.gain': 1.9 };

/** Two banks of eight, as on the panel's patch strip: struck and plucked sounds first, blown and bowed second. */
export const PIPE_BANKS: readonly (readonly SynthPreset[])[] = [
  [
    p('Nylon Pluck', {
      ...STRUCK,
      'gen.cutoff': 90, 'gen.keytrack': 0.7, 'fb.decay': 1.8, 'fb.release': 0.25, 'filter.lowpass': 30, 'sat.hardness': 0.2,
      'rev.mix': 0.2,
    }),
    p('Steel String', {
      ...STRUCK,
      'gen.cutoff': 120, 'delay.harmonics': 0.12, 'fb.decay': 3.5, 'fb.release': 0.35, 'filter.lowpass': 48, 'sat.hardness': 0.4,
      'env.velocity': 0.7,
    }),
    p('Muted Bass', {
      ...STRUCK,
      'delay.tune': -12, 'gen.cutoff': 70, 'gen.keytrack': 0.2, 'fb.decay': 0.9, 'fb.release': 0.15, 'filter.lowpass': 18,
      'filter.highpass': -48, 'voice.mode': 'mono', 'rev.mix': 0.08, 'patch.volume': 1,
    }),
    p('Harp', {
      ...STRUCK,
      'gen.cutoff': 100, 'gen.keytrack': 0.6, 'delay.harmonics': 0.05, 'fb.decay': 5, 'fb.release': 0.6, 'filter.lowpass': 36,
      'rev.size': 'large', 'rev.mix': 0.35,
    }),
    p('Marimba', {
      ...STRUCK,
      'env.attack': 1, 'env.decay': 20, 'gen.cutoff': 80, 'delay.split': 1, 'delay.splitPoint': 0.4, 'delay.harmonics': 0.4,
      'fb.decay': 0.7, 'fb.release': 0.2, 'filter.lowpass': 24, 'filter.highpass': -48, 'rev.mix': 0.15,
    }),
    p('Glass Bell', {
      ...STRUCK,
      'delay.tune': 12, 'delay.split': 1, 'delay.splitPoint': 0.3, 'delay.harmonics': 0.6, 'fb.decay': 6, 'fb.release': 2,
      'sat.hardness': 0.1, 'filter.lowpass': 60, 'filter.highpass': -48, 'rev.size': 'large', 'rev.mix': 0.4,
    }),
    p('Wood Block', {
      ...STRUCK,
      'env.decay': 15, 'gen.gain': 2, 'delay.split': 1, 'delay.splitPoint': 0.5, 'delay.harmonics': 0.2, 'fb.decay': 0.25, 'fb.release': 0.1,
      'filter.lowpass': 40, 'filter.highpass': -24, 'rev.mix': 0.1,
    }),
    p('Kalimba', {
      ...STRUCK,
      'delay.tune': 12, 'gen.noise': 0.8, 'delay.split': 1, 'delay.splitPoint': 0.6, 'delay.harmonics': 0.3, 'fb.decay': 1.2,
      'fb.release': 0.3, 'filter.lowpass': 42, 'filter.highpass': -48, 'rev.mix': 0.3,
    }),
  ],
  [
    p('Pan Flute', {
      ...BLOWN, 'delay.polarity': 1, 'voice.mode': 'mono', 'env.legato': 1, 'voice.glideOn': 1, 'voice.glide': 60,
      'lfo.amount': 0.12, 'lfo.rate': 5, 'lfo.delay': 0.6, 'lfo.dest': 'pitch', 'rev.mix': 0.3,
    }),
    p('Clarinet', {
      ...BLOWN, 'delay.polarity': 1, 'gen.noise': 0.1, 'gen.gain': 0.35, 'env.attack': 30, 'sat.hardness': 0.5, 'filter.lowpass': 36,
      'voice.mode': 'mono', 'env.legato': 1, 'rev.mix': 0.2,
    }),
    p('Reed Organ', {
      ...BLOWN, 'gen.noise': 0.08, 'env.attack': 40, 'env.release': 200, 'sat.hardness': 0.6, 'sat.symmetry': 0.2, 'filter.lowpass': 40,
      'rev.mix': 0.25,
    }),
    p('Pipe Organ', {
      ...BLOWN, 'gen.noise': 0.05, 'env.attack': 80, 'env.release': 500, 'filter.lowpass': 24, 'rev.size': 'large', 'rev.mix': 0.45,
    }),
    p('Brass', {
      ...BLOWN, 'gen.noise': 0.1, 'gen.gain': 0.5, 'env.attack': 80, 'env.decay': 200, 'env.sustain': 0.7, 'sat.hardness': 0.7,
      'sat.symmetry': 0.6, 'filter.lowpass': 42, 'lfo.dest': 'filter', 'lfo.amount': 0.1, 'lfo.rate': 6, 'rev.mix': 0.2,
    }),
    p('Overblown', {
      ...BLOWN, 'delay.polarity': 1, 'lfo.dest': 'filter', 'lfo.amount': 0.6, 'lfo.rate': 0.3, 'lfo.wave': 'sine', 'rev.mix': 0.3,
    }),
    p('Steam Drone', {
      ...BLOWN, 'env.attack': 1500, 'env.release': 3000, 'gen.noise': 0.2, 'fb.decay': 20, 'fb.release': 3, 'voice.mode': 'unison',
      'voice.detune': 25, 'rev.size': 'large', 'rev.mix': 0.5, 'rev.spread': 1,
    }),
    p('Wind Chimes', {
      'delay.tune': 12, 'delay.split': 1, 'delay.splitPoint': 0.2, 'delay.harmonics': 0.5, 'fb.decay': 8, 'fb.release': 4,
      'filter.lowpass': 54, 'filter.highpass': -48, 'sat.hardness': 0.05, 'rev.size': 'large', 'rev.mix': 0.5, 'rev.spread': 1,
    }),
  ],
];

/** The sixteen patch slots: bank A then bank B. */
export const PIPE_PRESETS: readonly SynthPreset[] = PIPE_BANKS.flat();

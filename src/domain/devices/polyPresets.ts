import type { PresetValues, SynthPreset } from './synthPresets';

/** The full default state of the poly synth: every control id, so loading a patch always resets everything. */
export const POLY_INIT: PresetValues = {
  'osc.wave': 'saw',
  'osc.width': 50,
  'osc.pwm': 0,
  'osc.vibrato': 0,
  'osc.sub': 0.3,
  'filter.cutoff': 2400,
  'filter.resonance': 1,
  'filter.env': 2,
  'filter.lfo': 0,
  'filter.key': 50,
  'amp.lfo': 0,
  'amp.key': 0,
  level: 0.7,
  'lfo.wave': 'tri',
  'lfo.rate': 5,
  'lfo.sync': 0,
  'lfo.division': '1/8',
  'env1.attack': 0.005,
  'env1.decay': 0.4,
  'env1.sustain': 0.4,
  'env1.release': 0.4,
  'env2.attack': 0.005,
  'env2.decay': 0.3,
  'env2.sustain': 0.7,
  'env2.release': 0.35,
  'voices.mode': 'poly',
  'voices.portamento': 0,
  'voices.detune': 12,
  'fx.chorus': 0,
  'fx.delayTime': 0.35,
  'fx.feedback': 0.3,
  'fx.mix': 0,
};

const p = (name: string, values: PresetValues): SynthPreset => ({ name, values });

/** Two banks of eight, as on the panel's patch strip. Recipes for familiar poly-synth sounds. */
export const POLY_BANKS: readonly (readonly SynthPreset[])[] = [
  [
    p('Soft Pad', {
      'osc.sub': 0.2, 'filter.cutoff': 900, 'filter.resonance': 1.2, 'filter.env': 1.5, 'filter.lfo': 0.3,
      'env1.attack': 0.6, 'env1.decay': 1.2, 'env1.sustain': 0.5, 'env1.release': 1.5,
      'env2.attack': 0.5, 'env2.decay': 0.8, 'env2.sustain': 0.8, 'env2.release': 1.6,
      'lfo.rate': 0.4, 'fx.chorus': 0.7, 'fx.mix': 0.15, 'fx.delayTime': 0.45, 'fx.feedback': 0.35, level: 0.6,
    }),
    p('Warm Brass', {
      'osc.sub': 0.3, 'filter.cutoff': 700, 'filter.env': 3.2, 'osc.vibrato': 8,
      'env1.attack': 0.12, 'env1.decay': 0.5, 'env1.sustain': 0.55, 'env1.release': 0.25,
      'env2.attack': 0.06, 'env2.decay': 0.3, 'env2.sustain': 0.85, 'env2.release': 0.2, 'fx.chorus': 0.3,
    }),
    p('Pluck Bass', {
      'voices.mode': 'mono', 'osc.sub': 0.6, 'filter.cutoff': 350, 'filter.resonance': 4, 'filter.env': 3.5,
      'env1.attack': 0.001, 'env1.decay': 0.22, 'env1.sustain': 0, 'env1.release': 0.15,
      'env2.attack': 0.001, 'env2.decay': 0.35, 'env2.sustain': 0.5, 'env2.release': 0.1, 'voices.portamento': 0.05,
    }),
    p('Glass Keys', {
      'osc.wave': 'tri', 'osc.sub': 0, 'filter.cutoff': 5200, 'filter.resonance': 0.5, 'filter.env': 0.5,
      'env1.attack': 0.001, 'env1.decay': 0.8, 'env1.sustain': 0.2, 'env1.release': 0.6,
      'env2.attack': 0.002, 'env2.decay': 1.2, 'env2.sustain': 0.1, 'env2.release': 0.8,
      'fx.chorus': 0.45, 'fx.mix': 0.2, 'fx.delayTime': 0.3, 'fx.feedback': 0.4,
    }),
    p('Slow Strings', {
      'filter.cutoff': 3000, 'filter.env': 0.6, 'filter.key': 70, 'osc.vibrato': 12, 'lfo.rate': 5.5,
      'env1.attack': 0.8, 'env1.decay': 1, 'env1.sustain': 0.7, 'env1.release': 1.2,
      'env2.attack': 0.9, 'env2.decay': 1, 'env2.sustain': 0.9, 'env2.release': 1.4, 'fx.chorus': 0.8,
    }),
    p('Sweep Lead', {
      'voices.mode': 'mono', 'osc.wave': 'pulse', 'osc.width': 30, 'osc.pwm': 0.4, 'osc.sub': 0.2, 'lfo.rate': 0.7,
      'filter.cutoff': 1500, 'filter.resonance': 5, 'filter.env': 2.5,
      'env1.attack': 0.001, 'env1.decay': 0.8, 'env1.sustain': 0.35, 'env1.release': 0.3, 'env2.sustain': 0.9,
      'voices.portamento': 0.12, 'fx.mix': 0.3, 'fx.delayTime': 0.4, 'fx.feedback': 0.45,
    }),
    p('Wobble Sub', {
      'voices.mode': 'mono', 'osc.sub': 0.8, 'filter.cutoff': 260, 'filter.resonance': 6, 'filter.lfo': 2.2,
      'filter.env': 0.5, 'lfo.sync': 1, 'lfo.division': '1/8', 'env2.sustain': 0.95, level: 0.55,
    }),
    p('Bell Pluck', {
      'osc.wave': 'tri', 'osc.sub': 0, 'filter.cutoff': 8000, 'filter.resonance': 0.3, 'filter.env': 0.2, 'osc.vibrato': 4,
      'env1.attack': 0.001, 'env1.decay': 0.5, 'env1.sustain': 0, 'env1.release': 0.4,
      'env2.attack': 0.001, 'env2.decay': 1.6, 'env2.sustain': 0, 'env2.release': 1.4,
      'fx.chorus': 0.3, 'fx.mix': 0.3, 'fx.delayTime': 0.5, 'fx.feedback': 0.5,
    }),
  ],
  [
    p('Init', {}),
    p('Analog Poly', {
      'filter.cutoff': 1800, 'filter.resonance': 1.5, 'filter.env': 2,
      'env1.attack': 0.01, 'env1.decay': 0.5, 'env1.sustain': 0.35, 'env1.release': 0.4,
      'env2.attack': 0.01, 'env2.decay': 0.4, 'env2.sustain': 0.75, 'env2.release': 0.4, 'fx.chorus': 0.35,
    }),
    p('Choir Air', {
      'osc.wave': 'pulse', 'osc.width': 40, 'osc.pwm': 0.2, 'filter.cutoff': 1600, 'filter.resonance': 2.5, 'filter.env': 1,
      'env2.attack': 0.35, 'env2.decay': 0.6, 'env2.sustain': 0.85, 'env2.release': 1.1, 'fx.chorus': 0.6,
      'fx.mix': 0.2,
    }),
    p('Retro Stab', {
      'filter.cutoff': 600, 'filter.resonance': 2, 'filter.env': 4,
      'env1.attack': 0.001, 'env1.decay': 0.22, 'env1.sustain': 0, 'env1.release': 0.2,
      'env2.attack': 0.001, 'env2.decay': 0.25, 'env2.sustain': 0, 'env2.release': 0.2, 'fx.chorus': 0.5,
    }),
    p('Fifth Lead', {
      'voices.mode': 'unison', 'voices.detune': 18, 'filter.cutoff': 2600, 'filter.resonance': 2, 'filter.env': 1.5,
      'env2.sustain': 0.8, 'voices.portamento': 0.08, 'fx.mix': 0.25,
    }),
    p('Dream Wash', {
      'osc.sub': 0.4, 'filter.cutoff': 1100, 'lfo.rate': 0.3, 'filter.lfo': 0.4,
      'env1.attack': 1.8, 'env1.decay': 1, 'env1.sustain': 0.6, 'env1.release': 2.5,
      'env2.attack': 1.5, 'env2.decay': 1, 'env2.sustain': 0.85, 'env2.release': 3,
      'fx.chorus': 0.9, 'fx.mix': 0.4, 'fx.delayTime': 0.6, 'fx.feedback': 0.6, level: 0.55,
    }),
    p('Pulse Organ', {
      'osc.wave': 'pulse', 'osc.width': 50, 'osc.sub': 0.5, 'filter.cutoff': 3200, 'filter.resonance': 0.5,
      'filter.env': 0.3, 'osc.vibrato': 6, 'lfo.rate': 6.5, 'env2.attack': 0.005, 'env2.decay': 0.1, 'env2.sustain': 1,
      'env2.release': 0.08, 'fx.chorus': 0.3,
    }),
    p('Space Arp', {
      'osc.wave': 'pulse', 'osc.width': 25, 'osc.pwm': 0.6, 'lfo.rate': 1.2, 'filter.cutoff': 1000,
      'filter.resonance': 3, 'filter.env': 3,
      'env1.attack': 0.001, 'env1.decay': 0.25, 'env1.sustain': 0.1, 'env1.release': 0.2,
      'env2.attack': 0.002, 'env2.decay': 0.3, 'env2.sustain': 0.2, 'env2.release': 0.25,
      'fx.mix': 0.4, 'fx.delayTime': 0.38, 'fx.feedback': 0.55, 'fx.chorus': 0.2,
    }),
  ],
];

export const POLY_PRESETS: readonly SynthPreset[] = POLY_BANKS.flat();

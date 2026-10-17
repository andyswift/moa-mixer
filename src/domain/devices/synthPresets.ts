/** A patch: values for synth control ids. Anything not listed falls back to INIT. */
export type PresetValues = Record<string, number | string>;

export interface SynthPreset {
  readonly name: string;
  readonly values: PresetValues;
}

/** The full default state of the synth: every control id, so loading a patch always resets everything. */
export const INIT: PresetValues = {
  'osc.range': "8'",
  'osc.width': 50,
  'osc.pwSource': 'man',
  'osc.pwm': 0,
  'osc.mod': 0,
  'osc.sub': '-1',
  'mix.saw': 0.8,
  'mix.pulse': 0,
  'mix.sub': 0.55,
  'mix.noise': 0.05,
  'filter.cutoff': 800,
  'filter.resonance': 1,
  'filter.keyFollow': 50,
  'filter.lfo': 0,
  'filterEnv.amount': 2,
  'filterEnv.attack': 0.005,
  'filterEnv.decay': 0.3,
  'filterEnv.sustain': 0.3,
  'filterEnv.release': 0.3,
  'ampEnv.attack': 0.005,
  'ampEnv.decay': 0.2,
  'ampEnv.sustain': 0.7,
  'ampEnv.release': 0.3,
  'lfo.wave': 'tri',
  'lfo.rate': 4.8,
  'perf.glide': 0,
  'perf.notes': 'legato',
  accent: 0,
  drive: 0,
  'drive.tilt': 0,
  'drive.even': 0,
  'drive.harmonics': 48,
  level: 0.5,
};

const p = (name: string, values: PresetValues): SynthPreset => ({ name, values });

/**
 * Nineteen classic mono-synth sounds in the SH-101 vocabulary (the last through the drive's wavefolder). The original has no patch memory, so
 * these are recipes for the sounds the instrument is known for, not factory dumps.
 */
export const SYNTH_PRESETS: readonly SynthPreset[] = [
  p('Init', {}),

  // --- Basses ---
  p('Sub Bass', {
    'osc.range': "16'", 'mix.saw': 0.5, 'mix.sub': 0.95, 'mix.noise': 0, 'filter.cutoff': 380, 'filter.resonance': 2,
    'filter.keyFollow': 30, 'filterEnv.amount': 1.5, 'filterEnv.attack': 0.001, 'filterEnv.decay': 0.25,
    'filterEnv.sustain': 0.2, 'ampEnv.attack': 0.002, 'ampEnv.decay': 0.3, 'ampEnv.sustain': 0.85,
    'ampEnv.release': 0.12, level: 0.6,
  }),
  p('Acid Squelch', {
    'osc.range': "16'", 'mix.saw': 1, 'mix.sub': 0.35, 'mix.noise': 0, 'filter.cutoff': 220, 'filter.resonance': 14,
    'filter.keyFollow': 40, 'filterEnv.amount': 4, 'filterEnv.attack': 0.001, 'filterEnv.decay': 0.18,
    'filterEnv.sustain': 0, 'filterEnv.release': 0.1, 'ampEnv.sustain': 0.9, 'ampEnv.release': 0.08,
    'perf.glide': 0.08, accent: 0.7, level: 0.45,
  }),
  p('Fat Pulse Bass', {
    'osc.range': "16'", 'osc.width': 30, 'mix.saw': 0, 'mix.pulse': 0.9, 'mix.sub': 0.5, 'mix.noise': 0,
    'filter.cutoff': 520, 'filter.resonance': 3, 'filterEnv.amount': 2, 'filterEnv.decay': 0.3,
    'filterEnv.sustain': 0.2, 'ampEnv.sustain': 0.85, 'ampEnv.release': 0.1,
  }),
  p('Wobble Bass', {
    'osc.range': "16'", 'mix.saw': 0.8, 'mix.sub': 0.7, 'mix.noise': 0, 'filter.cutoff': 300, 'filter.resonance': 6,
    'filter.lfo': 2, 'filterEnv.amount': 0.5, 'filterEnv.sustain': 0.5, 'lfo.wave': 'tri', 'lfo.rate': 3,
    'ampEnv.sustain': 1, 'ampEnv.release': 0.12, level: 0.55,
  }),
  p('Funk Pluck', {
    'osc.range': "8'", 'osc.width': 25, 'mix.saw': 0.3, 'mix.pulse': 0.8, 'mix.sub': 0.3, 'mix.noise': 0,
    'filter.cutoff': 260, 'filter.resonance': 5, 'filter.keyFollow': 60, 'filterEnv.amount': 3.5,
    'filterEnv.attack': 0.001, 'filterEnv.decay': 0.15, 'filterEnv.sustain': 0, 'ampEnv.attack': 0.001,
    'ampEnv.decay': 0.2, 'ampEnv.sustain': 0.3, 'ampEnv.release': 0.1,
  }),
  p('Rubber Bass', {
    'osc.range': "16'", 'mix.saw': 0.7, 'mix.sub': 0.8, 'mix.noise': 0, 'filter.cutoff': 150, 'filter.resonance': 8,
    'filter.keyFollow': 25, 'filterEnv.amount': 3, 'filterEnv.attack': 0.001, 'filterEnv.decay': 0.3,
    'filterEnv.sustain': 0.1, 'ampEnv.sustain': 0.8, 'ampEnv.release': 0.1, level: 0.55,
  }),

  // --- Leads ---
  p('Saw Lead', {
    'mix.saw': 1, 'mix.sub': 0.2, 'mix.noise': 0, 'filter.cutoff': 3000, 'filter.resonance': 3,
    'filter.keyFollow': 70, 'filterEnv.amount': 1, 'perf.glide': 0.06, 'osc.mod': 15, 'lfo.rate': 5.5,
    'ampEnv.sustain': 0.9, 'ampEnv.release': 0.25,
  }),
  p('Hollow Pulse Lead', {
    'osc.width': 18, 'mix.saw': 0, 'mix.pulse': 1, 'mix.sub': 0, 'mix.noise': 0, 'filter.cutoff': 2500,
    'filter.resonance': 2, 'filter.keyFollow': 80, 'filterEnv.amount': 1.5, 'filterEnv.attack': 0.01,
    'filterEnv.decay': 0.4, 'filterEnv.sustain': 0.5, 'ampEnv.sustain': 0.8, 'ampEnv.release': 0.2,
  }),
  p('PWM Lead', {
    'mix.saw': 0.2, 'mix.pulse': 0.9, 'mix.sub': 0.2, 'mix.noise': 0, 'osc.pwSource': 'lfo', 'osc.pwm': 70,
    'lfo.rate': 1.2, 'filter.cutoff': 3000, 'filter.resonance': 2, 'filter.keyFollow': 70,
    'filterEnv.amount': 1, 'ampEnv.sustain': 0.9, 'ampEnv.release': 0.3,
  }),
  p('Vibrato Lead', {
    'mix.saw': 0.8, 'mix.pulse': 0.4, 'mix.sub': 0.1, 'mix.noise': 0, 'osc.mod': 40, 'lfo.rate': 5.2,
    'filter.cutoff': 2800, 'filter.resonance': 3, 'filter.keyFollow': 70, 'filterEnv.amount': 1.2,
    'perf.glide': 0.1, 'ampEnv.attack': 0.01, 'ampEnv.sustain': 0.9, 'ampEnv.release': 0.3,
  }),
  p('Portamento Solo', {
    'mix.saw': 1, 'mix.sub': 0.3, 'mix.noise': 0, 'perf.glide': 0.35, 'perf.notes': 'legato',
    'filter.cutoff': 2200, 'filter.resonance': 4, 'filterEnv.amount': 0.8, 'filterEnv.sustain': 0.6,
    'ampEnv.sustain': 1, 'ampEnv.release': 0.2,
  }),
  p('Clarinet', {
    'osc.width': 50, 'mix.saw': 0, 'mix.pulse': 1, 'mix.sub': 0, 'mix.noise': 0.03, 'filter.cutoff': 1800,
    'filter.resonance': 1, 'filter.keyFollow': 70, 'filterEnv.amount': 1, 'filterEnv.attack': 0.04,
    'filterEnv.sustain': 0.6, 'ampEnv.attack': 0.04, 'ampEnv.sustain': 0.9, 'ampEnv.release': 0.12,
    'osc.mod': 8, 'lfo.rate': 5,
  }),

  // --- Brass ---
  p('Brass', {
    'mix.saw': 1, 'mix.pulse': 0.4, 'mix.sub': 0.2, 'mix.noise': 0, 'filter.cutoff': 500, 'filter.resonance': 2,
    'filter.keyFollow': 60, 'filterEnv.amount': 3, 'filterEnv.attack': 0.12, 'filterEnv.decay': 0.3,
    'filterEnv.sustain': 0.6, 'ampEnv.attack': 0.08, 'ampEnv.decay': 0.2, 'ampEnv.sustain': 0.85,
    'ampEnv.release': 0.2,
  }),
  // --- Effects and percussion ---
  p('Siren', {
    'mix.saw': 1, 'mix.sub': 0, 'mix.noise': 0, 'osc.mod': 600, 'lfo.wave': 'tri', 'lfo.rate': 0.7,
    'filter.cutoff': 4000, 'filter.resonance': 2, 'filterEnv.amount': 0, 'ampEnv.sustain': 1,
    'ampEnv.release': 0.15,
  }),
  p('Random SFX', {
    // The random (sample-and-hold) LFO steps both pitch and filter: computer-chatter style effects.
    'mix.saw': 0.5, 'mix.pulse': 0.5, 'mix.sub': 0, 'mix.noise': 0, 'lfo.wave': 'rnd', 'lfo.rate': 9,
    'osc.mod': 500, 'filter.cutoff': 1200, 'filter.resonance': 8, 'filter.lfo': 2.5, 'filterEnv.amount': 0,
    'ampEnv.attack': 0.01, 'ampEnv.sustain': 1, 'ampEnv.release': 0.1, level: 0.45,
  }),
  p('Snare', {
    'mix.saw': 0, 'mix.pulse': 0, 'mix.sub': 0, 'mix.noise': 1, 'filter.cutoff': 3000, 'filter.resonance': 2,
    'filter.keyFollow': 0, 'filterEnv.amount': 1, 'filterEnv.attack': 0.001, 'filterEnv.decay': 0.1,
    'filterEnv.sustain': 0, 'ampEnv.attack': 0.001, 'ampEnv.decay': 0.18, 'ampEnv.sustain': 0,
    'ampEnv.release': 0.1, level: 0.6,
  }),
  p('Wind', {
    'mix.saw': 0, 'mix.pulse': 0, 'mix.sub': 0, 'mix.noise': 1, 'filter.cutoff': 500, 'filter.resonance': 8,
    'filter.keyFollow': 0, 'filterEnv.amount': 4, 'filterEnv.attack': 2, 'filterEnv.decay': 2,
    'filterEnv.sustain': 0.5, 'filterEnv.release': 2, 'ampEnv.attack': 1.5, 'ampEnv.sustain': 1,
    'ampEnv.release': 2, level: 0.5,
  }),
  p('Whistle', {
    'mix.saw': 0, 'mix.pulse': 0, 'mix.sub': 0, 'mix.noise': 0.6, 'filter.cutoff': 2000, 'filter.resonance': 20,
    'filter.keyFollow': 100, 'filterEnv.amount': 0, 'osc.mod': 20, 'lfo.rate': 5, 'ampEnv.attack': 0.05,
    'ampEnv.sustain': 1, 'ampEnv.release': 0.2, level: 0.35,
  }),

  // --- With the wavefolder ---
  // Acid Squelch through the drive's wavefolder, tilted bright so the low end stays clean (the Acid Workbench sound)
  p('Acid Fold', {
    'osc.range': "16'", 'mix.saw': 1, 'mix.sub': 0.35, 'mix.noise': 0, 'filter.cutoff': 380, 'filter.resonance': 14,
    'filter.keyFollow': 40, 'filterEnv.amount': 4, 'filterEnv.attack': 0.001, 'filterEnv.decay': 0.18,
    'filterEnv.sustain': 0, 'filterEnv.release': 0.1, 'ampEnv.sustain': 0.9, 'ampEnv.release': 0.08,
    'perf.glide': 0.07, 'perf.notes': 'legato', accent: 0.7, drive: 0.45, 'drive.tilt': 6, level: 0.45,
  }),
];

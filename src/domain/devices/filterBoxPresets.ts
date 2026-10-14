import type { PresetValues, SynthPreset } from './synthPresets';

/** Every control id with its default, so loading a patch always resets everything the patch does not mention. */
export const FILTER_BOX_INIT: PresetValues = {
  'f1.type': 'GEN LP', 'f1.cutoff': 1200, 'f1.res': 0.25, 'f1.depth': 0, 'f1.source': 'env', 'f1.inv': 0, 'f1.noise': 0,
  'f1.vca': 0, 'f1.gate': 0, 'f1.threshold': 0.3,
  'f2.type': 'GEN LP', 'f2.cutoff': 1200, 'f2.res': 0.25, 'f2.depth': 0, 'f2.source': 'env', 'f2.inv': 0, 'f2.noise': 0,
  'f2.vca': 0, 'f2.gate': 0, 'f2.threshold': 0.3,
  'env1.attack': 0.01, 'env1.decay': 0.3, 'env1.sustain': 0.6, 'env1.release': 0.4, 'env1.mode': 'adsr', 'env1.curve': 'lin', 'env1.trig': 'keys',
  'env2.attack': 0.01, 'env2.decay': 0.3, 'env2.sustain': 0.6, 'env2.release': 0.4, 'env2.mode': 'adsr', 'env2.curve': 'lin', 'env2.trig': 'keys',
  'link.env': 0, 'link.cutoff': 0,
  'sh.rate': 4, 'sh.slew': 0.2, 'sh.source': 'noise',
  'delay.time': 0.25, 'delay.repeats': 0.3, 'delay.level': 0, 'delay.mod': 0, 'delay.source': 's&h',
  'mix.a': 0.8, 'mix.b': 0.8, 'mix.mode': 'stereo', 'mix.volume': 0.8,
};

const p = (name: string, values: PresetValues): SynthPreset => ({ name, values });

/** The same two filters side by side: a wide stereo pair of whatever the first one is. */
const both = (v: Record<string, number | string>): PresetValues => {
  const out: PresetValues = {};
  for (const [k, x] of Object.entries(v)) {
    out[`f1.${k}`] = x;
    out[`f2.${k}`] = x;
  }
  return out;
};

/**
 * Factory patches: starting points for the sounds a dual dynamic filter box is for. They are recipes, tuned by
 * ear for the Lynch 106 on its default sound (a saw and pulse with a bit of sub) played with the keys.
 */
export const FILTER_BOX_FACTORY: readonly SynthPreset[] = [
  p('Init', {}),
  p('Dynamic Pluck', { ...both({ cutoff: 180, res: 0.45, depth: 0.85, vca: 1 }), 'env1.attack': 0.002, 'env1.decay': 0.22, 'env1.sustain': 0, 'env1.release': 0.2, 'env1.curve': 'exp', 'link.env': 1, 'delay.level': 0.2, 'delay.time': 0.18, 'delay.repeats': 0.3 }),
  p('Auto Wah', { 'f1.type': 'GEN BP', 'f1.cutoff': 350, 'f1.res': 0.7, 'f1.depth': 0.7, 'f2.type': 'GEN BP', 'f2.cutoff': 500, 'f2.res': 0.7, 'f2.depth': 0.7, 'env1.trig': 'thresh', 'f1.gate': 1, 'f1.threshold': 0.35, 'env1.attack': 0.004, 'env1.decay': 0.18, 'env1.sustain': 0.1, 'env1.release': 0.15, 'env1.curve': 'exp', 'link.env': 1 }),
  p('Screaming Madman', { 'f1.type': 'GEN LP', 'f1.cutoff': 300, 'f1.res': 0.93, 'f1.depth': 0.6, 'f2.type': 'GEN HP', 'f2.cutoff': 900, 'f2.res': 0.9, 'f2.depth': -0.4, 'env1.attack': 0.01, 'env1.decay': 0.5, 'env1.sustain': 0.2, 'env1.release': 0.6, 'link.env': 1, 'mix.a': 0.6, 'mix.b': 0.45 }),
  p('Silk Sweep', { ...both({ type: '2045 LP', cutoff: 250, res: 0.35, depth: 0.7 }), 'env1.attack': 0.45, 'env1.decay': 1.2, 'env1.sustain': 0.7, 'env1.release': 1.5, 'link.env': 1, 'delay.level': 0.25, 'delay.time': 0.38, 'delay.repeats': 0.45 }),
  p('Ringing 2045', { 'f1.type': '2045 LP', 'f1.cutoff': 520, 'f1.res': 0.96, 'f1.depth': 0.3, 'f2.type': '2045 LP', 'f2.cutoff': 780, 'f2.res': 0.96, 'f2.depth': 0.3, 'env1.attack': 0.05, 'env1.sustain': 0.5, 'link.env': 1, 'mix.a': 0.5, 'mix.b': 0.5 }),
  p('Twin Peaks', { ...both({ type: 'BP+', cutoff: 700, res: 0.78, depth: 0.5 }), 'f2.cutoff': 1100, 'env1.attack': 0.02, 'env1.decay': 0.6, 'env1.sustain': 0.4, 'env1.release': 0.5, 'link.env': 1 }),
  p('Phase Rooms', { 'f1.type': 'NOTCH+', 'f1.cutoff': 600, 'f1.res': 0.6, 'f1.depth': 0.8, 'f1.source': 's&h', 'f2.type': 'BANDSTOP+', 'f2.cutoff': 900, 'f2.res': 0.5, 'f2.depth': 0.8, 'sh.rate': 1.2, 'sh.slew': 0.65, 'sh.source': 'noise' }),
  p('Random Steps', { ...both({ cutoff: 400, res: 0.6, depth: 0.9, source: 's&h' }), 'f2.type': 'GEN BP', 'sh.rate': 7, 'sh.slew': 0.05, 'delay.level': 0.3, 'delay.time': 0.21, 'delay.repeats': 0.4, 'delay.mod': 0.4, 'delay.source': 's&h' }),
  p('Looping LFO', { ...both({ type: '2045 LP', cutoff: 300, res: 0.55, depth: 0.7 }), 'env1.mode': 'loop', 'env1.attack': 0.35, 'env1.release': 0.55, 'link.env': 1 }),
  p('Tremolo Gate', { ...both({ cutoff: 8000, res: 0.1, depth: 0, vca: 1 }), 'env1.mode': 'loop', 'env1.attack': 0.01, 'env1.release': 0.09, 'env1.curve': 'exp', 'link.env': 1 }),
  p('Crunch Echo', { ...both({ type: 'GEN LP', cutoff: 2400, res: 0.4 }), 'delay.level': 0.7, 'delay.time': 0.42, 'delay.repeats': 0.7, 'delay.mod': 0.25, 'delay.source': 'env2', 'env2.mode': 'loop', 'env2.attack': 1.2, 'env2.release': 1.6 }),
  p('Noise Drums', { 'f1.type': 'GEN BP', 'f1.cutoff': 180, 'f1.res': 0.8, 'f1.depth': 0.8, 'f1.noise': 0.9, 'f1.vca': 1, 'f2.type': 'GEN HP', 'f2.cutoff': 3000, 'f2.res': 0.4, 'f2.noise': 0.7, 'f2.vca': 1, 'env1.attack': 0.001, 'env1.decay': 0.12, 'env1.sustain': 0, 'env1.release': 0.1, 'env1.curve': 'exp', 'env2.attack': 0.001, 'env2.decay': 0.05, 'env2.sustain': 0, 'env2.release': 0.05, 'env2.curve': 'exp' }),
  p('Ghost Pad', { 'f1.type': '2045 LP', 'f1.cutoff': 400, 'f1.res': 0.5, 'f1.depth': 0.5, 'f1.noise': 0.15, 'f2.type': 'BANDSTOP+', 'f2.cutoff': 1200, 'f2.res': 0.4, 'f2.depth': -0.5, 'env1.attack': 0.8, 'env1.release': 2, 'env2.attack': 1.5, 'env2.release': 2.5, 'delay.level': 0.4, 'delay.time': 0.5, 'delay.repeats': 0.6 }),
  p('Mono Squelch', { 'f1.type': '2045 LP', 'f1.cutoff': 120, 'f1.res': 0.88, 'f1.depth': 0.95, 'f1.vca': 1, 'f2.type': 'GEN LP', 'f2.cutoff': 200, 'f2.res': 0.85, 'f2.depth': 0.9, 'f2.vca': 1, 'env1.attack': 0.002, 'env1.decay': 0.25, 'env1.sustain': 0.15, 'env1.release': 0.15, 'env1.curve': 'exp', 'link.env': 1, 'mix.mode': 'mono' }),
];

export const FILTER_BOX_SLOTS = 16;
export const FILTER_BOX_PRESETS: readonly SynthPreset[] = Array.from({ length: FILTER_BOX_SLOTS }, (_, i) => FILTER_BOX_FACTORY[i] ?? p('Init', {}));

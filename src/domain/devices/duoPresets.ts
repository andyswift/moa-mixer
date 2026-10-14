import type { PresetValues, SynthPreset } from './synthPresets';

/** Every sound control with its default, so loading a patch always resets everything the patch does not mention. */
export const DUO_INIT: PresetValues = {
  'osc1.wave': 'saw', 'osc1.octave': '16', 'osc1.pw': 0, 'osc1.glide': 0, 'osc1.level': 0.8,
  'osc2.wave': 'saw', 'osc2.octave': '8', 'osc2.detune': 0, 'osc2.glide': 0, 'osc2.level': 0.6,
  'tune': 0, 'sync': 0, 'vib.rate': 5, 'vib.level': 0, 'noise': 0,
  'route.vco': 'nor', 'route.vcf': 'lpf', 'route.mod': 'single',
  'filter.cutoff': 1800, 'filter.res': 0.2, 'filter.post': 0,
  'mod1.rise': 0.01, 'mod1.fall': 0.5, 'mod1.hold': 0, 'mod1.lfo': 0, 'mod1.level': 0.3,
  'mod2.rise': 0.01, 'mod2.fall': 0.5, 'mod2.hold': 0, 'mod2.lfo': 0, 'mod2.level': 0,
  'vca.rise': 0.005, 'vca.fall': 0.4, 'vca.hold': 1, 'vca.lfo': 0, 'vca.level': 0.8,
  'reverb.time': 0.1, 'reverb.decay': 0.35, 'reverb.mix': 0.15,
  // Played settings (the channel lock is not part of a patch, see DUO_NOT_IN_PATCH).
  'play.legato': 0, 'play.mode': 'duo', 'play.channel': 0,
};

/** Like the hardware's panel switches, the MIDI channel lock is not part of a patch (mode and legato are). */
export const DUO_NOT_IN_PATCH = ['play.channel'] as const;
export const DUO_SLOTS = 24;

const p = (name: string, values: PresetValues): SynthPreset => ({ name, values });

/**
 * Factory patches: recipes for what a paraphonic duo with two routable filters is good at, tuned for playing one
 * or two notes at a time. Everything not listed falls back to Init.
 */
export const DUO_FACTORY: readonly SynthPreset[] = [
  p('Init', {}),
  p('Fat Bass', { 'osc1.octave': '32', 'osc1.wave': 'square', 'osc1.pw': 0.2, 'osc2.octave': '16', 'osc2.detune': 0.1, 'filter.cutoff': 260, 'filter.res': 0.35, 'mod1.rise': 0.002, 'mod1.fall': 0.35, 'mod1.level': 0.55, 'vca.fall': 0.2, 'play.mode': 'mono' }),
  p('Hard Sync Lead', { 'osc1.octave': '16', 'osc2.octave': '8', 'osc2.detune': 7, 'sync': 1, 'filter.cutoff': 2600, 'filter.res': 0.3, 'mod2.level': 0.5, 'route.mod': 'dual', 'mod2.lfo': 1, 'mod2.rise': 0.35, 'mod2.fall': 0.35, 'vib.level': 0.3, 'vib.rate': 5.5, 'osc1.glide': 0.15, 'osc2.glide': 0.15 }),
  p('Dual Fifths', { 'osc1.octave': '16', 'osc2.octave': '16', 'osc2.detune': 0.01, 'osc2.wave': 'tri', 'filter.cutoff': 1400, 'mod1.level': 0.3, 'mod1.fall': 0.8, 'mod1.hold': 1, 'reverb.mix': 0.25, 'reverb.decay': 0.5 }),
  p('Resonant Squelch', { 'osc1.octave': '16', 'osc1.wave': 'square', 'osc2.level': 0.3, 'filter.cutoff': 200, 'filter.res': 0.85, 'mod1.rise': 0.002, 'mod1.fall': 0.22, 'mod1.level': 0.8, 'vca.fall': 0.25, 'play.mode': 'mono' }),
  p('Split Pad', { 'route.vco': 'split', 'route.vcf': 'even', 'route.mod': 'split', 'osc1.octave': '16', 'osc2.octave': '8', 'osc2.wave': 'tri', 'osc2.detune': 0.03, 'filter.cutoff': 700, 'filter.post': 1.2, 'mod1.rise': 0.9, 'mod1.fall': 1.6, 'mod1.hold': 1, 'mod1.level': 0.35, 'mod2.rise': 1.4, 'mod2.fall': 2, 'mod2.hold': 1, 'mod2.level': 0.45, 'vca.rise': 0.7, 'vca.fall': 1.6, 'reverb.mix': 0.35, 'reverb.decay': 0.6, 'reverb.time': 0.3 }),
  p('Band Pass Voice', { 'route.vcf': 'odd', 'route.vco': 'half', 'osc1.octave': '16', 'osc2.octave': '8', 'osc2.detune': 12, 'filter.cutoff': 900, 'filter.res': 0.6, 'filter.post': -0.8, 'mod1.rise': 0.1, 'mod1.fall': 0.6, 'mod1.level': 0.4 }),
  p('Wobble Bass', { 'osc1.octave': '32', 'osc2.octave': '16', 'osc2.detune': 0.08, 'filter.cutoff': 180, 'filter.res': 0.6, 'mod1.lfo': 1, 'mod1.rise': 0.18, 'mod1.fall': 0.18, 'mod1.level': 0.6, 'play.mode': 'mono' }),
  p('Tremolo Organ', { 'osc1.wave': 'square', 'osc1.octave': '16', 'osc2.wave': 'tri', 'osc2.octave': '8', 'filter.cutoff': 3500, 'vca.lfo': 1, 'vca.hold': 1, 'vca.rise': 0.06, 'vca.fall': 0.06, 'vib.level': 0.1, 'reverb.mix': 0.3 }),
  p('Noise Hat', { 'osc1.level': 0, 'osc2.level': 0, 'noise': 0.9, 'route.vcf': 'hpf', 'filter.cutoff': 7000, 'filter.res': 0.2, 'vca.hold': 0, 'vca.rise': 0.001, 'vca.fall': 0.09, 'reverb.mix': 0.1 }),
  p('Ringing Filters', { 'route.vco': 'vca', 'route.vcf': 'even', 'osc1.level': 0.05, 'osc2.level': 0, 'filter.cutoff': 300, 'filter.post': 0.6, 'filter.res': 1, 'mod1.level': 0.2, 'mod1.rise': 0.01, 'mod1.fall': 0.6, 'vca.rise': 0.01, 'vca.fall': 0.5, 'reverb.mix': 0.3 }),
  p('Infinite Cathedral', { 'osc1.octave': '8', 'osc2.octave': '8', 'osc2.wave': 'tri', 'osc2.detune': 0.02, 'filter.cutoff': 2200, 'mod1.level': 0.2, 'vca.rise': 0.5, 'vca.fall': 2.5, 'reverb.mix': 0.7, 'reverb.decay': 1, 'reverb.time': 0.5 }),
  p('Pulse Sweep', { 'osc1.wave': 'square', 'osc1.pw': 0.7, 'osc1.octave': '16', 'osc2.octave': '16', 'filter.cutoff': 500, 'filter.res': 0.4, 'mod1.rise': 1.4, 'mod1.fall': 1.8, 'mod1.hold': 1, 'mod1.level': 0.7, 'vca.rise': 0.3 }),
  p('Glide Mono', { 'osc1.octave': '16', 'osc2.octave': '16', 'osc2.detune': 0.01, 'osc1.glide': 0.35, 'osc2.glide': 0.35, 'filter.cutoff': 1100, 'filter.res': 0.45, 'mod1.level': 0.4, 'mod1.fall': 0.4, 'play.mode': 'mono', 'play.legato': 1 }),
  p('Dual Detune Strings', { 'osc1.octave': '8', 'osc2.octave': '8', 'osc2.detune': 0.12, 'filter.cutoff': 1900, 'mod1.level': 0.15, 'vca.rise': 0.25, 'vca.fall': 0.9, 'vib.level': 0.15, 'vib.rate': 5.8, 'reverb.mix': 0.3, 'reverb.decay': 0.55 }),
  p('Hoover', { 'osc1.wave': 'square', 'osc1.pw': 0.35, 'osc1.octave': '16', 'osc2.wave': 'saw', 'osc2.octave': '16', 'osc2.detune': 0, 'tune': 42, 'osc1.glide': 0.45, 'osc2.glide': 0.5, 'osc1.level': 0.8, 'osc2.level': 0.8, 'filter.cutoff': 2600, 'filter.res': 0.45, 'route.mod': 'dual', 'mod1.level': 0.15, 'mod1.fall': 0.6, 'mod1.hold': 1, 'mod2.lfo': 1, 'mod2.rise': 0.4, 'mod2.fall': 0.4, 'mod2.level': 0.5, 'vib.level': 0.3, 'vib.rate': 6.5, 'vca.fall': 0.5, 'reverb.mix': 0.3, 'reverb.decay': 0.45, 'reverb.time': 0.2, 'play.legato': 1 }),
  p('Filter Echo', { 'osc1.octave': '16', 'osc2.octave': '8', 'osc2.detune': 12, 'route.mod': 'dual', 'filter.cutoff': 800, 'filter.res': 0.55, 'mod2.lfo': 1, 'mod2.rise': 0.25, 'mod2.fall': 0.4, 'mod2.level': 0.5, 'mod1.level': 0.4, 'reverb.mix': 0.4, 'reverb.decay': 0.75, 'reverb.time': 0.4 }),
];
export const DUO_PRESETS: readonly SynthPreset[] = Array.from({ length: DUO_SLOTS }, (_, i) => DUO_FACTORY[i] ?? p('Init', {}));

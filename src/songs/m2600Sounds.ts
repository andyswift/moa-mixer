import type { PageSettings } from './control';

/**
 * Sounds for the MOA-2600 in songs, built from its Init patch (no cords): settings for the m2600 page, with whatever a
 * song wants to change on top.
 */

/** A pluck for arpeggios: VCO 1's pulse and a slightly detuned VCO 2 pulse through the 4072, a short envelope on the filter. */
export function pluck2600(controls: Record<string, number | string> = {}): PageSettings {
  return { m2600: { preset: 0, controls: {
    'vcf.in.vco1': 0.6, 'vcf.in.vco2': 0.5, 'vco2.fine': 0.08, 'vcf.freq': 1500, 'vcf.res': 0.3, 'vcf.cv.adsr': 0.3,
    'adsr.attack': 0.001, 'adsr.decay': 0.2, 'adsr.sustain': 0.1, 'adsr.release': 0.15, 'reverb.left': 0.15, 'reverb.right': 0.15,
    ...controls,
  } } };
}

/** A cold drone: a ring-modulated tone and pink noise through a resonant filter that VCO 2 (in its LF range) sweeps slowly. */
export function drone2600(controls: Record<string, number | string> = {}): PageSettings {
  return { m2600: { preset: 0, controls: {
    'vcf.in.vco1': 0.3, 'vcf.in.ring': 0.4, 'vcf.in.noise': 0.5, 'noise.color': 0.5, 'vcf.freq': 500, 'vcf.res': 0.6,
    'vcf.cv.kybd': 0, 'vcf.cv.adsr': 0, 'vcf.cv.vco2': 0.25, 'vco2.range': 'lf', 'vco2.freq': 20,
    'adsr.attack': 2, 'adsr.decay': 1, 'adsr.sustain': 1, 'adsr.release': 3, 'reverb.left': 0.4, 'reverb.right': 0.4,
    ...controls,
  } } };
}

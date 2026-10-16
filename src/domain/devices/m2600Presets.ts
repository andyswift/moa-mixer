import { M2600_PARAMS } from './m2600Params';
import type { PresetValues, SynthPreset } from './synthPresets';

/** Every sound control at its default, so loading a patch always resets everything the patch does not mention. */
export const M2600_INIT: PresetValues = Object.fromEntries(
  M2600_PARAMS.map((p) => [p.id, p.kind === 'choice' ? p.options![p.def]! : p.def]),
);

/** The MIDI channel belongs to the setup, not the sound. */
export const M2600_NOT_IN_PATCH = ['play.channel'] as const;
export const M2600_SLOTS = 32;

const p = (name: string, values: PresetValues): SynthPreset => ({ name, values });

// Oscillator frequencies are the pitch at middle C, so 65.41 Hz plays two octaves down.
const C2 = 65.41, C3 = 130.81, C4 = 261.63, C5 = 523.25;

/**
 * Factory patches: sounds the 2600 is known for, made on its normalled routing (no cords), and a few that use the
 * second filter. Everything not listed falls back to Init.
 */
export const M2600_FACTORY: readonly SynthPreset[] = [
  p('Init', {}),
  p('Classic Bass', {
    'vco1.freq': C2, 'vco2.freq': C2, 'vco2.fine': 0.08, 'vco3.freq': C2 / 2,
    'vcf.in.vco1': 0.7, 'vcf.in.vco2': 0.6, 'vcf.in.vco3': 0.4, 'vcf.freq': 180, 'vcf.res': 0.35, 'vcf.cv.adsr': 0.45,
    'adsr.attack': 0.002, 'adsr.decay': 0.35, 'adsr.sustain': 0.25, 'adsr.release': 0.12,
  }),
  p('Sync Lead', {
    'vco2.sync': 1, 'vco2.freq': C5, 'vco2.fm.adsr': 0.2, 'vcf.in.vco1': 0, 'vcf.in.vco2': 0.8,
    'vcf.freq': 3000, 'vcf.res': 0.2, 'vcf.cv.adsr': 0.15, 'adsr.decay': 0.8, 'adsr.sustain': 0.7,
    'kb.portaOn': 1, 'kb.porta': 0.2, 'lfo.delay': 0.4, 'lfo.depth': 0.25,
  }),
  p('Ladder Squelch', {
    'vcf.mode': '4012', 'vco1.freq': C3, 'vcf.freq': 220, 'vcf.res': 0.85, 'vcf.cv.adsr': 0.5,
    'adsr.attack': 0.001, 'adsr.decay': 0.25, 'adsr.sustain': 0.1, 'adsr.release': 0.1,
  }),
  p('Brass', {
    'vcf.in.vco1': 0.6, 'vcf.in.vco3': 0.6, 'vco3.fine': 0.06, 'vcf.freq': 500, 'vcf.res': 0.1, 'vcf.cv.adsr': 0.35,
    'adsr.attack': 0.06, 'adsr.decay': 0.5, 'adsr.sustain': 0.7, 'adsr.release': 0.25, 'lfo.delay': 0.6, 'lfo.depth': 0.15,
  }),
  p('Duo Lead', {
    'kb.voice': 'duo', 'vcf.in.vco1': 0.6, 'vcf.in.vco2': 0.6, 'vcf.in.vco3': 0.5, 'vco3.fine': 0.05,
    'vcf.freq': 2200, 'vcf.res': 0.25, 'adsr.decay': 0.6, 'adsr.sustain': 0.7,
    'kb.portaOn': 1, 'kb.porta': 0.15, 'lfo.delay': 0.5, 'lfo.depth': 0.2,
  }),
  p('Ring Bells', {
    'vcf.in.vco1': 0, 'vcf.in.ring': 0.9, 'vco2.freq': C4 * 2.76, 'vcf.freq': 6000, 'vcf.cv.adsr': 0,
    'adsr.attack': 0.001, 'adsr.decay': 1.8, 'adsr.sustain': 0, 'adsr.release': 1.5, 'reverb.left': 0.35, 'reverb.right': 0.35,
  }),
  p('FM Clang', {
    'vcf.in.vco1': 0, 'vcf.in.vco3': 0.8, 'vco3.fm.vco2': 0.3, 'vco2.freq': C4 * 3.5, 'vcf.freq': 4000, 'vcf.cv.adsr': 0.2,
    'adsr.attack': 0.001, 'adsr.decay': 1.2, 'adsr.sustain': 0, 'adsr.release': 0.8, 'reverb.left': 0.25, 'reverb.right': 0.25,
  }),
  p('Droid Chatter', {
    'vco1.fm.sh': 0.25, 'sh.rate': 9, 'vcf.freq': 2500, 'vcf.cv.adsr': 0, 'kb.repeat': 'kybd', 'lfo.speed': 9,
    'adsr.attack': 0.001, 'adsr.decay': 0.08, 'adsr.sustain': 0, 'adsr.release': 0.05,
  }),
  p('Laser Zap', {
    'vco1.freq': C5, 'vco1.fm.adsr': 0.35, 'vcf.freq': 5000, 'vcf.res': 0.2, 'vcf.cv.adsr': 0,
    'adsr.attack': 0.001, 'adsr.decay': 0.25, 'adsr.sustain': 0, 'adsr.release': 0.2,
  }),
  p('Repeat Bleeps', {
    'kb.repeat': 'kybd', 'lfo.speed': 7, 'vcf.freq': 900, 'vcf.res': 0.6, 'vcf.cv.adsr': 0.35,
    'adsr.attack': 0.001, 'adsr.decay': 0.12, 'adsr.sustain': 0, 'adsr.release': 0.1,
  }),
  p('Wind and Surf', {
    'vcf.in.vco1': 0, 'vcf.in.noise': 0.9, 'noise.color': 0.5, 'vcf.freq': 400, 'vcf.res': 0.75, 'vcf.cv.kybd': 0,
    'vcf.cv.adsr': 0, 'vcf.cv.vco2': 0.35, 'vco2.range': 'lf', 'vco2.freq': 33,
    'adsr.attack': 1.5, 'adsr.sustain': 1, 'adsr.release': 3, 'reverb.left': 0.4, 'reverb.right': 0.4,
  }),
  p('Noise Snare', {
    'vcf.in.vco1': 0.2, 'vco1.freq': 196, 'vcf.in.noise': 0.9, 'vcf.freq': 3500, 'vcf.cv.kybd': 0, 'vcf.cv.adsr': 0.1,
    'adsr.attack': 0.001, 'adsr.decay': 0.18, 'adsr.sustain': 0, 'adsr.release': 0.15,
  }),
  p('Kick Drum', {
    'vco1.freq': 50, 'vco1.fm.adsr': 0.3, 'vcf.in.vco1': 0.9, 'vcf.freq': 120, 'vcf.res': 0.3, 'vcf.cv.kybd': 0, 'vcf.cv.adsr': 0.35,
    'vca.in.vcf': 1, 'adsr.attack': 0.001, 'adsr.decay': 0.22, 'adsr.sustain': 0, 'adsr.release': 0.18,
    'reverb.left': 0.05, 'reverb.right': 0.05,
  }),
  p('Space Organ', {
    'vcf.in.vco1': 0.6, 'vco2.freq': C5, 'vcf.in.vco2': 0.5, 'vcf.freq': 3000, 'vcf.cv.adsr': 0,
    'adsr.attack': 0.01, 'adsr.decay': 0.1, 'adsr.sustain': 1, 'adsr.release': 0.1,
    'lfo.speed': 6, 'lfo.depth': 0.12, 'reverb.left': 0.5, 'reverb.right': 0.5,
  }),
  // ---- the second filter
  p('Dual Filter Pad', {
    'vco2.fine': 0.1, 'vco3.fine': -0.1, 'vcf.in.vco1': 0.6, 'vcf.in.vco2': 0.6, 'vcf.freq': 700, 'vcf.res': 0.3, 'vcf.cv.adsr': 0.15,
    'sem.route': 'parallel', 'sem.in.vco1': 0.6, 'sem.in.vco3': 0.5, 'sem.freq': 1800, 'sem.mode': 0.8, 'sem.res': 0.4,
    'sem.cv.lfo': 0.08, 'lfo.speed': 0.3, 'vca.in.sem': 0.7,
    'adsr.attack': 0.8, 'adsr.decay': 1.5, 'adsr.sustain': 0.8, 'adsr.release': 2, 'reverb.left': 0.35, 'reverb.right': 0.35,
  }),
  p('Notch Sweep', {
    'vcf.in.vco1': 0, 'vcf.in.vco2': 0.6, 'vcf.in.vco3': 0.6, 'vco3.fine': 0.07, 'vcf.freq': 8000, 'vcf.cv.adsr': 0,
    'sem.mode': 0.5, 'sem.res': 0.5, 'sem.freq': 800, 'sem.cv.kybd': 0, 'sem.cv.lfo': 0.25, 'lfo.speed': 0.25,
    'adsr.sustain': 1, 'adsr.release': 0.6,
  }),
  p('Band Pass Voice', {
    'vcf.in.vco1': 0.7, 'vcf.in.vco3': 0.6, 'vco3.fine': 0.07, 'vcf.freq': 5000, 'vcf.cv.adsr': 0,
    'sem.bp': 1, 'sem.freq': 900, 'sem.res': 0.6, 'sem.cv.adsr': 0.15, 'adsr.attack': 0.03, 'adsr.sustain': 0.8,
    'lfo.delay': 0.3, 'lfo.depth': 0.15,
  }),
  p('Twin Resonance', {
    'vco1.freq': C3, 'vcf.mode': '4012', 'vcf.freq': 350, 'vcf.res': 0.7, 'vcf.cv.adsr': 0.4,
    'sem.freq': 1400, 'sem.res': 0.75, 'sem.cv.adsr': 0.25, 'sem.mode': 0.15,
    'adsr.attack': 0.002, 'adsr.decay': 0.4, 'adsr.sustain': 0.2, 'adsr.release': 0.2,
  }),
];

export const M2600_PRESETS: readonly SynthPreset[] = Array.from({ length: M2600_SLOTS }, (_, i) => M2600_FACTORY[i] ?? p('Init', {}));

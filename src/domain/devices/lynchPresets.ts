import type { PresetValues, SynthPreset } from './synthPresets';

/** Every control id with its default, so loading a patch always resets everything the patch does not mention. */
export const LYNCH_INIT: PresetValues = {
  'lfo.rate': 5, 'lfo.delay': 0,
  'dco.lfo': 0, 'dco.pwm': 0.5, 'dco.pwmSource': 'man', 'dco.range': '8', 'dco.pulse': 1, 'dco.saw': 1, 'dco.sub': 0.3, 'dco.noise': 0,
  'hpf.freq': '1',
  'vcf.freq': 3000, 'vcf.res': 0.2, 'vcf.env': 0.4, 'vcf.polarity': 'plus', 'vcf.lfo': 0, 'vcf.kybd': 0.5,
  'vca.mode': 'env', 'vca.level': 0.8,
  'env.attack': 0.005, 'env.decay': 0.4, 'env.sustain': 0.6, 'env.release': 0.3,
  'chorus.i': 0, 'chorus.ii': 0,
  'bend.dco': 2, 'bend.vcf': 0.2, 'bend.lfo': 0.3, 'bend.lfoTrig': 0,
  'master.portamento': 0,
  'assign.mode': 'poly1',
  // Performance settings, not part of a patch (see LYNCH_NOT_IN_PATCH).
  'master.tune': 0, 'master.volume': 0.75, 'key.hold': 0, 'key.transpose': '0',
};

/** Like the original, a patch holds the sound but not the volume, the tuning, hold or the key transpose. */
export const LYNCH_NOT_IN_PATCH = ['master.tune', 'master.volume', 'key.hold', 'key.transpose'] as const;

export const LYNCH_GROUPS = ['A', 'B'] as const;
export const LYNCH_BANKS = 8;
export const LYNCH_PATCHES = 8;
export const LYNCH_SLOTS = LYNCH_GROUPS.length * LYNCH_BANKS * LYNCH_PATCHES; // 128, as on the original

/** Slot index for group (0-1), bank (1-8) and patch (1-8). */
export const slotIndex = (group: number, bank: number, patch: number): number =>
  group * LYNCH_BANKS * LYNCH_PATCHES + (bank - 1) * LYNCH_PATCHES + (patch - 1);

const p = (name: string, values: PresetValues): SynthPreset => ({ name, values });

/**
 * Factory patches in group A banks 1 to 3: recipes for the sounds a six-voice, one-oscillator analogue polysynth
 * with chorus is known for. Everything else starts as Init, ready for your own sounds.
 */
export const LYNCH_FACTORY: readonly SynthPreset[] = [
  // --- Bank 1: pads, strings, brass ---
  p('Brass 1', { 'dco.sub': 0.2, 'vcf.freq': 700, 'vcf.res': 0.15, 'vcf.env': 0.55, 'vcf.kybd': 0.6, 'env.attack': 0.07, 'env.decay': 0.4, 'env.sustain': 0.65, 'env.release': 0.2, 'chorus.i': 1 }),
  p('Brass 2', { 'dco.pwm': 0.35, 'dco.pulse': 1, 'dco.saw': 1, 'vcf.freq': 600, 'vcf.res': 0.25, 'vcf.env': 0.6, 'env.attack': 0.12, 'env.decay': 0.5, 'env.sustain': 0.55, 'env.release': 0.25, 'chorus.ii': 1 }),
  p('Strings', { 'dco.pulse': 0, 'dco.saw': 1, 'dco.sub': 0.1, 'hpf.freq': '2', 'vcf.freq': 2600, 'vcf.res': 0.05, 'vcf.env': 0.1, 'env.attack': 0.35, 'env.decay': 1, 'env.sustain': 0.85, 'env.release': 0.6, 'chorus.i': 1, 'chorus.ii': 1 }),
  p('String Ensemble', { 'dco.pulse': 1, 'dco.saw': 1, 'dco.pwm': 0.6, 'dco.pwmSource': 'lfo', 'lfo.rate': 0.8, 'dco.sub': 0.15, 'hpf.freq': '2', 'vcf.freq': 2200, 'vcf.env': 0.1, 'env.attack': 0.5, 'env.decay': 1, 'env.sustain': 0.9, 'env.release': 0.8, 'chorus.i': 1, 'chorus.ii': 1 }),
  p('Choir', { 'dco.pulse': 1, 'dco.saw': 0, 'dco.pwm': 0.3, 'dco.sub': 0.3, 'dco.noise': 0.04, 'vcf.freq': 1300, 'vcf.res': 0.35, 'vcf.env': 0.1, 'env.attack': 0.45, 'env.decay': 0.8, 'env.sustain': 0.8, 'env.release': 0.9, 'chorus.ii': 1 }),
  p('Warm Pad', { 'dco.sub': 0.4, 'vcf.freq': 900, 'vcf.res': 0.1, 'vcf.env': 0.15, 'vcf.lfo': 0.1, 'lfo.rate': 0.3, 'env.attack': 0.9, 'env.decay': 1.5, 'env.sustain': 0.8, 'env.release': 1.4, 'chorus.i': 1 }),
  p('Slow Pad', { 'dco.pwmSource': 'lfo', 'dco.pwm': 0.5, 'lfo.rate': 0.2, 'dco.sub': 0.25, 'vcf.freq': 1500, 'vcf.res': 0.2, 'vcf.env': 0.3, 'env.attack': 1.6, 'env.decay': 2, 'env.sustain': 0.85, 'env.release': 2.2, 'chorus.i': 1, 'chorus.ii': 1 }),
  p('Sweep Pad', { 'vcf.freq': 400, 'vcf.res': 0.55, 'vcf.env': 0.7, 'vcf.lfo': 0.25, 'lfo.rate': 0.15, 'env.attack': 1.2, 'env.decay': 2.5, 'env.sustain': 0.7, 'env.release': 1.8, 'chorus.ii': 1 }),
  // --- Bank 2: basses and leads ---
  p('Sub Bass', { 'dco.range': '16', 'dco.pulse': 0, 'dco.saw': 1, 'dco.sub': 0.8, 'vcf.freq': 350, 'vcf.res': 0.1, 'vcf.env': 0.3, 'vcf.kybd': 0.2, 'env.attack': 0.003, 'env.decay': 0.3, 'env.sustain': 0.8, 'env.release': 0.12, 'master.portamento': 0.05 }),
  p('Saw Bass', { 'dco.range': '16', 'dco.pulse': 0, 'dco.sub': 0.5, 'hpf.freq': '1', 'vcf.freq': 500, 'vcf.res': 0.3, 'vcf.env': 0.55, 'vcf.kybd': 0.3, 'env.attack': 0.002, 'env.decay': 0.25, 'env.sustain': 0.4, 'env.release': 0.12 }),
  p('Pluck Bass', { 'dco.range': '16', 'dco.pulse': 1, 'dco.saw': 0, 'dco.pwm': 0.4, 'dco.sub': 0.6, 'vcf.freq': 300, 'vcf.res': 0.4, 'vcf.env': 0.7, 'vcf.kybd': 0.4, 'env.attack': 0.001, 'env.decay': 0.22, 'env.sustain': 0, 'env.release': 0.15 }),
  p('Lead Saw', { 'dco.pulse': 0, 'dco.sub': 0.1, 'vcf.freq': 2400, 'vcf.res': 0.3, 'vcf.env': 0.25, 'vcf.kybd': 0.8, 'dco.lfo': 0.12, 'lfo.rate': 5.5, 'lfo.delay': 0.6, 'env.attack': 0.01, 'env.decay': 0.3, 'env.sustain': 0.85, 'env.release': 0.2, 'master.portamento': 0.15, 'assign.mode': 'unison', 'chorus.i': 1 }),
  p('Lead Pulse', { 'dco.saw': 0, 'dco.pulse': 1, 'dco.pwm': 0.55, 'dco.pwmSource': 'lfo', 'lfo.rate': 3, 'dco.sub': 0.2, 'vcf.freq': 2000, 'vcf.res': 0.35, 'vcf.env': 0.3, 'vcf.kybd': 0.8, 'env.attack': 0.01, 'env.decay': 0.3, 'env.sustain': 0.8, 'env.release': 0.2, 'assign.mode': 'unison', 'chorus.ii': 1 }),
  p('Whistle Lead', { 'dco.range': '4', 'dco.saw': 0, 'dco.pulse': 1, 'dco.pwm': 0.1, 'dco.sub': 0, 'hpf.freq': '2', 'vcf.freq': 3800, 'vcf.res': 0.2, 'vcf.env': 0.1, 'dco.lfo': 0.1, 'lfo.rate': 5, 'lfo.delay': 0.9, 'env.attack': 0.04, 'env.decay': 0.3, 'env.sustain': 0.9, 'env.release': 0.25, 'master.portamento': 0.25, 'assign.mode': 'unison' }),
  p('Organ', { 'dco.saw': 0, 'dco.pulse': 1, 'dco.pwm': 0, 'dco.sub': 0.7, 'hpf.freq': '2', 'vcf.freq': 6000, 'vcf.res': 0, 'vcf.env': 0, 'vca.mode': 'gate', 'chorus.i': 1, 'chorus.ii': 1 }),
  p('Clav', { 'dco.saw': 0, 'dco.pulse': 1, 'dco.pwm': 0.25, 'dco.sub': 0, 'hpf.freq': '3', 'vcf.freq': 1500, 'vcf.res': 0.35, 'vcf.env': 0.55, 'vcf.kybd': 0.9, 'env.attack': 0.001, 'env.decay': 0.18, 'env.sustain': 0, 'env.release': 0.12 }),
  // --- Bank 3: plucks, bells and effects ---
  p('Pluck', { 'dco.pulse': 0, 'dco.sub': 0.2, 'vcf.freq': 700, 'vcf.res': 0.3, 'vcf.env': 0.6, 'env.attack': 0.001, 'env.decay': 0.35, 'env.sustain': 0, 'env.release': 0.3, 'chorus.i': 1 }),
  p('Harp', { 'dco.range': '4', 'dco.pulse': 0, 'dco.sub': 0, 'vcf.freq': 1500, 'vcf.res': 0.15, 'vcf.env': 0.35, 'env.attack': 0.001, 'env.decay': 1.2, 'env.sustain': 0, 'env.release': 1, 'chorus.ii': 1 }),
  p('Bell Pad', { 'dco.range': '4', 'dco.saw': 0, 'dco.pulse': 1, 'dco.pwm': 0.7, 'dco.pwmSource': 'lfo', 'lfo.rate': 6, 'dco.sub': 0, 'vcf.freq': 2500, 'vcf.res': 0.45, 'vcf.env': 0.4, 'env.attack': 0.002, 'env.decay': 1.6, 'env.sustain': 0.1, 'env.release': 1.5, 'chorus.i': 1, 'chorus.ii': 1 }),
  p('Noise Sweep', { 'dco.pulse': 0, 'dco.saw': 0, 'dco.sub': 0, 'dco.noise': 0.8, 'hpf.freq': '2', 'vcf.freq': 300, 'vcf.res': 0.6, 'vcf.env': 0.8, 'env.attack': 1.4, 'env.decay': 1.5, 'env.sustain': 0.1, 'env.release': 1.2, 'chorus.ii': 1 }),
  p('Wind', { 'dco.pulse': 0, 'dco.saw': 0, 'dco.sub': 0, 'dco.noise': 0.9, 'vcf.freq': 900, 'vcf.res': 0.55, 'vcf.env': 0.2, 'vcf.lfo': 0.3, 'lfo.rate': 0.25, 'vcf.kybd': 1, 'env.attack': 1, 'env.decay': 1, 'env.sustain': 0.9, 'env.release': 1.5, 'chorus.i': 1 }),
  p('Vibes', { 'dco.range': '4', 'dco.pulse': 0, 'dco.sub': 0, 'dco.lfo': 0.05, 'lfo.rate': 6, 'vcf.freq': 2400, 'vcf.res': 0.1, 'vcf.env': 0.2, 'env.attack': 0.002, 'env.decay': 1.4, 'env.sustain': 0, 'env.release': 0.9, 'chorus.ii': 1 }),
  p('Glass', { 'dco.saw': 0, 'dco.pulse': 1, 'dco.pwm': 0.8, 'dco.pwmSource': 'lfo', 'lfo.rate': 0.5, 'dco.sub': 0, 'dco.noise': 0.03, 'hpf.freq': '2', 'vcf.freq': 4000, 'vcf.res': 0.25, 'vcf.env': 0.1, 'env.attack': 0.6, 'env.decay': 1.5, 'env.sustain': 0.7, 'env.release': 1.6, 'chorus.i': 1, 'chorus.ii': 1 }),
  p('Funk Stab', { 'dco.sub': 0.3, 'hpf.freq': '2', 'vcf.freq': 500, 'vcf.res': 0.25, 'vcf.env': 0.65, 'vcf.kybd': 0.7, 'env.attack': 0.001, 'env.decay': 0.16, 'env.sustain': 0, 'env.release': 0.08, 'chorus.ii': 1 }),
];

/** All 128 slots: the factory patches first, then Init. */
export const LYNCH_PRESETS: readonly SynthPreset[] = Array.from({ length: LYNCH_SLOTS }, (_, i) => LYNCH_FACTORY[i] ?? p('Init', {}));

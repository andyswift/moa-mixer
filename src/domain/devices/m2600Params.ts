import { SQ16_INPUTS, SQ16_OUTPUTS, SQ16_PARAMS } from './sq16Params';

/**
 * The MOA-2600's controls and jacks in one table, shared by the device (which builds its controls from it), the
 * worklet (whose AudioParams are these same ids, injected into its source) and the panel. A choice is sent to the
 * worklet as the index of its option, a toggle as 0 or 1.
 *
 * Signals inside the synth use the scales of the original: 1 V per octave (the keyboard CV is 0 V at middle C, MIDI
 * 60), envelopes 0 to +10 V, LFO, sample-and-hold and noise about ±5 V, audio ±5 V. Every input slider is a plain
 * 0..1 attenuator on the voltage it lets through, so an envelope on a VCO's FM slider at full sweeps ten octaves,
 * as it does on the hardware.
 */

export interface M2600Param {
  id: string;
  label: string;
  kind: 'number' | 'choice' | 'toggle';
  min: number;
  max: number;
  /** For a choice: the index of its default option; for a toggle 0 or 1. */
  def: number;
  unit?: string;
  curve?: 'linear' | 'log';
  options?: readonly string[];
}

const n = (id: string, label: string, min: number, max: number, def: number, unit = '', curve: 'linear' | 'log' = 'linear'): M2600Param =>
  ({ id, label, kind: 'number', min, max, def, unit, curve });
const c = (id: string, label: string, options: readonly string[], def: string): M2600Param =>
  ({ id, label, kind: 'choice', min: 0, max: options.length - 1, def: options.indexOf(def), options });
const t = (id: string, label: string, def = 0): M2600Param => ({ id, label, kind: 'toggle', min: 0, max: 1, def });
/** An input attenuator slider. */
const s = (id: string, label: string, def = 0): M2600Param => n(id, label, 0, 1, def);

const SYNTH_PARAMS: readonly M2600Param[] = [
  // ---- keyboard controller: portamento, LFO with delayed vibrato, voice and trigger modes
  n('kb.porta', 'Portamento', 0, 1, 0.25),
  t('kb.portaOn', 'Portamento on', 0),
  c('kb.voice', 'Voice mode', ['mono', 'duo'], 'mono'),
  /** kybd: the LFO retriggers the envelopes while a key is held; auto: it also plays with no key held. */
  c('kb.repeat', 'Repeat', ['kybd', 'off', 'auto'], 'off'),
  /** single: a key pressed while another is held does not retrigger; multi: every key does. */
  c('kb.trig', 'Trigger mode', ['single', 'multi'], 'multi'),
  n('lfo.speed', 'LFO speed', 0.1, 30, 5, 'Hz', 'log'),
  n('lfo.delay', 'Vibrato delay', 0, 3, 0, 's'),
  /** Vibrato from the delayed LFO into the keyboard CV: at full, ±3 semitones. */
  s('lfo.depth', 'Vibrato depth', 0),

  // ---- preamp and envelope follower (no input until a cord is patched into the preamp)
  s('pre.gain', 'Preamp gain', 0.5),
  c('pre.range', 'Preamp range', ['x10', 'x100', 'x1000'], 'x10'),
  s('envf.gain', 'Env follower gain', 0.5),

  // ---- ring modulator: inputs normalled to VCO 1 saw (A) and VCO 2 triangle (B)
  c('ring.mode', 'Ring mod mode', ['audio', 'dc'], 'audio'),
  s('ring.a', 'Ring mod A level', 1),
  s('ring.b', 'Ring mod B level', 1),

  // ---- noise: 0 white, 0.5 pink, 1 low-frequency (a slow random voltage)
  s('noise.color', 'Noise color', 0),
  s('noise.level', 'Noise level', 0.8),

  // ---- oscillators: initial frequency is the pitch at middle C; in LF the range is divided by 333 (0.03-30 Hz) and the keyboard is off
  n('vco1.freq', 'Initial frequency', 10, 10000, 261.63, 'Hz', 'log'),
  n('vco1.fine', 'Fine tune', -6, 6, 0, 'st'),
  n('vco1.pw', 'Pulse width', 0.1, 0.9, 0.5),
  c('vco1.range', 'Range', ['audio', 'lf'], 'audio'),
  s('vco1.fm.sh', 'FM S/H'),
  s('vco1.fm.adsr', 'FM ADSR'),
  s('vco1.fm.lfo', 'FM LFO'),

  n('vco2.freq', 'Initial frequency', 10, 10000, 261.63, 'Hz', 'log'),
  n('vco2.fine', 'Fine tune', -6, 6, 0, 'st'),
  n('vco2.pw', 'Pulse width', 0.1, 0.9, 0.5),
  c('vco2.range', 'Range', ['audio', 'lf'], 'audio'),
  t('vco2.sync', 'Sync to VCO 1'),
  s('vco2.fm.sh', 'FM S/H'),
  s('vco2.fm.adsr', 'FM ADSR'),
  s('vco2.fm.vco1', 'FM VCO 1'),
  s('vco2.pwm', 'PWM noise'),

  n('vco3.freq', 'Initial frequency', 10, 10000, 261.63, 'Hz', 'log'),
  n('vco3.fine', 'Fine tune', -6, 6, 0, 'st'),
  n('vco3.pw', 'Pulse width', 0.1, 0.9, 0.5),
  c('vco3.range', 'Range', ['audio', 'lf'], 'audio'),
  t('vco3.sync', 'Sync to VCO 1'),
  s('vco3.fm.noise', 'FM noise'),
  s('vco3.fm.adsr', 'FM ADSR'),
  s('vco3.fm.vco2', 'FM VCO 2'),
  s('vco3.pwm', 'PWM ADSR'),

  // ---- VCF: 4012 (ladder, loses bass as resonance rises, grittier) or 4072 (smoother four-pole, bass kept)
  n('vcf.freq', 'Initial frequency', 10, 16000, 1200, 'Hz', 'log'),
  n('vcf.fine', 'Fine tune', -1, 1, 0, 'oct'),
  s('vcf.res', 'Resonance', 0),
  c('vcf.mode', 'Mode', ['4012', '4072'], '4072'),
  s('vcf.in.ring', 'Audio ring mod'),
  s('vcf.in.vco1', 'Audio VCO 1', 0.8),
  s('vcf.in.vco2', 'Audio VCO 2'),
  s('vcf.in.vco3', 'Audio VCO 3'),
  s('vcf.in.noise', 'Audio noise'),
  s('vcf.cv.kybd', 'Control keyboard', 1),
  s('vcf.cv.adsr', 'Control ADSR', 0.3),
  s('vcf.cv.vco2', 'Control VCO 2'),

  // ---- SEM: a 12 dB state-variable filter, mode sweeps LP > notch > HP, BP replaces it with band-pass.
  // route off: a stock 2600; series: the VCF's output feeds the SEM and the SEM's output takes the VCF's place
  // at the VCA and mixer; parallel: the SEM hears only its own sliders and reaches the VCA on its own slider.
  n('sem.freq', 'Frequency', 10, 16000, 16000, 'Hz', 'log'),
  s('sem.res', 'Resonance', 0),
  s('sem.mode', 'LP / notch / HP', 0),
  t('sem.bp', 'Band pass'),
  c('sem.route', 'Route', ['off', 'series', 'parallel'], 'series'),
  s('sem.in.vco1', 'Audio VCO 1'),
  s('sem.in.vco2', 'Audio VCO 2'),
  s('sem.in.vco3', 'Audio VCO 3'),
  s('sem.in.noise', 'Audio noise'),
  s('sem.cv.kybd', 'Control keyboard', 1),
  s('sem.cv.adsr', 'Control ADSR'),
  s('sem.cv.lfo', 'Control LFO'),

  // ---- envelopes
  n('adsr.attack', 'Attack', 0.001, 10, 0.005, 's', 'log'),
  n('adsr.decay', 'Decay', 0.002, 10, 0.4, 's', 'log'),
  s('adsr.sustain', 'Sustain', 0.6),
  n('adsr.release', 'Release', 0.002, 10, 0.3, 's', 'log'),
  c('adsr.factor', 'Time factor', ['x0.5', 'x1', 'x2'], 'x1'),
  n('ar.attack', 'Attack', 0.001, 10, 0.005, 's', 'log'),
  n('ar.release', 'Release', 0.002, 10, 0.3, 's', 'log'),
  c('ar.factor', 'Time factor', ['x0.5', 'x1', 'x2'], 'x1'),
  /** What gates the AR: the keyboard gate or the sample-and-hold clock. */
  c('ar.source', 'AR gate', ['kybd', 'sh'], 'kybd'),

  // ---- VCA: AR in on a linear CV input, ADSR on an exponential one
  s('vca.gain', 'Initial gain', 0),
  s('vca.in.vcf', 'Audio VCF', 0.8),
  s('vca.in.sem', 'Audio SEM'),
  s('vca.in.ring', 'Audio ring mod'),
  s('vca.cv.ar', 'Control AR (lin)'),
  s('vca.cv.adsr', 'Control ADSR (exp)', 1),

  // ---- voltage processors: 2 attenuates -10 V, 4 the keyboard CV, 6 +10 V; 7 sets the lag time
  s('vp.2', 'Processor 2 (-10 V)'),
  s('vp.4', 'Processor 4 (KYBD CV)'),
  s('vp.6', 'Processor 6 (+10 V)'),
  s('vp.lag', 'Lag time', 0.3),

  // ---- sample-and-hold: input normalled to noise; its internal clock also drives the electronic switch
  s('sh.level', 'S/H input level', 1),
  n('sh.rate', 'S/H clock rate', 0.1, 50, 6, 'Hz', 'log'),

  // ---- output: mixer (VCF and VCA), spring reverb (left and right levels), pan and volume
  s('mix.vcf', 'Mixer VCF'),
  s('mix.vca', 'Mixer VCA', 0.8),
  s('reverb.left', 'Reverb left', 0.15),
  s('reverb.right', 'Reverb right', 0.15),
  n('mix.pan', 'Pan', -1, 1, 0),
  s('out.volume', 'Volume', 0.8),
];

/** The synth's controls, then the MOA-SQ16 sequencer's (mounted under it, in the same worklet). */
export const M2600_PARAMS: readonly M2600Param[] = [...SYNTH_PARAMS, ...SQ16_PARAMS];

/** Performance params set by the device, not controls: pitch bend in semitones and the mod wheel (adds vibrato). */
export const M2600_PERFORMANCE: readonly M2600Param[] = [n('bend', 'Bend', -2, 2, 0, 'st'), s('modw', 'Mod wheel')];

/** Params that are switch positions (choices and toggles): they jump rather than glide. */
export const M2600_SWITCHES: ReadonlySet<string> = new Set(M2600_PARAMS.filter((p) => p.kind !== 'number').map((p) => p.id));

/**
 * The jacks. Outputs are signals every module writes each sample; inputs say where they listen when no cord is
 * patched (`normal`, an output id, or a constant such as '-10V'), and which slider attenuates them, if any.
 * Phase 2 patch cords override `normal`. Inputs left without a normal hear nothing until patched.
 */
export const M2600_OUTPUTS = [
  'kb.cv', 'kb.upper', 'kb.gate', 'kb.trig', 'lfo.tri', 'lfo.square', 'lfo.delayed',
  'pre.out', 'envf.out', 'ring.out', 'noise.out',
  'vco1.saw', 'vco1.pulse', 'vco2.tri', 'vco2.saw', 'vco2.sine', 'vco2.pulse', 'vco3.tri', 'vco3.saw', 'vco3.sine', 'vco3.pulse',
  'vcf.out', 'sem.out', 'adsr.out', 'ar.out', 'vca.out', 'mix.out', 'reverb.out',
  'vp.inv1', 'vp.inv2', 'vp.lag', 'sh.out', 'sh.clk', 'esw.c',
  ...SQ16_OUTPUTS,
] as const;
export type M2600Output = (typeof M2600_OUTPUTS)[number];

export interface M2600Input {
  id: string;
  normal?: M2600Output | '-10V' | '+10V';
  /** The attenuator slider (a param id) this input passes through. */
  slider?: string;
}

export const M2600_INPUTS: readonly M2600Input[] = [
  { id: 'kb.extvib' },
  { id: 'pre.in' }, { id: 'envf.in', normal: 'pre.out', slider: 'envf.gain' },
  { id: 'ring.a', normal: 'vco1.saw', slider: 'ring.a' }, { id: 'ring.b', normal: 'vco2.tri', slider: 'ring.b' },
  // keyboard CV into the VCOs is unattenuated; in duo mode VCO 2 and 3 take the upper voice
  { id: 'vco1.fm.kybd', normal: 'kb.cv' }, { id: 'vco1.fm.sh', normal: 'sh.out', slider: 'vco1.fm.sh' },
  { id: 'vco1.fm.adsr', normal: 'adsr.out', slider: 'vco1.fm.adsr' }, { id: 'vco1.fm.lfo', normal: 'lfo.tri', slider: 'vco1.fm.lfo' },
  { id: 'vco2.fm.kybd', normal: 'kb.upper' }, { id: 'vco2.fm.sh', normal: 'sh.out', slider: 'vco2.fm.sh' },
  { id: 'vco2.fm.adsr', normal: 'adsr.out', slider: 'vco2.fm.adsr' }, { id: 'vco2.fm.vco1', normal: 'vco1.pulse', slider: 'vco2.fm.vco1' },
  { id: 'vco2.pwm', normal: 'noise.out', slider: 'vco2.pwm' },
  { id: 'vco3.fm.kybd', normal: 'kb.upper' }, { id: 'vco3.fm.noise', normal: 'noise.out', slider: 'vco3.fm.noise' },
  { id: 'vco3.fm.adsr', normal: 'adsr.out', slider: 'vco3.fm.adsr' }, { id: 'vco3.fm.vco2', normal: 'vco2.sine', slider: 'vco3.fm.vco2' },
  { id: 'vco3.pwm', normal: 'adsr.out', slider: 'vco3.pwm' },
  { id: 'vcf.in.ring', normal: 'ring.out', slider: 'vcf.in.ring' }, { id: 'vcf.in.vco1', normal: 'vco1.pulse', slider: 'vcf.in.vco1' },
  { id: 'vcf.in.vco2', normal: 'vco2.pulse', slider: 'vcf.in.vco2' }, { id: 'vcf.in.vco3', normal: 'vco3.saw', slider: 'vcf.in.vco3' },
  { id: 'vcf.in.noise', normal: 'noise.out', slider: 'vcf.in.noise' },
  { id: 'vcf.cv.kybd', normal: 'kb.cv', slider: 'vcf.cv.kybd' }, { id: 'vcf.cv.adsr', normal: 'adsr.out', slider: 'vcf.cv.adsr' },
  { id: 'vcf.cv.vco2', normal: 'vco2.sine', slider: 'vcf.cv.vco2' },
  { id: 'sem.in.vco1', normal: 'vco1.saw', slider: 'sem.in.vco1' }, { id: 'sem.in.vco2', normal: 'vco2.saw', slider: 'sem.in.vco2' },
  { id: 'sem.in.vco3', normal: 'vco3.pulse', slider: 'sem.in.vco3' }, { id: 'sem.in.noise', normal: 'noise.out', slider: 'sem.in.noise' },
  { id: 'sem.cv.kybd', normal: 'kb.cv', slider: 'sem.cv.kybd' }, { id: 'sem.cv.adsr', normal: 'adsr.out', slider: 'sem.cv.adsr' },
  { id: 'sem.cv.lfo', normal: 'lfo.tri', slider: 'sem.cv.lfo' },
  { id: 'adsr.gate', normal: 'kb.gate' }, { id: 'adsr.trig', normal: 'kb.trig' },
  // the AR's gate follows the ar.source switch (keyboard gate or S/H clock) unless patched
  { id: 'ar.gate', normal: 'kb.gate' },
  // with the SEM in series, vca.in.vcf and mix.in.vcf hear the SEM's output instead of the VCF's
  { id: 'vca.in.vcf', normal: 'vcf.out', slider: 'vca.in.vcf' }, { id: 'vca.in.sem', normal: 'sem.out', slider: 'vca.in.sem' },
  { id: 'vca.in.ring', normal: 'ring.out', slider: 'vca.in.ring' },
  { id: 'vca.cv.ar', normal: 'ar.out', slider: 'vca.cv.ar' }, { id: 'vca.cv.adsr', normal: 'adsr.out', slider: 'vca.cv.adsr' },
  { id: 'mix.in.vcf', normal: 'vcf.out', slider: 'mix.vcf' }, { id: 'mix.in.vca', normal: 'vca.out', slider: 'mix.vca' },
  { id: 'vp.1' }, { id: 'vp.2', normal: '-10V', slider: 'vp.2' }, { id: 'vp.3' }, { id: 'vp.4', normal: 'kb.cv', slider: 'vp.4' },
  { id: 'vp.5' }, { id: 'vp.6', normal: '+10V', slider: 'vp.6' }, { id: 'vp.7', normal: 'envf.out' },
  { id: 'sh.in', normal: 'noise.out', slider: 'sh.level' }, { id: 'sh.extclk' },
  { id: 'esw.a' }, { id: 'esw.b' },
  { id: 'out.left' }, { id: 'out.right' },
  ...SQ16_INPUTS,
];

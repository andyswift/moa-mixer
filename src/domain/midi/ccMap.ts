import type { Control } from '../devices/controls';

/**
 * Default CC assignments for the synth. A Torso T-1 CC track is reported to send CC 70-83 (unverified:
 * check the MIDI monitor), so the synth's most playable controls are assigned in that range.
 */
export const DEFAULT_CC_MAP: ReadonlyMap<number, string> = new Map([
  [70, 'filter.cutoff'],
  [71, 'filter.resonance'],
  [72, 'filterEnv.amount'],
  [73, 'filterEnv.decay'],
  [74, 'ampEnv.decay'],
  [75, 'ampEnv.release'],
  [76, 'osc.width'],
  [77, 'osc.pwm'],
  [78, 'mix.pulse'],
  [79, 'mix.sub'],
  [80, 'mix.noise'],
  [81, 'lfo.rate'],
  [82, 'osc.mod'],
  [83, 'perf.glide'],
]);

/** Applies a 0-127 controller value to a control, honouring log curves; choices step through their options. */
export function applyCcValue(control: Control, value: number): void {
  const t = Math.min(127, Math.max(0, value)) / 127;
  if (control.kind === 'number') {
    control.set(control.curve === 'log' ? control.min * Math.pow(control.max / control.min, t) : control.min + t * (control.max - control.min));
  } else if (control.kind === 'choice') {
    const index = Math.min(control.options.length - 1, Math.floor(t * control.options.length));
    control.set(control.options[index]!);
  } else {
    control.set(value >= 64);
  }
}

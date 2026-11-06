import type { Control } from '../devices/controls';

/** How close a control is to the lesson's target: 1 is a match, 0 is nowhere near. */
export interface ControlScore {
  readonly id: string;
  readonly match: number;
  /** Which way the player has to move the control; 'ok' within tolerance. */
  readonly direction: 'ok' | 'low' | 'high';
}

/** A control's place along its travel, 0..1, the way a knob or slider shows it (log controls on a log scale). */
export function position(control: Control, value: number | string = control.value as number | string): number {
  if (control.kind === 'number') {
    const v = Math.min(control.max, Math.max(control.min, value as number));
    if (control.curve === 'log') return Math.log(v / control.min) / Math.log(control.max / control.min);
    return (v - control.min) / (control.max - control.min);
  }
  if (control.kind === 'choice') {
    const i = control.options.indexOf(value as string);
    return control.options.length > 1 ? Math.max(0, i) / (control.options.length - 1) : 0;
  }
  return 0;
}

/**
 * Scores one control against its target. Distance is measured along the control's travel (so a filter or an envelope
 * time compares by ratio, as the ear hears it): within `tolerance` of the travel it is a match; beyond that the score
 * falls away and reaches 0 at four tolerances. A switch (a choice) either matches or it doesn't.
 */
export function scoreControl(control: Control, target: number | string, tolerance: number): ControlScore {
  if (control.kind === 'choice') {
    const i = control.options.indexOf(control.value);
    const t = control.options.indexOf(target as string);
    return { id: control.id, match: i === t ? 1 : 0, direction: i === t ? 'ok' : i < t ? 'low' : 'high' };
  }
  if (control.kind !== 'number') return { id: control.id, match: 1, direction: 'ok' };
  const here = position(control);
  const there = position(control, target);
  const distance = Math.abs(here - there);
  const match = distance <= tolerance ? 1 : Math.max(0, 1 - (distance - tolerance) / (3 * tolerance));
  return { id: control.id, match, direction: distance <= tolerance ? 'ok' : here < there ? 'low' : 'high' };
}

/** The lesson's score: the mean of its controls' matches, 0..1. */
export function overall(scores: readonly ControlScore[]): number {
  return scores.length ? scores.reduce((sum, s) => sum + s.match, 0) / scores.length : 1;
}

/** A lesson is passed at this overall score. */
export const PASS_MARK = 0.8;

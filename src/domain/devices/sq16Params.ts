import type { M2600Input, M2600Param } from './m2600Params';

/**
 * MOA-SQ16: a 16-step analogue-style sequencer in the mould of the ARP sequencer made for the 2600 (and the Korg
 * SQ-1), mounted under the MOA-2600 and patched into it with cords. Its params, outputs and inputs join the 2600's
 * table (ids start with "sq."), so the same worklet runs it, sample-locked to the synth.
 *
 * Voltages: the raw outputs A and B are the step slider times 10 V. The quantizers turn their input (0-10 V) into
 * notes over `sq.range` octaves, snapped to `sq.scale`, at 1 V per octave, then add the CV input (so the keyboard CV
 * patched there transposes the sequence). Gate bus outputs are 10 V for the whole of a step assigned to them;
 * clocked gate 1 is bus 1 AND the clock (high for the pulse width), so repeated notes retrigger.
 */

export const SQ16_STEPS = 16;
export const SQ16_SCALES = ['chrom', 'major', 'minor', 'pent', 'dorian', 'blues'] as const;
/** Semitones of each scale within the octave. */
export const SQ16_SCALE_NOTES: Record<(typeof SQ16_SCALES)[number], readonly number[]> = {
  chrom: [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11],
  major: [0, 2, 4, 5, 7, 9, 11],
  minor: [0, 2, 3, 5, 7, 8, 10],
  pent: [0, 3, 5, 7, 10],
  dorian: [0, 2, 3, 5, 7, 9, 10],
  blues: [0, 3, 5, 6, 7, 10],
};
/** MIDI clock divisions: pulses (at 24 per quarter note) per step. */
export const SQ16_DIVS = { '1/4': 24, '1/8': 12, '1/8T': 8, '1/16': 6, '1/16T': 4 } as const;

const n = (id: string, label: string, min: number, max: number, def: number, unit = '', curve: 'linear' | 'log' = 'linear'): M2600Param =>
  ({ id, label, kind: 'number', min, max, def, unit, curve });
const c = (id: string, label: string, options: readonly string[], def: string): M2600Param =>
  ({ id, label, kind: 'choice', min: 0, max: options.length - 1, def: options.indexOf(def), options });

/** A gentle default line, so a fresh sequencer patched in plays something. */
const START = [0.2, 0.35, 0.5, 0.35, 0.2, 0.6, 0.5, 0.35, 0.2, 0.35, 0.5, 0.7, 0.6, 0.5, 0.35, 0.2];

export const SQ16_PARAMS: readonly M2600Param[] = [
  ...Array.from({ length: SQ16_STEPS }, (_, i) => n(`sq.step.${i + 1}`, `Step ${i + 1}`, 0, 1, START[i]!)),
  /** Which gate bus a step fires; a step on bus 3 also skips or resets, per `sq.skip`. */
  ...Array.from({ length: SQ16_STEPS }, (_, i) => c(`sq.gate.${i + 1}`, `Step ${i + 1} gate`, ['off', '1', '2', '3'], '1')),
  /** 16 steps on A (B follows A), or 8 steps with steps 1-8 on A and 9-16 on B at the same time. */
  c('sq.mode', 'Steps', ['16', '8x2'], '16'),
  c('sq.dir', 'Direction', ['fwd', 'rev', 'pingpong', 'random'], 'fwd'),
  c('sq.skip', 'Bus 3 does', ['skip', 'off', 'reset'], 'off'),
  /** How the start/stop jack acts: trig toggles on each rising edge; gate runs while it is high. */
  c('sq.trig', 'Start/stop input', ['trig', 'gate'], 'trig'),
  n('sq.rate', 'Clock frequency', 0.2, 40, 6, 'Hz', 'log'),
  n('sq.fm', 'Clock FM', 0, 1, 0),
  n('sq.pw', 'Pulse width', 0.05, 0.95, 0.5),
  c('sq.scale', 'Quantizer scale', SQ16_SCALES, 'chrom'),
  c('sq.range', 'Quantizer range', ['1', '2', '4'], '2'),
  /** int: its own clock (or the clock input); midi: steps on MIDI clock at `sq.div`, following MIDI start and stop. */
  c('sq.sync', 'Clock source', ['int', 'midi'], 'int'),
  c('sq.div', 'MIDI division', Object.keys(SQ16_DIVS), '1/16'),
];

export const SQ16_OUTPUTS = [
  'sq.a', 'sq.b', 'sq.qa', 'sq.qb', 'sq.bus1', 'sq.bus2', 'sq.bus3', 'sq.pos1', 'sq.cgate1', 'sq.clk',
] as const;

export const SQ16_INPUTS: readonly M2600Input[] = [
  { id: 'sq.cvin' },
  { id: 'sq.ina', normal: 'sq.a' }, { id: 'sq.inb', normal: 'sq.b' },
  { id: 'sq.start' }, { id: 'sq.stop' }, { id: 'sq.startstop' },
  { id: 'sq.stepin' }, { id: 'sq.resetin' },
  { id: 'sq.fmin', slider: 'sq.fm' }, { id: 'sq.pwm' }, { id: 'sq.extclk' },
];

/**
 * Messages the page sends the worklet: `{ type: 'sq', action }` with action 'run', 'stop', 'toggle', 'step' (advance
 * one), 'reset' (the next clock plays the first step) or 'jump' (with `index`, 0-15); `{ type: 'sqtick' }` advances
 * one step when the clock source is MIDI (the page counts the MIDI clock). The worklet reports `sq: { step, running, clk }`.
 */
export type SQ16Message =
  | { type: 'sq'; action: 'run' | 'stop' | 'toggle' | 'step' | 'reset' }
  | { type: 'sq'; action: 'jump'; index: number }
  | { type: 'sqtick' };

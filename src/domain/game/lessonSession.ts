import type { Control } from '../devices/controls';
import { applyCcValue } from '../midi/ccMap';
import { INIT, type PresetValues } from '../devices/synthPresets';
import type { Lesson } from './lessons';
import { overall, PASS_MARK, scoreControl, type ControlScore } from './scoring';

/** What a lesson needs from the synth: its controls by id. */
export interface ControlSource {
  control(id: string): Control;
}

/**
 * One go at a lesson. Loads the lesson's starting panel, lets knob n turn the lesson's control n (and nothing else),
 * scores the sound against the target, swaps the target in for "Hear the target" and back, and follows the riff the
 * player plays once the sound matches.
 */
export class LessonSession {
  /** How many times the player has checked; from REVEAL_AFTER on, the panel shows where the target sits. */
  checks = 0;
  private riffAt = 0;
  private yours?: PresetValues;

  /** `base` is the whole panel before the lesson's start goes on top: the SOLO-1's INIT unless the instrument has its own. */
  constructor(private readonly synth: ControlSource, readonly lesson: Lesson, base: PresetValues = INIT) {
    apply(synth, { ...base, ...lesson.start });
  }

  /** The lesson's controls, knob 1 first. */
  get controls(): Control[] {
    return this.lesson.controls.map((c) => this.synth.control(c.id));
  }

  /** Knob `index` (0-based) moved to a 0-127 value. Returns the control it turned, if any. */
  turnKnob(index: number, value: number): Control | undefined {
    const spec = this.lesson.controls[index];
    if (!spec || this.yours) return undefined; // no knob work while the target is playing
    const control = this.synth.control(spec.id);
    applyCcValue(control, value);
    return control;
  }

  scores(): ControlScore[] {
    return this.lesson.controls.map((c) => scoreControl(this.synth.control(c.id), this.lesson.target[c.id]!, c.tolerance));
  }

  score(): number {
    return overall(this.scores());
  }

  /** A check: the scores, counted towards revealing the target. */
  check(): { scores: ControlScore[]; score: number; passed: boolean } {
    this.checks++;
    const scores = this.scores();
    const score = overall(scores);
    return { scores, score, passed: score >= PASS_MARK };
  }

  get revealed(): boolean {
    return this.checks >= REVEAL_AFTER;
  }

  /** Puts the target's values on the lesson controls, remembering the player's. */
  showTarget(): void {
    if (this.yours) return;
    this.yours = Object.fromEntries(this.lesson.controls.map((c) => [c.id, this.synth.control(c.id).value as number | string]));
    apply(this.synth, this.lesson.target);
  }

  /** Puts the player's values back after `showTarget`. */
  showYours(): void {
    if (!this.yours) return;
    apply(this.synth, this.yours);
    this.yours = undefined;
  }

  get playingTarget(): boolean {
    return this.yours !== undefined;
  }

  /** How many notes of the riff are done. */
  get riffProgress(): number {
    return this.riffAt;
  }

  get riffDone(): boolean {
    return this.riffAt >= this.lesson.riff.length;
  }

  /** A key played during the riff: the right one moves it on; a wrong one is ignored. Returns whether it was right. */
  playRiffNote(note: number): boolean {
    if (this.riffDone || this.lesson.riff[this.riffAt] !== note) return false;
    this.riffAt++;
    return true;
  }
}

/** The target's place shows on the panel after this many checks. */
export const REVEAL_AFTER = 2;

/** Sets each listed control to its value. */
export function apply(synth: ControlSource, values: PresetValues): void {
  for (const [id, value] of Object.entries(values)) {
    const c = synth.control(id);
    if (c.kind === 'number' && typeof value === 'number') c.set(value);
    else if (c.kind === 'choice' && typeof value === 'string') c.set(value);
    else throw new Error(`Lesson: bad value for ${id}`);
  }
}

/** A device's controls as they stand (numbers and switches), to use as a lesson's base: take it from a fresh device. */
export function defaultsOf(device: { readonly controls: readonly Control[] }): PresetValues {
  const values: PresetValues = {};
  for (const c of device.controls) if (c.kind === 'number' || c.kind === 'choice') values[c.id] = c.value;
  return values;
}

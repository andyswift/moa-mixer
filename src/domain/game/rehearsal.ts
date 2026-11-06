import type { Cue } from './performance';

/**
 * Learning a song at the player's own pace: a section's cues as steps, the next one waiting until it is played.
 * Repeats in a row become one step with a count (a bass playing C four times in a bar is one thing to learn).
 */
export interface Step {
  readonly notes: readonly number[];
  readonly pcs: readonly number[];
  /** How many times in a row it comes. */
  readonly count: number;
  /** Beat of its first time. */
  readonly t: number;
}

const samePcs = (a: readonly number[], b: readonly number[]) => a.length === b.length && a.every((x, i) => x === b[i]);

/** The steps for the cues starting in [from, to) beats. */
export function stepsOf(cues: readonly Cue[], from: number, to: number): Step[] {
  const steps: Step[] = [];
  for (const c of cues) {
    if (c.t < from || c.t >= to) continue;
    const last = steps[steps.length - 1];
    if (last && samePcs(last.pcs, c.pcs)) steps[steps.length - 1] = { ...last, count: last.count + 1 };
    else steps.push({ notes: c.notes, pcs: c.pcs, count: 1, t: c.t });
  }
  return steps;
}

/**
 * One section learned step by step. A single note is judged on each key; a chord once as many keys are down as it
 * has notes, once per attempt. A right step moves on only when every key is up, so the next one never shows while
 * the last is still held.
 */
export class StepSession {
  private held = new Set<number>();
  private at = 0;
  private judged = false;
  private rightAndHeld = false;
  /** Wrong attempts so far: shown, never scored. */
  wrong = 0;

  constructor(readonly steps: readonly Step[]) {}

  get index(): number {
    return this.at;
  }

  get step(): Step | undefined {
    return this.steps[this.at];
  }

  /** The current step is played right and still held. */
  get answered(): boolean {
    return this.rightAndHeld;
  }

  get done(): boolean {
    return this.at >= this.steps.length;
  }

  keyDown(key: number): 'right' | 'wrong' | undefined {
    this.held.add(key);
    const s = this.step;
    if (!s || this.rightAndHeld || this.judged) return undefined;
    if (s.pcs.length === 1) return this.judge(key % 12 === s.pcs[0]);
    if (this.held.size < s.pcs.length) return undefined;
    const played = [...new Set([...this.held].map((n) => n % 12))].sort((a, b) => a - b);
    this.judged = true;
    return this.judge(samePcs(played, s.pcs));
  }

  /** Returns true when the key coming up moved on to the next step. */
  keyUp(key: number): boolean {
    this.held.delete(key);
    if (this.held.size) return false;
    this.judged = false;
    if (!this.rightAndHeld) return false;
    this.rightAndHeld = false;
    this.at++;
    return true;
  }

  private judge(right: boolean): 'right' | 'wrong' {
    if (right) this.rightAndHeld = true;
    else this.wrong++;
    return right ? 'right' : 'wrong';
  }
}

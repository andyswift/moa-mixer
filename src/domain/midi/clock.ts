import type { MidiEvent } from './events';

const PPQN = 24; // MIDI clock pulses per quarter note
const WINDOW = 48; // pulses averaged for the tempo estimate (two beats)
const MIN_PULSES = 12;
const GAP_RESET_MS = 1000; // a longer gap means the clock stopped; start estimating afresh
const LOCK_TIMEOUT_MS = 500;

export interface Position {
  bar: number;
  beat: number;
  sixteenth: number;
}

/**
 * Follows an incoming MIDI clock: estimates tempo from pulse spacing (a trimmed mean, so timestamp
 * jitter doesn't make the BPM wobble), tracks start/stop, and counts pulses for the song position.
 */
export class MidiClock {
  private intervals: number[] = [];
  private last?: number;
  private isRunning = false;
  private pulses = 0;

  get running(): boolean {
    return this.isRunning;
  }

  /** Pulses since the last start. */
  get ticks(): number {
    return this.pulses;
  }

  /** Estimated tempo, or undefined until enough pulses have arrived. */
  get bpm(): number | undefined {
    if (this.intervals.length < MIN_PULSES) return undefined;
    const sorted = [...this.intervals].sort((a, b) => a - b);
    const trim = Math.floor(sorted.length / 4);
    const middle = sorted.slice(trim, sorted.length - trim);
    const mean = middle.reduce((a, b) => a + b, 0) / middle.length;
    return 60000 / (mean * PPQN);
  }

  /** True while pulses are arriving steadily. `now` is a performance.now() time in ms. */
  isLocked(now: number): boolean {
    return this.last !== undefined && this.intervals.length >= MIN_PULSES && now - this.last < LOCK_TIMEOUT_MS;
  }

  get position(): Position {
    return positionFromTicks(this.pulses);
  }

  handle(event: MidiEvent, now: number): void {
    switch (event.type) {
      case 'clock':
        if (this.last !== undefined) {
          const gap = now - this.last;
          if (gap > GAP_RESET_MS) this.intervals = [];
          else this.intervals.push(gap);
          if (this.intervals.length > WINDOW) this.intervals.shift();
        }
        this.last = now;
        if (this.isRunning) this.pulses++;
        break;
      case 'start':
        this.isRunning = true;
        this.pulses = 0;
        break;
      case 'continue':
        this.isRunning = true;
        break;
      case 'stop':
        this.isRunning = false;
        break;
    }
  }
}

/** 4/4: 24 pulses per beat, 4 beats per bar, shown as bar : beat : sixteenth (all from 1). */
export function positionFromTicks(ticks: number): Position {
  return {
    bar: Math.floor(ticks / (PPQN * 4)) + 1,
    beat: Math.floor(ticks / PPQN) % 4 + 1,
    sixteenth: Math.floor(ticks / (PPQN / 4)) % 4 + 1,
  };
}

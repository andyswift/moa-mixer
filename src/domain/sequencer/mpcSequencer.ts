/**
 * The MOA-60's sequencer, after the MPC60's: sequences of 1 to 16 bars at 96 ticks a beat, recorded in real time
 * from the pads (overdubbing round the loop) with Timing Correct and swing, note repeat while a pad is held, and 16
 * sequences that change at the end of the loop, as the MPC60's do.
 *
 * Swing is Roger Linn's: the share of a pair of sixteenths (or eighths) that goes to the first. 50% is straight, 66%
 * a triplet feel, 75% a dotted sixteenth and a thirty-second. It moves every second grid step on the way in, so a
 * recorded sequence keeps its swing, and note repeat swings too.
 *
 * Time is the audio clock (seconds). `schedule(now)` is called every few milliseconds and plays everything due up to
 * `now + LOOKAHEAD` ahead of time, each hit at its exact time; with the MIDI clock as its source, tempo and position
 * follow the clock's pulses instead of its own tempo.
 */
export const PPQ = 96;
export const LOOKAHEAD = 0.12;
const CLOCK_TICKS = PPQ / 24; // ticks per MIDI clock pulse
const LOCK_GAIN = 0.25; // how much of the timing error to a clock pulse is taken out each pulse

export const TIMING = { 'off': 1, '1/32T': 8, '1/32': 12, '1/16T': 16, '1/16': 24, '1/8T': 32, '1/8': 48, '1/4': 96 } as const;
export type Timing = keyof typeof TIMING;
export const SEQUENCES = 16;

export interface SeqEvent {
  tick: number;
  pad: number;
  /** 0..1 */
  velocity: number;
  /** Ticks the pad is held (for Note On pads). */
  length: number;
  /** The pad's settings changed for this hit (recorded from 16 Levels). */
  over?: HitOver;
}

export interface HitOver {
  tune?: number;
  decay?: number;
  mode?: 'oneshot' | 'noteon';
  cutoff?: number;
}

export interface Sequence {
  bars: number;
  events: SeqEvent[];
}

export const emptySequence = (bars = 2): Sequence => ({ bars, events: [] });

/** Where a tick lands after Timing Correct and swing (swing only on the straight eighth and sixteenth grids). */
export function correct(tick: number, timing: Timing, swing: number): number {
  const grid = TIMING[timing];
  if (grid === 1) return Math.round(tick);
  const step = Math.round(tick / grid);
  const swung = (grid === 24 || grid === 48) && step % 2 === 1;
  return step * grid + (swung ? Math.round(grid * ((2 * swing) / 100 - 1)) : 0);
}

export interface SequencerOutput {
  /** Plays a pad at an audio-clock time, held for `hold` seconds (`over` from 16 Levels). */
  play(pad: number, velocity: number, when: number, hold: number, over?: HitOver): void;
  /** The metronome: `accent` on the first beat of the bar. */
  click?(when: number, accent: boolean): void;
}

export class MpcSequencer {
  readonly sequences: Sequence[] = Array.from({ length: SEQUENCES }, () => emptySequence());
  current = 0;
  /** The sequence to change to at the end of this loop, if any. */
  next?: number;
  tempo = 90;
  swing = 50;
  timing: Timing = '1/16';
  metronome = true;
  countIn = true;
  /** Pads left out of the playback (track mutes, one per pad). */
  readonly muted = new Set<number>();
  /** 'internal' runs on its own tempo; 'midi' follows the MIDI clock. */
  sync: 'internal' | 'midi' = 'internal';
  private playing = false;
  private recording = false;
  private t0 = 0; // the audio time of tick 0
  private scheduled = 0; // ticks before this are played
  private loopStart = 0; // the tick the current pass of the loop began
  private countInTicks = 0;
  /** Pads held for note repeat: pad -> velocity and 16 Levels settings. */
  private readonly held = new Map<number, { velocity: number; over?: HitOver }>();
  /** Recorded presses waiting for their release: pad -> event. */
  private readonly open = new Map<number, SeqEvent>();
  private pulses = 0;
  /** Hits just recorded ahead of the playback: not played at that one tick (they sounded when pressed). */
  private readonly skip = new Map<SeqEvent, number>();
  private readonly listeners = new Set<() => void>();

  constructor(private readonly out: SequencerOutput) {}

  get sequence(): Sequence {
    return this.sequences[this.current]!;
  }
  get isPlaying(): boolean {
    return this.playing;
  }
  get isRecording(): boolean {
    return this.recording;
  }
  get loopTicks(): number {
    return this.sequence.bars * 4 * PPQ;
  }
  private get secondsPerTick(): number {
    return 60 / (this.tempo * PPQ);
  }

  /** The tick at an audio time (unbounded; before 0 during a count-in). */
  tickAt(time: number): number {
    return (time - this.t0) / this.secondsPerTick;
  }
  timeAt(tick: number): number {
    return this.t0 + tick * this.secondsPerTick;
  }

  /** Where the loop is now: tick within the sequence (negative during a count-in). */
  position(now: number): number {
    if (!this.playing) return 0;
    const t = this.tickAt(now);
    return t < 0 ? t : t - this.loopStart;
  }

  /** Starts playing from the top at `now` (with `record`, overdubbing, after a bar's count-in if that is on). */
  play(now: number, record = false): void {
    this.recording = record;
    this.countInTicks = record && this.countIn ? 4 * PPQ : 0;
    this.t0 = now + this.countInTicks * this.secondsPerTick + 0.05;
    this.scheduled = 0 - this.countInTicks; // (not -0)
    this.loopStart = 0;
    this.playing = true;
    this.notify();
  }

  /** Recording on or off while playing (punching in and out). */
  setRecording(on: boolean): void {
    this.recording = on;
    this.notify();
  }

  stop(): void {
    this.playing = false;
    this.recording = false;
    this.open.clear();
    this.held.clear();
    this.skip.clear();
    this.notify();
  }

  /** Changes tempo without a jump: the tick playing now stays where it is. */
  setTempo(bpm: number, now: number): void {
    const tick = this.tickAt(now);
    this.tempo = Math.min(300, Math.max(30, bpm));
    this.t0 = now - tick * this.secondsPerTick;
  }

  /** Chooses a sequence: at once when stopped, at the end of the loop when playing. */
  select(i: number): void {
    if (this.playing) this.next = i;
    else this.current = i;
    this.notify();
  }

  /** Plays everything due before `now + LOOKAHEAD`. */
  schedule(now: number): void {
    if (!this.playing) return;
    const until = Math.ceil(this.tickAt(now + LOOKAHEAD));
    if (until <= this.scheduled) return;
    for (let t = this.scheduled; t < until; t++) this.tick(t);
    this.scheduled = until;
  }

  private tick(t: number): void {
    const when = this.timeAt(t);
    if (t % PPQ === 0 && this.metronome && (this.recording || t < 0)) this.out.click?.(when, ((t - (t < 0 ? -this.countInTicks : this.loopStart)) / PPQ) % 4 === 0);
    if (t < 0) return;
    let pos = t - this.loopStart;
    if (pos >= this.loopTicks) {
      this.loopStart = t;
      pos = 0;
      if (this.next !== undefined) {
        this.current = this.next;
        this.next = undefined;
        this.open.clear();
        this.notify();
      }
    }
    for (const e of this.sequence.events) {
      if (e.tick !== pos || this.muted.has(e.pad)) continue;
      if (this.skip.get(e) === t) { this.skip.delete(e); continue; }
      this.out.play(e.pad, e.velocity, when, Math.max(1, e.length) * this.secondsPerTick, e.over);
    }
    // note repeat: the held pads on the Timing Correct grid, swung
    if (this.held.size) {
      const timing = this.timing === 'off' ? '1/16' : this.timing, grid = TIMING[timing];
      const step = Math.floor(pos / grid);
      if ([step - 1, step, step + 1].some((k) => correct(k * grid, timing, this.swing) === pos)) {
        for (const [pad, { velocity, over }] of this.held) {
          this.out.play(pad, velocity, when, (grid / 2) * this.secondsPerTick, over);
          if (this.recording) this.addEvent({ tick: pos, pad, velocity, length: grid / 2, ...(over ? { over } : {}) });
        }
      }
    }
  }

  /**
   * A pad pressed at audio time `time` (it has already sounded): recorded, if recording, at its corrected place in
   * the loop. With `repeat`, it is held for note repeat instead, and plays on the grid while held. `over` is what
   * 16 Levels changed for the hit.
   */
  press(pad: number, velocity: number, time: number, repeat = false, over?: HitOver): void {
    if (repeat && this.playing) {
      this.held.set(pad, { velocity, over });
      return;
    }
    if (!this.playing || !this.recording) return;
    const t = this.tickAt(time);
    if (t < 0) return; // in the count-in
    const at = this.loopStart + correct(t - this.loopStart, this.timing, this.swing);
    const pos = ((at - this.loopStart) % this.loopTicks + this.loopTicks) % this.loopTicks;
    const e: SeqEvent = { tick: pos, pad, velocity, length: TIMING['1/16'], ...(over ? { over } : {}) };
    this.addEvent(e);
    this.open.set(pad, e);
    // the press has sounded already; if its corrected place is still ahead of the playback, it is not played again there
    if (at >= this.scheduled) this.skip.set(e, at);
  }

  /** The pad let go: ends its recorded event's length, and stops its note repeat. */
  release(pad: number, time: number): void {
    this.held.delete(pad);
    const e = this.open.get(pad);
    if (!e) return;
    this.open.delete(pad);
    const len = this.tickAt(time) - this.loopStart - e.tick;
    e.length = Math.max(1, Math.round(((len % this.loopTicks) + this.loopTicks) % this.loopTicks));
  }

  private addEvent(e: SeqEvent): void {
    // one event per pad per tick: a new one replaces the old
    this.sequence.events = this.sequence.events.filter((x) => !(x.tick === e.tick && x.pad === e.pad));
    this.sequence.events.push(e);
    this.sequence.events.sort((a, b) => a.tick - b.tick || a.pad - b.pad);
    this.notify();
  }

  /** Step edit: adds a hit on `pad` at `tick`, or takes it out if there is one. */
  toggleStep(pad: number, tick: number, velocity = 0.8): void {
    const had = this.sequence.events.some((e) => e.pad === pad && e.tick === tick);
    if (had) this.sequence.events = this.sequence.events.filter((e) => !(e.pad === pad && e.tick === tick));
    else this.addEvent({ tick, pad, velocity, length: TIMING['1/16'] });
    this.notify();
  }

  /** Erase: every hit of `pad` in this sequence. */
  erase(pad: number): void {
    this.sequence.events = this.sequence.events.filter((e) => e.pad !== pad);
    this.notify();
  }

  clear(): void {
    this.sequence.events = [];
    this.notify();
  }

  setBars(bars: number): void {
    this.sequence.bars = Math.min(16, Math.max(1, Math.round(bars)));
    this.sequence.events = this.sequence.events.filter((e) => e.tick < this.loopTicks);
    this.notify();
  }

  /** Re-places every hit in this sequence on the Timing Correct grid with the current swing. */
  quantise(): void {
    for (const e of this.sequence.events) e.tick = ((correct(e.tick, this.timing, this.swing) % this.loopTicks) + this.loopTicks) % this.loopTicks;
    this.sequence.events.sort((a, b) => a.tick - b.tick || a.pad - b.pad);
    this.notify();
  }

  /** MIDI start at audio time `now`: plays from the top, following the clock. */
  clockStart(now: number): void {
    if (this.sync !== 'midi') return;
    this.pulses = 0;
    this.t0 = now;
    this.scheduled = 0;
    this.loopStart = 0;
    this.countInTicks = 0;
    this.playing = true;
    this.notify();
  }

  clockStop(): void {
    if (this.sync === 'midi') this.stop();
  }

  /**
   * A MIDI clock pulse at audio time `now`, with the clock's tempo if known. The pulse says where the music is (a
   * pulse is 4 ticks); the timing follows it softly, so the jitter of the pulses does not shake the hits.
   */
  clockPulse(now: number, bpm?: number): void {
    if (this.sync !== 'midi' || !this.playing) return;
    this.pulses++;
    if (bpm) {
      const tick = this.tickAt(now);
      this.tempo = bpm;
      this.t0 = now - tick * this.secondsPerTick;
    }
    const error = this.tickAt(now) - this.pulses * CLOCK_TICKS; // ticks ahead of the clock
    this.t0 += error * LOCK_GAIN * this.secondsPerTick;
  }

  onChange(fn: () => void): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  private notify(): void {
    for (const l of [...this.listeners]) l();
  }
}

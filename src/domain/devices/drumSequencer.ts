import { ChoiceControl, NumberControl } from './controls';
import { DRUM_VOICES, type DrumMachine, type DrumVoice } from './drumMachine';
import type { MidiClock, Position } from '../midi/clock';
import { positionFromTicks } from '../midi/clock';
import type { MidiEvent } from '../midi/events';

export const STEPS = 16;
export const PATTERNS = ['A', 'B', 'C', 'D'] as const;
export type PatternName = (typeof PATTERNS)[number];

/** A step is 0 (off) or a velocity level 1-3: soft, medium, hard. */
export const STEP_VELOCITY = [0, 0.4, 0.7, 1] as const;
export const MAX_LEVEL = STEP_VELOCITY.length - 1;

export type Pattern = Record<DrumVoice, number[]>;

const PULSES_PER_STEP = 6; // 24 pulses per quarter note, 4 sixteenths per quarter
const LOOKAHEAD = 0.12; // seconds of audio scheduled ahead of the clock
const START_DELAY = 0.05;
const RESYNC_AFTER = 0.1; // if the scheduler falls this far behind (suspended tab), jump to now

const emptyPattern = (): Pattern =>
  Object.fromEntries(DRUM_VOICES.map((v) => [v, new Array<number>(STEPS).fill(0)])) as Pattern;

/** Builds a pattern from step lists; `level` picks a velocity per step (default: strong on the beat). */
function pattern(hits: Partial<Record<DrumVoice, number[]>>, level?: (voice: DrumVoice, step: number) => number): Pattern {
  const p = emptyPattern();
  for (const voice of DRUM_VOICES) {
    for (const step of hits[voice] ?? []) {
      p[voice][step] = level ? level(voice, step) : step % 4 === 0 ? 3 : step % 2 === 0 ? 2 : 1;
    }
  }
  return p;
}

function starterPatterns(): Pattern[] {
  return [
    pattern({
      kick: [0, 4, 8, 10, 12], snare: [4, 12], clap: [12],
      closedHat: [0, 2, 4, 6, 8, 10, 12], openHat: [14], ride: [3, 7, 11, 15],
    }),
    pattern({
      kick: [0, 4, 8, 12], clap: [4, 12], closedHat: [0, 4, 8, 12], openHat: [2, 6, 10, 14],
    }, (_v, s) => (s % 4 === 0 ? 3 : 2)),
    pattern({
      kick: [0, 6, 10], snare: [4, 7, 12, 15], closedHat: [0, 2, 4, 6, 8, 10, 12, 14],
    }, (v, s) => (v === 'snare' && (s === 7 || s === 15) ? 1 : s % 4 === 0 ? 3 : 2)),
    emptyPattern(),
  ];
}

/**
 * 16-step pattern sequencer for the drum machine: four patterns (A-D), velocity per step, swing.
 *
 * It runs one of two ways, per the drum machine's transport:
 * - Own clock (Internal sync, or synced with start/stop following off): `play()`/`stop()` and a
 *   look-ahead scheduler, `tick()`, which the app calls every few milliseconds. Tempo is the transport's.
 * - Following MIDI (synced with start/stop following on): it starts, stops and steps with the incoming
 *   clock, one step per 6 pulses.
 * Hits are scheduled on the audio clock (`now()`), so timing doesn't depend on UI timers.
 */
export class DrumSequencer {
  private readonly listeners = new Set<() => void>(); // before `pattern`: its constructor notifies
  readonly pattern = new ChoiceControl('seq.pattern', 'Pattern', PATTERNS, 'A', () => this.notify());
  readonly swing = new NumberControl('seq.swing', 'Swing', 50, 75, 54, '%', () => {});
  private readonly patterns = starterPatterns();
  private playing = false;
  private nextStep = 0;
  private nextTime = 0;
  private counter = 0; // steps scheduled since the run began (for position display)
  private played: { step: number; counter: number; time: number }[] = [];

  constructor(
    private readonly drums: DrumMachine,
    private readonly clock: MidiClock,
    private readonly now: () => number,
  ) {}

  /** True when the sequencer follows incoming MIDI start/stop/clock rather than its own transport. */
  get externallyDriven(): boolean {
    return this.drums.transport.synced && this.drums.transport.followStartStop.value;
  }

  get running(): boolean {
    return this.externallyDriven ? this.clock.running : this.playing;
  }

  get activePattern(): Pattern {
    return this.patterns[PATTERNS.indexOf(this.pattern.value as PatternName)]!;
  }

  level(voice: DrumVoice, step: number): number {
    return this.activePattern[voice][step]!;
  }

  setLevel(voice: DrumVoice, step: number, level: number): void {
    this.activePattern[voice][step] = Math.min(MAX_LEVEL, Math.max(0, Math.round(level)));
    this.notify();
  }

  /** Off -> soft -> medium -> hard -> off. */
  cycle(voice: DrumVoice, step: number): void {
    this.setLevel(voice, step, (this.level(voice, step) + 1) % (MAX_LEVEL + 1));
  }

  clearPattern(): void {
    for (const voice of DRUM_VOICES) this.activePattern[voice].fill(0);
    this.notify();
  }

  /** Fires when pattern contents or the selected pattern change. */
  onChange(fn: () => void): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  play(): void {
    if (this.externallyDriven || this.playing) return;
    this.playing = true;
    this.nextStep = 0;
    this.nextTime = this.now() + START_DELAY;
    this.counter = 0;
    this.played = [];
  }

  stop(): void {
    this.playing = false;
    this.played = [];
  }

  /** Look-ahead scheduler for the sequencer's own clock: schedules every step due within LOOKAHEAD. */
  tick(): void {
    if (!this.playing || this.externallyDriven) return;
    const now = this.now();
    if (this.nextTime < now - RESYNC_AFTER) this.nextTime = now;
    while (this.nextTime < now + LOOKAHEAD) {
      const length = this.stepSeconds();
      this.scheduleStep(this.nextStep, this.nextTime, length);
      this.nextStep = (this.nextStep + 1) % STEPS;
      this.nextTime += length;
    }
  }

  /** Feeds MIDI realtime messages; call after the shared clock has handled the event. */
  handleMidi(event: MidiEvent): void {
    if (!this.externallyDriven) return;
    if (event.type === 'start') {
      this.counter = 0;
      this.played = [];
    } else if (event.type === 'stop') {
      this.played = [];
    } else if (event.type === 'clock' && this.clock.running) {
      const pulse = this.clock.ticks - 1; // the clock has already counted this pulse
      if (pulse >= 0 && pulse % PULSES_PER_STEP === 0) {
        const step = (pulse / PULSES_PER_STEP) % STEPS;
        this.counter = pulse / PULSES_PER_STEP;
        this.scheduleStep(step, this.now(), this.stepSeconds());
      }
    }
  }

  /** The step being heard right now (the last scheduled step whose time has arrived), if running. */
  currentStep(): number | undefined {
    if (!this.running) return undefined;
    const now = this.now();
    let current: number | undefined;
    for (const p of this.played) if (p.time <= now) current = p.step;
    return current;
  }

  /** Bar : beat : sixteenth of the step being heard (the incoming clock's when following MIDI). */
  get position(): Position {
    if (this.externallyDriven) return this.clock.running ? this.clock.position : positionFromTicks(0);
    if (!this.playing) return positionFromTicks(0);
    const now = this.now();
    let counter = 0;
    for (const p of this.played) if (p.time <= now) counter = p.counter;
    return positionFromTicks(counter * PULSES_PER_STEP);
  }

  private stepSeconds(): number {
    return 60 / this.drums.transport.bpm / 4;
  }

  /** Odd (off-beat) sixteenths are delayed by the swing amount: 50% is straight, 67% is triplet feel. */
  private swingDelay(step: number, length: number): number {
    return step % 2 === 1 ? (this.swing.value / 100 - 0.5) * 2 * length : 0;
  }

  private scheduleStep(step: number, time: number, length: number): void {
    const when = time + this.swingDelay(step, length);
    const pattern = this.activePattern;
    for (const voice of DRUM_VOICES) {
      const level = pattern[voice][step]!;
      if (level > 0) this.drums.trigger(voice, STEP_VELOCITY[level]!, when);
    }
    this.played.push({ step, counter: this.counter, time: when });
    if (!this.externallyDriven) this.counter++;
    if (this.played.length > 64) this.played.splice(0, this.played.length - 64);
  }

  private notify(): void {
    for (const l of this.listeners) l();
  }
}

import type { MidiClock, Position } from '../midi/clock';
import { positionFromTicks } from '../midi/clock';
import { ChoiceControl, NumberControl, ToggleControl } from './controls';

export const SYNC_MODES = ['internal', 'midi'] as const;
export const MIDI_CHANNELS: readonly string[] = ['omni', ...Array.from({ length: 16 }, (_, i) => String(i + 1))];

const TAP_RESET_MS = 2000;
const TAP_COUNT = 4;

/**
 * One transport per synth, so each synth chooses for itself whether to follow the MIDI clock.
 * - Internal: its own tempo, ignoring incoming clock.
 * - MIDI clock: tempo (and, if `followStartStop` is on, run state and position) follow the shared clock.
 */
export class Transport {
  readonly sync = new ChoiceControl('transport.sync', 'Sync', SYNC_MODES, 'internal', () => {});
  readonly followStartStop = new ToggleControl('transport.followStartStop', 'Start/stop', true, () => {});
  readonly channel = new ChoiceControl('transport.channel', 'Channel', MIDI_CHANNELS, '1', () => {});
  readonly tempo = new NumberControl('transport.tempo', 'Tempo', 20, 300, 120, 'BPM', () => {});
  private taps: number[] = [];

  constructor(
    private readonly clock: MidiClock,
    private readonly now: () => number = () => performance.now(),
  ) {}

  get synced(): boolean {
    return this.sync.value === 'midi';
  }

  /** The tempo in effect: the incoming clock's when synced and locked, else this transport's own. */
  get bpm(): number {
    return this.synced ? this.clock.bpm ?? this.tempo.value : this.tempo.value;
  }

  get locked(): boolean {
    return this.synced && this.clock.isLocked(this.now());
  }

  get running(): boolean {
    return this.synced && this.followStartStop.value && this.clock.running;
  }

  get position(): Position {
    return this.running ? this.clock.position : positionFromTicks(0);
  }

  /** Should this transport's synth react to a message on `channel` (1-16)? */
  acceptsChannel(channel: number): boolean {
    return this.channel.value === 'omni' || Number(this.channel.value) === channel;
  }

  /** Tap tempo: averages the last few taps; a pause of two seconds starts over. */
  tap(time = this.now()): void {
    const last = this.taps[this.taps.length - 1];
    if (last !== undefined && time - last > TAP_RESET_MS) this.taps = [];
    this.taps.push(time);
    if (this.taps.length > TAP_COUNT) this.taps.shift();
    if (this.taps.length >= 2) {
      const span = this.taps[this.taps.length - 1]! - this.taps[0]!;
      this.tempo.set(Math.round((60000 / (span / (this.taps.length - 1))) * 10) / 10);
    }
  }

  nudge(delta: number): void {
    this.tempo.set(Math.round((this.tempo.value + delta) * 10) / 10);
  }
}

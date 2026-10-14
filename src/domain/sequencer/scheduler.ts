import { PPQN } from './division';
import { type SeqEvent, SequencerEngine } from './engine';

/** Where scheduled MIDI goes: raw bytes and the wall-clock time (ms) it should sound. */
export type MidiSink = (data: number[], at: number) => void;

const CLOCK_EVERY = PPQN / 24; // MIDI clock is 24 pulses per quarter; the engine runs at 96

/**
 * Runs a SequencerEngine against a clock. Call `pump()` often (a worker timer does); each call turns the ticks
 * that fall inside the look-ahead window into MIDI and hands them to the sink with their exact due times, so
 * timing does not depend on how regularly pump is called. Also sends MIDI Start, Stop and clock pulses.
 */
export class SeqScheduler {
  /** Wall-clock time of tick `baseTick`; changes whenever the tempo does. */
  private baseTime = 0;
  private baseTick = 0;
  private sentTick = 0;
  private running = false;
  /** The tempo the base time is expressed in; a change re-bases the clock so scheduled ticks keep their times. */
  private tempoUsed = 120;
  private readonly channelsUsed = new Set<number>();
  /** Called for every note event as it is scheduled, with its wall-clock due time (for lighting pads). */
  onNote?: (e: SeqEvent, at: number) => void;

  constructor(
    readonly engine: SequencerEngine,
    private readonly sink: MidiSink,
    private readonly now: () => number,
    private readonly lookaheadMs = 120,
    private readonly prerollMs = 60,
  ) {}

  get playing(): boolean {
    return this.running;
  }

  get tempo(): number {
    return this.engine.bank.tempo;
  }

  private get tickMs(): number {
    return 60000 / (this.tempoUsed * PPQN);
  }

  /** The tick that is sounding at a wall-clock time (for lighting the playhead). */
  tickAt(time: number): number {
    return Math.max(0, Math.floor(this.baseTick + (time - this.baseTime) / this.tickMs));
  }

  private timeOf(tick: number): number {
    return this.baseTime + (tick - this.baseTick) * this.tickMs;
  }

  start(sendTransport = true): void {
    this.engine.start();
    this.running = true;
    this.tempoUsed = this.tempo;
    this.baseTime = this.now() + this.prerollMs;
    this.baseTick = 0;
    this.sentTick = 0;
    if (sendTransport) this.sink([0xfa], this.baseTime);
    this.pump();
  }

  stop(sendTransport = true): void {
    if (!this.running) return;
    const at = this.now();
    for (const e of this.engine.stop()) this.sink(this.bytes(e), at);
    for (const ch of this.channelsUsed) this.sink([0xb0 | (ch - 1), 123, 0], at);
    if (sendTransport) this.sink([0xfc], at);
    this.running = false;
  }

  /** Changes the tempo without moving the playhead. */
  setTempo(bpm: number): void {
    this.engine.bank.tempo = Math.min(280, Math.max(24, bpm));
    this.syncTempo();
  }

  /** Picks up a tempo change made on the bank (by the knob or by loading a bank). */
  private syncTempo(): void {
    if (this.tempo === this.tempoUsed) return;
    if (this.running) {
      const tick = this.sentTick;
      this.baseTime = this.timeOf(tick);
      this.baseTick = tick;
    }
    this.tempoUsed = this.tempo;
  }

  private bytes(e: SeqEvent): number[] {
    return e.kind === 'on'
      ? [0x90 | (e.channel - 1), e.note, e.velocity]
      : [0x80 | (e.channel - 1), e.note, 0];
  }

  /** Sends everything that falls inside the look-ahead window. */
  pump(): void {
    if (!this.running) return;
    this.syncTempo();
    const target = Math.floor(this.baseTick + (this.now() + this.lookaheadMs - this.baseTime) / this.tickMs);
    if (target <= this.sentTick) return;
    for (let t = this.sentTick; t < target; t++) {
      if (t % CLOCK_EVERY === 0) this.sink([0xf8], this.timeOf(t));
    }
    for (const e of this.engine.advance(target)) {
      this.channelsUsed.add(e.channel);
      this.sink(this.bytes(e), this.timeOf(e.tick));
      this.onNote?.(e, this.timeOf(e.tick));
    }
    this.sentTick = target;
  }
}

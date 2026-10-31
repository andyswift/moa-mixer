import { PPQ } from '../domain/sequencer/mpcSequencer';
import { RIG_LOOKAHEAD, type RigSequencer } from '../domain/sequencer/rigSequencer';

const BAR = PPQ * 4;

/**
 * The MOA-RIG's metronome: while the sequencer plays, a click on each beat, the bar's first higher. It is scheduled
 * on the audio clock with the sequencer's own beats (so it follows tempo changes), a little ahead as the sequencer
 * sends, and it goes straight out rather than through the rig, so recording to tape leaves it out.
 */
export class RigMetronome {
  /** The next beat to click, in the sequencer's ticks; -1 when stopped. */
  private next = -1;

  constructor(
    private readonly seq: RigSequencer,
    private readonly on: () => boolean,
    /** Plays a click at an audio time; `accent` on the bar's first beat. */
    private readonly click: (when: number, accent: boolean) => void,
  ) {}

  /** Called as often as the sequencer schedules, with the audio clock's time. */
  schedule(now: number): void {
    if (!this.on() || !this.seq.isPlaying) { this.next = -1; return; }
    const until = this.seq.tickAt(now + RIG_LOOKAHEAD);
    if (this.next < 0) this.next = Math.max(0, Math.ceil(this.seq.tickAt(now) / PPQ) * PPQ);
    while (this.next <= until) {
      const when = this.seq.timeAt(this.next);
      if (when >= now) this.click(when, this.next % BAR === 0);
      this.next += PPQ;
    }
  }
}

/** The click itself: a short sine blip, straight to the speakers. */
export function playClick(ctx: BaseAudioContext, when: number, accent: boolean): void {
  const osc = ctx.createOscillator(), gain = ctx.createGain();
  osc.frequency.value = accent ? 1500 : 1000;
  gain.gain.setValueAtTime(accent ? 0.3 : 0.18, when);
  gain.gain.exponentialRampToValueAtTime(0.001, when + 0.04);
  osc.connect(gain).connect(ctx.destination);
  osc.start(when);
  osc.stop(when + 0.05);
}

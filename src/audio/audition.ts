import { epochNow } from '../midi/bus';

interface Voice {
  gain: GainNode;
  stopAt: number;
}

/**
 * A tiny polyphonic synth so the sequencer can be tried alone: MIDI bytes in, a filtered saw out. It is not the
 * point of the page (the instruments are other tabs), only an audition. Also runs a silent oscillator so the browser
 * treats the tab as playing audio and does not throttle its timers while it sits in the background.
 */
export class Audition {
  enabled = false;
  private ctx?: AudioContext;
  private master?: GainNode;
  private readonly voices = new Map<string, Voice>();

  /** Starts (or resumes) the audio context; call from a click. */
  async wake(): Promise<void> {
    if (!this.ctx) {
      this.ctx = new AudioContext({ latencyHint: 'interactive' });
      this.master = this.ctx.createGain();
      this.master.gain.value = 0.18;
      const filter = this.ctx.createBiquadFilter();
      filter.type = 'lowpass';
      filter.frequency.value = 2400;
      this.master.connect(filter).connect(this.ctx.destination);
      // inaudible, but enough for the tab to count as playing audio
      const keepAlive = this.ctx.createOscillator();
      const silent = this.ctx.createGain();
      silent.gain.value = 0.00001;
      keepAlive.connect(silent).connect(this.ctx.destination);
      keepAlive.start();
    }
    if (this.ctx.state === 'suspended') await this.ctx.resume();
  }

  /** Plays raw MIDI bytes that are due at a wall-clock time (ms since the epoch). */
  play(data: number[], at: number): void {
    if (!this.enabled || !this.ctx || !this.master) return;
    const [status, note = 0, velocity = 0] = data;
    if (status === undefined) return;
    const kind = status & 0xf0;
    const key = `${status & 0x0f}:${note}`;
    const when = Math.max(this.ctx.currentTime, this.ctx.currentTime + (at - epochNow()) / 1000);
    if (kind === 0x90 && velocity > 0) this.on(key, note, velocity, when);
    else if (kind === 0x80 || (kind === 0x90 && velocity === 0)) this.off(key, when);
    else if (kind === 0xb0 && note === 123) for (const k of [...this.voices.keys()]) this.off(k, when);
  }

  private on(key: string, note: number, velocity: number, when: number): void {
    const ctx = this.ctx!;
    this.off(key, when);
    const osc = ctx.createOscillator();
    osc.type = 'sawtooth';
    osc.frequency.value = 440 * Math.pow(2, (note - 69) / 12);
    const gain = ctx.createGain();
    gain.gain.setValueAtTime(0, when);
    gain.gain.linearRampToValueAtTime((velocity / 127) * 0.5, when + 0.004);
    osc.connect(gain).connect(this.master!);
    osc.start(when);
    this.voices.set(key, { gain, stopAt: Number.POSITIVE_INFINITY });
    (gain as unknown as { osc: OscillatorNode }).osc = osc;
  }

  private off(key: string, when: number): void {
    const v = this.voices.get(key);
    if (!v || !this.ctx) return;
    this.voices.delete(key);
    const osc = (v.gain as unknown as { osc: OscillatorNode }).osc;
    v.gain.gain.cancelScheduledValues(when);
    v.gain.gain.setTargetAtTime(0, when, 0.02);
    osc.stop(when + 0.2);
  }
}

import { Device } from './device';
import { NumberControl, ToggleControl } from './controls';
import type { Circuit } from '../circuit/circuit';
import { Transport } from './transport';
import { MidiClock } from '../midi/clock';
import type { MidiEvent } from '../midi/events';

export const DRUM_VOICES = ['kick', 'snare', 'clap', 'closedHat', 'openHat', 'ride'] as const;
export type DrumVoice = (typeof DRUM_VOICES)[number];

export const DRUM_NAMES: Record<DrumVoice, string> = {
  kick: 'Kick',
  snare: 'Snare',
  clap: 'Clap',
  closedHat: 'Closed Hat',
  openHat: 'Open Hat',
  ride: 'Ride',
};

/** General MIDI percussion note numbers each voice answers to. */
export const GM_DRUM_NOTES: Record<number, DrumVoice> = {
  35: 'kick', 36: 'kick',
  38: 'snare', 40: 'snare',
  39: 'clap',
  42: 'closedHat', 44: 'closedHat',
  46: 'openHat',
  51: 'ride', 59: 'ride',
};

export const DRUM_MIDI_CHANNEL = '10'; // General MIDI percussion channel

const CENTS_PER_OCTAVE = 1200;
// The classic six-square "metallic" hat frequencies (Hz).
const METAL_HZ = [205.3, 304.4, 369.6, 522.7, 540, 800];

/**
 * 909-style drum machine: six synthesised voices, each with its own output.
 *
 * Every voice is a small fixed circuit fired by one-shot trigger envelopes:
 *   kick   sine with a fast pitch drop + a click of noise
 *   snare  two triangles (body) + high-passed noise (snap)
 *   clap   band-passed noise through a stuttering burst envelope
 *   hats   six detuned squares -> band-pass -> high-pass (closed and open are separate banks)
 *   ride   the same metallic bank pitched lower, plus a bell tone
 * Voice -> mute/solo gate -> level -> output jack (and meter). A closed hat chokes the open hat.
 */
export class DrumMachine extends Device {
  readonly name: string;
  readonly transport: Transport;
  readonly choke = new ToggleControl('hats.choke', 'Choke', true, () => {});
  private readonly muted = new Set<DrumVoice>();
  private readonly soloed = new Set<DrumVoice>();
  private readonly envelopes = new Map<DrumVoice, string[]>();
  private readonly hitListeners = new Set<(voice: DrumVoice, velocity: number, when?: number) => void>();

  constructor(name = 'Drums', clock = new MidiClock()) {
    super();
    this.name = name;
    this.transport = new Transport(clock);
    this.transport.channel.set(DRUM_MIDI_CHANNEL);
    const c = this.circuit;

    this.addKick(c);
    this.addSnare(c);
    this.addClap(c);
    this.addHat(c, 'closedHat', { decay: [0.015, 0.25, 0.04], tone: 0.7, level: 0.6 });
    this.addHat(c, 'openHat', { decay: [0.1, 1.5, 0.32], tone: 0.65, level: 0.6 });
    this.addRide(c);

    for (const voice of DRUM_VOICES) {
      c.add(`${voice}.mute`, 'gain', { gain: 1 })
        .add(`${voice}.out`, 'gain', { gain: 0.8 })
        .add(`${voice}.meter`, 'meter', {}, { channel: 'mono' })
        .connect(`${voice}.sum`, `${voice}.mute`)
        .connect(`${voice}.mute`, `${voice}.out`)
        .connect(`${voice}.out`, `${voice}.meter`);
      this.outputList.push({ name: voice, nodeId: `${voice}.out` });
      this.meterList.push({ name: voice, nodeId: `${voice}.meter` });
    }
    this.addLevels(c);
    this.controlList.push(this.choke);
  }

  /**
   * Plays a voice. `velocity` is 0..1; a closed hat chokes a ringing open hat when choke is on.
   * `when` is an audio-clock time in seconds, so a sequencer can place hits ahead of time (default: now).
   */
  trigger(voice: DrumVoice, velocity = 1, when?: number): void {
    if (velocity <= 0) return;
    if (voice === 'closedHat' && this.choke.value) this.circuit.choke('openHat.ampEnv', when);
    for (const id of this.envelopes.get(voice) ?? []) this.circuit.trigger(id, velocity, when);
    for (const l of this.hitListeners) l(voice, velocity, when);
  }

  /** Called whenever a voice is played, from the pads, the sequencer or MIDI. */
  onHit(fn: (voice: DrumVoice, velocity: number, when?: number) => void): () => void {
    this.hitListeners.add(fn);
    return () => this.hitListeners.delete(fn);
  }

  /** Reacts to MIDI notes on this machine's channel using the General MIDI drum map. */
  handleMidi(event: MidiEvent): void {
    if (event.type !== 'noteOn' || !this.transport.acceptsChannel(event.channel)) return;
    const voice = GM_DRUM_NOTES[event.note];
    if (voice) this.trigger(voice, event.velocity / 127);
  }

  get soloActive(): boolean {
    return this.soloed.size > 0;
  }

  private register(voice: DrumVoice, ...ids: string[]): void {
    this.envelopes.set(voice, [...(this.envelopes.get(voice) ?? []), ...ids]);
  }

  private num(...args: ConstructorParameters<typeof NumberControl>): NumberControl {
    const c = new NumberControl(...args);
    this.controlList.push(c);
    return c;
  }

  private addKick(c: Circuit): void {
    this.register('kick', 'kick.pitchEnv', 'kick.ampEnv', 'kick.clickEnv');
    c.add('kick.osc', 'oscillator', { frequency: 48, detune: 0 }, { waveform: 'sine' })
      .add('kick.pitchEnv', 'trigger', { peak: 2700, decay: 0.05, velSens: 0 }) // cents: sweep down from ~4x
      .add('kick.ampEnv', 'trigger', { peak: 0.8, decay: 0.38, velSens: 0.8 })
      .add('kick.amp', 'gain', { gain: 0 })
      .add('kick.noise', 'noise')
      .add('kick.clickHp', 'filter', { frequency: 2500, Q: 0.707 }, { type: 'highpass' })
      .add('kick.clickAmp', 'gain', { gain: 0 })
      .add('kick.clickEnv', 'trigger', { peak: 0.24, decay: 0.012, velSens: 1 })
      .add('kick.sum', 'gain', { gain: 1 })
      .connect('kick.pitchEnv', 'kick.osc', 'detune')
      .connect('kick.osc', 'kick.amp')
      .connect('kick.ampEnv', 'kick.amp', 'gain')
      .connect('kick.amp', 'kick.sum')
      .connect('kick.noise', 'kick.clickHp')
      .connect('kick.clickHp', 'kick.clickAmp')
      .connect('kick.clickEnv', 'kick.clickAmp', 'gain')
      .connect('kick.clickAmp', 'kick.sum');
    this.num('kick.tune', 'Tune', 30, 120, 48, 'Hz', (v) => c.setParam('kick.osc', 'frequency', v), 'log');
    this.num('kick.decay', 'Decay', 0.08, 1, 0.38, 's', (v) => c.setParam('kick.ampEnv', 'decay', v), 'log');
    this.num('kick.click', 'Click', 0, 1, 0.4, '', (v) => c.setParam('kick.clickEnv', 'peak', v * 0.6));
  }

  private addSnare(c: Circuit): void {
    this.register('snare', 'snare.pitchEnv', 'snare.bodyEnv', 'snare.noiseEnv');
    c.add('snare.osc1', 'oscillator', { frequency: 190, detune: 0 }, { waveform: 'triangle' })
      .add('snare.osc2', 'oscillator', { frequency: 190 * 1.83, detune: 0 }, { waveform: 'triangle' })
      .add('snare.pitchEnv', 'trigger', { peak: 500, decay: 0.03, velSens: 0 })
      .add('snare.bodyEnv', 'trigger', { peak: 0.4, decay: 0.1, velSens: 0.7 })
      .add('snare.bodyAmp', 'gain', { gain: 0 })
      .add('snare.noise', 'noise')
      .add('snare.noiseHp', 'filter', { frequency: 1800, Q: 0.707 }, { type: 'highpass' })
      .add('snare.noiseEnv', 'trigger', { peak: 0.42, decay: 0.18, velSens: 1 })
      .add('snare.noiseAmp', 'gain', { gain: 0 })
      .add('snare.sum', 'gain', { gain: 1 })
      .connect('snare.osc1', 'snare.bodyAmp')
      .connect('snare.osc2', 'snare.bodyAmp')
      .connect('snare.pitchEnv', 'snare.osc1', 'detune')
      .connect('snare.pitchEnv', 'snare.osc2', 'detune')
      .connect('snare.bodyEnv', 'snare.bodyAmp', 'gain')
      .connect('snare.bodyAmp', 'snare.sum')
      .connect('snare.noise', 'snare.noiseHp')
      .connect('snare.noiseHp', 'snare.noiseAmp')
      .connect('snare.noiseEnv', 'snare.noiseAmp', 'gain')
      .connect('snare.noiseAmp', 'snare.sum');
    this.num('snare.tune', 'Tune', 120, 300, 190, 'Hz', (v) => {
      c.setParam('snare.osc1', 'frequency', v);
      c.setParam('snare.osc2', 'frequency', v * 1.83);
    }, 'log');
    this.num('snare.decay', 'Decay', 0.08, 0.5, 0.18, 's', (v) => {
      c.setParam('snare.noiseEnv', 'decay', v);
      c.setParam('snare.bodyEnv', 'decay', v * 0.55);
    }, 'log');
    this.num('snare.snap', 'Snap', 0, 1, 0.6, '', (v) => c.setParam('snare.noiseEnv', 'peak', v * 0.7));
  }

  private addClap(c: Circuit): void {
    this.register('clap', 'clap.env');
    c.add('clap.noise', 'noise')
      .add('clap.bp', 'filter', { frequency: 1200, Q: 1.5 }, { type: 'bandpass' })
      .add('clap.amp', 'gain', { gain: 0 })
      .add('clap.env', 'trigger', { peak: 2.3, decay: 0.24, velSens: 0.8, spread: 0.012 }, { shape: 'clap' })
      .add('clap.sum', 'gain', { gain: 1 })
      .connect('clap.noise', 'clap.bp')
      .connect('clap.bp', 'clap.amp')
      .connect('clap.env', 'clap.amp', 'gain')
      .connect('clap.amp', 'clap.sum');
    this.num('clap.tone', 'Tone', 600, 3000, 1200, 'Hz', (v) => c.setParam('clap.bp', 'frequency', v), 'log');
    this.num('clap.decay', 'Decay', 0.08, 0.6, 0.24, 's', (v) => c.setParam('clap.env', 'decay', v), 'log');
    this.num('clap.spread', 'Spread', 0, 1, 0.5, '', (v) => c.setParam('clap.env', 'spread', 0.006 + v * 0.012));
  }

  /** Six detuned squares with a shared tune CV (cents), then band-pass -> high-pass. Returns the output node id. */
  private addMetal(c: Circuit, voice: DrumVoice, scale: number, bandHz: number, highpassHz: number, gain: number): void {
    c.add(`${voice}.tune`, 'constant', { offset: 0 })
      .add(`${voice}.metal`, 'gain', { gain })
      .add(`${voice}.bp`, 'filter', { frequency: bandHz, Q: 0.8 }, { type: 'bandpass' })
      .add(`${voice}.hp`, 'filter', { frequency: highpassHz, Q: 0.707 }, { type: 'highpass' })
      .connect(`${voice}.metal`, `${voice}.bp`)
      .connect(`${voice}.bp`, `${voice}.hp`);
    METAL_HZ.forEach((hz, i) => {
      const id = `${voice}.sq${i + 1}`;
      c.add(id, 'oscillator', { frequency: hz * scale, detune: 0 }, { waveform: 'square' })
        .connect(`${voice}.tune`, id, 'detune')
        .connect(id, `${voice}.metal`);
    });
  }

  private addHat(
    c: Circuit,
    voice: 'closedHat' | 'openHat',
    d: { decay: [number, number, number]; tone: number; level: number },
  ): void {
    this.register(voice, `${voice}.ampEnv`);
    this.addMetal(c, voice, 1, 9000, 7000, 0.45);
    c.add(`${voice}.amp`, 'gain', { gain: 0 })
      .add(`${voice}.ampEnv`, 'trigger', { peak: 1, decay: d.decay[2], velSens: 0.8 })
      .add(`${voice}.sum`, 'gain', { gain: 1 })
      .connect(`${voice}.hp`, `${voice}.amp`)
      .connect(`${voice}.ampEnv`, `${voice}.amp`, 'gain')
      .connect(`${voice}.amp`, `${voice}.sum`);
    // Tune 0.6 is the nominal pitch; the fader spans two octaves either side of it.
    this.num(`${voice}.tune`, 'Tune', 0, 1, 0.6, '', (v) => c.setParam(`${voice}.tune`, 'offset', (v - 0.6) * 2 * CENTS_PER_OCTAVE));
    this.num(`${voice}.decay`, 'Decay', d.decay[0], d.decay[1], d.decay[2], 's', (v) => c.setParam(`${voice}.ampEnv`, 'decay', v), 'log');
    this.num(`${voice}.tone`, 'Tone', 0, 1, d.tone, '', (v) => c.setParam(`${voice}.hp`, 'frequency', 3000 + v * 7000));
  }

  private addRide(c: Circuit): void {
    this.register('ride', 'ride.ampEnv', 'ride.bellEnv');
    this.addMetal(c, 'ride', 1.3, 6500, 2500, 0.18);
    c.add('ride.amp', 'gain', { gain: 0 })
      .add('ride.ampEnv', 'trigger', { peak: 1, decay: 1.2, velSens: 0.8 })
      .add('ride.bell1', 'oscillator', { frequency: 2650, detune: 0 }, { waveform: 'sine' })
      .add('ride.bell2', 'oscillator', { frequency: 4380, detune: 0 }, { waveform: 'sine' })
      .add('ride.bellAmp', 'gain', { gain: 0 })
      .add('ride.bellEnv', 'trigger', { peak: 0.2, decay: 0.9, velSens: 0.8 })
      .add('ride.sum', 'gain', { gain: 1 })
      .connect('ride.hp', 'ride.amp')
      .connect('ride.ampEnv', 'ride.amp', 'gain')
      .connect('ride.amp', 'ride.sum')
      .connect('ride.tune', 'ride.bell1', 'detune')
      .connect('ride.tune', 'ride.bell2', 'detune')
      .connect('ride.bell1', 'ride.bellAmp')
      .connect('ride.bell2', 'ride.bellAmp')
      .connect('ride.bellEnv', 'ride.bellAmp', 'gain')
      .connect('ride.bellAmp', 'ride.sum');
    this.num('ride.tune', 'Tune', 0, 1, 0.5, '', (v) => c.setParam('ride.tune', 'offset', (v - 0.5) * 2 * CENTS_PER_OCTAVE));
    this.num('ride.decay', 'Decay', 0.4, 2.5, 1.2, 's', (v) => {
      c.setParam('ride.ampEnv', 'decay', v);
      c.setParam('ride.bellEnv', 'decay', v * 0.75);
    }, 'log');
    this.num('ride.bell', 'Bell', 0, 1, 0.45, '', (v) => c.setParam('ride.bellEnv', 'peak', v * 0.45));
  }

  /** Per-voice level, mute and solo (solo-in-place, like the mixer). */
  private addLevels(c: Circuit): void {
    const initial: Record<DrumVoice, number> = { kick: 0.8, snare: 0.75, clap: 0.7, closedHat: 0.6, openHat: 0.6, ride: 0.55 };
    for (const voice of DRUM_VOICES) {
      this.num(`${voice}.level`, 'Level', 0, 1, initial[voice], '', (v) => c.setParam(`${voice}.out`, 'gain', v));
      this.controlList.push(
        new ToggleControl(`${voice}.mute`, 'Mute', false, (on) => this.setFlag(this.muted, voice, on)),
        new ToggleControl(`${voice}.solo`, 'Solo', false, (on) => this.setFlag(this.soloed, voice, on)),
      );
    }
  }

  private setFlag(set: Set<DrumVoice>, voice: DrumVoice, on: boolean): void {
    if (on) set.add(voice);
    else set.delete(voice);
    for (const v of DRUM_VOICES) {
      const id = `${v}.mute`;
      if (!this.circuit.nodes.has(id)) continue; // controls apply while the voices are still being built
      const silent = this.muted.has(v) || (this.soloed.size > 0 && !this.soloed.has(v));
      this.circuit.setParam(id, 'gain', silent ? 0 : 1);
    }
  }
}

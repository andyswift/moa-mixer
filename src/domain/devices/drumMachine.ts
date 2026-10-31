import { Device } from './device';
import { NumberControl, ToggleControl } from './controls';
import type { Circuit } from '../circuit/circuit';
import { Transport } from './transport';
import { MidiClock } from '../midi/clock';
import type { MidiEvent } from '../midi/events';

/** The voices with an output of their own. */
export const MAIN_VOICES = ['kick', 'snare', 'clap', 'closedHat', 'openHat', 'ride'] as const;
/** The percussion voices, which share one output (`perc`) so the mixer needs one strip for them. */
export const PERC_VOICES = ['rim', 'lowTom', 'midTom', 'highTom', 'cowbell', 'crash'] as const;
export const DRUM_VOICES = [...MAIN_VOICES, ...PERC_VOICES] as const;
export type DrumVoice = (typeof DRUM_VOICES)[number];
/** The output jacks: one per main voice, then the shared percussion output. */
export const DRUM_OUTPUTS = [...MAIN_VOICES, 'perc'] as const;
export type DrumOutput = (typeof DRUM_OUTPUTS)[number];

export const DRUM_NAMES: Record<DrumVoice, string> = {
  kick: 'Kick',
  snare: 'Snare',
  clap: 'Clap',
  closedHat: 'Closed Hat',
  openHat: 'Open Hat',
  ride: 'Ride',
  rim: 'Rimshot',
  lowTom: 'Low Tom',
  midTom: 'Mid Tom',
  highTom: 'High Tom',
  cowbell: 'Cowbell',
  crash: 'Crash',
};
export const DRUM_OUTPUT_NAMES: Record<DrumOutput, string> = { ...DRUM_NAMES, perc: 'Perc' };

/** General MIDI percussion note numbers each voice answers to. */
export const GM_DRUM_NOTES: Record<number, DrumVoice> = {
  35: 'kick', 36: 'kick',
  38: 'snare', 40: 'snare',
  39: 'clap',
  42: 'closedHat', 44: 'closedHat',
  46: 'openHat',
  51: 'ride', 59: 'ride',
  37: 'rim',
  41: 'lowTom', 43: 'lowTom',
  45: 'midTom', 47: 'midTom',
  48: 'highTom', 50: 'highTom',
  56: 'cowbell',
  49: 'crash', 57: 'crash',
};

export const DRUM_MIDI_CHANNEL = '10'; // General MIDI percussion channel

const CENTS_PER_OCTAVE = 1200;
// The classic six-square "metallic" hat frequencies (Hz).
const METAL_HZ = [205.3, 304.4, 369.6, 522.7, 540, 800];
// the ride's layers together, set to measure as loud as the earlier ride over its first second
const RIDE_GAIN = 0.2;
/**
 * The partials of the 909's ride and crash (Hz, level dB, decay dB/s), measured off the machine's cymbal samples: the
 * strongest fourteen of each. On a real cymbal each partial dies at its own rate, so the sound changes as it rings:
 * the ride's loudest (5.5 kHz) is gone in half a second while 2.9 and 5.9 kHz linger, which is its pitch; the crash
 * keeps ringing at 3 kHz. A single envelope on a metallic bank cannot do that.
 */
type Partial = readonly [hz: number, db: number, dbPerSecond: number];
const RIDE_PARTIALS: readonly Partial[] = [
  [2930, -4, 21], [4348, -8, 53], [4793, -7, 62], [5484, 0, 81], [5531, -8, 68], [5695, -8, 67], [5865, -5, 20],
  [6369, -8, 62], [6697, -8, 81], [7154, -7, 40], [7494, -5, 63], [8186, -7, 38], [8379, -6, 89], [8637, -7, 28],
];
const CRASH_PARTIALS: readonly Partial[] = [
  [416, -6, 52], [2930, -5, 31], [2977, -4, 36], [3041, -3, 15], [3492, 0, 29], [3803, -3, 31], [3955, -5, 44],
  [4336, -5, 50], [5104, -2, 35], [5561, -5, 49], [5883, -2, 50], [6152, -6, 35], [7699, 0, 35], [8092, -5, 55],
];
/**
 * The same cymbals as noise in ten bands (low Hz, high Hz, level dB, decay dB/s), also measured off the samples: a
 * cymbal's partials are so many and so close that most of it is shaped noise, and each band of it dies at its own
 * rate. The 909's ride darkens as it rings (its lows hardly fall while its highs are gone); its crash falls evenly.
 */
type Band = readonly [lo: number, hi: number, db: number, dbPerSecond: number];
const RIDE_BANDS: readonly Band[] = [
  [500, 1000, -14, 6], [1000, 2000, -14, 9], [2000, 3000, -6, 13], [3000, 4000, -12, 12], [4000, 5000, -3, 21],
  [5000, 6000, -2, 30], [6000, 8000, 0, 31], [8000, 10000, -2, 33], [10000, 13000, -6, 39], [13000, 17000, -9, 38],
];
const CRASH_BANDS: readonly Band[] = [
  [500, 1000, -2, 22], [1000, 2000, -5, 22], [2000, 3000, -6, 22], [3000, 4000, 0, 15], [4000, 5000, -3, 23],
  [5000, 6000, -6, 23], [6000, 8000, -5, 22], [8000, 10000, -6, 17], [10000, 13000, -9, 21], [13000, 17000, -17, 20],
];
/** The Decay at which the partials ring as long as the 909's do; and the longest any of them rings there (s to
 * -40 dB): the 909's cymbal samples end at about 1.2 s, cutting off the slowest partials. */
const RIDE_DECAY_909 = 1.3;
const CRASH_DECAY_909 = 1.1;
const LONGEST_PARTIAL = 1.3;
/** The longest a noise band rings at that Decay (s to -40 dB): the ride's lows would ring on for nearly seven. */
const LONGEST_BAND = 4;

/**
 * 909-style drum machine: twelve synthesised voices. The six main voices have an output each; the percussion voices
 * (rimshot, three toms, cowbell, crash) share one, `perc`.
 *
 * Every voice is a small fixed circuit fired by one-shot trigger envelopes:
 *   kick   sine with a fast pitch drop + a click of noise
 *   snare  two triangles (body) + high-passed noise (snap)
 *   clap   band-passed noise through a stuttering burst envelope
 *   hats   six detuned squares and noise -> band-pass -> high-pass, with some of the bank around the filters,
 *          crushed to 6 bits (the 909's hats are 6-bit samples) before the envelope (closed and open are separate banks)
 *   ride   layered: a bright metallic bank (bit-crushed like the 909's 6-bit sample, before the envelopes so the
 *          grit fades with it) as a short ping and a long wash, a resonant metallic bell, a breath of air and a
 *          stick tick
 *   rim    two pinged tones and a click of noise, very short
 *   toms   a sine with a pitch drop, and a breath of band-passed noise
 *   cowbell the 808's: two squares (540 and 800 Hz) through a wide band-pass on them and a softening low-pass: a
 *          strike (a short loud stage with a small pitch blip) and then a long quieter ring, "tonk" rather than "beep"
 *   crash  the metallic bank crushed to 6 bits like the hats, a second or so long, with a little high-passed noise
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
    this.addHat(c, 'closedHat', { decay: [0.015, 0.25, 0.04], tone: 0.7, level: 0.6, band: 6800, body: 'metal', attack: 0 });
    // the open hat is the 909's other sample: smooth from 1 to 8 kHz with no low clank (its body is noise, not the
    // bank), and it swells in rather than strikes
    this.addHat(c, 'openHat', { decay: [0.1, 1.5, 0.32], tone: 0.65, level: 0.6, band: 6800, body: 'noise', attack: 0.006 });
    this.addRide(c);
    this.addRim(c);
    this.addTom(c, 'lowTom', 100);
    this.addTom(c, 'midTom', 145);
    this.addTom(c, 'highTom', 200);
    this.addCowbell(c);
    this.addCrash(c);

    c.add('perc.out', 'gain', { gain: 1 });
    for (const voice of DRUM_VOICES) {
      c.add(`${voice}.mute`, 'gain', { gain: 1 })
        .add(`${voice}.out`, 'gain', { gain: 0.8 })
        .add(`${voice}.meter`, 'meter', {}, { channel: 'mono' })
        .connect(`${voice}.sum`, `${voice}.mute`)
        .connect(`${voice}.mute`, `${voice}.out`)
        .connect(`${voice}.out`, `${voice}.meter`);
      this.meterList.push({ name: voice, nodeId: `${voice}.meter` });
      if ((PERC_VOICES as readonly string[]).includes(voice)) c.connect(`${voice}.out`, 'perc.out');
      else this.outputList.push({ name: voice, nodeId: `${voice}.out` });
    }
    this.outputList.push({ name: 'perc', nodeId: 'perc.out' });
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

  /** Six detuned squares with a shared tune CV (`<prefix>.tune`, cents), then band-pass -> high-pass (`<prefix>.hp`). */
  private addMetal(c: Circuit, voice: string, scale: number, bandHz: number, highpassHz: number, gain: number): void {
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

  /** A cymbal's partials: a sine each with its own level and decay, all on the cymbal's tune CV, summed into
   * `<voice>.partials`. Returns a setter for the Decay knob (`decay` / `at` scales every partial's time). */
  private addPartials(c: Circuit, voice: string, partials: readonly Partial[], gain: number, at: number): (decay: number) => void {
    c.add(`${voice}.partials`, 'gain', { gain });
    const ids = partials.map(([hz, db, rate], i) => {
      const id = `${voice}.p${i + 1}`;
      c.add(`${id}.osc`, 'oscillator', { frequency: hz, detune: 0 }, { waveform: 'sine' })
        .add(`${id}.amp`, 'gain', { gain: 0 })
        .add(`${id}.env`, 'trigger', { peak: 10 ** (db / 20), decay: Math.min(40 / rate, LONGEST_PARTIAL), velSens: 0.8 })
        .connect(`${voice}.tune`, `${id}.osc`, 'detune')
        .connect(`${id}.osc`, `${id}.amp`)
        .connect(`${id}.env`, `${id}.amp`, 'gain')
        .connect(`${id}.amp`, `${voice}.partials`);
      return `${id}.env`;
    });
    this.register(voice as DrumVoice, ...ids);
    return (decay) => partials.forEach(([, , rate], i) => c.setParam(ids[i]!, 'decay', Math.min(40 / rate, LONGEST_PARTIAL) * (decay / at)));
  }

  /** A cymbal's noise in bands: one noise source, band-passed into each band, each with its own level and decay,
   * summed into `<voice>.bands`. Returns a setter for the Decay knob, as `addPartials`. */
  private addNoiseBands(c: Circuit, voice: string, bands: readonly Band[], gain: number, at: number): (decay: number) => void {
    c.add(`${voice}.bandNoise`, 'noise').add(`${voice}.bands`, 'gain', { gain });
    const time = (rate: number) => Math.min(40 / rate, LONGEST_BAND);
    const ids = bands.map(([lo, hi, db, rate], i) => {
      const id = `${voice}.b${i + 1}`, centre = Math.sqrt(lo * hi);
      c.add(`${id}.bp`, 'filter', { frequency: centre, Q: centre / (hi - lo) }, { type: 'bandpass' })
        .add(`${id}.amp`, 'gain', { gain: 0 })
        // the level is the band's power, and a wider band lets through more noise: scaled by its width
        .add(`${id}.env`, 'trigger', { peak: 10 ** (db / 20) / Math.sqrt((hi - lo) / 1000), decay: time(rate), velSens: 0.8 })
        .connect(`${voice}.bandNoise`, `${id}.bp`)
        .connect(`${id}.bp`, `${id}.amp`)
        .connect(`${id}.env`, `${id}.amp`, 'gain')
        .connect(`${id}.amp`, `${voice}.bands`);
      return `${id}.env`;
    });
    this.register(voice as DrumVoice, ...ids);
    return (decay) => bands.forEach(([, , , rate], i) => c.setParam(ids[i]!, 'decay', time(rate) * (decay / at)));
  }

  private addHat(
    c: Circuit,
    voice: 'closedHat' | 'openHat',
    d: { decay: [number, number, number]; tone: number; level: number; band: number; body: 'metal' | 'noise'; attack: number },
  ): void {
    this.register(voice, `${voice}.ampEnv`);
    // the 909's hats are 6-bit samples of real cymbals: the metallic bank with noise in it, its body at 4-8 kHz and
    // not only fizz, crushed before the envelope so the grit is in the whole sound
    this.addMetal(c, voice, 1.13, d.band, 500 + d.tone * 5000, 0.45);
    c.add(`${voice}.noise`, 'noise')
      .add(`${voice}.noiseAmp`, 'gain', { gain: d.body === 'metal' ? 0.45 : 0.65 })
      .connect(`${voice}.noise`, `${voice}.noiseAmp`)
      .connect(`${voice}.noiseAmp`, `${voice}.metal`)
      .add(`${voice}.gritPre`, 'gain', { gain: 2.5 })
      .add(`${voice}.crush`, 'waveshaper', { bits: 6 }, { curve: 'crush' })
      .add(`${voice}.gritPost`, 'gain', { gain: 0.5 })
      .connect(`${voice}.hp`, `${voice}.gritPre`)
      // and some weight under 2 kHz around the filters, as the 909's hats have: the whole bank (the closed hat's
      // clank), or noise (the open hat's even wash)
      .add(`${voice}.bodyLp`, 'filter', { frequency: d.body === 'metal' ? 20000 : 2500, Q: 0.5 }, { type: 'lowpass' })
      .add(`${voice}.body`, 'gain', { gain: d.body === 'metal' ? 0.1 : 0.4 })
      .connect(d.body === 'metal' ? `${voice}.metal` : `${voice}.noise`, `${voice}.bodyLp`)
      .connect(`${voice}.bodyLp`, `${voice}.body`)
      .connect(`${voice}.body`, `${voice}.gritPre`)
      .connect(`${voice}.gritPre`, `${voice}.crush`)
      .connect(`${voice}.crush`, `${voice}.gritPost`)
      .add(`${voice}.amp`, 'gain', { gain: 0 })
      .add(`${voice}.ampEnv`, 'trigger', { peak: 1, decay: d.decay[2], velSens: 0.8, ...(d.attack ? { attack: d.attack } : {}) })
      .add(`${voice}.sum`, 'gain', { gain: 1 })
      .connect(`${voice}.gritPost`, `${voice}.amp`)
      .connect(`${voice}.ampEnv`, `${voice}.amp`, 'gain')
      .connect(`${voice}.amp`, `${voice}.sum`);
    // Tune 0.6 is the nominal pitch; the fader spans two octaves either side of it.
    this.num(`${voice}.tune`, 'Tune', 0, 1, 0.6, '', (v) => c.setParam(`${voice}.tune`, 'offset', (v - 0.6) * 2 * CENTS_PER_OCTAVE));
    this.num(`${voice}.decay`, 'Decay', d.decay[0], d.decay[1], d.decay[2], 's', (v) => c.setParam(`${voice}.ampEnv`, 'decay', v), 'log');
    this.num(`${voice}.tone`, 'Tone', 0, 1, d.tone, '', (v) => c.setParam(`${voice}.hp`, 'frequency', 500 + v * 5000));
  }

  private addRide(c: Circuit): void {
    this.register('ride', 'ride.ampEnv', 'ride.pingEnv', 'ride.bellEnv', 'ride.airEnv', 'ride.tickEnv');
    c.add('ride.sum', 'gain', { gain: 1 });

    // a bright bank, crushed to 6 bits before any envelope (the grit fades with the cymbal)
    this.addMetal(c, 'ride', 1.75, 7000, 3000, 0.3);
    c.add('ride.gritPre', 'gain', { gain: 2.2 })
      .add('ride.crush', 'waveshaper', { bits: 6 }, { curve: 'crush' })
      .add('ride.gritPost', 'gain', { gain: 0.45 })
      .connect('ride.hp', 'ride.gritPre')
      // and the whole bank around the filters: the 909's ride has weight under 2 kHz, which is most of why it sounds lower
      .add('ride.body', 'gain', { gain: 0.1 })
      .connect('ride.metal', 'ride.body')
      .connect('ride.body', 'ride.gritPre')
      .connect('ride.gritPre', 'ride.crush')
      .connect('ride.crush', 'ride.gritPost')
      // the wash: the whole bank, long
      .add('ride.amp', 'gain', { gain: 0 })
      .add('ride.ampEnv', 'trigger', { peak: 0.4, decay: 1.4, velSens: 0.8 })
      .connect('ride.gritPost', 'ride.amp')
      .connect('ride.ampEnv', 'ride.amp', 'gain')
      // the ping: a band of it, loud and short
      .add('ride.pingBp', 'filter', { frequency: 6500, Q: 0.9 }, { type: 'bandpass' })
      .add('ride.pingAmp', 'gain', { gain: 0 })
      .add('ride.pingEnv', 'trigger', { peak: 0.6, decay: 0.06, velSens: 0.9 })
      .connect('ride.gritPost', 'ride.pingBp')
      .connect('ride.pingBp', 'ride.pingAmp')
      .connect('ride.pingEnv', 'ride.pingAmp', 'gain')
      // the bell: one resonance of the raw bank, metallic rather than a sine
      .add('ride.bellBp', 'filter', { frequency: 2900, Q: 10 }, { type: 'bandpass' })
      .add('ride.bellAmp', 'gain', { gain: 0 })
      .add('ride.bellEnv', 'trigger', { peak: 0.4, decay: 0.55, velSens: 0.8 })
      .connect('ride.metal', 'ride.bellBp')
      .connect('ride.bellBp', 'ride.bellAmp')
      .connect('ride.bellEnv', 'ride.bellAmp', 'gain')
      // air (high noise, long) and the stick's tick (high noise, a few ms)
      .add('ride.noise', 'noise')
      .add('ride.airHp', 'filter', { frequency: 6000, Q: 0.707 }, { type: 'highpass' })
      .add('ride.airAmp', 'gain', { gain: 0 })
      .add('ride.airEnv', 'trigger', { peak: 0.12, decay: 1.1, velSens: 0.8 })
      .add('ride.tickHp', 'filter', { frequency: 5000, Q: 0.707 }, { type: 'highpass' })
      .add('ride.tickAmp', 'gain', { gain: 0 })
      .add('ride.tickEnv', 'trigger', { peak: 0.3, decay: 0.005, velSens: 1 })
      .connect('ride.noise', 'ride.airHp')
      .connect('ride.airHp', 'ride.airAmp')
      .connect('ride.airEnv', 'ride.airAmp', 'gain')
      .connect('ride.noise', 'ride.tickHp')
      .connect('ride.tickHp', 'ride.tickAmp')
      .connect('ride.tickEnv', 'ride.tickAmp', 'gain')
      .add('ride.layers', 'gain', { gain: RIDE_GAIN });
    for (const layer of ['ride.amp', 'ride.pingAmp', 'ride.bellAmp', 'ride.airAmp', 'ride.tickAmp']) c.connect(layer, 'ride.layers');
    c.connect('ride.layers', 'ride.sum');
    const ridePartials = this.addPartials(c, 'ride', RIDE_PARTIALS, 0.15, RIDE_DECAY_909);
    const rideBands = this.addNoiseBands(c, 'ride', RIDE_BANDS, 0.7, RIDE_DECAY_909);
    c.connect('ride.partials', 'ride.sum').connect('ride.bands', 'ride.sum');

    this.num('ride.tune', 'Tune', 0, 1, 0.5, '', (v) => c.setParam('ride.tune', 'offset', (v - 0.5) * 2 * CENTS_PER_OCTAVE));
    this.num('ride.decay', 'Decay', 0.3, 2.5, 0.75, 's', (v) => {
      c.setParam('ride.ampEnv', 'decay', v * 1.15);
      c.setParam('ride.airEnv', 'decay', v * 0.9);
      c.setParam('ride.bellEnv', 'decay', v * 0.45);
      ridePartials(v);
      rideBands(v);
    }, 'log');
    this.num('ride.bell', 'Bell', 0, 1, 0.45, '', (v) => c.setParam('ride.bellEnv', 'peak', v * 0.9));
  }

  private addRim(c: Circuit): void {
    this.register('rim', 'rim.toneEnv', 'rim.clickEnv');
    c.add('rim.osc1', 'oscillator', { frequency: 480, detune: 0 }, { waveform: 'triangle' })
      .add('rim.osc2', 'oscillator', { frequency: 1720, detune: 0 }, { waveform: 'sine' })
      .add('rim.tune', 'constant', { offset: 0 })
      .add('rim.bp', 'filter', { frequency: 1600, Q: 2.2 }, { type: 'bandpass' })
      .add('rim.toneAmp', 'gain', { gain: 0 })
      .add('rim.toneEnv', 'trigger', { peak: 1.4, decay: 0.03, velSens: 0.8 })
      .add('rim.noise', 'noise')
      .add('rim.hp', 'filter', { frequency: 5000, Q: 0.707 }, { type: 'highpass' })
      .add('rim.clickAmp', 'gain', { gain: 0 })
      .add('rim.clickEnv', 'trigger', { peak: 0.3, decay: 0.008, velSens: 1 })
      .add('rim.sum', 'gain', { gain: 1 })
      .connect('rim.tune', 'rim.osc1', 'detune')
      .connect('rim.tune', 'rim.osc2', 'detune')
      .connect('rim.osc1', 'rim.bp')
      .connect('rim.osc2', 'rim.bp')
      .connect('rim.bp', 'rim.toneAmp')
      .connect('rim.toneEnv', 'rim.toneAmp', 'gain')
      .connect('rim.toneAmp', 'rim.sum')
      .connect('rim.noise', 'rim.hp')
      .connect('rim.hp', 'rim.clickAmp')
      .connect('rim.clickEnv', 'rim.clickAmp', 'gain')
      .connect('rim.clickAmp', 'rim.sum');
    this.num('rim.tune', 'Tune', 0, 1, 0.5, '', (v) => c.setParam('rim.tune', 'offset', (v - 0.5) * 2 * CENTS_PER_OCTAVE));
    this.num('rim.decay', 'Decay', 0.01, 0.12, 0.03, 's', (v) => c.setParam('rim.toneEnv', 'decay', v), 'log');
    this.num('rim.tone', 'Tone', 600, 4000, 1600, 'Hz', (v) => c.setParam('rim.bp', 'frequency', v), 'log');
  }

  /** A 909-ish tom: a sine that drops in pitch, with a breath of noise. */
  private addTom(c: Circuit, voice: 'lowTom' | 'midTom' | 'highTom', hz: number): void {
    this.register(voice, `${voice}.pitchEnv`, `${voice}.ampEnv`, `${voice}.noiseEnv`);
    c.add(`${voice}.osc`, 'oscillator', { frequency: hz, detune: 0 }, { waveform: 'sine' })
      .add(`${voice}.pitchEnv`, 'trigger', { peak: 700, decay: 0.09, velSens: 0 })
      .add(`${voice}.ampEnv`, 'trigger', { peak: 0.9, decay: 0.4, velSens: 0.8 })
      .add(`${voice}.amp`, 'gain', { gain: 0 })
      .add(`${voice}.noise`, 'noise')
      .add(`${voice}.bp`, 'filter', { frequency: hz * 4, Q: 1.2 }, { type: 'bandpass' })
      .add(`${voice}.noiseAmp`, 'gain', { gain: 0 })
      .add(`${voice}.noiseEnv`, 'trigger', { peak: 0.12, decay: 0.06, velSens: 1 })
      .add(`${voice}.sum`, 'gain', { gain: 1 })
      .connect(`${voice}.pitchEnv`, `${voice}.osc`, 'detune')
      .connect(`${voice}.osc`, `${voice}.amp`)
      .connect(`${voice}.ampEnv`, `${voice}.amp`, 'gain')
      .connect(`${voice}.amp`, `${voice}.sum`)
      .connect(`${voice}.noise`, `${voice}.bp`)
      .connect(`${voice}.bp`, `${voice}.noiseAmp`)
      .connect(`${voice}.noiseEnv`, `${voice}.noiseAmp`, 'gain')
      .connect(`${voice}.noiseAmp`, `${voice}.sum`);
    this.num(`${voice}.tune`, 'Tune', hz * 0.6, hz * 1.6, hz, 'Hz', (v) => {
      c.setParam(`${voice}.osc`, 'frequency', v);
      c.setParam(`${voice}.bp`, 'frequency', v * 4);
    }, 'log');
    this.num(`${voice}.decay`, 'Decay', 0.1, 1.2, 0.4, 's', (v) => c.setParam(`${voice}.ampEnv`, 'decay', v), 'log');
    this.num(`${voice}.bend`, 'Bend', 0, 1, 0.5, '', (v) => c.setParam(`${voice}.pitchEnv`, 'peak', v * 1400));
  }

  private addCowbell(c: Circuit): void {
    this.register('cowbell', 'cowbell.strikeEnv', 'cowbell.env', 'cowbell.pitchEnv');
    c.add('cowbell.tune', 'constant', { offset: 0 })
      .add('cowbell.pitchEnv', 'trigger', { peak: 120, decay: 0.015, velSens: 0.5 }) // cents: a blip down onto the pitch
      .add('cowbell.sq1', 'oscillator', { frequency: 540, detune: 0 }, { waveform: 'square' })
      .add('cowbell.sq2', 'oscillator', { frequency: 800, detune: 0 }, { waveform: 'square' })
      .add('cowbell.bp', 'filter', { frequency: 900, Q: 0.9 }, { type: 'bandpass' })
      .add('cowbell.lp', 'filter', { frequency: 4500, Q: 0.6 }, { type: 'lowpass' })
      .add('cowbell.amp', 'gain', { gain: 0 })
      // two stages summed on the gain: the strike (loud, a few ms) and the ring (quieter, the Decay)
      .add('cowbell.strikeEnv', 'trigger', { peak: 0.75, decay: 0.012, velSens: 0.9 })
      .add('cowbell.env', 'trigger', { peak: 0.22, decay: 0.4, velSens: 0.7 })
      .add('cowbell.sum', 'gain', { gain: 1 })
      .connect('cowbell.tune', 'cowbell.sq1', 'detune')
      .connect('cowbell.tune', 'cowbell.sq2', 'detune')
      .connect('cowbell.pitchEnv', 'cowbell.sq1', 'detune')
      .connect('cowbell.pitchEnv', 'cowbell.sq2', 'detune')
      .connect('cowbell.sq1', 'cowbell.bp')
      .connect('cowbell.sq2', 'cowbell.bp')
      .connect('cowbell.bp', 'cowbell.lp')
      .connect('cowbell.lp', 'cowbell.amp')
      .connect('cowbell.strikeEnv', 'cowbell.amp', 'gain')
      .connect('cowbell.env', 'cowbell.amp', 'gain')
      .connect('cowbell.amp', 'cowbell.sum');
    this.num('cowbell.tune', 'Tune', 0, 1, 0.5, '', (v) => c.setParam('cowbell.tune', 'offset', (v - 0.5) * CENTS_PER_OCTAVE));
    this.num('cowbell.decay', 'Decay', 0.05, 1, 0.4, 's', (v) => c.setParam('cowbell.env', 'decay', v), 'log');
    this.num('cowbell.tone', 'Tone', 500, 6000, 900, 'Hz', (v) => c.setParam('cowbell.bp', 'frequency', v), 'log');
  }

  private addCrash(c: Circuit): void {
    this.register('crash', 'crash.ampEnv', 'crash.noiseEnv');
    // like the hats, the 909's crash is a 6-bit sample: the bank crushed before the envelope, its weight at 2-6 kHz,
    // a little air on top rather than a wash of noise
    this.addMetal(c, 'crash', 1.15, 4500, 2500, 0.35);
    c.add('crash.gritPre', 'gain', { gain: 2.5 })
      .add('crash.crush', 'waveshaper', { bits: 6 }, { curve: 'crush' })
      .add('crash.gritPost', 'gain', { gain: 0.5 })
      .add('crash.body', 'gain', { gain: 0.35 })
      .connect('crash.hp', 'crash.gritPre')
      .connect('crash.metal', 'crash.body')
      .connect('crash.body', 'crash.gritPre')
      .connect('crash.gritPre', 'crash.crush')
      .connect('crash.crush', 'crash.gritPost')
      .add('crash.amp', 'gain', { gain: 0 })
      .add('crash.ampEnv', 'trigger', { peak: 0.15, decay: 1.1, velSens: 0.8 })
      .add('crash.noise', 'noise')
      .add('crash.noiseHp', 'filter', { frequency: 4000, Q: 0.707 }, { type: 'highpass' })
      .add('crash.noiseAmp', 'gain', { gain: 0 })
      .add('crash.noiseEnv', 'trigger', { peak: 0, decay: 0.8, velSens: 0.8 })
      .add('crash.sum', 'gain', { gain: 1 })
      .connect('crash.gritPost', 'crash.amp')
      .connect('crash.ampEnv', 'crash.amp', 'gain')
      .connect('crash.amp', 'crash.sum')
      .connect('crash.noise', 'crash.noiseHp')
      .connect('crash.noiseHp', 'crash.noiseAmp')
      .connect('crash.noiseEnv', 'crash.noiseAmp', 'gain')
      .connect('crash.noiseAmp', 'crash.sum');
    const crashPartials = this.addPartials(c, 'crash', CRASH_PARTIALS, 0.15, CRASH_DECAY_909);
    const crashBands = this.addNoiseBands(c, 'crash', CRASH_BANDS, 0.7, CRASH_DECAY_909);
    c.connect('crash.partials', 'crash.sum').connect('crash.bands', 'crash.sum');
    this.num('crash.tune', 'Tune', 0, 1, 0.5, '', (v) => c.setParam('crash.tune', 'offset', (v - 0.5) * 2 * CENTS_PER_OCTAVE));
    this.num('crash.decay', 'Decay', 0.3, 4, 1.1, 's', (v) => {
      c.setParam('crash.ampEnv', 'decay', v);
      c.setParam('crash.noiseEnv', 'decay', v * 0.75);
      crashPartials(v);
      crashBands(v);
    }, 'log');
    this.num('crash.tone', 'Tone', 0, 1, 0.5, '', (v) => c.setParam('crash.hp', 'frequency', 1000 + v * 3000));
  }

  /** Per-voice level, mute and solo (solo-in-place, like the mixer). */
  private addLevels(c: Circuit): void {
    const initial: Record<DrumVoice, number> = {
      kick: 0.8, snare: 0.75, clap: 0.7, closedHat: 0.6, openHat: 0.6, ride: 0.55,
      rim: 0.6, lowTom: 0.7, midTom: 0.7, highTom: 0.7, cowbell: 0.5, crash: 0.5,
    };
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

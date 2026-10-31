import { DRUM_NAMES, DRUM_VOICES, DrumMachine, type DrumVoice } from './drumMachine';
import { DECAY_OFF } from './mpc60';

/**
 * A MOA-RIG kit: sixteen pads for a part, played by notes 36 to 51. Each pad is one of two kinds:
 * - analogue: a voice of the MOA-DR (the band's 909-style drum machine) with that voice's own knobs, rendered from the
 *   model whenever they change;
 * - sample: a sound from the MOA-60's factory kits (`kit/sound`), from `start` to `end` seconds (end 0 is its end).
 * Either way the MOA-60's sampler plays it, with the pad's tune, decay, level, pan, filter and mute group.
 */
export const RIG_PADS = 16;
export const RIG_FIRST_PAD_NOTE = 36;
/**
 * The order the pads are shown in, as a drum machine lays them out: kicks, snares, rim and claps, the toms together,
 * the hats, the cymbals, the cowbell (as pad indices). The pads keep their General MIDI notes (pad i is note 36 + i,
 * which is why a GM kit has its toms between its hats), so MIDI and saved patterns play the same sounds.
 */
export const RIG_PAD_ORDER: readonly number[] = [0, 11, 2, 4, 1, 3, 14, 5, 7, 9, 6, 8, 10, 13, 15, 12];

export interface RigPad {
  /** Two or three letters, for the pads and the sequencer's lanes. */
  name: string;
  src: 'analog' | 'sample';
  voice: DrumVoice;
  /** The voice's knobs: control id (`kick.tune`) -> value. Missing ones are the MOA-DR's own settings. */
  analog: Record<string, number>;
  /** The sample's sound: `<factory kit>/<sound id>`. */
  sound: string;
  start: number;
  end: number;
  /** Semitones. */
  tune: number;
  /** Seconds to fall 60 dB; DECAY_OFF (8) or more plays the whole sound. */
  decay: number;
  level: number;
  pan: number;
  cutoff: number;
  reso: number;
  /** Mute group: 0 for none; pads in the same group cut each other (the hats). */
  group: number;
  reverse: boolean;
}

export interface RigKit {
  name: string;
  pads: RigPad[];
}

export interface RigDrumParam {
  id: string;
  label: string;
  min: number;
  max: number;
  def: number;
  unit: string;
  curve: 'linear' | 'log';
}

let drumParams: Map<DrumVoice, RigDrumParam[]> | undefined;
/** The knobs an analogue pad has for its voice: the MOA-DR's own controls for it (without its level). */
export function rigDrumParams(voice: DrumVoice): RigDrumParam[] {
  if (!drumParams) {
    const controls = new DrumMachine().controls;
    drumParams = new Map(DRUM_VOICES.map((v) => [v, controls.flatMap((c) =>
      c.kind === 'number' && c.id.startsWith(`${v}.`) && !c.id.endsWith('.level')
        ? [{ id: c.id, label: c.label, min: c.min, max: c.max, def: c.initial, unit: c.unit, curve: c.curve }] : [])]));
  }
  return drumParams.get(voice) ?? [];
}

export const newPad = (voice: DrumVoice = 'kick', settings: Partial<RigPad> = {}): RigPad => ({
  name: DRUM_SHORT[voice], src: 'analog', voice, analog: {}, sound: '', start: 0, end: 0,
  tune: 0, decay: DECAY_OFF, level: 0.8, pan: 0, cutoff: 20000, reso: 0, group: 0, reverse: false, ...settings,
});

export const DRUM_SHORT: Record<DrumVoice, string> = {
  kick: 'BD', snare: 'SD', clap: 'CP', closedHat: 'CH', openHat: 'OH', ride: 'RD',
  rim: 'RS', lowTom: 'LT', midTom: 'MT', highTom: 'HT', cowbell: 'CB', crash: 'CR',
};
export { DRUM_NAMES, DRUM_VOICES };

/** The id of the sound a pad plays: its sample, or its analogue voice and knobs (the same settings share a render). */
export function padSoundId(p: RigPad): string {
  if (p.src === 'sample') return p.sound;
  const knobs = Object.keys(p.analog).sort().map((k) => `${k}=${+p.analog[k]!.toFixed(4)}`);
  return `dr:${p.voice}:${knobs.join(',')}`;
}

// ---- factory kits

const a = (voice: DrumVoice, settings: Partial<RigPad> = {}) => newPad(voice, settings);
/** The MOA-60's "MOA Drums 60" kit: its break is two bars at 92 bpm, swung 58%, starting at 0. */
const BREAK = 'MOA Drums 60/f.break';
const SIXTEENTH = 60 / 92 / 4;
const breakAt = (step: number) => step * SIXTEENTH + (step % 2 === 1 ? (2 * 0.58 - 1) * SIXTEENTH : 0);
const slice = (name: string, from: number, to: number, settings: Partial<RigPad> = {}) =>
  newPad('kick', { name, src: 'sample', sound: BREAK, start: breakAt(from), end: breakAt(to), group: 3, ...settings });

/** Kits made of pads (the break kits, cut from the MOA-60's factory kits, are made where those are: see the page). */
export const RIG_KITS: readonly RigKit[] = [
  {
    name: 'Analogue 909',
    pads: [
      a('kick'), a('rim'), a('snare'), a('clap'),
      a('snare', { name: 'SD2', analog: { 'snare.tune': 260, 'snare.decay': 0.12, 'snare.snap': 1 } }),
      a('lowTom'), a('closedHat', { group: 1 }), a('midTom'),
      a('closedHat', { name: 'PH', group: 1, analog: { 'closedHat.decay': 0.08 } }), a('highTom'), a('openHat', { group: 1 }),
      a('kick', { name: 'BD2', analog: { 'kick.tune': 40, 'kick.decay': 0.9, 'kick.click': 0.15 } }),
      a('cowbell'), a('crash'), a('clap', { name: 'CP2', analog: { 'clap.spread': 1, 'clap.decay': 0.45 } }), a('ride'),
    ],
  },
  {
    // one of each: the analogue kick, snare and hats, and the break's hits for the in-between
    name: 'Dub Mix',
    pads: [
      a('kick', { analog: { 'kick.tune': 44, 'kick.decay': 0.7, 'kick.click': 0.2 } }), a('rim', { analog: { 'rim.tone': 1100 } }),
      a('snare', { analog: { 'snare.decay': 0.3, 'snare.snap': 0.45 } }), a('clap', { analog: { 'clap.tone': 900 } }),
      slice('KB', 0, 2), slice('SB', 4, 6), a('closedHat', { group: 1 }), slice('GH', 7, 8, { level: 1 }),
      a('closedHat', { name: 'PH', group: 1, analog: { 'closedHat.decay': 0.09 } }), slice('HB', 2, 3), a('openHat', { group: 1, analog: { 'openHat.decay': 0.6 } }),
      slice('SR', 12, 14, { reverse: true }), a('cowbell', { analog: { 'cowbell.tone': 1800 } }), a('crash'),
      newPad('kick', { name: 'BRK', src: 'sample', sound: BREAK, group: 3 }), a('ride'),
    ],
  },
];

const clone = <T>(v: T): T => JSON.parse(JSON.stringify(v)) as T;
export const cloneKit = (k: RigKit): RigKit => clone(k);

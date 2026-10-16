import type { PageId, PageSettings } from './control';

export interface MixOptions {
  /** Faders for the kick, snare and clap channels, and for the hats and ride. */
  drums?: { kick: number; snare: number; clap: number; rest: number };
  /** Depth of the kick duck on the bass and pad (0 for none). */
  duck?: number;
  /** Reverb sends (aux 1) and delay sends (aux 2) by strip. */
  reverb?: Record<string, number>;
  delay?: Record<string, number>;
  /** Fader overrides, e.g. { line1: 0.55 }. */
  faders?: Record<string, number>;
}

/**
 * The mixer's and the bus compressor's settings for a song, written from a few musical choices: drums in front, bass
 * and pad on the compressed bus the kick ducks, and what goes to the reverb and the delay. Spread the result into a
 * song's `setup`: the compressor is a page of its own.
 */
export function mixerSettings(o: MixOptions): { mixer: PageSettings; buscomp: PageSettings } {
  const d = o.drums ?? { kick: 1.1, snare: 1.05, clap: 1.05, rest: 1 };
  const controls: Record<string, number | string | boolean> = {
    'ch3.fader': d.kick, 'ch4.fader': d.snare, 'ch5.fader': d.clap, 'ch6.fader': d.rest, 'ch7.fader': d.rest, 'ch8.fader': d.rest,
    'ch1.busA': false, 'ch1.busB': true, 'ch2.busA': false, 'ch2.busB': true, 'key.source': '3',
    'ret1.fader': 0.8, 'ret2.fader': 0.7, 'ret4.fader': 0.9,
  };
  for (const [strip, v] of Object.entries(o.faders ?? {})) controls[`${strip}.fader`] = v;
  for (const [strip, v] of Object.entries(o.reverb ?? {})) controls[`${strip}.aux1`] = v;
  for (const [strip, v] of Object.entries(o.delay ?? {})) controls[`${strip}.aux2`] = v;
  const duck = o.duck ?? 0.3;
  return {
    mixer: { mixer: { controls } },
    buscomp: { buscomp: { controls: { 'bc.duck.depth': duck, 'bc.duck.release': 220, 'bc.threshold': -10, 'bc.ratio': 2, 'bc.makeup': 1 } } },
  };
}

/** The effect pages an ordinary song uses: the reverb (aux 1), the delay (aux 2) and the keyed bus compressor (bus B). */
export const STANDARD_EFFECTS: PageId[] = ['reverb', 'delay', 'buscomp'];

/**
 * Drum voice levels that let the kit snap: the drum machine's snare, clap and cymbals start well below its kick, so
 * every song raises them at the source and then balances the strips by measured RMS.
 */
export const DRUM_PUNCH: PageSettings = { drums: { controls: { 'snare.level': 1, 'clap.level': 1, 'closedHat.level': 1, 'openHat.level': 1, 'ride.level': 1 } } };

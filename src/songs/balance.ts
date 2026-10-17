import type { Song } from './types';

/**
 * Mixer fader levels per song, set from measured RMS rather than by ear or by peaks. Each song was played for a full
 * pass and every mixer strip's RMS was measured while it was sounding; the kick is the reference and is left where it
 * is. Targets relative to the kick: snare 3.5 dB under, clap 6.5, hats 12, ride 10; bass 2 under; pad 7 under; leads
 * only trimmed if they were louder than about 8 to 10 dB under the kick (never boosted much).
 *
 * Strips: ch1 bass, ch2 pad, ch3 kick, ch4 snare, ch5 clap, ch6 closed hat, ch7 open hat, ch8 ride, ch9 drum percussion,
 * line1 Lynch, line2 DUO, line3 DF2, line4 PIPE, line5 MOA-2600. A fader tops out at 1.5, so a strip that needs more
 * than that (closed hats made of soft ghost notes) stays under its target.
 */
export const BALANCE: Record<string, Record<string, number>> = {
  'two-step-sunrise': { ch4: 1.11, ch5: 0.93, ch6: 1.5, ch7: 1.0, ch8: 0.77, ch1: 0.52, ch2: 0.46, line1: 0.62, line2: 0.7, line4: 1.13 },
  'neon-hands': { ch4: 1.05, ch5: 0.88, ch6: 1.37, ch7: 1.08, ch1: 0.55, ch2: 0.49, line1: 0.52, line2: 0.39, line4: 0.86 },
  'glass-garden': { ch4: 1.07, ch5: 0.95, ch6: 1.47, ch7: 1.11, ch8: 0.75, ch1: 0.47, ch2: 0.5, line2: 0.54, line3: 1.11, line4: 1.13 },
  'salt-flats': { ch4: 1.0, ch5: 0.95, ch6: 1.5, ch7: 1.2, ch8: 0.78, ch1: 0.78, ch2: 0.56, line1: 0.41, line2: 0.33, line3: 1.0, line4: 1.13 },
  'fjord-light': { ch4: 1.0, ch5: 0.84, ch6: 1.38, ch7: 1.11, ch1: 0.52, ch2: 0.51, line1: 0.51, line2: 0.35, line3: 1.13, line4: 0.18 },
  // measured in headless Chrome on the dev Records page: the percussion (rimshot, toms) 8 under the kick, the 2600 10 under
  'squelch-theory': { ch1: 0.95, ch4: 1.1, ch5: 0.88, ch6: 1.5, ch7: 0.93, ch8: 0.79, ch9: 0.43, line5: 0.79 },
};

/** Applies a song's measured fader levels on top of the rough ones it was written with. Songs with no entry are untouched. */
export function applyBalance(song: Song): Song {
  const faders = BALANCE[song.id];
  const mixer = song.setup.mixer?.mixer;
  if (!faders || !mixer) return song;
  mixer.controls = { ...mixer.controls };
  for (const [strip, level] of Object.entries(faders)) mixer.controls[`${strip}.fader`] = level;
  return song;
}

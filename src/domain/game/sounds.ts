import { BassGuitar } from '../devices/bassGuitar';
import type { PresetValues } from '../devices/synthPresets';
import { defaultsOf } from './lessonSession';

/**
 * The game's bass sound, on top of the MOA-BASS's defaults: the amp's drive turned down and the output with it.
 * Played from a keyboard at full velocity, or with notes ringing on several strings, the defaults drove the amp's
 * valve hard (measured: velocity 64 to 127 rose 5.8 dB where the pluck rises 8.6) and peaked near 0 dBFS. With these,
 * single notes peak at -5 dBFS or below and three strings at full velocity at -2 dBFS, with the valve nearly clean.
 */
export const CLEAN_BASS: PresetValues = { 'amp.gain': 0.1, level: 0.55 };

let bassBaseValues: PresetValues | undefined;

/** Every control of the game's bass: the MOA-BASS's defaults (from a bass of its own) with CLEAN_BASS on top. */
export function bassBase(): PresetValues {
  return (bassBaseValues ??= { ...defaultsOf(new BassGuitar()), ...CLEAN_BASS });
}

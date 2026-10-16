import type { M2600Synth } from '../domain/devices/m2600Synth';
import type { SynthPreset } from '../domain/devices/synthPresets';
import * as storage from './patchStorage';

const KEY = 'moa-2600.patches';

/** Puts the patches the user wrote earlier back into the synth's slots. */
export const loadSavedPatches = (synth: M2600Synth): void => storage.loadSavedPatches(KEY, synth);
export const persistPatch = (index: number, preset: SynthPreset): void => storage.persistPatch(KEY, index, preset);

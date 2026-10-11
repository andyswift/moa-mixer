import type { PolySynth } from '../domain/devices/polySynth';
import type { SynthPreset } from '../domain/devices/synthPresets';
import * as storage from './patchStorage';

const KEY = 'moa6.patches';

/** Puts the patches the user saved earlier back into the synth's slots. */
export const loadSavedPatches = (synth: PolySynth): void => storage.loadSavedPatches(KEY, synth);
export const persistPatch = (index: number, preset: SynthPreset): void => storage.persistPatch(KEY, index, preset);

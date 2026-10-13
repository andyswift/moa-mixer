import type { PipeSynth } from '../domain/devices/pipeSynth';
import type { SynthPreset } from '../domain/devices/synthPresets';
import * as storage from './patchStorage';

const KEY = 'moapipe.patches';

/** Puts the patches the user saved earlier back into the pipe synth's slots. */
export const loadSavedPatches = (synth: PipeSynth): void => storage.loadSavedPatches(KEY, synth);
export const persistPatch = (index: number, preset: SynthPreset): void => storage.persistPatch(KEY, index, preset);

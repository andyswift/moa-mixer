import type { LynchSynth } from '../domain/devices/lynchSynth';
import type { SynthPreset } from '../domain/devices/synthPresets';
import * as storage from './patchStorage';

const KEY = 'lynch106.patches';

/** Puts the patches the user wrote earlier back into the synth's 128 slots. */
export const loadSavedPatches = (synth: LynchSynth): void => storage.loadSavedPatches(KEY, synth);
export const persistPatch = (index: number, preset: SynthPreset): void => storage.persistPatch(KEY, index, preset);

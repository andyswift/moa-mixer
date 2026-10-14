import type { DuoSynth } from '../domain/devices/duoSynth';
import type { SynthPreset } from '../domain/devices/synthPresets';
import * as storage from './patchStorage';

const KEY = 'moa-duo.patches';

/** Puts the patches the user wrote earlier back into the synth's slots. */
export const loadSavedPatches = (synth: DuoSynth): void => storage.loadSavedPatches(KEY, synth);
export const persistPatch = (index: number, preset: SynthPreset): void => storage.persistPatch(KEY, index, preset);

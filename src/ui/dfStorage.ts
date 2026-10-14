import type { FilterBox } from '../domain/devices/filterBox';
import type { SynthPreset } from '../domain/devices/synthPresets';
import * as storage from './patchStorage';

const KEY = 'moa-df2.patches';

/** Puts the patches the user wrote earlier back into the box's slots. */
export const loadSavedPatches = (box: FilterBox): void => storage.loadSavedPatches(KEY, box);
export const persistPatch = (index: number, preset: SynthPreset): void => storage.persistPatch(KEY, index, preset);

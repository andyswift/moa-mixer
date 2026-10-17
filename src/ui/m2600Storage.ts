import type { Control } from '../domain/devices/controls';
import type { M2600Synth } from '../domain/devices/m2600Synth';
import { M2600_CORDS_KEY, M2600_RETIRED } from '../domain/devices/m2600Presets';
import type { SynthPreset } from '../domain/devices/synthPresets';
import * as storage from './patchStorage';

const KEY = 'moa-2600.patches';

/** Puts the patches the user wrote earlier back into the synth's slots (the cords, and retired controls, count as known values). */
export const loadSavedPatches = (synth: M2600Synth): void =>
  storage.loadSavedPatches(KEY, {
    controls: [...synth.controls, ...[M2600_CORDS_KEY, ...M2600_RETIRED].map((id) => ({ id }) as Control)],
    slots: synth.slots,
  });
export const persistPatch = (index: number, preset: SynthPreset): void => storage.persistPatch(KEY, index, preset);

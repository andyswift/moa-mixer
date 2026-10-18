import type { Control } from '../domain/devices/controls';
import type { PresetValues, SynthPreset } from '../domain/devices/synthPresets';
import { isEmbedded } from './embed';

/** What a synth or effect needs for saved patches: its controls and a list of patch slots. */
export interface PatchSlots {
  readonly controls: readonly Control[];
  readonly slots: SynthPreset[];
}

type Stored = Record<string, SynthPreset>;

function read(key: string): Stored {
  try {
    const raw = window.localStorage.getItem(key);
    return raw ? (JSON.parse(raw) as Stored) : {};
  } catch {
    return {}; // storage blocked or corrupt: just start from the factory patches
  }
}

const isValues = (v: unknown, known: Set<string>): v is PresetValues =>
  typeof v === 'object' && v !== null &&
  Object.entries(v).every(([id, x]) => known.has(id) && (typeof x === 'number' || typeof x === 'string'));

/** Puts the patches the user saved earlier back into the device's slots (not inside the records page: songs use the factory ones). */
export function loadSavedPatches(key: string, device: PatchSlots): void {
  if (isEmbedded()) return;
  const known = new Set(device.controls.map((c) => c.id));
  for (const [index, preset] of Object.entries(read(key))) {
    const i = Number(index);
    if (Number.isInteger(i) && i >= 0 && i < device.slots.length && typeof preset?.name === 'string' && isValues(preset.values, known)) {
      device.slots[i] = preset;
    }
  }
}

export function persistPatch(key: string, index: number, preset: SynthPreset): void {
  try {
    window.localStorage.setItem(key, JSON.stringify({ ...read(key), [index]: preset }));
  } catch {
    // Not saved across reloads (private window or blocked storage); the slot still holds it this session.
  }
}

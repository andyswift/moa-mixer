import type { PolySynth } from '../domain/devices/polySynth';
import type { PresetValues, SynthPreset } from '../domain/devices/synthPresets';

const KEY = 'moa6.patches';

type Stored = Record<string, SynthPreset>;

function read(): Stored {
  try {
    const raw = window.localStorage.getItem(KEY);
    return raw ? (JSON.parse(raw) as Stored) : {};
  } catch {
    return {}; // storage blocked or corrupt: just start from the factory patches
  }
}

const isValues = (v: unknown, known: Set<string>): v is PresetValues =>
  typeof v === 'object' && v !== null &&
  Object.entries(v).every(([id, x]) => known.has(id) && (typeof x === 'number' || typeof x === 'string'));

/** Puts the patches the user saved earlier back into the synth's slots. */
export function loadSavedPatches(synth: PolySynth): void {
  const known = new Set(synth.controls.map((c) => c.id));
  for (const [index, preset] of Object.entries(read())) {
    const i = Number(index);
    if (Number.isInteger(i) && i >= 0 && i < synth.slots.length && typeof preset?.name === 'string' && isValues(preset.values, known)) {
      synth.slots[i] = preset;
    }
  }
}

export function persistPatch(index: number, preset: SynthPreset): void {
  try {
    window.localStorage.setItem(KEY, JSON.stringify({ ...read(), [index]: preset }));
  } catch {
    // Not saved across reloads (private window or blocked storage); the slot still holds it this session.
  }
}

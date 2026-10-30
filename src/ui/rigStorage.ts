import { type RigMulti, sanitiseMulti, sanitiseSound } from '../domain/devices/rigMulti';
import type { RigPreset } from '../domain/devices/rigPresets';
import { freshPart } from '../domain/devices/rigSynth';

/**
 * The MOA-RIG in the browser's local storage: the working multi, saved as it changes so a reload brings it back;
 * sixteen multi slots; and the sounds saved from parts. Blocked or full storage only means nothing is kept.
 */
export const RIG_MULTI_SLOTS = 16;
const CURRENT_KEY = 'moa-rig.current';
const SLOT_KEY = (n: number) => `moa-rig.multi.${n}`;
const SOUNDS_KEY = 'moa-rig.sounds';

function get(key: string): unknown {
  try {
    const raw = localStorage.getItem(key);
    return raw ? (JSON.parse(raw) as unknown) : undefined;
  } catch {
    return undefined;
  }
}

function put(key: string, value: unknown): boolean {
  try {
    localStorage.setItem(key, JSON.stringify(value));
    return true;
  } catch {
    return false; // private window, blocked or full storage
  }
}

const multi = (raw: unknown): RigMulti | undefined => sanitiseMulti(raw, freshPart);

/** The multi the page was last using, and the slot it came from (-1 for none). */
export function loadCurrent(): { multi: RigMulti; slot: number } | undefined {
  const raw = get(CURRENT_KEY) as { slot?: unknown; multi?: unknown } | undefined;
  const m = multi(raw?.multi);
  if (!m) return undefined;
  const slot = typeof raw?.slot === 'number' && raw.slot >= 0 && raw.slot < RIG_MULTI_SLOTS ? Math.floor(raw.slot) : -1;
  return { multi: m, slot };
}

export const saveCurrent = (m: RigMulti, slot: number): boolean => put(CURRENT_KEY, { slot, multi: m });

export const loadSlot = (slot: number): RigMulti | undefined => multi(get(SLOT_KEY(slot)));
export const saveSlot = (slot: number, m: RigMulti): boolean => put(SLOT_KEY(slot), m);

/** The names of the saved multis, by slot (undefined where nothing is saved). */
export function slotNames(): (string | undefined)[] {
  return Array.from({ length: RIG_MULTI_SLOTS }, (_, i) => {
    const raw = get(SLOT_KEY(i)) as { name?: unknown } | undefined;
    return raw ? (typeof raw.name === 'string' ? raw.name : 'Multi') : undefined;
  });
}

export function loadSounds(): RigPreset[] {
  const raw = get(SOUNDS_KEY);
  return Array.isArray(raw) ? raw.map(sanitiseSound).filter((s): s is RigPreset => s !== undefined) : [];
}

export const saveSounds = (sounds: RigPreset[]): boolean => put(SOUNDS_KEY, sounds);

const MIDI_TO_EDITED_KEY = 'moa-rig.midiToEdited';
/** Whether MIDI plays the edited part (a setting of the machine, kept apart from the multis). */
export const loadMidiToEdited = (): boolean => get(MIDI_TO_EDITED_KEY) === true;
export const saveMidiToEdited = (on: boolean): boolean => put(MIDI_TO_EDITED_KEY, on);

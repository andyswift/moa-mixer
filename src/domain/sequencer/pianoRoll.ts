import { type RigTrack } from './rigSequencer';

/**
 * The piano roll's view of a track: its notes as a list, each where it starts, its pitch, its own length (steps) and
 * velocity, and the edits on such lists (all pure). A track keeps notes per step, with a step's gate and velocity
 * for the notes that have none of their own; reading gives every note both, and writing back keeps a note's own only
 * where it differs from its step's.
 */
export interface RollNote {
  step: number;
  note: number;
  gate: number;
  vel: number;
}

/** A note's identity on the roll: where it starts and its pitch. */
export const rollKey = (n: { step: number; note: number }): string => `${n.step}:${n.note}`;

export const MIN_GATE = 0.25;
export const MAX_GATE = 16;
const clampGate = (g: number) => Math.round(Math.max(MIN_GATE, Math.min(MAX_GATE, g)) * 100) / 100;
const clampVel = (v: number) => Math.round(Math.max(0.05, Math.min(1, v)) * 100) / 100;

/** The track's notes, in the order of their steps (within the track's length). */
export function readNotes(t: RigTrack): RollNote[] {
  const out: RollNote[] = [];
  t.steps.slice(0, t.length).forEach((s, step) => {
    for (const note of s.notes) out.push({ step, note, gate: s.gates?.[note] ?? s.gate, vel: s.vels?.[note] ?? s.vel });
  });
  return out;
}

/**
 * Writes notes into a track in place of the ones it had: every step keeps its own settings (gate, velocity,
 * probability, micro-timing, mod, locks); two notes on one step and pitch become the later one.
 */
export function writeNotes(t: RigTrack, notes: RollNote[]): void {
  for (const s of t.steps) { s.notes = []; delete s.vels; delete s.gates; }
  for (const n of notes) {
    const s = t.steps[n.step];
    if (!s || n.step >= t.length || n.note < 0 || n.note > 127) continue;
    if (!s.notes.includes(n.note)) s.notes.push(n.note);
    const gate = clampGate(n.gate), vel = clampVel(n.vel);
    if (gate !== s.gate) s.gates = { ...s.gates, [n.note]: gate };
    else if (s.gates) { delete s.gates[n.note]; if (!Object.keys(s.gates).length) delete s.gates; }
    if (vel !== s.vel) s.vels = { ...s.vels, [n.note]: vel };
    else if (s.vels) { delete s.vels[n.note]; if (!Object.keys(s.vels).length) delete s.vels; }
  }
}

/**
 * Moves the selected notes by steps and semitones, together: as far as the furthest of them can go (none leaves the
 * track or the keyboard). With `copy`, the originals stay. Returns the notes and the moved ones' new keys.
 */
export function moveNotes(notes: RollNote[], selected: Set<string>, steps: number, semitones: number, length: number, copy = false) {
  const sel = notes.filter((n) => selected.has(rollKey(n)));
  if (!sel.length) return { notes, selected };
  const minStep = Math.min(...sel.map((n) => n.step)), maxStep = Math.max(...sel.map((n) => n.step));
  const lo = Math.min(...sel.map((n) => n.note)), hi = Math.max(...sel.map((n) => n.note));
  const ds = Math.max(-minStep, Math.min(length - 1 - maxStep, Math.round(steps)));
  const dn = Math.max(-lo, Math.min(127 - hi, Math.round(semitones)));
  const moved = sel.map((n) => ({ ...n, step: n.step + ds, note: n.note + dn }));
  const movedKeys = new Set(moved.map(rollKey));
  const rest = notes.filter((n) => (copy || !selected.has(rollKey(n))) && !movedKeys.has(rollKey(n)));
  return { notes: [...rest, ...moved], selected: movedKeys };
}

/** Lengthens (or shortens) the selected notes by the same number of steps. */
export function resizeNotes(notes: RollNote[], selected: Set<string>, by: number): RollNote[] {
  return notes.map((n) => (selected.has(rollKey(n)) ? { ...n, gate: clampGate(n.gate + by) } : n));
}

/** Scales the selected notes' velocities by an amount (added, 0..1 scale). */
export function nudgeVelocity(notes: RollNote[], selected: Set<string>, by: number): RollNote[] {
  return notes.map((n) => (selected.has(rollKey(n)) ? { ...n, vel: clampVel(n.vel + by) } : n));
}

export function deleteNotes(notes: RollNote[], selected: Set<string>): RollNote[] {
  return notes.filter((n) => !selected.has(rollKey(n)));
}

/** A clip: notes relative to the first's step, and how long it spans (to the end of its longest note, in steps). */
export interface RollClip {
  notes: RollNote[];
  span: number;
}

export function copyNotes(notes: RollNote[], selected: Set<string>): RollClip | undefined {
  const sel = notes.filter((n) => selected.has(rollKey(n)));
  if (!sel.length) return undefined;
  const first = Math.min(...sel.map((n) => n.step));
  const span = Math.max(...sel.map((n) => n.step - first + Math.max(1, Math.ceil(n.gate))));
  return { notes: sel.map((n) => ({ ...n, step: n.step - first })), span };
}

/** Pastes a clip at a step (what falls past the track is left out); the pasted notes are the new selection. */
export function pasteNotes(notes: RollNote[], clip: RollClip, at: number, length: number) {
  const pasted = clip.notes.map((n) => ({ ...n, step: n.step + at })).filter((n) => n.step >= 0 && n.step < length);
  const keys = new Set(pasted.map(rollKey));
  return { notes: [...notes.filter((n) => !keys.has(rollKey(n))), ...pasted], selected: keys };
}

/** The notes inside a box of steps (from, to: where they start) and pitches (lo..hi). */
export function notesIn(notes: RollNote[], from: number, to: number, lo: number, hi: number): Set<string> {
  return new Set(notes.filter((n) => n.step + n.gate > from && n.step <= to && n.note >= lo && n.note <= hi).map(rollKey));
}

/** Every note of some pitches. */
export const notesOfPitch = (notes: RollNote[], pitches: number[]): Set<string> =>
  new Set(notes.filter((n) => pitches.includes(n.note)).map(rollKey));

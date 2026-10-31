import { describe, expect, it } from 'vitest';
import {
  copyNotes, deleteNotes, moveNotes, notesIn, notesOfPitch, pasteNotes, readNotes, resizeNotes, rollKey, writeNotes, type RollNote,
} from '../../sequencer/pianoRoll';
import { newRigPattern } from '../../sequencer/rigSequencer';

const track = () => { const t = newRigPattern().tracks[0]!; t.length = 16; return t; };
const keys = (...ns: [number, number][]) => new Set(ns.map(([step, note]) => rollKey({ step, note })));
const notes: RollNote[] = [
  { step: 0, note: 60, gate: 1, vel: 0.8 }, { step: 0, note: 64, gate: 2, vel: 0.5 },
  { step: 4, note: 60, gate: 0.5, vel: 0.8 }, { step: 8, note: 67, gate: 4, vel: 1 },
];

describe('MOA-RIG piano roll: notes as a list', () => {
  it('reads and writes a track, keeping a note\'s own length and velocity only where they differ from its step\'s', () => {
    const t = track();
    t.steps[0]!.gate = 1; t.steps[0]!.vel = 0.8;
    t.steps[4]!.prob = 0.5; // a step's own settings stay
    writeNotes(t, notes);
    expect(t.steps[0]!.notes).toEqual([60, 64]);
    expect(t.steps[0]!.gates).toEqual({ 64: 2 });
    expect(t.steps[0]!.vels).toEqual({ 64: 0.5 });
    expect(t.steps[4]!.prob).toBe(0.5);
    expect(readNotes(t)).toEqual(notes);
  });

  it('moves a selection together, no further than the furthest can go, or copies it (alt-drag)', () => {
    const sel = keys([0, 60], [4, 60]);
    const moved = moveNotes(notes, sel, 2, 3, 16);
    expect(moved.selected).toEqual(keys([2, 63], [6, 63]));
    expect(moved.notes.map(rollKey).sort()).toEqual(['0:64', '2:63', '6:63', '8:67']);
    // past the end: as far as the last of them can go
    expect(moveNotes(notes, keys([8, 67]), 20, 0, 16).selected).toEqual(keys([15, 67]));
    expect(moveNotes(notes, keys([8, 67]), 0, 100, 16).selected).toEqual(keys([8, 127]));
    // a copy leaves the originals
    expect(moveNotes(notes, sel, 1, 0, 16, true).notes).toHaveLength(6);
  });

  it('lengthens a selection together within 1/4 to 16 steps, deletes it, and nudges its velocity', () => {
    const sel = keys([0, 60], [8, 67]);
    const longer = resizeNotes(notes, sel, 13);
    expect(longer.map((n) => n.gate)).toEqual([14, 2, 0.5, 16]);
    expect(resizeNotes(notes, keys([4, 60]), -2)[2]!.gate).toBe(0.25);
    expect(deleteNotes(notes, sel).map(rollKey)).toEqual(['0:64', '4:60']);
  });

  it('copies a selection as a clip (its span to the end of its longest note) and pastes it at a step', () => {
    const clip = copyNotes(notes, keys([0, 64], [4, 60]))!;
    expect(clip.span).toBe(5); // from step 0 to the end of the note at 4 (rounded up to a step)
    const pasted = pasteNotes(notes, clip, 12, 16);
    expect(pasted.selected).toEqual(keys([12, 64])); // the second would start at 16, past the end
    expect(pasted.notes).toHaveLength(5);
  });

  it('selects in a box (notes sounding in it) and every note of a pitch', () => {
    expect(notesIn(notes, 1, 5, 60, 64)).toEqual(keys([0, 64], [4, 60])); // the C at 0 ended by step 1; the E still sounds
    expect(notesOfPitch(notes, [60])).toEqual(keys([0, 60], [4, 60]));
  });
});

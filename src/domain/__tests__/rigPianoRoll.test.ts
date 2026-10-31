import { describe, expect, it } from 'vitest';
import { sanitiseMulti } from '../devices/rigMulti';
import { freshPart, noteGate, RigSynth } from '../devices/rigSynth';

describe('MOA-RIG piano roll: notes with their own lengths', () => {
  it('adds a note with its own length and velocity, lengthens it, and takes it away again', () => {
    const rig = new RigSynth();
    const s = () => rig.seq.pattern.tracks[0]!.steps[4]!;
    rig.addNote(0, 4, 60, 3, 0.7);
    rig.addNote(0, 4, 64, 1);
    expect(s().notes).toEqual([60, 64]);
    expect([noteGate(s(), 60), noteGate(s(), 64)]).toEqual([3, 1]);
    expect(s().vels).toEqual({ 60: 0.7 });
    rig.setNoteGate(0, 4, 64, 6.5);
    expect(noteGate(s(), 64)).toBe(6.5);
    rig.setNoteGate(0, 4, 64, 40); // at most 16 steps
    expect(noteGate(s(), 64)).toBe(16);
    rig.removeNote(0, 4, 60);
    expect(s().notes).toEqual([64]);
    expect(s().vels).toBeUndefined();
    expect(s().gates).toEqual({ 64: 16 });
  });

  it('moves a note in time and pitch with its length and velocity, leaving the others where they are', () => {
    const rig = new RigSynth();
    const steps = rig.seq.pattern.tracks[0]!.steps;
    rig.addNote(0, 0, 60, 2, 0.5);
    rig.addNote(0, 0, 67, 1);
    rig.moveNote(0, 0, 60, 8, 62);
    expect(steps[0]!.notes).toEqual([67]);
    expect(steps[8]!.notes).toEqual([62]);
    expect(noteGate(steps[8]!, 62)).toBe(2);
    expect(steps[8]!.vels).toEqual({ 62: 0.5 });
    expect(steps[0]!.gates).toEqual({ 67: 1 });
  });

  it('keeps each note\'s length through a transpose and through saving and loading the multi', () => {
    const rig = new RigSynth();
    rig.addNote(0, 2, 48, 4);
    rig.addNote(0, 2, 55, 0.5);
    rig.transposeStep(0, 2, 12);
    const step = rig.seq.pattern.tracks[0]!.steps[2]!;
    expect(step.gates).toEqual({ 60: 4, 67: 0.5 });
    const multi = rig.toMulti();
    const loaded = sanitiseMulti(JSON.parse(JSON.stringify(multi)), freshPart)!;
    expect(loaded.patterns[loaded.current]!.tracks[0]!.steps[2]!.gates).toEqual({ 60: 4, 67: 0.5 });
  });
});

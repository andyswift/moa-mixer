import { describe, expect, it } from 'vitest';
import { BassGuitar } from '../devices/bassGuitar';
import { DrillSession, part, promptLabel, TECHNIQUE, THEORY } from '../game/drills';
import { bassPosition, BASS_TUNING, describePosition, rootFifthShape } from '../game/fretboard';
import { GOOD_MS, GROOVES, grooveHits, grooveLengthBeats, GrooveSession, OK_MS } from '../game/groove';
import { defaultsOf, LessonSession } from '../game/lessonSession';
import { BASS_SOUND, targetValues } from '../game/lessons';
import { bassBase, CLEAN_BASS } from '../game/sounds';
import { PASS_MARK } from '../game/scoring';

const bt1 = TECHNIQUE.find((l) => l.id === 'B-T1')!;
const bh1 = THEORY.find((l) => l.id === 'B-H1')!;
const groove = GROOVES.find((l) => l.id === 'B-T2')!;

describe('the bass neck', () => {
  it('matches the MOA-BASS tuning', () => {
    expect([...new BassGuitar().standardNotes]).toEqual([...BASS_TUNING]);
  });

  it('finds notes in the first position, on the lowest string that has them there', () => {
    expect(bassPosition(28)).toEqual({ string: 0, fret: 0 }); // E1, open E
    expect(bassPosition(31)).toEqual({ string: 0, fret: 3 }); // G1
    expect(bassPosition(33)).toEqual({ string: 1, fret: 0 }); // A1: open A, not E fret 5
    expect(bassPosition(36)).toEqual({ string: 1, fret: 3 }); // C2
    expect(bassPosition(43)).toEqual({ string: 3, fret: 0 }); // G2
    expect(bassPosition(52)).toEqual({ string: 3, fret: 9 }); // beyond the first position
    expect(bassPosition(20)).toBeUndefined(); // below the low E
    expect(describePosition({ string: 1, fret: 3 })).toBe('A string, fret 3');
  });

  it('shows the fifth one string up, two frets along', () => {
    expect(rootFifthShape(29)).toEqual([{ string: 0, fret: 1 }, { string: 1, fret: 3 }]); // F to C
    expect(rootFifthShape(36)).toEqual([{ string: 1, fret: 3 }, { string: 2, fret: 5 }]); // C to G
    for (const r of [29, 31, 33, 36]) {
      const [a, b] = rootFifthShape(r);
      expect(BASS_TUNING[b!.string]! + b!.fret - (BASS_TUNING[a!.string]! + a!.fret)).toBe(7);
    }
  });
});

describe('B-T1 · the neck', () => {
  it('asks only for notes it taught, all of them on the bass', () => {
    const taught = new Set(bt1.prompts.filter((p) => part(p) === 'learn').map(promptLabel));
    for (const p of bt1.prompts) {
      expect(taught).toContain(promptLabel(p));
      if (p.kind === 'note') expect(bassPosition(12 * (p.octave! + 1) + p.pc)).toBeDefined();
    }
  });

  it('wants the exact note (the octave tells the strings apart)', () => {
    const s = new DrillSession(bt1);
    expect(s.keyDown(40)).toBe('wrong'); // E2 is not the open E string
    expect(s.keyDown(28)).toBe('right');
  });
});

describe('B-H1 · roots and fifths', () => {
  it('wants the root, then the fifth, in any octave', () => {
    const s = new DrillSession(bh1); // C first
    expect(s.keyDown(48)).toBeUndefined(); // C3: the root, the fifth still to come
    expect(s.sequenceStep).toBe(1);
    expect(s.keyDown(31)).toBe('right'); // G1
    expect(s.index).toBe(1);
  });

  it('starts the sequence again after a wrong note', () => {
    const s = new DrillSession(bh1);
    s.keyDown(36);
    expect(s.keyDown(40)).toBe('wrong'); // E is not the fifth of C
    expect(s.sequenceStep).toBe(0);
    expect(s.keyDown(43)).toBe('wrong'); // the fifth first is not the root
    s.keyDown(36);
    expect(s.keyDown(43)).toBe('right');
  });

  it('teaches each chord before it asks for it, and scores only what it asks', () => {
    const taught = new Set(bh1.prompts.filter((p) => part(p) === 'learn').map(promptLabel));
    for (const p of bh1.prompts) expect(taught).toContain(promptLabel(p));
    const s = new DrillSession(bh1);
    s.keyDown(1); // a wrong note while learning
    for (const p of bh1.prompts) if (p.kind === 'sequence') for (const n of p.notes) s.keyDown(36 + n);
    expect(s.done).toBe(true);
    expect(s.score).toBe(1);
  });
});

describe('B-S1 · pickup and tone', () => {
  const lesson = BASS_SOUND[0]!;

  it('names controls the MOA-BASS has, within their range', () => {
    const b = new BassGuitar();
    for (const [id, v] of Object.entries(targetValues(lesson))) {
      const c = b.control(id);
      if (c.kind === 'number') {
        expect(v as number).toBeGreaterThanOrEqual(c.min);
        expect(v as number).toBeLessThanOrEqual(c.max);
      }
    }
  });

  it('starts well short of the pass mark on the bass\'s own defaults, and matches at the target', () => {
    const b = new BassGuitar();
    const session = new LessonSession(b, lesson, defaultsOf(new BassGuitar()));
    expect(session.score()).toBeLessThan(PASS_MARK - 0.2);
    session.showTarget();
    expect(session.score()).toBe(1);
  });

  it('snapshots a device\'s defaults', () => {
    const d = defaultsOf(new BassGuitar());
    expect(d['tone']).toBe(3500);
    expect(d['cab.type']).toBeDefined();
  });
});

describe('B-T2 · lock to the kick', () => {
  const beat = 60000 / groove.bpm;

  it('lays the hits out bar by bar', () => {
    const hits = grooveHits(groove);
    expect(hits[0]).toEqual({ beat: 0, note: 28, bar: 0 });
    expect(hits[1]).toEqual({ beat: 2, note: 28, bar: 0 });
    expect(hits.length).toBe(24);
    expect(grooveLengthBeats(groove)).toBe(36);
  });

  it('grades by distance from the beat, and checks the note', () => {
    const s = new GrooveSession(groove, 1000);
    expect(s.play(28, 1000 + GOOD_MS - 5)).toMatchObject({ grade: 'good', hit: 0 });
    expect(s.play(28, 1000 + 2 * beat - (OK_MS - 5))).toMatchObject({ grade: 'close', hit: 1 });
    expect(s.play(31, 1000 + 4 * beat)).toMatchObject({ grade: 'wrong note', hit: 2 });
    expect(s.play(28, 1000 + 6 * beat + 200)).toMatchObject({ grade: 'off', hit: 3 });
    expect(s.play(28, 1000 + 5 * beat)).toEqual({ grade: 'extra' }); // no beat to play there
    expect(s.score).toBeCloseTo(1.5 / 24);
  });

  it('answers each beat once', () => {
    const s = new GrooveSession(groove, 0);
    expect(s.play(28, 0).hit).toBe(0);
    expect(s.play(28, 10)).toEqual({ grade: 'extra' });
  });

  it('passes a run played on every beat, and says when it is over', () => {
    const s = new GrooveSession(groove, 0);
    s.hits.forEach((h, i) => s.play(h.note + 12, s.due(i) + (i % 2 ? 20 : -20))); // any octave, a little either side
    expect(s.score).toBe(1);
    expect(s.passed).toBe(true);
    expect(s.finished(s.due(s.hits.length - 1))).toBe(false);
    expect(s.finished(s.due(s.hits.length - 1) + 300)).toBe(true);
  });

  it('knows which hit is next', () => {
    const s = new GrooveSession(groove, 0);
    expect(s.current(-500)).toBe(0);
    s.play(28, 0);
    expect(s.current(100)).toBe(1);
    expect(s.current(2 * beat + 400)).toBe(2); // hit 1 missed and out of reach
  });
});

describe('the game\'s bass sound', () => {
  it('turns the amp\'s drive and the output down from the MOA-BASS defaults, and keeps every other control', () => {
    const fresh = new BassGuitar();
    const base = bassBase();
    expect(base['amp.gain']).toBeLessThan((fresh.control('amp.gain') as { value: number }).value);
    expect(base['level']).toBeLessThan((fresh.control('level') as { value: number }).value);
    expect(Object.keys(base).length).toBe(fresh.controls.filter((c) => c.kind === 'number' || c.kind === 'choice').length);
  });

  it('is what the tone lesson starts from, so its start is clean too', () => {
    const b = new BassGuitar();
    new LessonSession(b, BASS_SOUND[0]!, bassBase());
    expect((b.control('amp.gain') as { value: number }).value).toBe(CLEAN_BASS['amp.gain']);
  });
});

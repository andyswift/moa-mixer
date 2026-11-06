import { describe, expect, it } from 'vitest';
import { PolySynth } from '../devices/polySynth';
import { Synthesizer } from '../devices/synthesizer';
import { answerLabel, DRILL_PASS_MARK, DrillSession, guideTriad, part, promptLabel, spellTriad, TECHNIQUE, THEORY, triad, voiceTriad, type PlayLesson } from '../game/drills';

const t1 = TECHNIQUE[0]!;
const h1 = THEORY[0]!;
const play = (s: DrillSession, keys: number[]) => {
  const results = keys.map((k) => s.keyDown(k));
  for (const k of keys) s.keyUp(k);
  return results;
};
/** A key for each prompt that answers it (middle octave for any-octave notes). */
const answer = (l: PlayLesson, i: number): number[] => {
  const p = l.prompts[i]!;
  if (p.kind === 'note') return [(p.octave === undefined ? 60 : 12 * (p.octave + 1)) + p.pc];
  return voiceTriad(p);
};

describe('T1 · note names', () => {
  it('accepts a note in any octave unless the prompt names one', () => {
    const s = new DrillSession(t1);
    expect(s.keyDown(36)).toBe('right'); // C2 for "C"
    expect(s.keyDown(76)).toBe('right'); // E5 for "E"
    for (let i = 2; i < 7; i++) play(s, answer(t1, i));
    expect(promptLabel(s.prompt!)).toBe('C4');
    expect(s.keyDown(48)).toBe('wrong'); // C3 is not middle C
    expect(s.keyDown(60)).toBe('right');
  });

  it('scores right-first-time answers, but needs every prompt answered', () => {
    const s = new DrillSession(t1);
    s.keyDown(61); // C# for "C": wrong
    s.keyDown(62); // still wrong: one miss counts once
    for (let i = 0; i < t1.prompts.length; i++) play(s, answer(t1, i));
    expect(s.done).toBe(true);
    expect(s.firstTry(0)).toBe(false);
    expect(s.firstTry(1)).toBe(true);
    expect(s.score).toBeCloseTo(0.9);
    expect(s.passed).toBe(true);
  });

  it('fails below the pass mark', () => {
    const s = new DrillSession(t1);
    for (let i = 0; i < t1.prompts.length; i++) {
      if (i < 4) s.keyDown(1); // a wrong key first on four prompts
      play(s, answer(t1, i));
    }
    expect(s.score).toBeLessThan(DRILL_PASS_MARK);
    expect(s.passed).toBe(false);
  });
});

describe('H1 · triads', () => {
  it('spells major and minor triads', () => {
    expect(triad({ kind: 'chord', root: 0, quality: 'major' })).toEqual([0, 4, 7]);
    expect(triad({ kind: 'chord', root: 9, quality: 'minor' })).toEqual([9, 0, 4]);
    expect(answerLabel({ kind: 'chord', root: 9, quality: 'minor' })).toBe('A minor · A C E');
    expect(spellTriad({ kind: 'chord', root: 0, quality: 'minor' })).toEqual(['C', 'E\u266d', 'G']);
    expect(spellTriad({ kind: 'chord', root: 2, quality: 'major' })).toEqual(['D', 'F\u266f', 'A']);
    expect(spellTriad({ kind: 'chord', root: 7, quality: 'major' })).toEqual(['G', 'B', 'D']);
    expect(promptLabel({ kind: 'chord', root: 2, quality: 'minor', byEar: true })).toBe('D ?');
  });

  it('judges a chord once three keys are down, in any octave or order', () => {
    const s = new DrillSession(h1); // C major first
    expect(s.keyDown(55)).toBeUndefined(); // G3
    expect(s.keyDown(64)).toBeUndefined(); // E4
    expect(s.keyDown(72)).toBe('right'); // C5: G E C is still C major
    expect(s.index).toBe(1);
  });

  it('waits for every key to be up before the next chord, and judges once per attempt', () => {
    const s = new DrillSession(h1);
    play(s, [60, 64, 67]); // C major
    // C minor next: C major held again is wrong, and a fourth key does not judge again
    expect(s.keyDown(60)).toBeUndefined();
    s.keyDown(64);
    expect(s.keyDown(67)).toBe('wrong');
    expect(s.keyDown(69)).toBeUndefined();
    for (const k of [60, 64, 67, 69]) s.keyUp(k);
    expect(play(s, [60, 63, 67])).toEqual([undefined, undefined, 'right']);
    expect(s.firstTry(1)).toBe(false);
  });

  it('teaches each chord before testing it, and does not score the teaching', () => {
    const parts = h1.prompts.map(part);
    const firstTest = parts.indexOf('test');
    expect(parts.slice(0, firstTest).every((p) => p === 'learn')).toBe(true);
    const taught = new Set(h1.prompts.slice(0, firstTest).map((p) => promptLabel(p)));
    for (const p of h1.prompts.slice(firstTest)) {
      if (p.kind === 'chord') expect(taught, `${promptLabel(p)} is tested but not taught`).toContain(`${promptLabel({ ...p, byEar: false })}`);
    }
    const s = new DrillSession(h1);
    s.keyDown(1); s.keyDown(2); s.keyDown(3); // a wrong chord while learning
    for (const k of [1, 2, 3]) s.keyUp(k);
    for (let i = 0; i < h1.prompts.length; i++) play(s, answer(h1, i));
    expect(s.firstTry(0)).toBe(false);
    expect(s.score).toBe(1);
  });

  it('shows the chord to copy around middle C', () => {
    expect(guideTriad({ kind: 'chord', root: 0, quality: 'major' })).toEqual([60, 64, 67]);
  });

  it('does not count a chord left held over into the next prompt', () => {
    const s = new DrillSession(h1);
    s.keyDown(60); s.keyDown(64); s.keyDown(67); // right, then still held
    expect(s.keyDown(69)).toBeUndefined(); // a key added to the held chord is not an answer to A minor
    expect(s.index).toBe(1);
  });

  it('rejects three keys that are not the triad', () => {
    const s = new DrillSession(h1);
    s.keyDown(60); s.keyDown(62);
    expect(s.keyDown(64)).toBe('wrong'); // C D E is not C major
  });

  it('can be passed by playing every answer', () => {
    const s = new DrillSession(h1);
    for (let i = 0; i < h1.prompts.length; i++) play(s, answer(h1, i));
    expect(s.passed).toBe(true);
    expect(s.score).toBe(1);
  });
});

describe('playing lessons', () => {
  it('set sounds the instruments can load', () => {
    for (const l of [...TECHNIQUE, ...THEORY]) {
      const sound = { name: l.id, values: l.instrument.sound };
      if (l.instrument.kind === 'mono') expect(() => new Synthesizer().loadPreset(sound)).not.toThrow();
      else expect(() => new PolySynth('Poly').loadPreset(sound)).not.toThrow();
    }
  });

  it('have unique ids across the tracks', () => {
    const ids = [...TECHNIQUE, ...THEORY].map((l) => l.id);
    expect(new Set(ids).size).toBe(ids.length);
  });
});

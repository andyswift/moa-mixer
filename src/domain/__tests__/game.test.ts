import { describe, expect, it } from 'vitest';
import { Synthesizer } from '../devices/synthesizer';
import { INIT } from '../devices/synthPresets';
import { KNOB_COUNT, knobIndex, learnKnob } from '../game/knobs';
import { LessonSession, REVEAL_AFTER } from '../game/lessonSession';
import { noteName, SOUND_DESIGN, targetValues } from '../game/lessons';
import { level, loadProgress, NEW_GAME, recordPass, saveProgress } from '../game/progress';
import { overall, PASS_MARK, position, scoreControl } from '../game/scoring';
import { type ChoiceControl, NumberControl } from '../devices/controls';

describe('game scoring', () => {
  const cutoff = () => new NumberControl('c', 'Cutoff', 20, 20000, 800, 'Hz', () => {}, 'log');

  it('places log controls on a log scale', () => {
    const c = cutoff();
    expect(position(c, 20)).toBeCloseTo(0);
    expect(position(c, 20000)).toBeCloseTo(1);
    expect(position(c, Math.sqrt(20 * 20000))).toBeCloseTo(0.5);
  });

  it('scores a match within tolerance and falls to zero at four tolerances', () => {
    const c = cutoff();
    c.set(1000);
    expect(scoreControl(c, 1000, 0.05)).toEqual({ id: 'c', match: 1, direction: 'ok' });
    // 0.1 of the travel above the target: two tolerances out, so a third of the way down from a match
    c.set(1000 * Math.pow(1000, 0.1));
    const s = scoreControl(c, 1000, 0.05);
    expect(s.direction).toBe('high');
    expect(s.match).toBeCloseTo(2 / 3);
    c.set(20000);
    expect(scoreControl(c, 1000, 0.05).match).toBe(0);
  });

  it('scores a ratio the same at any height (the ear hears ratios)', () => {
    const c = cutoff();
    c.set(200);
    const low = scoreControl(c, 100, 0.05).match;
    c.set(4000);
    expect(scoreControl(c, 2000, 0.05).match).toBeCloseTo(low);
  });

  it('scores a switch as right or wrong, with the way to move it', () => {
    const s = new Synthesizer();
    const range = s.control('osc.range') as ChoiceControl;
    range.set("8'");
    expect(scoreControl(range, "16'", 0)).toMatchObject({ match: 0, direction: 'high' });
    range.set("16'");
    expect(scoreControl(range, "16'", 0)).toMatchObject({ match: 1, direction: 'ok' });
  });

  it('averages the controls', () => {
    expect(overall([{ id: 'a', match: 1, direction: 'ok' }, { id: 'b', match: 0.5, direction: 'low' }])).toBe(0.75);
  });
});

describe('the Sound Design lessons', () => {
  it('only name controls the MOA-1 has, with values it accepts', () => {
    const s = new Synthesizer();
    for (const lesson of SOUND_DESIGN) {
      for (const [id, value] of Object.entries(targetValues(lesson))) {
        const c = s.control(id);
        if (c.kind === 'number') {
          expect(typeof value, `${lesson.id} ${id}`).toBe('number');
          expect(value as number).toBeGreaterThanOrEqual(c.min);
          expect(value as number).toBeLessThanOrEqual(c.max);
        } else if (c.kind === 'choice') expect(c.options, `${lesson.id} ${id}`).toContain(value);
      }
      for (const c of lesson.controls) expect(lesson.target[c.id], `${lesson.id} target for ${c.id}`).toBeDefined();
      expect(Object.keys(lesson.target).sort()).toEqual(lesson.controls.map((c) => c.id).sort());
      expect(lesson.controls.length).toBeLessThanOrEqual(KNOB_COUNT);
    }
  });

  it('start well short of the pass mark and reach a full score at the target', () => {
    for (const lesson of SOUND_DESIGN) {
      const session = new LessonSession(new Synthesizer(), lesson);
      expect(session.score(), `${lesson.id} at its start`).toBeLessThan(PASS_MARK - 0.2);
      session.showTarget();
      expect(session.score(), `${lesson.id} at its target`).toBe(1);
    }
  });

  it('have unique ids and riffs the player can play', () => {
    expect(new Set(SOUND_DESIGN.map((l) => l.id)).size).toBe(SOUND_DESIGN.length);
    for (const l of SOUND_DESIGN) {
      expect(l.riff.length).toBeGreaterThan(0);
      for (const n of [...l.riff, ...l.demo.notes.map((d) => d.note)]) expect(n >= 21 && n <= 108).toBe(true);
    }
  });
});

describe('a lesson session', () => {
  const s3 = SOUND_DESIGN.find((l) => l.id === 'S3')!;

  it('loads the lesson start over INIT', () => {
    const synth = new Synthesizer();
    (synth.control('drive') as NumberControl).set(0.9);
    new LessonSession(synth, s3);
    expect(synth.control('drive').value).toBe(INIT.drive);
    expect(synth.control('filterEnv.decay').value).toBe(1.2);
  });

  it('lets knob n turn only the lesson control n, on the control curve', () => {
    const synth = new Synthesizer();
    const session = new LessonSession(synth, s3);
    expect(session.turnKnob(1, 0)?.id).toBe('filterEnv.decay');
    expect(synth.control('filterEnv.decay').value).toBeCloseTo(0.005);
    expect(session.turnKnob(3, 64)).toBeUndefined(); // S3 has three controls
  });

  it('passes when the knobs reach the target', () => {
    const synth = new Synthesizer();
    const session = new LessonSession(synth, s3);
    expect(session.check().passed).toBe(false);
    (synth.control('filterEnv.amount') as NumberControl).set(3.4);
    (synth.control('filterEnv.decay') as NumberControl).set(0.21);
    (synth.control('filterEnv.sustain') as NumberControl).set(0.03);
    const result = session.check();
    expect(result.passed).toBe(true);
    expect(result.scores.every((s) => s.direction === 'ok')).toBe(true);
  });

  it('swaps the target in and gives the player their own sound back', () => {
    const synth = new Synthesizer();
    const session = new LessonSession(synth, s3);
    (synth.control('filterEnv.decay') as NumberControl).set(0.7);
    session.showTarget();
    expect(synth.control('filterEnv.decay').value).toBe(0.2);
    expect(session.turnKnob(1, 0)).toBeUndefined(); // knobs wait while the target plays
    session.showYours();
    expect(synth.control('filterEnv.decay').value).toBe(0.7);
  });

  it('reveals the target after enough checks', () => {
    const session = new LessonSession(new Synthesizer(), s3);
    for (let i = 0; i < REVEAL_AFTER; i++) {
      expect(session.revealed).toBe(false);
      session.check();
    }
    expect(session.revealed).toBe(true);
  });

  it('follows the riff, ignoring wrong notes', () => {
    const session = new LessonSession(new Synthesizer(), s3);
    expect(session.playRiffNote(60)).toBe(false);
    for (const n of s3.riff) expect(session.playRiffNote(n)).toBe(true);
    expect(session.riffDone).toBe(true);
  });
});

describe('knob setup', () => {
  it('learns new knobs in order, skipping the mod wheel, pedals and repeats', () => {
    let k: number[] = [];
    for (const cc of [1, 74, 74, 64, 71, 7, 20, 21, 22]) k = learnKnob(k, cc);
    expect(k).toEqual([74, 71, 20, 21]);
    expect(knobIndex(k, 20)).toBe(2);
    expect(knobIndex(k, 99)).toBe(-1);
  });
});

describe('progress', () => {
  it('gives XP once per lesson, plus a little for a better score', () => {
    let p = recordPass({ ...NEW_GAME }, 'S1', 100, 0.8);
    expect(p.xp).toBe(140);
    p = recordPass(p, 'S1', 100, 0.8);
    expect(p.xp).toBe(140);
    p = recordPass(p, 'S1', 100, 1);
    expect(p.xp).toBe(150);
    expect(p.passed.S1).toBe(1);
    expect(level(p.xp)).toBe(2);
  });

  it('survives a round trip and junk in storage', () => {
    const store = new Map<string, string>();
    const storage = { getItem: (k: string) => store.get(k) ?? null, setItem: (k: string, v: string) => void store.set(k, v) };
    saveProgress({ band: 'The Filters', knobs: [74, 71], passed: { S1: 0.9 }, xp: 90 }, storage);
    expect(loadProgress(storage)).toEqual({ band: 'The Filters', knobs: [74, 71], passed: { S1: 0.9 }, xp: 90 });
    store.set('virtualRockstar.progress', '{not json');
    expect(loadProgress(storage)).toEqual(NEW_GAME);
  });
});

describe('note names', () => {
  it('names middle C C4', () => {
    expect(noteName(60)).toBe('C4');
    expect(noteName(45)).toBe('A2');
  });
});

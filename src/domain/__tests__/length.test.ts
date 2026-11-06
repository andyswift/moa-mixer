import { describe, expect, it } from 'vitest';
import { LENGTH_LESSONS, lengthLessonById, lengthLessonScore } from '../game/lengthLessons';
import { cuesOf, DEAD_VELOCITY, lengthGrade, PALM_WHEEL, PartJudge, withPalm } from '../game/performance';
import { loadProgress } from '../game/progress';
import { songById } from '../game/songs';
import { adviceFor, gigOutcome, recordGig, venueById } from '../game/tour';

const beatMs = 500;
const longNote = (t: number, len: number, note = 36, vel = 100) => ({ t, len, note, vel });

describe('note lengths', () => {
  it('grade a hold against the written length, with a little give either way', () => {
    expect(lengthGrade(2000, 1900)).toBe('good');
    expect(lengthGrade(2000, 1200)).toBe('short');
    expect(lengthGrade(2000, 2800)).toBe('long');
    expect(lengthGrade(150, 250)).toBe('good'); // short notes get at least 120 ms either way
    expect(lengthGrade(150, 300)).toBe('long');
  });

  it('are measured from the first note to the first one let go', () => {
    const j = new PartJudge(cuesOf([longNote(0, 4), longNote(4, 4)]), 0, beatMs);
    j.play(36, 10);
    expect(j.holdShare(0, 1010)).toBeCloseTo(0.5);
    expect(j.release(36, 1950)).toEqual({ cue: 0, length: 'good' });
    expect(j.release(36, 2100)).toEqual({}); // that note is no longer held
    j.play(36, 2000);
    expect(j.release(36, 2600)).toEqual({ cue: 1, length: 'short' });
    expect(j.lengthStats()).toEqual({ measured: 2, good: 1, short: 1, long: 0 });
  });

  it('leave the score alone when off, raise it as a bonus, and share it when scored', () => {
    const cues = cuesOf([longNote(0, 2), longNote(2, 2), longNote(4, 2), longNote(6, 2)]);
    const run = (lengths: 'off' | 'bonus' | 'scored', holdMs: number) => {
      const j = new PartJudge(cues, 0, beatMs, 0.4, { lengths });
      for (let i = 0; i < 2; i++) { j.play(36, j.due(i)); j.release(36, j.due(i) + holdMs); } // two of four played
      return j.score;
    };
    expect(run('off', 1000)).toBe(0.5);
    expect(run('bonus', 1000)).toBeCloseTo(0.5 + 0.5 * 0.25 * 1);
    expect(run('bonus', 200)).toBe(0.5); // a bonus never lowers it
    expect(run('scored', 1000)).toBe(0.5);
    expect(run('scored', 200)).toBeCloseTo(0.5 * 0.6);
  });
});

describe('touch', () => {
  const deadCue = cuesOf([longNote(0, 0.2, 36, 30)]);

  it('makes soft notes dead notes, any pitch', () => {
    expect(deadCue[0]!.dead).toBe(true);
    const j = new PartJudge(deadCue, 0, beatMs, 0.4, { touch: true });
    expect(j.play(61, 0, DEAD_VELOCITY).result?.grade).toBe('good');
    const loud = new PartJudge(deadCue, 0, beatMs, 0.4, { touch: true });
    expect(loud.play(36, 0, 100).result).toMatchObject({ grade: 'wrong', why: 'not dead' });
  });

  it('wants the palm (the mod wheel up) where the part is palm-muted, and full notes elsewhere', () => {
    const cues = withPalm(cuesOf([longNote(0, 0.4), longNote(1, 0.4)]), [[0, 1]]);
    expect(cues.map((c) => !!c.palm)).toEqual([true, false]);
    const j = new PartJudge(cues, 0, beatMs, 0.4, { touch: true });
    expect(j.play(36, 0, 100, 0).result).toMatchObject({ grade: 'wrong', why: 'no palm' });
    const k = new PartJudge(cues, 0, beatMs, 0.4, { touch: true });
    expect(k.play(36, 0, 100, PALM_WHEEL).result?.grade).toBe('good');
    expect(k.play(36, beatMs, 20).result).toMatchObject({ grade: 'wrong', why: 'too soft' });
  });

  it('is not judged unless asked (gigs)', () => {
    const j = new PartJudge(deadCue, 0, beatMs);
    expect(j.play(40, 0, 120).result?.grade).toBe('good');
  });
});

describe('the length lessons', () => {
  it('teach pads then stabs on the synth; long and short, the palm, and dead notes on the bass', () => {
    const t2 = lengthLessonById('T2')!;
    expect(t2.song.sections.map((s) => s.name)).toEqual(['Count-in', 'Pads', 'Stabs']);
    const cues = cuesOf(t2.song.parts.synth);
    const pads = cues.filter((c) => c.t < 20);
    const stabs = cues.filter((c) => c.t >= 20);
    expect(Math.min(...pads.map((c) => c.len))).toBeGreaterThan(3);
    expect(Math.max(...stabs.map((c) => c.len))).toBeLessThan(0.5);
    const bt3 = lengthLessonById('B-T3')!;
    expect(bt3.song.sections.map((s) => s.name)).toEqual(['Count-in', 'Long', 'Short']);
    expect(bt3.touch).toBe(false);
    const bt4 = lengthLessonById('B-T4')!;
    expect(bt4.song.sections.map((s) => s.name)).toEqual(['Count-in', 'Open', 'Palm']);
    expect(bt4.song.palm).toEqual([[20, 36]]);
    expect(cuesOf(bt4.song.parts.bass).some((c) => c.dead)).toBe(false);
    expect(bt4.touch).toBe(true);
    const bt5 = lengthLessonById('B-T5')!;
    expect(bt5.song.sections.map((s) => s.name)).toEqual(['Count-in', 'Dead notes alone', 'With roots']);
    expect(bt5.song.palm).toBeUndefined();
    const bt5Cues = cuesOf(bt5.song.parts.bass);
    const alone = bt5Cues.filter((c) => c.t < 20);
    expect(alone.length).toBe(8);
    expect(alone.every((c) => c.dead)).toBe(true);
    expect(bt5Cues.filter((c) => c.dead).every((c) => c.t % 2 === 1)).toBe(true); // on beats 2 and 4 only
    expect(bt5.touch).toBe(true);
    // slower than the songs, so there is time to think about the hand
    expect(Math.max(bt3.song.bpm, bt4.song.bpm, bt5.song.bpm)).toBeLessThanOrEqual(80);
  });

  it('can be passed by playing them as written, and failed by ignoring the lengths and the touch', () => {
    for (const l of LENGTH_LESSONS) {
      const cues = withPalm(cuesOf(l.song.parts[l.role]), l.song.palm ?? []);
      const good = new PartJudge(cues, 0, 60000 / l.song.bpm, 0.4, { lengths: 'scored', touch: l.touch });
      const sloppy = new PartJudge(cues, 0, 60000 / l.song.bpm, 0.4, { lengths: 'scored', touch: l.touch });
      cues.forEach((c, i) => {
        const vel = c.dead ? 30 : 100;
        const wheel = c.palm ? 0.8 : 0;
        for (const n of c.notes) good.play(n, good.due(i), vel, wheel);
        for (const n of c.notes) good.release(n, good.due(i) + c.len * good.beatMs);
        // the sloppy player ignores what the lessons teach: every note stabbed short, full, with the palm off
        for (const n of c.notes) sloppy.play(n, sloppy.due(i), 100, 0);
        for (const n of c.notes) sloppy.release(n, sloppy.due(i) + 60);
      });
      expect(lengthLessonScore(l, good), l.id).toBeGreaterThan(0.95);
      expect(lengthLessonScore(l, sloppy), l.id).toBeLessThan(0.85);
    }
  });
});

describe('Northside Club', () => {
  it('has a minor-key song, pads and stabs, palm-muted verses and dead notes', () => {
    const v = venueById('northside');
    const songs = v.setlist.map(songById);
    expect(songs[0]!.chords[0]!.name).toBe('Dm');
    expect(songs[0]!.palm?.length).toBe(2);
    expect(songs.some((s) => cuesOf(s.parts.bass).some((c) => c.dead))).toBe(true);
    expect(v.lengths).toBe('bonus');
  });

  it('is about four good Cellar gigs away', () => {
    const cellar = venueById('cellar');
    let p = loadProgress(undefined);
    let gigs = 0;
    while (p.fans < venueById('northside').needs.fans) {
      p = recordGig(p, 'bass', cellar, gigOutcome(cellar, [0.85, 0.85, 0.85], 0.75, gigs === 0));
      gigs++;
    }
    expect(gigs).toBe(4);
    expect(gigOutcome(cellar, [1, 1, 1], 1, true).wordOfMouth).toBeGreaterThan(0);
    expect(gigOutcome(cellar, [1, 1, 1], 1, false).wordOfMouth).toBe(0);
  });

  it('advises the length lesson when notes were held wrong', () => {
    const base = { cues: 100, good: 90, close: 10, off: 0, wrong: 0, missed: 0, meanOffsetMs: 0 };
    const short = adviceFor('synth', { ...base, lengths: { measured: 40, good: 20, short: 18, long: 2 } }, 'x');
    expect(short[0]).toMatchObject({ lesson: { kind: 'length', id: 'T2' } });
    expect(short[0]!.text).toMatch(/early/);
    const long = adviceFor('bass', { ...base, lengths: { measured: 40, good: 20, short: 2, long: 18 } }, 'x');
    expect(long[0]).toMatchObject({ lesson: { id: 'B-T3', title: 'Long and short notes' } });
    const tight = adviceFor('bass', { ...base, lengths: { measured: 40, good: 38, short: 1, long: 1 } }, 'x');
    expect(tight).toHaveLength(1);
    expect(tight[0]!.lesson).toBeUndefined();
    expect(tight[0]!.song).toBeUndefined(); // nothing to rehearse after a tight set
  });
});

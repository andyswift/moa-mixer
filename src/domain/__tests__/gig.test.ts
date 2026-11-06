import { describe, expect, it } from 'vitest';
import { MAIN_VOICES } from '../devices/drumMachine';
import { triad } from '../game/drills';
import { bassPosition } from '../game/fretboard';
import { GOOD_MS, OK_MS } from '../game/groove';
import { bandmateSlipMs, cuesOf, humanise, PartJudge, REACH_MS } from '../game/performance';
import { loadProgress } from '../game/progress';
import { StepSession, stepsOf } from '../game/rehearsal';
import { chordAt, sectionAt, songBeats, songById, SONGS } from '../game/songs';
import { adviceFor, canBook, gigOutcome, recordGig, recordRehearsal, REHEARSED_MARK, venueById, VENUES } from '../game/tour';

describe('the songs', () => {
  it('have unique ids, sections end to end and every beat in a section', () => {
    expect(new Set(SONGS.map((s) => s.id)).size).toBe(SONGS.length);
    for (const s of SONGS) {
      expect(s.sections[0]!.from).toBe(0);
      for (let i = 1; i < s.sections.length; i++) expect(s.sections[i]!.from).toBe(s.sections[i - 1]!.to);
      expect(s.sections[s.sections.length - 1]!.to).toBe(songBeats(s));
    }
  });

  it('play only notes the bass can play, each the root or fifth of its chord', () => {
    for (const s of SONGS) for (const n of s.parts.bass) {
      expect(bassPosition(n.note), `${s.id} ${n.note}`).toBeDefined();
      const c = chordAt(s, n.t)!;
      expect([c.root, (c.root + 7) % 12], `${s.id} beat ${n.t}`).toContain(n.note % 12);
    }
  });

  it('play only the chords H1 teaches, as whole triads, on the chord of the moment', () => {
    for (const s of SONGS) for (const cue of cuesOf(s.parts.synth)) {
      const c = chordAt(s, cue.t)!;
      expect(['C', 'G', 'Am', 'F', 'Dm', 'Cm']).toContain(c.name);
      expect(cue.pcs).toEqual([...triad({ kind: 'chord', root: c.root, quality: c.quality })].sort((a, b) => a - b));
    }
  });

  it('keep the parts inside the song, after the intro', () => {
    for (const s of SONGS) {
      const introEnd = s.sections[0]!.to;
      for (const n of [...s.parts.bass, ...s.parts.synth]) {
        expect(n.t).toBeGreaterThanOrEqual(introEnd);
        expect(n.t + n.len).toBeLessThanOrEqual(songBeats(s));
      }
      for (const d of s.drums) expect(MAIN_VOICES).toContain(d.voice);
    }
  });

  it('get harder through the set', () => {
    const notesPerBar = SONGS.map((s) => cuesOf(s.parts.bass).length / s.bars);
    expect(notesPerBar[0]).toBeLessThan(notesPerBar[1]!);
    expect(SONGS.map((s) => s.bpm)).toEqual([...SONGS.map((s) => s.bpm)].sort((a, b) => a - b));
    expect(sectionAt(SONGS[0]!, 9)!.name).toBe('Verse 1');
  });
});

describe('cues', () => {
  it('group notes that start together', () => {
    const cues = cuesOf([{ t: 0, len: 1, note: 60, vel: 90 }, { t: 0, len: 2, note: 64, vel: 90 }, { t: 0, len: 1, note: 67, vel: 90 }, { t: 1, len: 1, note: 48, vel: 90 }]);
    expect(cues).toEqual([{ t: 0, len: 2, notes: [60, 64, 67], pcs: [0, 4, 7] }, { t: 1, len: 1, notes: [48], pcs: [0] }]);
  });
});

describe('the part judge', () => {
  const beatMs = 500;
  const chordCues = cuesOf([0, 4, 7].map((n) => ({ t: 0, len: 1, note: 60 + n, vel: 90 })).concat([9, 12, 16].map((n) => ({ t: 2, len: 1, note: 60 + n, vel: 90 }))));

  it('grades a chord once all its notes are in, by its first note', () => {
    const j = new PartJudge(chordCues, 1000, beatMs);
    expect(j.play(60, 1000 + 20)).toEqual({ cue: 0 });
    expect(j.play(64, 1000 + 40)).toEqual({ cue: 0 });
    expect(j.play(79, 1000 + 60).result).toEqual({ grade: 'good', offsetMs: 20 }); // G in any octave
    expect(j.play(57, 2000 - OK_MS + 5).result).toBeUndefined();
    j.play(60, 2000); j.play(64, 2000);
    expect(j.results[1]).toEqual({ grade: 'close', offsetMs: -(OK_MS - 5) });
  });

  it('marks a wrong note at once, and misses what nobody played', () => {
    const j = new PartJudge(chordCues, 0, beatMs);
    expect(j.play(61, 10).result?.grade).toBe('wrong');
    expect(j.settle(1000 + REACH_MS + 1)).toEqual([1]);
    expect(j.results[1]).toEqual({ grade: 'missed' });
    expect(j.finished(1000 + REACH_MS + 1)).toBe(true);
  });

  it('counts half a chord as off, and keeps a streak and a crowd', () => {
    const notes = Array.from({ length: 12 }, (_, i) => ({ t: i, len: 1, note: 36, vel: 90 }));
    const j = new PartJudge(cuesOf(notes), 0, beatMs);
    const start = j.crowd;
    for (let i = 0; i < 10; i++) j.play(36, i * beatMs + (i % 2 ? GOOD_MS - 1 : -10));
    expect(j.streak).toBe(10);
    expect(j.crowd).toBeGreaterThan(start);
    j.play(37, 10 * beatMs);
    expect(j.streak).toBe(0);
    expect(j.bestStreak).toBe(10);
    const half = new PartJudge(chordCues, 0, beatMs);
    half.play(60, 0);
    half.settle(REACH_MS + 1);
    expect(half.results[0]?.grade).toBe('off');
  });

  it('scores a whole song played on the beat', () => {
    for (const s of SONGS) for (const role of ['bass', 'synth'] as const) {
      const cues = cuesOf(s.parts[role]);
      const j = new PartJudge(cues, 0, 60000 / s.bpm);
      cues.forEach((c, i) => { for (const n of c.notes) j.play(n + 12, j.due(i) + 8); });
      expect(j.score, `${s.id} ${role}`).toBe(1);
      expect(j.counts().good).toBe(cues.length);
    }
  });

  it('tells rushing from dragging', () => {
    const notes = Array.from({ length: 4 }, (_, i) => ({ t: i, len: 1, note: 36, vel: 90 }));
    const j = new PartJudge(cuesOf(notes), 0, beatMs);
    for (let i = 0; i < 4; i++) j.play(36, i * beatMs - 60);
    expect(j.meanOffsetMs()).toBe(-60);
  });
});

describe('bandmates', () => {
  it('play looser at a low level, tighter as they level up, the same way every time', () => {
    expect(bandmateSlipMs(1)).toBeGreaterThan(bandmateSlipMs(4));
    expect(bandmateSlipMs(20)).toBe(5);
    const part = SONGS[0]!.parts.bass;
    const a = humanise(part, 500, 20, 7);
    expect(humanise(part, 500, 20, 7)).toEqual(a);
    for (let i = 0; i < part.length; i++) expect(Math.abs(a[i]!.t - part[i]!.t) * 500).toBeLessThanOrEqual(20 + 1e-9);
  });
});

describe('rehearsal steps', () => {
  const s = songById('first-light');

  it('fold repeats into one step with a count', () => {
    const verse = s.sections.find((x) => x.name === 'Verse 1')!;
    const steps = stepsOf(cuesOf(s.parts.bass), verse.from, verse.to);
    expect(steps.map((x) => [x.pcs[0], x.count])).toEqual([[0, 2], [7, 2], [9, 2], [5, 2]]); // C G Am F, twice a bar
  });

  it('wait for each step, judging chords when all their keys are down', () => {
    const verse = s.sections.find((x) => x.name === 'Verse 1')!;
    const session = new StepSession(stepsOf(cuesOf(s.parts.synth), verse.from, verse.to)); // C G Am F
    session.keyDown(60); session.keyDown(64);
    expect(session.keyDown(69)).toBe('wrong');
    for (const k of [60, 64, 69]) session.keyUp(k);
    session.keyDown(60); session.keyDown(64);
    expect(session.keyDown(67)).toBe('right');
    expect(session.index).toBe(0); // right, still held: the step has not changed
    expect(session.keyDown(71)).toBeUndefined(); // keys pressed meanwhile are not answers
    for (const k of [60, 64, 67]) expect(session.keyUp(k)).toBe(false);
    expect(session.keyUp(71)).toBe(true); // the last key up: next step
    expect(session.index).toBe(1);
    expect(session.wrong).toBe(1);
  });

  it('moves a single-note step on when the key comes up', () => {
    const verse = s.sections.find((x) => x.name === 'Verse 1')!;
    const session = new StepSession(stepsOf(cuesOf(s.parts.bass), verse.from, verse.to)); // C, G, Am, F roots
    expect(session.keyDown(36)).toBe('right');
    expect(session.index).toBe(0);
    expect(session.keyUp(36)).toBe(true);
    expect(session.step!.pcs).toEqual([7]);
  });
});

describe('the tour', () => {
  it('opens the Cellar Bar once every song has been run at full tempo', () => {
    let p = loadProgress(undefined);
    const cellar = venueById('cellar');
    expect(canBook(p, 'bass', cellar).ok).toBe(false);
    for (const id of cellar.setlist) p = recordRehearsal(p, 'bass', id, REHEARSED_MARK);
    expect(canBook(p, 'bass', cellar)).toEqual({ ok: true });
    expect(canBook(p, 'synth', cellar).ok).toBe(false); // each member rehearses for themselves
    expect(canBook(p, 'bass', venueById('northside')).why).toMatch(/Coming|fans/);
  });

  it('pays by score and crowd, and remembers it', () => {
    const cellar = venueById('cellar');
    const great = gigOutcome(cellar, [1, 1, 1], 1);
    expect(great).toMatchObject({ stars: 5, fans: cellar.maxFans, cash: cellar.fee });
    const poor = gigOutcome(cellar, [0.2, 0.3, 0.1], 0.2);
    expect(poor.stars).toBe(1);
    expect(poor.cash).toBeGreaterThanOrEqual(cellar.fee / 2);
    const p = recordGig(loadProgress(undefined), 'bass', cellar, great);
    expect(p).toMatchObject({ fans: cellar.maxFans, cash: cellar.fee, gigs: 1, gigBest: { cellar: 1 } });
    expect(p.xp.bass).toBe(great.xp);
    expect(VENUES.map((v) => v.needs.fans)).toEqual([...VENUES.map((v) => v.needs.fans)].sort((a, b) => a - b));
  });

  it('advises the lesson that teaches what went wrong', () => {
    const base = { cues: 100, good: 70, close: 5, off: 5, wrong: 10, missed: 10, meanOffsetMs: 0 };
    const bass = adviceFor('bass', base, 'static-hearts');
    expect(bass[0]!.lesson?.id).toBe('B-H1');
    expect(bass.some((a) => a.song === 'static-hearts')).toBe(true);
    expect(adviceFor('bass', { ...base, wrong: 0, missed: 0, meanOffsetMs: -50 }, 'x')[0]!).toMatchObject({ lesson: { id: 'B-T2' } });
    expect(adviceFor('bass', { ...base, wrong: 0, missed: 0, meanOffsetMs: -50 }, 'x')[0]!.text).toMatch(/rushing/);
    expect(adviceFor('synth', base, 'x')[0]!.lesson?.id).toBe('H1');
    expect(adviceFor('synth', { ...base, off: 0, wrong: 0, missed: 0 }, 'night-bus')).toHaveLength(1);
  });
});

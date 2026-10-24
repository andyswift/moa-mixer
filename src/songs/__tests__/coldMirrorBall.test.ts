import { describe, expect, it } from 'vitest';
import { coldMirrorBall } from '../library/coldMirrorBall';
import { automationValue } from '../player';
import { songBeats } from '../types';

describe('Cold Mirror Ball', () => {
  const song = coldMirrorBall();
  const sections = song.sections!;
  const within = (name: string) => (t: number) => sections.some((s) => s.name === name && t >= s.from && t < s.to);

  it('names its sections end to end, from the first beat to the last', () => {
    expect(sections[0]!.from).toBe(0);
    for (let k = 1; k < sections.length; k++) expect(sections[k]!.from).toBe(sections[k - 1]!.to);
    expect(sections.at(-1)!.to).toBe(songBeats(song));
    expect(sections.map((s) => s.name).join(' ')).toBe('Intro Hook Lift Hook′ Fog Lift′ Hook″ Outro End');
  });

  it('keeps to B minor', () => {
    const key = new Set([11, 1, 2, 4, 6, 7, 9]); // B C# D E F# G A
    for (const [page, notes] of Object.entries(song.tracks)) {
      if (page === 'kit') continue;
      for (const n of notes!) expect(key.has(n.note % 12), `${page} ${n.note} at beat ${n.t}`).toBe(true);
    }
  });

  it('plays every note on the instruments that play it (the guitar within its 22 frets, the basses within 24)', () => {
    for (const n of song.tracks.guitar!) expect(n.note).toBeGreaterThanOrEqual(40), expect(n.note).toBeLessThanOrEqual(86);
    for (const n of [...song.tracks.bass!, ...song.tracks.bass2!]) expect(n.note).toBeGreaterThanOrEqual(28), expect(n.note).toBeLessThanOrEqual(67);
  });

  it('is four on the floor wherever the band is dancing: a kick on every beat of every Hook', () => {
    const kicks = new Set(song.tracks.kit!.filter((n) => n.note === 36).map((n) => n.t));
    for (const s of sections.filter((x) => x.name.startsWith('Hook'))) {
      for (let b = s.from; b < s.to; b++) if ((b - s.from) % 32 < 28) expect(kicks.has(b), `kick at beat ${b}`).toBe(true); // the fill bars aside
    }
  });

  it('has the free bass carry the tune, never picked hard (a bass picked hard by the bridge goes sharp)', () => {
    const tune = song.tracks.bass2!.filter((n) => within('Hook')(n.t));
    expect(tune.length).toBeGreaterThan(30);
    expect(Math.min(...tune.map((n) => n.note))).toBeGreaterThanOrEqual(50); // high on the neck
    for (const n of song.tracks.bass2!) expect(n.vel).toBeLessThanOrEqual(100);
  });

  it('chorus on the guitar throughout, turned to flanger only in the Fog', () => {
    expect(song.setup.guitar!.guitar!.controls!['chorus.mix']).toBeGreaterThan(0.4);
    const flange = song.automation.find((a) => a.page === 'guitar' && a.control === 'chorus.flange')!;
    for (const s of sections) expect(automationValue(flange, (s.from + s.to) / 2)).toBe(s.name === 'Fog' ? 1 : 0);
  });
});

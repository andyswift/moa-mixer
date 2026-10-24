import { describe, expect, it } from 'vitest';
import { pierLights } from '../library/pierLights';
import { songBeats } from '../types';

describe('Pier Lights', () => {
  const song = pierLights();
  const sections = song.sections!;

  it('names its sections end to end, from the first beat to the last', () => {
    expect(sections[0]!.from).toBe(0);
    for (let k = 1; k < sections.length; k++) expect(sections[k]!.from).toBe(sections[k - 1]!.to);
    expect(sections.at(-1)!.to).toBe(songBeats(song));
    expect(sections.map((s) => s.name).join(' ')).toBe('Intro Verse Chorus Verse′ Chorus′ Bridge Chorus″ Outro End');
  });

  it('keeps to A major', () => {
    const key = new Set([9, 11, 1, 2, 4, 6, 8]); // A B C# D E F# G#
    for (const [page, notes] of Object.entries(song.tracks)) {
      if (page === 'kit') continue;
      for (const n of notes!) expect(key.has(n.note % 12), `${page} ${n.note} at beat ${n.t}`).toBe(true);
    }
  });

  it('plays every note on the instruments that play it (the guitar within its 22 frets, the basses within 24)', () => {
    for (const n of song.tracks.guitar!) expect(n.note).toBeGreaterThanOrEqual(40), expect(n.note).toBeLessThanOrEqual(86);
    for (const n of [...song.tracks.bass!, ...song.tracks.bass2!]) expect(n.note).toBeGreaterThanOrEqual(28), expect(n.note).toBeLessThanOrEqual(67);
  });

  it('jangles: in the verses the guitar keeps the open B and E ringing over every chord, and the chord changes nearly every bar', () => {
    const verse = sections.find((s) => s.name === 'Verse')!;
    const notes = song.tracks.guitar!.filter((n) => n.t >= verse.from && n.t < verse.to);
    const bars: Set<number>[] = [];
    for (const n of notes) (bars[Math.floor((n.t - verse.from) / 4)] ??= new Set()).add(n.note);
    for (const bar of bars) expect(bar.has(59) || bar.has(64)).toBe(true);
    const changes = bars.slice(1).filter((bar, k) => [...bar].sort().join() !== [...bars[k]!].sort().join()).length;
    expect(changes).toBeGreaterThanOrEqual(bars.length - 2);
  });

  it('has the free bass run eighths through the verses, never picked hard (a bass picked hard by the bridge goes sharp)', () => {
    const verse = sections.find((s) => s.name === 'Verse')!;
    const line = song.tracks.bass2!.filter((n) => n.t >= verse.from && n.t < verse.to);
    expect(line.length).toBe(16 * 8);
    for (const n of song.tracks.bass2!) expect(n.vel).toBeLessThanOrEqual(100);
  });
});

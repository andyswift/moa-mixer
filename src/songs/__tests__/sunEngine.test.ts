import { describe, expect, it } from 'vitest';
import { sunEngine } from '../library/sunEngine';
import { automationValue } from '../player';
import { songBeats } from '../types';

describe('Sun Engine', () => {
  const song = sunEngine();
  const sections = song.sections!;
  const inSection = (name: string) => (t: number) => sections.some((s) => s.name === name && t >= s.from && t < s.to);

  it('names its sections end to end, from the first beat to the last', () => {
    expect(sections[0]!.from).toBe(0);
    for (let k = 1; k < sections.length; k++) expect(sections[k]!.from).toBe(sections[k - 1]!.to);
    expect(sections.at(-1)!.to).toBe(songBeats(song));
    expect(sections.map((s) => s.name).join(' ')).toBe('Intro Vamp Jam Peak Space Vamp′ Peak End');
  });

  it('keeps to E dorian, but for the blue note in the peak riff (a B flat power chord: B flat and F)', () => {
    const key = new Set([4, 6, 7, 9, 11, 1, 2]); // E F# G A B C# D
    const peak = inSection('Peak');
    for (const [page, notes] of Object.entries(song.tracks)) {
      if (page === 'kit') continue;
      for (const n of notes!) expect(key.has(n.note % 12) || (peak(n.t) && (n.note % 12 === 10 || n.note % 12 === 5)), `${page} ${n.note} at beat ${n.t}`).toBe(true);
    }
  });

  it('plays every note on the instruments that play it (the guitar within its 22 frets, the basses above their low E)', () => {
    for (const n of song.tracks.guitar!) expect(n.note).toBeGreaterThanOrEqual(40), expect(n.note).toBeLessThanOrEqual(86);
    for (const n of [...song.tracks.bass!, ...song.tracks.bass2!]) expect(n.note).toBeGreaterThanOrEqual(28), expect(n.note).toBeLessThanOrEqual(67);
  });

  it('bends the lead in the jam, and has the strings back in tune before the next note is picked', () => {
    const tension = song.automation.filter((a) => a.page === 'guitar' && a.control.endsWith('.tension'));
    expect(tension).toHaveLength(6);
    const jam = inSection('Jam');
    const notes = song.tracks.guitar!;
    let bent = 0;
    const peak = inSection('Peak');
    for (const n of notes) {
      if (peak(n.t)) continue; // the guitarist freaking out (below)
      const up = automationValue(tension[0]!, n.t + n.len - 0.01) / automationValue(tension[0]!, 0);
      for (const a of tension) expect(automationValue(a, n.t), `struck in tune at ${n.t}`).toBeCloseTo(automationValue(a, 0), 5);
      if (up > 1.1) {
        bent++;
        expect(jam(n.t)).toBe(true);
      }
    }
    expect(bent).toBeGreaterThanOrEqual(8);
  });

  it('puts the guitarist out of tune at the peaks only, by at most 10 cents', () => {
    const tension = song.automation.filter((a) => a.page === 'guitar' && a.control.endsWith('.tension'));
    for (const s of sections.filter((x) => x.name !== 'Jam')) {
      const mid = (s.from + s.to) / 2;
      const drift = tension.map((a) => Math.abs(automationValue(a, mid) / automationValue(a, 0) - 1));
      if (s.heat < 0.8) for (const d of drift) expect(d).toBe(0);
      else expect(Math.max(...drift)).toBeGreaterThan(0);
      for (const d of drift) expect(d).toBeLessThan(0.012);
    }
  });

  it('lets the free bass take off in the space without picking hard (a bass picked hard by the bridge goes sharp)', () => {
    const flight = song.tracks.bass2!.filter((n) => inSection('Space')(n.t));
    expect(flight.length).toBeGreaterThan(30);
    for (const n of flight) expect(n.vel).toBeLessThanOrEqual(100);
  });
});

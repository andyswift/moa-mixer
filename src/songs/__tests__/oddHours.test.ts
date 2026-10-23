import { describe, expect, it } from 'vitest';
import { oddHours } from '../library/oddHours';
import { automationValue } from '../player';
import { songBeats } from '../types';

describe('Odd Hours', () => {
  const song = oddHours();
  const sections = song.sections!;

  it('names its sections end to end, from the first beat to the last, switching often', () => {
    expect(sections[0]!.from).toBe(0);
    for (let k = 1; k < sections.length; k++) expect(sections[k]!.from).toBeCloseTo(sections[k - 1]!.to, 9);
    expect(sections.at(-1)!.to).toBeCloseTo(songBeats(song), 9);
    expect(sections.map((s) => s.name).join(' ')).toBe('Intro A B A D B A′ C D B′ A′ End');
  });

  it('puts the guitarist out of tune only when it is heavy, and back in tune after', () => {
    const tension = song.automation.filter((a) => a.page === 'guitar' && a.control.endsWith('.tension'));
    expect(tension).toHaveLength(6);
    for (const s of sections) {
      const mid = (s.from + s.to) / 2;
      const drift = tension.map((a) => Math.abs(automationValue(a, mid) / automationValue(a, 0) - 1));
      if (s.heat < 0.8) for (const d of drift) expect(d).toBe(0);
      else expect(Math.max(...drift)).toBeGreaterThan(0); // somewhere off, by at most 10 cents (about 1.2 % of tension)
      for (const d of drift) expect(d).toBeLessThan(0.012);
    }
  });

  it('has the guitarist dig in harder and nearer the bridge when it is heavy', () => {
    const strength = song.automation.find((a) => a.page === 'guitar' && a.control === 'pluck.strength')!;
    const calm = sections.find((s) => s.name === 'A')!, heavy = sections.find((s) => s.name === 'C')!;
    expect(automationValue(strength, heavy.from + 1)).toBeGreaterThan(automationValue(strength, calm.from + 1) + 0.2);
  });
});

describe('Odd Hours: the free bass leading in D', () => {
  it('stays in tune: no harder pick and no hard accents (a bass picked hard by the bridge goes 30 cents and more sharp)', () => {
    const song = oddHours();
    expect(song.automation.find((a) => a.page === 'bass2' && a.control === 'pluck.strength')).toBeUndefined();
    const d = song.sections!.filter((s) => s.name === 'D');
    const lead = song.tracks.bass2!.filter((n) => d.some((s) => n.t >= s.from && n.t < s.to));
    expect(lead.length).toBeGreaterThan(50);
    for (const n of lead) expect(n.vel).toBeLessThanOrEqual(100);
  });
});

describe('Odd Hours: keeping in key', () => {
  it('has the free bass play only notes of the key (A major, F# minor) in every B section', () => {
    const song = oddHours();
    const key = new Set([9, 11, 1, 2, 4, 6, 8]); // A B C# D E F# G#
    const b = song.sections!.filter((s) => s.name === 'B' || s.name === 'B′');
    const notes = song.tracks.bass2!.filter((n) => b.some((s) => n.t >= s.from && n.t < s.to));
    expect(notes.length).toBeGreaterThan(50);
    for (const n of notes) expect(key.has(n.note % 12), `note ${n.note} at beat ${n.t}`).toBe(true);
  });
});

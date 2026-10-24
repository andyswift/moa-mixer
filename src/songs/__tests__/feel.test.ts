import { describe, expect, it } from 'vitest';
import { seeded, withDynamics } from '../feel';
import { coldMirrorBall } from '../library/coldMirrorBall';
import { oddHours } from '../library/oddHours';
import { pierLights } from '../library/pierLights';
import { sunEngine } from '../library/sunEngine';
import { note } from '../generators';

describe('feel', () => {
  it('a seeded random gives the same numbers every time', () => {
    const a = seeded(7), b = seeded(7);
    for (let k = 0; k < 5; k++) expect(a()).toBe(b());
  });

  it('dynamics scale velocities, keep a dead note dead and cap the rest', () => {
    const out = withDynamics([note(0, 1, 40, 36), note(1, 1, 40, 90), note(2, 1, 40, 120)], () => 1.2, 100);
    expect(out.map((n) => n.vel)).toEqual([40, 100, 100]);
    expect(withDynamics([note(0, 1, 40, 100)], () => 0.5)[0]!.vel).toBe(50);
  });
});

describe('the band played, not sequenced', () => {
  for (const song of [oddHours(), sunEngine(), coldMirrorBall(), pierLights()]) {
    it(`${song.title}: the band's backbeat rises and falls by section`, () => {
      const loudness = song.sections!.map((s) => {
        const hits = song.tracks.kit!.filter((n) => (n.note === 38 || n.note === 37) && n.vel > 60 && n.t >= s.from && n.t < s.to);
        return hits.length ? hits.reduce((a, n) => a + n.vel, 0) / hits.length : undefined;
      }).filter((x): x is number => x !== undefined);
      expect(Math.max(...loudness) / Math.min(...loudness)).toBeGreaterThan(1.15);
    });

    it(`${song.title}: the kit never plays the same four bars twice running`, () => {
      const beats = song.sections!.at(-1)!.to;
      const windows: string[] = [];
      for (let from = 0; from + 16 <= beats; from += 16) {
        windows.push(song.tracks.kit!.filter((n) => n.t >= from && n.t < from + 16).map((n) => `${(n.t - from).toFixed(3)}:${n.note}`).join());
      }
      for (let k = 1; k < windows.length; k++) if (windows[k]) expect(windows[k], `bars from beat ${k * 16}`).not.toBe(windows[k - 1]);
    });
  }
});

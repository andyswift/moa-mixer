import { describe, expect, it } from 'vitest';
import { loadProgress } from '../game/progress';
import { calibrate, DEFAULT_THRESHOLD, GAME_DEAD_MAX, mapVelocity } from '../game/touch';

describe('touch setup', () => {
  it('puts the threshold between soft and normal, nearer soft', () => {
    const t = calibrate([52, 58, 55, 60], [96, 104, 100, 92]);
    expect(t.sensitive).toBe(true);
    expect(t.threshold).toBeGreaterThanOrEqual(60); // every soft note counts as dead
    expect(t.threshold).toBeLessThan(92); // no normal note does
  });

  it('notices a keyboard that does not answer velocity', () => {
    expect(calibrate([100, 100, 100], [100, 100, 100]).sensitive).toBe(false);
    expect(calibrate([90, 95], [100, 98]).sensitive).toBe(false);
  });

  it('maps soft notes into the dead range and the rest above it, keeping the order', () => {
    const threshold = 64;
    expect(mapVelocity(64, threshold)).toBe(GAME_DEAD_MAX);
    expect(mapVelocity(30, threshold)).toBeLessThanOrEqual(GAME_DEAD_MAX);
    expect(mapVelocity(65, threshold)).toBeGreaterThan(GAME_DEAD_MAX);
    expect(mapVelocity(127, threshold)).toBe(127);
    let last = 0;
    for (let v = 1; v <= 127; v++) { const m = mapVelocity(v, threshold); expect(m).toBeGreaterThanOrEqual(last); last = m; }
  });

  it('leaves velocities as they were at the default threshold', () => {
    for (const v of [1, 20, 40, 41, 80, 127]) expect(Math.abs(mapVelocity(v, DEFAULT_THRESHOLD) - v)).toBeLessThanOrEqual(1);
  });

  it('is remembered with the progress', () => {
    const store = new Map<string, string>([['virtualRockstar.progress', JSON.stringify({ band: 'X', touch: { threshold: 66, sensitive: true } })]]);
    expect(loadProgress({ getItem: (k) => store.get(k) ?? null }).touch).toEqual({ threshold: 66, sensitive: true });
    expect(loadProgress(undefined).touch).toBeUndefined();
  });
});

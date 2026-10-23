import { describe, expect, it } from 'vitest';
import {
  GUITAR_GAUGES, GUITAR_SCALES, NEWTONS_PER_POUND, coilWeights, linearDensity, midiToHz, modes, pickupWeights, tensionFor,
} from '../devices/bassPhysics';

const L = GUITAR_SCALES['25.5"'];
const LB_PER_IN = 0.45359237 / 0.0254; // kg/m per lb/in
/** D'Addario EXL110 (10-46): unit weight (lb/in) and tension at 25.5" (lb), from the maker's chart. */
const EXL110 = {
  e: [0.00002215, 16.2], B: [0.00003744, 15.4], G: [0.00006402, 16.6], D: [0.00012671, 18.4], A: [0.00023964, 19.5], E: [0.00037284, 17.5],
} as const;

describe('a set of electric guitar strings', () => {
  it('weighs what a real 10-46 set weighs, plain and wound strings alike (within 3 %)', () => {
    for (const [name, [weight]] of Object.entries(EXL110)) {
      const mu = linearDensity(GUITAR_GAUGES[name as keyof typeof GUITAR_GAUGES]);
      expect(Math.abs(mu / (weight * LB_PER_IN) - 1)).toBeLessThan(0.03);
    }
  });

  it('needs the tension a real set does to reach standard tuning at 25.5" (within 3 %)', () => {
    for (const [name, [, lb]] of Object.entries(EXL110)) {
      const g = GUITAR_GAUGES[name as keyof typeof GUITAR_GAUGES];
      expect(Math.abs(tensionFor(g, L, midiToHz(g.note)) / NEWTONS_PER_POUND / lb - 1)).toBeLessThan(0.03);
    }
  });

  it('a plain string is all core: its mass is the steel wire\'s, and it keeps its overtones longer than a wound one', () => {
    const e = GUITAR_GAUGES.e;
    expect(linearDensity(e)).toBeCloseTo(7850 * (Math.PI / 4) * e.outer ** 2, 12);
    const G = GUITAR_GAUGES.G, D = GUITAR_GAUGES.D;
    const plain = modes(G, L, tensionFor(G, L, midiToHz(G.note)), 3000);
    const wound = modes(D, L, tensionFor(D, L, midiToHz(D.note)), 3000);
    expect(plain.at(-1)!.sigma).toBeLessThan(wound.at(-1)!.sigma * 0.5); // both near 3 kHz
  });

  it('coils add: a humbucker is two pickups side by side, and two pickups together cancel some modes', () => {
    const one = pickupWeights(L, 30, 0.042), two = pickupWeights(L, 30, 0.1);
    const both = coilWeights(L, 30, [{ position: 0.042, gain: 1 }, { position: 0.1, gain: 1 }]);
    both.forEach((w, n) => expect(w).toBeCloseTo(one[n]! + two[n]!, 12));
    // a mode heard in opposite phase by the two (one past a node of it, one before) nearly vanishes: the "quack"
    const opposite = both.findIndex((_, n) => one[n]! * two[n]! < 0 && Math.abs(one[n]! + two[n]!) < 0.5 * Math.max(Math.abs(one[n]!), Math.abs(two[n]!)));
    expect(opposite).toBeGreaterThan(0);
  });
});

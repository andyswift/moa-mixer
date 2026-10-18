import { describe, expect, it } from 'vitest';
import {
  FINGER, GAUGES, NEWTONS_PER_POUND, PICK, SCALES, contactDamping, fretLength, idealFrequency, inharmonicity, linearDensity, midiToHz,
  modes, noteOf, pickupWeights, pluckAmplitudes, tensionFor,
} from '../devices/bassPhysics';

const E = GAUGES.E;
const L = SCALES.long;
const LB_PER_IN = 0.45359237 / 0.0254; // kg/m per lb/in

describe('a bass string under tension', () => {
  it('weighs what a real .105 E string weighs (D\'Addario EXL170: 0.00223 lb/in)', () => {
    const mu = linearDensity(E);
    expect(Math.abs(mu / (0.00223 * LB_PER_IN) - 1)).toBeLessThan(0.03);
  });

  it('needs the tension a real one does to reach E1 at 34" (EXL170: 44.7 lb)', () => {
    const T = tensionFor(E, L, midiToHz(28));
    expect(Math.abs(T / NEWTONS_PER_POUND / 44.7 - 1)).toBeLessThan(0.03);
  });

  it('rises in pitch with the square root of tension', () => {
    const T = tensionFor(E, L, midiToHz(28));
    expect(idealFrequency(E, L, T)).toBeCloseTo(midiToHz(28), 6);
    expect(idealFrequency(E, L, 4 * T) / idealFrequency(E, L, T)).toBeCloseTo(2, 10); // four times the pull: an octave
    expect(noteOf(idealFrequency(E, L, T * Math.pow(2, 2 / 12))).cents).toBeCloseTo(0, 6); // 12 % more pull: a tone up
  });

  it('fretting shortens the string so each fret is a semitone and the 12th an octave', () => {
    expect(fretLength(L, 12)).toBeCloseTo(L / 2, 12);
    const T = tensionFor(E, L, midiToHz(28));
    for (const fret of [1, 5, 7, 12, 24]) expect(noteOf(idealFrequency(E, fretLength(L, fret), T)).note).toBe(28 + fret);
  });

  it('is stiff enough to stretch its overtones sharp, as bass strings are (B of order 1e-4 to 1e-3)', () => {
    const T = tensionFor(E, L, midiToHz(28));
    const B = inharmonicity(E, L, T);
    expect(B).toBeGreaterThan(1e-4);
    expect(B).toBeLessThan(2e-3);
    const m = modes(E, L, T, 20000);
    expect(m[9]!.hz / (10 * m[0]!.hz)).toBeGreaterThan(1.02); // the 10th partial is several cents sharp
    // a shorter (fretted) string is relatively stiffer: B grows as 1/L^2
    expect(inharmonicity(E, fretLength(L, 12), T)).toBeCloseTo(4 * B, 10);
  });

  it('loses its overtones first, and flatwounds lose them sooner', () => {
    const T = tensionFor(E, L, midiToHz(28));
    const round = modes(E, L, T, 5000);
    expect(round[30]!.sigma).toBeGreaterThan(round[0]!.sigma * 5);
    const flat = modes({ ...E, winding: 'flat' }, L, T, 5000);
    expect(flat[30]!.sigma).toBeGreaterThan(round[30]!.sigma * 2);
  });

  const harmonic = (count: number) => Array.from({ length: count }, (_, i) => 41.2 * (i + 1));

  it('a pluck in the middle excites no even harmonics; near the bridge it is brighter', () => {
    const sharp = { height: 0.003, width: 0.001, release: 0 };
    const mid = pluckAmplitudes(L, harmonic(9), { position: L / 2, ...sharp });
    for (const n of [2, 4, 6, 8]) expect(Math.abs(mid[n - 1]!)).toBeLessThan(1e-12);
    const bridge = pluckAmplitudes(L, harmonic(9), { position: 0.08, ...sharp });
    expect(Math.abs(bridge[8]! / bridge[0]!)).toBeGreaterThan(Math.abs(mid[8]! / mid[0]!) * 1.5); // the same (9th) harmonic
    // the triangle's peak displacement is the pull height
    const tri = pluckAmplitudes(L, harmonic(400), { position: L / 3, height: 0.003, width: 0, release: 0 });
    const atPluck = tri.reduce((sum, a, i) => sum + a * Math.sin(((i + 1) * Math.PI * (L / 3)) / L), 0);
    expect(atPluck).toBeCloseTo(0.003, 4);
  });

  it('a fingertip is darker than a pick: wider, and it lets go gradually', () => {
    const finger = pluckAmplitudes(L, harmonic(40), { position: 0.12, height: 0.003, ...FINGER });
    const pick = pluckAmplitudes(L, harmonic(40), { position: 0.12, height: 0.003, ...PICK });
    expect(Math.abs(finger[34]!)).toBeLessThan(Math.abs(pick[34]!) * 0.5); // about 1.4 kHz
    expect(finger[0]! / pick[0]!).toBeGreaterThan(0.99); // the fundamental is the same
  });

  it('a pickup hears nothing of a mode with a node at its position; a damper only damps the modes that move there', () => {
    const w = pickupWeights(L, 4, L / 2, 0);
    expect(Math.abs(w[1]!)).toBeLessThan(1e-12);
    const d = contactDamping(L, 4, L / 2, 10);
    expect(d[1]!).toBeLessThan(1e-20);
    expect(d[0]!).toBeCloseTo(10, 10);
  });
});

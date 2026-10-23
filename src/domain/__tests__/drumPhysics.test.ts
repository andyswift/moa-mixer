import { describe, expect, it } from 'vitest';
import {
  AIR, KIT_CYMBALS, KIT_DRUMS, besselJ, besselZeros, contactTime, cymbalModes, domeHz, drumModes, drumTensionFor, edgeDamping,
  nearField, patchAverage, pulseSpectrum, strikeVelocities, type DrumSpec,
} from '../devices/drumPhysics';

const TOM = KIT_DRUMS.tom;
const T150 = drumTensionFor(TOM, 150);
const modes = drumModes(TOM, T150, 60);
const energyAbove = (v: number[], hz: number) => v.reduce((s, x, k) => s + (modes[k]!.hz > hz ? x * x : 0), 0);

describe('Bessel functions', () => {
  it('match tabulated values and zeros (Abramowitz and Stegun)', () => {
    expect(besselJ(0, 0)).toBeCloseTo(1, 12);
    expect(besselJ(1, 1)).toBeCloseTo(0.4400505857, 9);
    expect(besselJ(2, 5)).toBeCloseTo(0.0465651163, 9);
    expect(besselJ(0, 30)).toBeCloseTo(-0.0863679835, 9);
    expect(besselZeros(0, 3)).toEqual([expect.closeTo(2.40483, 4), expect.closeTo(5.52008, 4), expect.closeTo(8.65373, 4)]);
    expect(besselZeros(1, 1)[0]).toBeCloseTo(3.83171, 4);
    expect(besselZeros(2, 1)[0]).toBeCloseTo(5.13562, 4);
    expect(besselZeros(5, 1)[0]).toBeCloseTo(8.77148, 4);
  });
});

describe('a drumhead', () => {
  it('in a vacuum, without a shell, has the ideal membrane\'s inharmonic overtones', () => {
    // a very deep shell (no air spring) and the air's loading divided back out: j_mn / j_01
    const open: DrumSpec = { ...TOM, depth: 1e9 };
    const m = drumModes(open, 1000, 6);
    const mass = (j: number) => 0.4 + (2 * AIR.rho * TOM.diameter / 2) / j;
    const vacuum = m.map((x) => x.hz * Math.sqrt(mass(x.j) / 0.4));
    expect(vacuum[1]! / vacuum[0]!).toBeCloseTo(3.8317 / 2.4048, 4);
    expect(vacuum[2]! / vacuum[0]!).toBeCloseTo(5.1356 / 2.4048, 4);
    expect(m[0]!.hz).toBeLessThan(vacuum[0]!); // the air it carries lowers it
  });

  it('on a shell, its fundamental rises and (1,1) lands near 1.5 times it, as measured on real toms', () => {
    const ratio = modes.find((x) => x.m === 1)!.hz / modes[0]!.hz;
    expect(ratio).toBeGreaterThan(1.4);
    expect(ratio).toBeLessThan(1.6);
  });

  it('is tuned by tension: the tension for a pitch gives that pitch, and more tension is higher', () => {
    expect(modes[0]!.hz).toBeCloseTo(150, 6);
    expect(drumModes(TOM, T150 * 1.5, 1)[0]!.hz).toBeGreaterThan(150 * 1.15);
    for (const [id, hz] of [['kick', 55], ['snare', 210], ['floor', 95]] as const) {
      const T = drumTensionFor(KIT_DRUMS[id], hz);
      expect(T).toBeGreaterThan(300); // real heads are tuned at about 0.5 to 5 kN/m
      expect(T).toBeLessThan(6000);
      expect(drumModes(KIT_DRUMS[id], T, 1)[0]!.hz).toBeCloseTo(hz, 6);
    }
  });

  it('loses its air-moving fundamental fastest (the thud) while (1,1) rings on', () => {
    expect(modes[0]!.sigma).toBeGreaterThan(modes.find((x) => x.m === 1)!.sigma * 1.5);
  });

  it('hit in the centre excites only the modes without nodal diameters', () => {
    const v = strikeVelocities(TOM, modes, { r: 0, velocity: 0.7, contact: contactTime('stick', 0.7) });
    modes.forEach((mode, k) => { if (mode.m > 0) expect(Math.abs(v[k]!)).toBeLessThan(1e-9); else expect(Math.abs(v[k]!)).toBeGreaterThan(0); });
  });

  it('hit softly is darker: the stick stays on longer', () => {
    expect(contactTime('stick', 0.2)).toBeGreaterThan(contactTime('stick', 1));
    const hard = strikeVelocities(TOM, modes, { r: 0.4, velocity: 1, contact: contactTime('stick', 1) });
    const soft = strikeVelocities(TOM, modes, { r: 0.4, velocity: 0.2, contact: contactTime('stick', 0.2) });
    const share = (v: number[]) => energyAbove(v, 600) / energyAbove(v, 0);
    expect(share(soft)).toBeLessThan(share(hard));
    expect(pulseSpectrum(0, 0.001)).toBe(1);
  });

  it('a felt beater\'s wide face excites the short modes less than a stick tip does', () => {
    const k = 60; // 1/m
    expect(patchAverage(k, 0.03)).toBeLessThan(patchAverage(k, 0.005));
    expect(patchAverage(0, 0.03)).toBe(1);
  });

  it('muffling at the edge adds damping', () => {
    edgeDamping(modes, 1).forEach((d) => expect(d).toBeGreaterThanOrEqual(0));
    expect(edgeDamping(modes, 1)[10]!).toBeGreaterThan(edgeDamping(modes, 0.2)[10]!);
  });

  it('a close microphone hears the low end louder than a distant one (the near field)', () => {
    expect(nearField(50, 0.1) / nearField(5000, 0.1)).toBeGreaterThan(10);
    expect(nearField(5000, 3)).toBeCloseTo(1, 4);
  });
});

describe('a cymbal', () => {
  it('follows Chladni\'s law: modes without nodal circles rise as the square of their nodal diameters', () => {
    const m = cymbalModes(KIT_CYMBALS.crash, 400);
    const ring = (k: number) => m.find((x) => x.n === 0 && x.m === k)!.hz;
    expect(ring(20) / ring(10)).toBeCloseTo(4, 6);
  });

  it('its dome stiffens the modes with nodal circles, and a heavier cymbal is higher', () => {
    const m = cymbalModes(KIT_CYMBALS.ride, 400);
    const circle = m.find((x) => x.n === 1 && x.m === 0)!;
    expect(circle.hz).toBeGreaterThan(domeHz(KIT_CYMBALS.ride));
    const heavy = cymbalModes({ ...KIT_CYMBALS.ride, thickness: KIT_CYMBALS.ride.thickness * 1.25 }, 400);
    expect(heavy.find((x) => x.n === 0 && x.m === 10)!.hz / m.find((x) => x.n === 0 && x.m === 10)!.hz).toBeCloseTo(1.25, 6);
  });

  it('rings for seconds at the bottom and less at the top', () => {
    const m = cymbalModes(KIT_CYMBALS.crash, 300);
    expect(6.9 / m[5]!.sigma).toBeGreaterThan(5); // 60 dB down after more than five seconds
    expect(m.at(-1)!.sigma).toBeGreaterThan(m[5]!.sigma * 2);
  });
});

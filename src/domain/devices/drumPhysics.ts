/**
 * The physics of an acoustic drum kit: drumheads (stretched membranes over an air-filled shell) and cymbals (thin
 * bronze plates), in SI units, so they can be tested against the textbook formulas. The sound is made from these
 * numbers in `kitWorklet.ts` (modal synthesis: one damped oscillator per mode).
 *
 * Drums (Fletcher and Rossing, The Physics of Musical Instruments, ch. 3, 18):
 * - A membrane of radius a, tension T (N/m) and surface density sigma (kg/m^2) has modes (m, n): m nodal diameters,
 *   n nodal circles (the edge included), at f = j_mn c / (2 pi a), c = sqrt(T / sigma), j_mn the n-th zero of the
 *   Bessel function J_m. The shape is J_m(j_mn r / a) cos(m theta). The overtones are not harmonic: (1,1) is 1.59 times
 *   (0,1), (2,1) 2.14 times.
 * - The air loads the head: a mode of wavenumber k = j / a carries about 2 rho_air / k of air with it per unit area
 *   (both faces), which lowers the low modes most.
 * - The shell's air is a spring for the modes that change its volume (m = 0): stiffness per unit area
 *   rho c^2 eps^2 / L, eps^2 = 4 / j^2 the share of the mode that moves air, L the shell depth; a fifth of that, as
 *   the resonant head gives way (an estimate). This raises the fundamental and pulls (0,1) and (1,1) closer.
 * - Losses: the head's own (b1 + b2 f^2, more for two plies with oil between them), radiation (a mode that moves air
 *   in phase, m = 0, radiates well and dies fast: the thud; the others radiate as dipoles and quadrupoles, weakly, and
 *   ring), and muffling at the edge (tape, a gel, a pillow in the kick).
 * - A stick is a short half-sine force pulse (about a millisecond; shorter the harder it hits, Hertzian contact); its
 *   spectrum rolls the high modes off, so a soft hit is darker. Where it hits picks the modes: the centre excites only
 *   m = 0, nearer the edge brings in the rest. The striker's face averages the head over its area (a felt beater about
 *   6 cm across, a stick's tip 1 cm), so modes shorter than it are barely excited: 2 J1(k b) / (k b), b its radius.
 * - A hard hit stretches the head, raising its tension: toms and kick start sharp and settle (tension modulation, with
 *   the head's averaged strain; the edge gives, which an estimated factor takes in).
 *
 * Cymbals (Fletcher and Rossing ch. 20; Chladni's law):
 * - A free circular plate's modes rise as (m + 2n)^2: f = lambda^2 / (2 pi a^2) sqrt(D / (rho h)), lambda about
 *   (pi / 2)(m + 2n), D = E h^3 / 12(1 - nu^2) its bending stiffness. A cymbal's dome stiffens the modes with nodal
 *   circles, like a ring: f^2 + f_ring^2.
 * - Hit hard, a cymbal's low modes pour energy into the high ones over a tenth of a second (the swell after a crash);
 *   `kitWorklet.ts` runs that cascade.
 */

export const AIR = { rho: 1.2, c: 343 } as const;
export const MYLAR = { rho: 1390, E: 4.5e9 } as const;
/** B20 cymbal bronze. */
export const BRONZE = { rho: 8600, E: 105e9, nu: 0.34 } as const;

const INCH = 0.0254;

/** J_m(x), from its integral (1/pi) int_0^pi cos(m t - x sin t) dt: the trapezoid rule is exact to rounding here. */
export function besselJ(m: number, x: number): number {
  const N = Math.max(64, Math.ceil(2 * (Math.abs(x) + m) + 32));
  let s = 0;
  for (let k = 0; k <= N; k++) {
    const t = (Math.PI * k) / N;
    s += (k === 0 || k === N ? 0.5 : 1) * Math.cos(m * t - x * Math.sin(t));
  }
  return s / N;
}

const zeroCache = new Map<number, number[]>();
/** The first `count` positive zeros of J_m (the first lies above m). */
export function besselZeros(m: number, count: number): number[] {
  const known = zeroCache.get(m) ?? [];
  if (known.length >= count) return known.slice(0, count);
  const out = [...known];
  let x = out.length ? out[out.length - 1]! + 0.5 : Math.max(0.5, m);
  let f0 = besselJ(m, x);
  while (out.length < count) {
    const x1 = x + 0.05, f1 = besselJ(m, x1);
    if (f0 * f1 < 0) {
      let a = x, b = x1, fa = f0;
      for (let i = 0; i < 48; i++) {
        const c = (a + b) / 2, fc = besselJ(m, c);
        if (fa * fc <= 0) b = c;
        else { a = c; fa = fc; }
      }
      out.push((a + b) / 2);
    }
    x = x1; f0 = f1;
  }
  zeroCache.set(m, out);
  return out.slice(0, count);
}

// ---- drumheads ----

/** Drumheads: their surface density, Mylar thickness (for stretching) and internal losses b2 (s^-1 per Hz^2). */
export const HEADS = {
  coated: { name: 'Coated, one ply', sigma: 0.4, thickness: 0.000254, b2: 3e-6 },
  clear: { name: 'Clear, one ply', sigma: 0.353, thickness: 0.000254, b2: 1.5e-6 },
  twoPly: { name: 'Clear, two plies', sigma: 0.495, thickness: 0.000356, b2: 9e-6 },
} as const;
export type HeadId = keyof typeof HEADS;

export interface DrumSpec {
  /** Head diameter, m. */
  diameter: number;
  /** Shell depth, m. */
  depth: number;
  head: HeadId;
  /** What hits it: a wooden stick, or a felt beater (the kick pedal). */
  striker: 'stick' | 'beater';
}

export const KIT_DRUMS = {
  kick: { diameter: 22 * INCH, depth: 18 * INCH, head: 'twoPly', striker: 'beater' },
  snare: { diameter: 14 * INCH, depth: 5.5 * INCH, head: 'coated', striker: 'stick' },
  tom: { diameter: 12 * INCH, depth: 8 * INCH, head: 'coated', striker: 'stick' },
  floor: { diameter: 16 * INCH, depth: 16 * INCH, head: 'coated', striker: 'stick' },
} as const satisfies Record<string, DrumSpec>;

/** How much a head's radiation drains each kind of mode (m = 0 moves air in phase; the rest cancel themselves). */
const RADIATION = [0.15, 0.05, 0.02, 0.01];
/** The resonant head and the kick's port give way, so the shell's air is a softer spring than a closed box's. */
const RESONANT_HEAD_GIVES = 0.2;

export interface DrumMode {
  m: number;
  n: number;
  /** The Bessel zero j_mn. */
  j: number;
  hz: number;
  /** Amplitude decay rate, s^-1 (without muffling). */
  sigma: number;
}

/** Air carried by a mode, kg/m^2. */
const airMass = (a: number, j: number) => (2 * AIR.rho * a) / j;
/** The shell's air spring for a mode, N/m^3 (only m = 0 modes change the volume). */
const cavity = (s: DrumSpec, m: number, j: number) => (m === 0 ? (RESONANT_HEAD_GIVES * AIR.rho * AIR.c ** 2 * (4 / j ** 2)) / s.depth : 0);

/** The membrane modes of a drum under a tension, lowest first, at most `count`. */
export function drumModes(s: DrumSpec, tension: number, count: number): DrumMode[] {
  const a = s.diameter / 2, head = HEADS[s.head];
  const c2 = tension / head.sigma;
  const all: DrumMode[] = [];
  for (let m = 0; m < 40; m++) {
    besselZeros(m, 16).forEach((j, i) => {
      const mass = head.sigma + airMass(a, j);
      const w2 = ((j * j * c2) / (a * a)) * (head.sigma / mass) + cavity(s, m, j) / mass;
      const hz = Math.sqrt(w2) / (2 * Math.PI);
      const ka = ((2 * Math.PI * hz) / AIR.c) * a;
      const rad = ((AIR.rho * AIR.c) / mass) * (RADIATION[m] ?? 0.005) * Math.min(1, ka ** (2 * m + 2));
      all.push({ m, n: i + 1, j, hz, sigma: 1.5 + head.b2 * hz * hz + rad });
    });
  }
  return all.sort((x, y) => x.hz - y.hz).slice(0, count);
}

/** The tension (N/m) that puts a drum's fundamental, (0,1), at `hz`. */
export function drumTensionFor(s: DrumSpec, hz: number): number {
  const a = s.diameter / 2, head = HEADS[s.head], j = besselZeros(0, 1)[0]!;
  const mass = head.sigma + airMass(a, j);
  const w2 = (2 * Math.PI * hz) ** 2;
  return ((w2 * mass - cavity(s, 0, j)) * a * a) / (j * j);
}

/** A mode's shape at a fraction r of the radius (on the line the stick hits, theta = 0). */
export const membraneShape = (mode: { m: number; j: number }, r: number): number => besselJ(mode.m, mode.j * r);

/** The mode's mean square shape over the head (its mass normalisation), as a fraction of the head's area. */
const membraneNorm = (mode: { m: number; j: number }) => besselJ(mode.m + 1, mode.j) ** 2 * (mode.m === 0 ? 1 : 0.5);

/** A strike: where (fraction of the radius), how hard (0..1), and how long the striker touches, s. */
export interface Strike {
  r: number;
  velocity: number;
  contact: number;
}

/** The radius of what touches, m: a kick beater's felt face, a stick's tip on a head or on bronze. */
export const PATCH = { beater: 0.03, stick: 0.005, metal: 0.003 } as const;

/** A mode of wavenumber k averaged over a disc of radius b: 2 J1(kb) / (kb). */
export function patchAverage(k: number, b: number): number {
  const x = k * b;
  return x < 1e-6 ? 1 : (2 * besselJ(1, x)) / x;
}

/** Contact times: a stick on a head about a millisecond, a felt beater three; Hertzian, shorter the harder it hits. */
export function contactTime(striker: 'stick' | 'beater' | 'metal', velocity: number): number {
  const base = striker === 'beater' ? 0.003 : striker === 'stick' ? 0.0009 : 0.0003;
  return base * Math.pow(Math.max(0.05, velocity), -0.2);
}

/**
 * The spectrum of a half-sine force pulse of length tau, 1 at 0 Hz (its phase taken out, the sign kept: above its main
 * lobe it alternates): why a soft, long contact is dark.
 */
export function pulseSpectrum(hz: number, tau: number): number {
  const x = 2 * hz * tau;
  if (Math.abs(1 - x) < 1e-6) return Math.PI / 4;
  return Math.cos((Math.PI * x) / 2) / (1 - x * x);
}

/**
 * The impulse a striker gives: a collision of the stick (50 g, 0.5 to 5 m/s) or beater (100 g, 0.5 to 3 m/s) with the
 * patch of head it meets (about a quarter of the head's mass), which bounces it back (restitution 0.5).
 */
export function strikeImpulse(striker: 'stick' | 'beater', headMass: number, velocity: number): number {
  const [mass, top] = striker === 'beater' ? [0.1, 3] : [0.05, 5];
  const speed = 0.5 + (top - 0.5) * velocity, M = headMass * 0.25;
  return (1.5 * mass * M * speed) / (mass + M);
}

/** Each mode's velocity after a strike, m/s per unit of modal shape: the impulse projected on the mode's shape at the strike, over the mode's mass. */
export function strikeVelocities(s: DrumSpec, modes: readonly DrumMode[], k: Strike): number[] {
  const a = s.diameter / 2, area = Math.PI * a * a;
  const P = strikeImpulse(s.striker, HEADS[s.head].sigma * area, k.velocity);
  return modes.map((mode) => {
    const mass = (HEADS[s.head].sigma + airMass(a, mode.j)) * area * membraneNorm(mode);
    return ((P * membraneShape(mode, k.r)) / mass) * pulseSpectrum(mode.hz, k.contact) * patchAverage(mode.j / a, PATCH[s.striker]);
  });
}

/** Extra damping from muffling resting near the edge (r = 0.9 a), in proportion to how much each mode moves there. */
export function edgeDamping(modes: readonly DrumMode[], amount: number): number[] {
  return modes.map((mode) => (amount * 160 * membraneShape(mode, 0.9) ** 2) / membraneNorm(mode));
}

/**
 * The near field of a microphone `distance` from a source: far off, pressure follows the source's acceleration
 * (omega^2); within about a wavelength / 2 pi it follows its velocity instead, p ~ omega^2 sqrt(1 + (c / omega r)^2):
 * why a close microphone on a kick hears its thump (the proximity effect).
 */
export const nearField = (hz: number, distance: number): number => Math.sqrt(1 + (AIR.c / (2 * Math.PI * hz * distance)) ** 2);

/**
 * What a microphone `distance` from a head hears of each mode, per unit of modal displacement: the acceleration
 * (omega^2) with the near field, times how well the mode radiates (m = 0 fully, the others by (ka)^m).
 */
export function drumMicWeights(s: DrumSpec, modes: readonly DrumMode[], distance: number): number[] {
  const a = s.diameter / 2;
  return modes.map((mode) => {
    const w = 2 * Math.PI * mode.hz, ka = (w / AIR.c) * a;
    return w * w * nearField(mode.hz, distance) * Math.min(1, ka ** mode.m) * (mode.m === 0 ? 1 : 0.6);
  });
}

/** How much the head's stretch rises with each mode's amplitude (for tension modulation), per m^2. */
export const drumStrainWeights = (s: DrumSpec, modes: readonly DrumMode[]): number[] =>
  modes.map((mode) => ((mode.j / (s.diameter / 2)) ** 2 * membraneNorm(mode)) / 4);

/**
 * The hoop, the head's collar and the bearing edge give as the head stretches, so it stiffens less than a sheet
 * clamped rigidly at its edge would: an estimate, fitted so a hard tom hit glides a semitone or two and a soft one
 * hardly at all, as toms are heard to.
 */
const EDGE_GIVES = 0.12;

/** The head's stretch: how much tension a unit of strain adds, over the tension (E h / T, less what the edge gives). */
export const headStretch = (s: DrumSpec, tension: number): number => (EDGE_GIVES * MYLAR.E * HEADS[s.head].thickness) / tension;

// ---- cymbals ----

export interface CymbalSpec {
  diameter: number;
  /** Bronze thickness, m. */
  thickness: number;
  /** The dome's radius of curvature, m (smaller: stiffer, the low modes rise). */
  dome: number;
}

export const KIT_CYMBALS = {
  hat: { diameter: 14 * INCH, thickness: 0.0011, dome: 1.1 },
  crash: { diameter: 18 * INCH, thickness: 0.0009, dome: 1.6 },
  ride: { diameter: 21 * INCH, thickness: 0.0014, dome: 1.8 },
} as const satisfies Record<string, CymbalSpec>;

export interface PlateMode {
  m: number;
  n: number;
  /** lambda, the plate's eigenvalue (Chladni: (pi / 2)(m + 2n)). */
  lambda: number;
  hz: number;
  sigma: number;
}

/** Bending stiffness D = E h^3 / 12(1 - nu^2). */
export const plateStiffness = (h: number): number => (BRONZE.E * h ** 3) / (12 * (1 - BRONZE.nu ** 2));
/** The ring frequency of the dome: the longitudinal wave speed around it, c_L / (2 pi R). */
export const domeHz = (c: CymbalSpec): number => Math.sqrt(BRONZE.E / (BRONZE.rho * (1 - BRONZE.nu ** 2))) / (2 * Math.PI * c.dome);

/** A cymbal's modes, lowest first, at most `count` (the rigid motions (0,0) and (1,0) left out). */
export function cymbalModes(c: CymbalSpec, count: number): PlateMode[] {
  const a = c.diameter / 2;
  const speed = Math.sqrt(plateStiffness(c.thickness) / (BRONZE.rho * c.thickness));
  const ring = domeHz(c);
  const all: PlateMode[] = [];
  for (let m = 0; m < 90; m++) {
    for (let n = 0; n < 45; n++) {
      if (m + 2 * n < 2) continue;
      const lambda = (Math.PI / 2) * (m + 2 * n);
      const flat = ((lambda * lambda) / (2 * Math.PI * a * a)) * speed;
      const hz = n > 0 ? Math.hypot(flat, ring) : flat;
      // bronze loses a little more with frequency (thermoelastic and air): a crash rings for seconds, its top for less
      all.push({ m, n, lambda, hz, sigma: 0.5 + 1.5e-4 * hz });
    }
  }
  return all.sort((x, y) => x.hz - y.hz).slice(0, count);
}

/** A plate mode's shape at a fraction r of the radius (J_m(lambda r), the bending wave's travelling part). */
export const plateShape = (mode: { m: number; lambda: number }, r: number): number => besselJ(mode.m, mode.lambda * r);

/** Each cymbal mode's velocity after a stick hit at r: the impulse on the shape over the mode's mass. */
export function cymbalStrikeVelocities(c: CymbalSpec, modes: readonly PlateMode[], k: Strike): number[] {
  const a = c.diameter / 2, plate = BRONZE.rho * c.thickness * Math.PI * a * a, mass = plate * 0.25;
  const P = strikeImpulse('stick', plate, k.velocity);
  return modes.map((mode) => ((P * plateShape(mode, k.r)) / mass) * pulseSpectrum(mode.hz, k.contact) * patchAverage(mode.lambda / a, PATCH.metal));
}

/** What a microphone hears of each cymbal mode: its acceleration, with radiation rising towards coincidence. */
export function cymbalMicWeights(c: CymbalSpec, modes: readonly PlateMode[], distance: number): number[] {
  const cL = Math.sqrt(BRONZE.E / (BRONZE.rho * (1 - BRONZE.nu ** 2)));
  const coincidence = AIR.c ** 2 / (1.8 * cL * c.thickness);
  return modes.map((mode) => {
    const w = 2 * Math.PI * mode.hz;
    return w * w * nearField(mode.hz, distance) * Math.sqrt(Math.min(1, mode.hz / coincidence));
  });
}


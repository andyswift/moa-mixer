/**
 * The physics of one bass guitar string: a stiff, damped string under tension, fixed at the bridge and at the fret
 * (or nut). Everything here is plain arithmetic in SI units (metres, kilograms, newtons, seconds), so it can be tested
 * against the textbook formulas and against real strings. The sound itself is made from these numbers in
 * `stringWorklet.ts` (modal synthesis: one damped oscillator per mode of vibration).
 *
 * - Wave speed c = sqrt(T / mu): tension T, mass per metre mu. The fundamental of a length L is f1 = c / 2L.
 * - Stiffness: the steel core resists bending (Young's modulus E, second moment of area I = pi d^4 / 64 of the core),
 *   which stretches the overtones sharp: f_n = n f1 sqrt(1 + B n^2), B = pi^2 E I / (T L^2) (Fletcher).
 * - Losses: sigma(f) = b1 + b2 f^2 (s^-1): a frequency-independent part (air, the bridge) and internal friction that
 *   rises with frequency (Chaigne and Askenfelt), so overtones die first. A mode's amplitude falls as exp(-sigma t).
 * - A pluck lifts the string by h at a distance xp from the bridge and lets go (a triangle): mode n starts at
 *   a_n = 2 h L^2 / (n^2 pi^2 xp (L - xp)) sin(n pi xp / L), smoothed by the width of what plucked it, and by how
 *   gradually it lets go: soft flesh releases over a fraction of a millisecond (a first-order low-pass on the
 *   excitation, 1 / sqrt(1 + (2 pi f tau)^2)), a pick snaps off at once.
 * - A magnetic pickup at xu senses the string's velocity there: mode n contributes in proportion to sin(n pi xu / L).
 */

export interface Material {
  name: string;
  /** Density, kg/m^3. */
  rho: number;
  /** Young's modulus, Pa. */
  E: number;
}

export const MATERIALS = {
  steel: { name: 'Steel', rho: 7850, E: 200e9 },
  nickel: { name: 'Nickel-plated steel', rho: 8900, E: 200e9 },
  stainless: { name: 'Stainless steel', rho: 8000, E: 193e9 },
} as const satisfies Record<string, Material>;
export type MaterialId = keyof typeof MATERIALS;

/** How the outer wire is wound: how much of the wrap's annulus is metal, and how fast the highs die. */
export const WINDINGS = {
  round: { name: 'Roundwound', fill: 0.78, b2: 2.0e-5 },
  half: { name: 'Half-round', fill: 0.85, b2: 4.0e-5 },
  flat: { name: 'Flatwound', fill: 0.92, b2: 9.0e-5 },
} as const;
export type WindingId = keyof typeof WINDINGS;

export interface StringSpec {
  /** Outside diameter, m. */
  outer: number;
  /** Diameter of the solid steel core, m (it carries the tension and the stiffness). */
  core: number;
  wrap: MaterialId;
  winding: WindingId;
}

const INCH = 0.0254;
/** A standard long-scale set (gauges .105 .085 .065 .045), with typical core sizes. */
export const GAUGES: Record<'E' | 'A' | 'D' | 'G', StringSpec & { note: number }> = {
  E: { outer: 0.105 * INCH, core: 0.040 * INCH, wrap: 'nickel', winding: 'round', note: 28 }, // E1
  A: { outer: 0.085 * INCH, core: 0.034 * INCH, wrap: 'nickel', winding: 'round', note: 33 }, // A1
  D: { outer: 0.065 * INCH, core: 0.028 * INCH, wrap: 'nickel', winding: 'round', note: 38 }, // D2
  G: { outer: 0.045 * INCH, core: 0.022 * INCH, wrap: 'nickel', winding: 'round', note: 43 }, // G2
};
export const SCALES = { short: 30 * INCH, medium: 32 * INCH, long: 34 * INCH, extra: 35 * INCH } as const;

export const midiToHz = (note: number): number => 440 * Math.pow(2, (note - 69) / 12);
export const NEWTONS_PER_POUND = 4.448222;

/** Mass per metre: the steel core plus the wrap's annulus (only `fill` of it is metal: round wire leaves gaps). */
export function linearDensity(s: StringSpec): number {
  const core = MATERIALS.steel.rho * (Math.PI / 4) * s.core ** 2;
  const wrap = MATERIALS[s.wrap].rho * (Math.PI / 4) * (s.outer ** 2 - s.core ** 2) * WINDINGS[s.winding].fill;
  return core + wrap;
}

/** Bending stiffness E I of the core (the wrap adds mass but little stiffness). */
export const bendingStiffness = (s: StringSpec): number => MATERIALS.steel.E * (Math.PI * s.core ** 4) / 64;

/** The core's cross-section times its modulus: how much tension a stretch adds (for the pitch glide of hard plucks). */
export const axialStiffness = (s: StringSpec): number => MATERIALS.steel.E * (Math.PI / 4) * s.core ** 2;

/** The tension that tunes an open string of this length to `hz`: T = mu (2 L f)^2. */
export const tensionFor = (s: StringSpec, scale: number, hz: number): number => linearDensity(s) * (2 * scale * hz) ** 2;

/** The fundamental of a length under a tension, ignoring stiffness: f = sqrt(T / mu) / 2L. */
export const idealFrequency = (s: StringSpec, length: number, tension: number): number =>
  Math.sqrt(tension / linearDensity(s)) / (2 * length);

/** The vibrating length at a fret: the scale divided by 2^(fret/12) (equal temperament). */
export const fretLength = (scale: number, fret: number): number => scale / Math.pow(2, fret / 12);

/** The inharmonicity coefficient B for a length under a tension. */
export const inharmonicity = (s: StringSpec, length: number, tension: number): number =>
  (Math.PI ** 2 * bendingStiffness(s)) / (tension * length ** 2);

/** Losses: b1 (s^-1) plus the winding's internal friction b2 f^2. */
export function decayRate(winding: WindingId, hz: number, b1 = 0.5): number {
  return b1 + WINDINGS[winding].b2 * hz * hz;
}

export interface Mode {
  /** Frequency, Hz (with the stiffness stretch). */
  hz: number;
  /** Amplitude decay rate, s^-1. */
  sigma: number;
}

/** The modes of a stiff string of this length, up to `maxHz` (and at most `maxModes`). */
export function modes(s: StringSpec, length: number, tension: number, maxHz: number, maxModes = 128): Mode[] {
  const f1 = idealFrequency(s, length, tension);
  const B = inharmonicity(s, length, tension);
  const out: Mode[] = [];
  for (let n = 1; n <= maxModes; n++) {
    const hz = n * f1 * Math.sqrt(1 + B * n * n);
    if (hz > maxHz) break;
    out.push({ hz, sigma: decayRate(s.winding, hz) });
  }
  return out;
}

export interface Pluck {
  /** Distance from the bridge, m. */
  position: number;
  /** How far the string is pulled, m. */
  height: number;
  /** Width of what plucks it, m (a fingertip about 12 mm, a pick about 1.5 mm): it smooths the shape's corner. */
  width: number;
  /** How long it takes to let go, s (a fingertip about 0.25 ms, a pick about 0.02 ms). */
  release: number;
}

export const FINGER = { width: 0.012, release: 0.00025 } as const;
export const PICK = { width: 0.0015, release: 0.00002 } as const;

/**
 * Each mode's starting displacement for a pluck (a triangle with its corner rounded by the plucker's width, softened
 * by its release). `hz` are the modes' frequencies (one per mode, mode 1 first).
 */
export function pluckAmplitudes(length: number, hz: readonly number[], p: Pluck): number[] {
  const xp = Math.min(Math.max(p.position, 0.002), length - 0.002);
  const out: number[] = [];
  for (let n = 1; n <= hz.length; n++) {
    const k = (n * Math.PI) / length;
    const triangle = (2 * p.height * length * length) / (n * n * Math.PI * Math.PI * xp * (length - xp)) * Math.sin(k * xp);
    const half = (k * p.width) / 2;
    const width = half < 1e-9 ? 1 : Math.sin(half) / half; // averaging over the contact patch
    const soft = 1 / Math.sqrt(1 + (2 * Math.PI * hz[n - 1]! * p.release) ** 2); // the gradual release
    out.push(triangle * width * soft);
  }
  return out;
}

/** How strongly a pickup at `position` (from the bridge) hears each mode's motion. */
export function pickupWeights(length: number, count: number, position: number, aperture = 0.01): number[] {
  const out: number[] = [];
  for (let n = 1; n <= count; n++) {
    const k = (n * Math.PI) / length;
    const half = (k * aperture) / 2;
    out.push(Math.sin(k * position) * (half < 1e-9 ? 1 : Math.sin(half) / half));
  }
  return out;
}

/**
 * Extra damping from something touching the string at `position` (a palm mute near the bridge, the fretting finger
 * lifting): a mode loses energy there in proportion to how much it moves there, sin^2(n pi x / L).
 */
export function contactDamping(length: number, count: number, position: number, strength: number): number[] {
  const out: number[] = [];
  for (let n = 1; n <= count; n++) out.push(strength * Math.sin((n * Math.PI * position) / length) ** 2);
  return out;
}

/** The note a frequency is, and how far off it in cents. */
export function noteOf(hz: number): { note: number; name: string; cents: number } {
  const exact = 69 + 12 * Math.log2(hz / 440);
  const note = Math.round(exact);
  const names = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];
  return { note, name: `${names[((note % 12) + 12) % 12]}${Math.floor(note / 12) - 1}`, cents: (exact - note) * 100 };
}

export interface VoiceSetup {
  spec: StringSpec;
  /** Scale length (nut to bridge), m. */
  scale: number;
  /** Tension, N. */
  tension: number;
  fret: number;
  /** Pickup distance from the bridge, m. */
  pickup: number;
  /** Palm mute: where the palm touches (from the bridge, m) and how hard (0..1). */
  palm: { position: number; amount: number };
  sampleRate: number;
}

/** What the string engine runs for a setup: its modes (Hz, losses), how the pickup hears them, stretch and damping. */
export function voiceConfig(v: VoiceSetup) {
  const length = fretLength(v.scale, v.fret);
  const m = modes(v.spec, length, v.tension, Math.min(12000, 0.45 * v.sampleRate));
  const count = m.length;
  const fingerNearFret = Math.max(0.005, length - 0.015); // a released fretting finger still touches near the fret
  const mute = contactDamping(length, count, fingerNearFret, 140).map((d) => d + 30); // 60 dB in about a quarter second
  return {
    length,
    hz: m.map((x) => x.hz),
    sigma: m.map((x) => x.sigma),
    pickup: pickupWeights(length, count, v.pickup),
    // the stretch averaged over a cycle: mode n adds (n pi / L)^2 a_n^2 / 8 to the strain (a_n its amplitude)
    strainK: m.map((_, i) => ((((i + 1) * Math.PI) / length) ** 2) / 8),
    stretch: axialStiffness(v.spec) / v.tension,
    // flesh is a very lossy contact: at full, enough to give the fundamental a short thump; the highs go at once
    palm: contactDamping(length, count, v.palm.position, v.palm.amount * 600),
    mute,
  };
}

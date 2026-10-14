/** A velocity template over a bar of sixteen steps: 1 is the loudest accent, near 0 the softest. */
export interface Groove {
  readonly name: string;
  readonly shape: readonly number[];
}

const wave = (f: (t: number) => number): number[] => Array.from({ length: 16 }, (_, i) => f(i / 16));

/** The T-1's eight groove templates: four percussion-flavoured, four from the basic waveforms. */
export const GROOVES: readonly Groove[] = [
  { name: 'agogo', shape: [1, 0.55, 0.8, 0.5, 0.95, 0.55, 0.75, 0.5, 1, 0.6, 0.8, 0.5, 0.9, 0.55, 0.7, 0.45] },
  { name: 'timbales', shape: [1, 0.4, 0.6, 0.9, 0.5, 0.4, 0.95, 0.5, 0.7, 0.4, 0.85, 0.5, 0.6, 0.9, 0.5, 0.4] },
  { name: 'congas', shape: [0.9, 0.5, 0.45, 1, 0.55, 0.9, 0.5, 0.45, 0.95, 0.5, 0.45, 1, 0.55, 0.85, 0.5, 0.7] },
  { name: 'bongo', shape: [0.5, 1, 0.55, 0.9, 0.5, 1, 0.6, 0.85, 0.5, 0.95, 0.55, 0.9, 0.5, 1, 0.6, 0.8] },
  { name: 'saw', shape: wave((t) => 1 - t) },
  { name: 'triangle', shape: wave((t) => 1 - Math.abs(t * 2 - 1)) },
  { name: 'sine', shape: wave((t) => 0.5 + 0.5 * Math.sin(t * Math.PI * 2)) },
  { name: 'pulse', shape: wave((t) => (t < 0.5 ? 1 : 0.35)) },
];

/** Velocity for the n-th pulse: the base velocity shaped by the template, by an amount from -1 (inverted) to 1. */
export function grooveVelocity(base: number, groove: number, accent: number, index: number): number {
  const template = GROOVES[groove] ?? GROOVES[0]!;
  const shape = template.shape[index % template.shape.length]!;
  const amount = Math.min(1, Math.abs(accent));
  const s = accent >= 0 ? shape : 1 - shape;
  return Math.min(127, Math.max(1, Math.round(base * (1 - amount + amount * s))));
}

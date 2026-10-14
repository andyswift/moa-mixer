/** Euclidean rhythms: `pulses` events spread as evenly as possible over `steps` (Bjorklund's algorithm). */
export function euclid(pulses: number, steps: number): boolean[] {
  const n = Math.max(0, Math.floor(steps));
  const k = Math.min(n, Math.max(0, Math.floor(pulses)));
  if (n === 0) return [];
  if (k === 0) return new Array<boolean>(n).fill(false);
  // Bjorklund: repeatedly pair up the remainders until only one remainder group is left.
  let a: boolean[][] = Array.from({ length: k }, () => [true]);
  let b: boolean[][] = Array.from({ length: n - k }, () => [false]);
  while (b.length > 1) {
    const pairs = Math.min(a.length, b.length);
    const next: boolean[][] = [];
    for (let i = 0; i < pairs; i++) next.push([...a[i]!, ...b[i]!]);
    const rest = a.length > b.length ? a.slice(pairs) : b.slice(pairs);
    a = next;
    b = rest;
  }
  return [...a, ...b].flat();
}

/** Rotates a pattern: positive amounts start it later (every pulse moves one step later, wrapping round). */
export function rotate<T>(pattern: readonly T[], amount: number): T[] {
  const n = pattern.length;
  if (n === 0) return [];
  const shift = ((Math.round(amount) % n) + n) % n;
  return pattern.map((_, i) => pattern[(i - shift + n) % n]!);
}

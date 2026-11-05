/**
 * The MOA-RIG's song as blocks. A song is saved as it always was, a chain of pattern numbers played in turn
 * (`[0, 0, 1, 2, 2, 2]`); the song strip shows it as blocks, a run of the same pattern being one block played so many
 * times (`1 ×2, 2 ×1, 3 ×3`). Editing a block (moving, inserting, duplicating, removing it, changing its repeats)
 * gives a new chain and where each position of the old one went, so the sequencer can keep playing the same bar.
 */
export interface SongBlock {
  pattern: number;
  /** Its first position in the chain. */
  start: number;
  /** How many times it plays. */
  count: number;
}

export interface SongEdit {
  chain: number[];
  /** Where each position of the old chain is now (-1: removed). */
  moved: number[];
}

export function songBlocks(chain: readonly number[]): SongBlock[] {
  const blocks: SongBlock[] = [];
  chain.forEach((pattern, i) => {
    const last = blocks.at(-1);
    if (last && last.pattern === pattern) last.count++;
    else blocks.push({ pattern, start: i, count: 1 });
  });
  return blocks;
}

/** The block holding a chain position (-1 for none). */
export const blockAt = (blocks: readonly SongBlock[], pos: number): number =>
  blocks.findIndex((b) => pos >= b.start && pos < b.start + b.count);

/** One position of the chain and where it came from (-1: new). */
interface Item { pattern: number; from: number }
const items = (chain: readonly number[]): Item[] => chain.map((pattern, from) => ({ pattern, from }));
/** The items as blocks of the chain's own runs (so a move takes a whole block). */
function groups(chain: readonly number[]): Item[][] {
  const all = items(chain);
  return songBlocks(chain).map((b) => all.slice(b.start, b.start + b.count));
}
function result(oldLength: number, list: Item[]): SongEdit {
  const moved = new Array<number>(oldLength).fill(-1);
  list.forEach((it, i) => { if (it.from >= 0) moved[it.from] = i; });
  return { chain: list.map((it) => it.pattern), moved };
}

/** Moves block `from` to stand before block `to` (the number of blocks: to the end). */
export function moveBlock(chain: readonly number[], from: number, to: number): SongEdit {
  const g = groups(chain);
  if (from < 0 || from >= g.length) return result(chain.length, items(chain));
  const [taken] = g.splice(from, 1);
  g.splice(to > from ? to - 1 : to, 0, taken!);
  return result(chain.length, g.flat());
}

/** Puts a new block of `pattern`, played `count` times, before block `at` (the number of blocks: at the end). */
export function insertBlock(chain: readonly number[], at: number, pattern: number, count = 1): SongEdit {
  const g = groups(chain);
  g.splice(Math.max(0, Math.min(g.length, at)), 0, Array.from({ length: count }, () => ({ pattern, from: -1 })));
  return result(chain.length, g.flat());
}

/** A copy of block `b` straight after it, played as often (next to its original it shows as one block, twice as long). */
export function duplicateBlock(chain: readonly number[], b: number): SongEdit {
  const g = groups(chain);
  const block = g[b];
  if (!block) return result(chain.length, items(chain));
  g.splice(b + 1, 0, block.map((it) => ({ pattern: it.pattern, from: -1 })));
  return result(chain.length, g.flat());
}

/** Takes blocks `from` to `to` (inclusive) out of the song. */
export function removeBlocks(chain: readonly number[], from: number, to = from): SongEdit {
  const g = groups(chain);
  g.splice(from, Math.max(0, to - from + 1));
  return result(chain.length, g.flat());
}

/** Block `b` played `count` times (1 to 64): repeats added at its end, or taken from its end. */
export function setRepeats(chain: readonly number[], b: number, count: number): SongEdit {
  const g = groups(chain);
  const block = g[b];
  if (!block) return result(chain.length, items(chain));
  const n = Math.max(1, Math.min(64, Math.round(count)));
  g[b] = n <= block.length ? block.slice(0, n) : [...block, ...Array.from({ length: n - block.length }, () => ({ pattern: block[0]!.pattern, from: -1 }))];
  return result(chain.length, g.flat());
}

import { describe, expect, it } from 'vitest';
import { blockAt, duplicateBlock, insertBlock, moveBlock, removeBlocks, setRepeats, songBlocks } from '../../sequencer/rigSong';

describe('MOA-RIG song blocks', () => {
  it('shows a chain as blocks: a run of one pattern is one block played so many times', () => {
    expect(songBlocks([0, 0, 1, 2, 2, 2, 0])).toEqual([
      { pattern: 0, start: 0, count: 2 }, { pattern: 1, start: 2, count: 1 }, { pattern: 2, start: 3, count: 3 }, { pattern: 0, start: 6, count: 1 },
    ]);
    expect(songBlocks([])).toEqual([]);
    expect(blockAt(songBlocks([0, 0, 1, 2, 2, 2]), 4)).toBe(2);
  });

  it('moves a whole block, and says where every position went', () => {
    const e = moveBlock([0, 0, 1, 2, 2], 2, 0);
    expect(e.chain).toEqual([2, 2, 0, 0, 1]);
    expect(e.moved).toEqual([2, 3, 4, 0, 1]);
    expect(moveBlock([0, 1, 2], 0, 3).chain).toEqual([1, 2, 0]);
  });

  it('inserts, duplicates and removes blocks; repeats are added or taken at a block’s end', () => {
    expect(insertBlock([0, 1], 1, 5, 2)).toEqual({ chain: [0, 5, 5, 1], moved: [0, 3] });
    expect(duplicateBlock([0, 1, 1, 2], 1).chain).toEqual([0, 1, 1, 1, 1, 2]);
    expect(removeBlocks([0, 1, 1, 2, 3], 1, 2)).toEqual({ chain: [0, 3], moved: [0, -1, -1, -1, 1] });
    expect(setRepeats([0, 1, 1, 2], 1, 4)).toEqual({ chain: [0, 1, 1, 1, 1, 2], moved: [0, 1, 2, 5] });
    expect(setRepeats([0, 1, 1, 1, 2], 1, 1)).toEqual({ chain: [0, 1, 2], moved: [0, 1, -1, -1, 2] });
    expect(setRepeats([0], 0, 0).chain).toEqual([0]); // at least once
  });
});

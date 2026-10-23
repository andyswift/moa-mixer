import { describe, expect, it } from 'vitest';
import { DrumKit } from '../devices/drumKit';
import { KitGroove } from '../sequencer/kitGroove';

describe('the kit\'s rock beat', () => {
  it('plays a bar of eighths on the hat, kick on 1, 3 and the and of 3, snare on 2 and 4, each hit once, ahead of time', () => {
    const kit = new DrumKit();
    let now = 0;
    const groove = new KitGroove(kit, () => now);
    const hits: { piece: string; due: number }[] = [];
    kit.circuit.onChange((c) => {
      if (c.type !== 'message') return;
      const m = c.data as { type?: string; delay?: number };
      if (m.type === 'hit') hits.push({ piece: c.nodeId.replace(/\.s$/, ''), due: now + (m.delay ?? 0) * 1000 }); // a sampled cymbal plays on its sampler node
    });
    groove.bpm = 120; // a bar is 2 s
    for (now = 0; now < 2100; now += 50) groove.tick(); // the first bar (from 0, not started), ticked as the page's timer would
    const bar = hits.filter((h) => h.due >= -5 && h.due < 2000 - 5);
    const count = (p: string) => bar.filter((h) => h.piece === p).length;
    expect([count('hat'), count('kick'), count('snare'), count('crash')]).toEqual([8, 3, 2, 1]);
    const snares = bar.filter((h) => h.piece === 'snare').map((h) => h.due);
    expect(snares[0]!).toBeCloseTo(500, -1); // beat 2, within a few ms
    expect(snares[1]!).toBeCloseTo(1500, -1); // beat 4
  });
});

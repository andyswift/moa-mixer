import { describe, expect, it } from 'vitest';
import { RIG_FACTORY_MULTIS } from '../devices/rigFactory';
import { sanitiseMulti } from '../devices/rigMulti';
import { hasTune, packMulti, readTuneFile, RIG_SHARE_APP, tuneFile, tuneFileName, tuneFromHash, tuneHash, unpackMulti } from '../devices/rigShare';
import { freshPart } from '../devices/rigSynth';

/** A factory multi as the rig holds it once loaded (every default filled in). */
const loaded = (i: number) => sanitiseMulti(JSON.parse(JSON.stringify(RIG_FACTORY_MULTIS[i]!.build())), freshPart)!;

describe('sharing a tune', () => {
  it('packs every factory multi and gets it back exactly', () => {
    RIG_FACTORY_MULTIS.forEach((_, i) => {
      const m = loaded(i);
      expect(unpackMulti(JSON.parse(JSON.stringify(packMulti(m))), freshPart)).toEqual(m);
    });
  });

  it('leaves out the empty steps, tracks and patterns and every field at its default (a tenth of the size)', () => {
    const m = loaded(3);
    expect(tuneFile(m).length).toBeLessThan(JSON.stringify(m).length / 8);
    // a step that only holds a SEQ lane value or a lock is kept
    m.patterns[15]!.tracks[3]!.steps[40]!.mod = 0.5;
    expect(unpackMulti(packMulti(m), freshPart)!.patterns[15]!.tracks[3]!.steps[40]!.mod).toBe(0.5);
  });

  it('goes into a link and comes back out of it', async () => {
    const m = loaded(3);
    const hash = await tuneHash(m);
    expect(hasTune(hash)).toBe(true);
    expect(hash).toMatch(/^#tune=[A-Za-z0-9_-]+$/);
    expect(hash.length).toBeLessThan(20_000);
    expect(await tuneFromHash(hash, freshPart)).toEqual(m);
  });

  it('refuses what is not a tune: another app, a newer version, damage, a link that inflates too far', async () => {
    const m = loaded(1);
    expect(readTuneFile('{"app":"other","v":1,"multi":{}}', freshPart)).toBeUndefined();
    expect(readTuneFile(JSON.stringify({ ...packMulti(m), v: 99 }), freshPart)).toBeUndefined();
    expect(readTuneFile('not json', freshPart)).toBeUndefined();
    expect(readTuneFile(tuneFile(m), freshPart)).toEqual(m);
    expect(await tuneFromHash('#tune=%%%', freshPart)).toBeUndefined();
    expect(await tuneFromHash('#other=abc', freshPart)).toBeUndefined();
    // five megabytes of spaces deflate to a few KB
    const bomb = new Uint8Array(await new Response(new Blob([' '.repeat(5_000_000)]).stream().pipeThrough(new CompressionStream('deflate-raw'))).arrayBuffer());
    const b64 = btoa(String.fromCharCode(...bomb)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
    expect(await tuneFromHash(`#tune=${b64}`, freshPart)).toBeUndefined();
  });

  it('names its file after the multi', () => {
    expect(tuneFileName({ ...loaded(3), name: 'Dark Room 110' })).toBe('dark-room-110.moarig.json');
    expect(tuneFileName({ ...loaded(3), name: '···' })).toBe('tune.moarig.json');
    expect(JSON.parse(tuneFile(loaded(0))).app).toBe(RIG_SHARE_APP);
  });
});

import { describe, expect, it } from 'vitest';
import { carryMeHome } from '../library/carryMeHome';
import { pierLights } from '../library/pierLights';
import { songBeats } from '../types';

describe('the words on the band page', () => {
  for (const song of [pierLights(), carryMeHome()]) {
    it(`${song.title}: every line in order, inside the song, and sung while it shows`, () => {
      const words = song.words!;
      expect(words.length).toBeGreaterThan(10);
      for (let k = 0; k < words.length; k++) {
        const l = words[k]!;
        expect(l.to).toBeGreaterThan(l.from);
        expect(l.to).toBeLessThanOrEqual(songBeats(song));
        if (k) expect(l.from, l.text).toBeGreaterThanOrEqual(words[k - 1]!.to - 1e-9);
        const page = l.who === 'choir' ? 'choir' : 'vox';
        const sung = (song.tracks[page] ?? []).filter((n) => n.t >= l.from && n.t < l.to);
        expect(sung.length, `${l.text} at ${l.from}`).toBeGreaterThan(0);
      }
    });
  }
});

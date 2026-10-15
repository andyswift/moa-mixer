import { describe, expect, it } from 'vitest';
import { applyBalance, BALANCE } from '../balance';
import { library } from '../library';

const STRIPS = ['ch1', 'ch2', 'ch3', 'ch4', 'ch5', 'ch6', 'ch7', 'ch8', 'line1', 'line2', 'line3', 'line4'];

describe('balance', () => {
  it('only names real strips and keeps every fader inside the fader range', () => {
    for (const [id, faders] of Object.entries(BALANCE)) {
      for (const [strip, level] of Object.entries(faders)) {
        expect(STRIPS, `${id}.${strip}`).toContain(strip);
        expect(level, `${id}.${strip}`).toBeGreaterThan(0);
        expect(level, `${id}.${strip}`).toBeLessThanOrEqual(1.5);
      }
    }
  });

  it('is applied to every song that has an entry, and every entry belongs to a song', () => {
    const songs = library();
    const ids = new Set(songs.map((s) => s.id));
    for (const id of Object.keys(BALANCE)) expect(ids.has(id), id).toBe(true);
    for (const song of songs) {
      const faders = BALANCE[song.id];
      if (!faders) continue;
      const controls = song.setup.mixer!.mixer!.controls!;
      for (const [strip, level] of Object.entries(faders)) expect(controls[`${strip}.fader`], `${song.id} ${strip}`).toBe(level);
    }
  });

  it('leaves a song without an entry as it was written', () => {
    const song = library()[0]!;
    const copy = { ...song, id: 'not-in-the-table' };
    const before = JSON.stringify(copy.setup.mixer);
    expect(JSON.stringify(applyBalance(copy).setup.mixer)).toBe(before);
  });
});

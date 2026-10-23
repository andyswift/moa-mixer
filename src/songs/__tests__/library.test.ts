import { describe, expect, it } from 'vitest';
import { Patch } from '../../domain/patch/patch';
import type { PageId } from '../control';
import { applySettings } from '../control';
import { library } from '../library';
import { expandSong } from '../player';
import { songBeats } from '../types';

const patches: Record<PageId, () => Patch> = {
  mixer: () => Patch.mixerRack(), synth: () => Patch.synth(), poly: () => Patch.poly(), drums: () => Patch.drums(),
  lynch: () => Patch.lynch(), duo: () => Patch.duo(), df2: () => Patch.df2(), pipe: () => Patch.pipe(),
  reverb: () => Patch.reverb(), delay: () => Patch.delay(), ouroboros: () => Patch.ouroboros(), buscomp: () => Patch.buscomp(), granular: () => Patch.granular(),
  m2600: () => Patch.m2600(), bass: () => Patch.bass(), bass2: () => Patch.bass(), guitar: () => Patch.guitar(), kit: () => Patch.kit(), mpc: () => Patch.mpc(), unicorn: () => Patch.unicorn(),
};

describe.each(library().map((s) => [s.title, s] as const))('song: %s', (_title, song) => {
  it('has settings that every page accepts without a warning', () => {
    for (const [page, settings] of Object.entries(song.setup) as [PageId, NonNullable<typeof song.setup[PageId]>][]) {
      expect(applySettings(patches[page](), settings), page).toEqual([]);
    }
  });

  it('lists the effect pages it sets up, and sets up no page that is not in its band', () => {
    for (const page of Object.keys(song.setup) as PageId[]) if (page !== 'mixer') expect(song.band, page).toContain(page);
    expect(song.band).not.toContain('mixer');
    // the send effects the mixer feeds must be in the room: aux 1 reverb, aux 2 delay, bus B the compressor
    const controls = song.setup.mixer?.mixer?.controls ?? {};
    if (Object.keys(controls).some((k) => k.endsWith('.aux1') && controls[k] !== 0)) expect(song.band).toContain('reverb');
    if (Object.keys(controls).some((k) => k.endsWith('.aux2') && controls[k] !== 0)) expect(song.band).toContain('delay');
    if (Object.keys(controls).some((k) => k.endsWith('.busB') && controls[k] === true)) expect(song.band).toContain('buscomp');
    if (Object.keys(controls).some((k) => k.endsWith('.busC') && controls[k] === true)) expect(song.band).toContain('ouroboros');
    if (Object.keys(controls).some((k) => k.endsWith('.aux3') && controls[k] !== 0)) expect(song.band).toContain('granular');
  });

  it('has automation that points at controls that exist, with values in range', () => {
    for (const a of song.automation) {
      const control = patches[a.page]().device(a.device).control(a.control);
      expect(control.kind).toBe('number');
      if (control.kind === 'number') for (const [, v] of a.points) expect(v >= control.min && v <= control.max, `${a.control} ${v}`).toBe(true);
    }
  });

  it('keeps every note inside the song and in MIDI range, and every instrument in its band', () => {
    const msgs = expandSong(song, 1);
    const end = songBeats(song) * (60000 / song.bpm);
    for (const m of msgs) {
      if (m.data.length === 1) continue; // MIDI clock, start and stop carry no note
      expect(m.data[1]).toBeGreaterThanOrEqual(0);
      expect(m.data[1]).toBeLessThanOrEqual(127);
      expect(m.ms).toBeLessThan(end + 1500);
      expect(song.band).toContain(m.page);
    }
    const ons = msgs.filter((m) => (m.data[0]! & 0xf0) === 0x90).length;
    const offs = msgs.filter((m) => (m.data[0]! & 0xf0) === 0x80).length;
    expect(ons).toBe(offs);
    expect(ons).toBeGreaterThan(100);
  });

  it('has no note whose release falls after the end of a pass, so looping never cuts one', () => {
    const loopMs = songBeats(song) * (60000 / song.bpm);
    for (const seed of [1, 2, 3]) {
      const late = expandSong(song, seed).filter((m) => (m.data[0]! & 0xf0) === 0x80 && m.ms > loopMs + 25);
      expect(late, `seed ${seed}`).toEqual([]);
    }
  });

  it('has a title, a key and a tempo for the sleeve and the labels', () => {
    expect(song.title).toBeTruthy();
    expect(song.bpm).toBeGreaterThan(60);
    expect(song.key).toBeTruthy();
  });
});

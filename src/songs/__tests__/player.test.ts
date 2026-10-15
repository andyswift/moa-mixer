import { describe, expect, it } from 'vitest';
import type { ControlMessage, PageId } from '../control';
import { automationValue, expandSong, type PlayerHost, SongPlayer } from '../player';
import type { Song } from '../types';

const song = (over: Partial<Song> = {}): Song => ({
  id: 't', title: 'T', artist: 'A', bpm: 120, key: 'C', bars: 2, beatsPerBar: 4,
  sleeve: { art: 'sunrise', colors: [] }, band: ['synth', 'drums'], setup: {}, automation: [],
  humanise: { timing: {}, velocity: 0 },
  tracks: { synth: [{ t: 0, len: 1, note: 60, vel: 100 }, { t: 4, len: 2, note: 62, vel: 90 }], drums: [{ t: 0.5, len: 0.25, note: 36, vel: 120 }] },
  ...over,
});

function fakeHost() {
  let now = 1000;
  const notes: { page: PageId; data: number[]; at: number }[] = [];
  const controls: { page: PageId; message: ControlMessage }[] = [];
  let timer: (() => void) | undefined;
  const host: PlayerHost = {
    now: () => now,
    sendNote: (page, data, at) => void notes.push({ page, data, at }),
    control: (page, message) => void controls.push({ page, message }),
    setInterval: (fn) => { timer = fn; return 1; },
    clearInterval: () => { timer = undefined; },
  };
  return { host, notes, controls, advance: (ms: number) => { now += ms; timer?.(); }, set: (t: number) => { now = t; }, get running() { return timer !== undefined; } };
}

describe('expandSong', () => {
  it('turns notes into timed note-ons and note-offs in beats at the song tempo', () => {
    const m = expandSong(song());
    // 120 bpm: a beat is 500 ms
    const on = m.filter((x) => x.data[0] === 0x90 && x.page === 'synth');
    expect(on.map((x) => [x.ms, x.data[1]])).toEqual([[0, 60], [2000, 62]]);
    const off = m.find((x) => x.data[0] === 0x80 && x.data[1] === 60)!;
    expect(off.ms).toBeCloseTo(500 * 0.96, 5);
    expect(m.every((x, i) => i === 0 || m[i - 1]!.ms <= x.ms)).toBe(true);
    expect(m.find((x) => x.page === 'drums')!.data[0]).toBe(0x99); // drums on channel 10
  });

  it('is repeatable for a seed and different for another', () => {
    const s = song({ humanise: { timing: { synth: 8, drums: 5 }, velocity: 0.15 } });
    expect(expandSong(s, 3)).toEqual(expandSong(s, 3));
    expect(expandSong(s, 3)).not.toEqual(expandSong(s, 4));
  });

  it('keeps humanising inside its limits and applies layback and swing', () => {
    const s = song({
      humanise: { timing: { synth: 6 }, velocity: 0.1, swing: 0.5, layback: { drums: { 36: 4 } } },
      tracks: { synth: [{ t: 8, len: 1, note: 60, vel: 100 }], drums: [{ t: 8, len: 0.25, note: 36, vel: 100 }, { t: 8.25, len: 0.25, note: 40, vel: 100 }] },
    });
    for (let seed = 1; seed < 30; seed++) {
      const m = expandSong(s, seed);
      const syn = m.find((x) => x.page === 'synth' && x.data[0] === 0x90)!;
      expect(Math.abs(syn.ms - 4000)).toBeLessThanOrEqual(6);
      expect(syn.data[2]).toBeGreaterThanOrEqual(90);
      expect(syn.data[2]).toBeLessThanOrEqual(110);
      expect(m.find((x) => x.data[1] === 36 && x.data[0] === 0x99)!.ms).toBeCloseTo(4004, 5); // laid back 4 ms
      expect(m.find((x) => x.data[1] === 40 && x.data[0] === 0x99)!.ms).toBeCloseTo(4125 + 62.5, 5); // 16th late by half of a 16th (125 ms)
    }
  });

  it('never starts a note before the song', () => {
    const s = song({ humanise: { timing: { synth: 50 }, velocity: 0 }, tracks: { synth: [{ t: 0, len: 1, note: 60, vel: 100 }] } });
    for (let seed = 1; seed < 40; seed++) expect(Math.min(...expandSong(s, seed).map((m) => m.ms))).toBeGreaterThanOrEqual(0);
  });
});

describe('automationValue', () => {
  const a = (curve?: 'exp'): Parameters<typeof automationValue>[0] => ({ page: 'df2', device: 'box', control: 'f1.cutoff', points: [[0, 100], [4, 400], [8, 400]], curve });
  it('holds before and after, interpolates between', () => {
    expect(automationValue(a(), -2)).toBe(100);
    expect(automationValue(a(), 2)).toBe(250);
    expect(automationValue(a(), 6)).toBe(400);
    expect(automationValue(a(), 20)).toBe(400);
  });
  it('can move exponentially (Hz)', () => {
    expect(automationValue(a('exp'), 2)).toBeCloseTo(200, 5);
  });
});

describe('SongPlayer', () => {
  it('puts every instrument on omni and sends settings and routing on setup', () => {
    const f = fakeHost();
    new SongPlayer(f.host).setup(song({ band: ['synth', 'poly'], setup: { synth: { synth: { preset: 2 } }, mixer: { mixer: { controls: { 'ch1.fader': 0.5 } } } }, inputs: { ch1: 'Synth' } }));
    const synth = f.controls.find((c) => c.page === 'synth')!.message as Extract<ControlMessage, { type: 'apply' }>;
    expect(synth.settings).toEqual({ synth: { channel: 'omni', preset: 2 } });
    expect(f.controls.find((c) => c.page === 'poly')).toBeDefined();
    const mixer = f.controls.find((c) => c.page === 'mixer')!.message as Extract<ControlMessage, { type: 'apply' }>;
    expect(mixer.inputs).toEqual({ ch1: 'Synth' });
  });

  it('sends only what is due within the look-ahead, each with its due time', () => {
    const f = fakeHost();
    const p = new SongPlayer(f.host, 250, 30, 500);
    p.play(song());
    // start is at 1500 (lead-in 500); at now=1000 nothing within 250 ms yet except nothing: first note due 1500
    expect(f.notes).toHaveLength(0);
    f.advance(300); // now 1300: the first notes (due 1500, 1750 for the drum) -> the 1500 one is within 250 ms
    expect(f.notes.map((n) => n.at)).toEqual([1500]);
    f.advance(300);
    expect(f.notes.length).toBeGreaterThan(1);
    expect(f.notes.every((n) => n.at >= 1500)).toBe(true);
  });

  it('stop releases sounding and pending notes after the last one that was sent', () => {
    const f = fakeHost();
    const p = new SongPlayer(f.host, 250, 30, 500);
    p.play(song());
    f.advance(300);
    f.advance(300); // the first note and the drum are on their way
    const sentOn = f.notes.filter((n) => (n.data[0]! & 0xf0) === 0x90);
    expect(sentOn.length).toBeGreaterThan(0);
    const before = f.notes.length;
    p.stop();
    const releases = f.notes.slice(before);
    const lastDue = Math.max(...f.notes.slice(0, before).map((n) => n.at));
    expect(releases.every((n) => (n.data[0]! & 0xf0) === 0x80 && n.at > lastDue)).toBe(true);
    expect(f.running).toBe(false);
    expect(p.state).toBe('idle');
    // notes that already ended are not released twice
    const releasedKeys = new Set(releases.map((n) => `${n.page}:${n.data[1]}`));
    expect(releases).toHaveLength(releasedKeys.size);
  });

  it('sends automation as settings while playing, and ends by itself', () => {
    const f = fakeHost();
    let ended = false;
    const p = new SongPlayer(f.host, 250, 30, 500);
    p.onEnd = () => { ended = true; };
    p.play(song({ bars: 1, automation: [{ page: 'df2', device: 'box', control: 'f1.cutoff', points: [[0, 100], [4, 500]] }], tracks: { synth: [{ t: 0, len: 1, note: 60, vel: 100 }] } }));
    for (let i = 0; i < 140 && !ended; i++) f.advance(50);
    const cutoffs = f.controls.filter((c) => c.page === 'df2').map((c) => ((c.message as Extract<ControlMessage, { type: 'apply' }>).settings!.box!.controls!['f1.cutoff'] as number));
    expect(cutoffs.length).toBeGreaterThan(3);
    expect(cutoffs.every((v, i) => i === 0 || v >= cutoffs[i - 1]!)).toBe(true);
    expect(cutoffs.at(-1)).toBeCloseTo(500, 0);
    expect(ended).toBe(true);
    expect(p.state).toBe('idle');
  });
});

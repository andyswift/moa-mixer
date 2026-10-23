import { describe, expect, it } from 'vitest';
import type { ControlMessage, PageId } from '../control';
import { automationValue, expandSong, type PlayerHost, SongPlayer } from '../player';
import { note } from '../generators';
import { swingDelay, type Song } from '../types';

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

describe('SongPlayer looping', () => {
  // 120 bpm, one bar of 4 beats: a pass is 2000 ms
  const loopSong = (over: Partial<Song> = {}) => song({ bars: 1, tracks: { synth: [{ t: 0, len: 1, note: 60, vel: 100 }, { t: 2, len: 1, note: 64, vel: 100 }] }, ...over });

  it('starts each pass exactly one loop length after the last, with no gap', () => {
    const f = fakeHost();
    const p = new SongPlayer(f.host, 250, 30, 500);
    p.loop = true;
    p.play(loopSong());
    for (let i = 0; i < 400; i++) f.advance(30); // 12 s: six passes
    const starts = f.notes.filter((n) => n.page === 'synth' && n.data[1] === 60 && (n.data[0]! & 0xf0) === 0x90).map((n) => n.at);
    expect(starts.length).toBeGreaterThanOrEqual(5);
    for (let i = 1; i < starts.length; i++) expect(starts[i]! - starts[i - 1]!).toBe(2000);
    expect(p.state).toBe('playing');
  });

  it('keeps playing past the end of the song, and stops at the end of the pass when looping is switched off', () => {
    const f = fakeHost();
    let ended = false;
    const p = new SongPlayer(f.host, 250, 30, 500);
    p.onEnd = () => { ended = true; };
    p.loop = true;
    p.play(loopSong());
    for (let i = 0; i < 250; i++) f.advance(30); // 7.5 s
    expect(ended).toBe(false);
    p.loop = false;
    for (let i = 0; i < 250 && !ended; i++) f.advance(30);
    expect(ended).toBe(true);
    expect(p.state).toBe('idle');
  });

  it('humanises each pass differently, from the same seed sequence every time', () => {
    const run = () => {
      const f = fakeHost();
      const p = new SongPlayer(f.host, 250, 30, 500);
      p.loop = true;
      p.play(loopSong({ humanise: { timing: { synth: 9 }, velocity: 0.2 } }), 5);
      for (let i = 0; i < 300; i++) f.advance(30);
      return f.notes.filter((n) => (n.data[0]! & 0xf0) === 0x90).map((n) => `${n.at}:${n.data[2]}`);
    };
    const a = run();
    expect(a).toEqual(run()); // the same seed gives the same performance
    // within one run, each pass is a little different from the one before
    const ons = a.map((x) => x.split(':').map(Number) as [number, number]).filter((_, i) => i % 2 === 0); // the first note of each pass
    const rel = ons.map(([at], k) => at - ons[0]![0] - k * 2000);
    expect(new Set(rel).size).toBeGreaterThan(2);
  });

  it('starts a sweep over with each pass and can hold a page\'s automation back while it is being tweaked', () => {
    const f = fakeHost();
    const p = new SongPlayer(f.host, 250, 30, 500);
    p.loop = true;
    const a = { page: 'df2' as PageId, device: 'box', control: 'f1.cutoff', points: [[0, 100], [4, 500]] as [number, number][] };
    p.play(loopSong({ automation: [a] }));
    const values = () => f.controls.filter((c) => c.page === 'df2').map((c) => (c.message as Extract<ControlMessage, { type: 'apply' }>).settings!.box!.controls!['f1.cutoff'] as number);
    for (let i = 0; i < 200; i++) f.advance(30); // 6 s: a bit over two passes
    const v = values();
    expect(v.some((x, i) => i > 0 && x < v[i - 1]! - 100)).toBe(true); // it fell back to the start at a pass boundary
    p.pauseAutomation('df2');
    const before = values().length;
    for (let i = 0; i < 100; i++) f.advance(30);
    expect(values().length).toBe(before);
    p.resumeAutomation('df2');
    f.advance(30);
    expect(values().length).toBeGreaterThan(before);
  });

  it('carries a release that falls past the loop point into the next pass, so no note is cut', () => {
    const f = fakeHost();
    const p = new SongPlayer(f.host, 250, 30, 500);
    p.loop = true;
    // a note that starts in the last beat and lasts two beats: its release is due 1 beat after the loop point
    p.play(loopSong({ tracks: { synth: [{ t: 3, len: 2, note: 60, vel: 100 }] } }));
    for (let i = 0; i < 250; i++) f.advance(30);
    const ons = f.notes.filter((n) => (n.data[0]! & 0xf0) === 0x90).length;
    const offs = f.notes.filter((n) => (n.data[0]! & 0xf0) === 0x80).length;
    expect(ons).toBeGreaterThanOrEqual(3);
    expect(offs).toBeGreaterThanOrEqual(ons - 1); // every note but the one still sounding has its release
    p.stop();
    const total = f.notes.filter((n) => (n.data[0]! & 0xf0) === 0x80).length;
    expect(total).toBeGreaterThanOrEqual(ons); // stopping releases the last one
  });
});


describe('MIDI clock for sequencers', () => {
  const clocked = () => song({ clock: ['m2600'], humanise: { timing: { m2600: 20 }, velocity: 0.1, swing: 0.2 } });

  it('sends the clock pages Start, then 24 pulses a beat exactly on time, and nothing to the others', () => {
    const msgs = expandSong(clocked(), 3);
    const clock = msgs.filter((m) => m.page === 'm2600');
    expect(clock[0]).toEqual({ ms: 0, page: 'm2600', data: [0xfa] });
    const pulses = clock.filter((m) => m.data[0] === 0xf8);
    expect(pulses).toHaveLength(2 * 4 * 24); // two bars of 4/4
    pulses.forEach((m, k) => expect(m.ms).toBeCloseTo((k * 500) / 24, 6)); // 120 bpm: a beat is 500 ms; never humanised
    expect(msgs.some((m) => m.page !== 'm2600' && m.data.length === 1)).toBe(false);
  });

  it('starts the clock again with each pass of a loop, and stopping sends Stop after the last pulse sent', () => {
    const f = fakeHost();
    const p = new SongPlayer(f.host, 250, 30, 500);
    p.loop = true;
    p.play(clocked());
    for (let i = 0; i < 200; i++) f.advance(30); // 6 s: three passes of a 4 s song
    const starts = f.notes.filter((n) => n.page === 'm2600' && n.data[0] === 0xfa).map((n) => n.at);
    expect(starts.length).toBeGreaterThanOrEqual(2);
    expect(starts[1]! - starts[0]!).toBeCloseTo(4000, 6);
    const before = f.notes.length;
    const lastPulse = Math.max(...f.notes.filter((n) => n.data[0] === 0xf8).map((n) => n.at));
    p.stop();
    const stop = f.notes.slice(before).find((n) => n.data[0] === 0xfc);
    expect(stop?.page).toBe('m2600');
    expect(stop!.at).toBeGreaterThan(lastPulse);
  });
});

describe('swung passages', () => {
  const base: Song = {
    id: 's', title: 'S', artist: 'A', bpm: 120, key: 'C', bars: 3, beatsPerBar: 4, barBeats: [3.5, 3.5, 4],
    sleeve: { art: 'flats', colors: [] }, band: ['bass', 'kit'], setup: {}, automation: [], humanise: { timing: {}, velocity: 0 },
    tracks: {}, swung: [{ from: 3.5, to: 7, amount: 62, grid: 16 }, { from: 7, to: 11, amount: 66, grid: 8 }],
  };
  it('leave a pair that a bar cuts short straight (the last eighth of 7/8)', () => {
    const seven: Song = { ...base, swung: [{ from: 0, to: 3.5, amount: 66, grid: 8 }] };
    expect(swingDelay(seven, 3)).toBe(0); // the 7th eighth: no partner in the bar
    expect(swingDelay(seven, 3.25)).toBe(0);
    expect(swingDelay(seven, 2.5)).toBeGreaterThan(0); // the 6th is the second of a whole pair
  });

  it('move every page\'s off-beat notes by the same amount, counted from the bar (a 7/8 bar starts half a beat in)', () => {
    // bar 2 starts at 3.5 beats: its second 16th is at 3.75, swung by (2 * 0.62 - 1) of a 16th
    expect(swingDelay(base, 3.75)).toBeCloseTo(0.24 * 0.25, 9);
    expect(swingDelay(base, 4)).toBe(0); // its third 16th is on the grid
    expect(swingDelay(base, 1.25)).toBe(0); // the first bar is straight
    expect(swingDelay(base, 7.5)).toBeCloseTo((2 * 0.66 - 1) * 0.5, 9); // eighths, a triplet shuffle
    // between swung eighths, a sixteenth moves in proportion (a quarter of the way through the pair: half its first note)
    expect(swingDelay(base, 7.25)).toBeCloseTo((0.5 * 2 * 0.66 - 0.5) * 0.5, 9);
    expect(swingDelay(base, 7.75)).toBeCloseTo((2 * 0.66 + 0.5 * (2 - 2 * 0.66) - 1.5) * 0.5, 9);
    const song = { ...base, tracks: { bass: [note(3.75, 0.2, 40, 100)], kit: [note(3.75, 0.2, 42, 100)] } };
    const ons = expandSong(song, 1).filter((m) => (m.data[0]! & 0xf0) === 0x90).map((m) => m.ms);
    expect(ons[0]).toBeCloseTo(ons[1]!, 9); // the band together
    expect(ons[0]).toBeCloseTo((3.75 + 0.06) * 500, 6);
  });
});

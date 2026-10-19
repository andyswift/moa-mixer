import { describe, expect, it } from 'vitest';
import { MidiClock } from '../midi/clock';
import { UNICORN_PRESETS, UnicornSynth } from '../devices/unicornSynth';
import { OneKeyPlay, RHYTHMS, RhythmBox, SONGS } from '../sequencer/unicornRhythm';

type Msg = { type: string; note?: number; preset?: { r: number; vib: number } };
const watch = (u: UnicornSynth) => {
  const sent: Msg[] = [];
  u.circuit.onChange((c) => { if (c.type === 'message') sent.push(c.data as Msg); });
  return sent;
};

describe('MOA-UNICORN', () => {
  it('a sound sets where Magic and Sparkle start; sustain and vibrato change the sound it sends', () => {
    const u = new UnicornSynth(new MidiClock());
    const sent = watch(u);
    u.preset.set('Robot');
    expect(u.magic.value).toBe(1200);
    expect(u.circuit.node('filter').params.res).toBeCloseTo(0.85, 9);
    u.preset.set('Organ');
    u.sustain.set(true);
    u.vibrato.set(true);
    const last = sent.filter((m) => m.type === 'preset').at(-1)!.preset!;
    expect(last.r).toBeGreaterThanOrEqual(1);
    expect(last.vib).toBe(15);
    expect(JSON.parse(u.circuit.node('voices').options.preset!).vib).toBe(15); // kept for a worklet built later
  });

  it('the octave buttons move every key, and a key lets go of the note it started', () => {
    const u = new UnicornSynth(new MidiClock());
    const sent = watch(u);
    u.octave.set('+1');
    u.keyDown(60);
    u.octave.set('0');
    u.keyUp(60);
    expect(sent.filter((m) => m.type === 'on' || m.type === 'off').map((m) => [m.type, m.note])).toEqual([['on', 72], ['off', 72]]);
  });

  it('MIDI plays it on any channel; every preset has a name and a picture', () => {
    const u = new UnicornSynth(new MidiClock());
    const sent = watch(u);
    u.handleMidi({ type: 'noteOn', channel: 5, note: 64, velocity: 100 });
    expect(sent.at(-1)).toMatchObject({ type: 'on', note: 64 });
    expect(UNICORN_PRESETS.length).toBeGreaterThanOrEqual(10);
    for (const p of UNICORN_PRESETS) expect(p.icon.length).toBeGreaterThan(0);
  });
});

describe('the rhythm box', () => {
  it('plays a rock beat on time, round and round, and bounces on every beat', () => {
    const hits: [string, number][] = [], beats: number[] = [];
    const box = new RhythmBox({ hit: (k, _v, when) => hits.push([k, when]), beat: (when) => beats.push(when) });
    box.tempo = 120; // a step is 0.125 s
    box.set(RHYTHMS.rock, 0);
    for (let t = 0; t < 2.1; t += 0.025) box.schedule(t);
    const kicks = hits.filter(([k]) => k === 'kick').map(([, t]) => +(t - 0.05).toFixed(6));
    expect(kicks.slice(0, 4)).toEqual([0, 1, 1.25, 2]); // steps 0, 8 and 10 of each bar
    expect(beats.slice(0, 3).map((t) => +(t - 0.05).toFixed(6))).toEqual([0, 0.5, 1]);
  });

  it('the waltz is in three', () => {
    const kicks: number[] = [];
    const box = new RhythmBox({ hit: (k, _v, when) => { if (k === 'kick') kicks.push(when); } });
    box.tempo = 120;
    box.set(RHYTHMS.waltz, 0);
    for (let t = 0; t < 3.1; t += 0.025) box.schedule(t);
    expect(kicks[1]! - kicks[0]!).toBeCloseTo(1.5, 9); // a bar of three beats
  });
});

describe('One Key Play', () => {
  it('any key plays the next note of the song, round again at the end', () => {
    const play = new OneKeyPlay(SONGS.twinkle!);
    expect([play.press().note, play.press().note, play.press().note]).toEqual([60, 60, 67]);
    let done = false;
    for (let i = 3; i < SONGS.twinkle!.notes.length; i++) done = play.press().done;
    expect(done).toBe(true);
    expect(play.next).toBe(60);
  });

  it('a song in time, to listen to', () => {
    const t = new OneKeyPlay(SONGS.joy!).timed(120);
    expect(t[1]!.at).toBeCloseTo(0.5, 9);
    expect(t[13]!.at - t[12]!.at).toBeCloseTo(0.75, 9); // the dotted note
  });
});

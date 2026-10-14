import { describe, expect, it } from 'vitest';
import { SequencerEngine, seeded } from '../../sequencer/engine';
import { SeqScheduler } from '../../sequencer/scheduler';
import { newBank } from '../../sequencer/track';

function rig(setup: (b: ReturnType<typeof newBank>) => void = () => undefined) {
  const bank = newBank();
  bank.patterns[0]!.tracks[0]!.pulses = 4;
  setup(bank);
  let time = 10000;
  const sent: { data: number[]; at: number }[] = [];
  const sched = new SeqScheduler(new SequencerEngine(bank, seeded(1)), (data, at) => sent.push({ data, at }), () => time);
  const advance = (ms: number, step = 25) => { for (let t = 0; t < ms; t += step) { time += step; sched.pump(); } };
  return { sched, sent, advance, now: () => time, bank };
}

describe('SeqScheduler', () => {
  it('sends Start, clock pulses and notes with exact due times', () => {
    const { sched, sent, advance } = rig();
    sched.start();
    advance(2200);
    const start = sent.find((m) => m.data[0] === 0xfa)!;
    expect(start.at).toBe(10060);
    const notes = sent.filter((m) => m.data[0] === 0x90);
    // 120 BPM: a bar is 2 s, four pulses a bar, a pulse every 500 ms from the start time
    expect(notes.slice(0, 4).map((m) => Math.round(m.at - start.at))).toEqual([0, 500, 1000, 1500]);
    const clocks = sent.filter((m) => m.data[0] === 0xf8);
    expect(clocks.length).toBeGreaterThan(80); // 24 per beat, 2 beats per second
    expect(Math.round(clocks[1]!.at - clocks[0]!.at)).toBe(21); // 500/24 ms
  });

  it('does not depend on how regularly pump is called', () => {
    const a = rig();
    a.sched.start();
    a.advance(2000, 25);
    const b = rig();
    b.sched.start();
    b.advance(2000, 60);
    const times = (r: typeof a) => r.sent.filter((m) => m.data[0] === 0x90).map((m) => Math.round(m.at));
    expect(times(b).slice(0, 4)).toEqual(times(a).slice(0, 4));
  });

  it('stop sends note-offs, all-notes-off and Stop', () => {
    const { sched, sent, advance } = rig((b) => { b.patterns[0]!.tracks[0]!.sustain = 1; });
    sched.start();
    advance(300);
    sent.length = 0;
    sched.stop();
    expect(sent.some((m) => m.data[0] === 0x80)).toBe(true);
    expect(sent.some((m) => m.data[0] === 0xb0 && m.data[1] === 123)).toBe(true);
    expect(sent.at(-1)!.data).toEqual([0xfc]);
    expect(sched.playing).toBe(false);
  });

  it('a tempo change keeps the playhead and changes the spacing from then on', () => {
    const { sched, sent, advance } = rig();
    sched.start();
    advance(600);
    sched.setTempo(240);
    advance(2400);
    const notes = sent.filter((m) => m.data[0] === 0x90).map((m) => m.at);
    // pulses 3 and 4 of the bar come closer together at the faster tempo
    expect(notes[2]! - notes[1]!).toBeLessThan(500);
    expect(notes[2]! - notes[1]!).toBeGreaterThan(200);
  });

  it('tickAt follows the clock', () => {
    const { sched, advance, now } = rig();
    sched.start();
    advance(1000);
    expect(sched.tickAt(now())).toBeGreaterThan(150);
    expect(sched.tickAt(now())).toBeLessThan(200);
  });
});

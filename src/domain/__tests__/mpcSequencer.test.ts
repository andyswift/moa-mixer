import { describe, expect, it } from 'vitest';
import { correct, LOOKAHEAD, MpcSequencer, PPQ } from '../sequencer/mpcSequencer';

type Played = { pad: number; velocity: number; when: number; hold: number };
function make() {
  const played: Played[] = [], clicks: { when: number; accent: boolean }[] = [];
  const seq = new MpcSequencer({ play: (pad, velocity, when, hold) => played.push({ pad, velocity, when, hold }), click: (when, accent) => clicks.push({ when, accent }) });
  return { seq, played, clicks };
}
/** Runs the scheduler like the page does: every 25 ms from `from` to `to` seconds. */
const runFor = (seq: MpcSequencer, from: number, to: number) => { for (let t = from; t <= to; t += 0.025) seq.schedule(t); };

describe('MOA-60 sequencer: timing correct and swing', () => {
  it('50% is straight; 66% puts the second sixteenth of a pair two thirds of the way; 75% three quarters', () => {
    expect(correct(30, '1/16', 50)).toBe(24);
    expect(correct(30, '1/16', 66)).toBe(32); // 48 * 0.66 = 31.7: a triplet feel
    expect(correct(30, '1/16', 75)).toBe(36);
    expect(correct(50, '1/16', 75)).toBe(48); // on-beat sixteenths do not move
    expect(correct(55, '1/8', 66)).toBe(63); // eighths swing in pairs of eighths
    expect(correct(20, '1/16T', 75)).toBe(16); // triplet grids never swing
    expect(correct(37.4, 'off', 75)).toBe(37);
  });
});

describe('MOA-60 sequencer: playing', () => {
  it('plays a sequence on time, round and round, each hit ahead of its time', () => {
    const { seq, played } = make();
    seq.tempo = 120; // a beat is 0.5 s, a tick 1/192 s
    seq.sequence.bars = 1;
    seq.sequence.events.push({ tick: 0, pad: 0, velocity: 1, length: 24 }, { tick: 2 * PPQ, pad: 1, velocity: 0.5, length: 24 });
    seq.play(10);
    runFor(seq, 10, 14.3); // two bars and a bit
    const start = 10.05;
    expect(played.map((p) => [p.pad, +(p.when - start).toFixed(6)])).toEqual([[0, 0], [1, 1], [0, 2], [1, 3], [0, 4]]);
    expect(played[1]!.hold).toBeCloseTo(24 / 192, 9);
  });

  it('never plays a hit late: everything is sent at least the look-ahead before it is due, minus one scheduler period', () => {
    const { seq, played } = make();
    const sentAt: number[] = [];
    seq.sequence.events.push(...Array.from({ length: 32 }, (_, i) => ({ tick: i * 24, pad: i % 4, velocity: 1, length: 12 })));
    seq.play(0);
    for (let t = 0; t <= 6; t += 0.025) { const n = played.length; seq.schedule(t); for (let i = n; i < played.length; i++) sentAt.push(t); }
    played.forEach((p, i) => { if (sentAt[i]! > 0) expect(p.when - sentAt[i]!).toBeGreaterThan(LOOKAHEAD - 0.03); }); // after the first call, which starts it 50 ms ahead
  });

  it('a tempo change keeps the beat that is playing where it is', () => {
    const { seq } = make();
    seq.play(0);
    const before = seq.tickAt(3);
    seq.setTempo(140, 3);
    expect(seq.tickAt(3)).toBeCloseTo(before, 9);
    expect(seq.tickAt(3 + 60 / 140)).toBeCloseTo(before + PPQ, 6);
  });

  it('counts in a bar before recording, with the metronome accenting each bar', () => {
    const { seq, clicks } = make();
    seq.tempo = 120;
    seq.play(0, true);
    runFor(seq, 0, 3.9);
    expect(clicks.slice(0, 5).map((c) => c.accent)).toEqual([true, false, false, false, true]);
    expect(clicks[4]!.when - clicks[0]!.when).toBeCloseTo(2, 9); // the count-in bar
  });

  it('changes sequence at the end of the loop, not in the middle', () => {
    const { seq, played } = make();
    seq.tempo = 120;
    seq.sequences[0]!.bars = 1;
    seq.sequences[0]!.events.push({ tick: 0, pad: 0, velocity: 1, length: 1 });
    seq.sequences[1]!.events.push({ tick: 0, pad: 5, velocity: 1, length: 1 });
    seq.play(0);
    runFor(seq, 0, 0.5);
    seq.select(1);
    expect(seq.current).toBe(0);
    runFor(seq, 0.5, 2.5);
    expect(played.map((p) => p.pad)).toEqual([0, 5]);
    expect(seq.current).toBe(1);
  });
});

describe('MOA-60 sequencer: recording', () => {
  it('records a press at its corrected, swung place in the loop, with its length', () => {
    const { seq } = make();
    seq.tempo = 120;
    seq.swing = 66;
    seq.countIn = false;
    seq.sequence.bars = 1;
    seq.play(0, true);
    const tick = (t: number) => seq.timeAt(t);
    seq.press(3, 0.9, tick(29)); // a little late for the second sixteenth
    seq.release(3, tick(29 + 40));
    seq.press(4, 0.7, tick(4 * PPQ - 2)); // just before the loop's end: lands on its start
    expect(seq.sequence.events).toEqual([
      { tick: 0, pad: 4, velocity: 0.7, length: 24 },
      { tick: 32, pad: 3, velocity: 0.9, length: 37 },
    ]);
  });

  it('a press recorded just ahead of the playback does not sound twice', () => {
    const { seq, played } = make();
    seq.tempo = 120;
    seq.countIn = false;
    seq.play(0, true);
    runFor(seq, 0, 1); // scheduled to about 1.12 s
    seq.press(2, 1, seq.timeAt(2 * PPQ + 3)); // corrects to tick 192, which the scheduler has not reached
    runFor(seq, 1, 5);
    const hits = played.filter((p) => p.pad === 2).map((p) => +(p.when - seq.timeAt(0)).toFixed(6));
    expect(hits).toEqual([4 + 1]); // only on the next pass (a two-bar loop is 4 s), not at 1 s again
  });

  it('note repeat plays a held pad on the swung grid, and records it', () => {
    const { seq, played } = make();
    seq.tempo = 120;
    seq.swing = 75;
    seq.countIn = false;
    seq.play(0, true);
    seq.press(7, 0.8, 0, true);
    runFor(seq, 0, 0.9);
    seq.release(7, 1);
    runFor(seq, 0.9, 1.5);
    const ticks = played.filter((p) => p.pad === 7 && p.when < seq.timeAt(PPQ * 1.5)).map((p) => Math.round(seq.tickAt(p.when)) + 0);
    expect(ticks.slice(0, 4)).toEqual([0, 36, 48, 84]);
    expect(seq.sequence.events.filter((e) => e.pad === 7).slice(0, 4).map((e) => e.tick)).toEqual([0, 36, 48, 84]);
  });

  it('step edit, erase and quantise', () => {
    const { seq } = make();
    seq.toggleStep(0, 0);
    seq.toggleStep(1, 24);
    seq.toggleStep(0, 0);
    expect(seq.sequence.events.map((e) => e.pad)).toEqual([1]);
    seq.sequence.events.push({ tick: 50, pad: 2, velocity: 1, length: 1 });
    seq.swing = 75;
    seq.quantise();
    expect(seq.sequence.events.map((e) => e.tick)).toEqual([36, 48]);
    seq.erase(1);
    expect(seq.sequence.events.map((e) => e.pad)).toEqual([2]);
  });
});

describe('MOA-60 sequencer: following the MIDI clock', () => {
  it('locks to clock pulses with jitter: hits land within a millisecond of the true beat', () => {
    const { seq, played } = make();
    seq.sync = 'midi';
    seq.sequence.events.push(...Array.from({ length: 8 }, (_, i) => ({ tick: i * PPQ, pad: 0, velocity: 1, length: 1 })));
    const bpm = 100, pulse = 60 / bpm / 24;
    let seed = 7;
    const jitter = () => (((seed = (seed * 16807) % 2147483647) / 2147483647) - 0.5) * 0.008; // +/- 4 ms
    seq.clockStart(1);
    for (let n = 1; n <= 24 * 8; n++) {
      const t = 1 + n * pulse;
      seq.clockPulse(t + jitter(), bpm);
      seq.schedule(t);
    }
    const late = played.slice(2).map((p, i) => Math.abs(p.when - (1 + (i + 2) * 0.6)));
    expect(Math.max(...late)).toBeLessThan(0.0015);
  });
});

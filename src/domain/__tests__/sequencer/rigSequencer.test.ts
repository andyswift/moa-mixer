import { describe, expect, it } from 'vitest';
import { seeded } from '../../sequencer/engine';
import { RigSequencer, stepIndex } from '../../sequencer/rigSequencer';
import { moveBlock, removeBlocks } from '../../sequencer/rigSong';

interface Ev { type: 'on' | 'off' | 'locks' | 'mod' | 'flush'; part?: number; note?: number; vel?: number; when?: number; locks?: Record<string, number>; value?: number }
function make(random: () => number = () => 0) {
  const ev: Ev[] = [];
  const seq = new RigSequencer({
    on: (part, note, vel, when) => ev.push({ type: 'on', part, note, vel, when }),
    off: (part, note, when) => ev.push({ type: 'off', part, note, when }),
    locks: (part, locks, when) => ev.push({ type: 'locks', part, locks, when }),
    mod: (part, value, when) => ev.push({ type: 'mod', part, value, when }),
    flush: () => ev.push({ type: 'flush' }),
  }, random);
  seq.tempo = 120; // a sixteenth is 0.125 s
  return { seq, ev };
}
/** Runs the scheduler like the page does: every 25 ms from `from` to `to` seconds. */
const runFor = (seq: RigSequencer, from: number, to: number) => { for (let t = from; t <= to + 1e-9; t += 0.025) seq.schedule(t); };
const START = 0.05; // play(0) starts 50 ms on
/** Note ons as [part, note, sixteenths after the start]. */
const ons = (ev: Ev[]) => ev.filter((e) => e.type === 'on').map((e) => [e.part, e.note, +((e.when! - START) / 0.125).toFixed(3)]);

describe('MOA-RIG sequencer', () => {
  it('plays each track on its own length and clock, so they run against each other', () => {
    const { seq, ev } = make();
    const [a, b] = seq.pattern.tracks;
    a!.length = 3;
    a!.steps[0]!.notes = [60];
    b!.length = 2;
    b!.clock = 48; // eighths
    b!.steps[0]!.notes = [36];
    seq.play(0);
    runFor(seq, 0, 1.4);
    const upTo = (part: number) => ons(ev).filter((e) => e[0] === part && (e[2] as number) < 12).map((e) => e[2]);
    expect(upTo(0)).toEqual([0, 3, 6, 9]);
    expect(upTo(1)).toEqual([0, 4, 8]);
  });

  it('plays chords, lets them go after the gate, and ties a gate past one step into the next step', () => {
    const { seq, ev } = make();
    const t = seq.pattern.tracks[0]!;
    t.length = 4;
    t.steps[0]!.notes = [60, 64, 67];
    t.steps[0]!.gate = 0.5;
    t.steps[2]!.notes = [48];
    t.steps[2]!.gate = 1.5;
    t.steps[3]!.notes = [50];
    seq.play(0);
    runFor(seq, 0, 0.5);
    const at = (e: Ev) => +((e.when! - START) / 0.125).toFixed(3);
    expect(ev.filter((e) => e.type === 'on').map((e) => [e.note, at(e)]).slice(0, 5)).toEqual([[60, 0], [64, 0], [67, 0], [48, 2], [50, 3]]);
    const offs = new Map(ev.filter((e) => e.type === 'off').reverse().map((e) => [e.note, at(e)])); // each note's first off
    expect(offs.get(60)).toBeCloseTo(0.5 - 1 / 24, 3);
    expect(offs.get(48)!).toBeGreaterThan(3); // still held when 50 starts: a legato part slides
  });

  it('lets each note of a step go after its own length, where it has one (the piano roll), else the step\'s gate', () => {
    const { seq, ev } = make();
    const t = seq.pattern.tracks[0]!;
    t.length = 16;
    t.steps[0]!.notes = [60, 64, 67];
    t.steps[0]!.gate = 1;
    t.steps[0]!.gates = { 60: 4, 67: 2 };
    seq.play(0);
    runFor(seq, 0, 1);
    const offAt = (note: number) => +(((ev.find((e) => e.type === 'off' && e.note === note)!.when! - START) / 0.125)).toFixed(2);
    expect(offAt(60)).toBeCloseTo(4, 1);
    expect(offAt(67)).toBeCloseTo(2, 1);
    expect(offAt(64)).toBeCloseTo(1, 1);
  });

  it('lets go of a note held over from an earlier step before playing it again', () => {
    const { seq, ev } = make();
    const t = seq.pattern.tracks[0]!;
    t.length = 2;
    t.steps[0]!.notes = [60];
    t.steps[0]!.gate = 4;
    t.steps[1]!.notes = [60];
    seq.play(0);
    runFor(seq, 0, 0.3);
    const sixty = ev.filter((e) => e.note === 60 && e.type !== 'locks').map((e) => [e.type, +((e.when! - START) / 0.125).toFixed(3)]);
    expect(sixty.slice(0, 3)).toEqual([['on', 0], ['off', 1], ['on', 1]]);
  });

  it('goes forwards, backwards, ping-pong (without playing the ends twice) and at random', () => {
    const r = () => 0.99;
    expect([0, 1, 2, 3, 4].map((k) => stepIndex('fwd', 4, k, r))).toEqual([0, 1, 2, 3, 0]);
    expect([0, 1, 2, 3, 4].map((k) => stepIndex('rev', 4, k, r))).toEqual([3, 2, 1, 0, 3]);
    expect([0, 1, 2, 3, 4, 5, 6].map((k) => stepIndex('pingpong', 4, k, r))).toEqual([0, 1, 2, 3, 2, 1, 0]);
    expect(stepIndex('random', 4, 0, r)).toBe(3);
  });

  it('plays a step as often as its probability and the track’s say', () => {
    const { seq, ev } = make(seeded(7));
    const t = seq.pattern.tracks[0]!;
    t.length = 1;
    t.steps[0]!.notes = [60];
    t.steps[0]!.prob = 0.5;
    t.prob = 0.5;
    seq.play(0);
    runFor(seq, 0, 1000 * 0.125);
    expect(ons(ev).length / 1000).toBeCloseTo(0.25, 1);
  });

  it('moves a step off the grid by its micro-timing, and swings every second sixteenth', () => {
    const { seq, ev } = make();
    const t = seq.pattern.tracks[0]!;
    t.length = 4;
    for (const s of t.steps.slice(0, 4)) s.notes = [60];
    t.steps[2]!.micro = -0.25;
    seq.shuffle = 0.2;
    seq.play(0);
    runFor(seq, 0, 0.5);
    expect(ons(ev).map((e) => e[2]).slice(0, 4)).toEqual([0, 1.2, 1.75, 3.2]);
  });

  it('holds a step’s locks for the step, sends them on rests too, and lets go after', () => {
    const { seq, ev } = make();
    const t = seq.pattern.tracks[2]!;
    t.length = 4;
    t.steps[1]!.locks = { 'lad.cutoff': 400 };
    t.steps[2]!.locks = { 'lad.cutoff': 800, 'osc3.table': 5 };
    seq.play(0);
    runFor(seq, 0, 0.4);
    const locks = ev.filter((e) => e.type === 'locks').map((e) => [e.part, e.locks, +((e.when! - START) / 0.125).toFixed(3)]);
    expect(locks).toEqual([[2, { 'lad.cutoff': 400 }, 1], [2, { 'lad.cutoff': 800, 'osc3.table': 5 }, 2], [2, {}, 3]]);
  });

  it('mutes, and solo leaves only the soloed tracks', () => {
    const { seq, ev } = make();
    for (const t of seq.pattern.tracks.slice(0, 3)) { t.length = 1; t.steps[0]!.notes = [60]; }
    seq.pattern.tracks[0]!.muted = true;
    seq.play(0);
    runFor(seq, 0, 0.05);
    expect(new Set(ons(ev).map((e) => e[0]))).toEqual(new Set([1, 2]));
    ev.length = 0;
    seq.pattern.tracks[2]!.solo = true;
    runFor(seq, 0.075, 0.5);
    expect(new Set(ons(ev).map((e) => e[0]))).toEqual(new Set([2]));
  });

  it('restarts every track at the pattern length', () => {
    const { seq, ev } = make();
    seq.pattern.length = 4;
    const t = seq.pattern.tracks[0]!;
    t.length = 3;
    t.steps[0]!.notes = [60];
    seq.play(0);
    runFor(seq, 0, 1.0);
    expect(ons(ev).map((e) => e[2])).toEqual([0, 3, 4, 7, 8]);
  });

  it('changes to a queued pattern at the end of this one, and loops a chain', () => {
    const { seq, ev } = make();
    seq.patterns.forEach((p, i) => { p.length = 4; p.tracks[0]!.length = 4; p.tracks[0]!.steps[0]!.notes = [60 + i]; });
    seq.play(0);
    runFor(seq, 0, 0.2);
    seq.queue(5);
    runFor(seq, 0.225, 1.1);
    expect(ons(ev).map((e) => [e[1], e[2]])).toEqual([[60, 0], [65, 4], [65, 8]]);
    ev.length = 0;
    seq.setChain([1, 2]);
    seq.setMode('song');
    runFor(seq, 1.125, 2.6);
    expect(ons(ev).map((e) => e[1])).toEqual([61, 62, 61]);
  });

  describe('the song', () => {
    /** Every pattern four sixteenths long, its first step a note of its own (60 + pattern), and a song of `chain`. */
    function song(chain: number[]) {
      const m = make();
      m.seq.patterns.forEach((p, i) => { p.length = 4; p.tracks[0]!.length = 4; p.tracks[0]!.steps[0]!.notes = [60 + i]; });
      m.seq.setChain(chain);
      return m;
    }
    /** The patterns played, a sixteenth is 0.125 s and a pattern 0.5 s: `n` patterns from `from` seconds. */
    const played = (m: ReturnType<typeof song>, from: number, n: number) => {
      m.ev.length = 0;
      runFor(m.seq, from, from + n * 0.5 - 0.1);
      return ons(m.ev).map((e) => (e[1] as number) - 60);
    };

    it('picking another pattern while the song plays edits it, and the song plays on', () => {
      const m = song([0, 1, 2]);
      m.seq.play(0);
      expect(played(m, 0, 1)).toEqual([0]);
      m.seq.select(7);
      expect(m.seq.editing).toBe(7);
      expect(m.seq.pattern).toBe(m.seq.patterns[7]);
      expect(m.seq.follow).toBe(false);
      expect(played(m, 0.425, 3)).toEqual([1, 2, 0]);
      expect(m.seq.chain).toEqual([0, 1, 2]);
      expect(m.seq.editing).toBe(7); // not following
    });

    it('PATTERN mode loops one pattern; back to SONG it goes on from the block it left', () => {
      const m = song([0, 1, 2, 3]);
      m.seq.play(0);
      played(m, 0, 2); // 0, 1
      m.seq.queue(9); // at the end of 1
      expect(played(m, 0.925, 3)).toEqual([9, 9, 9]);
      expect(m.seq.chain).toEqual([0, 1, 2, 3]);
      m.seq.setMode('song'); // back to block 1, where it left
      expect(played(m, 2.425, 3)).toEqual([1, 2, 3]);
    });

    it('jumps to a block at the end of this pattern, and loops a stretch of the song', () => {
      const m = song([0, 1, 2, 3, 4]);
      m.seq.play(0);
      played(m, 0, 1);
      m.seq.jumpTo(3);
      expect(played(m, 0.425, 2)).toEqual([3, 4]);
      m.seq.setLoop({ from: 1, to: 2 });
      expect(played(m, 1.425, 5)).toEqual([1, 2, 1, 2, 1]);
      m.seq.setLoop();
      expect(played(m, 3.925, 3)).toEqual([2, 3, 4]);
    });

    it('stopped, play starts from the block picked, or the loop’s start', () => {
      const m = song([0, 1, 2, 3]);
      m.seq.jumpTo(2);
      m.seq.play(0);
      expect(played(m, 0, 2)).toEqual([2, 3]);
      m.seq.stop(1);
      expect(m.seq.songPos).toBe(2);
      m.seq.setLoop({ from: 1, to: 1 });
      m.seq.play(1);
      expect(played(m, 1, 2)).toEqual([1, 1]);
    });

    it('editing the song while it plays keeps the same block playing, or goes on to the next if it went', () => {
      const m = song([0, 1, 2, 3]);
      m.seq.play(0);
      played(m, 0, 2); // 0, 1: block 1 playing
      // move the playing block to the end: it plays on, then the song wraps round
      m.seq.editSong(moveBlock(m.seq.chain, 1, 4));
      expect(m.seq.chain).toEqual([0, 2, 3, 1]);
      expect(m.seq.songPos).toBe(3);
      expect(played(m, 0.925, 2)).toEqual([0, 2]);
      // take out the block playing (2): the next block left (3) comes next
      m.seq.editSong(removeBlocks(m.seq.chain, 1));
      expect(m.seq.chain).toEqual([0, 3, 1]);
      expect(played(m, 1.925, 1)).toEqual([3]);
    });
  });

  it('keeps the steps already sent in place when the tempo changes', () => {
    const { seq, ev } = make();
    const t = seq.pattern.tracks[0]!;
    t.length = 1;
    t.steps[0]!.notes = [60];
    seq.play(0);
    runFor(seq, 0, 0.5);
    seq.tempo = 60;
    runFor(seq, 0.525, 1.5);
    const whens = ev.filter((e) => e.type === 'on').map((e) => e.when!);
    const gaps = whens.slice(1).map((w, i) => +(w - whens[i]!).toFixed(6));
    expect(gaps.slice(0, 4)).toEqual([0.125, 0.125, 0.125, 0.125]);
    expect(gaps.at(-1)).toBe(0.25);
    expect(gaps.every((g) => g >= 0.125 && g <= 0.25)).toBe(true); // one step across the change takes some of each
  });

  it('on stop drops what was sent ahead and lets go of every note and lock it started', () => {
    const { seq, ev } = make();
    const t = seq.pattern.tracks[0]!;
    t.length = 2;
    t.steps[0]!.notes = [60];
    t.steps[0]!.gate = 8;
    t.steps[1]!.locks = { 'lad.cutoff': 400 };
    seq.play(0);
    runFor(seq, 0, 0.2);
    ev.length = 0;
    seq.stop(0.2);
    expect(ev[0]!.type).toBe('flush');
    expect(ev.slice(1).map((e) => [e.type, e.note ?? e.locks, e.when])).toEqual([['off', 60, undefined], ['locks', {}, undefined], ['mod', undefined, undefined]]);
  });

  it('finds the step nearest a played note for recording, and does not play it again on this pass', () => {
    const { seq, ev } = make();
    const t = seq.pattern.tracks[0]!;
    t.length = 8;
    seq.play(0);
    runFor(seq, 0, 0.3);
    const near = seq.stepNear(0, START + 0.125 * 4.4)!; // just after step 4
    expect(near.step).toBe(4);
    const late = seq.stepNear(0, START + 0.125 * 5.7)!; // just before step 6
    expect(late.step).toBe(6);
    t.steps[6]!.notes = [72];
    seq.recorded(0, 6, late.tick);
    runFor(seq, 0.325, 0.125 * 15);
    expect(ons(ev).map((e) => e[2])).toEqual([14]);
  });

  it('never sends a note after it is due, even one pulled half a step early on the slowest clock', () => {
    let now = 0;
    const late: number[] = [];
    const seq = new RigSequencer({ on: (_p, _n, _v, when) => { if (when < now) late.push(when - now); }, off() {}, locks() {}, mod() {}, flush() {} }, seeded(2));
    seq.tempo = 140;
    seq.pattern.tracks.forEach((t, i) => {
      t.clock = [6, 8, 12, 16, 24, 32, 48, 96][i % 8]!;
      t.length = 5 + i;
      t.steps.forEach((s, k) => { s.notes = [60]; s.micro = k % 2 ? -0.5 : 0.5; });
    });
    seq.play(0);
    for (now = 0; now < 20; now += 0.025) seq.schedule(now);
    expect(late).toEqual([]);
  });
});


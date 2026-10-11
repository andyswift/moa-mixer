import { describe, expect, it } from 'vitest';
import { DrumMachine, type DrumVoice } from '../devices/drumMachine';
import { DrumSequencer, MAX_LEVEL, STEP_VELOCITY } from '../devices/drumSequencer';
import { MidiClock } from '../midi/clock';
import { parseMidi } from '../midi/events';

interface Hit { voice: DrumVoice; velocity: number; when?: number }

function setup(bpm = 120) {
  const clock = new MidiClock();
  const drums = new DrumMachine('Drums', clock);
  drums.transport.tempo.set(bpm);
  let time = 0;
  const seq = new DrumSequencer(drums, clock, () => time);
  const hits: Hit[] = [];
  drums.onHit((voice, velocity, when) => hits.push({ voice, velocity, when }));
  return {
    clock, drums, seq, hits,
    advance: (seconds: number, stepSize = 0.01) => {
      const end = time + seconds;
      while (time < end) {
        time += stepSize;
        seq.tick();
      }
    },
    setTime: (t: number) => { time = t; },
    now: () => time,
  };
}

const STEP = 60 / 120 / 4; // a sixteenth at 120 BPM: 0.125 s

describe('DrumSequencer patterns', () => {
  it('ships four patterns: A is the design pattern, D is empty', () => {
    const { seq } = setup();
    expect(seq.pattern.options).toEqual(['A', 'B', 'C', 'D']);
    expect(seq.activePattern.kick.map((v, i) => (v > 0 ? i : -1)).filter((i) => i >= 0)).toEqual([0, 4, 8, 10, 12]);
    seq.pattern.set('D');
    expect(Object.values(seq.activePattern).every((row) => row.every((v) => v === 0))).toBe(true);
  });

  it('edits only the selected pattern', () => {
    const { seq } = setup();
    seq.pattern.set('D');
    seq.setLevel('snare', 5, 2);
    seq.pattern.set('A');
    expect(seq.level('snare', 5)).toBe(0);
    seq.pattern.set('D');
    expect(seq.level('snare', 5)).toBe(2);
  });

  it('cycles a step off -> soft -> medium -> hard -> off', () => {
    const { seq } = setup();
    seq.pattern.set('D');
    const seen = [0, 1, 2, 3, 4].map(() => {
      seq.cycle('ride', 0);
      return seq.level('ride', 0);
    });
    expect(seen).toEqual([1, 2, 3, 0, 1]);
  });

  it('clamps levels and notifies listeners on edits and pattern changes', () => {
    const { seq } = setup();
    let changes = 0;
    seq.onChange(() => changes++);
    seq.pattern.set('D');
    seq.setLevel('kick', 0, 99);
    expect(seq.level('kick', 0)).toBe(MAX_LEVEL);
    seq.setLevel('kick', 0, -3);
    expect(seq.level('kick', 0)).toBe(0);
    seq.clearPattern();
    expect(changes).toBe(4);
  });
});

describe('DrumSequencer own clock', () => {
  it('does nothing until played, and stop silences it', () => {
    const { seq, hits, advance } = setup();
    advance(1);
    expect(hits).toEqual([]);
    seq.play();
    expect(seq.running).toBe(true);
    advance(0.5);
    expect(hits.length).toBeGreaterThan(0);
    seq.stop();
    const count = hits.length;
    advance(1);
    expect(hits.length).toBe(count);
    expect(seq.running).toBe(false);
  });

  it('schedules steps on the audio clock, one sixteenth apart, with velocity from the level', () => {
    const { seq, hits, advance } = setup(120);
    seq.pattern.set('D');
    for (let s = 0; s < 16; s++) seq.setLevel('kick', s, 1 + (s % 3));
    seq.play();
    advance(1.2);
    const first = hits.filter((h) => h.voice === 'kick').slice(0, 5);
    expect(first.map((h) => h.velocity)).toEqual([STEP_VELOCITY[1], STEP_VELOCITY[2], STEP_VELOCITY[3], STEP_VELOCITY[1], STEP_VELOCITY[2]]);
    const gaps = first.slice(1).map((h, i) => h.when! - first[i]!.when!);
    // swing shifts odd steps, but each pair of steps is exactly two sixteenths long
    expect(gaps[0]! + gaps[1]!).toBeCloseTo(2 * STEP, 6);
    expect(gaps[2]! + gaps[3]!).toBeCloseTo(2 * STEP, 6);
  });

  it('with swing at 50% steps are straight; at 67% off-beats land two thirds through the pair', () => {
    const run = (swing: number) => {
      const { seq, hits, advance } = setup(120);
      seq.swing.set(swing);
      seq.pattern.set('D');
      seq.setLevel('kick', 0, 3);
      seq.setLevel('kick', 1, 3);
      seq.play();
      advance(0.5);
      const [a, b] = hits.filter((h) => h.voice === 'kick');
      return (b!.when! - a!.when!) / (2 * STEP);
    };
    expect(run(50)).toBeCloseTo(0.5, 6);
    expect(run(67)).toBeCloseTo(0.67, 6);
  });

  it('follows the transport tempo', () => {
    const { seq, drums, hits, advance } = setup(120);
    drums.transport.tempo.set(60);
    seq.pattern.set('D');
    seq.swing.set(50);
    seq.setLevel('snare', 0, 3);
    seq.setLevel('snare', 1, 3);
    seq.play();
    advance(1);
    const [a, b] = hits.filter((h) => h.voice === 'snare');
    expect(b!.when! - a!.when!).toBeCloseTo(0.25, 6); // a sixteenth at 60 BPM
  });

  it('loops after 16 steps', () => {
    const { seq, hits, advance } = setup(120);
    seq.pattern.set('D');
    seq.setLevel('clap', 0, 3);
    seq.play();
    advance(2.5);
    const claps = hits.filter((h) => h.voice === 'clap');
    expect(claps.length).toBeGreaterThanOrEqual(2);
    expect(claps[1]!.when! - claps[0]!.when!).toBeCloseTo(16 * STEP, 6);
  });

  it('jumps to now instead of bursting after a long stall', () => {
    const { seq, hits, setTime, advance, now } = setup(120);
    seq.pattern.set('A');
    seq.play();
    advance(0.3);
    hits.length = 0;
    setTime(now() + 30); // tab suspended for 30 s
    seq.tick();
    expect(hits.length).toBeLessThan(10);
    expect(Math.min(...hits.map((h) => h.when!))).toBeGreaterThanOrEqual(now() - 1e-9);
  });

  it('reports the step being heard and the position', () => {
    const { seq, advance } = setup(120);
    expect(seq.currentStep()).toBeUndefined();
    seq.play();
    advance(0.4);
    // 0.05 start delay, then steps at 0.125 s: at t=0.4 steps 0,1,2 have started
    expect(seq.currentStep()).toBe(2);
    expect(seq.position).toEqual({ bar: 1, beat: 1, sixteenth: 3 });
    advance(2); // t = 2.4: (2.4-0.05)/0.125 = 18.8 -> step index 18 -> 2 on the second lap
    expect(seq.currentStep()).toBe(2);
    expect(seq.position).toEqual({ bar: 2, beat: 1, sixteenth: 3 });
  });

  it('a closed hat on the pattern chokes the open hat at its scheduled time', () => {
    const { seq, drums, advance } = setup(120);
    const log: { type: string; when?: number }[] = [];
    drums.circuit.onChange((c) => {
      if (c.type === 'choke') log.push({ type: c.type, when: c.when });
    });
    seq.pattern.set('D');
    seq.setLevel('closedHat', 2, 3);
    seq.play();
    advance(0.5);
    expect(log).toHaveLength(1);
    expect(log[0]!.when).toBeCloseTo(0.05 + 2 * STEP + 0, 6); // step 2 is an even step: no swing delay
  });

  it('ignores play while following MIDI start/stop', () => {
    const { seq, drums } = setup();
    drums.transport.sync.set('midi');
    seq.play();
    expect(seq.running).toBe(false);
  });
});

describe('DrumSequencer following MIDI clock', () => {
  const feed = (ctx: ReturnType<typeof setup>, bytes: number[], t: number) => {
    const event = parseMidi(bytes)!;
    ctx.clock.handle(event, t);
    ctx.seq.handleMidi(event);
  };

  it('steps once per six pulses after a start, and stops on stop', () => {
    const ctx = setup();
    ctx.drums.transport.sync.set('midi');
    ctx.seq.pattern.set('D');
    ctx.seq.setLevel('kick', 0, 3);
    ctx.seq.setLevel('kick', 1, 3);
    ctx.seq.setLevel('kick', 2, 3);
    feed(ctx, [0xfa], 0);
    expect(ctx.seq.running).toBe(true);
    for (let i = 0; i < 6 * 3; i++) feed(ctx, [0xf8], i * 20);
    expect(ctx.hits.filter((h) => h.voice === 'kick')).toHaveLength(3);
    expect(ctx.seq.position).toEqual({ bar: 1, beat: 1, sixteenth: 4 });
    feed(ctx, [0xfc], 400);
    expect(ctx.seq.running).toBe(false);
    for (let i = 0; i < 12; i++) feed(ctx, [0xf8], 500 + i * 20);
    expect(ctx.hits.filter((h) => h.voice === 'kick')).toHaveLength(3);
  });

  it('does nothing before a start message and restarts at step 1 on each start', () => {
    const ctx = setup();
    ctx.drums.transport.sync.set('midi');
    ctx.seq.pattern.set('D');
    ctx.seq.setLevel('snare', 0, 3);
    for (let i = 0; i < 12; i++) feed(ctx, [0xf8], i * 20);
    expect(ctx.hits).toHaveLength(0);
    feed(ctx, [0xfa], 300);
    feed(ctx, [0xf8], 320);
    expect(ctx.hits.map((h) => h.voice)).toEqual(['snare']);
    for (let i = 0; i < 20; i++) feed(ctx, [0xf8], 340 + i * 20);
    feed(ctx, [0xfa], 800);
    feed(ctx, [0xf8], 820);
    expect(ctx.hits.filter((h) => h.voice === 'snare')).toHaveLength(2);
  });

  it('applies swing to off-beat steps when following clock', () => {
    const ctx = setup(120);
    ctx.drums.transport.sync.set('midi');
    ctx.seq.swing.set(75);
    ctx.seq.pattern.set('D');
    ctx.seq.setLevel('kick', 1, 3);
    feed(ctx, [0xfa], 0);
    for (let i = 0; i < 12; i++) feed(ctx, [0xf8], i * 20);
    const kick = ctx.hits.find((h) => h.voice === 'kick')!;
    expect(kick.when).toBeGreaterThan(ctx.now());
  });

  it('with start/stop following off, the synced sequencer runs on its own with the clock tempo', () => {
    const ctx = setup(120);
    ctx.drums.transport.sync.set('midi');
    ctx.drums.transport.followStartStop.set(false);
    ctx.seq.pattern.set('D');
    ctx.seq.setLevel('kick', 0, 3);
    expect(ctx.seq.externallyDriven).toBe(false);
    ctx.seq.play();
    ctx.advance(0.3);
    expect(ctx.hits.filter((h) => h.voice === 'kick')).toHaveLength(1);
  });
});

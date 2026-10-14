import { describe, expect, it } from 'vitest';
import { BAR_TICKS, DIVISIONS, QUADRUPLETS, TRIPLETS, nearestDivision, stepDivision } from '../../sequencer/division';
import { SequencerEngine, type SeqEvent, chordFor, seeded, sustainTicks, tickSeconds } from '../../sequencer/engine';
import { euclid, rotate } from '../../sequencer/euclid';
import { GROOVES, grooveVelocity } from '../../sequencer/grooves';
import { harmonise, inScale, scaleNotes, transposeInScale } from '../../sequencer/scales';
import { INFINITE_REPEATS, newBank, newTrack, patternEdited, sanitiseTrack } from '../../sequencer/track';

const show = (p: boolean[]): string => p.map((x) => (x ? 'x' : '.')).join('');

describe('euclid', () => {
  it('spreads pulses evenly (Bjorklund)', () => {
    expect(show(euclid(4, 16))).toBe('x...x...x...x...');
    expect(show(euclid(3, 8))).toBe('x..x..x.');
    expect(show(euclid(5, 8))).toBe('x.xx.xx.');
    expect(show(euclid(0, 8))).toBe('........');
    expect(show(euclid(8, 8))).toBe('xxxxxxxx');
    expect(euclid(5, 16).filter(Boolean)).toHaveLength(5);
    expect(euclid(7, 12).filter(Boolean)).toHaveLength(7);
    expect(euclid(3, 0)).toEqual([]);
  });

  it('rotates a pattern later or earlier, wrapping', () => {
    expect(show(rotate(euclid(3, 8), 1))).toBe('.x..x..x');
    expect(show(rotate(euclid(3, 8), -1))).toBe('..x..x.x');
    expect(show(rotate(euclid(3, 8), 8))).toBe('x..x..x.');
  });
});

describe('divisions', () => {
  it('have the tick lengths of the T-1 note values', () => {
    expect(QUADRUPLETS.map((d) => d.ticks)).toEqual([384, 192, 96, 48, 24, 12, 6]);
    expect(TRIPLETS.map((d) => d.ticks)).toEqual([128, 64, 32, 16, 8]);
    expect(DIVISIONS.map((d) => d.ticks)).toEqual([...DIVISIONS.map((d) => d.ticks)].sort((a, b) => b - a));
  });

  it('step to a shorter or longer note and snap a free division', () => {
    expect(stepDivision(24, 1)).toBe(16);
    expect(stepDivision(24, -1)).toBe(32);
    expect(stepDivision(23, 1)).toBe(16);
    expect(nearestDivision(25).ticks).toBe(24);
    expect(stepDivision(6, 1)).toBe(6);
  });
});

describe('scales', () => {
  it('knows which notes are in a scale and moves by degrees', () => {
    expect(inScale(64, 1, 0)).toBe(true); // E in C major
    expect(inScale(63, 1, 0)).toBe(false);
    expect(inScale(63, 2, 0)).toBe(true); // Eb in C minor
    expect(inScale(66, 1, 7)).toBe(true); // F# in G major
    expect(transposeInScale(60, 1, 1, 0)).toBe(62);
    expect(transposeInScale(60, 3, 1, 0)).toBe(65);
    expect(transposeInScale(60, -1, 1, 0)).toBe(59);
    expect(transposeInScale(61, 1, 1, 0)).toBe(62); // C# snaps down to C, then up a degree to D
    expect(scaleNotes(3, 0, 60, 72)).toEqual([60, 63, 65, 67, 70, 72]);
  });

  it('harmony walks a chord through new voicings inside the scale', () => {
    const triad = [60, 64, 67];
    const first = harmonise(triad, 1, 1, 0);
    expect(first).not.toEqual(triad);
    expect(first.every((n) => inScale(n, 1, 0))).toBe(true);
    expect(harmonise(triad, 0, 1, 0)).toEqual(triad);
  });
});

describe('grooves and sustain', () => {
  it('shapes velocity by accent, and inverts at negative accent', () => {
    expect(GROOVES).toHaveLength(8);
    expect(grooveVelocity(100, 4, 0, 5)).toBe(100);
    expect(grooveVelocity(100, 4, 1, 0)).toBe(100); // saw starts at its top
    expect(grooveVelocity(100, 4, 1, 8)).toBeLessThan(60);
    expect(grooveVelocity(100, 4, -1, 8)).toBeGreaterThan(grooveVelocity(100, 4, -1, 0));
  });

  it('50% sustain is one division, 100% sixteen, below 50% a fraction', () => {
    expect(sustainTicks(0.5, 24)).toBe(24);
    expect(sustainTicks(1, 24)).toBe(24 * 16);
    expect(sustainTicks(0.25, 24)).toBe(12);
    expect(sustainTicks(0, 24)).toBe(1);
  });
});

const engineWith = (mut: (t: ReturnType<typeof newTrack>) => void, seed = 1): SequencerEngine => {
  const bank = newBank();
  mut(bank.patterns[0]!.tracks[0]!);
  const e = new SequencerEngine(bank, seeded(seed));
  e.start();
  return e;
};
const ons = (events: SeqEvent[], track = 0): SeqEvent[] => events.filter((e) => e.kind === 'on' && e.track === track);
const ticks = (events: SeqEvent[]): number[] => events.map((e) => e.tick);

describe('engine: pulses and timing', () => {
  it('plays a Euclidean pattern on the grid, looping', () => {
    const e = engineWith((t) => { t.pulses = 4; });
    expect(ticks(ons(e.advance(BAR_TICKS * 2)))).toEqual([0, 96, 192, 288, 384, 480, 576, 672]);
  });

  it('rotate starts the pattern later', () => {
    const e = engineWith((t) => { t.pulses = 4; t.rotate = 1; });
    expect(ticks(ons(e.advance(BAR_TICKS)))).toEqual([24, 120, 216, 312]);
  });

  it('a track loops over its own step count, giving polyrhythm', () => {
    const e = engineWith((t) => { t.steps = 7; t.pulses = 1; });
    expect(ticks(ons(e.advance(24 * 7 * 3 + 1)))).toEqual([0, 168, 336, 504]);
  });

  it('length shortens the loop', () => {
    const e = engineWith((t) => { t.pulses = 1; t.length = 96; });
    expect(ticks(ons(e.advance(300)))).toEqual([0, 96, 192, 288]);
  });

  it('division sets the step length', () => {
    const e = engineWith((t) => { t.pulses = 16; t.division = 12; t.steps = 16; });
    expect(ticks(ons(e.advance(48)))).toEqual([0, 12, 24, 36]);
  });

  it('manual pulses play and survive Euclidean edits', () => {
    const e = engineWith((t) => { t.pulses = 0; t.manual[2] = true; });
    expect(ticks(ons(e.advance(BAR_TICKS)))).toEqual([48]);
  });

  it('micro-timing moves the odd steps and delay moves everything', () => {
    const e = engineWith((t) => { t.pulses = 16; t.timing = 1; });
    const on = ticks(ons(e.advance(48)));
    expect(on).toEqual([0, 36]);
    const d = engineWith((t) => { t.pulses = 4; t.delay = 12; });
    expect(ticks(ons(d.advance(BAR_TICKS)))).toEqual([12, 108, 204, 300]);
    const early = engineWith((t) => { t.pulses = 4; t.delay = -12; });
    expect(ticks(ons(early.advance(BAR_TICKS)))).toEqual([84, 180, 276, 372]);
  });

  it('notes end after the sustain, and a new pulse cuts the previous note', () => {
    const e = engineWith((t) => { t.pulses = 4; t.sustain = 0.5; });
    const ev = e.advance(BAR_TICKS);
    const off = ev.filter((x) => x.kind === 'off');
    expect(ticks(off)).toEqual([24, 120, 216, 312]);
    const long = engineWith((t) => { t.pulses = 4; t.sustain = 1; });
    const lev = long.advance(200);
    // the long note is cut by the next pulse at 96, so its off lands there, before the new on
    const firstOff = lev.find((x) => x.kind === 'off')!;
    expect(firstOff.tick).toBe(96);
    expect(lev.indexOf(firstOff)).toBeLessThan(lev.findIndex((x) => x.kind === 'on' && x.tick === 96));
  });
});

describe('engine: variation', () => {
  it('repeats echo a pulse at the repeat time, with an offset ramp', () => {
    const e = engineWith((t) => { t.pulses = 1; t.repeats = 3; t.repeatTime = 12; t.velocity = 50; t.repeatOffset = 1; });
    const o = ons(e.advance(BAR_TICKS));
    expect(ticks(o)).toEqual([0, 12, 24, 36]);
    expect(o[3]!.velocity).toBeGreaterThan(o[1]!.velocity);
    const down = engineWith((t) => { t.pulses = 1; t.repeats = 3; t.repeatTime = 12; t.velocity = 100; t.repeatOffset = -1; });
    const d = ons(down.advance(BAR_TICKS));
    expect(d[3]!.velocity).toBeLessThan(d[1]!.velocity);
  });

  it('pace accelerates or decelerates the repeats', () => {
    const slow = ticks(ons(engineWith((t) => { t.pulses = 1; t.repeats = 4; t.repeatTime = 12; t.repeatPace = 1; }).advance(BAR_TICKS)));
    const fast = ticks(ons(engineWith((t) => { t.pulses = 1; t.repeats = 4; t.repeatTime = 12; t.repeatPace = -1; }).advance(BAR_TICKS)));
    const gaps = (a: number[]) => a.slice(1).map((x, i) => x - a[i]!);
    expect(gaps(slow)[3]!).toBeGreaterThan(gaps(slow)[0]!);
    expect(gaps(fast)[3]!).toBeLessThan(gaps(fast)[0]!);
  });

  it('choke drops a pulse’s repeats when the next pulse arrives; tail lets them overlay', () => {
    const choke = engineWith((t) => { t.pulses = 4; t.repeats = 20; t.repeatTime = 12; t.repeatMode = 'choke'; });
    const c = ons(choke.advance(96));
    expect(ticks(c).every((x) => x < 96)).toBe(true);
    expect(c.length).toBeLessThanOrEqual(8); // 96 / 12
    const tail = engineWith((t) => { t.pulses = 1; t.repeats = 20; t.repeatTime = 12; t.repeatMode = 'tail'; });
    expect(ons(tail.advance(BAR_TICKS)).length).toBe(21);
  });

  it('infinite repeats run until the next pulse', () => {
    const e = engineWith((t) => { t.pulses = 2; t.repeats = INFINITE_REPEATS; t.repeatTime = 24; });
    const o = ticks(ons(e.advance(BAR_TICKS)));
    expect(o.length).toBeGreaterThan(12);
    expect(o.length).toBeLessThanOrEqual(16);
  });

  it('probability silences pulses, and everything at 100% in either direction', () => {
    const none = engineWith((t) => { t.pulses = 16; t.probability = 1; });
    expect(ons(none.advance(BAR_TICKS))).toHaveLength(0);
    const neg = engineWith((t) => { t.pulses = 16; t.probability = -1; });
    expect(ons(neg.advance(BAR_TICKS))).toHaveLength(0);
    const all = engineWith((t) => { t.pulses = 16; t.probability = 0; });
    expect(ons(all.advance(BAR_TICKS))).toHaveLength(16);
    const half = engineWith((t) => { t.pulses = 16; t.probability = 0.5; }, 7);
    const n = ons(half.advance(BAR_TICKS * 8)).length;
    expect(n).toBeGreaterThan(40);
    expect(n).toBeLessThan(90);
  });

  it('negative probability also silences a pulse’s repeats, positive may keep them', () => {
    const neg = engineWith((t) => { t.pulses = 4; t.repeats = 2; t.repeatTime = 6; t.probability = -0.5; }, 3);
    const o = ons(neg.advance(BAR_TICKS));
    // every sounding pulse brings its two repeats, silenced pulses bring none
    expect(o.length % 3).toBe(0);
  });

  it('velocity, accent and groove shape the note velocities', () => {
    const e = engineWith((t) => { t.pulses = 4; t.velocity = 90; t.accent = 1; t.groove = 4; });
    const v = ons(e.advance(BAR_TICKS)).map((x) => x.velocity);
    expect(v[0]).toBe(90);
    expect(v[3]!).toBeLessThan(v[0]!);
  });

  it('plays the pitch menu as a chord, moved by pitch and harmony within the scale', () => {
    const e = engineWith((t) => { t.pulses = 1; t.pitchNotes = [60, 64, 67]; });
    expect(ons(e.advance(10)).map((x) => x.note).sort()).toEqual([60, 64, 67]);
    const t = newTrack();
    t.pitchNotes = [60, 64, 67]; t.scale = 1; t.pitch = 1;
    expect(chordFor(t, 1, 0, t.userScale)).toEqual([62, 65, 69]);
  });

  it('per-step locks override a step, and cycle overrides apply on their loop', () => {
    const e = engineWith((t) => { t.pulses = 2; t.locks = { 0: { velocity: 30 } }; });
    expect(ons(e.advance(BAR_TICKS)).map((x) => x.velocity)).toEqual([30, 100]);
    const c = engineWith((t) => { t.pulses = 1; t.cycleOverrides[1] = { velocity: 40 }; t.cycles = 2; });
    expect(ons(c.advance(BAR_TICKS * 3)).map((x) => x.velocity)).toEqual([100, 40, 100]);
  });

  it('a lock with a pulse places one on a step with none', () => {
    const e = engineWith((t) => { t.pulses = 0; t.locks = { 5: { pulse: true } }; });
    expect(ticks(ons(e.advance(BAR_TICKS)))).toEqual([120]);
  });

  it('a muted track plays nothing', () => {
    const e = engineWith((t) => { t.pulses = 4; t.muted = true; });
    expect(ons(e.advance(BAR_TICKS))).toHaveLength(0);
  });

  it('each track sends on its own channel', () => {
    const e = engineWith((t) => { t.pulses = 1; t.channel = 5; });
    expect(ons(e.advance(10))[0]!.channel).toBe(5);
  });
});

describe('engine: transport and patterns', () => {
  it('stop silences sounding notes', () => {
    const e = engineWith((t) => { t.pulses = 1; t.sustain = 1; });
    e.advance(10);
    const off = e.stop();
    expect(off.filter((x) => x.kind === 'off')).toHaveLength(1);
    expect(e.playing).toBe(false);
  });

  it('a queued pattern starts at the next quantize boundary', () => {
    const bank = newBank();
    bank.patterns[0]!.tracks[0]!.pulses = 4;
    bank.patterns[1]!.tracks[0]!.pulses = 4;
    bank.patterns[1]!.tracks[0]!.pitchNotes = [72];
    const e = new SequencerEngine(bank, seeded(1));
    e.start();
    const a = e.advance(100);
    e.queue(1);
    const b = e.advance(BAR_TICKS + 100);
    const notes = [...a, ...b].filter((x) => x.kind === 'on');
    expect(notes.filter((x) => x.tick < BAR_TICKS).every((x) => x.note === 60)).toBe(true);
    expect(notes.filter((x) => x.tick >= BAR_TICKS).every((x) => x.note === 72)).toBe(true);
    expect(e.patternIndex).toBe(1);
  });

  it('a chain steps through its patterns in order, looping', () => {
    const bank = newBank();
    [0, 1, 2].forEach((i) => { bank.patterns[i]!.tracks[0]!.pulses = 1; bank.patterns[i]!.tracks[0]!.pitchNotes = [60 + i]; });
    const e = new SequencerEngine(bank, seeded(1));
    e.setChain([0, 1, 2]);
    e.start();
    const notes = e.advance(BAR_TICKS * 4).filter((x) => x.kind === 'on').map((x) => x.note);
    expect(notes).toEqual([60, 61, 62, 60]);
  });
});

describe('tracks and banks', () => {
  it('tick length follows tempo', () => {
    expect(tickSeconds(120)).toBeCloseTo(60 / (120 * 96), 10);
  });

  it('sanitising keeps values in range and a fresh pattern is not edited', () => {
    const t = sanitiseTrack({ ...newTrack(), steps: 200, pulses: 99, velocity: 999, channel: 40, repeats: 99, cycles: 99 });
    expect(t.steps).toBe(64);
    expect(t.pulses).toBe(64);
    expect(t.velocity).toBe(127);
    expect(t.channel).toBe(16);
    expect(t.repeats).toBe(INFINITE_REPEATS);
    expect(t.cycles).toBe(16);
    const bank = newBank();
    expect(patternEdited(bank.patterns[0]!)).toBe(false);
    bank.patterns[0]!.tracks[3]!.pulses = 2;
    expect(patternEdited(bank.patterns[0]!)).toBe(true);
  });
});

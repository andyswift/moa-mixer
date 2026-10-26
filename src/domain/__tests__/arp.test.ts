import { describe, expect, it } from 'vitest';
import { Arpeggiator, arpStepMs } from '../devices/arpeggiator';
import { CHORD_SHAPES, CHORD_TYPES, chordFromNotes, chordNotes, parseChord } from '../devices/chords';
import { POLY_VOICES, PolySynth } from '../devices/polySynth';
import { POLY_PRESETS } from '../devices/polyPresets';
import { MidiClock } from '../midi/clock';
import { parseMidi } from '../midi/events';

const steps = (a: Arpeggiator, notes: number[], n: number) => Array.from({ length: n }, () => a.next(notes));
const set = (s: PolySynth, id: string, v: number | string | boolean) => (s.control(id) as { set(v: unknown): void }).set(v);

/** A synth on a fake clock, and the notes sounding (voice pitches, gated) at any moment. */
function rig(bpm = 120) {
  let t = 1000;
  const clock = new MidiClock();
  const s = new PolySynth('Poly', clock, () => t);
  s.transport.tempo.set(bpm);
  const sounding = () =>
    Array.from({ length: POLY_VOICES }, (_, i) => i)
      .filter((i) => s.circuit.node(`v${i}.env2`).params.gate === 1)
      .map((i) => 69 + s.circuit.node(`v${i}.pitch`).params.offset! / 100)
      .sort((a, b) => a - b);
  const advance = (ms: number) => {
    for (let i = 0; i < ms; i++) {
      t += 1;
      s.tick();
    }
  };
  const midi = (bytes: number[]) => {
    const e = parseMidi(bytes)!;
    clock.handle(e, t);
    s.handleMidi(e);
  };
  return { s, sounding, advance, midi, clock };
}

describe('Arpeggiator', () => {
  it('runs up, down and up/down through the notes by pitch, turning without repeating the ends', () => {
    const a = new Arpeggiator();
    expect(steps(a, [67, 60, 64], 4)).toEqual([[60], [64], [67], [60]]);
    a.mode = 'down';
    expect(a.pattern([67, 60, 64])).toEqual([67, 64, 60]);
    a.mode = 'updown';
    expect(a.pattern([60, 64, 67, 72])).toEqual([60, 64, 67, 72, 67, 64]);
    expect(a.pattern([60, 64])).toEqual([60, 64]);
  });

  it('keeps the played order in order mode, and spans octaves', () => {
    const a = new Arpeggiator();
    a.mode = 'order';
    a.octaves = 2;
    expect(a.pattern([67, 60])).toEqual([67, 60, 79, 72]);
    a.mode = 'up';
    a.octaves = 3;
    expect(a.pattern([120])).toEqual([120]); // octaves above 127 are dropped
  });

  it('random picks from the pattern', () => {
    const a = new Arpeggiator(() => 0.99);
    a.mode = 'random';
    expect(a.next([60, 64, 67])).toEqual([67]);
  });

  it('keeps its place when notes are added mid-run, and reset starts over', () => {
    const a = new Arpeggiator();
    expect(steps(a, [60, 64], 2)).toEqual([[60], [64]]);
    expect(a.next([60, 64, 67])).toEqual([67]);
    expect(a.next([55, 60, 64, 67])).toEqual([55]); // a note below shifts the indices: still after the 67
    expect(a.next([55, 60, 64, 67])).toEqual([60]);
    a.reset();
    expect(a.next([60, 64, 67])).toEqual([60]);
    expect(a.next([])).toEqual([]);
  });

  it('double and triple play consecutive notes together, sliding one note a step', () => {
    const a = new Arpeggiator();
    a.group = 2;
    expect(steps(a, [60, 64, 67], 4)).toEqual([[60, 64], [64, 67], [67, 60], [60, 64]]);
    a.reset();
    a.group = 3;
    a.octaves = 2;
    expect(steps(a, [60, 64, 67], 2)).toEqual([[60, 64, 67], [64, 67, 72]]);
    a.reset();
    a.octaves = 1;
    expect(a.next([60])).toEqual([60]); // a group never repeats a note
  });

  it('times a step from the rate and tempo', () => {
    expect(arpStepMs('1/16', 120)).toBe(125);
    expect(arpStepMs('1/8T', 120)).toBeCloseTo(166.67, 1);
    expect(arpStepMs('1/4', 60)).toBe(1000);
  });
});

describe('Chords', () => {
  it('builds a chord on a key and learns one from held notes', () => {
    expect(chordNotes(60, [0, 4, 7])).toEqual([60, 64, 67]);
    expect(chordNotes(125, [0, 4, 7])).toEqual([125]);
    expect(chordFromNotes([67, 60, 76])).toBe('0,7,16');
    expect(() => chordFromNotes([])).toThrow();
  });

  it('reads stored chord memories defensively', () => {
    expect(parseChord('0, 4,7')).toEqual([0, 4, 7]);
    expect(parseChord('7,4')).toEqual([0, 4, 7]);
    expect(parseChord('junk')).toEqual([0]);
    expect(parseChord('0,1,2,3,4,5,6,7')).toHaveLength(6);
  });
});

describe('PolySynth chord mode', () => {
  it('plays a shape on every key and releases it with the key', () => {
    const { s, sounding } = rig();
    set(s, 'chord.type', 'min');
    s.keyDown(57);
    expect(sounding()).toEqual([57, 60, 64]);
    expect(s.heldNotes).toEqual([57]);
    s.keyUp(57);
    expect(sounding()).toEqual([]);
  });

  it('a note shared by two overlapping chords keeps sounding until the last key lets go', () => {
    const { s, sounding } = rig();
    set(s, 'chord.type', '5th');
    s.keyDown(60); // C G
    s.keyDown(67); // G D
    s.keyUp(60);
    expect(sounding()).toEqual([67, 74]);
  });

  it('a key held through a chord change releases the notes it started', () => {
    const { s, sounding } = rig();
    set(s, 'chord.type', 'maj');
    s.keyDown(60);
    set(s, 'chord.type', 'oct');
    s.keyUp(60);
    expect(sounding()).toEqual([]);
  });

  it('Memory learns the held keys as the chord, which is saved with the patch', () => {
    const { s, sounding } = rig();
    expect(s.learnChord()).toBe(false);
    s.keyDown(60);
    s.keyDown(63);
    s.keyDown(70);
    expect(s.learnChord()).toBe(true);
    expect(s.control('chord.type').value).toBe('memory');
    expect(s.chordMemoryNotes).toEqual([0, 3, 10]);
    for (const n of [60, 63, 70]) s.keyUp(n);
    s.keyDown(62);
    expect(sounding()).toEqual([62, 65, 72]);
    s.keyUp(62);
    const saved = s.saveSlot(15, 'Learned');
    s.loadSlot(0);
    expect(s.control('chord.type').value).toBe('off');
    s.loadPreset(saved);
    expect(s.chordMemoryNotes).toEqual([0, 3, 10]);
  });
});

describe('PolySynth arpeggiator', () => {
  it('steps through the held keys at the tempo, the first note at once, with the gate setting the length', () => {
    const { s, sounding, advance } = rig(120); // 1/16 = 125 ms
    set(s, 'arp.on', true);
    set(s, 'arp.gate', 50);
    s.keyDown(64);
    s.keyDown(60);
    expect(sounding()).toEqual([64]); // the first key starts at once
    advance(70);
    expect(sounding()).toEqual([]); // gate 50 %: off after 62.5 ms
    advance(60);
    expect(sounding()).toEqual([60]); // carries on after the 64 it played: round to the 60, no repeat
    advance(125);
    expect(sounding()).toEqual([64]);
  });

  it('stops when the keys are let go, and latch keeps it running until a new chord starts', () => {
    const { s, sounding, advance } = rig();
    set(s, 'arp.on', true);
    s.keyDown(60);
    s.keyUp(60);
    advance(400);
    expect(sounding()).toEqual([]);

    set(s, 'arp.latch', true);
    s.keyDown(60);
    s.keyDown(64);
    s.keyUp(60);
    s.keyUp(64);
    advance(250);
    expect(sounding()).toHaveLength(1);
    s.keyDown(72); // all keys were up: a new chord replaces the latched one
    advance(500);
    expect(sounding().every((n) => n === 72) || sounding().length === 0).toBe(true);
    set(s, 'arp.latch', false); // unlatching keeps only the keys still held
    s.keyUp(72);
    advance(400);
    expect(sounding()).toEqual([]);
  });

  it('arpeggiates chord mode: every chord note, octaves and groups together', () => {
    const { s, sounding, advance } = rig(120);
    set(s, 'chord.type', 'maj');
    set(s, 'arp.on', true);
    set(s, 'arp.gate', 90);
    set(s, 'arp.group', '2');
    s.keyDown(60);
    expect(sounding()).toEqual([60, 64]);
    advance(125);
    expect(sounding()).toEqual([64, 67]);
    advance(125);
    expect(sounding()).toEqual([60, 67]);
  });

  it('turning the arp on takes over held keys, turning it off plays them as normal again', () => {
    const { s, sounding, advance } = rig();
    s.keyDown(60);
    s.keyDown(64);
    set(s, 'arp.on', true);
    set(s, 'arp.gate', 100);
    expect(sounding()).toEqual([60]);
    advance(130);
    expect(sounding()).toEqual([64]);
    set(s, 'arp.on', false);
    expect(sounding()).toEqual([60, 64]);
    s.keyUp(60);
    s.keyUp(64);
    expect(sounding()).toEqual([]);
  });

  it('a sleeping tab carries on from now instead of firing every missed step', () => {
    const { s, sounding, advance } = rig();
    set(s, 'arp.on', true);
    set(s, 'arp.gate', 100);
    s.keyDown(60);
    s.keyDown(64);
    s.keyDown(67);
    s.tick(1000 + 5000); // five seconds late in one go
    expect(sounding()).toHaveLength(1);
    advance(1);
    expect(sounding()).toHaveLength(1);
  });

  it('synced to MIDI clock, steps on the clock grid (1/16 = every 6 pulses)', () => {
    const { s, sounding, advance, midi } = rig();
    s.transport.sync.set('midi');
    set(s, 'arp.on', true);
    set(s, 'arp.gate', 100);
    s.keyDown(60);
    s.keyDown(64);
    advance(200);
    expect(sounding()).toEqual([]); // waits for the clock
    midi([0xfa]);
    midi([0xf8]); // pulse 0
    expect(sounding()).toEqual([60]);
    for (let i = 0; i < 5; i++) midi([0xf8]);
    expect(sounding()).toEqual([60]);
    midi([0xf8]); // pulse 6
    expect(sounding()).toEqual([64]);
  });

  it('every factory patch leaves the arp and chord mode off', () => {
    const { s } = rig();
    for (const p of POLY_PRESETS) {
      s.loadPreset(p);
      expect(s.control('arp.on').value).toBe(false);
      expect(s.control('chord.type').value).toBe('off');
    }
  });

  it('loading a patch or changing voice mode stops a running arp', () => {
    const { s, sounding, advance } = rig();
    set(s, 'arp.on', true);
    set(s, 'arp.latch', true);
    s.keyDown(60);
    s.keyUp(60);
    set(s, 'voices.mode', 'mono');
    advance(500);
    expect(sounding()).toEqual([]);
  });
});

describe('Chord types', () => {
  it('are listed in panel order, every shape plus memory', () => {
    expect(CHORD_TYPES).toEqual(['off', 'maj', 'min', '7', 'm7', 'maj7', 'sus4', '5th', 'oct', 'memory']);
    expect(new Set(CHORD_TYPES)).toEqual(new Set([...Object.keys(CHORD_SHAPES), 'memory']));
  });
});

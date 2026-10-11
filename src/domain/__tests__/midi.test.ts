import { describe, expect, it } from 'vitest';
import { Synthesizer } from '../devices/synthesizer';
import { SYNTH_PRESETS } from '../devices/synthPresets';
import { DEFAULT_CC_MAP } from '../midi/ccMap';
import { MidiClock, positionFromTicks } from '../midi/clock';
import { parseMidi } from '../midi/events';
import { formatEvent, noteName } from '../midi/format';
import { MidiMonitor } from '../midi/monitor';
import { Transport } from '../devices/transport';

describe('parseMidi', () => {
  it('parses notes with 1-based channels; velocity 0 is a note off', () => {
    expect(parseMidi([0x90, 60, 96])).toEqual({ type: 'noteOn', channel: 1, note: 60, velocity: 96 });
    expect(parseMidi([0x93, 60, 0])).toEqual({ type: 'noteOff', channel: 4, note: 60, velocity: 0 });
    expect(parseMidi([0x80, 64, 10])).toEqual({ type: 'noteOff', channel: 1, note: 64, velocity: 10 });
  });

  it('parses CC, program change and pitch bend', () => {
    expect(parseMidi([0xb0, 74, 87])).toEqual({ type: 'cc', channel: 1, controller: 74, value: 87 });
    expect(parseMidi([0xc1, 5])).toEqual({ type: 'programChange', channel: 2, program: 5 });
    const centre = parseMidi([0xe0, 0, 64]);
    expect(centre).toMatchObject({ type: 'pitchBend' });
    expect((centre as { value: number }).value).toBeCloseTo(0);
    expect((parseMidi([0xe0, 127, 127]) as { value: number }).value).toBeCloseTo(1, 2);
  });

  it('parses realtime messages and ignores the rest', () => {
    expect(parseMidi([0xf8])).toEqual({ type: 'clock' });
    expect(parseMidi([0xfa])).toEqual({ type: 'start' });
    expect(parseMidi([0xfb])).toEqual({ type: 'continue' });
    expect(parseMidi([0xfc])).toEqual({ type: 'stop' });
    expect(parseMidi([0xfe])).toBeUndefined(); // active sensing
    expect(parseMidi([0xf0, 1, 2, 0xf7])).toBeUndefined(); // sysex
    expect(parseMidi([])).toBeUndefined();
  });
});

describe('format', () => {
  it('names notes with middle C as C3', () => {
    expect(noteName(60)).toBe('C3');
    expect(noteName(61)).toBe('C#3');
    expect(noteName(69)).toBe('A3');
  });

  it('formats monitor lines', () => {
    expect(formatEvent({ type: 'noteOn', channel: 1, note: 60, velocity: 96 })).toBe('ch1  note on  C3  vel 96');
    expect(formatEvent({ type: 'cc', channel: 1, controller: 74, value: 87 })).toBe('ch1  cc 74  = 87');
    expect(formatEvent({ type: 'start' })).toBe('clock start');
  });
});

/** Feeds `count` clock pulses at `bpm`, starting at `t0`; returns the time after the last pulse. */
function pulses(clock: MidiClock, bpm: number, count: number, t0: number, jitter = 0): number {
  const interval = 60000 / (bpm * 24);
  let t = t0;
  for (let i = 0; i < count; i++) {
    clock.handle({ type: 'clock' }, t + (i % 2 ? jitter : -jitter));
    t += interval;
  }
  return t;
}

describe('MidiClock', () => {
  it('estimates tempo from pulse spacing', () => {
    const clock = new MidiClock();
    pulses(clock, 124, 60, 1000);
    expect(clock.bpm).toBeCloseTo(124, 0);
  });

  it('stays steady despite timestamp jitter', () => {
    const clock = new MidiClock();
    pulses(clock, 120, 96, 0, 1.5);
    expect(clock.bpm!).toBeGreaterThan(119.4);
    expect(clock.bpm!).toBeLessThan(120.6);
  });

  it('has no tempo until enough pulses have arrived, and locks only while pulses keep coming', () => {
    const clock = new MidiClock();
    expect(clock.bpm).toBeUndefined();
    const end = pulses(clock, 120, 30, 0);
    expect(clock.isLocked(end)).toBe(true);
    expect(clock.isLocked(end + 2000)).toBe(false);
  });

  it('follows tempo changes', () => {
    const clock = new MidiClock();
    const t = pulses(clock, 100, 60, 0);
    pulses(clock, 140, 80, t);
    expect(clock.bpm).toBeCloseTo(140, 0);
  });

  it('counts position only while running; start resets, continue resumes, stop halts', () => {
    const clock = new MidiClock();
    let t = pulses(clock, 120, 30, 0);
    expect(clock.ticks).toBe(0);
    clock.handle({ type: 'start' }, t);
    t = pulses(clock, 120, 24, t);
    expect(clock.ticks).toBe(24);
    expect(clock.position).toEqual({ bar: 1, beat: 2, sixteenth: 1 });
    clock.handle({ type: 'stop' }, t);
    t = pulses(clock, 120, 10, t);
    expect(clock.ticks).toBe(24);
    clock.handle({ type: 'continue' }, t);
    pulses(clock, 120, 6, t);
    expect(clock.ticks).toBe(30);
    clock.handle({ type: 'start' }, t + 1000);
    expect(clock.ticks).toBe(0);
  });

  it('converts ticks to bar : beat : sixteenth in 4/4', () => {
    expect(positionFromTicks(0)).toEqual({ bar: 1, beat: 1, sixteenth: 1 });
    expect(positionFromTicks(6)).toEqual({ bar: 1, beat: 1, sixteenth: 2 });
    expect(positionFromTicks(24)).toEqual({ bar: 1, beat: 2, sixteenth: 1 });
    expect(positionFromTicks(96)).toEqual({ bar: 2, beat: 1, sixteenth: 1 });
    expect(positionFromTicks(96 * 16 + 48 + 12)).toEqual({ bar: 17, beat: 3, sixteenth: 3 });
  });
});

describe('MidiMonitor', () => {
  it('logs messages but not clock pulses, and records activity for LEDs', () => {
    const m = new MidiMonitor();
    m.record({ type: 'clock' }, 10);
    m.record({ type: 'noteOn', channel: 1, note: 60, velocity: 90 }, 20);
    m.record({ type: 'start' }, 30);
    expect(m.lines.map((l) => l.text)).toEqual(['ch1  note on  C3  vel 90', 'clock start']);
    expect(m.lastSeen.clock).toBe(30);
    expect(m.lastSeen.note).toBe(20);
    expect(m.lastSeen.cc).toBe(-Infinity);
  });
});

describe('Transport', () => {
  it('internal: ignores the clock and uses its own tempo', () => {
    const clock = new MidiClock();
    pulses(clock, 150, 60, 0);
    clock.handle({ type: 'start' }, 5000);
    const t = new Transport(clock, () => 5000);
    t.tempo.set(100);
    expect(t.bpm).toBe(100);
    expect(t.running).toBe(false);
  });

  it('synced: follows tempo, and start/stop only when "follow start/stop" is on', () => {
    const clock = new MidiClock();
    const end = pulses(clock, 124, 60, 0);
    clock.handle({ type: 'start' }, end);
    const t = new Transport(clock, () => end);
    t.sync.set('midi');
    expect(t.bpm).toBeCloseTo(124, 0);
    expect(t.locked).toBe(true);
    expect(t.running).toBe(true);
    t.followStartStop.set(false);
    expect(t.bpm).toBeCloseTo(124, 0); // tempo still follows
    expect(t.running).toBe(false); // but not the run state
  });

  it('falls back to its own tempo until the clock has locked on', () => {
    const t = new Transport(new MidiClock(), () => 0);
    t.sync.set('midi');
    t.tempo.set(90);
    expect(t.bpm).toBe(90);
    expect(t.locked).toBe(false);
  });

  it('filters by MIDI channel; omni accepts all', () => {
    const t = new Transport(new MidiClock());
    expect(t.acceptsChannel(1)).toBe(true);
    expect(t.acceptsChannel(2)).toBe(false);
    t.channel.set('omni');
    expect(t.acceptsChannel(2)).toBe(true);
    t.channel.set('5');
    expect(t.acceptsChannel(5)).toBe(true);
    expect(t.acceptsChannel(1)).toBe(false);
  });

  it('tap tempo averages recent taps and restarts after a pause', () => {
    const t = new Transport(new MidiClock());
    t.tap(0);
    t.tap(500);
    t.tap(1000);
    expect(t.tempo.value).toBe(120);
    t.tap(10000); // long pause: starts over
    t.tap(10400);
    expect(t.tempo.value).toBe(150);
  });
});

describe('Synthesizer MIDI', () => {
  const noteOn = (n: number, ch = 1) => ({ type: 'noteOn' as const, channel: ch, note: n, velocity: 100 });
  const noteOff = (n: number, ch = 1) => ({ type: 'noteOff' as const, channel: ch, note: n, velocity: 0 });

  it('plays channel 1 notes with last-note priority and legato on overlap', () => {
    const s = new Synthesizer();
    s.handleMidi(noteOn(57)); // A2 = 220 Hz
    expect(s.circuit.node('pitch').params.offset).toBeCloseTo(-1200);
    expect(s.circuit.node('ampEnv').params.gate).toBe(1);
    const gates: number[] = [];
    s.circuit.onChange((c) => c.type === 'param' && c.name === 'gate' && gates.push(c.value));
    s.handleMidi(noteOn(64)); // overlapping: no envelope retrigger in legato
    expect(gates).toEqual([]);
    expect(s.circuit.node('pitch').params.offset).toBeCloseTo(-1200 + 700);
    s.handleMidi(noteOff(64)); // falls back to the held note
    expect(s.circuit.node('pitch').params.offset).toBeCloseTo(-1200);
    expect(s.circuit.node('ampEnv').params.gate).toBe(1);
    s.handleMidi(noteOff(57));
    expect(s.circuit.node('ampEnv').params.gate).toBe(0);
  });

  it('ignores other channels unless omni', () => {
    const s = new Synthesizer();
    s.handleMidi(noteOn(60, 2));
    expect(s.circuit.node('ampEnv').params.gate).toBe(0);
    s.transport.channel.set('2');
    s.handleMidi(noteOn(60, 2));
    expect(s.circuit.node('ampEnv').params.gate).toBe(1);
  });

  it('maps CCs to controls, scaling linear and log ranges', () => {
    const s = new Synthesizer();
    const cc = (controller: number, value: number) => s.handleMidi({ type: 'cc', channel: 1, controller, value });
    cc(70, 127);
    expect(s.control('filter.cutoff').value).toBeCloseTo(20000);
    cc(70, 0);
    expect(s.control('filter.cutoff').value).toBeCloseTo(20);
    cc(71, 127);
    expect(s.control('filter.resonance').value).toBeCloseTo(20);
    cc(83, 64);
    expect(s.control('perf.glide').value).toBeCloseTo(1.5, 1);
    cc(1, 100); // unmapped: ignored
  });

  it('only maps controls that exist', () => {
    const s = new Synthesizer();
    for (const id of DEFAULT_CC_MAP.values()) expect(() => s.control(id)).not.toThrow();
  });

  it('program change loads patches, and notifies the UI', () => {
    const s = new Synthesizer();
    let notified = 0;
    s.onPresetChange(() => notified++);
    s.handleMidi({ type: 'programChange', channel: 1, program: 2 });
    expect(s.currentPreset).toBe(SYNTH_PRESETS[2]);
    expect(notified).toBe(1);
    s.handleMidi({ type: 'programChange', channel: 1, program: 100 }); // out of range: ignored
    expect(s.currentPreset).toBe(SYNTH_PRESETS[2]);
  });

  it('the computer keyboard path shares the same note stack', () => {
    const s = new Synthesizer();
    s.keyDown(60);
    s.keyDown(64);
    s.keyUp(64);
    expect(s.circuit.node('ampEnv').params.gate).toBe(1);
    s.keyUp(60);
    expect(s.circuit.node('ampEnv').params.gate).toBe(0);
  });
});

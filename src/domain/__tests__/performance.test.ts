import { describe, expect, it } from 'vitest';
import { NumberControl } from '../devices/controls';
import { Synthesizer } from '../devices/synthesizer';
import { parseMidi } from '../midi/events';

const midi = (s: Synthesizer, bytes: number[]) => s.handleMidi(parseMidi(bytes)!);

function oscMod(s: Synthesizer, value: number): void {
  const c = s.control('osc.mod');
  if (!(c instanceof NumberControl)) throw new Error('osc.mod is not a number control');
  c.set(value);
}

describe('pitch bend', () => {
  it('feeds every pitched oscillator through a bend CV in cents, +/- 2 semitones', () => {
    const s = new Synthesizer();
    for (const osc of ['sawOsc', 'pulseOsc', 'subOsc']) {
      expect(s.circuit.cables).toContainEqual({ from: 'bend', to: osc, port: 'detune' });
    }
    s.setPitchBend(1);
    expect(s.circuit.node('bend').params.offset).toBe(200);
    s.setPitchBend(-0.5);
    expect(s.circuit.node('bend').params.offset).toBe(-100);
    expect(s.pitchBend).toBe(-0.5);
  });

  it('clamps to the wheel travel and does not move the LFO or other pitch sources', () => {
    const s = new Synthesizer();
    s.setPitchBend(9);
    expect(s.pitchBend).toBe(1);
    s.setPitchBend(-9);
    expect(s.pitchBend).toBe(-1);
    expect(s.circuit.node('pitch').params.offset).toBe(0);
  });

  it('follows MIDI pitch bend messages: centre, full up, full down', () => {
    const s = new Synthesizer();
    midi(s, [0xe0, 0x00, 0x40]); // 8192: centre
    expect(s.pitchBend).toBe(0);
    midi(s, [0xe0, 0x7f, 0x7f]); // 16383: top
    expect(s.pitchBend).toBeCloseTo(1, 3);
    midi(s, [0xe0, 0x00, 0x00]); // 0: bottom
    expect(s.pitchBend).toBe(-1);
  });

  it('ignores pitch bend on another channel', () => {
    const s = new Synthesizer();
    midi(s, [0xe1, 0x7f, 0x7f]); // channel 2; the synth listens on 1
    expect(s.pitchBend).toBe(0);
  });
});

describe('mod wheel', () => {
  it('adds LFO vibrato depth on top of the panel Mod fader', () => {
    const s = new Synthesizer();
    expect(s.circuit.node('lfoPitch').params.gain).toBe(0);
    s.setModWheel(1);
    expect(s.circuit.node('lfoPitch').params.gain).toBe(100);
    oscMod(s, 50);
    expect(s.circuit.node('lfoPitch').params.gain).toBe(150);
    s.setModWheel(0.5);
    expect(s.circuit.node('lfoPitch').params.gain).toBe(100);
    s.setModWheel(0);
    expect(s.circuit.node('lfoPitch').params.gain).toBe(50);
  });

  it('follows MIDI CC 1 and clamps', () => {
    const s = new Synthesizer();
    midi(s, [0xb0, 1, 127]);
    expect(s.modWheel).toBe(1);
    midi(s, [0xb0, 1, 0]);
    expect(s.modWheel).toBe(0);
    midi(s, [0xb0, 1, 64]);
    expect(s.modWheel).toBeCloseTo(64 / 127);
    s.setModWheel(7);
    expect(s.modWheel).toBe(1);
  });

  it('is not part of a patch: loading a patch leaves the wheels alone', () => {
    const s = new Synthesizer();
    s.setModWheel(0.8);
    s.setPitchBend(0.5);
    s.loadPreset(s.currentPreset);
    expect(s.modWheel).toBe(0.8);
    expect(s.pitchBend).toBe(0.5);
  });
});

describe('performance and note notifications', () => {
  it('tells listeners when a wheel moves, from anywhere', () => {
    const s = new Synthesizer();
    let n = 0;
    const off = s.onPerformanceChange(() => n++);
    s.setPitchBend(0.2);
    s.setModWheel(0.3);
    midi(s, [0xe0, 0x00, 0x60]);
    midi(s, [0xb0, 1, 10]);
    expect(n).toBe(4);
    off();
    s.setPitchBend(0);
    expect(n).toBe(4);
  });

  it('tracks held notes and notifies on key down and up, MIDI included', () => {
    const s = new Synthesizer();
    const seen: number[][] = [];
    s.onNoteChange(() => seen.push([...s.heldNotes]));
    midi(s, [0x90, 60, 100]);
    s.keyDown(64);
    midi(s, [0x80, 60, 0]);
    s.keyUp(64);
    expect(seen).toEqual([[60], [60, 64], [64], []]);
  });
});

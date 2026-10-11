import { describe, expect, it } from 'vitest';
import { LFO_DIVISIONS, POLY_VOICES, PolySynth } from '../devices/polySynth';
import { POLY_BANKS, POLY_PRESETS } from '../devices/polyPresets';
import { VoiceAllocator, type VoiceAction } from '../devices/voiceAllocator';
import { parseMidi } from '../midi/events';
import type { ToggleControl } from '../devices/controls';

const on = (a: VoiceAction[]) => a.filter((x): x is Extract<VoiceAction, { kind: 'on' }> => x.kind === 'on');
const midi = (s: PolySynth, bytes: number[]) => s.handleMidi(parseMidi(bytes)!);
const gate = (s: PolySynth, voice: number, env = 'env2') => s.circuit.node(`v${voice}.${env}`).params.gate;
const pitch = (s: PolySynth, voice: number) => s.circuit.node(`v${voice}.pitch`).params.offset;
const sounding = (s: PolySynth) => Array.from({ length: POLY_VOICES }, (_, i) => i).filter((i) => gate(s, i) === 1);

describe('VoiceAllocator: poly', () => {
  it('gives each new note its own voice and reuses the voice released longest ago', () => {
    const a = new VoiceAllocator(3);
    expect(on(a.noteOn(60))[0]!.voice).toBe(0);
    expect(on(a.noteOn(64))[0]!.voice).toBe(1);
    expect(on(a.noteOn(67))[0]!.voice).toBe(2);
    a.noteOff(64); // voice 1 released first
    a.noteOff(60);
    expect(on(a.noteOn(72))[0]!.voice).toBe(1);
    expect(on(a.noteOn(74))[0]!.voice).toBe(0);
  });

  it('steals the oldest sounding voice when all are busy', () => {
    const a = new VoiceAllocator(2);
    a.noteOn(60);
    a.noteOn(64);
    const action = on(a.noteOn(67))[0]!;
    expect(action.voice).toBe(0);
    expect(action.note).toBe(67);
    expect(a.activeCount).toBe(2);
  });

  it('retriggers the same voice for a repeated note, and releases only that note', () => {
    const a = new VoiceAllocator(3);
    a.noteOn(60);
    expect(on(a.noteOn(60))).toHaveLength(1);
    expect(a.activeCount).toBe(1);
    a.noteOn(64);
    expect(a.noteOff(60)).toEqual([{ kind: 'off', voice: 0 }]);
    expect(a.isActive(1)).toBe(true);
  });

  it('releaseAll silences everything', () => {
    const a = new VoiceAllocator(3);
    a.noteOn(60);
    a.noteOn(64);
    expect(a.releaseAll()).toHaveLength(2);
    expect(a.activeCount).toBe(0);
  });
});

describe('VoiceAllocator: mono and unison', () => {
  it('mono plays voice 0 only; an overlapping note glides without retriggering', () => {
    const a = new VoiceAllocator(6);
    a.mode = 'mono';
    expect(a.noteOn(60)).toEqual([{ kind: 'on', voice: 0, note: 60, retrigger: true, glide: false }]);
    expect(a.noteOn(64)).toEqual([{ kind: 'on', voice: 0, note: 64, retrigger: false, glide: true }]);
  });

  it('mono falls back to the previous held note on release, and stops when none are left', () => {
    const a = new VoiceAllocator(6);
    a.mode = 'mono';
    a.noteOn(60);
    a.noteOn(64);
    expect(on(a.noteOff(64))[0]).toMatchObject({ note: 60, retrigger: false, glide: true });
    expect(a.noteOff(60)).toEqual([{ kind: 'off', voice: 0 }]);
  });

  it('unison plays the same note on every voice', () => {
    const a = new VoiceAllocator(6);
    a.mode = 'unison';
    const actions = on(a.noteOn(60));
    expect(actions.map((x) => x.voice)).toEqual([0, 1, 2, 3, 4, 5]);
    expect(actions.every((x) => x.note === 60 && x.retrigger)).toBe(true);
    expect(a.noteOff(60)).toHaveLength(6);
  });
});

describe('PolySynth', () => {
  it('has six voices, each with one oscillator plus a sub, and a single output', () => {
    const s = new PolySynth();
    expect(s.outputs.map((j) => j.name)).toEqual(['out']);
    for (let i = 0; i < POLY_VOICES; i++) {
      const oscillators = [...s.circuit.nodes.values()].filter((n) => n.kind === 'oscillator' && n.id.startsWith(`v${i}.`));
      expect(oscillators.map((n) => n.id).sort()).toEqual([`v${i}.osc`, `v${i}.sub`]);
    }
  });

  it('plays chords on separate voices at the right pitch (cents from A4) and gates both envelopes', () => {
    const s = new PolySynth();
    s.keyDown(69);
    s.keyDown(81);
    s.keyDown(60);
    expect([pitch(s, 0), pitch(s, 1), pitch(s, 2)]).toEqual([0, 1200, -900]);
    expect(sounding(s)).toEqual([0, 1, 2]);
    expect(gate(s, 0, 'env1')).toBe(1);
    s.keyUp(81);
    expect(sounding(s)).toEqual([0, 2]);
    expect([0, 1, 2].map((i) => s.voiceActive(i))).toEqual([true, false, true]);
  });

  it('unison detunes the voices symmetrically; leaving unison puts them back in tune', () => {
    const s = new PolySynth();
    (s.control('voices.mode') as { set(v: string): void }).set('unison');
    (s.control('voices.detune') as { set(v: number): void }).set(20);
    const det = Array.from({ length: POLY_VOICES }, (_, i) => s.circuit.node(`v${i}.det`).params.offset);
    expect(det[0]).toBe(-20);
    expect(det[5]).toBe(20);
    expect(det[0]! + det[5]!).toBeCloseTo(0);
    (s.control('voices.mode') as { set(v: string): void }).set('poly');
    expect(Array.from({ length: POLY_VOICES }, (_, i) => s.circuit.node(`v${i}.det`).params.offset)).toEqual(new Array(6).fill(0));
  });

  it('changing mode releases held notes', () => {
    const s = new PolySynth();
    s.keyDown(60);
    s.keyDown(64);
    (s.control('voices.mode') as { set(v: string): void }).set('mono');
    expect(sounding(s)).toEqual([]);
    expect(s.heldNotes).toEqual([]);
  });

  it('selects the oscillator wave: saw and pulse share the saw core, triangle changes the waveform', () => {
    const s = new PolySynth();
    const wave = s.control('osc.wave') as { set(v: string): void };
    wave.set('pulse');
    expect(s.circuit.node('v0.osc').options.waveform).toBe('sawtooth');
    expect(s.circuit.node('v0.rawOut').params.gain).toBe(0);
    expect(s.circuit.node('v0.pulseOut').params.gain).toBeGreaterThan(0);
    wave.set('tri');
    expect(s.circuit.node('v3.osc').options.waveform).toBe('triangle');
    expect(s.circuit.node('v3.rawOut').params.gain).toBe(1);
    expect(s.circuit.node('v3.pulseOut').params.gain).toBe(0);
  });

  it('applies filter and envelope controls to every voice', () => {
    const s = new PolySynth();
    (s.control('filter.cutoff') as { set(v: number): void }).set(1000);
    (s.control('env2.release') as { set(v: number): void }).set(2);
    (s.control('filter.env') as { set(v: number): void }).set(3);
    for (let i = 0; i < POLY_VOICES; i++) {
      expect(s.circuit.node(`v${i}.f1`).params.frequency).toBe(1000);
      expect(s.circuit.node(`v${i}.f2`).params.frequency).toBe(1000);
      expect(s.circuit.node(`v${i}.env2`).params.release).toBe(2);
      expect(s.circuit.node(`v${i}.env1Depth`).params.gain).toBe(3600);
    }
  });

  it('portamento sets every voice glide time; a note from silence in mono jumps instead of gliding', () => {
    const s = new PolySynth();
    (s.control('voices.portamento') as { set(v: number): void }).set(0.5);
    expect(s.circuit.node('v4.pitch').params.glide).toBe(0.5);
    (s.control('voices.mode') as { set(v: string): void }).set('mono');
    s.keyDown(60);
    expect(s.circuit.node('v0.pitch').params.glide).toBe(0.5); // restored after the jump
    expect(pitch(s, 0)).toBe(-900);
  });
});

describe('PolySynth LFO', () => {
  const set = (s: PolySynth, id: string, v: number | string) => (s.control(id) as { set(v: number | string): void }).set(v);

  it('runs at the rate knob, or as a note division of the tempo when synced', () => {
    const s = new PolySynth();
    set(s, 'lfo.rate', 2);
    expect(s.circuit.node('lfoOsc').params.frequency).toBe(2);
    s.transport.tempo.set(120);
    (s.control('lfo.sync') as ToggleControl).set(true);
    set(s, 'lfo.division', '1/4');
    expect(s.circuit.node('lfoOsc').params.frequency).toBeCloseTo(2); // one cycle per beat at 120 BPM
    set(s, 'lfo.division', '1/16');
    expect(s.circuit.node('lfoOsc').params.frequency).toBeCloseTo(8);
    set(s, 'lfo.division', '1/1');
    expect(s.circuit.node('lfoOsc').params.frequency).toBeCloseTo(0.5);
    s.transport.tempo.set(60);
    expect(s.circuit.node('lfoOsc').params.frequency).toBeCloseTo(0.25);
    expect(LFO_DIVISIONS).toHaveLength(6);
  });

  it('selects the wave: ramp down inverts the ramp, random uses the sample-and-hold source', () => {
    const s = new PolySynth();
    set(s, 'lfo.wave', 'down');
    expect(s.circuit.node('lfoOsc').options.waveform).toBe('sawtooth');
    expect(s.circuit.node('lfoSign').params.gain).toBe(-1);
    set(s, 'lfo.wave', 'rnd');
    expect(s.circuit.node('lfoOscOut').params.gain).toBe(0);
    expect(s.circuit.node('lfoRndOut').params.gain).toBe(1);
    set(s, 'lfo.wave', 'sqr');
    expect(s.circuit.node('lfoOsc').options.waveform).toBe('square');
    expect(s.circuit.node('lfoSign').params.gain).toBe(1);
  });
});

describe('PolySynth performance and MIDI', () => {
  it('pitch bend and the mod wheel work like the mono synth', () => {
    const s = new PolySynth();
    s.setPitchBend(1);
    expect(s.circuit.node('bend').params.offset).toBe(200);
    s.setModWheel(1);
    expect(s.circuit.node('lfoPitch').params.gain).toBe(100);
    (s.control('osc.vibrato') as { set(v: number): void }).set(30);
    expect(s.circuit.node('lfoPitch').params.gain).toBe(130);
  });

  it('listens on channel 2 by default: notes, bend, CC 1 and program change', () => {
    const s = new PolySynth();
    midi(s, [0x91, 60, 100]);
    expect(s.heldNotes).toEqual([60]);
    midi(s, [0x90, 62, 100]); // channel 1: ignored
    expect(s.heldNotes).toEqual([60]);
    midi(s, [0xe1, 0x7f, 0x7f]);
    expect(s.pitchBend).toBeCloseTo(1, 3);
    midi(s, [0xb1, 1, 127]);
    expect(s.modWheel).toBe(1);
    midi(s, [0xc1, 3]);
    expect(s.currentPreset).toBe(POLY_PRESETS[3]);
    expect(s.currentSlot).toBe(3);
    midi(s, [0xc1, 99]); // out of range: ignored
    expect(s.currentSlot).toBe(3);
    midi(s, [0x81, 60, 0]);
    expect(s.heldNotes).toEqual([]);
  });

  it('notifies listeners about notes, wheels and patch changes', () => {
    const s = new PolySynth();
    const log: string[] = [];
    s.onNoteChange(() => log.push('note'));
    s.onPerformanceChange(() => log.push('wheel'));
    s.onPresetChange(() => log.push('patch'));
    s.keyDown(60);
    s.setPitchBend(0.5);
    s.loadPreset(POLY_PRESETS[0]!);
    s.keyUp(60);
    // Loading a patch re-applies the voice mode, which releases held notes (and says so), then announces itself.
    expect(log.slice(0, 2)).toEqual(['note', 'wheel']);
    expect(log.filter((x) => x === 'patch')).toHaveLength(1);
    expect(log[log.length - 1]).toBe('note');
  });
});

describe('PolySynth patches', () => {
  it('ships two banks of eight', () => {
    expect(POLY_BANKS.map((b) => b.length)).toEqual([8, 8]);
    expect(POLY_PRESETS).toHaveLength(16);
  });

  it('every patch loads cleanly', () => {
    const s = new PolySynth();
    for (const preset of POLY_PRESETS) expect(() => s.loadPreset(preset)).not.toThrow();
  });

  it('loading a patch resets everything the previous one changed', () => {
    const s = new PolySynth();
    const cutoff = () => s.circuit.node('v0.f1').params.frequency;
    s.loadPreset(POLY_PRESETS.find((p) => p.name === 'Pluck Bass')!);
    expect(s.circuit.node('v0.env1').params.sustain).toBe(0);
    s.loadPreset(POLY_PRESETS.find((p) => p.name === 'Init')!);
    expect(cutoff()).toBe(2400);
    expect(s.circuit.node('v0.env1').params.sustain).toBe(0.4);
    expect((s.control('voices.mode') as { value: string }).value).toBe('poly');
  });

  it('starts on Init', () => {
    expect(new PolySynth().currentPreset.name).toBe('Init');
  });
});

describe('PolySynth patch slots', () => {
  const set = (s: PolySynth, id: string, v: number | string) => (s.control(id) as { set(v: number | string): void }).set(v);

  it('saves the current sound into a slot and loads it back after the sound has changed', () => {
    const s = new PolySynth();
    set(s, 'filter.cutoff', 777);
    set(s, 'voices.mode', 'unison');
    set(s, 'lfo.wave', 'down');
    (s.control('lfo.sync') as ToggleControl).set(true);
    const saved = s.saveSlot(5, 'My Sound');
    expect(saved.name).toBe('My Sound');
    expect(s.slots[5]!.name).toBe('My Sound');
    s.loadSlot(0);
    expect(s.circuit.node('v0.f1').params.frequency).not.toBe(777);
    s.loadSlot(5);
    expect(s.circuit.node('v0.f1').params.frequency).toBe(777);
    expect((s.control('voices.mode') as { value: string }).value).toBe('unison');
    expect((s.control('lfo.wave') as { value: string }).value).toBe('down');
    expect((s.control('lfo.sync') as ToggleControl).value).toBe(true);
  });

  it('keeps the factory name when saving over a slot, and MIDI program change loads saved slots', () => {
    const s = new PolySynth();
    set(s, 'filter.cutoff', 500);
    s.saveSlot(2);
    expect(s.slots[2]!.name).toBe('Pluck Bass');
    s.loadSlot(0);
    midi(s, [0xc1, 2]);
    expect(s.circuit.node('v0.f1').params.frequency).toBe(500);
  });

  it('snapshot covers every control, and rejects a slot that does not exist', () => {
    const s = new PolySynth();
    expect(Object.keys(s.snapshot()).sort()).toEqual(s.controls.map((c) => c.id).sort());
    expect(() => s.loadSlot(16)).toThrow();
  });
});

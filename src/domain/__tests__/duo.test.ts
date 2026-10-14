import { describe, expect, it } from 'vitest';
import { DuoSynth } from '../devices/duoSynth';
import { DUO_FACTORY, DUO_INIT, DUO_SLOTS } from '../devices/duoPresets';
import { Patch } from '../patch/patch';

const watch = (synth: DuoSynth) => {
  const plays: { n1: number; n2: number; gate: boolean; retrig: boolean }[] = [];
  synth.circuit.onChange((c) => { if (c.type === 'play') plays.push({ n1: c.n1, n2: c.n2, gate: c.gate, retrig: c.retrig }); });
  return plays;
};
const choose = (s: DuoSynth, id: string, v: string) => (s.control(id) as { set(v: string): void }).set(v);
const flip = (s: DuoSynth, id: string, v: boolean) => (s.control(id) as { set(v: boolean): void }).set(v);

describe('paraphony', () => {
  it('one key plays on both oscillators', () => {
    const s = new DuoSynth();
    const plays = watch(s);
    s.keyDown(60);
    expect(plays.at(-1)).toEqual({ n1: 60, n2: 60, gate: true, retrig: true });
  });

  it('two keys: oscillator 1 takes the low note and oscillator 2 the high note', () => {
    const s = new DuoSynth();
    s.keyDown(67);
    s.keyDown(60);
    expect(s.assign()).toEqual({ n1: 60, n2: 67 });
  });

  it('three or more keys: oscillator 1 the lowest, oscillator 2 the last played if higher', () => {
    const s = new DuoSynth();
    s.keyDown(60); s.keyDown(64); s.keyDown(67);
    expect(s.assign()).toEqual({ n1: 60, n2: 67 });
    s.keyDown(62); // last played is higher than the lowest
    expect(s.assign()).toEqual({ n1: 60, n2: 62 });
    const t = new DuoSynth();
    t.keyDown(64); t.keyDown(67); t.keyDown(60); // last played is the lowest: fall back to the highest
    expect(t.assign()).toEqual({ n1: 60, n2: 67 });
  });

  it('mono mode plays the newest key on both oscillators', () => {
    const s = new DuoSynth();
    choose(s, 'play.mode', 'mono');
    s.keyDown(60); s.keyDown(72);
    expect(s.assign()).toEqual({ n1: 72, n2: 72 });
    s.keyUp(72);
    expect(s.assign()).toEqual({ n1: 60, n2: 60 });
  });

  it('releasing keys drops back and the gate closes with the last key', () => {
    const s = new DuoSynth();
    const plays = watch(s);
    s.keyDown(60); s.keyDown(67);
    s.keyUp(67);
    expect(plays.at(-1)).toMatchObject({ n1: 60, n2: 60, gate: true });
    s.keyUp(60);
    expect(plays.at(-1)).toMatchObject({ gate: false });
    expect(s.heldNotes).toEqual([]);
  });

  it('legato does not retrigger a key pressed while another is held; off, it does', () => {
    const s = new DuoSynth();
    const plays = watch(s);
    s.keyDown(60);
    s.keyDown(64);
    expect(plays.at(-1)!.retrig).toBe(true);
    s.keyUp(64); s.keyUp(60);
    flip(s, 'play.legato', true);
    s.keyDown(60);
    expect(plays.at(-1)!.retrig).toBe(true); // first key always triggers
    s.keyDown(64);
    expect(plays.at(-1)!.retrig).toBe(false);
  });

  it('the sustain pedal keeps released notes sounding until it comes up', () => {
    const s = new DuoSynth();
    const plays = watch(s);
    s.handleMidi({ type: 'cc', channel: 1, controller: 64, value: 127 });
    s.keyDown(60);
    s.keyUp(60);
    expect(s.heldNotes).toEqual([60]);
    s.handleMidi({ type: 'cc', channel: 1, controller: 64, value: 0 });
    expect(s.heldNotes).toEqual([]);
    expect(plays.at(-1)!.gate).toBe(false);
  });

  it('pitch bend reaches three semitones and the mod wheel is sent as vibrato depth', () => {
    const s = new DuoSynth();
    s.setPitchBend(1);
    expect(s.circuit.node('synth').params.bend).toBe(3);
    s.handleMidi({ type: 'cc', channel: 1, controller: 1, value: 127 });
    expect(s.circuit.node('synth').params.modw).toBe(1);
  });
});

describe('MIDI channel switch', () => {
  it('on CHAN it keeps the channel heard last while on OMNI', () => {
    const s = new DuoSynth();
    s.handleMidi({ type: 'noteOn', channel: 3, note: 60, velocity: 100 });
    s.handleMidi({ type: 'noteOff', channel: 3, note: 60, velocity: 0 });
    flip(s, 'play.channel', true);
    s.handleMidi({ type: 'noteOn', channel: 5, note: 62, velocity: 100 });
    expect(s.heldNotes).toEqual([]);
    s.handleMidi({ type: 'noteOn', channel: 3, note: 64, velocity: 100 });
    expect(s.heldNotes).toEqual([64]);
  });
});

describe('controls and patches', () => {
  it('every control id has a default and the octave switches reach the worklet as semitone offsets', () => {
    const s = new DuoSynth();
    expect(Object.keys(DUO_INIT).sort()).toEqual(s.controls.map((c) => c.id).sort());
    choose(s, 'osc1.octave', '32');
    expect(s.circuit.node('synth').params.o1Off).toBe(-24);
    choose(s, 'osc2.octave', '4');
    expect(s.circuit.node('synth').params.o2Off).toBe(12);
    choose(s, 'route.vcf', 'odd');
    expect(s.circuit.node('synth').params.vcfRoute).toBe(3);
  });

  it('has sixteen slots; every factory patch loads and round-trips; a patch resets what it does not mention', () => {
    const s = new DuoSynth();
    expect(s.slots).toHaveLength(DUO_SLOTS);
    expect(DUO_FACTORY.length).toBeLessThanOrEqual(DUO_SLOTS);
    for (let i = 0; i < s.slots.length; i++) {
      s.loadSlot(i);
      const first = s.snapshot();
      s.loadSlot(0);
      s.loadSlot(i);
      expect(s.snapshot()).toEqual(first);
    }
    s.loadSlot(5);
    s.loadSlot(0);
    const { 'play.channel': _skip, ...expected } = DUO_INIT;
    expect(s.snapshot()).toEqual(expected);
  });

  it('save keeps the slot name and stores the panel', () => {
    const s = new DuoSynth();
    (s.control('reverb.mix') as { set(v: number): void }).set(0.9);
    const saved = s.saveSlot(4);
    expect(saved.name).toBe(s.slots[4]!.name);
    expect(saved.values['reverb.mix']).toBe(0.9);
  });

  it('the duo patch sends the synth straight to the speakers', () => {
    const patch = Patch.duo();
    expect(patch.output).toEqual({ device: 'duo', jack: 'out' });
  });
});

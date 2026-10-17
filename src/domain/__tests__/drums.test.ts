import { describe, expect, it } from 'vitest';
import { Circuit, type CircuitChange } from '../circuit/circuit';
import type { NumberControl, ToggleControl } from '../devices/controls';
import { DRUM_OUTPUTS, DRUM_VOICES, DrumMachine, type DrumVoice, PERC_VOICES } from '../devices/drumMachine';
import { parseMidi } from '../midi/events';

function record(c: Circuit): CircuitChange[] {
  const log: CircuitChange[] = [];
  c.onChange((x) => log.push(x));
  return log;
}

function num(d: DrumMachine, id: string): NumberControl {
  const c = d.control(id);
  if (c.kind !== 'number') throw new Error(`${id} is not a number`);
  return c;
}

function toggle(d: DrumMachine, id: string): ToggleControl {
  const c = d.control(id);
  if (c.kind !== 'toggle') throw new Error(`${id} is not a toggle`);
  return c;
}

const triggers = (log: CircuitChange[]) =>
  log.filter((x): x is Extract<CircuitChange, { type: 'trigger' }> => x.type === 'trigger');

describe('Circuit trigger envelopes', () => {
  it('emits trigger and choke events for trigger nodes, clamping velocity', () => {
    const c = new Circuit().add('t', 'trigger', { peak: 1, decay: 0.1, velSens: 1 });
    const log = record(c);
    c.trigger('t', 2);
    c.trigger('t', -1);
    c.choke('t');
    expect(log).toEqual([
      { type: 'trigger', nodeId: 't', velocity: 1 },
      { type: 'trigger', nodeId: 't', velocity: 0 },
      { type: 'choke', nodeId: 't' },
    ]);
  });

  it('rejects triggering a node that is not a trigger envelope', () => {
    const c = new Circuit().add('g', 'gain', { gain: 1 });
    expect(() => c.trigger('g')).toThrow();
    expect(() => c.choke('g')).toThrow();
  });
});

describe('DrumMachine', () => {
  it('has an output for each main voice and one shared by the percussion, and a meter for every voice', () => {
    const d = new DrumMachine();
    expect(d.outputs.map((j) => j.name)).toEqual([...DRUM_OUTPUTS]);
    expect(d.meters.map((j) => j.name)).toEqual([...DRUM_VOICES]);
    for (const jack of DRUM_OUTPUTS) expect(d.circuit.node(d.jack('out', jack).nodeId).kind).toBe('gain');
    // every percussion voice reaches the shared output, and no main voice does
    const into = (voice: string) => d.circuit.cables.some((c) => c.from === `${voice}.out` && c.to === 'perc.out');
    for (const voice of PERC_VOICES) expect(into(voice), voice).toBe(true);
    expect(into('kick')).toBe(false);
  });

  it('the ride is layered and crushed to 6 bits before its envelopes, with a short default decay', () => {
    const d = new DrumMachine();
    expect(d.circuit.node('ride.crush').params.bits).toBe(6);
    expect(d.circuit.cables.some((c) => c.from === 'ride.crush')).toBe(true);
    expect(d.control('ride.decay').value).toBe(0.75);
    expect(() => d.control('ride.classic')).toThrow(); // the comparison switch is gone
  });

  it('plays the percussion voices from their General MIDI notes', () => {
    const d = new DrumMachine();
    const hits: string[] = [];
    d.onHit((v) => hits.push(v));
    for (const note of [37, 41, 45, 48, 56, 49]) d.handleMidi({ type: 'noteOn', channel: 10, note, velocity: 100 });
    expect(hits).toEqual(['rim', 'lowTom', 'midTom', 'highTom', 'cowbell', 'crash']);
  });

  it('gives every voice tune, decay, a third control, level, mute and solo', () => {
    const d = new DrumMachine();
    for (const voice of PERC_VOICES) {
      for (const id of ['decay', 'level', 'mute', 'solo']) expect(() => d.control(`${voice}.${id}`), `${voice}.${id}`).not.toThrow();
    }
  });

  it('gives every voice its four faders, with the labels from the design', () => {
    const d = new DrumMachine();
    const labels = (voice: string) => d.controls.filter((c) => c.id.startsWith(`${voice}.`) && c.kind === 'number').map((c) => c.label);
    expect(labels('kick')).toEqual(['Tune', 'Decay', 'Click', 'Level']);
    expect(labels('snare')).toEqual(['Tune', 'Decay', 'Snap', 'Level']);
    expect(labels('clap')).toEqual(['Tone', 'Decay', 'Spread', 'Level']);
    expect(labels('closedHat')).toEqual(['Tune', 'Decay', 'Tone', 'Level']);
    expect(labels('openHat')).toEqual(['Tune', 'Decay', 'Tone', 'Level']);
    expect(labels('ride')).toEqual(['Tune', 'Decay', 'Bell', 'Level']);
  });

  it('fires every envelope of a voice with the velocity, and reports the hit', () => {
    const d = new DrumMachine();
    const log = record(d.circuit);
    const hits: [DrumVoice, number][] = [];
    d.onHit((v, vel) => hits.push([v, vel]));
    d.trigger('kick', 0.5);
    expect(triggers(log).map((t) => t.nodeId)).toEqual(['kick.pitchEnv', 'kick.ampEnv', 'kick.clickEnv']);
    expect(triggers(log).every((t) => t.velocity === 0.5)).toBe(true);
    expect(hits).toEqual([['kick', 0.5]]);
  });

  it('ignores a zero-velocity hit', () => {
    const d = new DrumMachine();
    const log = record(d.circuit);
    d.trigger('snare', 0);
    expect(log).toEqual([]);
  });

  it('applies faders to the circuit', () => {
    const d = new DrumMachine();
    num(d, 'kick.tune').set(60);
    expect(d.circuit.node('kick.osc').params.frequency).toBe(60);
    num(d, 'snare.tune').set(200);
    expect(d.circuit.node('snare.osc2').params.frequency).toBeCloseTo(366);
    num(d, 'closedHat.tune').set(0.6);
    expect(d.circuit.node('closedHat.tune').params.offset).toBeCloseTo(0);
    num(d, 'closedHat.tune').set(1);
    expect(d.circuit.node('closedHat.tune').params.offset).toBeCloseTo(960);
    num(d, 'ride.level').set(0.25);
    expect(d.circuit.node('ride.out').params.gain).toBeCloseTo(0.25);
  });

  describe('hat choke', () => {
    it('a closed hat chokes the open hat when choke is on', () => {
      const d = new DrumMachine();
      const log = record(d.circuit);
      d.trigger('closedHat', 1);
      expect(log[0]).toEqual({ type: 'choke', nodeId: 'openHat.ampEnv' });
    });

    it('does nothing to the open hat when choke is off, and the open hat never chokes the closed', () => {
      const d = new DrumMachine();
      d.choke.set(false);
      const log = record(d.circuit);
      d.trigger('closedHat', 1);
      d.trigger('openHat', 1);
      expect(log.some((x) => x.type === 'choke')).toBe(false);
    });
  });

  describe('mute and solo', () => {
    const gate = (d: DrumMachine, v: DrumVoice) => d.circuit.node(`${v}.mute`).params.gain;

    it('mute silences one voice only', () => {
      const d = new DrumMachine();
      toggle(d, 'snare.mute').set(true);
      expect(gate(d, 'snare')).toBe(0);
      expect(gate(d, 'kick')).toBe(1);
    });

    it('solo silences the others, and clears when released', () => {
      const d = new DrumMachine();
      toggle(d, 'kick.solo').set(true);
      expect(d.soloActive).toBe(true);
      expect(gate(d, 'kick')).toBe(1);
      expect(gate(d, 'ride')).toBe(0);
      toggle(d, 'kick.solo').set(false);
      expect(d.soloActive).toBe(false);
      expect(gate(d, 'ride')).toBe(1);
    });

    it('a muted voice stays silent even when soloed', () => {
      const d = new DrumMachine();
      toggle(d, 'kick.mute').set(true);
      toggle(d, 'kick.solo').set(true);
      expect(gate(d, 'kick')).toBe(0);
    });
  });

  describe('MIDI', () => {
    const note = (channel: number, n: number, vel = 100) => parseMidi([0x90 | (channel - 1), n, vel])!;

    it('plays voices from General MIDI drum notes on channel 10, scaling velocity', () => {
      const d = new DrumMachine();
      const hits: [DrumVoice, number][] = [];
      d.onHit((v, vel) => hits.push([v, vel]));
      d.handleMidi(note(10, 36, 127));
      d.handleMidi(note(10, 38, 64));
      d.handleMidi(note(10, 39));
      d.handleMidi(note(10, 42));
      d.handleMidi(note(10, 46));
      d.handleMidi(note(10, 51));
      expect(hits.map((h) => h[0])).toEqual(['kick', 'snare', 'clap', 'closedHat', 'openHat', 'ride']);
      expect(hits[0]![1]).toBe(1);
      expect(hits[1]![1]).toBeCloseTo(64 / 127);
    });

    it('ignores other channels, unmapped notes and note offs', () => {
      const d = new DrumMachine();
      const hits: DrumVoice[] = [];
      d.onHit((v) => hits.push(v));
      d.handleMidi(note(1, 36));
      d.handleMidi(note(10, 60));
      d.handleMidi(parseMidi([0x89, 36, 0])!);
      expect(hits).toEqual([]);
    });

    it('follows a changed channel', () => {
      const d = new DrumMachine();
      d.transport.channel.set('omni');
      const hits: DrumVoice[] = [];
      d.onHit((v) => hits.push(v));
      d.handleMidi(note(3, 36));
      expect(hits).toEqual(['kick']);
    });
  });
});

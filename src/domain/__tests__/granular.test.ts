import { describe, expect, it } from 'vitest';
import type { CircuitChange } from '../circuit/circuit';
import { GRANULAR_INIT, GRANULAR_PRESETS, GranularFx } from '../devices/granular';
import { parseMidi } from '../midi/events';
import type { Mixer } from '../devices/mixer';
import { Patch } from '../patch/patch';

const set = (d: GranularFx, id: string, v: number | boolean | string) => (d.control(id) as { set(v: unknown): void }).set(v);
const param = (d: GranularFx, node: string, name: string) => d.circuit.node(node).params[name]!;

describe('Granular processor', () => {
  it('has every control with its default, mapped onto the grain engine', () => {
    const g = new GranularFx();
    for (const id of Object.keys(GRANULAR_INIT)) expect(() => g.control(id)).not.toThrow();
    expect(g.circuit.node('grains').kind).toBe('granular');
    expect(param(g, 'grains', 'size')).toBeCloseTo(0.12);
    expect(param(g, 'grains', 'rate')).toBe(12);
  });

  it('converts units for the engine: size in seconds, pitch in semitones, detune in cents', () => {
    const g = new GranularFx();
    set(g, 'gr.size', 500);
    set(g, 'gr.pitch', -12);
    set(g, 'gr.detune', 25);
    expect(param(g, 'grains', 'size')).toBeCloseTo(0.5);
    expect(param(g, 'grains', 'pitch')).toBe(-12);
    expect(param(g, 'grains', 'detune')).toBe(25);
  });

  it('clamps controls to their range', () => {
    const g = new GranularFx();
    set(g, 'gr.rate', 5000);
    expect(param(g, 'grains', 'rate')).toBe(100);
    set(g, 'gr.feedback', 5);
    expect(param(g, 'grains', 'feedback')).toBeCloseTo(0.95);
  });

  it('Mix blends the grains with the dry input', () => {
    const g = new GranularFx();
    expect(param(g, 'dry', 'gain')).toBe(0);
    set(g, 'gr.mix', 0.25);
    expect(param(g, 'wet', 'gain')).toBeCloseTo(0.25);
    expect(param(g, 'dry', 'gain')).toBeCloseTo(0.75);
  });

  it('Freeze stops the buffer recording', () => {
    const g = new GranularFx();
    set(g, 'gr.freeze', true);
    expect(param(g, 'grains', 'freeze')).toBe(1);
    set(g, 'gr.freeze', false);
    expect(param(g, 'grains', 'freeze')).toBe(0);
  });

  it('filters, saturates and adds reverb after the grains, in that order', () => {
    const g = new GranularFx();
    const has = (from: string, to: string) => g.circuit.cables.some((c) => c.from === from && c.to === to && c.port === 'in');
    expect(has('grains', 'filter') && has('filter', 'preDrive') && has('preDrive', 'sat') && has('sat', 'postDrive')).toBe(true);
    expect(has('postDrive', 'wet') && has('postDrive', 'revSend') && has('revSend', 'conv')).toBe(true);
    expect(has('grains', 'wet')).toBe(false); // the grains no longer bypass the filter
    set(g, 'gr.filter', 800);
    set(g, 'gr.reso', 6);
    set(g, 'gr.tone', 3000);
    expect(param(g, 'filter', 'frequency')).toBe(800);
    expect(param(g, 'filter', 'Q')).toBe(6);
    expect(param(g, 'revTone', 'frequency')).toBe(3000);
  });

  it('the filter starts wide open, the saturator and reverb start off, and drive adds gain into the clipper', () => {
    const g = new GranularFx();
    expect(param(g, 'filter', 'frequency')).toBe(20000);
    expect(param(g, 'revSend', 'gain')).toBe(0);
    expect(param(g, 'preDrive', 'gain')).toBe(1);
    set(g, 'gr.drive', 1);
    expect(param(g, 'preDrive', 'gain')).toBeGreaterThan(5);
    expect(param(g, 'postDrive', 'gain')).toBeLessThan(0.2); // makeup comes down so drive adds grit, not volume
    set(g, 'gr.reverb', 0.4);
    expect(param(g, 'revSend', 'gain')).toBeCloseTo(0.4);
  });

  it('Tail picks the reverb size, and patches can store it', () => {
    const g = new GranularFx();
    set(g, 'gr.tail', 'large');
    expect(g.circuit.node('conv').options.size).toBe('large');
    expect(() => set(g, 'gr.tail', 'huge')).toThrow();
    const saved = g.saveSlot(2);
    expect(saved.values['gr.tail']).toBe('large');
    g.loadSlot(0);
    expect(g.circuit.node('conv').options.size).toBe('medium');
    g.loadSlot(2);
    expect(g.circuit.node('conv').options.size).toBe('large');
  });

  it('loads every patch, resetting what the patch does not name', () => {
    const g = new GranularFx();
    expect(GRANULAR_PRESETS).toHaveLength(8);
    for (const preset of GRANULAR_PRESETS) expect(() => g.loadPreset(preset)).not.toThrow();
    g.loadSlot(1);
    expect((g.control('gr.size') as { value: number }).value).toBe(350);
    g.loadSlot(0);
    expect((g.control('gr.size') as { value: number }).value).toBe(120);
    expect((g.control('gr.spread') as { value: number }).value).toBe(0.5);
  });

  it('saving stores the controls in the slot and keeps its name', () => {
    const g = new GranularFx();
    set(g, 'gr.pitch', 7);
    const saved = g.saveSlot(3);
    expect(saved.values['gr.pitch']).toBe(7);
    expect(saved.name).toBe('Stutter');
    g.loadSlot(0);
    g.loadSlot(3);
    expect((g.control('gr.pitch') as { value: number }).value).toBe(7);
  });
});

describe('Granular processor playing', () => {
  const notes = (g: GranularFx) => {
    const seen: CircuitChange[] = [];
    g.circuit.onChange((c) => {
      if (c.type === 'note') seen.push(c);
    });
    return seen;
  };
  const midi = (g: GranularFx, ...bytes: number[]) => g.handleMidi(parseMidi(bytes)!);

  it('maps the envelope controls onto the grain engine, in seconds', () => {
    const g = new GranularFx();
    set(g, 'gr.attack', 250);
    set(g, 'gr.decay', 1000);
    set(g, 'gr.sustain', 0.4);
    set(g, 'gr.release', 2000);
    expect(param(g, 'grains', 'attack')).toBeCloseTo(0.25);
    expect(param(g, 'grains', 'decay')).toBeCloseTo(1);
    expect(param(g, 'grains', 'sustain')).toBe(0.4);
    expect(param(g, 'grains', 'release')).toBeCloseTo(2);
  });

  it('starts with Keys off, and playing a key turns it on and sends the note', () => {
    const g = new GranularFx();
    const seen = notes(g);
    expect(param(g, 'grains', 'play')).toBe(0);
    g.keyDown(64, 0.5);
    expect(param(g, 'grains', 'play')).toBe(1);
    expect(g.heldNotes).toEqual([64]);
    expect(seen).toEqual([{ type: 'note', nodeId: 'grains', note: 64, velocity: 0.5 }]);
    g.keyUp(64);
    expect(g.heldNotes).toEqual([]);
    expect(seen[1]).toEqual({ type: 'note', nodeId: 'grains', note: 64, velocity: 0 });
  });

  it('turning Keys off releases every note', () => {
    const g = new GranularFx();
    g.keyDown(60);
    g.keyDown(64);
    const seen = notes(g);
    set(g, 'gr.play', false);
    expect(g.heldNotes).toEqual([]);
    expect(seen).toContainEqual({ type: 'note', nodeId: 'grains', note: -1, velocity: 0 });
  });

  it('tells the keyboard bed when notes and wheels change', () => {
    const g = new GranularFx();
    let noteChanges = 0;
    let wheelChanges = 0;
    g.onNoteChange(() => noteChanges++);
    g.onPerformanceChange(() => wheelChanges++);
    g.keyDown(60);
    g.keyUp(60);
    g.setPitchBend(0.5);
    g.setModWheel(0.3);
    expect(noteChanges).toBe(2);
    expect(wheelChanges).toBe(2);
    expect(g.modWheel).toBeCloseTo(0.3);
  });

  it('pitch bend adds up to two semitones to the Pitch knob', () => {
    const g = new GranularFx();
    set(g, 'gr.pitch', 5);
    g.setPitchBend(1);
    expect(param(g, 'grains', 'pitch')).toBeCloseTo(7);
    g.setPitchBend(-1);
    expect(param(g, 'grains', 'pitch')).toBeCloseTo(3);
    set(g, 'gr.pitch', -12);
    expect(param(g, 'grains', 'pitch')).toBeCloseTo(-14);
  });

  it('listens to MIDI on channel 3 by default, with velocity, and ignores other channels', () => {
    const g = new GranularFx();
    const seen = notes(g);
    midi(g, 0x92, 60, 127); // channel 3
    midi(g, 0x91, 62, 100); // channel 2: the poly synth's
    midi(g, 0x82, 60, 0);
    expect(seen).toEqual([
      { type: 'note', nodeId: 'grains', note: 60, velocity: 1 },
      { type: 'note', nodeId: 'grains', note: 60, velocity: 0 },
    ]);
  });

  it('the MIDI channel can be changed, or set to omni', () => {
    const g = new GranularFx();
    set(g, 'gr.channel', '5');
    midi(g, 0x92, 60, 100);
    expect(g.heldNotes).toEqual([]);
    midi(g, 0x94, 60, 100);
    expect(g.heldNotes).toEqual([60]);
    set(g, 'gr.channel', 'omni');
    midi(g, 0x9f, 61, 100);
    expect(g.heldNotes).toEqual([60, 61]);
  });

  it('MIDI pitch bend, mod wheel and program change work on its channel', () => {
    const g = new GranularFx();
    midi(g, 0xe2, 0x7f, 0x7f); // pitch bend, top of the range
    expect(g.pitchBend).toBeGreaterThan(0.99);
    midi(g, 0xb2, 1, 127);
    expect(g.modWheel).toBe(1);
    midi(g, 0xc2, 3);
    expect(g.currentSlot).toBe(3);
    midi(g, 0xc1, 5); // wrong channel
    expect(g.currentSlot).toBe(3);
  });

  it('patches store the envelope and Keys, but not the MIDI channel', () => {
    const g = new GranularFx();
    set(g, 'gr.attack', 900);
    set(g, 'gr.channel', '7');
    const saved = g.saveSlot(1);
    expect(saved.values['gr.attack']).toBe(900);
    expect(saved.values).toHaveProperty('gr.play');
    expect(saved.values).not.toHaveProperty('gr.channel');
    g.loadSlot(0);
    expect((g.control('gr.channel') as { value: string }).value).toBe('7');
  });
});

describe('Granular processor in the default patch', () => {
  it('takes aux 3 and comes back on return 5', () => {
    const p = Patch.default();
    const has = (a: [string, string], b: [string, string]) =>
      p.connections.some((c) => c.from.device === a[0] && c.from.jack === a[1] && c.to.device === b[0] && c.to.jack === b[1]);
    expect(has(['mixer', 'aux3'], ['granular', 'in'])).toBe(true);
    expect(has(['granular', 'out'], ['mixer', 'ret5'])).toBe(true);
    const m = p.device<Mixer>('mixer');
    expect(m.returnCount).toBe(5);
    expect(() => m.control('ret5.busA')).not.toThrow();
    expect(() => m.control('ret5.busB')).not.toThrow(); // it is fed by an aux, so it may go to any bus
  });
});

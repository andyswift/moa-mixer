import { describe, expect, it } from 'vitest';
import { GRANULAR_INIT, GRANULAR_PRESETS, GranularFx } from '../devices/granular';
import type { Mixer } from '../devices/mixer';
import { Patch } from '../patch/patch';

const set = (d: GranularFx, id: string, v: number | boolean) => (d.control(id) as { set(v: unknown): void }).set(v);
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

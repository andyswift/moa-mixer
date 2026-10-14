import { describe, expect, it } from 'vitest';
import { FilterBox, FILTER_TYPES } from '../devices/filterBox';
import { FILTER_BOX_FACTORY, FILTER_BOX_INIT, FILTER_BOX_SLOTS } from '../devices/filterBoxPresets';
import { Patch } from '../patch/patch';

describe('FilterBox', () => {
  it('builds with every control mapped to a worklet param', () => {
    const box = new FilterBox();
    expect(box.circuit.node('box').kind).toBe('df');
    expect(box.controls.length).toBeGreaterThan(40);
    expect(Object.keys(FILTER_BOX_INIT).sort()).toEqual(box.controls.map((c) => c.id).sort());
  });

  it('has sixteen slots and every factory patch loads and round-trips through a snapshot', () => {
    const box = new FilterBox();
    expect(box.slots).toHaveLength(FILTER_BOX_SLOTS);
    expect(FILTER_BOX_FACTORY.length).toBeLessThanOrEqual(FILTER_BOX_SLOTS);
    for (let i = 0; i < box.slots.length; i++) {
      box.loadSlot(i);
      const first = box.snapshot();
      box.loadSlot(0);
      box.loadSlot(i);
      expect(box.snapshot()).toEqual(first);
    }
  });

  it('a patch resets everything it does not mention', () => {
    const box = new FilterBox();
    box.loadSlot(3); // Screaming Madman sets lots of things
    box.loadSlot(0); // Init
    expect(box.snapshot()).toEqual(FILTER_BOX_INIT);
  });

  it('filter type choices reach the worklet as indices', () => {
    const box = new FilterBox();
    const type = box.control('f2.type') as { set(v: string): void };
    type.set('BANDSTOP+');
    expect(box.circuit.node('box').params.f2Type).toBe(FILTER_TYPES.indexOf('BANDSTOP+'));
  });

  it('keys and OPEN gates are sent to the node', () => {
    const box = new FilterBox();
    const seen: string[] = [];
    box.circuit.onChange((c) => { if (c.type === 'gate') seen.push(`${c.target}:${c.on}`); });
    box.setKeys(true);
    box.setOpen(2, true);
    box.setKeys(false);
    expect(seen).toEqual(['keys:true', 'open2:true', 'keys:false']);
  });

  it('save keeps the slot name and stores the panel', () => {
    const box = new FilterBox();
    (box.control('delay.level') as { set(v: number): void }).set(0.9);
    const saved = box.saveSlot(5);
    expect(saved.name).toBe(box.slots[5]!.name);
    expect(saved.values['delay.level']).toBe(0.9);
  });

  it('the df2 patch routes the Lynch into the box and the box to the speakers', () => {
    const patch = Patch.df2();
    expect(patch.connections).toEqual([{ from: { device: 'lynch', jack: 'out' }, to: { device: 'box', jack: 'in' } }]);
    expect(patch.output).toEqual({ device: 'box', jack: 'out' });
  });
});

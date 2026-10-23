import { describe, expect, it } from 'vitest';
import { CABINETS } from '../devices/bassGuitar';
import { ElectricGuitar, GUITAR_CABINETS } from '../devices/electricGuitar';

type Sent = { node: string; type: string; on?: boolean; delay?: number; pickup?: number[] };
const watch = (g: ElectricGuitar) => {
  const sent: Sent[] = [];
  g.circuit.onChange((c) => { if (c.type === 'message') sent.push({ node: c.nodeId, ...(c.data as { type: string }) }); });
  return sent;
};
const set = (g: ElectricGuitar, id: string, v: number | string) => (g.control(id) as { set(v: number | string): void }).set(v);
const param = (g: ElectricGuitar, node: string, name: string) => g.circuit.node(node).params[name]!;
const config = (g: ElectricGuitar, i: number) => JSON.parse(g.circuit.node(`s${i + 1}`).options.config!) as { hz: number[]; pickup: number[] };
const E_MAJOR = [40, 47, 52, 56, 59, 64]; // 0 2 2 1 0 0

describe('MOA-GUITAR, six strings', () => {
  it('starts in standard tuning at real-world tensions (about 100 lb for the set)', () => {
    const g = new ElectricGuitar();
    expect([0, 1, 2, 3, 4, 5].map((i) => g.readout(i).open.name)).toEqual(['E2', 'A2', 'D3', 'G3', 'B3', 'E4']);
    for (let i = 0; i < 6; i++) expect(Math.abs(g.readout(i).open.cents)).toBeLessThan(1);
    const total = [0, 1, 2, 3, 4, 5].reduce((sum, i) => sum + g.tension(i), 0) / 4.448222;
    expect(total).toBeGreaterThan(95);
    expect(total).toBeLessThan(110);
    expect(g.readout(5).winding).toBe('Plain steel');
    set(g, 'string.winding', 'flat'); // a set of flatwounds: the wound strings change, the plain ones cannot
    expect(g.readout(0).winding).toBe('Flatwound');
    expect(g.readout(5).winding).toBe('Plain steel');
  });

  it('a chord goes across the strings as a guitarist would finger it', () => {
    const g = new ElectricGuitar();
    g.hand = 1;
    for (const n of E_MAJOR) g.keyDown(n);
    expect(g.voices.map((v) => v.note)).toEqual(E_MAJOR);
    expect(g.voices.map((v) => v.fret)).toEqual([0, 2, 2, 1, 0, 0]);
  });

  it('strums a chord: each string after the first waits the strum time per string crossed; single notes do not wait', () => {
    const g = new ElectricGuitar();
    let t = 1000;
    g.now = () => t;
    set(g, 'strum.time', 10);
    const sent = watch(g);
    g.hand = 1;
    for (const n of E_MAJOR) g.keyDown(n);
    expect(sent.filter((m) => m.type === 'pluck').map((m) => m.delay ?? 0)).toEqual([0, 0.01, 0.02, 0.03, 0.04, 0.05]);
    t += 500;
    sent.length = 0;
    g.keyDown(67); // a note on its own, later
    expect(sent.find((m) => m.type === 'pluck')!.delay).toBeUndefined();
    // an up strum starts at the top
    t += 500;
    set(g, 'strum', 'up');
    sent.length = 0;
    for (const n of [...E_MAJOR].reverse()) g.keyDown(n);
    expect(sent.filter((m) => m.type === 'pluck').map((m) => m.delay ?? 0)).toEqual([0, 0.01, 0.02, 0.03, 0.04, 0.05]);
    set(g, 'strum', 'off');
    t += 500;
    sent.length = 0;
    for (const n of E_MAJOR) g.keyDown(n);
    expect(sent.filter((m) => m.type === 'pluck').every((m) => m.delay === undefined)).toBe(true);
  });

  it('the vibrato arm bends every string down as well as up', () => {
    const g = new ElectricGuitar();
    g.setPitchBend(-1);
    expect(g.readout(0).now.name).toBe('D2');
    expect(g.readout(5).now.name).toBe('D4');
    g.setPitchBend(1);
    expect(g.readout(0).now.name).toBe('F#2');
  });

  it('the five-way switch picks the coils; humbuckers and the tone knob lower the pickup\'s resonance', () => {
    const g = new ElectricGuitar();
    const bridge = config(g, 0).pickup;
    set(g, 'pickup.select', 'neck');
    const neck = config(g, 0).pickup;
    // the neck pickup hears the low modes louder than the bridge pickup does, the high ones relatively less
    expect(Math.abs(neck[0]!)).toBeGreaterThan(Math.abs(bridge[0]!) * 2);
    expect(Math.abs(neck[20]! / neck[0]!)).toBeLessThan(Math.abs(bridge[20]! / bridge[0]!));
    set(g, 'pickup.select', 'bridge');
    const single = param(g, 's1', 'tone');
    set(g, 'pickup.type', 'humbucker');
    expect(param(g, 's1', 'tone')).toBeLessThan(single * 0.6);
    set(g, 'tone', 0);
    expect(param(g, 's1', 'tone')).toBeLessThan(single * 0.6 * 0.25);
    expect(g.pickups().filter((p) => p.on).map((p) => p.coils)).toEqual([2]);
  });

  it('every string\'s pickup is balanced against its speed: the high e is not much louder than the low E', () => {
    const g = new ElectricGuitar();
    const fundamental = (i: number) => Math.abs(config(g, i).pickup[0]!) * config(g, i).hz[0]!; // what the coil hears of mode 1
    expect(fundamental(5) / fundamental(0)).toBeLessThan(2);
    expect(fundamental(5) / fundamental(0)).toBeGreaterThan(1);
  });

  it('the amp goes from clean to crunch with the make-up keeping the level; guitar cabinets roll off higher at the bottom', () => {
    const g = new ElectricGuitar();
    set(g, 'amp.gain', 0);
    expect(param(g, 'ampIn', 'gain')).toBeLessThan(0.2); // a strummed chord stays low on the valve's curve
    set(g, 'amp.gain', 1);
    expect(param(g, 'ampIn', 'gain')).toBeGreaterThan(10);
    expect(param(g, 'ampPost', 'gain')).toBeLessThan(1);
    for (const [id, cab] of Object.entries(GUITAR_CABINETS)) {
      set(g, 'cab.type', id);
      expect(param(g, 'cabHp', 'frequency')).toBe(cab.hp);
      expect(cab.hp).toBeGreaterThan(Math.max(...Object.values(CABINETS).map((c) => c.hp)));
    }
  });

  it('has an overdrive pedal: its blend keeps the power from bypass to fully on, and only the highs go into the clipper', () => {
    const g = new ElectricGuitar();
    expect([param(g, 'pedalDry', 'gain'), param(g, 'odWet', 'gain')]).toEqual([1, 0]); // off as it comes
    for (const v of [0.3, 0.7, 1]) {
      set(g, 'drive.mix', v);
      expect(param(g, 'pedalDry', 'gain') ** 2 + param(g, 'odWet', 'gain') ** 2).toBeCloseTo(1, 10);
    }
    const into = (node: string) => g.circuit.cables.filter((c) => c.to === node).map((c) => c.from);
    expect(into('odGain')).toEqual(['odHp']);
    expect(g.circuit.node('odHp').options.type).toBe('highpass');
    expect(into('odLevel').sort()).toEqual(['odLow', 'odTone']); // the lows round the clipper, clean
  });
});

describe('dead notes', () => {
  it('a very soft note is struck with the string already damped (a hard mute straight after its pluck, never strummed late)', () => {
    const g = new ElectricGuitar();
    let t = 0;
    g.now = () => t;
    const sent = watch(g) as (Sent & { hard?: boolean })[];
    g.keyDown(40, 100); // a chord's first note starts a strum
    sent.length = 0;
    g.keyDown(52, 36); // within the strum, but dead
    const [pluck, mute] = sent.filter((m) => m.type === 'pluck' || (m.type === 'mute' && m.on));
    expect(pluck!.type).toBe('pluck');
    expect(pluck!.delay).toBeUndefined();
    expect(mute).toMatchObject({ type: 'mute', on: true, hard: true });
    sent.length = 0;
    g.keyDown(55, 41); // just above: an ordinary note
    expect(sent.some((m) => m.type === 'mute' && m.on)).toBe(false);
  });
});

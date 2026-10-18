import { describe, expect, it } from 'vitest';
import { BassString } from '../devices/bassString';

const watch = (b: BassString) => {
  const sent: { type: string; [k: string]: unknown }[] = [];
  b.circuit.onChange((c) => { if (c.type === 'message') sent.push(c.data as { type: string }); });
  return sent;
};
const choose = (b: BassString, id: string, v: string) => (b.control(id) as { set(v: string): void }).set(v);

describe('MOA-BASS string', () => {
  it('starts as an E string tuned to E1 at long scale, at the tension a real one needs', () => {
    const b = new BassString();
    expect(b.openNote).toBe(28);
    expect(b.readout.now.name).toBe('E1');
    expect(Math.abs(b.readout.open.cents)).toBeLessThan(1);
    expect(b.tension).toBeGreaterThan(190);
    expect(b.tension).toBeLessThan(210);
  });

  it('a note picks the fret and plucks; a note below the open string or past fret 24 is not on this string', () => {
    const b = new BassString();
    const sent = watch(b);
    b.keyDown(28 + 7);
    expect(b.fret).toBe(7);
    expect(b.readout.now.name).toBe('B1');
    expect(sent.some((m) => m.type === 'pluck')).toBe(true);
    b.keyDown(20);
    b.keyDown(28 + 30);
    expect(b.fret).toBe(7);
  });

  it('letting go mutes the string; a held note under it is a pull-off to that fret', () => {
    const b = new BassString();
    const sent = watch(b);
    b.keyDown(28 + 3);
    b.keyDown(28 + 5);
    b.keyUp(28 + 5);
    expect(b.fret).toBe(3);
    expect(sent.at(-1)!.type).not.toBe('mute');
    b.keyUp(28 + 3);
    expect(sent.at(-1)).toEqual({ type: 'mute', on: true });
  });

  it('each gauge tunes to its standard note, and the tension follows the physics (heavier strings need more pull)', () => {
    const b = new BassString();
    const notes: Record<string, string> = { E: 'E1', A: 'A1', D: 'D2', G: 'G2' };
    for (const [g, name] of Object.entries(notes)) {
      choose(b, 'string.gauge', g);
      b.tuneToStandard();
      expect(b.readout.open.name).toBe(name);
      expect(Math.abs(b.readout.open.cents)).toBeLessThan(1);
    }
    // the same E string on a shorter scale needs less tension for E1
    choose(b, 'string.gauge', 'E');
    b.tuneToStandard();
    const long = b.tension;
    choose(b, 'string.scale', 'short');
    b.tuneToStandard();
    expect(b.tension).toBeLessThan(long * 0.8);
  });

  it('the pitch wheel bends by pulling harder: up to a tone, through the tension', () => {
    const b = new BassString();
    const before = b.readout.now.hz;
    const T = b.tension;
    b.setPitchBend(1);
    expect(b.tension).toBeGreaterThan(T * 1.25);
    expect(12 * Math.log2(b.readout.now.hz / before)).toBeCloseTo(2, 1);
  });

  it('keeps its configuration on the node, so an engine started later begins with the right string', () => {
    const b = new BassString();
    choose(b, 'string.winding', 'flat');
    // a flatwound's wrap holds more metal: heavier at the same tension, so it sounds lower until it is retuned
    const flat = JSON.parse(b.circuit.node('string').options.config!) as { type: string; hz: number[]; sigma: number[] };
    expect(flat.type).toBe('configure');
    expect(flat.hz[0]).toBeLessThan(40);
    b.tuneToStandard();
    const cfg = JSON.parse(b.circuit.node('string').options.config!) as { type: string; hz: number[]; sigma: number[] };
    expect(cfg.hz[0]).toBeCloseTo(41.2, 0);
    expect(cfg.sigma.length).toBe(cfg.hz.length);
  });
});

import { describe, expect, it } from 'vitest';
import type { NumberControl } from '../devices/controls';
import { Mixer } from '../devices/mixer';
import { Patch } from '../patch/patch';

const param = (m: Mixer, node: string, name: string) => m.circuit.node(node).params[name]!;
const tape = (m: Mixer, strip: string) => m.control(`${strip}.tape`) as NumberControl;

describe('mixer tape saturation', () => {
  it('at 0 (the default) the strip is as before: drive 1/3, unity make-up, every tape filter at 0 dB', () => {
    const m = new Mixer(2);
    expect(tape(m, 'ch1').value).toBe(0);
    expect(param(m, 'ch1.drive', 'gain')).toBeCloseTo(1 / 3);
    expect(param(m, 'ch1.tapeMakeup', 'gain')).toBe(1);
    for (const f of ['tapePre', 'tapePost', 'tapeHf', 'tapeBump']) expect(param(m, `ch1.${f}`, 'gain')).toBeCloseTo(0);
  });

  it('turned up: lows pushed into the curve and pulled back after, more drive with make-up, a softer top, a head bump', () => {
    const m = new Mixer(2);
    tape(m, 'ch1').set(1);
    expect(param(m, 'ch1.tapePre', 'gain')).toBeCloseTo(6);
    expect(param(m, 'ch1.tapePost', 'gain')).toBeCloseTo(-6);
    expect(param(m, 'ch1.drive', 'gain')).toBeCloseTo(1.2);
    // quiet signals sit below the curve's knee, where it is unity: make-up times drive stays at 1/3
    expect(param(m, 'ch1.drive', 'gain') * param(m, 'ch1.tapeMakeup', 'gain')).toBeCloseTo(1 / 3);
    expect(param(m, 'ch1.tapeHf', 'gain')).toBeCloseTo(-4);
    expect(param(m, 'ch1.tapeBump', 'gain')).toBeCloseTo(1.5);
    // the other strip is untouched
    expect(param(m, 'ch2.drive', 'gain')).toBeCloseTo(1 / 3);
  });

  it('runs in the signal path between the EQ and the mute, in order', () => {
    const m = new Mixer(1);
    const next = (from: string) => m.circuit.cables.find((c) => c.from === from && c.port === 'in')?.to;
    const chain = ['ch1.eqHigh'];
    for (let i = 0; i < 7; i++) chain.push(next(chain.at(-1)!)!);
    expect(chain).toEqual(['ch1.eqHigh', 'ch1.tapePre', 'ch1.drive', 'ch1.sat', 'ch1.tapePost', 'ch1.tapeHf', 'ch1.tapeBump', 'ch1.tapeMakeup']);
    expect(next('ch1.tapeMakeup')).toBe('ch1.mute');
  });

  it('every channel, stereo input and FX return on the mixer page has a Tape control', () => {
    const m = Patch.mixerRack().device('mixer') as Mixer;
    const strips = m.controls.filter((c) => c.id.endsWith('.fader') && !c.id.startsWith('bus')).map((c) => c.id.replace('.fader', ''));
    expect(strips.some((s) => s.startsWith('line'))).toBe(true);
    expect(strips.some((s) => s.startsWith('ret'))).toBe(true);
    for (const s of strips) expect(() => tape(m, s), s).not.toThrow();
  });
});

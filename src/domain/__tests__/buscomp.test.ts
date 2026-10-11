import { describe, expect, it } from 'vitest';
import { BUSCOMP_INIT, BUSCOMP_PRESETS, BusCompFx, nativeMakeupDb } from '../devices/busComp';
import { Mixer } from '../devices/mixer';
import { Patch } from '../patch/patch';

const set = (d: BusCompFx, id: string, v: number | boolean) => (d.control(id) as { set(v: unknown): void }).set(v);
const param = (d: BusCompFx, node: string, name: string) => d.circuit.node(node).params[name]!;

describe('Bus compressor', () => {
  it('has the compressor, sidechain and mix controls with defaults', () => {
    const b = new BusCompFx();
    for (const id of Object.keys(BUSCOMP_INIT)) expect(() => b.control(id)).not.toThrow();
    expect(param(b, 'comp', 'ratio')).toBe(4);
    expect(param(b, 'comp', 'attack')).toBeCloseTo(0.01);
    expect(param(b, 'comp', 'release')).toBeCloseTo(0.2);
  });

  it('Mix blends the dry bus with the compressed copy and applies make-up to the wet side only', () => {
    const b = new BusCompFx();
    set(b, 'bc.threshold', 0); // no browser make-up at threshold 0 dB, so the maths below is plain
    set(b, 'bc.makeup', 6);
    set(b, 'bc.mix', 1);
    expect(param(b, 'dry', 'gain')).toBe(0);
    expect(param(b, 'wet', 'gain')).toBeCloseTo(10 ** (6 / 20));
    set(b, 'bc.mix', 0.25);
    expect(param(b, 'dry', 'gain')).toBeCloseTo(0.75);
    expect(param(b, 'wet', 'gain')).toBeCloseTo(0.25 * 10 ** (6 / 20));
  });

  it('takes out the browser compressor\'s automatic make-up gain', () => {
    expect(Math.abs(nativeMakeupDb(0, 4, 6))).toBe(0);
    expect(nativeMakeupDb(-18, 4, 6)).toBeCloseTo(8.1, 1); // 0.6 * 13.5 dB
    const b = new BusCompFx();
    set(b, 'bc.makeup', 0);
    set(b, 'bc.mix', 1);
    set(b, 'bc.threshold', -18);
    set(b, 'bc.ratio', 4);
    expect(param(b, 'wet', 'gain')).toBeCloseTo(10 ** (-8.1 / 20), 2);
  });

  it('the ducker can only turn the bus down: its CV is a non-positive depth on a gain of 1', () => {
    const b = new BusCompFx();
    expect(param(b, 'duck', 'gain')).toBe(1);
    expect(Math.abs(param(b, 'depth', 'gain'))).toBe(0); // depth 0: no ducking at all
    set(b, 'bc.duck.depth', 0.7);
    expect(param(b, 'depth', 'gain')).toBeCloseTo(-0.7);
    // the key reaches the duck gain through the follower and the soft clipper (output within 0..1)
    expect(b.circuit.cables).toContainEqual({ from: 'depth', to: 'duck', port: 'gain' });
    expect(b.circuit.cables).toContainEqual({ from: 'keyShape', to: 'depth', port: 'in' });
    expect(b.circuit.node('follow').kind).toBe('follower');
  });

  it('duck release and key high-pass drive the follower and the key filter', () => {
    const b = new BusCompFx();
    set(b, 'bc.duck.release', 300);
    expect(param(b, 'follow', 'release')).toBeCloseTo(0.3);
    set(b, 'bc.duck.keyHp', 150);
    expect(param(b, 'keyHp', 'frequency')).toBe(150);
  });

  it('bypass sends the input straight through, and key listen plays the key instead', () => {
    const b = new BusCompFx();
    set(b, 'bc.bypass', true);
    expect(param(b, 'gate', 'gain')).toBe(0);
    expect(param(b, 'bypassPath', 'gain')).toBe(1);
    set(b, 'bc.listen', true);
    expect(param(b, 'bypassPath', 'gain')).toBe(0);
    expect(param(b, 'listenPath', 'gain')).toBe(1);
    set(b, 'bc.listen', false);
    set(b, 'bc.bypass', false);
    expect(param(b, 'gate', 'gain')).toBe(1);
    expect(param(b, 'listenPath', 'gain')).toBe(0);
  });

  it('loads every patch, resetting what the patch does not name', () => {
    const b = new BusCompFx();
    expect(BUSCOMP_PRESETS).toHaveLength(8);
    for (const preset of BUSCOMP_PRESETS) expect(() => b.loadPreset(preset)).not.toThrow();
    b.loadSlot(2);
    expect((b.control('bc.duck.depth') as { value: number }).value).toBeCloseTo(0.7);
    b.loadSlot(0);
    expect((b.control('bc.duck.depth') as { value: number }).value).toBe(0);
  });

  it('saving stores the controls but not Bypass or Key listen', () => {
    const b = new BusCompFx();
    set(b, 'bc.threshold', -30);
    set(b, 'bc.bypass', true);
    const saved = b.saveSlot(1);
    expect(saved.values['bc.threshold']).toBe(-30);
    expect(saved.values).not.toHaveProperty('bc.bypass');
    expect(saved.name).toBe('Glue');
  });
});

describe('Bus compressor in the default patch', () => {
  it('takes bus B and comes back on return 4, keyed by the kick', () => {
    const p = Patch.default();
    const has = (a: [string, string], b: [string, string]) =>
      p.connections.some((c) => c.from.device === a[0] && c.from.jack === a[1] && c.to.device === b[0] && c.to.jack === b[1]);
    expect(has(['mixer', 'busB'], ['buscomp', 'in'])).toBe(true);
    expect(has(['mixer', 'key'], ['buscomp', 'key'])).toBe(true);
    expect(has(['buscomp', 'out'], ['mixer', 'ret4'])).toBe(true);
    const m = p.device<Mixer>('mixer');
    expect((m.control('busB.main') as { value: boolean }).value).toBe(false);
    expect((m.control('key.source') as { value: string }).value).toBe('3');
    expect(() => m.control('ret4.busB')).toThrow(); // a return fed by a bus has no assign back to it
    expect(() => m.control('ret4.busA')).not.toThrow();
  });
});

describe('Mixer key source', () => {
  it('taps one channel at a time, before the fader', () => {
    const m = new Mixer(3);
    const key = m.control('key.source') as { set(v: string): void; value: string };
    expect(m.circuit.node('ch1.keySend').params.gain).toBe(0);
    key.set('2');
    expect(m.circuit.node('ch2.keySend').params.gain).toBe(1);
    expect(m.circuit.node('ch1.keySend').params.gain).toBe(0);
    expect(m.circuit.cables).toContainEqual({ from: 'ch2.mute', to: 'ch2.keySend', port: 'in' });
    expect(m.circuit.cables).toContainEqual({ from: 'ch2.keySend', to: 'key', port: 'in' });
    key.set('off');
    expect(m.circuit.node('ch2.keySend').params.gain).toBe(0);
    expect(() => key.set('4')).toThrow();
  });

  it('never taps a bus or a return, so the key cannot loop back into the compressor', () => {
    const m = new Mixer(2, 'Mixer', 2);
    const fromKey = m.circuit.cables.filter((c) => c.to === 'key');
    expect(fromKey.map((c) => c.from).sort()).toEqual(['ch1.keySend', 'ch2.keySend']);
  });
});

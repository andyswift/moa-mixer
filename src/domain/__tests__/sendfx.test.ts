import { describe, expect, it } from 'vitest';
import type { NumberControl, ToggleControl } from '../devices/controls';
import { Mixer } from '../devices/mixer';
import { DelayFx, ReverbFx } from '../devices/sendFx';
import { Patch } from '../patch/patch';

const set = (d: { control(id: string): unknown }, id: string, v: number | string) => (d.control(id) as { set(v: number | string): void }).set(v);
const param = (d: { circuit: { node(id: string): { params: Record<string, number> } } }, node: string, name: string) => d.circuit.node(node).params[name];

describe('Mixer FX returns', () => {
  it('adds stereo return strips with an input jack and an L/R meter pair each', () => {
    const m = new Mixer(2, 'Mixer', 2);
    expect(m.inputs.map((j) => j.name)).toEqual(['ch1', 'ch2', 'ret1', 'ret2']);
    expect(m.meters.map((j) => j.name)).toEqual(expect.arrayContaining(['ret1.L', 'ret1.R', 'ret2.L', 'ret2.R']));
    expect(m.circuit.node('ret1.meterL').options.channel).toBe('left');
    expect(m.circuit.node('ret1.meterR').options.channel).toBe('right');
  });

  it('has EQ, low cut, balance, mute, bus assigns (A on) and a fader, but no solo', () => {
    const m = new Mixer(1, 'Mixer', 1);
    const ids = m.controls.map((c) => c.id).filter((id) => id.startsWith('ret1.'));
    for (const id of ['lowcutOn', 'eqHigh', 'eqMid', 'eqMidFreq', 'eqLow', 'pan', 'mute', 'busA', 'busB', 'busC', 'fader']) {
      expect(ids).toContain(`ret1.${id}`);
    }
    expect(ids).not.toContain('ret1.solo');
    expect(m.control('ret1.pan').label).toBe('Balance');
    expect((m.control('ret1.busA') as ToggleControl).value).toBe(true);
    expect((m.control('ret1.busB') as ToggleControl).value).toBe(false);
  });

  it('gives a return all six aux sends, including one to its own aux and one to the other effect (dub loops)', () => {
    const m = new Mixer(1, 'Mixer', 2);
    const aux = (strip: string) => m.controls.map((c) => c.id).filter((id) => id.startsWith(`${strip}.aux`) && /\.aux\d$/.test(id));
    expect(aux('ret1')).toEqual(['ret1.aux1', 'ret1.aux2', 'ret1.aux3', 'ret1.aux4', 'ret1.aux5', 'ret1.aux6']);
    expect(aux('ret2')).toHaveLength(6);
    expect(m.circuit.cables).toContainEqual({ from: 'ret1.aux1', to: 'aux1', port: 'in' }); // reverb into itself
    expect(m.circuit.cables).toContainEqual({ from: 'ret2.aux1', to: 'aux1', port: 'in' }); // echo into the reverb
    expect(aux('ch1')).toHaveLength(6);
  });

  it('sends start at zero, so no loop exists until you open one', () => {
    const m = new Mixer(1, 'Mixer', 2);
    for (const id of ['ret1.aux1', 'ret1.aux2', 'ret2.aux1', 'ret2.aux2']) expect(param(m, id, 'gain')).toBe(0);
  });

  it('pre/post switching works on a return, for both aux of a pair', () => {
    const m = new Mixer(1, 'Mixer', 1);
    (m.control('ret1.auxPre12') as ToggleControl).set(true);
    for (const k of [1, 2]) {
      expect(param(m, `ret1.aux${k}.pre`, 'gain')).toBe(1);
      expect(param(m, `ret1.aux${k}.post`, 'gain')).toBe(0);
    }
  });

  it('mutes a return on its own; channel solo does not silence it', () => {
    const m = new Mixer(2, 'Mixer', 1);
    (m.control('ret1.mute') as ToggleControl).set(true);
    expect(param(m, 'ret1.mute', 'gain')).toBe(0);
    (m.control('ret1.mute') as ToggleControl).set(false);
    (m.control('ch1.solo') as ToggleControl).set(true);
    expect(param(m, 'ch2.mute', 'gain')).toBe(0);
    expect(param(m, 'ret1.mute', 'gain')).toBe(1);
  });

  it('routes a return to the buses through its fader and balance, like a channel', () => {
    const m = new Mixer(1, 'Mixer', 1);
    expect(m.circuit.cables).toContainEqual({ from: 'ret1.fader', to: 'ret1.pan', port: 'in' });
    expect(m.circuit.cables).toContainEqual({ from: 'ret1.assignA', to: 'busA', port: 'in' });
  });

  it('sends the main output through a limiter and a hard ceiling, and meters it', () => {
    const m = new Mixer(1);
    const out = m.circuit.node(m.jack('out', 'main').nodeId);
    expect(out.kind).toBe('waveshaper');
    expect(out.options.curve).toBe('limit');
    expect(m.circuit.cables).toContainEqual({ from: 'main', to: 'limiter', port: 'in' });
    expect(m.circuit.cables).toContainEqual({ from: 'limiter', to: 'ceiling', port: 'in' });
    expect(m.circuit.node('limiter').kind).toBe('compressor');
    expect(m.circuit.node('limiter').params.ratio).toBeGreaterThanOrEqual(10);
    expect(m.meters.map((j) => j.name)).toContain('main');
  });
});

describe('Bus to main switch and bus-fed returns', () => {
  it('every bus has a To main switch, on by default, that gates its feed to the main sum', () => {
    const m = new Mixer(1);
    for (const bus of ['A', 'B', 'C']) {
      const t = m.control(`bus${bus}.main`) as ToggleControl;
      expect(t.value).toBe(true);
      expect(param(m, `bus${bus}.toMain`, 'gain')).toBe(1);
      t.set(false);
      expect(param(m, `bus${bus}.toMain`, 'gain')).toBe(0);
    }
  });

  it('a return fed by a bus has no assign to that bus (it would loop), but keeps the others', () => {
    const m = new Mixer(1, 'Mixer', 3, { 3: 'C' });
    const ids = m.controls.map((c) => c.id);
    expect(ids).toContain('ret3.busA');
    expect(ids).toContain('ret3.busB');
    expect(ids).not.toContain('ret3.busC');
    expect(m.circuit.nodes.has('ret3.assignC')).toBe(false);
    expect(ids).toContain('ret1.busC'); // the other returns are unaffected
  });
});

describe('Mixer channel gain stage', () => {
  it('soft-clips every strip after the EQ and before the mute gate and the aux taps', () => {
    const m = new Mixer(2, 'Mixer', 2);
    for (const strip of ['ch1', 'ch2', 'ret1', 'ret2']) {
      const has = (from: string, to: string) => m.circuit.cables.some((c) => c.from === `${strip}.${from}` && c.to === `${strip}.${to}` && c.port === 'in');
      // EQ -> (tape pre-emphasis) -> drive -> curve -> (tape post-emphasis, high cut, bump, make-up) -> mute
      expect(has('eqHigh', 'tapePre')).toBe(true);
      expect(has('tapePre', 'drive')).toBe(true);
      expect(has('drive', 'sat')).toBe(true);
      expect(has('sat', 'tapePost')).toBe(true);
      expect(has('tapeMakeup', 'mute')).toBe(true);
      expect(m.circuit.node(`${strip}.sat`).options.curve).toBe('warm');
      expect(m.circuit.node(`${strip}.drive`).params.gain).toBeCloseTo(1 / 3); // maps the +/-3 range onto the curve
      expect(has('sat', 'aux1.pre')).toBe(false); // the pre-fader aux tap comes after the mute gate
      expect(has('mute', 'aux1.pre')).toBe(true);
    }
  });
});

describe('ReverbFx', () => {
  it('is mono in, stereo out, through pre-delay, a convolver, low cut and damping', () => {
    const r = new ReverbFx();
    expect(r.circuit.node('in').options.channels).toBe('mono');
    expect(r.circuit.node('conv').kind).toBe('convolver');
    for (const [from, to] of [['in', 'pre'], ['pre', 'conv'], ['conv', 'lowcut'], ['lowcut', 'damp'], ['damp', 'drive'], ['drive', 'sat'], ['sat', 'out']]) {
      expect(r.circuit.cables).toContainEqual({ from, to, port: 'in' });
    }
  });

  it('soft-clips its output (so a self-fed reverb stays bounded) with make-up gain of 3.5 for small signals', () => {
    const r = new ReverbFx();
    expect(r.circuit.node('sat').options.curve).toBe('soft');
    const smallSignalGain = param(r, 'drive', 'gain')! * (2.5 / Math.tanh(2.5)) * param(r, 'out', 'gain')!;
    expect(smallSignalGain).toBeCloseTo(3.5, 5);
    expect(param(r, 'out', 'gain')).toBe(2); // the ceiling
  });

  it('size picks the tail, and the other controls reach their nodes', () => {
    const r = new ReverbFx();
    expect(r.circuit.node('conv').options.size).toBe('medium');
    set(r, 'reverb.size', 'large');
    expect(r.circuit.node('conv').options.size).toBe('large');
    set(r, 'reverb.predelay', 80);
    expect(param(r, 'pre', 'delayTime')).toBeCloseTo(0.08);
    set(r, 'reverb.lowcut', 300);
    expect(param(r, 'lowcut', 'frequency')).toBe(300);
    set(r, 'reverb.damp', 2000);
    expect(param(r, 'damp', 'frequency')).toBe(2000);
    expect(() => set(r, 'reverb.size', 'huge')).toThrow();
  });
});

describe('DelayFx', () => {
  it('has a mono input, stereo output via hard-panned lines, and a feedback loop through each delay', () => {
    const d = new DelayFx();
    expect(d.circuit.node('in').options.channels).toBe('mono');
    expect(param(d, 'panL', 'pan')).toBe(-1);
    expect(param(d, 'panR', 'pan')).toBe(1);
    for (const [from, to] of [['fbSelfL', 'dlyL'], ['fbCrossL', 'dlyR'], ['fbSelfR', 'dlyR'], ['fbCrossR', 'dlyL']]) {
      expect(d.circuit.cables).toContainEqual({ from, to, port: 'in' });
    }
    expect(d.circuit.node('satL').options.curve).toBe('soft');
  });

  it('time sets both lines, in seconds', () => {
    const d = new DelayFx();
    set(d, 'delay.time', 500);
    expect(param(d, 'dlyL', 'delayTime')).toBeCloseTo(0.5);
    expect(param(d, 'dlyR', 'delayTime')).toBeCloseTo(0.5);
  });

  it('ping-pong splits the feedback between a line and the other line, and where the input goes', () => {
    const d = new DelayFx();
    set(d, 'delay.feedback', 0.6);
    set(d, 'delay.spread', 1);
    expect(param(d, 'fbSelfL', 'gain')).toBeCloseTo(0);
    expect(param(d, 'fbCrossL', 'gain')).toBeCloseTo(0.6);
    expect(param(d, 'inGainR', 'gain')).toBeCloseTo(0); // only the left line is fed: the echoes bounce
    set(d, 'delay.spread', 0);
    expect(param(d, 'fbSelfR', 'gain')).toBeCloseTo(0.6);
    expect(param(d, 'fbCrossR', 'gain')).toBeCloseTo(0);
    expect(param(d, 'inGainR', 'gain')).toBeCloseTo(1);
    set(d, 'delay.spread', 0.5);
    expect(param(d, 'fbSelfL', 'gain')).toBeCloseTo(0.3);
    expect(param(d, 'fbCrossL', 'gain')).toBeCloseTo(0.3);
  });

  it('feedback follows when spread is changed first or second', () => {
    const d = new DelayFx();
    set(d, 'delay.spread', 0.25);
    set(d, 'delay.feedback', 0.8);
    expect(param(d, 'fbSelfL', 'gain')).toBeCloseTo(0.6);
    expect(param(d, 'fbCrossL', 'gain')).toBeCloseTo(0.2);
  });

  it('can be pushed past 100% feedback (the soft clipper keeps it bounded)', () => {
    const d = new DelayFx();
    expect((d.control('delay.feedback') as NumberControl).max).toBeGreaterThan(1);
    set(d, 'delay.feedback', 1.1);
    expect(param(d, 'fbCrossL', 'gain')! + param(d, 'fbSelfL', 'gain')!).toBeCloseTo(1.1);
  });

  it('drive adds saturation without changing the small-signal loop gain', () => {
    const d = new DelayFx();
    for (const drive of [0, 0.5, 1]) {
      set(d, 'delay.drive', drive);
      const product = param(d, 'driveL', 'gain')! * param(d, 'makeL', 'gain')!;
      expect(product).toBeCloseTo(Math.tanh(2.5) / 2.5, 6);
    }
    expect(param(d, 'driveR', 'gain')).toBe(4);
  });

  it('tone and wobble reach their nodes', () => {
    const d = new DelayFx();
    set(d, 'delay.tone', 1000);
    expect(param(d, 'toneL', 'frequency')).toBe(1000);
    expect(param(d, 'toneR', 'frequency')).toBe(1000);
    set(d, 'delay.wobble', 1);
    expect(param(d, 'wobbleDepth', 'gain')).toBeCloseTo(0.004);
  });
});

describe('Default patch send effects', () => {
  it('feeds aux 1 to the reverb and aux 2 to the delay, and brings them back on returns 1 and 2', () => {
    const p = Patch.default();
    const has = (from: [string, string], to: [string, string]) =>
      p.connections.some((c) => c.from.device === from[0] && c.from.jack === from[1] && c.to.device === to[0] && c.to.jack === to[1]);
    expect(has(['mixer', 'aux1'], ['reverb', 'in'])).toBe(true);
    expect(has(['mixer', 'aux2'], ['delay', 'in'])).toBe(true);
    expect(has(['reverb', 'out'], ['mixer', 'ret1'])).toBe(true);
    expect(has(['delay', 'out'], ['mixer', 'ret2'])).toBe(true);
    expect((p.device('mixer') as Mixer).returnCount).toBe(5); // reverb, delay, Ouroboros, the bus compressor and Granular
  });
});

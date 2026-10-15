import { describe, expect, it } from 'vitest';
import { INTERNAL, type InputHost, MixerInputs, NONE } from '../mixerInputs';
import { MonitorControl } from '../monitorControl';

function setup(defaults: Record<string, string> = {}) {
  const log: string[] = [];
  let ports: { id: string; name: string }[] = [];
  const hasInternal = !defaults['@noInternal'];
  const store = new Map<string, string>();
  const storage = { getItem: (k: string) => store.get(k) ?? null, setItem: (k: string, v: string) => void store.set(k, v) };
  const host: InputHost = {
    ports: () => ports,
    hasInternal: () => hasInternal,
    setInternal: (jack, on) => void log.push(`cable ${jack} ${on ? 'on' : 'off'}`),
    attach: async (jack, portId) => {
      log.push(`attach ${jack} ${portId}`);
      return () => void log.push(`detach ${jack} ${portId}`);
    },
  };
  const inputs = new MixerInputs(host, ['ch1', 'ch2'], defaults, storage);
  return { inputs, log, store, storage, host, setPorts: (p: typeof ports) => { ports = p; inputs.reconcile(); } };
}
const flush = () => new Promise((r) => setTimeout(r, 0));

describe('MixerInputs', () => {
  it('does nothing until audio has started', () => {
    const { inputs, log } = setup();
    expect(inputs.status('ch1')).toBe('idle');
    inputs.reconcile();
    expect(log).toEqual([]);
  });

  it('keeps the in-page instrument by default', () => {
    const { inputs, log } = setup();
    inputs.start();
    expect(inputs.status('ch1')).toBe('internal');
    expect(log).toEqual([]);
  });

  it('cuts the cable and plays a port into the jack when one is chosen', async () => {
    const { inputs, log, setPorts } = setup();
    inputs.start();
    setPorts([{ id: 'p1', name: 'Synth' }]);
    inputs.setSelection('ch1', 'Synth');
    expect(inputs.status('ch1')).toBe('connecting');
    await flush();
    expect(inputs.status('ch1')).toBe('live');
    expect(log).toEqual(['cable ch1 off', 'attach ch1 p1']);
  });

  it('goes missing when the port disappears and reconnects when it returns', async () => {
    const { inputs, log, setPorts } = setup({ ch1: 'Synth' });
    inputs.start();
    expect(inputs.status('ch1')).toBe('missing');
    setPorts([{ id: 'p1', name: 'Synth' }]);
    await flush();
    expect(inputs.status('ch1')).toBe('live');
    setPorts([]);
    expect(inputs.status('ch1')).toBe('missing');
    expect(log).toContain('detach ch1 p1');
    setPorts([{ id: 'p2', name: 'Synth' }]); // the tab reloaded: same name, new id
    await flush();
    expect(inputs.status('ch1')).toBe('live');
    expect(log.at(-1)).toBe('attach ch1 p2');
  });

  it('restores the in-page cable and disconnects when switched back to internal or none', async () => {
    const { inputs, log, setPorts } = setup();
    inputs.start();
    setPorts([{ id: 'p1', name: 'Synth' }]);
    inputs.setSelection('ch1', 'Synth');
    await flush();
    inputs.setSelection('ch1', INTERNAL);
    expect(inputs.status('ch1')).toBe('internal');
    expect(log).toEqual(['cable ch1 off', 'attach ch1 p1', 'detach ch1 p1', 'cable ch1 on']);
    inputs.setSelection('ch2', NONE);
    expect(inputs.status('ch2')).toBe('none');
  });

  it('drops a connection that finished after the selection changed', async () => {
    const { inputs, log, setPorts } = setup();
    inputs.start();
    setPorts([{ id: 'p1', name: 'Synth' }]);
    inputs.setSelection('ch1', 'Synth');
    inputs.setSelection('ch1', NONE); // before the attach resolves
    await flush();
    expect(log).toContain('detach ch1 p1');
    expect(inputs.status('ch1')).toBe('none');
  });

  it('starts on the default port, or on none when there is no in-page instrument', async () => {
    const { inputs, setPorts } = setup({ '@noInternal': 'y', ch1: 'Synth' });
    expect(inputs.hasInternal('ch1')).toBe(false);
    expect(inputs.selection('ch1')).toBe('Synth');
    expect(inputs.selection('ch2')).toBe(NONE);
    inputs.start();
    setPorts([{ id: 'p1', name: 'Synth' }]);
    await flush();
    expect(inputs.status('ch1')).toBe('live');
    expect(inputs.status('ch2')).toBe('none');
  });

  it('remembers choices by port name', () => {
    const a = setup();
    a.inputs.setSelection('ch2', 'Poly');
    const again = new MixerInputs(a.host, ['ch1', 'ch2'], {}, a.storage);
    expect(again.selection('ch2')).toBe('Poly');
    expect(again.selection('ch1')).toBe(INTERNAL);
  });

  it('lists each port name once', () => {
    const { inputs, setPorts } = setup();
    setPorts([{ id: 'a', name: 'Synth' }, { id: 'b', name: 'Synth' }, { id: 'c', name: 'Poly' }]);
    expect(inputs.portNames()).toEqual(['Synth', 'Poly']);
  });
});

describe('MonitorControl', () => {
  const make = (audience: () => number) => {
    const applied: boolean[] = [];
    const store = new Map<string, string>();
    const m = new MonitorControl(audience, (on) => applied.push(on), { getItem: (k) => store.get(k) ?? null, setItem: (k, v) => void store.set(k, v) });
    return { m, applied };
  };

  it('auto plays only while nobody is listening', () => {
    let n = 0;
    const { m, applied } = make(() => n);
    m.update();
    n = 1;
    m.update();
    n = 0;
    m.update();
    expect(applied).toEqual([true, false, true]);
  });

  it('on and off ignore the audience, and the mode is remembered', () => {
    const { m, applied } = make(() => 3);
    m.setMode('on');
    m.setMode('off');
    expect(applied).toEqual([true, false]);
    const { m: again } = make(() => 0);
    expect(again.mode).toBe('auto'); // a different store
  });
});

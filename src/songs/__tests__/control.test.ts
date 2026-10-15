import { describe, expect, it } from 'vitest';
import type { Mixer } from '../../domain/devices/mixer';
import { Patch } from '../../domain/patch/patch';
import type { Synthesizer } from '../../domain/devices/synthesizer';
import { applySettings, captureSettings, listenForControl, sendControl, type ControlMessage } from '../control';

describe('applySettings', () => {
  it('sets numbers, choices and toggles by id, clamping numbers', () => {
    const patch = Patch.mixerRack();
    const mixer = patch.device<Mixer>('mixer');
    const warnings = applySettings(patch, {
      mixer: { controls: { 'ch3.fader': 1.1, 'ch1.busA': false, 'ch1.busB': true, 'key.source': '3', 'ch2.fader': 99 } },
    });
    expect(warnings).toEqual([]);
    expect(mixer.control('ch3.fader').value).toBe(1.1);
    expect(mixer.control('ch1.busA').value).toBe(false);
    expect(mixer.control('ch1.busB').value).toBe(true);
    expect(mixer.control('key.source').value).toBe('3');
    expect(mixer.control('ch2.fader').value).toBe(1.5); // clamped to the fader's maximum
  });

  it('accepts 0/1 for toggles and numeric strings for numbers, as a snapshot stores them', () => {
    const patch = Patch.mixerRack();
    const mixer = patch.device<Mixer>('mixer');
    applySettings(patch, { mixer: { controls: { 'ch1.busA': 0, 'ch1.busB': '1', 'ch3.fader': '0.5' } } });
    expect(mixer.control('ch1.busA').value).toBe(false);
    expect(mixer.control('ch1.busB').value).toBe(true);
    expect(mixer.control('ch3.fader').value).toBe(0.5);
  });

  it('skips and reports unknown devices, controls and bad values, and still applies the rest', () => {
    const patch = Patch.mixerRack();
    const mixer = patch.device<Mixer>('mixer');
    const warnings = applySettings(patch, {
      nope: { controls: { x: 1 } },
      mixer: { controls: { 'ch3.nothing': 1, 'key.source': 'banana', 'ch4.fader': 'loud', 'ch5.fader': 0.9 } },
    });
    expect(warnings).toHaveLength(4);
    expect(warnings.join('\n')).toContain('no device nope');
    expect(mixer.control('ch5.fader').value).toBe(0.9);
  });

  it('loads a preset slot before the controls, so controls win, and sets the MIDI channel', () => {
    const patch = Patch.synth();
    const synth = patch.device<Synthesizer>('synth');
    const warnings = applySettings(patch, { synth: { preset: 3, channel: '5', controls: { 'transport.nothing': 1 } } });
    expect(warnings).toHaveLength(1); // only the unknown control; the preset and channel were fine
    expect(synth.transport.channel.value).toBe('5');
    expect(warnings[0]).toContain('transport.nothing');
  });

  it('reports a preset that does not exist and a device with no slots', () => {
    const synthPatch = Patch.synth();
    expect(applySettings(synthPatch, { synth: { preset: 9999 } })).toHaveLength(1);
    const rack = Patch.mixerRack();
    expect(applySettings(rack, { mixer: { preset: 0 }, reverb: { channel: '2' } })).toHaveLength(2);
  });
});

describe('captureSettings', () => {
  it('writes down every control, and what it wrote can be applied to a fresh patch', () => {
    const a = Patch.mixerRack();
    applySettings(a, { mixer: { controls: { 'ch3.fader': 1.2, 'ch1.busB': true, 'ch1.busA': false } }, buscomp: { controls: { 'bc.duck.depth': 0.3 } } });
    const snap = captureSettings(a);
    expect(snap.mixer!.controls!['ch3.fader']).toBe(1.2);
    const b = Patch.mixerRack();
    expect(applySettings(b, snap)).toEqual([]);
    const mixer = b.device<Mixer>('mixer');
    expect(mixer.control('ch3.fader').value).toBe(1.2);
    expect(mixer.control('ch1.busB').value).toBe(true);
    expect(b.device('buscomp').control('bc.duck.depth').value).toBeCloseTo(0.3);
  });
});

describe('control channel', () => {
  it('delivers an order to the page it is addressed to, and not to others', async () => {
    const got: ControlMessage[] = [];
    const other: ControlMessage[] = [];
    const stop = listenForControl('synth', (m) => got.push(m));
    const stopOther = listenForControl('poly', (m) => other.push(m));
    sendControl('synth', { type: 'start' });
    sendControl('synth', { type: 'apply', settings: { synth: { controls: { a: 1 } } } });
    await new Promise((r) => setTimeout(r, 50));
    stop();
    stopOther();
    expect(got.map((m) => m.type)).toEqual(['start', 'apply']);
    expect(other).toEqual([]);
  });
});

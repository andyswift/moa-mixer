import { describe, expect, it } from 'vitest';
import type { NumberControl, ToggleControl } from '../devices/controls';
import { PEDAL_NAMES } from '../devices/rigPedals';
import { RigSynth } from '../devices/rigSynth';

describe('MOA-RIG pedalboard', () => {
  it('puts a pedal in a slot at its starting points, and moves it along the chain with its settings', () => {
    const rig = new RigSynth();
    rig.setPedal(2, 0, 'DRIVE');
    rig.setPedal(2, 1, 'DELAY');
    rig.setPedal(2, 2, 'FILTER');
    (rig.deskControl('p3.fx3.k2') as NumberControl).set(0.25); // the filter's cutoff turned
    (rig.deskControl('p3.fx2.on') as ToggleControl).set(false); // the delay bypassed
    expect([0, 1, 2, 3].map((s) => rig.pedalType(2, s))).toEqual(['DRIVE', 'DELAY', 'FILTER', 'OFF']);
    expect(rig.deskValue('p3.fx2.mix')).toBe(0.35);
    rig.movePedal(2, 2, 0); // the filter first
    expect([0, 1, 2, 3].map((s) => rig.pedalType(2, s))).toEqual(['FILTER', 'DRIVE', 'DELAY', 'OFF']);
    expect(rig.deskValue('p3.fx1.k2')).toBe(0.25);
    expect(rig.deskValue('p3.fx3.on')).toBe(0);
    rig.movePedal(2, 0, 3); // and last
    expect([0, 1, 2, 3].map((s) => rig.pedalType(2, s))).toEqual(['DRIVE', 'DELAY', 'OFF', 'FILTER']);
    rig.setPedal(2, 3, 'OFF');
    expect(rig.deskValue('p3.fx4.type')).toBe(PEDAL_NAMES.indexOf('OFF'));
    // and the multi keeps it all
    const back = new RigSynth();
    back.loadMulti(JSON.parse(JSON.stringify(rig.toMulti())));
    expect([0, 1, 2, 3].map((s) => back.pedalType(2, s))).toEqual(['DRIVE', 'DELAY', 'OFF', 'OFF']);
    expect(back.deskValue('p3.fx2.on')).toBe(0);
  });
});

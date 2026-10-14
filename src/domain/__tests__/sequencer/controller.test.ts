import { describe, expect, it } from 'vitest';
import { type BankStore, SequencerController } from '../../sequencer/controller';
import { SequencerEngine, seeded } from '../../sequencer/engine';
import { type Bank, cloneBank, newBank } from '../../sequencer/track';

function rig() {
  const slots = new Map<number, Bank>();
  const store: BankStore = {
    load: (n) => (slots.has(n) ? cloneBank(slots.get(n)!) : undefined),
    save: (n, b) => void slots.set(n, cloneBank(b)),
    saved: () => Array.from({ length: 16 }, (_, i) => slots.has(i)),
  };
  const c = new SequencerController(new SequencerEngine(newBank(), seeded(1)), store);
  return { c, slots };
}

describe('SequencerController', () => {
  it('starts on track 1 in the track view, and a track pad selects a track', () => {
    const { c } = rig();
    expect(c.view).toBe('tracks');
    expect(c.pads()[0]!.color).toBe('orange');
    c.pad(3, true);
    expect(c.selected).toEqual([3]);
    expect(c.pads()[3]!.color).toBe('orange');
    c.addTrack(5);
    expect(c.selected).toEqual([3, 5]);
  });

  it('turning steps and pulses edits the selected tracks; Ctrl rotates and extends', () => {
    const { c } = rig();
    c.knobTurn('steps', -2);
    expect(c.track.steps).toBe(14);
    c.knobTurn('pulses', 3);
    expect(c.track.pulses).toBe(3);
    c.ctrlLatch = true;
    c.knobTurn('pulses', 2);
    expect(c.track.rotate).toBe(2);
    c.knobTurn('steps', 30);
    expect(c.track.steps).toBe(44);
    c.knobTurn('steps', 100);
    expect(c.track.steps).toBe(64);
  });

  it('pressing a knob shows its view and double press locks it', () => {
    const { c } = rig();
    c.knobDown('division');
    expect(c.view).toBe('division');
    c.knobUp();
    expect(c.view).toBe('tracks');
    c.knobLock('division');
    expect(c.view).toBe('division');
    c.home();
    expect(c.view).toBe('tracks');
  });

  it('division steps through note values and pads pick them, triplets on the bottom row', () => {
    const { c } = rig();
    expect(c.track.division).toBe(24);
    c.knobTurn('division', 1);
    expect(c.track.division).toBe(16);
    c.knobDown('division');
    c.pad(4, true); // 1/16
    expect(c.track.division).toBe(24);
    c.pad(12, true); // /12 triplet
    expect(c.track.division).toBe(32);
    expect(c.pads()[12]!.color).toBe('white');
  });

  it('velocity pads set absolute values from 1 to 127', () => {
    const { c } = rig();
    c.knobDown('velocity');
    c.pad(15, true);
    expect(c.track.velocity).toBe(127);
    c.pad(0, true);
    expect(c.track.velocity).toBe(1);
  });

  it('Ctrl turns the secondary function: probability, groove, delay, root, quantize', () => {
    const { c } = rig();
    c.ctrlLatch = true;
    c.knobTurn('velocity', -5);
    expect(c.track.probability).toBeCloseTo(-0.1, 5);
    c.knobTurn('accent', 3);
    expect(c.track.groove).toBe(3);
    c.knobTurn('timing', 4);
    expect(c.track.delay).toBe(8);
    c.knobTurn('scale', 2);
    expect(c.track.root).toBe(2);
    const before = c.pattern.quantize;
    c.knobTurn('length', 1);
    expect(c.pattern.quantize).toBeGreaterThan(before);
  });

  it('pitch view: pads add and remove scale notes, octave buttons move the page', () => {
    const { c } = rig();
    c.knobDown('pitch');
    expect(c.track.pitchNotes).toEqual([60]);
    c.pad(10, true); // E
    expect(c.track.pitchNotes).toEqual([60, 64]);
    c.pad(8, true); // C removes
    expect(c.track.pitchNotes).toEqual([64]);
    c.pad(7, true); // octave up
    c.pad(8, true);
    expect(c.track.pitchNotes).toEqual([64, 72]);
    // notes out of the scale cannot be added
    c.knobUp();
    c.knobDown('scale');
    c.pad(9, true); // major
    c.knobUp();
    c.knobDown('pitch');
    c.pad(1, true); // C# is not in C major
    expect(c.track.pitchNotes).toEqual([64, 72]);
  });

  it('scale pads pick a scale and tempo is bounded', () => {
    const { c } = rig();
    c.knobDown('scale');
    c.pad(11, true);
    expect(c.track.scale).toBe(3);
    c.knobTurn('tempo', 1000);
    expect(c.bank.tempo).toBe(280);
    c.knobTurn('tempo', -1000);
    expect(c.bank.tempo).toBe(24);
    c.knobDown('tempo');
    c.pad(15, true);
    expect(c.bank.tempo).toBe(280);
  });

  it('mute applies when the pad is let go, and instantly with Ctrl', () => {
    const { c } = rig();
    c.hold('mute', true);
    c.pad(2, true);
    expect(c.pattern.tracks[2]!.muted).toBe(false);
    c.hold('mute', false);
    expect(c.pattern.tracks[2]!.muted).toBe(true);
    c.hold('mute', true);
    c.ctrlLatch = true;
    c.pad(2, true);
    expect(c.pattern.tracks[2]!.muted).toBe(false);
    c.hold('mute', false);
  });

  it('temp changes are undone when the pad is let go', () => {
    const { c } = rig();
    c.hold('temp', true);
    c.knobTurn('velocity', -30);
    expect(c.track.velocity).toBe(70);
    c.hold('temp', false);
    expect(c.track.velocity).toBe(100);
  });

  it('pattern view queues a pattern and pressing several in order chains them', () => {
    const { c } = rig();
    c.hold('pattern', true);
    c.pad(2, true);
    expect(c.engine.patternIndex).toBe(2);
    c.pad(2, false);
    c.pad(1, true); c.pad(4, true); c.pad(6, true);
    c.pad(1, false); c.pad(4, false); c.pad(6, false);
    expect(c.engine.chain).toEqual([1, 4, 6]);
    c.hold('pattern', false);
  });

  it('banks save and load, and loading shows the pattern view', () => {
    const { c, slots } = rig();
    c.knobTurn('pulses', 5);
    expect(c.isUnsaved()).toBe(true);
    c.hold('bank', true);
    c.ctrlLatch = true;
    c.pad(3, true);
    expect(slots.has(3)).toBe(true);
    expect(c.isUnsaved(3)).toBe(false);
    c.ctrlLatch = false;
    c.pad(5, true); // an empty bank
    expect(c.track.pulses).toBe(0);
    expect(c.view).toBe('pattern');
    c.hold('bank', false);
    c.hold('bank', true);
    c.pad(3, true);
    expect(c.track.pulses).toBe(5);
    expect(c.bankSlot).toBe(3);
    c.hold('bank', false);
  });

  it('per-step edit: Ctrl + a pulse pad selects a step, knobs then lock values to it', () => {
    const { c } = rig();
    c.knobTurn('pulses', 4);
    c.knobDown('pulses');
    c.ctrlLatch = true;
    c.pad(4, true);
    c.ctrlLatch = false;
    expect(c.stepEdit).toEqual([4]);
    c.knobTurn('velocity', -40);
    expect(c.track.locks[4]!.velocity).toBe(60);
    expect(c.track.velocity).toBe(100);
    c.exitStepEdit();
    c.knobTurn('velocity', 1);
    expect(c.track.velocity).toBe(101);
  });

  it('manual pulses are toggled with the pads in the pulse view', () => {
    const { c } = rig();
    c.knobDown('pulses');
    c.pad(2, true);
    expect(c.track.manual[2]).toBe(true);
    c.pad(2, true);
    expect(c.track.manual[2]).toBe(false);
  });

  it('clear resets a parameter or a track; copy then clear-paste duplicates a track', () => {
    const { c } = rig();
    c.knobTurn('velocity', -50);
    c.hold('clear', true);
    c.knobDown('velocity');
    expect(c.track.velocity).toBe(100);
    c.hold('clear', false);
    c.knobTurn('pulses', 6);
    c.copy();
    expect(c.hasClipboard).toBe(true);
    c.pad(4, true);
    c.hold('clear', true);
    c.pad(0, true);
    c.hold('clear', false);
    c.pad(0, true);
    expect(c.pattern.tracks[0]!.pulses).toBe(6);
    c.clearClipboard();
    expect(c.hasClipboard).toBe(false);
  });

  it('each track keeps its own channel and the channel pads set it', () => {
    const { c } = rig();
    c.knobDown('channel');
    c.pad(9, true);
    expect(c.track.channel).toBe(10);
    expect(c.pattern.tracks[1]!.channel).toBe(2);
  });

  it('value text for the readout', () => {
    const { c } = rig();
    expect(c.valueText('steps')).toBe('16');
    expect(c.valueText('division')).toBe('1/16');
    expect(c.valueText('tempo')).toBe('120 bpm');
    expect(c.valueText('pitch')).toBe('C3');
  });
});

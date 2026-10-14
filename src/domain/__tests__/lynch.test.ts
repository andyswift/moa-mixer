import { describe, expect, it } from 'vitest';
import type { CircuitChange } from '../circuit/circuit';
import { LYNCH_FACTORY, LYNCH_INIT, LYNCH_NOT_IN_PATCH, LYNCH_PRESETS, LYNCH_SLOTS, slotIndex } from '../devices/lynchPresets';
import { LYNCH_VOICES, LynchSynth } from '../devices/lynchSynth';
import { MidiClock } from '../midi/clock';
import { Patch } from '../patch/patch';

const synth = () => new LynchSynth('Lynch', new MidiClock());
const node = (s: LynchSynth, id: string) => s.circuit.node(id).params;
const record = (s: LynchSynth): CircuitChange[] => {
  const log: CircuitChange[] = [];
  s.circuit.onChange((c) => log.push(c));
  return log;
};
const set = (s: LynchSynth, id: string, value: number | string | boolean) => {
  const c = s.control(id);
  if (c.kind === 'number') c.set(value as number);
  else if (c.kind === 'toggle') c.set(value as boolean);
  else c.set(value as string);
};
/** Which voices were gated on / off in a change log. */
const gated = (log: CircuitChange[], on: boolean) =>
  log.filter((c) => c.type === 'param' && c.name === 'gate' && /^v\d\.env$/.test(c.nodeId) && c.value === (on ? 1 : 0)).map((c) => Number(c.nodeId[1]));

describe('Lynch controls', () => {
  it('maps the filter and envelope onto every voice', () => {
    const s = synth();
    set(s, 'vcf.freq', 1200);
    set(s, 'env.attack', 0.5);
    set(s, 'env.sustain', 0.25);
    for (let i = 0; i < LYNCH_VOICES; i++) {
      expect(node(s, `v${i}.f1`).frequency).toBeCloseTo(1200, 3);
      expect(node(s, `v${i}.f2`).frequency).toBeCloseTo(1200, 3);
      expect(node(s, `v${i}.env`).attack).toBeCloseTo(0.5, 5);
      expect(node(s, `v${i}.env`).sustain).toBeCloseTo(0.25, 5);
    }
  });

  it('range shifts the oscillators by octaves', () => {
    const s = synth();
    set(s, 'dco.range', '16');
    expect(node(s, 'rangeShift').offset).toBe(-1200);
    set(s, 'dco.range', '4');
    expect(node(s, 'rangeShift').offset).toBe(1200);
    set(s, 'dco.range', '8');
    expect(node(s, 'rangeShift').offset).toBe(0);
  });

  it('pulse and saw are independent switches', () => {
    const s = synth();
    set(s, 'dco.pulse', false);
    expect(node(s, 'v0.pulseOut').gain).toBe(0);
    expect(node(s, 'v0.rawOut').gain).toBe(1);
    set(s, 'dco.saw', false);
    set(s, 'dco.pulse', true);
    expect(node(s, 'v0.rawOut').gain).toBe(0);
    expect(node(s, 'v0.pulseOut').gain).toBeGreaterThan(0);
  });

  it('the PWM slider is the pulse width in manual and an LFO depth otherwise', () => {
    const s = synth();
    set(s, 'dco.pwmSource', 'man');
    set(s, 'dco.pwm', 0);
    expect(node(s, 'pwCv').offset).toBeCloseTo(0, 5); // 50 %, a square wave
    expect(node(s, 'lfoPw').gain).toBe(0);
    set(s, 'dco.pwm', 1);
    expect(node(s, 'pwCv').offset).toBeGreaterThan(0.8); // narrow
    set(s, 'dco.pwmSource', 'lfo');
    expect(node(s, 'pwCv').offset).toBe(0);
    expect(node(s, 'lfoPw').gain).toBeGreaterThan(0.5);
  });

  it('the high-pass has four positions: bass boost, flat, and two cutoffs', () => {
    const s = synth();
    set(s, 'hpf.freq', '0');
    expect(node(s, 'v0.boost').gain).toBeGreaterThan(0);
    set(s, 'hpf.freq', '1');
    expect(node(s, 'v0.boost').gain).toBe(0);
    expect(node(s, 'v0.hpf').frequency).toBeLessThan(20);
    set(s, 'hpf.freq', '2');
    const two = node(s, 'v0.hpf').frequency!;
    set(s, 'hpf.freq', '3');
    expect(node(s, 'v0.hpf').frequency).toBeGreaterThan(two);
  });

  it('envelope polarity flips the filter envelope depth', () => {
    const s = synth();
    set(s, 'vcf.env', 0.5);
    const up = node(s, 'v0.envDepth').gain!;
    expect(up).toBeGreaterThan(0);
    set(s, 'vcf.polarity', 'minus');
    expect(node(s, 'v0.envDepth').gain).toBeCloseTo(-up, 5);
  });

  it('the VCA runs from the envelope or a plain gate', () => {
    const s = synth();
    set(s, 'vca.mode', 'gate');
    expect([node(s, 'v0.envAmp').gain, node(s, 'v0.gateAmp').gain]).toEqual([0, 1]);
    set(s, 'vca.mode', 'env');
    expect([node(s, 'v0.envAmp').gain, node(s, 'v0.gateAmp').gain]).toEqual([1, 0]);
  });

  it('chorus I, II and both give three different settings, and none is dry', () => {
    const s = synth();
    expect(node(s, 'chWet').gain).toBe(0);
    expect(node(s, 'chDry').gain).toBe(1);
    set(s, 'chorus.i', true);
    const one = { rate: node(s, 'chLfo').frequency, depth: node(s, 'chDepthL').gain, wet: node(s, 'chWet').gain };
    expect(one.wet).toBeGreaterThan(0);
    set(s, 'chorus.i', false);
    set(s, 'chorus.ii', true);
    const two = { rate: node(s, 'chLfo').frequency };
    expect(two.rate).toBeGreaterThan(one.rate!);
    set(s, 'chorus.i', true);
    expect(node(s, 'chLfo').frequency).toBeGreaterThan(5); // both: fast
    expect(node(s, 'chDepthL').gain).toBeLessThan(one.depth!);
    expect(node(s, 'chDepthR').gain).toBeCloseTo(-node(s, 'chDepthL').gain!, 6); // opposite sweeps: stereo
  });

  it('portamento sets a glide time on every voice, zero when off', () => {
    const s = synth();
    set(s, 'master.portamento', 0);
    expect(node(s, 'v0.pitch').glide).toBe(0);
    set(s, 'master.portamento', 0.6);
    for (let i = 0; i < LYNCH_VOICES; i++) expect(node(s, `v${i}.pitch`).glide).toBeGreaterThan(0.2);
  });

  it('LFO delay becomes the fade-in time', () => {
    const s = synth();
    set(s, 'lfo.delay', 1.5);
    expect(node(s, 'lfoFade').attack).toBeCloseTo(1.5, 5);
    set(s, 'lfo.delay', 0);
    expect(node(s, 'lfoFade').attack).toBeGreaterThan(0);
  });
});

describe('Lynch playing', () => {
  it('poly 1 gives each of six notes its own voice', () => {
    const s = synth();
    const log = record(s);
    [60, 62, 64, 65, 67, 69].forEach((n) => s.keyDown(n));
    expect(new Set(gated(log, true)).size).toBe(6);
  });

  it('poly 2 reuses the lowest free voice, poly 1 rotates', () => {
    const run = (mode: string) => {
      const s = synth();
      set(s, 'assign.mode', mode);
      const log = record(s);
      s.keyDown(60);
      s.keyUp(60);
      s.keyDown(62);
      return gated(log, true);
    };
    expect(run('poly2')).toEqual([0, 0]);
    expect(run('poly1')[1]).not.toBe(0);
  });

  it('unison plays every voice on one note, detuned', () => {
    const s = synth();
    set(s, 'assign.mode', 'unison');
    const log = record(s);
    s.keyDown(60);
    expect(new Set(gated(log, true)).size).toBe(LYNCH_VOICES);
    const detunes = Array.from({ length: LYNCH_VOICES }, (_, i) => node(s, `v${i}.det`).offset!);
    expect(Math.min(...detunes)).toBeLessThan(0);
    expect(Math.max(...detunes)).toBeGreaterThan(0);
  });

  it('hold keeps released notes sounding until it is switched off', () => {
    const s = synth();
    set(s, 'key.hold', true);
    const log = record(s);
    s.keyDown(60);
    s.keyUp(60);
    expect(gated(log, false)).toEqual([]);
    expect(s.heldNotes).toEqual([60]);
    set(s, 'key.hold', false);
    expect(gated(log, false).length).toBe(1);
    expect(s.heldNotes).toEqual([]);
  });

  it('the sustain pedal does the same', () => {
    const s = synth();
    const log = record(s);
    s.handleMidi({ type: 'cc', channel: 1, controller: 64, value: 127 });
    s.keyDown(60);
    s.keyUp(60);
    expect(gated(log, false)).toEqual([]);
    s.handleMidi({ type: 'cc', channel: 1, controller: 64, value: 0 });
    expect(gated(log, false).length).toBe(1);
  });

  it('key transpose shifts what sounds and releases the same note', () => {
    const s = synth();
    set(s, 'key.transpose', '1');
    const log = record(s);
    s.keyDown(60);
    const on = log.find((c) => c.type === 'param' && c.name === 'offset' && /^v\d\.pitch$/.test(c.nodeId)) as Extract<CircuitChange, { type: 'param' }>;
    expect(on.value).toBe((72 - 69) * 100);
    set(s, 'key.transpose', '0'); // changed while the key is down: the release must still find it
    s.keyUp(60);
    expect(gated(log, false).length).toBe(1);
  });

  it('the bender moves pitch by the DCO sensitivity and the filter by the VCF sensitivity', () => {
    const s = synth();
    set(s, 'bend.dco', 4);
    set(s, 'bend.vcf', 0.5);
    s.setPitchBend(1);
    expect(node(s, 'bend').offset).toBeCloseTo(400, 3);
    expect(node(s, 'bendVcf').offset).toBeGreaterThan(0);
    s.setPitchBend(-0.5);
    expect(node(s, 'bend').offset).toBeCloseTo(-200, 3);
  });

  it('pushing the lever forward adds LFO vibrato by the LFO sensitivity', () => {
    const s = synth();
    set(s, 'bend.lfo', 1);
    s.setModWheel(0);
    expect(node(s, 'lfoPitchMod').gain).toBe(0);
    s.setModWheel(1);
    expect(node(s, 'lfoPitchMod').gain).toBeGreaterThan(100);
  });

  it('LFO TRIG makes the lever, not the keys, restart the LFO delay', () => {
    const s = synth();
    s.keyDown(60);
    expect(node(s, 'lfoFade').gate).toBe(1);
    set(s, 'bend.lfoTrig', true);
    expect(node(s, 'lfoFade').gate).toBe(0);
    s.setModWheel(0.8);
    expect(node(s, 'lfoFade').gate).toBe(1);
  });

  it('reacts to MIDI on the chosen channel and to program changes', () => {
    const s = synth();
    s.transport.channel.set('4');
    s.handleMidi({ type: 'noteOn', channel: 1, note: 60, velocity: 100 });
    expect(s.heldNotes).toEqual([]);
    s.handleMidi({ type: 'noteOn', channel: 4, note: 60, velocity: 100 });
    expect(s.heldNotes).toEqual([60]);
    s.handleMidi({ type: 'programChange', channel: 4, program: 9 });
    expect(s.currentSlot).toBe(9);
  });
});

describe('Lynch patch memory', () => {
  it('has 128 slots: group A or B, 8 banks of 8', () => {
    expect(LYNCH_SLOTS).toBe(128);
    expect(LYNCH_PRESETS.length).toBe(128);
    expect(slotIndex(0, 1, 1)).toBe(0);
    expect(slotIndex(0, 8, 8)).toBe(63);
    expect(slotIndex(1, 1, 1)).toBe(64);
    expect(slotIndex(1, 8, 8)).toBe(127);
  });

  it('ships 24 factory patches with distinct names, then Init', () => {
    expect(LYNCH_FACTORY.length).toBe(24);
    expect(new Set(LYNCH_FACTORY.map((p) => p.name)).size).toBe(24);
    expect(LYNCH_PRESETS[24]!.name).toBe('Init');
  });

  it('every patch loads and names only real controls', () => {
    const s = synth();
    const ids = new Set(s.controls.map((c) => c.id));
    expect([...ids].sort()).toEqual(Object.keys(LYNCH_INIT).sort());
    for (const preset of LYNCH_PRESETS) {
      for (const id of Object.keys(preset.values)) expect(ids.has(id), `${preset.name}: ${id}`).toBe(true);
    }
    for (let i = 0; i < LYNCH_FACTORY.length; i++) expect(() => s.loadSlot(i)).not.toThrow();
  });

  it('a patch does not touch volume, tuning, hold or transpose', () => {
    const s = synth();
    set(s, 'master.volume', 0.3);
    set(s, 'master.tune', 20);
    set(s, 'key.transpose', '2');
    s.loadSlot(5);
    expect((s.control('master.volume') as { value: number }).value).toBeCloseTo(0.3, 5);
    expect((s.control('master.tune') as { value: number }).value).toBeCloseTo(20, 5);
    expect((s.control('key.transpose') as { value: string }).value).toBe('2');
    expect(Object.keys(s.snapshot())).not.toEqual(expect.arrayContaining([...LYNCH_NOT_IN_PATCH]));
  });

  it('group, bank and patch keys pick the slot and the display numbers follow', () => {
    const s = synth();
    s.selectGroup(1);
    s.selectBank(3);
    s.selectPatch(5);
    expect(s.currentSlot).toBe(slotIndex(1, 3, 5));
    expect(s.patchNumber).toEqual({ group: 1, bank: 3, patch: 5 });
  });

  it('selecting a patch leaves manual, and the Manual key brings the panel sound back', () => {
    const s = synth();
    expect(s.manual).toBe(true);
    set(s, 'vcf.freq', 777);
    s.loadSlot(2); // Strings: a different cutoff
    expect(s.manual).toBe(false);
    expect((s.control('vcf.freq') as { value: number }).value).not.toBeCloseTo(777, 0);
    s.selectManual();
    expect(s.manual).toBe(true);
    expect((s.control('vcf.freq') as { value: number }).value).toBeCloseTo(777, 0);
  });

  it('Write stores the sound in the selected slot and keeps its name', () => {
    const s = synth();
    s.selectGroup(1);
    s.selectBank(2);
    s.selectPatch(1);
    set(s, 'env.release', 4);
    const saved = s.write();
    expect(saved.name).toBe('Init');
    expect(s.slots[slotIndex(1, 2, 1)]!.values['env.release']).toBeCloseTo(4, 5);
    set(s, 'env.release', 0.1);
    s.loadSlot(slotIndex(1, 2, 1));
    expect((s.control('env.release') as { value: number }).value).toBeCloseTo(4, 5);
  });
});

describe('the Lynch patch', () => {
  it('wires the synth straight to the output', () => {
    const patch = Patch.lynch();
    expect([...patch.devices.keys()]).toEqual(['lynch']);
    expect(patch.output).toEqual({ device: 'lynch', jack: 'out' });
  });
});

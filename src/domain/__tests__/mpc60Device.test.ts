import { describe, expect, it } from 'vitest';
import { MidiClock } from '../midi/clock';
import { DECAY_OFF, Mpc60, padIndex, padName } from '../devices/mpc60';

type Msg = { type: string; pad?: number; velocity?: number; over?: Record<string, unknown>; settings?: Record<string, unknown>; id?: string; rate?: number };
const watch = (m: Mpc60) => {
  const sent: Msg[] = [];
  m.circuit.onChange((c) => { if (c.type === 'message') sent.push(c.data as Msg); });
  return sent;
};
const tone = (n: number) => Float32Array.from({ length: n }, (_, i) => Math.sin(i / 10) * 0.5);
const set = (m: Mpc60, id: string, v: number | string | boolean) => (m.control(id) as { set(v: unknown): void }).set(v);

describe('MOA-60 device', () => {
  it('the browser kits are the factory kits the songs pick by number', async () => {
    const { FACTORY_KITS } = await import('../../audio/mpcKits');
    const { FACTORY_KIT_NAMES } = await import('../devices/mpc60');
    expect(FACTORY_KITS.map((k) => k.name)).toEqual([...FACTORY_KIT_NAMES]);
  });

  it('names pads A01 to D16 and maps MIDI notes 36 to 99 onto them', () => {
    expect(padName(0)).toBe('A01');
    expect(padName(17)).toBe('B02');
    expect(padIndex('D16')).toBe(63);
    const m = new Mpc60(new MidiClock());
    const sent = watch(m);
    m.handleMidi({ type: 'noteOn', channel: 11, note: 53, velocity: 127 });
    m.handleMidi({ type: 'noteOn', channel: 3, note: 40, velocity: 127 }); // another channel
    m.handleMidi({ type: 'noteOff', channel: 11, note: 53, velocity: 0 });
    expect(sent.map((s) => [s.type, s.pad])).toEqual([['hit', 17], ['release', 17]]);
  });

  it('keeps sounds in the MPC60 store by default, and can switch one to clean and back', () => {
    const m = new Mpc60(new MidiClock());
    const s = m.addSound('kick', 48000, [tone(4800)]);
    expect(s.rate).toBe(40000);
    expect(s.channels[0]!.length).toBe(4000);
    m.setCharacter(s.id, 'Clean');
    expect(s.rate).toBe(48000);
    expect(s.channels[0]).toBe(s.source.channels[0]);
    expect(m.duration(s.id)).toBeCloseTo(0.1, 9);
  });

  it('pad start and end are in seconds, sent to the voices in frames of the sound as it plays', () => {
    const m = new Mpc60(new MidiClock());
    const s = m.addSound('break', 44100, [tone(44100)]);
    const sent = watch(m);
    m.assign(5, s.id, 0.25, 0.5);
    const pad = sent.find((x) => x.type === 'pad' && x.pad === 5)!;
    expect(pad.settings!.start).toBe(10000);
    expect(pad.settings!.end).toBe(20000);
    m.setCharacter(s.id, 'Clean');
    const again = sent.filter((x) => x.type === 'pad' && x.pad === 5).at(-1)!;
    expect(again.settings!.start).toBe(11025);
  });

  it('the pad controls edit the selected pad, and follow when another pad is selected', () => {
    const m = new Mpc60(new MidiClock());
    set(m, 'pad.select', 'B03');
    set(m, 'pad.tune', -5);
    set(m, 'pad.group', '2');
    expect(m.pads[18]!.tune).toBe(-5);
    expect(m.pads[18]!.group).toBe(2);
    set(m, 'pad.select', 'A01');
    expect(m.control('pad.tune').value).toBe(0);
    expect(m.pads[18]!.tune).toBe(-5); // showing A01 did not write over B03
    set(m, 'pad.select', 'B03');
    expect(m.control('pad.tune').value).toBe(-5);
  });

  it('16 Levels plays the selected pad from all 16 pads, a step further on each', () => {
    const m = new Mpc60(new MidiClock());
    set(m, 'pad.select', 'A04');
    set(m, 'pad.tune', 2);
    const sent = watch(m);
    set(m, 'levels.mode', 'tune');
    m.press(0);
    m.press(15);
    set(m, 'levels.mode', 'velocity');
    m.press(7);
    set(m, 'levels.mode', 'decay');
    m.press(15);
    const hits = sent.filter((s) => s.type === 'hit');
    expect(hits.map((h) => h.pad)).toEqual([3, 3, 3, 3]);
    expect(hits.map((h) => h.over?.tune)).toEqual([-6, 9, undefined, undefined]);
    expect(hits[2]!.velocity).toBe(0.5);
    expect(hits[3]!.over?.decay).toBeCloseTo(DECAY_OFF, 9);
    set(m, 'levels.mode', 'off');
    m.bank = 2;
    m.press(1);
    expect(sent.at(-1)!.pad).toBe(33); // C02
  });

  it('when its worklet starts (after the sounds were loaded), it sends every sound and pad', () => {
    const m = new Mpc60(new MidiClock());
    const s = m.addSound('snare', 40000, [tone(400)]);
    m.assign(0, s.id);
    const sent = watch(m);
    m.circuit.nodeReady('voices');
    expect(sent.filter((x) => x.type === 'sample').map((x) => x.id)).toEqual([s.id]);
    expect(sent.filter((x) => x.type === 'pad')).toHaveLength(64);
  });

  it('a kit saves and loads its pads; a factory kit makes its sounds first', async () => {
    const m = new Mpc60(new MidiClock());
    m.slots = [{ name: 'Test', load: async () => ({ sounds: [{ id: 'k', name: 'kick', rate: 40000, channels: [tone(800)] }], program: { name: 'Test', pads: [{ ...m.pads[0]!, sound: 'k', tune: 3 }] } }) }];
    await m.loadSlot(0);
    expect(m.programName).toBe('Test');
    expect(m.pads[0]!.sound).toBe('k');
    expect(m.sounds.get('k')!.channels[0]!.length).toBe(800);
    expect(m.control('pad.tune').value).toBe(3);
    const saved = m.program();
    m.setPad(0, { tune: 0 });
    m.loadProgram(saved);
    expect(m.pads[0]!.tune).toBe(3);
  });
});

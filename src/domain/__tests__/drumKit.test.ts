import { describe, expect, it } from 'vitest';
import { DrumKit, KIT_PIECES, STRIKE_AT } from '../devices/drumKit';
import { CYMBAL_CUTS, cutCymbal } from '../devices/cymbalSamples';

type Sent = { node: string; type: string; sigma?: number; burst?: number; v?: number[]; delay?: number };
const watch = (k: DrumKit) => {
  const sent: Sent[] = [];
  k.circuit.onChange((c) => { if (c.type === 'message') sent.push({ node: c.nodeId, ...(c.data as { type: string }) }); });
  return sent;
};
const set = (k: DrumKit, id: string, v: number | string) => (k.control(id) as { set(v: number | string): void }).set(v);
const config = (k: DrumKit, piece: string) => JSON.parse(k.circuit.node(piece).options.config!) as Record<string, unknown> & { hz: number[] };
const noteOn = (note: number, velocity = 100) => ({ type: 'noteOn' as const, channel: 10, note, velocity });

describe('MOA-KIT', () => {
  it('comes tuned: kick 55 Hz, snare 210, rack tom 150, floor tom 95, each piece configured on its node', () => {
    const k = new DrumKit();
    expect(k.readout('kick').fundamental.hz).toBeCloseTo(55, 0);
    expect(k.readout('snare').fundamental.hz).toBeCloseTo(210, 0);
    expect(k.readout('tom').fundamental.hz).toBeCloseTo(150, 0);
    expect(k.readout('floor').fundamental.hz).toBeCloseTo(95, 0);
    for (const p of KIT_PIECES) expect(config(k, p).hz.length).toBeGreaterThan(80);
  });

  it('tuning a drum up moves its modes up', () => {
    const k = new DrumKit();
    const before = config(k, 'tom').hz[0]!;
    set(k, 'tom.tension', (k.control('tom.tension').value as number) * 1.4);
    expect(config(k, 'tom').hz[0]!).toBeGreaterThan(before * 1.1);
  });

  it('plays General MIDI drum notes: snare, the ride\'s bell, and the hi-hat\'s pedal', () => {
    const k = new DrumKit();
    const hits: [string, number][] = [];
    k.onHit((p, _v, at) => hits.push([p, at]));
    k.handleMidi(noteOn(38));
    k.handleMidi(noteOn(53));
    k.handleMidi(noteOn(36));
    expect(hits).toEqual([['snare', STRIKE_AT.snare], ['ride', 0.12], ['kick', STRIKE_AT.kick]]);
  });

  it('works the modelled hi-hat: closed damps it, open lets it ring, the pedal chicks and closes it', () => {
    const k = new DrumKit();
    set(k, 'cymbals.source', 'model');
    const sent = watch(k);
    k.handleMidi(noteOn(46));
    expect(k.hatOpen).toBe(1);
    expect(sent.find((m) => m.type === 'damp')!.sigma).toBe(0);
    sent.length = 0;
    k.handleMidi(noteOn(44));
    expect(k.hatOpen).toBe(0);
    expect(sent.find((m) => m.type === 'damp')!.sigma).toBeGreaterThan(200);
    expect(sent.find((m) => m.type === 'hit')!.burst).toBeGreaterThan(0);
    // and an engine built later starts with the hat as it is
    expect((config(k, 'hat').damp as { sigma: number }).sigma).toBeGreaterThan(200);
  });

  it('the snare\'s wires come off with the snares switch', () => {
    const k = new DrumKit();
    expect(config(k, 'snare').wires).toBeDefined();
    set(k, 'snare.on', 'off');
    expect(config(k, 'snare').wires).toBeUndefined();
  });

  it('a heavier cymbal is higher; a harder hit gives more', () => {
    const k = new DrumKit();
    const medium = config(k, 'ride').hz[20]!;
    set(k, 'ride.weight', 'heavy');
    expect(config(k, 'ride').hz[20]!).toBeGreaterThan(medium);
    const sent = watch(k);
    k.hit('snare', 0.3);
    k.hit('snare', 1);
    const [soft, hard] = sent.filter((m) => m.type === 'hit').map((m) => Math.hypot(...m.v!));
    expect(hard!).toBeGreaterThan(soft! * 2);
  });
});

describe('MOA-KIT\'s sampled cymbals', () => {
  it('play from the sampler nodes: the hi-hat closed, open or by its pedal (one choke group), the ride\'s bow or bell', () => {
    const k = new DrumKit();
    const sent = watch(k) as (Sent & { pad?: number })[];
    k.handleMidi(noteOn(42)); k.handleMidi(noteOn(46)); k.handleMidi(noteOn(44)); k.handleMidi(noteOn(51)); k.handleMidi(noteOn(53)); k.handleMidi(noteOn(49));
    expect(sent.filter((m) => m.type === 'hit' && m.node.endsWith('.s')).map((m) => `${m.node}:${m.pad}`)).toEqual(['hat.s:0', 'hat.s:1', 'hat.s:2', 'ride.s:0', 'ride.s:1', 'crash.s:0']);
    // the modelled cymbals are silent under them unless layered
    expect(k.circuit.node('crash').params.level).toBe(0);
    set(k, 'cymbals.layer', 0.5);
    expect(k.circuit.node('crash').params.level).toBe(0.5);
    set(k, 'cymbals.source', 'model');
    expect(k.circuit.node('crash.s').params.level).toBe(0);
  });

  it('send their sounds and pads to the samplers when loaded, the hi-hat\'s pads in one choke group', () => {
    const k = new DrumKit();
    const sent = watch(k) as (Sent & { settings?: { group: number; sample: string } })[];
    k.loadCymbals({ funk: new Float32Array(100), heavy: new Float32Array(100), steady: new Float32Array(100) });
    expect(sent.filter((m) => m.node === 'hat.s' && m.type === 'sample')).toHaveLength(3);
    const hatPads = sent.filter((m) => m.node === 'hat.s' && m.type === 'pad').map((m) => m.settings!);
    expect(hatPads.map((p) => p.group)).toEqual([1, 1, 1]);
    expect(hatPads.map((p) => p.sample)).toEqual(['funk', 'steady', 'heavy']);
  });
});

describe('cutting a cymbal hit out of a break', () => {
  it('fades both ends (no click), takes the low end off (the drums\' ring under it) and brings it to a common level', () => {
    const c = CYMBAL_CUTS.funk;
    const audio = new Float32Array(c.to + 1000);
    for (let i = 0; i < audio.length; i++) audio[i] = 0.05 * Math.sin((2 * Math.PI * 80 * i) / 44100) + 0.05 * Math.sin((2 * Math.PI * 6000 * i) / 44100);
    const hit = cutCymbal(audio, 'funk');
    expect(Math.abs(hit[0]!)).toBeLessThan(1e-3);
    expect(Math.abs(hit.at(-1)!)).toBeLessThan(1e-3);
    expect(Math.max(...hit.map(Math.abs))).toBeCloseTo(0.9, 6);
    // the 80 Hz under it is mostly gone: what is left is nearly all the 6 kHz
    const mid = hit.subarray(2000, 6000);
    let low = 0, all = 0, p = 0;
    for (const v of mid) { p = 0.99 * p + 0.01 * v; low += p * p; all += v * v; }
    expect(low / all).toBeLessThan(0.01);
  });
});

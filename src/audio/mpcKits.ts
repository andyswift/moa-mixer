import type { DrumMachine, DrumVoice } from '../domain/devices/drumMachine';
import { defaultPad, type FactoryKit, type PadSettings, PAD_COUNT, PADS_PER_BANK } from '../domain/devices/mpc60';
import { gridSlices, mixDown, transients } from '../domain/devices/chop';
import busyUrl from '../../samples/gaute/gaute-170-busy.wav?url';
import funkUrl from '../../samples/gaute/gaute-135-funk.wav?url';
import heavyUrl from '../../samples/gaute/gaute-135-heavy.wav?url';
import rollerUrl from '../../samples/gaute/gaute-170-roller.wav?url';
import sparseUrl from '../../samples/gaute/gaute-170-sparse.wav?url';
import steadyUrl from '../../samples/gaute/gaute-135-steady.wav?url';
import { Patch } from '../domain/patch/patch';
import { AudioEngine } from './engine';

/**
 * The MOA-60's factory kits. Nothing is stored: each kit is sampled from the band's own drum machine when it is
 * chosen (rendered offline in a fraction of a second), so the kits can ship with the site.
 */
const RATE = 48000;
const SPACING = 2.5; // seconds between hits in a render
const SILENCE = 0.0005; // -66 dB: where a sound's tail is trimmed

interface Take {
  voice: DrumVoice;
  velocity?: number;
  /** Drum machine settings for this take (e.g. a longer kick). */
  controls?: Record<string, number>;
}

/** Renders each take on its own, from a fresh drum machine, trimmed to where its tail falls silent. */
async function sampleDrums(takes: Take[]): Promise<Float32Array[][]> {
  const out: Float32Array[][] = [];
  // takes with the same settings share a render
  const groups = new Map<string, number[]>();
  takes.forEach((t, i) => {
    const key = JSON.stringify(t.controls ?? {});
    groups.set(key, [...(groups.get(key) ?? []), i]);
  });
  for (const [key, indices] of groups) {
    const patch = Patch.drums();
    const drums = patch.device<DrumMachine>('drums');
    for (const [id, v] of Object.entries(JSON.parse(key) as Record<string, number>)) (drums.control(id) as { set(v: number): void }).set(v);
    const buffer = await AudioEngine.render(patch, SPACING * indices.length, RATE, () => {
      indices.forEach((ti, n) => drums.trigger(takes[ti]!.voice, takes[ti]!.velocity ?? 1, 0.01 + n * SPACING));
    });
    indices.forEach((ti, n) => {
      const from = Math.round((0.01 + n * SPACING) * RATE), to = Math.round((0.01 + (n + 1) * SPACING) * RATE) - 1;
      out[ti] = trim([0, 1].map((c) => buffer.getChannelData(Math.min(c, buffer.numberOfChannels - 1)).slice(from, to)));
    });
  }
  return out;
}

/** Cuts the silence after a sound (with a 5 ms fade at the cut). */
function trim(channels: Float32Array[]): Float32Array[] {
  let end = channels[0]!.length;
  while (end > 1 && channels.every((c) => Math.abs(c[end - 1]!) < SILENCE)) end--;
  const fade = Math.min(end, Math.round(0.005 * RATE));
  return channels.map((c) => {
    const x = c.slice(0, end);
    for (let i = 0; i < fade; i++) x[end - 1 - i]! *= i / fade;
    return x;
  });
}

/** An original two-bar break on the drum machine, 92 bpm with a loose swing: kicks, snares, ghost notes and hats. */
async function sampleBreak(): Promise<{ channels: Float32Array[]; bpm: number }> {
  const bpm = 92, sixteenth = 60 / bpm / 4, swing = 0.58;
  const at = (step: number) => 0.01 + step * sixteenth + (step % 2 === 1 ? (2 * swing - 1) * sixteenth : 0);
  const hits: [DrumVoice, number, number][] = [];
  const bar = (b: number, kicks: number[], ghosts: number[], open: number) => {
    const o = b * 16;
    for (const s of kicks) hits.push(['kick', o + s, s === 0 ? 1 : 0.85]);
    hits.push(['snare', o + 4, 1], ['snare', o + 12, 0.95]);
    for (const s of ghosts) hits.push(['snare', o + s, 0.28]);
    for (let s = 0; s < 16; s += 2) if (s !== open) hits.push(['closedHat', o + s, s % 4 === 0 ? 0.85 : 0.6]);
    for (const s of [3, 11]) hits.push(['closedHat', o + s, 0.35]);
    hits.push(['openHat', o + open, 0.7]);
  };
  bar(0, [0, 6, 10], [7, 9, 15], 14);
  bar(1, [0, 3, 10, 11], [1, 7, 13], 6);
  const patch = Patch.drums();
  const drums = patch.device<DrumMachine>('drums');
  (drums.control('kick.decay') as { set(v: number): void }).set(0.3);
  (drums.control('snare.decay') as { set(v: number): void }).set(0.22);
  const seconds = 32 * sixteenth;
  const buffer = await AudioEngine.render(patch, seconds + 0.01, RATE, () => {
    for (const [voice, step, velocity] of hits) drums.trigger(voice, velocity, at(step));
  });
  return { channels: [0, 1].map((c) => buffer.getChannelData(Math.min(c, buffer.numberOfChannels - 1)).slice(Math.round(0.01 * RATE))), bpm };
}

const pad = (sound: string, settings: Partial<PadSettings> = {}): PadSettings => ({ ...defaultPad(), sound, ...settings });

/** MOA Drums 60: the drum machine sampled into bank A, and the MOA Break cut across bank B. */
const moaDrums60: FactoryKit = {
  name: 'MOA Drums 60',
  async load() {
    const takes: (Take & { id: string; name: string; pad?: Partial<PadSettings> })[] = [
      { id: 'f.kick', name: 'Kick', voice: 'kick' },
      { id: 'f.snare', name: 'Snare', voice: 'snare' },
      { id: 'f.clap', name: 'Clap', voice: 'clap' },
      { id: 'f.rim', name: 'Rim', voice: 'rim' },
      { id: 'f.chat', name: 'Closed hat', voice: 'closedHat', pad: { group: 1 } },
      { id: 'f.ohat', name: 'Open hat', voice: 'openHat', pad: { group: 1 } },
      { id: 'f.ride', name: 'Ride', voice: 'ride' },
      { id: 'f.crash', name: 'Crash', voice: 'crash' },
      { id: 'f.ltom', name: 'Low tom', voice: 'lowTom' },
      { id: 'f.mtom', name: 'Mid tom', voice: 'midTom' },
      { id: 'f.htom', name: 'High tom', voice: 'highTom' },
      { id: 'f.bell', name: 'Cowbell', voice: 'cowbell' },
      { id: 'f.boom', name: 'Boom kick', voice: 'kick', controls: { 'kick.tune': 40, 'kick.decay': 0.9, 'kick.click': 0.15 } },
      { id: 'f.crack', name: 'Crack snare', voice: 'snare', controls: { 'snare.tune': 260, 'snare.decay': 0.12, 'snare.snap': 1 } },
    ];
    const rendered = await sampleDrums(takes);
    const brk = await sampleBreak();
    const sounds = takes.map((t, i) => ({ id: t.id, name: t.name, rate: RATE, channels: rendered[i]! }));
    sounds.push({ id: 'f.break', name: 'MOA Break 92', rate: RATE, channels: brk.channels });
    const pads: PadSettings[] = Array.from({ length: PAD_COUNT }, defaultPad);
    takes.forEach((t, i) => { pads[i] = pad(t.id, t.pad); });
    pads[14] = pad('f.snare', { reverse: true }); // a reversed snare into the next bar
    pads[15] = pad('f.clap', { tune: -5 });
    // bank B: the break cut at its hits; B16 is the whole loop
    const starts = transients(mixDown(brk.channels), RATE, 0.5, PADS_PER_BANK - 1);
    const length = brk.channels[0]!.length / RATE;
    starts.forEach((s, i) => {
      pads[PADS_PER_BANK + i] = pad('f.break', { start: s / RATE, end: (starts[i + 1] ?? brk.channels[0]!.length) / RATE, group: 2 });
    });
    pads[2 * PADS_PER_BANK - 1] = pad('f.break', { start: 0, end: length, group: 2 });
    return { sounds, program: { name: 'MOA Drums 60', pads } };
  },
};

/**
 * Gaute's breaks: two-bar loops cut from live drum recordings (at 170 and at 135 bpm), every one tuned to play at
 * exactly 170 (the 135s up about four semitones, as jungle has always done), and the main ones cut in eighths, each
 * cut on the stroke nearest it. A bank's slices cut each other off.
 *   A: the 170 roller in eighths. B: the 135 funk break in eighths. C: the 135 heavy break in eighths.
 *   D01-D06: the six loops whole (they cut each other). D09-D16: the first bar of the busy 170 loop in eighths.
 */
export const KIT_TEMPO = 170;
const BREAKS = [
  { id: 'g.roller', name: 'Gaute 170 roller', url: rollerUrl },
  { id: 'g.funk', name: 'Gaute 135 funk', url: funkUrl },
  { id: 'g.heavy', name: 'Gaute 135 heavy', url: heavyUrl },
  { id: 'g.busy', name: 'Gaute 170 busy', url: busyUrl },
  { id: 'g.sparse', name: 'Gaute 170 sparse', url: sparseUrl },
  { id: 'g.steady', name: 'Gaute 135 steady', url: steadyUrl },
] as const;
const LOOP_BEATS = 8; // every loop is two bars
const GAUTE_LEVEL = 1.5;

const gauteBreaks: FactoryKit = {
  name: 'Gaute Breaks',
  async load() {
    const decoder = new OfflineAudioContext(2, 1, 44100);
    const loops = await Promise.all(BREAKS.map(async (b) => {
      const buffer = await decoder.decodeAudioData(await (await fetch(b.url)).arrayBuffer());
      const channels = Array.from({ length: Math.min(2, buffer.numberOfChannels) }, (_, c) => buffer.getChannelData(c).slice());
      const seconds = buffer.length / buffer.sampleRate;
      // the loop's own tempo, and the tune that plays it at the kit's tempo
      const tune = 12 * Math.log2(KIT_TEMPO / ((60 * LOOP_BEATS) / seconds));
      return { ...b, rate: buffer.sampleRate, channels, seconds, tune };
    }));
    const pads: PadSettings[] = Array.from({ length: PAD_COUNT }, defaultPad);
    const chop = (loop: (typeof loops)[number], first: number, count: number, group: number, slices = 16) => {
      const cuts = gridSlices(mixDown(loop.channels), loop.rate, slices).map((f) => f / loop.rate);
      for (let i = 0; i < count; i++) pads[first + i] = pad(loop.id, { start: cuts[i]!, end: cuts[i + 1] ?? loop.seconds, tune: loop.tune, group, level: GAUTE_LEVEL });
    };
    chop(loops[0]!, 0, 16, 2);
    chop(loops[1]!, PADS_PER_BANK, 16, 3);
    chop(loops[2]!, 2 * PADS_PER_BANK, 16, 4);
    // live overheads sit well under their peaks (and these are mono, panned to the centre), so the pads play loud
    loops.forEach((l, i) => { pads[3 * PADS_PER_BANK + i] = pad(l.id, { start: 0, end: l.seconds, tune: l.tune, group: 1, level: GAUTE_LEVEL }); });
    chop(loops[3]!, 3 * PADS_PER_BANK + 8, 8, 5);
    return {
      sounds: loops.map((l) => ({ id: l.id, name: l.name, rate: l.rate, channels: l.channels })),
      program: { name: 'Gaute Breaks', pads },
    };
  },
};

export const FACTORY_KITS: readonly FactoryKit[] = [moaDrums60, gauteBreaks];

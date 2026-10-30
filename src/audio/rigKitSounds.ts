import { newPad, padSoundId, RIG_PADS, type RigKit, type RigPad } from '../domain/devices/rigKit';
import { PADS_PER_BANK, type PadSettings } from '../domain/devices/mpc60';
import type { RigKitSound } from '../domain/devices/rigSynth';
import { FACTORY_KITS, sampleDrums, type Take } from './mpcKits';

/**
 * Where the MOA-RIG's kits get their sounds, in the browser: analogue pads are rendered from the MOA-DR with the pad's
 * knobs (renders asked for together are made together), samples come from the MOA-60's factory kits (each made or
 * fetched once, when first needed).
 */
const RATE = 48000;

type FactorySounds = Map<string, RigKitSound>;
const factory = new Map<string, Promise<{ sounds: FactorySounds; pads: PadSettings[] }>>();
function loadFactory(name: string) {
  let p = factory.get(name);
  if (!p) {
    const kit = FACTORY_KITS.find((k) => k.name === name);
    p = kit
      ? kit.load().then(({ sounds, program }) => ({ sounds: new Map(sounds.map((s) => [s.id, { rate: s.rate, channels: s.channels }])), pads: program.pads }))
      : Promise.reject(new Error(`no factory kit ${name}`));
    factory.set(name, p);
  }
  return p;
}

let batch: { take: Take; resolve: (s: RigKitSound | undefined) => void }[] = [];
function render(pad: RigPad): Promise<RigKitSound | undefined> {
  return new Promise((resolve) => {
    if (!batch.length) {
      setTimeout(() => {
        const now = batch;
        batch = [];
        sampleDrums(now.map((b) => b.take)).then(
          (out) => now.forEach((b, i) => b.resolve({ rate: RATE, channels: out[i]! })),
          () => now.forEach((b) => b.resolve(undefined)),
        );
      }, 0);
    }
    batch.push({ take: { voice: pad.voice, velocity: 1, controls: pad.analog }, resolve });
  });
}

const renders = new Map<string, Promise<RigKitSound | undefined>>();
/** Renders kept, so a worklet built again (or a knob turned back) does not render them again. */
const KEEP_RENDERS = 64;

/** A pad's sound: rendered from the MOA-DR, or the factory kit's sample (`<kit>/<sound id>`). */
export async function rigKitSound(pad: RigPad): Promise<RigKitSound | undefined> {
  if (pad.src === 'analog') {
    const id = padSoundId(pad);
    let r = renders.get(id);
    if (!r) {
      r = render(pad);
      renders.set(id, r);
      if (renders.size > KEEP_RENDERS) renders.delete(renders.keys().next().value!);
    }
    return r;
  }
  const at = pad.sound.lastIndexOf('/');
  if (at < 0) return undefined;
  try {
    return (await loadFactory(pad.sound.slice(0, at))).sounds.get(pad.sound.slice(at + 1));
  } catch {
    return undefined;
  }
}

/** The samples a pad can play (by id, with a name), for the pad editor. */
export const RIG_SAMPLES: readonly [id: string, name: string][] = [
  ['MOA Drums 60/f.break', 'MOA Break 92'],
  ['Gaute Breaks/g.roller', 'Gaute 170 roller'],
  ['Gaute Breaks/g.funk', 'Gaute 135 funk'],
  ['Gaute Breaks/g.heavy', 'Gaute 135 heavy'],
  ['Gaute Breaks/g.busy', 'Gaute 170 busy'],
  ['Gaute Breaks/g.sparse', 'Gaute 170 sparse'],
  ['Gaute Breaks/g.steady', 'Gaute 135 steady'],
];

/** Kits cut from a bank of a MOA-60 factory kit: its sixteen pads, slices of a break. */
export const RIG_BREAK_KITS: readonly { name: string; kit: string; bank: number }[] = [
  { name: 'MOA Break', kit: 'MOA Drums 60', bank: 1 },
  { name: 'Gaute Roller', kit: 'Gaute Breaks', bank: 0 },
  { name: 'Gaute Funk', kit: 'Gaute Breaks', bank: 1 },
  { name: 'Gaute Heavy', kit: 'Gaute Breaks', bank: 2 },
];

export async function loadBreakKit(name: string): Promise<RigKit | undefined> {
  const def = RIG_BREAK_KITS.find((k) => k.name === name);
  if (!def) return undefined;
  const { pads } = await loadFactory(def.kit);
  return {
    name: def.name,
    pads: Array.from({ length: RIG_PADS }, (_, i) => {
      const p = pads[def.bank * PADS_PER_BANK + i];
      if (!p?.sound) return newPad('kick', { name: String(i + 1), src: 'sample', sound: '' });
      return newPad('kick', {
        name: String(i + 1), src: 'sample', sound: `${def.kit}/${p.sound}`, start: p.start, end: p.end, tune: p.tune,
        decay: p.decay, level: p.level, pan: p.pan, cutoff: p.cutoff, reso: p.reso, group: p.group, reverse: p.reverse,
      });
    }),
  };
}

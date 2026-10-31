import { newStep, type RigPattern, type RigStep, type RigTrack } from '../sequencer/rigSequencer';
import { sanitiseMulti, type RigMulti, type RigMultiPart } from './rigMulti';

/**
 * A tune to share: a multi packed to travel between computers, as a file or inside a link. A multi is all there is
 * to a tune (every part's sound and kit, the patterns, the chain, the tempo, the mix; kits name their sounds rather
 * than carry them), but most of it is empty steps: packing leaves out every step, track and pattern that is as a new
 * one is, and unpacking puts them back through `sanitiseMulti`, which also makes any file or link safe to load.
 *
 * A link carries the packed tune deflated and in base64url after `#tune=` (the part of a URL never sent to a server).
 */
export const RIG_SHARE_APP = 'moa-rig';
export const RIG_SHARE_VERSION = 1;
export const RIG_LINK_KEY = 'tune';
/** The most a tune may unpack to (a full multi is about 1.3 MB): a link that inflates past it is refused. */
const MAX_BYTES = 4_000_000;

export interface RigShared {
  app: typeof RIG_SHARE_APP;
  v: number;
  multi: unknown;
}

const BLANK_STEP = JSON.stringify(newStep());
const isBlankStep = (s: RigStep) => JSON.stringify(s) === BLANK_STEP;
const isBlankTrack = (t: RigTrack) =>
  t.length === 16 && t.clock === 24 && t.direction === 'fwd' && t.prob === 1 && !t.muted && !t.solo && t.steps.every(isBlankStep);
const isBlankPattern = (p: RigPattern) => p.length === 64 && p.tracks.every(isBlankTrack);

/** Nulls where things are as new (the sanitiser fills them back in), with the trailing ones dropped. */
function sparse<T, U>(items: T[], blank: (x: T) => boolean, pack: (x: T) => U): (U | null)[] {
  const out = items.map((x) => (blank(x) ? null : pack(x)));
  while (out.length && out[out.length - 1] === null) out.pop();
  return out;
}

/** Only the fields that differ from a default (the sanitiser fills the rest back in). */
function changed<T extends object>(x: T, def: T): Partial<T> {
  const out: Partial<T> = {};
  for (const k of Object.keys(x) as (keyof T)[]) if (JSON.stringify(x[k]) !== JSON.stringify(def[k])) out[k] = x[k];
  return out;
}
const STEP = newStep();
const TRACK = { length: 16, clock: 24, direction: 'fwd', prob: 1, muted: false, solo: false };

/** A multi as a tune to share. */
export function packMulti(m: RigMulti): RigShared {
  const patterns = sparse(m.patterns, isBlankPattern, (p) => ({
    length: p.length,
    tracks: sparse(p.tracks, isBlankTrack, ({ steps, ...t }) => ({
      ...changed(t, TRACK as Omit<RigTrack, 'steps'>), steps: sparse(steps, isBlankStep, (s) => changed(s, STEP)),
    })),
  }));
  return { app: RIG_SHARE_APP, v: RIG_SHARE_VERSION, multi: { ...m, patterns } };
}

/** A shared tune back as a multi, or undefined when it is not one (another app's file, damaged, too new). */
export function unpackMulti(raw: unknown, defaults: (part: number) => RigMultiPart): RigMulti | undefined {
  if (typeof raw !== 'object' || raw === null) return undefined;
  const r = raw as Partial<RigShared>;
  if (r.app !== RIG_SHARE_APP || typeof r.v !== 'number' || r.v > RIG_SHARE_VERSION) return undefined;
  return sanitiseMulti(r.multi, defaults);
}

/** A shared tune as a file's text. */
export const tuneFile = (m: RigMulti): string => JSON.stringify(packMulti(m));
/** A file's text back as a multi (undefined when it is not a tune). */
export function readTuneFile(text: string, defaults: (part: number) => RigMultiPart): RigMulti | undefined {
  if (text.length > MAX_BYTES) return undefined;
  try {
    return unpackMulti(JSON.parse(text), defaults);
  } catch {
    return undefined;
  }
}
/** A name for a tune's file: `dark-room.moarig.json`. */
export const tuneFileName = (m: RigMulti): string =>
  `${m.name.toLowerCase().normalize('NFKD').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'tune'}.moarig.json`;

// ---- links: deflate (the browser's own), base64url

const toBase64Url = (bytes: Uint8Array): string => {
  let bin = '';
  for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
};
const fromBase64Url = (text: string): Uint8Array<ArrayBuffer> => {
  const bin = atob(text.replace(/-/g, '+').replace(/_/g, '/'));
  return Uint8Array.from(bin, (c) => c.charCodeAt(0));
};

async function deflate(text: string): Promise<Uint8Array> {
  const stream = new Blob([text]).stream().pipeThrough(new CompressionStream('deflate-raw'));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}
/** Inflates, giving up past MAX_BYTES (so a crafted link cannot fill the memory). */
async function inflate(bytes: Uint8Array<ArrayBuffer>): Promise<string | undefined> {
  const reader = new Blob([bytes]).stream().pipeThrough(new DecompressionStream('deflate-raw')).getReader();
  const parts: Uint8Array[] = [];
  let size = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.length;
    if (size > MAX_BYTES) { await reader.cancel(); return undefined; }
    parts.push(value);
  }
  const all = new Uint8Array(size);
  let at = 0;
  for (const p of parts) { all.set(p, at); at += p.length; }
  return new TextDecoder().decode(all);
}

/** The `#tune=…` part of a link to a multi. */
export async function tuneHash(m: RigMulti): Promise<string> {
  return `#${RIG_LINK_KEY}=${toBase64Url(await deflate(tuneFile(m)))}`;
}
/** Whether a URL's hash carries a tune. */
export const hasTune = (hash: string): boolean => hash.startsWith(`#${RIG_LINK_KEY}=`);
/** The multi a link's hash carries, or undefined when it carries none (or a damaged one). */
export async function tuneFromHash(hash: string, defaults: (part: number) => RigMultiPart): Promise<RigMulti | undefined> {
  if (!hasTune(hash)) return undefined;
  try {
    const text = await inflate(fromBase64Url(hash.slice(RIG_LINK_KEY.length + 2)));
    return text === undefined ? undefined : readTuneFile(text, defaults);
  } catch {
    return undefined;
  }
}

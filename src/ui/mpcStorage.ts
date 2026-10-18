import type { Character, PadSettings, Program } from '../domain/devices/mpc60';
import type { Sequence, Timing } from '../domain/sequencer/mpcSequencer';

/**
 * The MOA-60's own storage, in this browser only (IndexedDB): imported sounds as they came in, saved kits, and the
 * session (the kit and sequences on the machine, restored on the next visit). Nothing is uploaded. A kit can be
 * exported to a file with its sounds, to move it to another browser.
 */
const DB_NAME = 'moa-60';
const VERSION = 1;

export interface StoredSound {
  id: string;
  name: string;
  character: Character;
  rate: number;
  channels: Float32Array[];
}

export interface Session {
  program: Program;
  sounds: string[];
  sequencer: { sequences: Sequence[]; current: number; tempo: number; swing: number; timing: Timing; metronome: boolean; countIn: boolean };
}

function open(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      db.createObjectStore('sounds', { keyPath: 'id' });
      db.createObjectStore('kits', { keyPath: 'name' });
      db.createObjectStore('session');
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error ?? new Error('IndexedDB unavailable'));
  });
}

let db: Promise<IDBDatabase> | undefined;
const database = () => (db ??= open());

async function run<T>(store: string, mode: IDBTransactionMode, fn: (s: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  const d = await database();
  return new Promise((resolve, reject) => {
    const req = fn(d.transaction(store, mode).objectStore(store));
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error ?? new Error(`IndexedDB ${store} failed`));
  });
}

export const saveSound = (s: StoredSound) => run('sounds', 'readwrite', (st) => st.put(s));
export const loadSound = (id: string) => run<StoredSound | undefined>('sounds', 'readonly', (st) => st.get(id) as IDBRequest<StoredSound | undefined>);
export const deleteSound = (id: string) => run('sounds', 'readwrite', (st) => st.delete(id));
export const listSounds = () => run<StoredSound[]>('sounds', 'readonly', (st) => st.getAll() as IDBRequest<StoredSound[]>);

export const saveKit = (p: Program) => run('kits', 'readwrite', (st) => st.put(p));
export const loadKit = (name: string) => run<Program | undefined>('kits', 'readonly', (st) => st.get(name) as IDBRequest<Program | undefined>);
export const deleteKit = (name: string) => run('kits', 'readwrite', (st) => st.delete(name));
export const kitNames = () => run<IDBValidKey[]>('kits', 'readonly', (st) => st.getAllKeys()).then((k) => k.map(String));

export const saveSession = (s: Session) => run('session', 'readwrite', (st) => st.put(s, 'current'));
export const loadSession = () => run<Session | undefined>('session', 'readonly', (st) => st.get('current') as IDBRequest<Session | undefined>);

// ---- kit files: the kit and its sounds (16-bit, as the MPC60's disks held them at 12), as JSON

interface KitFile {
  format: 'moa-60-kit';
  version: 1;
  program: Program;
  sounds: { id: string; name: string; character: Character; rate: number; channels: string[] }[];
}

const toBase64 = (x: Float32Array): string => {
  const pcm = new Int16Array(x.length);
  for (let i = 0; i < x.length; i++) pcm[i] = Math.max(-32768, Math.min(32767, Math.round(x[i]! * 32767)));
  const bytes = new Uint8Array(pcm.buffer);
  let s = '';
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(s);
};
const fromBase64 = (b: string): Float32Array => {
  const bin = atob(b);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  const pcm = new Int16Array(bytes.buffer);
  return Float32Array.from(pcm, (v) => v / 32767);
};

export function exportKit(program: Program, sounds: StoredSound[]): Blob {
  const file: KitFile = {
    format: 'moa-60-kit', version: 1, program,
    sounds: sounds.map((s) => ({ id: s.id, name: s.name, character: s.character, rate: s.rate, channels: s.channels.map(toBase64) })),
  };
  return new Blob([JSON.stringify(file)], { type: 'application/json' });
}

export async function importKit(file: Blob): Promise<{ program: Program; sounds: StoredSound[] }> {
  const data = JSON.parse(await file.text()) as KitFile;
  if (data.format !== 'moa-60-kit') throw new Error('Not a MOA-60 kit file');
  return {
    program: { name: data.program.name, pads: data.program.pads.map((p: PadSettings) => ({ ...p })) },
    sounds: data.sounds.map((s) => ({ id: s.id, name: s.name, character: s.character, rate: s.rate, channels: s.channels.map(fromBase64) })),
  };
}

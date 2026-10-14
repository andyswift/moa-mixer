/**
 * An in-browser MIDI bus between tabs of the same site: raw MIDI bytes with a due time, over a BroadcastChannel.
 * The sender stamps each message with the wall-clock time it should sound (a little ahead); receivers hold it
 * until then, so network-free jitter between tabs is absorbed by the look-ahead. Receivers do not need a MIDI
 * device or any setup, and treat the bus like a MIDI input (same `onMessage` shape as `WebMidi`).
 */
export interface BusMessage {
  /** Wall-clock due time (ms since the epoch). */
  at: number;
  data: number[];
}

interface ChannelLike {
  postMessage(m: BusMessage): void;
  onmessage: ((e: { data: BusMessage }) => void) | null;
  close(): void;
}

const STORAGE_KEY = 'moa.midiBus';

/** Wall-clock milliseconds on a clock all tabs share. */
export const epochNow = (): number => performance.timeOrigin + performance.now();

export class MidiBus {
  /** Listening for messages from other tabs; remembered per browser. */
  enabled: boolean;
  /** Raw bytes with a performance.now() timestamp, like WebMidi. */
  onMessage?: (data: Uint8Array, timeStamp: number) => void;
  lastSeen = 0;
  private readonly channel?: ChannelLike;
  private readonly listeners = new Set<() => void>();

  constructor(
    name = 'moa-midi',
    private readonly now: () => number = epochNow,
    private readonly later: (fn: () => void, ms: number) => unknown = (fn, ms) => setTimeout(fn, ms),
    channelFactory?: (name: string) => ChannelLike,
  ) {
    this.enabled = readEnabled();
    const make = channelFactory ?? (typeof BroadcastChannel === 'undefined' ? undefined : (n: string) => new BroadcastChannel(n) as unknown as ChannelLike);
    this.channel = make?.(name);
    if (this.channel) {
      this.channel.onmessage = (e) => {
        if (!this.enabled) return;
        const { at, data } = e.data;
        if (!Array.isArray(data) || typeof at !== 'number') return;
        this.lastSeen = performance.now();
        const wait = at - this.now();
        const deliver = () => this.onMessage?.(Uint8Array.from(data), performance.now());
        if (wait <= 1) deliver();
        else this.later(deliver, wait);
      };
    }
  }

  get supported(): boolean {
    return this.channel !== undefined;
  }

  /** Sends MIDI to the other tabs, due at `at` (wall-clock ms; default now). */
  send(data: ArrayLike<number>, at = this.now()): void {
    this.channel?.postMessage({ at, data: Array.from(data) });
  }

  setEnabled(on: boolean): void {
    this.enabled = on;
    try {
      localStorage.setItem(STORAGE_KEY, on ? '1' : '0');
    } catch {
      // not remembered
    }
    for (const l of this.listeners) l();
  }

  onChange(fn: () => void): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  close(): void {
    this.channel?.close();
  }
}

function readEnabled(): boolean {
  try {
    return localStorage.getItem(STORAGE_KEY) !== '0';
  } catch {
    return true;
  }
}

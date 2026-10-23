import { PCM_RECV, PCM_SEND, PCM_SOURCE } from './pcmWorklet';

/**
 * The audio bus over raw PCM: a worklet in the publishing tab posts 10 ms chunks, they cross to other tabs on a
 * BroadcastChannel, and a worklet in the subscribing tab plays them out of a jitter buffer. Lossless, no network
 * stack, same-origin only.
 *
 * One bus (one per tab) can publish any number of named ports (a drum machine publishes one per voice) and subscribe
 * to any number of other tabs' ports. A publisher only sends chunks while at least one tab is listening to that port.
 */
export type Msg =
  | { type: 'hello'; from: string }
  | { type: 'announce'; from: string; port: string; name: string }
  | { type: 'bye'; from: string; port?: string }
  | { type: 'listen' | 'unlisten'; from: string; port: string }
  | { type: 'pcm'; from: string; port: string; rate: number; l: Float32Array; r: Float32Array };

export interface ChannelLike {
  postMessage(m: Msg): void;
  onmessage: ((e: { data: Msg }) => void) | null;
  close(): void;
}

export interface RemotePort {
  id: string;
  name: string;
}

/** What the receiving worklet reports: milliseconds buffered, and counts of underruns and overflows so far. */
export interface PcmStats {
  fill: number;
  underruns: number;
  drops: number;
}

export interface PcmReceived {
  /** Connect this into the graph. */
  node: AudioWorkletNode;
  stats(): PcmStats;
  close(): void;
}

/** A published port, from the publisher's side. */
export interface Outlet {
  id: string;
  /** Sends one chunk to whoever is listening (a no-op when nobody is). */
  send(l: Float32Array, r: Float32Array, rate: number): void;
  /** True while at least one tab is listening. */
  readonly listened: boolean;
  close(): void;
}

/** Jitter buffer for send/return links to effect pages: the round trip is then about 40 ms (30 ms gives about 68). */
export const FX_JITTER_MS = 14;
/**
 * Inside the records or band page (`?embed=1`) nobody plays live: the notes are sent ahead, so a deeper buffer costs
 * nothing but a fixed delay, the same for everyone, and it rides out the main thread's hiccups (every link travels
 * through it; a hiccup longer than the buffer is a dropout). Instruments into the mixer, and each leg to an effect.
 */
export const EMBEDDED_JITTER_MS = 90;
export const EMBEDDED_FX_JITTER_MS = 80;
/** A send and return's round trip: two legs plus the chunks in flight (about 12 ms, measured at 14 ms legs: 40). */
export const fxRoundTripMs = (legMs: number): number => 2 * legMs + 12;

const loaded = new WeakSet<BaseAudioContext>();

async function loadWorklet(ctx: AudioContext): Promise<void> {
  if (loaded.has(ctx)) return;
  const url = URL.createObjectURL(new Blob([PCM_SOURCE], { type: 'text/javascript' }));
  await ctx.audioWorklet.addModule(url);
  loaded.add(ctx);
}

const randomId = (): string => Math.random().toString(36).slice(2, 10);

export class PcmBus {
  readonly id = randomId();
  private readonly channel?: ChannelLike;
  /** Ports other tabs publish, by port id. */
  private readonly remote = new Map<string, { owner: string; name: string }>();
  private readonly listeners = new Set<() => void>();
  private readonly audienceListeners = new Set<() => void>();
  /** Ports this tab publishes: the set of tabs listening to each. */
  private readonly outlets = new Map<string, { name: string; audience: Set<string>; stop?: () => void; listening?: (on: boolean) => void }>();
  /** Ports this tab listens to, and where to put their chunks. */
  private readonly sinks = new Map<string, (m: Extract<Msg, { type: 'pcm' }>) => void>();
  /** What every subscription made here reports now, by port name (to see where the audio drops out). */
  private readonly receiving = new Map<PcmReceived, string>();

  constructor(name = 'moa-audio-pcm', channelFactory?: (name: string) => ChannelLike) {
    const make = channelFactory ?? (typeof BroadcastChannel === 'undefined' ? undefined : (n: string) => new BroadcastChannel(n) as unknown as ChannelLike);
    this.channel = make?.(name);
    if (this.channel) {
      this.channel.onmessage = (e) => this.handle(e.data);
      this.send({ type: 'hello', from: this.id });
      // A closing tab leaves the bus, so other tabs see its ports go.
      if (typeof window !== 'undefined') window.addEventListener('pagehide', (e) => { if (!e.persisted) this.close(); });
    }
  }

  get supported(): boolean {
    return this.channel !== undefined && typeof AudioWorkletNode !== 'undefined';
  }

  /** Ports other tabs are publishing right now. */
  get ports(): RemotePort[] {
    return [...this.remote].map(([id, p]) => ({ id, name: p.name }));
  }

  /** How many tabs are listening to ports this tab publishes (a tab counts once per port). */
  get audience(): number {
    let n = 0;
    for (const o of this.outlets.values()) n += o.audience.size;
    return n;
  }

  /** Opens a port on the bus; `send` pushes audio into it. The lower level under `publish`. */
  openOutlet(name: string): Outlet {
    const id = randomId();
    const entry: { name: string; audience: Set<string>; stop?: () => void; listening?: (on: boolean) => void } = { name, audience: new Set() };
    this.outlets.set(id, entry);
    this.send({ type: 'announce', from: this.id, port: id, name });
    return {
      id,
      get listened() { return entry.audience.size > 0; },
      send: (l, r, rate) => {
        if (entry.audience.size > 0) this.send({ type: 'pcm', from: this.id, port: id, rate, l, r });
      },
      close: () => {
        if (!this.outlets.delete(id)) return;
        entry.stop?.();
        this.send({ type: 'bye', from: this.id, port: id });
        this.audienceChanged();
      },
    };
  }

  /** Receives a port's chunks. Returns a function that stops listening. The lower level under `subscribe`. */
  listen(portId: string, onChunk: (rate: number, l: Float32Array, r: Float32Array) => void): () => void {
    this.sinks.set(portId, (m) => onChunk(m.rate, m.l, m.r));
    this.send({ type: 'listen', from: this.id, port: portId });
    return () => {
      if (!this.sinks.delete(portId)) return;
      this.send({ type: 'unlisten', from: this.id, port: portId });
    };
  }

  /** Makes the output of `node` available to other tabs as `name`. Returns a function that withdraws it. */
  async publish(ctx: AudioContext, node: AudioNode, name: string): Promise<() => void> {
    await loadWorklet(ctx);
    const tap = new AudioWorkletNode(ctx, PCM_SEND, { numberOfInputs: 1, numberOfOutputs: 1, outputChannelCount: [2], channelCount: 2, channelCountMode: 'explicit' });
    const mute = ctx.createGain(); // the worklet only runs while it is connected towards the destination
    mute.gain.value = 0;
    node.connect(tap);
    tap.connect(mute).connect(ctx.destination);
    const outlet = this.openOutlet(name);
    tap.port.onmessage = (e: MessageEvent<{ l: Float32Array; r: Float32Array }>) => outlet.send(e.data.l, e.data.r, ctx.sampleRate);
    this.outlets.get(outlet.id)!.listening = (on) => tap.port.postMessage({ active: on });
    this.outlets.get(outlet.id)!.stop = () => {
      node.disconnect(tap);
      tap.disconnect();
      mute.disconnect();
      tap.port.onmessage = null;
    };
    return outlet.close;
  }

  /** Starts playing a published port into a new worklet node. `targetMs` is the jitter buffer to hold. */
  async subscribe(ctx: AudioContext, portId: string, targetMs = 30): Promise<PcmReceived> {
    await loadWorklet(ctx);
    const node = new AudioWorkletNode(ctx, PCM_RECV, {
      numberOfInputs: 0, numberOfOutputs: 1, outputChannelCount: [2],
      processorOptions: { targetMs, capacityMs: 400 },
    });
    let stats: PcmStats = { fill: 0, underruns: 0, drops: 0 };
    node.port.onmessage = (e: MessageEvent<PcmStats>) => { stats = e.data; };
    const stop = this.listen(portId, (rate, l, r) => node.port.postMessage({ rate, l, r }, [l.buffer, r.buffer]));
    const received: PcmReceived = {
      node,
      stats: () => stats,
      close: () => {
        stop();
        node.disconnect();
        node.port.onmessage = null;
        this.receiving.delete(received);
      },
    };
    this.receiving.set(received, this.remote.get(portId)?.name ?? portId);
    return received;
  }

  /** Each subscription's buffer and its underruns and overflows so far, by the port's name. */
  receiveStats(): { name: string; stats: PcmStats }[] {
    return [...this.receiving].map(([r, name]) => ({ name, stats: r.stats() }));
  }

  onChange(fn: () => void): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  /** Called when the number of tabs listening to this tab's ports changes. */
  onAudience(fn: () => void): () => void {
    this.audienceListeners.add(fn);
    return () => this.audienceListeners.delete(fn);
  }

  close(): void {
    for (const portId of [...this.sinks.keys()]) this.send({ type: 'unlisten', from: this.id, port: portId });
    this.sinks.clear();
    for (const o of this.outlets.values()) o.stop?.();
    this.outlets.clear();
    this.send({ type: 'bye', from: this.id });
    this.channel?.close();
  }

  private emit(): void {
    for (const l of this.listeners) l();
  }

  private audienceChanged(): void {
    for (const l of this.audienceListeners) l();
  }

  private send(m: Msg): void {
    this.channel?.postMessage(m);
  }

  private handle(m: Msg): void {
    if (m.from === this.id) return;
    switch (m.type) {
      case 'hello':
        for (const [port, o] of this.outlets) this.send({ type: 'announce', from: this.id, port, name: o.name });
        return;
      case 'announce':
        this.remote.set(m.port, { owner: m.from, name: m.name });
        this.emit();
        return;
      case 'bye':
        for (const [port, p] of [...this.remote]) if (p.owner === m.from && (m.port === undefined || m.port === port)) this.remote.delete(port);
        if (m.port === undefined) {
          // A tab that closed no longer listens to anything of ours.
          let changed = false;
          for (const o of this.outlets.values()) {
            if (o.audience.delete(m.from)) {
              changed = true;
              if (o.audience.size === 0) o.listening?.(false);
            }
          }
          if (changed) this.audienceChanged();
        }
        this.emit();
        return;
      case 'listen': {
        const o = this.outlets.get(m.port);
        if (!o || o.audience.has(m.from)) return;
        o.audience.add(m.from);
        o.listening?.(true);
        this.audienceChanged();
        return;
      }
      case 'unlisten': {
        const o = this.outlets.get(m.port);
        if (o?.audience.delete(m.from)) {
          if (o.audience.size === 0) o.listening?.(false);
          this.audienceChanged();
        }
        return;
      }
      case 'pcm':
        this.sinks.get(m.port)?.(m);
        return;
    }
  }
}

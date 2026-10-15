import { PCM_RECV, PCM_SEND, PCM_SOURCE } from './pcmWorklet';

/**
 * The audio bus over raw PCM: a worklet in the publishing tab posts 10 ms chunks, they cross to other tabs on a
 * BroadcastChannel, and a worklet in the subscribing tab plays them out of a jitter buffer. Lossless, no network
 * stack (so none of WebRTC's ICE/mDNS trouble on VPNs and odd networks), same-origin only.
 */
type Msg =
  | { type: 'hello'; from: string }
  | { type: 'announce'; from: string; name: string }
  | { type: 'bye'; from: string }
  | { type: 'listen' | 'unlisten'; from: string; to: string }
  | { type: 'pcm'; from: string; rate: number; l: Float32Array; r: Float32Array };

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

const loaded = new WeakSet<BaseAudioContext>();

async function loadWorklet(ctx: AudioContext): Promise<void> {
  if (loaded.has(ctx)) return;
  const url = URL.createObjectURL(new Blob([PCM_SOURCE], { type: 'text/javascript' }));
  await ctx.audioWorklet.addModule(url);
  loaded.add(ctx);
}

export class PcmBus {
  readonly id = Math.random().toString(36).slice(2, 10);
  readonly log: string[] = [];
  private readonly channel?: BroadcastChannel;
  private readonly remote = new Map<string, string>();
  private readonly listeners = new Set<() => void>();
  private readonly audience = new Set<string>();
  private published?: { name: string; stop: () => void };
  private readonly receivers = new Map<string, (m: Extract<Msg, { type: 'pcm' }>) => void>();

  constructor(name = 'moa-audio-pcm') {
    if (typeof BroadcastChannel === 'undefined') return;
    this.channel = new BroadcastChannel(name);
    this.channel.onmessage = (e: MessageEvent<Msg>) => this.handle(e.data);
    this.send({ type: 'hello', from: this.id });
  }

  get supported(): boolean {
    return this.channel !== undefined && typeof AudioWorkletNode !== 'undefined';
  }

  get ports(): RemotePort[] {
    return [...this.remote].map(([id, name]) => ({ id, name }));
  }

  /** Makes the output of `node` available to other tabs as `name`. Returns a function that withdraws it. */
  async publish(ctx: AudioContext, node: AudioNode, name: string): Promise<() => void> {
    this.unpublish();
    await loadWorklet(ctx);
    const tap = new AudioWorkletNode(ctx, PCM_SEND, { numberOfInputs: 1, numberOfOutputs: 1, outputChannelCount: [2], channelCount: 2, channelCountMode: 'explicit' });
    const mute = ctx.createGain(); // the worklet only runs while it is connected towards the destination
    mute.gain.value = 0;
    node.connect(tap);
    tap.connect(mute).connect(ctx.destination);
    tap.port.onmessage = (e: MessageEvent<{ l: Float32Array; r: Float32Array }>) => {
      if (this.audience.size === 0) return;
      this.send({ type: 'pcm', from: this.id, rate: ctx.sampleRate, l: e.data.l, r: e.data.r });
    };
    const stop = () => {
      node.disconnect(tap);
      tap.disconnect();
      mute.disconnect();
      tap.port.onmessage = null;
    };
    this.published = { name, stop };
    this.send({ type: 'announce', from: this.id, name });
    this.emit();
    return () => this.unpublish();
  }

  unpublish(): void {
    if (!this.published) return;
    this.published.stop();
    this.published = undefined;
    this.audience.clear();
    this.send({ type: 'bye', from: this.id });
    this.emit();
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
    this.receivers.set(portId, (m) => node.port.postMessage({ rate: m.rate, l: m.l, r: m.r }, [m.l.buffer, m.r.buffer]));
    this.send({ type: 'listen', from: this.id, to: portId });
    return {
      node,
      stats: () => stats,
      close: () => {
        this.receivers.delete(portId);
        this.send({ type: 'unlisten', from: this.id, to: portId });
        node.disconnect();
        node.port.onmessage = null;
      },
    };
  }

  onChange(fn: () => void): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  close(): void {
    this.unpublish();
    this.channel?.close();
  }

  private emit(): void {
    for (const l of this.listeners) l();
  }

  private send(m: Msg): void {
    this.channel?.postMessage(m);
  }

  private handle(m: Msg): void {
    if (m.from === this.id) return;
    switch (m.type) {
      case 'hello':
        if (this.published) this.send({ type: 'announce', from: this.id, name: this.published.name });
        return;
      case 'announce':
        this.remote.set(m.from, m.name);
        this.emit();
        return;
      case 'bye':
        this.remote.delete(m.from);
        this.emit();
        return;
      case 'listen':
        if (m.to === this.id && this.published) this.audience.add(m.from);
        return;
      case 'unlisten':
        if (m.to === this.id) this.audience.delete(m.from);
        return;
      case 'pcm':
        this.receivers.get(m.from)?.(m);
        return;
    }
  }
}

/**
 * An in-browser audio bus between tabs: the audio twin of `MidiBus`. A tab publishes a named port (a MediaStream
 * from its Web Audio graph); other tabs of the same site list the ports and subscribe. The audio itself goes over a
 * WebRTC loopback connection (Opus), and the offer/answer/ICE signalling goes over a BroadcastChannel, so no
 * server is involved.
 *
 * Roles are fixed to keep signalling simple: the subscriber sends `request`, the publisher answers with an offer,
 * the subscriber replies with an answer, and both sides trickle ICE candidates.
 */
export type Signal =
  | { type: 'hello'; from: string }
  | { type: 'announce'; from: string; name: string }
  | { type: 'bye'; from: string }
  | { type: 'request'; from: string; to: string; conn: string }
  | { type: 'offer' | 'answer'; from: string; to: string; conn: string; sdp: string }
  | { type: 'ice'; from: string; to: string; conn: string; candidate: RTCIceCandidateInit }
  | { type: 'hangup'; from: string; to: string; conn: string };

interface ChannelLike {
  postMessage(m: Signal): void;
  onmessage: ((e: { data: Signal }) => void) | null;
  close(): void;
}

/** The slice of RTCPeerConnection the bus uses, so tests can fake it. */
export interface PeerLike {
  onicecandidate: ((e: { candidate: RTCIceCandidateInit | null }) => void) | null;
  ontrack: ((e: { streams: readonly MediaStream[]; receiver?: unknown }) => void) | null;
  onconnectionstatechange: (() => void) | null;
  connectionState: string;
  addTrack(track: MediaStreamTrack, stream: MediaStream): unknown;
  createOffer(): Promise<{ type: string; sdp?: string }>;
  createAnswer(): Promise<{ type: string; sdp?: string }>;
  setLocalDescription(d: { type: string; sdp?: string }): Promise<void>;
  setRemoteDescription(d: { type: string; sdp?: string }): Promise<void>;
  addIceCandidate(c: RTCIceCandidateInit): Promise<void>;
  close(): void;
}

export interface RemotePort {
  id: string;
  name: string;
}

export interface Subscription {
  stream: MediaStream;
  /** The latest connection state ('connecting', 'connected', 'failed', ...). */
  state: () => string;
  close(): void;
}

const STORAGE_KEY = 'moa.audioBus';
const OPUS = /^a=rtpmap:(\d+) opus\/48000\/2/m;

/**
 * Asks Opus for what a synth needs: full-band stereo at a high bitrate, no in-band FEC or DTX (which are for speech),
 * and the shortest frames. Applied to every SDP this side sends.
 */
export function tuneOpus(sdp: string): string {
  const pt = OPUS.exec(sdp)?.[1];
  if (!pt) return sdp;
  const wanted = 'stereo=1;sprop-stereo=1;maxaveragebitrate=510000;maxplaybackrate=48000;useinbandfec=0;usedtx=0;minptime=10;ptime=10';
  const line = new RegExp(`^a=fmtp:${pt} .*$`, 'm');
  const fmtp = `a=fmtp:${pt} minptime=10;${wanted}`;
  if (line.test(sdp)) return sdp.replace(line, fmtp);
  return sdp.replace(new RegExp(`^(a=rtpmap:${pt} .*)$`, 'm'), `$1\r\n${fmtp}`);
}

/** RTCIceCandidate objects cannot be structured-cloned onto a BroadcastChannel; send the plain fields. */
const plainCandidate = (c: RTCIceCandidateInit): RTCIceCandidateInit => ({
  candidate: c.candidate,
  sdpMid: c.sdpMid,
  sdpMLineIndex: c.sdpMLineIndex,
  usernameFragment: c.usernameFragment,
});

const randomId = (): string => Math.random().toString(36).slice(2, 10);

export class AudioBus {
  /** Subscribing is allowed; remembered per browser, like the MIDI bus. */
  enabled: boolean;
  readonly id = randomId();
  /** Recent signalling and connection events, newest last; for the test page and debugging. */
  readonly log: string[] = [];
  private readonly channel?: ChannelLike;
  private readonly remote = new Map<string, string>();
  private readonly listeners = new Set<() => void>();
  private published?: { name: string; stream: MediaStream };
  /** Connections we hold, keyed by conn id; either end of a link. */
  private readonly links = new Map<string, { peer: PeerLike; peerTab: string; pending: RTCIceCandidateInit[]; ready: boolean }>();
  /** Conn ids where this tab is the subscriber. */
  private readonly subs = new Set<string>();

  constructor(
    name = 'moa-audio',
    private readonly makePeer: () => PeerLike = () => new RTCPeerConnection({ iceServers: [] }) as unknown as PeerLike,
    channelFactory?: (name: string) => ChannelLike,
  ) {
    this.enabled = readEnabled();
    const make = channelFactory ?? (typeof BroadcastChannel === 'undefined' ? undefined : (n: string) => new BroadcastChannel(n) as unknown as ChannelLike);
    this.channel = make?.(name);
    if (this.channel) {
      this.channel.onmessage = (e) => {
        this.handle(e.data).catch((err) => this.note(`error handling ${e.data.type}: ${err}`));
      };
      this.send({ type: 'hello', from: this.id });
    }
  }

  get supported(): boolean {
    return this.channel !== undefined && typeof RTCPeerConnection !== 'undefined';
  }

  /** Ports other tabs are publishing right now. */
  get ports(): RemotePort[] {
    return [...this.remote].map(([id, name]) => ({ id, name }));
  }

  get publishedName(): string | undefined {
    return this.published?.name;
  }

  /** Makes this tab's stream available to others under `name`. Replaces any earlier port from this tab. */
  publish(name: string, stream: MediaStream): void {
    this.unpublish();
    this.published = { name, stream };
    this.send({ type: 'announce', from: this.id, name });
    this.emit();
  }

  unpublish(): void {
    if (!this.published) return;
    this.published = undefined;
    this.send({ type: 'bye', from: this.id });
    for (const [conn, link] of this.links) {
      if (this.subs.has(conn)) continue;
      this.send({ type: 'hangup', from: this.id, to: link.peerTab, conn });
      link.peer.close();
      this.links.delete(conn);
    }
    this.emit();
  }

  /**
   * Connects to a published port and resolves with its audio once the first track arrives. `onReceiver` gets the
   * RTCRtpReceiver so the caller can tune its jitter buffer.
   */
  subscribe(portId: string, onReceiver?: (receiver: unknown) => void): Promise<Subscription> {
    const conn = randomId();
    const peer = this.makePeer();
    this.links.set(conn, { peer, peerTab: portId, pending: [], ready: false });
    return new Promise<Subscription>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.hangup(conn);
        reject(new Error('Timed out waiting for the other tab'));
      }, 8000);
      peer.onicecandidate = (e) => {
        if (e.candidate) this.send({ type: 'ice', from: this.id, to: portId, conn, candidate: plainCandidate(e.candidate) });
      };
      peer.ontrack = (e) => {
        const stream = e.streams[0];
        if (!stream) return;
        onReceiver?.(e.receiver);
        clearTimeout(timer);
        resolve({ stream, state: () => peer.connectionState, close: () => this.hangup(conn, true) });
      };
      peer.onconnectionstatechange = () => {
        this.note(`subscriber connection ${peer.connectionState}`);
        if (peer.connectionState === 'failed') this.emit();
      };
      this.subs.add(conn);
      this.send({ type: 'request', from: this.id, to: portId, conn });
    });
  }

  setEnabled(on: boolean): void {
    this.enabled = on;
    try {
      localStorage.setItem(STORAGE_KEY, on ? '1' : '0');
    } catch {
      // not remembered
    }
    this.emit();
  }

  onChange(fn: () => void): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  close(): void {
    this.unpublish();
    for (const conn of [...this.links.keys()]) this.hangup(conn, true);
    this.channel?.close();
  }

  /** Connection, ICE and signalling states of every link this tab holds; for debugging. */
  describeLinks(): string[] {
    return [...this.links].map(([conn, { peer }]) => {
      const p = peer as unknown as RTCPeerConnection;
      return `${conn}: conn=${p.connectionState} ice=${p.iceConnectionState} gather=${p.iceGatheringState} sig=${p.signalingState}`;
    });
  }

  private note(text: string): void {
    this.log.push(`${(performance.now() / 1000).toFixed(2)} ${text}`);
    if (this.log.length > 40) this.log.shift();
  }

  private emit(): void {
    for (const l of this.listeners) l();
  }

  private send(m: Signal): void {
    this.channel?.postMessage(m);
  }

  private hangup(conn: string, tell = false): void {
    const link = this.links.get(conn);
    if (!link) return;
    this.note(`hangup ${conn} (${tell ? 'we closed' : 'other end or timeout'})`);
    if (tell) this.send({ type: 'hangup', from: this.id, to: link.peerTab, conn });
    link.peer.close();
    this.links.delete(conn);
    this.subs.delete(conn);
  }

  private async handle(m: Signal): Promise<void> {
    if (m.from === this.id) return;
    if ('to' in m && m.to !== this.id) return;
    this.note(`got ${m.type} from ${m.from}${m.type === 'ice' ? ' ' + m.candidate.candidate : ''}`);
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
      case 'request': {
        if (!this.published) return;
        const peer = this.makePeer();
        peer.onconnectionstatechange = () => this.note(`publisher connection ${peer.connectionState}`);
        const link = { peer, peerTab: m.from, pending: [] as RTCIceCandidateInit[], ready: false };
        this.links.set(m.conn, link);
        peer.onicecandidate = (e) => {
          if (e.candidate) this.send({ type: 'ice', from: this.id, to: m.from, conn: m.conn, candidate: plainCandidate(e.candidate) });
        };
        for (const track of this.published.stream.getAudioTracks()) peer.addTrack(track, this.published.stream);
        const offer = await peer.createOffer();
        const tuned = { type: offer.type, sdp: tuneOpus(offer.sdp ?? '') };
        await peer.setLocalDescription(tuned);
        this.send({ type: 'offer', from: this.id, to: m.from, conn: m.conn, sdp: tuned.sdp });
        return;
      }
      case 'offer': {
        const link = this.links.get(m.conn);
        if (!link) return;
        await link.peer.setRemoteDescription({ type: 'offer', sdp: m.sdp });
        const answer = await link.peer.createAnswer();
        const tuned = { type: answer.type, sdp: tuneOpus(answer.sdp ?? '') };
        await link.peer.setLocalDescription(tuned);
        await this.flush(link);
        this.send({ type: 'answer', from: this.id, to: m.from, conn: m.conn, sdp: tuned.sdp });
        return;
      }
      case 'answer': {
        const link = this.links.get(m.conn);
        if (!link) return;
        await link.peer.setRemoteDescription({ type: 'answer', sdp: m.sdp });
        await this.flush(link);
        return;
      }
      case 'ice': {
        const link = this.links.get(m.conn);
        if (!link) return;
        if (link.ready) await link.peer.addIceCandidate(m.candidate);
        else link.pending.push(m.candidate);
        return;
      }
      case 'hangup':
        this.hangup(m.conn);
        return;
    }
  }

  /** Remote description is set: apply candidates that arrived early. */
  private async flush(link: { peer: PeerLike; pending: RTCIceCandidateInit[]; ready: boolean }): Promise<void> {
    link.ready = true;
    for (const c of link.pending.splice(0)) await link.peer.addIceCandidate(c);
  }
}

function readEnabled(): boolean {
  try {
    return localStorage.getItem(STORAGE_KEY) !== '0';
  } catch {
    return true;
  }
}

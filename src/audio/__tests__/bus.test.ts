import { describe, expect, it } from 'vitest';
import { AudioBus, type PeerLike, type Signal, tuneOpus } from '../bus';

/** Several buses on one fake broadcast channel (a sender does not hear itself). */
function room() {
  const ends: { onmessage: ((e: { data: Signal }) => void) | null }[] = [];
  const channel = () => {
    const end = {
      onmessage: null as ((e: { data: Signal }) => void) | null,
      postMessage(m: Signal) { for (const o of ends) if (o !== end) queueMicrotask(() => o.onmessage?.({ data: m })); },
      close() {},
    };
    ends.push(end);
    return end;
  };
  const peers: FakePeer[] = [];
  const make = () => new AudioBus('x', () => { const p = new FakePeer(); peers.push(p); return p; }, channel);
  return { make, peers };
}

class FakePeer implements PeerLike {
  onicecandidate: PeerLike['onicecandidate'] = null;
  ontrack: PeerLike['ontrack'] = null;
  onconnectionstatechange: (() => void) | null = null;
  connectionState = 'new';
  log: string[] = [];
  closed = false;
  addTrack() { this.log.push('addTrack'); return {}; }
  async createOffer() { return { type: 'offer', sdp: 'a=rtpmap:111 opus/48000/2\r\n' }; }
  async createAnswer() { return { type: 'answer', sdp: 'a=rtpmap:111 opus/48000/2\r\n' }; }
  async setLocalDescription(d: { type: string }) { this.log.push(`local:${d.type}`); }
  async setRemoteDescription(d: { type: string }) {
    this.log.push(`remote:${d.type}`);
    if (d.type === 'offer') this.ontrack?.({ streams: [{ id: 's' } as MediaStream] });
  }
  async addIceCandidate() { this.log.push('ice'); }
  close() { this.closed = true; }
}

const tick = () => new Promise((r) => setTimeout(r, 0));
const stream = { getAudioTracks: () => [{}] } as unknown as MediaStream;

describe('tuneOpus', () => {
  it('adds an fmtp line for stereo, high bitrate speech-free Opus', () => {
    const out = tuneOpus('a=rtpmap:111 opus/48000/2\r\na=rtcp-fb:111 nack');
    expect(out).toContain('a=fmtp:111 ');
    expect(out).toContain('stereo=1');
    expect(out).toContain('useinbandfec=0');
  });

  it('replaces an existing fmtp line and leaves other SDP alone', () => {
    const out = tuneOpus('a=rtpmap:111 opus/48000/2\r\na=fmtp:111 minptime=10;useinbandfec=1\r\nm=video');
    expect(out.match(/a=fmtp:111/g)).toHaveLength(1);
    expect(out).not.toContain('useinbandfec=1');
    expect(out).toContain('m=video');
    expect(tuneOpus('v=0')).toBe('v=0');
  });
});

describe('AudioBus', () => {
  it('lists a published port on other tabs, and drops it when withdrawn', async () => {
    const { make } = room();
    const a = make(), b = make();
    a.publish('Lynch', stream);
    await tick();
    expect(b.ports).toEqual([{ id: a.id, name: 'Lynch' }]);
    a.unpublish();
    await tick();
    expect(b.ports).toEqual([]);
  });

  it('tells a tab that opens later what is already published', async () => {
    const { make } = room();
    const a = make();
    a.publish('Lynch', stream);
    const late = make();
    await tick();
    expect(late.ports.map((p) => p.name)).toEqual(['Lynch']);
  });

  it('negotiates offer and answer and hands the subscriber a stream', async () => {
    const { make, peers } = room();
    const a = make(), b = make();
    a.publish('Lynch', stream);
    await tick();
    const sub = await b.subscribe(a.id);
    expect(sub.stream).toBeDefined();
    await tick();
    const [subscriber, pub] = [peers[0]!, peers[1]!]; // the subscriber makes its peer first
    expect(pub.log).toEqual(['addTrack', 'local:offer', 'remote:answer']);
    expect(subscriber.log).toEqual(['remote:offer', 'local:answer']);
  });

  it('closes the publisher end when the subscriber hangs up', async () => {
    const { make, peers } = room();
    const a = make(), b = make();
    a.publish('Lynch', stream);
    await tick();
    const sub = await b.subscribe(a.id);
    await tick();
    sub.close();
    await tick();
    expect(peers.every((p) => p.closed)).toBe(true);
  });

  it('ignores a request when nothing is published', async () => {
    const { make, peers } = room();
    const a = make(), b = make();
    void b.subscribe(a.id).catch(() => {});
    await tick();
    expect(peers).toHaveLength(1);
  });
});

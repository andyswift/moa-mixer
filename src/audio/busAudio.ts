import type { AudioBus, Subscription } from './bus';

/** Publishes the output of a Web Audio node as a port on the audio bus. Returns a function that withdraws it. */
export function publishNode(bus: AudioBus, ctx: AudioContext, node: AudioNode, name: string): () => void {
  const dest = ctx.createMediaStreamDestination();
  dest.channelCount = 2;
  dest.channelCountMode = 'explicit';
  node.connect(dest);
  bus.publish(name, dest.stream);
  return () => {
    bus.unpublish();
    node.disconnect(dest);
  };
}

export interface Received {
  /** Connect this into the graph. */
  node: MediaStreamAudioSourceNode;
  subscription: Subscription;
  close(): void;
}

/** Subscribes to a port and exposes its audio as a Web Audio source node in `ctx`. */
export async function receiveInto(bus: AudioBus, ctx: AudioContext, portId: string): Promise<Received> {
  const subscription = await bus.subscribe(portId, (receiver) => {
    // Ask for the smallest jitter buffer Chrome will give; the other tab is on the same machine.
    try {
      (receiver as { jitterBufferTarget?: number | null }).jitterBufferTarget = 0;
    } catch {
      // not supported
    }
  });
  // Chrome only delivers a remote stream to Web Audio if the stream is also attached to a media element.
  const sink = new Audio();
  sink.muted = true;
  sink.srcObject = subscription.stream;
  void sink.play().catch(() => {});
  const node = ctx.createMediaStreamSource(subscription.stream);
  return {
    node,
    subscription,
    close: () => {
      node.disconnect();
      sink.srcObject = null;
      subscription.close();
    },
  };
}

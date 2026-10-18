import { describe, expect, it } from 'vitest';
import { type BusMessage, MidiBus } from '../bus';

/** Two buses on one fake channel, with a controllable clock and timers. */
function pair(lead = 0) {
  const ends: { onmessage: ((e: { data: BusMessage }) => void) | null; peer?: typeof ends[number]; postMessage(m: BusMessage): void; close(): void }[] = [];
  const make = () => {
    const end = {
      onmessage: null as ((e: { data: BusMessage }) => void) | null,
      peer: undefined as typeof ends[number] | undefined,
      postMessage(m: BusMessage) { end.peer?.onmessage?.({ data: m }); },
      close() {},
    };
    ends.push(end);
    return end;
  };
  const a = make(), b = make();
  a.peer = b; b.peer = a;
  let time = 1000;
  const timers: { at: number; fn: () => void }[] = [];
  const later = (fn: () => void, ms: number) => { timers.push({ at: time + ms, fn }); };
  const run = (to: number) => { time = to; for (const t of timers.filter((x) => x.at <= to)) { timers.splice(timers.indexOf(t), 1); t.fn(); } };
  const sender = new MidiBus('x', () => time, later, () => a);
  const receiver = new MidiBus('x', () => time, later, () => b, lead);
  return { sender, receiver, run, now: () => time };
}

describe('MidiBus', () => {
  it('delivers bytes to the other end, immediately when already due', () => {
    const { sender, receiver } = pair();
    const got: number[][] = [];
    receiver.onMessage = (d) => got.push([...d]);
    sender.send([0x90, 60, 100], 900);
    expect(got).toEqual([[0x90, 60, 100]]);
  });

  it('holds a message until its due time', () => {
    const { sender, receiver, run } = pair();
    const got: number[][] = [];
    receiver.onMessage = (d) => got.push([...d]);
    sender.send([0x80, 60, 0], 1100);
    expect(got).toEqual([]);
    run(1050);
    expect(got).toEqual([]);
    run(1100);
    expect(got).toEqual([[0x80, 60, 0]]);
  });

  it('with a lead, hands a message over that much early, stamped with the time it is due', () => {
    const { sender, receiver, run } = pair(40);
    const got: { at: number; stamp: number }[] = [];
    const t0 = performance.now();
    receiver.onMessage = (_d, stamp) => got.push({ at: Date.now(), stamp: stamp - t0 });
    sender.send([0x90, 36, 100], 1100);
    run(1059);
    expect(got).toHaveLength(0);
    run(1060);
    expect(got).toHaveLength(1);
    expect(got[0]!.stamp).toBeGreaterThan(39); // due 40 ms after it was handed over
    expect(got[0]!.stamp).toBeLessThan(45);
  });

  it('ignores messages while switched off', () => {
    const { sender, receiver } = pair();
    const got: number[][] = [];
    receiver.onMessage = (d) => got.push([...d]);
    receiver.setEnabled(false);
    sender.send([0x90, 60, 100], 0);
    expect(got).toEqual([]);
    receiver.setEnabled(true);
    sender.send([0x90, 61, 100], 0);
    expect(got).toEqual([[0x90, 61, 100]]);
  });

  it('is unsupported without a channel', () => {
    const bus = new MidiBus('x', () => 0, () => undefined, () => undefined as never);
    expect(bus.supported).toBe(false);
    expect(() => bus.send([1])).not.toThrow();
  });
});

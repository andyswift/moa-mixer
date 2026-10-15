import { describe, expect, it } from 'vitest';
import { type ChannelLike, type Msg, PcmBus } from '../pcmBus';

/** Buses on one fake broadcast channel: delivery is immediate and a sender does not hear itself. */
function room() {
  const ends: ChannelLike[] = [];
  const channel = (): ChannelLike => {
    const end: ChannelLike = {
      onmessage: null,
      postMessage(m: Msg) { for (const o of ends) if (o !== end) o.onmessage?.({ data: m }); },
      close() { ends.splice(ends.indexOf(end), 1); },
    };
    ends.push(end);
    return end;
  };
  return () => new PcmBus('x', channel);
}

const chunk = (v: number) => [new Float32Array(4).fill(v), new Float32Array(4).fill(-v)] as const;

describe('PcmBus', () => {
  it('lists every port a tab publishes, with names, and removes one when it closes', () => {
    const make = room();
    const a = make(), b = make();
    const kick = a.openOutlet('Drums: Kick');
    a.openOutlet('Drums: Snare');
    expect(b.ports.map((p) => p.name)).toEqual(['Drums: Kick', 'Drums: Snare']);
    kick.close();
    expect(b.ports.map((p) => p.name)).toEqual(['Drums: Snare']);
  });

  it('tells a tab that opens later what is already published', () => {
    const make = room();
    const a = make();
    a.openOutlet('Synth');
    a.openOutlet('Poly');
    const late = make();
    expect(late.ports.map((p) => p.name)).toEqual(['Synth', 'Poly']);
  });

  it('forgets all of a tab\'s ports when it closes', () => {
    const make = room();
    const a = make(), b = make();
    a.openOutlet('Synth');
    a.openOutlet('Poly');
    a.close();
    expect(b.ports).toEqual([]);
  });

  it('delivers chunks only to the port that was listened to, and only while listened', () => {
    const make = room();
    const a = make(), b = make();
    const kick = a.openOutlet('Kick');
    const snare = a.openOutlet('Snare');
    const got: number[] = [];
    kick.send(...chunk(9), 48000); // nobody listening yet
    const stop = b.listen(kick.id, (_rate, l) => got.push(l[0]!));
    kick.send(...chunk(1), 48000);
    snare.send(...chunk(2), 48000);
    expect(got).toEqual([1]);
    stop();
    kick.send(...chunk(3), 48000);
    expect(got).toEqual([1]);
  });

  it('reports whether anyone is listening, and notifies when that changes', () => {
    const make = room();
    const a = make(), b = make(), c = make();
    const kick = a.openOutlet('Kick');
    let notes = 0;
    a.onAudience(() => notes++);
    expect(a.audience).toBe(0);
    expect(kick.listened).toBe(false);
    const stopB = b.listen(kick.id, () => {});
    b.listen(kick.id, () => {}); // same tab again: counted once
    const stopC = c.listen(kick.id, () => {});
    expect(a.audience).toBe(2);
    expect(kick.listened).toBe(true);
    stopB();
    stopC();
    expect(a.audience).toBe(0);
    expect(notes).toBe(4);
  });

  it('drops a tab from the audience when that tab closes', () => {
    const make = room();
    const a = make(), b = make();
    const kick = a.openOutlet('Kick');
    b.listen(kick.id, () => {});
    expect(a.audience).toBe(1);
    b.close();
    expect(a.audience).toBe(0);
  });

  it('ends the audience when the port is closed', () => {
    const make = room();
    const a = make(), b = make();
    const kick = a.openOutlet('Kick');
    b.listen(kick.id, () => {});
    kick.close();
    expect(a.audience).toBe(0);
  });
});

import { describe, expect, it } from 'vitest';
import { BassGuitar, CABINETS } from '../devices/bassGuitar';

type Sent = { node: string; type: string; on?: boolean };
const watch = (b: BassGuitar) => {
  const sent: Sent[] = [];
  b.circuit.onChange((c) => { if (c.type === 'message') sent.push({ node: c.nodeId, ...(c.data as { type: string; on?: boolean }) }); });
  return sent;
};
const set = (b: BassGuitar, id: string, v: number | string) => (b.control(id) as { set(v: number | string): void }).set(v);
const param = (b: BassGuitar, node: string, name: string) => b.circuit.node(node).params[name]!;

describe('MOA-BASS, four strings', () => {
  it('starts in standard tuning, each string at a real-world tension, heavier strings pulled harder', () => {
    const b = new BassGuitar();
    expect([0, 1, 2, 3].map((i) => b.readout(i).open.name)).toEqual(['E1', 'A1', 'D2', 'G2']);
    for (let i = 0; i < 4; i++) expect(Math.abs(b.readout(i).open.cents)).toBeLessThan(1);
    expect(b.readout(0).mu).toBeGreaterThan(b.readout(3).mu * 3);
    for (let i = 0; i < 4; i++) expect(b.tension(i)).toBeGreaterThan(130); // 30-50 lb a string, as real sets are
  });

  it('plays a note on the string a bassist would: the least hand movement from where the hand is', () => {
    const b = new BassGuitar();
    // A2 is on the E string at 17, the A at 12, the D at 7 and the G at 2
    b.hand = 5;
    expect(b.voices[b.chooseString(45)!]!.name).toBe('D'); // two frets' move beats three
    b.hand = 10;
    expect(b.voices[b.chooseString(45)!]!.name).toBe('A'); // near fret 10, the A string's fret 12 is closest
    b.hand = 2;
    expect(b.voices[b.chooseString(45)!]!.name).toBe('G'); // near fret 2, the G string's fret 2
    expect(b.chooseString(20)).toBeUndefined(); // below the E string
  });

  it('two keys at once go to two strings (a double-stop), and letting go of one mutes only its string', () => {
    const b = new BassGuitar();
    const sent = watch(b);
    b.hand = 1; // near the nut
    b.keyDown(33); // A1: the open A string (the E string's fret 5 is further from the hand)
    b.keyDown(40); // E2: the A string at 7 or the D string at 2; the A string is busy, so the D string
    const strings = b.voices.filter((v) => v.note !== undefined).map((v) => v.name);
    expect(strings.sort()).toEqual(['A', 'D']);
    b.keyUp(40);
    const mutes = sent.filter((m) => m.type === 'mute' && m.on);
    expect(mutes.map((m) => m.node)).toEqual(['s3']); // the D string only
    expect(b.voices[1]!.note).toBe(33); // the open A still rings
  });

  it('frets set each string\'s vibrating length, and the fretting hand follows', () => {
    const b = new BassGuitar();
    b.setFret(0, 12);
    expect(b.readout(0).length).toBeCloseTo(b.scale / 2, 10);
    expect(b.readout(0).now.name).toBe('E2');
    expect(b.hand).toBe(12);
    b.setFret(0, 0); // an open string does not move the hand
    expect(b.hand).toBe(12);
  });

  it('the cabinet sets the box\'s resonance, the cones and the top; the 1x15 is the darkest', () => {
    const b = new BassGuitar();
    for (const [id, cab] of Object.entries(CABINETS)) {
      set(b, 'cab.type', id);
      expect(param(b, 'cabHp', 'frequency')).toBe(cab.hp);
      expect(param(b, 'cabLp1', 'frequency')).toBe(cab.top);
    }
    expect(CABINETS['1x15'].top).toBeLessThan(CABINETS['4x10'].top);
    set(b, 'cab.mic', 'off-axis');
    expect(param(b, 'cabMic', 'gain')).toBeLessThan(-6);
  });

  it('the DI / cabinet blend keeps the power constant, from all DI to all cabinet', () => {
    const b = new BassGuitar();
    for (const v of [0, 0.3, 0.6, 1]) {
      set(b, 'cab.blend', v);
      const di = param(b, 'diOut', 'gain'), cab = param(b, 'cabOut', 'gain');
      expect(di * di + cab * cab).toBeCloseTo(1, 10);
    }
    set(b, 'cab.blend', 0);
    expect(param(b, 'cabOut', 'gain')).toBeCloseTo(0, 10);
  });

  it('every string keeps its configuration on its node, for an engine started later', () => {
    const b = new BassGuitar();
    for (let i = 0; i < 4; i++) {
      const cfg = JSON.parse(b.circuit.node(`s${i + 1}`).options.config!) as { hz: number[] };
      expect(cfg.hz[0]).toBeCloseTo([41.2, 55, 73.42, 98][i]!, 0);
    }
  });
});

import { describe, expect, it } from 'vitest';
import { encodeWav } from '../wav';

describe('encodeWav', () => {
  it('writes a 24-bit stereo WAV: the header, interleaved samples, and clipping at full scale', () => {
    const L = Float32Array.from([0, 0.5, -1, 2]), R = Float32Array.from([1, -0.5, 0.25, -3]);
    const buf = encodeWav([L, R], 48000);
    const v = new DataView(buf), text = (at: number, n: number) => String.fromCharCode(...new Uint8Array(buf, at, n));
    expect([text(0, 4), text(8, 4), text(12, 4), text(36, 4)]).toEqual(['RIFF', 'WAVE', 'fmt ', 'data']);
    expect(v.getUint32(4, true)).toBe(buf.byteLength - 8);
    expect([v.getUint16(20, true), v.getUint16(22, true), v.getUint32(24, true), v.getUint16(34, true)]).toEqual([1, 2, 48000, 24]);
    expect(v.getUint32(28, true)).toBe(48000 * 6);
    expect(v.getUint32(40, true)).toBe(4 * 2 * 3);
    const sample = (frame: number, ch: number) => {
      const at = 44 + (frame * 2 + ch) * 3;
      const u = v.getUint8(at) | (v.getUint8(at + 1) << 8) | (v.getUint8(at + 2) << 16);
      return (u << 8) >> 8; // sign-extend 24 bits
    };
    expect([sample(0, 0), sample(0, 1), sample(1, 0), sample(1, 1), sample(2, 0), sample(3, 0), sample(3, 1)])
      .toEqual([0, 8388607, 4194304, -4194303, -8388607, 8388607, -8388607]); // halves round up, as Math.round does
  });

  it('writes 16 bits when asked', () => {
    const buf = encodeWav([Float32Array.from([0.5])], 44100, 16);
    const v = new DataView(buf);
    expect([v.getUint16(22, true), v.getUint16(34, true), v.getInt16(44, true), buf.byteLength]).toEqual([1, 16, 16384, 46]);
  });
});

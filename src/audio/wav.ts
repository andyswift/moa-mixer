/**
 * A WAV file from audio: PCM, little-endian, 24 bits (or 16), the channels interleaved. Samples past full scale are
 * clipped there.
 */
export function encodeWav(channels: Float32Array[], sampleRate: number, bits: 16 | 24 = 24): ArrayBuffer {
  const numChannels = channels.length;
  const frames = channels[0]?.length ?? 0;
  const bytes = bits / 8, blockAlign = numChannels * bytes, dataSize = frames * blockAlign;
  const buf = new ArrayBuffer(44 + dataSize);
  const v = new DataView(buf);
  const text = (at: number, s: string) => { for (let i = 0; i < s.length; i++) v.setUint8(at + i, s.charCodeAt(i)); };
  text(0, 'RIFF');
  v.setUint32(4, 36 + dataSize, true);
  text(8, 'WAVE');
  text(12, 'fmt ');
  v.setUint32(16, 16, true);
  v.setUint16(20, 1, true); // PCM
  v.setUint16(22, numChannels, true);
  v.setUint32(24, sampleRate, true);
  v.setUint32(28, sampleRate * blockAlign, true);
  v.setUint16(32, blockAlign, true);
  v.setUint16(34, bits, true);
  text(36, 'data');
  v.setUint32(40, dataSize, true);
  const full = bits === 24 ? 8388607 : 32767;
  let at = 44;
  for (let i = 0; i < frames; i++) {
    for (let c = 0; c < numChannels; c++) {
      const x = Math.max(-1, Math.min(1, channels[c]![i]!));
      const s = Math.round(x * full);
      if (bits === 24) {
        v.setUint8(at, s & 0xff);
        v.setUint8(at + 1, (s >> 8) & 0xff);
        v.setUint8(at + 2, (s >> 16) & 0xff);
      } else {
        v.setInt16(at, s, true);
      }
      at += bytes;
    }
  }
  return buf;
}

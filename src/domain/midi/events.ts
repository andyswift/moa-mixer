/** Channels are 1-16 (as shown to users), not the raw 0-15 on the wire. */
export type MidiEvent =
  | { type: 'noteOn'; channel: number; note: number; velocity: number }
  | { type: 'noteOff'; channel: number; note: number; velocity: number }
  | { type: 'cc'; channel: number; controller: number; value: number }
  | { type: 'pitchBend'; channel: number; value: number } // -1..1
  | { type: 'programChange'; channel: number; program: number }
  | { type: 'clock' }
  | { type: 'start' }
  | { type: 'continue' }
  | { type: 'stop' };

/** Parses one raw MIDI message; returns undefined for messages we don't use (sysex, active sensing, ...). */
export function parseMidi(data: ArrayLike<number>): MidiEvent | undefined {
  const status = data[0];
  if (status === undefined) return undefined;

  if (status >= 0xf0) {
    switch (status) {
      case 0xf8: return { type: 'clock' };
      case 0xfa: return { type: 'start' };
      case 0xfb: return { type: 'continue' };
      case 0xfc: return { type: 'stop' };
      default: return undefined;
    }
  }

  const kind = status & 0xf0;
  const channel = (status & 0x0f) + 1;
  const d1 = (data[1] ?? 0) & 0x7f;
  const d2 = (data[2] ?? 0) & 0x7f;
  switch (kind) {
    case 0x80: return { type: 'noteOff', channel, note: d1, velocity: d2 };
    // A note on with velocity 0 is a note off by convention.
    case 0x90: return d2 === 0
      ? { type: 'noteOff', channel, note: d1, velocity: 0 }
      : { type: 'noteOn', channel, note: d1, velocity: d2 };
    case 0xb0: return { type: 'cc', channel, controller: d1, value: d2 };
    case 0xc0: return { type: 'programChange', channel, program: d1 };
    case 0xe0: return { type: 'pitchBend', channel, value: ((d2 << 7) | d1) / 8192 - 1 };
    default: return undefined;
  }
}

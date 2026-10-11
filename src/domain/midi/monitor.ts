import type { MidiEvent } from './events';
import { formatEvent, messageKind, type MessageKind } from './format';

export interface MonitorLine {
  text: string;
  kind: MessageKind;
}

const MAX_LINES = 40;

/** Recent MIDI messages for display, plus when each kind of message last arrived (for activity LEDs). */
export class MidiMonitor {
  readonly lines: MonitorLine[] = [];
  readonly lastSeen: Record<MessageKind, number> = { note: -Infinity, cc: -Infinity, clock: -Infinity, other: -Infinity };
  private listeners = new Set<() => void>();

  /** Clock pulses are 24 a beat, so only start/stop/continue are logged; pulses just light the LED. */
  record(event: MidiEvent, now: number): void {
    this.lastSeen[messageKind(event)] = now;
    if (event.type === 'clock') return;
    this.lines.push({ text: formatEvent(event), kind: messageKind(event) });
    if (this.lines.length > MAX_LINES) this.lines.shift();
    for (const l of this.listeners) l();
  }

  clear(): void {
    this.lines.length = 0;
    for (const l of this.listeners) l();
  }

  onChange(fn: () => void): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }
}

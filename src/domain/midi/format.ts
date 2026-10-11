import type { MidiEvent } from './events';

const NAMES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];

/** Note name with middle C (note 60) as C3, matching the Ableton convention. */
export function noteName(note: number): string {
  return `${NAMES[note % 12]}${Math.floor(note / 12) - 2}`;
}

export type MessageKind = 'note' | 'cc' | 'clock' | 'other';

export function messageKind(e: MidiEvent): MessageKind {
  switch (e.type) {
    case 'noteOn':
    case 'noteOff': return 'note';
    case 'cc': return 'cc';
    case 'clock':
    case 'start':
    case 'continue':
    case 'stop': return 'clock';
    default: return 'other';
  }
}

export function formatEvent(e: MidiEvent): string {
  switch (e.type) {
    case 'noteOn': return `ch${e.channel}  note on  ${noteName(e.note)}  vel ${e.velocity}`;
    case 'noteOff': return `ch${e.channel}  note off  ${noteName(e.note)}`;
    case 'cc': return `ch${e.channel}  cc ${e.controller}  = ${e.value}`;
    case 'pitchBend': return `ch${e.channel}  bend  ${e.value.toFixed(2)}`;
    case 'programChange': return `ch${e.channel}  program  ${e.program}`;
    case 'clock': return 'clock';
    default: return `clock ${e.type}`;
  }
}

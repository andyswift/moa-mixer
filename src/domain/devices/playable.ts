/** What the keyboard bed needs from a synth: keys, the two wheels, and change notifications for the panel. */
export interface Playable {
  keyDown(note: number): void;
  keyUp(note: number): void;
  /** MIDI notes currently held, oldest first. */
  readonly heldNotes: readonly number[];
  onNoteChange(fn: () => void): () => void;
  /** Semitones the pitch wheel reaches either way (default 2), for its readout. */
  readonly bendRange?: number;
  readonly pitchBend: number;
  setPitchBend(value: number): void;
  readonly modWheel: number;
  setModWheel(value: number): void;
  onPerformanceChange(fn: () => void): () => void;
}

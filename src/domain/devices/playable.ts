/** What the keyboard bed needs from a synth: keys, the two wheels, and change notifications for the panel. */
export interface Playable {
  keyDown(note: number): void;
  keyUp(note: number): void;
  /** MIDI notes currently held, oldest first. */
  readonly heldNotes: readonly number[];
  onNoteChange(fn: () => void): () => void;
  readonly pitchBend: number;
  setPitchBend(value: number): void;
  readonly modWheel: number;
  setModWheel(value: number): void;
  onPerformanceChange(fn: () => void): () => void;
}

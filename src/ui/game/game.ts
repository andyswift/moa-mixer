import type { AudioEngine } from '../../audio/engine';
import type { PolySynth } from '../../domain/devices/polySynth';
import type { Synthesizer } from '../../domain/devices/synthesizer';
import type { GameProgress } from '../../domain/game/progress';
import type { MidiEvent } from '../../domain/midi/events';
import type { WebMidi } from '../../midi/webMidi';

export type ScreenName = 'gate' | 'knobs' | 'band' | 'tree' | { lesson: string } | { drill: string };

/** What every screen gets: the synths and their engines, MIDI, the saved progress, and a way to move on. */
export interface Game {
  /** The SOLO-1 (the MOA-1's engine): the mono synth the player starts with. */
  readonly synth: Synthesizer;
  /** The MOA-6, for lessons that need chords. */
  readonly poly: PolySynth;
  /** Which synth the player's keys play; every screen starts on 'mono'. */
  instrument: 'mono' | 'poly';
  /** Starts both engines (from a click). */
  startAudio(): Promise<void>;
  readonly engine: AudioEngine;
  readonly midi: WebMidi;
  progress: GameProgress;
  /** Saves the progress after a screen changed it. */
  save(): void;
  go(screen: ScreenName): void;
  /** The current screen's MIDI listener (notes still play the synth whatever the screen does). */
  listen(fn: ((e: MidiEvent) => void) | undefined): void;
  /** True once a note has come in from the player's device this session. */
  heardNote: boolean;
}

/** A screen: its element, and what to do when the game leaves it. */
export interface Screen {
  readonly el: HTMLElement;
  dispose?(): void;
}

import type { AudioEngine } from '../../audio/engine';
import type { BassGuitar } from '../../domain/devices/bassGuitar';
import type { DrumMachine } from '../../domain/devices/drumMachine';
import type { PolySynth } from '../../domain/devices/polySynth';
import type { Synthesizer } from '../../domain/devices/synthesizer';
import type { GameProgress, Role } from '../../domain/game/progress';
import type { MidiEvent } from '../../domain/midi/events';
import type { WebMidi } from '../../midi/webMidi';

export type ScreenName = 'gate' | 'knobs' | 'touch' | 'band' | 'tree' | 'tour' | { lesson: string } | { drill: string } | { groove: string } | { rehearse: string } | { gig: string } | { length: string };

/** Which instrument the player's keys play. */
export type Instrument = 'mono' | 'poly' | 'bass';

/** What every screen gets: the instruments and their engines, MIDI, the saved progress, and a way to move on. */
export interface Game {
  /** The SOLO-1 (the MOA-1's engine): the mono synth the synth player starts with. */
  readonly synth: Synthesizer;
  /** The MOA-6, for lessons that need chords. */
  readonly poly: PolySynth;
  /** The MOA-BASS. Played from the keyboard it sounds an octave below the keys (screens get the sounding note). */
  readonly bass: BassGuitar;
  /** The drum machine that plays grooves, and its engine (its audio clock times them). */
  readonly drums: DrumMachine;
  readonly drumsEngine: AudioEngine;
  /** Which instrument the player's keys play; every screen starts on 'mono'. */
  instrument: Instrument;
  /** The band member the skill tree shows. */
  role: Role;
  /** The venue the tour screen shows (its setlist and gig); undefined picks the furthest one reached. */
  venue?: string;
  /** Starts every engine (from a click). */
  startAudio(): Promise<void>;
  readonly engine: AudioEngine;
  readonly midi: WebMidi;
  progress: GameProgress;
  /** Saves the progress after a screen changed it. */
  save(): void;
  go(screen: ScreenName): void;
  /**
   * The current screen's MIDI listener, with the message's time (performance.now() clock). Notes still play the
   * instrument whatever the screen does; on the bass, the screen gets the note as the bass sounds it, and its velocity
   * through the player's touch setup (`rawVelocity` is the keyboard's own, for setting the touch again).
   */
  listen(fn: ((e: MidiEvent, time: number, rawVelocity?: number) => void) | undefined): void;
  /** True once a note has come in from the player's device this session. */
  heardNote: boolean;
}

/** A screen: its element, and what to do when the game leaves it. */
export interface Screen {
  readonly el: HTMLElement;
  dispose?(): void;
}

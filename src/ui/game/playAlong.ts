import { cuesOf, PartJudge, withPalm, type CueResult, type LengthGrade, type LengthMode } from '../../domain/game/performance';
import type { Role } from '../../domain/game/progress';
import type { GameSong } from '../../domain/game/songs';
import { playSong, setUpBand } from './bandPlayer';
import { renderChart } from './chartView';
import type { MidiEvent } from '../../domain/midi/events';
import type { Game } from './game';

const TAIL_MS = 1200; // let the last chord ring before the run ends

export interface AlongHooks {
  /** A cue was judged. */
  onResult?(i: number, r: CueResult, judge: PartJudge): void;
  /** Every frame, with the beat heard now. */
  onFrame?(beat: number, judge: PartJudge): void;
  /** The song is over. */
  onEnd(judge: PartJudge): void;
  /** Every MIDI message, before judging (to show the keys held). */
  onMidi?(e: MidiEvent): void;
  /** A held cue was let go: how its length went. */
  onLength?(i: number, g: LengthGrade, judge: PartJudge): void;
}

/**
 * One play-along: the band plays the song, the player plays their part on their keys, and each cue is judged as it
 * comes. The chart scrolls with the song. Used by a rehearsal run (slowed if asked) and by each song of a gig.
 */
export function playAlong(game: Game, song: GameSong, role: Role,
  opts: { tempo?: number; crowdStart?: number; seed?: number; lengths?: LengthMode; touch?: boolean }, hooks: AlongHooks): {
  chart: HTMLElement;
  stop(): void;
} | undefined {
  setUpBand(game, role);
  const cues = withPalm(cuesOf(song.parts[role]), role === 'bass' ? song.palm ?? [] : []);
  const chart = renderChart(song, role, cues);
  const run = playSong(game, song, { player: role, tempo: opts.tempo, seed: opts.seed });
  if (!run) return undefined;
  const judge = new PartJudge(cues, run.heardAt(0), run.beatMs, opts.crowdStart, { lengths: opts.lengths, touch: opts.touch });
  /** Cues being held: their fill grows on the chart until they are let go. */
  const holding = new Set<number>();
  let wheel = 0;
  // Dev handle: the run in progress, so a test can play the part on its beats.
  if (import.meta.env.DEV) Object.assign(window, { __along: judge });
  let frame = 0;
  let ended = false;

  const report = (i: number | undefined, r: CueResult | undefined) => {
    if (i === undefined || !r) return;
    chart.grade(i, r);
    hooks.onResult?.(i, r, judge);
  };
  game.listen((e, time) => {
    hooks.onMidi?.(e);
    if (ended) return;
    if (e.type === 'cc' && e.controller === 1) wheel = e.value / 127;
    else if (e.type === 'noteOn') {
      const { cue, result } = judge.play(e.note, time, e.velocity, wheel);
      if (cue !== undefined && result?.grade !== 'wrong') holding.add(cue);
      report(cue, result);
    } else if (e.type === 'noteOff') {
      const { cue, length } = judge.release(e.note, time);
      if (cue === undefined) return;
      holding.delete(cue);
      chart.hold(cue, judge.holdShare(cue, time), length);
      if (length) hooks.onLength?.(cue, length, judge);
    }
  });

  const tick = () => {
    const now = performance.now();
    for (const i of judge.settle(now)) report(i, judge.results[i]);
    const beat = run.beatNow();
    chart.scroll(beat);
    chart.focus(judge.current(now));
    for (const i of holding) chart.hold(i, judge.holdShare(i, now));
    hooks.onFrame?.(beat, judge);
    if (judge.finished(now) && now > run.heardAt(run.endBeat) + TAIL_MS) {
      ended = true;
      run.stop();
      hooks.onEnd(judge);
      return;
    }
    frame = requestAnimationFrame(tick);
  };
  chart.scroll(run.beatNow());
  frame = requestAnimationFrame(tick);

  return {
    chart: chart.el,
    stop() {
      ended = true;
      cancelAnimationFrame(frame);
      run.stop();
    },
  };
}

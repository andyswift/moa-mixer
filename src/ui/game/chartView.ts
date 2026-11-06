import type { Cue, CueResult } from '../../domain/game/performance';
import type { Role } from '../../domain/game/progress';
import { noteName } from '../../domain/game/lessons';
import { chordAt, songBeats, type GameSong } from '../../domain/game/songs';
import { h } from './dom';

const PX_PER_BEAT = 90;
const PLAYHEAD_PX = 160;

/** What a cue is called on the chart: the chord's name on the synth, the note on the bass. */
export function cueLabel(song: GameSong, role: Role, c: Cue): string {
  return role === 'synth' ? chordAt(song, c.t)?.name ?? '' : noteName(c.notes[0]!);
}

/**
 * A song's part as a lane scrolling right to left past a playhead: a block per cue, as long as it is held, named
 * after its chord or note, and coloured by its grade once judged. Section names run along the top.
 */
export function renderChart(song: GameSong, role: Role, cues: readonly Cue[]): {
  el: HTMLElement;
  /** Moves the lane so `beat` sits under the playhead. */
  scroll(beat: number): void;
  grade(i: number, r: CueResult): void;
  /** Marks the cue due now. */
  focus(i: number | undefined): void;
} {
  const track = h('div.vr-chart-track', { style: `width: ${songBeats(song) * PX_PER_BEAT}px` });
  for (const s of song.sections) {
    track.append(h('div.vr-chart-section', { style: `left: ${s.from * PX_PER_BEAT}px; width: ${(s.to - s.from) * PX_PER_BEAT}px` }, s.name));
  }
  for (let b = 0; b < song.bars; b++) track.append(h('div.vr-chart-bar', { style: `left: ${b * 4 * PX_PER_BEAT}px` }));
  const blocks = cues.map((c) => {
    const b = h('div.vr-chart-cue', { style: `left: ${c.t * PX_PER_BEAT}px; width: ${Math.max(18, c.len * PX_PER_BEAT - 4)}px` }, cueLabel(song, role, c));
    track.append(b);
    return b;
  });
  let focused: number | undefined;
  return {
    el: h('div.vr-chart', { 'aria-hidden': 'true' }, track, h('div.vr-chart-playhead', { style: `left: ${PLAYHEAD_PX}px` })),
    scroll(beat) {
      track.style.transform = `translateX(${PLAYHEAD_PX - beat * PX_PER_BEAT}px)`;
    },
    grade(i, r) {
      blocks[i]?.classList.add(r.grade);
    },
    focus(i) {
      if (focused === i) return;
      if (focused !== undefined) blocks[focused]?.classList.remove('now');
      focused = i;
      if (i !== undefined) blocks[i]?.classList.add('now');
    },
  };
}

import type { Cue, CueResult, LengthGrade } from '../../domain/game/performance';
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
  /** Shows how long cue i has been held (a share of its written length), and how that went once let go. */
  hold(i: number, share: number, g?: LengthGrade): void;
} {
  const track = h('div.vr-chart-track', { style: `width: ${songBeats(song) * PX_PER_BEAT}px` });
  for (const s of song.sections) {
    track.append(h('div.vr-chart-section', { style: `left: ${s.from * PX_PER_BEAT}px; width: ${(s.to - s.from) * PX_PER_BEAT}px` }, s.name));
  }
  for (let b = 0; b < song.bars; b++) track.append(h('div.vr-chart-bar', { style: `left: ${b * 4 * PX_PER_BEAT}px` }));
  const widths = cues.map((c) => Math.max(c.dead ? 44 : 18, c.len * PX_PER_BEAT - 4)); // a dead note is short, but must read DEAD
  const blocks = cues.map((c, i) => {
    const b = h(`div.vr-chart-cue${c.dead ? '.dead' : ''}${c.palm ? '.palm' : ''}${widths[i]! < 44 && !c.dead ? '.narrow' : ''}` as 'div', { style: `left: ${c.t * PX_PER_BEAT}px; width: ${widths[i]}px` }, c.dead ? 'DEAD' : cueLabel(song, role, c));
    track.append(b);
    return b;
  });
  // the hold bar under each block: how long it has been held, running past the block if held too long
  const holds = cues.map((c) => {
    const bar = h('div.vr-chart-hold', { style: `left: ${c.t * PX_PER_BEAT}px; width: 0px` });
    track.append(bar);
    return bar;
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
    hold(i, share, g) {
      const bar = holds[i];
      if (!bar) return;
      bar.style.width = `${Math.round(Math.min(share, 2) * widths[i]!)}px`;
      if (g) bar.classList.add(g);
    },
    focus(i) {
      if (focused === i) return;
      if (focused !== undefined) blocks[focused]?.classList.remove('now');
      focused = i;
      if (i !== undefined) blocks[i]?.classList.add('now');
    },
  };
}

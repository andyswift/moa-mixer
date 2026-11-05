import { partPlays, type RigSynth } from '../domain/devices/rigSynth';
import { duplicateBlock, insertBlock, moveBlock, removeBlocks, setRepeats, songBlocks, type SongBlock, type SongEdit } from '../domain/sequencer/rigSong';
import { el } from './widgets';

/** What a dragged pattern pad carries. */
export const PATTERN_DRAG = 'application/x-moa-rig-pattern';
const BLOCK_DRAG = 'application/x-moa-rig-block';
/** A block's width for each bar it lasts, px (and at least `MIN_W`). */
const BAR_W = 9, MIN_W = 56, MAX_W = 260;

const button = (cls: string, text: string, label?: string) => {
  const b = el('button', cls, text);
  b.type = 'button';
  if (label) b.setAttribute('aria-label', label);
  return b;
};

/**
 * The song strip at the top of the SEQUENCER page: the song (the chain) as a row of blocks, a block a pattern played
 * so many times, as wide as it is long. The block playing is lit and fills as it plays.
 * - Click a block: pick it (shift: a stretch of blocks) and edit its pattern; the song plays on, and play (space)
 *   starts the song from it next time.
 * - Double-click: play from it (at the end of the pattern playing, or from there when play is pressed).
 * - Drag a block to move it, alt-drag to copy it; drag a pattern pad in to add it there.
 * - − / + change the picked block's repeats; DUP copies it; ✕ (or Delete) takes the picked blocks out.
 * - LOOP plays the picked blocks over and over; SONG / PATTERN: the song, or the edited pattern alone (the song kept);
 *   FOLLOW: the editor goes along with what plays.
 */
export function renderRigSongStrip(rig: RigSynth, now: () => number): HTMLElement & { frame(): void } {
  const seq = rig.seq;
  const strip = el('section', 'rig-section rig-song') as unknown as HTMLElement & { frame(): void };
  strip.style.setProperty('--rig-accent', '#d6ef6a');

  const head = el('div', 'rig-song-head');
  const title = el('h3', 'rig-title', 'SONG');
  const songMode = button('rig-small', 'SONG', 'Play the song');
  const patternMode = button('rig-small', 'PATTERN', 'Loop the edited pattern (the song is kept)');
  songMode.addEventListener('click', () => seq.setMode('song'));
  patternMode.addEventListener('click', () => { if (seq.editing !== seq.current || seq.mode === 'song') seq.queue(seq.editing); seq.setMode('pattern'); });
  const loop = button('rig-small', 'LOOP', 'Loop the picked blocks');
  loop.addEventListener('click', () => {
    if (seq.loop) { seq.setLoop(); return; }
    const r = range();
    if (r) seq.setLoop({ from: r.first.start, to: r.last.start + r.last.count - 1 });
  });
  const follow = button('rig-small', 'FOLLOW', 'The editor shows the pattern playing');
  follow.addEventListener('click', () => {
    seq.follow = !seq.follow;
    if (seq.follow) seq.editing = seq.current;
    seq.notify();
  });
  const less = button('rig-small', '−', 'Play the picked block fewer times');
  const more = button('rig-small', '+', 'Play the picked block more times');
  const times = el('output', 'rig-readout rig-song-times');
  const dup = button('rig-small', 'DUP', 'Copy the picked block after it');
  const del = button('rig-small', '✕', 'Take the picked blocks out of the song');
  less.addEventListener('click', () => { const r = range(); if (r) apply(setRepeats(seq.chain, r.a, r.first.count - 1), r.a); });
  more.addEventListener('click', () => { const r = range(); if (r) apply(setRepeats(seq.chain, r.a, r.first.count + 1), r.a); });
  dup.addEventListener('click', () => { const r = range(); if (r) apply(duplicateBlock(seq.chain, r.a), r.a + 1); });
  del.addEventListener('click', () => removePicked());
  const where = el('span', 'rig-song-where');
  const group = (...nodes: HTMLElement[]) => { const g = el('div', 'rig-song-group'); g.append(...nodes); return g; };
  head.append(title, group(songMode, patternMode), group(loop, follow), group(less, times, more, dup, del), where);

  const lane = el('div', 'rig-song-blocks');
  lane.tabIndex = 0;
  lane.setAttribute('aria-label', 'Song');
  const marker = el('div', 'rig-song-marker');
  strip.append(head, lane);

  /** The block lit as playing (its index), -1 for none. */
  let lit = -1;
  /** The picked blocks: anchor and other end (block indices). */
  let pick: { a: number; b: number } | undefined;
  let blocks: SongBlock[] = [];
  let views: { el: HTMLElement; fill: HTMLElement }[] = [];
  function range() {
    if (!pick || !blocks.length) return undefined;
    const a = Math.min(pick.a, pick.b, blocks.length - 1), b = Math.min(Math.max(pick.a, pick.b), blocks.length - 1);
    return { a, b, first: blocks[a]!, last: blocks[b]! };
  }
  function apply(edit: SongEdit, picked?: number): void {
    seq.editSong(edit);
    pick = picked === undefined ? undefined : { a: picked, b: picked };
    seq.notify();
  }
  function removePicked(): void {
    const r = range();
    if (r) apply(removeBlocks(seq.chain, r.a, r.b), blocks.length - (r.b - r.a + 1) > 0 ? Math.min(r.a, blocks.length - (r.b - r.a + 1) - 1) : undefined);
  }
  strip.addEventListener('keydown', (e) => {
    if (e.key === 'Delete' || e.key === 'Backspace') { e.preventDefault(); removePicked(); }
    else if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') {
      e.preventDefault();
      const r = range(), d = e.key === 'ArrowLeft' ? -1 : 1;
      if (r && e.altKey) apply(moveBlock(seq.chain, r.a, d < 0 ? r.a - 1 : r.a + 2), Math.max(0, Math.min(blocks.length - 1, r.a + d)));
      else if (blocks.length) { const i = Math.max(0, Math.min(blocks.length - 1, (r?.a ?? -1) + d)); pick = { a: i, b: i }; seq.select(blocks[i]!.pattern); }
    }
  });

  // ---- dragging: where a drop would go, as a block index to stand before
  const dropAt = (x: number): number => {
    for (let i = 0; i < views.length; i++) {
      const r = views[i]!.el.getBoundingClientRect();
      if (x < r.left + r.width / 2) return i;
    }
    return views.length;
  };
  const showMarker = (at: number) => {
    const ref = views[at]?.el;
    const lr = lane.getBoundingClientRect();
    const x = ref ? ref.getBoundingClientRect().left : (views.at(-1)?.el.getBoundingClientRect().right ?? lr.left) + 2;
    marker.style.left = `${x - lr.left + lane.scrollLeft - 3}px`;
    if (!marker.isConnected) lane.append(marker);
  };
  lane.addEventListener('dragover', (e) => {
    const types = e.dataTransfer?.types ?? [];
    if (!types.includes(BLOCK_DRAG) && !types.includes(PATTERN_DRAG)) return;
    e.preventDefault();
    if (e.dataTransfer) e.dataTransfer.dropEffect = types.includes(PATTERN_DRAG) || e.altKey ? 'copy' : 'move';
    showMarker(dropAt(e.clientX));
  });
  lane.addEventListener('dragleave', (e) => { if (!lane.contains(e.relatedTarget as Node)) marker.remove(); });
  lane.addEventListener('drop', (e) => {
    marker.remove();
    const dt = e.dataTransfer;
    if (!dt) return;
    e.preventDefault();
    const at = dropAt(e.clientX);
    const pattern = dt.getData(PATTERN_DRAG), block = dt.getData(BLOCK_DRAG);
    if (pattern !== '') { apply(insertBlock(seq.chain, at, Number(pattern)), at); return; }
    if (block === '') return;
    const from = Number(block), b = blocks[from];
    if (!b) return;
    if (e.altKey) apply(insertBlock(seq.chain, at, b.pattern, b.count), at);
    else apply(moveBlock(seq.chain, from, at), at > from ? at - 1 : at);
  });

  function build(): void {
    blocks = songBlocks(seq.chain);
    lit = -1;
    if (pick && pick.a >= blocks.length) pick = undefined;
    views = blocks.map((b, i) => {
      const p = seq.patterns[b.pattern]!;
      const bars = (p.length || 16) / 16;
      const v = el('div', 'rig-song-block');
      v.draggable = true;
      v.style.width = `${Math.min(MAX_W, Math.max(MIN_W, bars * b.count * BAR_W))}px`;
      const parts = p.tracks.flatMap((t, k) => (t.steps.some((s) => s.notes.length) && partPlays(rig.parts[k]!) ? [k + 1] : []));
      v.title = `Pattern ${b.pattern + 1} ×${b.count} · ${bars * b.count} bar${bars * b.count === 1 ? '' : 's'}\nParts: ${parts.join(' ') || 'none'}\nDouble-click: play from here. Drag: move (alt: copy).`;
      const fill = el('div', 'rig-song-fill');
      v.append(fill, el('span', 'rig-song-num', String(b.pattern + 1)), el('span', 'rig-song-count', b.count > 1 ? `×${b.count}` : ''),
        el('span', 'rig-song-parts', `${parts.length} PT · ${bars * b.count} BAR${bars * b.count === 1 ? '' : 'S'}`));
      v.addEventListener('click', (e) => {
        pick = e.shiftKey && pick ? { a: pick.a, b: i } : { a: i, b: i };
        lane.focus({ preventScroll: true });
        seq.setCue(b.start); // play (space) starts the song here
        seq.select(b.pattern);
        sync();
      });
      v.addEventListener('dblclick', () => seq.jumpTo(b.start));
      v.addEventListener('dragstart', (e) => {
        e.dataTransfer?.setData(BLOCK_DRAG, String(i));
        if (e.dataTransfer) e.dataTransfer.effectAllowed = 'copyMove';
        v.classList.add('dragging');
      });
      v.addEventListener('dragend', () => { v.classList.remove('dragging'); marker.remove(); });
      return { el: v, fill };
    });
    const end = el('div', 'rig-song-end', blocks.length ? '+' : 'DRAG PATTERNS HERE (OR SHIFT-CLICK THEM) TO MAKE THE SONG');
    lane.replaceChildren(...views.map((v) => v.el), end);
  }

  let built = '';
  function sync(): void {
    const key = `${seq.chain.join(',')}|${seq.patterns.map((p) => p.length).join(',')}|${rig.parts.map((p) => p.kind + p.voices).join(',')}`;
    if (key !== built) { built = key; build(); }
    const r = range();
    const pos = seq.songPos;
    blocks.forEach((b, i) => {
      const v = views[i]!.el;
      v.classList.toggle('picked', !!r && i >= r.a && i <= r.b);
      v.classList.toggle('editing', b.pattern === seq.editing);
      v.classList.toggle('cue', !seq.isPlaying && seq.songMode && pos >= b.start && pos < b.start + b.count);
      v.classList.toggle('looped', !!seq.loop && b.start >= seq.loop.from && b.start <= seq.loop.to);
      v.classList.toggle('jump', seq.songJump !== undefined && seq.songJump >= b.start && seq.songJump < b.start + b.count);
      v.classList.toggle('off', !seq.songMode);
    });
    songMode.classList.toggle('on', seq.mode === 'song');
    patternMode.classList.toggle('on', seq.mode === 'pattern');
    loop.classList.toggle('on', !!seq.loop);
    loop.disabled = !seq.loop && !r;
    follow.classList.toggle('on', seq.follow);
    for (const b of [less, more, dup, del]) b.disabled = !r;
    less.disabled = !r || r.first.count <= 1;
    times.textContent = r ? `×${r.first.count}` : '';
    const bars = blocks.reduce((s, b) => s + ((seq.patterns[b.pattern]!.length || 16) / 16) * b.count, 0);
    const secs = (bars * 4 * 60) / rig.bpm;
    where.textContent = seq.chain.length
      ? `${blocks.length} BLOCK${blocks.length === 1 ? '' : 'S'} · ${bars} BARS · ${Math.floor(secs / 60)}:${String(Math.round(secs % 60)).padStart(2, '0')}`
        + (seq.editing !== seq.current ? ` · EDITING ${seq.editing + 1}, PLAYING ${seq.current + 1}` : '')
      : '';
  }
  seq.onChange(sync);
  rig.onPartChange(sync);
  sync();

  // ---- the playing block lit and filling as it plays
  strip.frame = () => {
    const at = seq.songAt(now());
    const playing = at && at.pos >= 0 && seq.songMode ? blocks.findIndex((b) => at.pos >= b.start && at.pos < b.start + b.count) : -1;
    if (playing !== lit) {
      if (lit >= 0 && views[lit]) { views[lit]!.el.classList.remove('playing'); views[lit]!.fill.style.width = '0'; }
      if (playing >= 0) views[playing]!.el.classList.add('playing');
      lit = playing;
    }
    if (playing >= 0 && at) {
      const b = blocks[playing]!;
      views[playing]!.fill.style.width = `${((at.pos - b.start + at.fraction) / b.count) * 100}%`;
    }
  };
  return strip;
}

/**
 * A pattern pad (the SEQUENCER page's and the side panel's): click to edit the pattern (the song plays on; in PATTERN
 * mode it plays next), shift-click to add it to the end of the song, drag it into the song strip to put it there.
 */
export function patternPad(rig: RigSynth, b: HTMLElement, i: number): void {
  b.title = 'Click: edit this pattern (in PATTERN mode, play it next). Shift-click: add it to the end of the song. Drag it into the song.';
  b.draggable = true;
  b.addEventListener('click', (e) => {
    if (e.shiftKey) rig.seq.editSong(insertBlock(rig.seq.chain, songBlocks(rig.seq.chain).length, i));
    else rig.seq.select(i);
  });
  b.addEventListener('dragstart', (e) => {
    e.dataTransfer?.setData(PATTERN_DRAG, String(i));
    if (e.dataTransfer) e.dataTransfer.effectAllowed = 'copy';
  });
}

/** A pattern pad's state: playing, edited, queued, in the song, with notes in it. */
export function syncPatternPad(rig: RigSynth, b: HTMLElement, i: number): void {
  const seq = rig.seq;
  b.classList.toggle('now', i === seq.current);
  b.classList.toggle('editing', i === seq.editing);
  b.classList.toggle('next', i === seq.next);
  b.classList.toggle('chained', seq.chain.includes(i));
  b.classList.toggle('used', seq.patterns[i]!.tracks.some((t) => t.steps.some((s) => s.notes.length || Object.keys(s.locks).length)));
}

import { NumberControl } from '../domain/devices/controls';
import { RIG_FIRST_PAD_NOTE, RIG_PAD_ORDER } from '../domain/devices/rigKit';
import { RIG_PARAMS } from '../domain/devices/rigParams';
import { partPlays, RIG_PARTS, type RigSynth } from '../domain/devices/rigSynth';
import {
  copyNotes, deleteNotes, moveNotes, notesIn, notesOfPitch, nudgeVelocity, pasteNotes, readNotes, resizeNotes, rollKey, writeNotes,
  type RollClip, type RollNote,
} from '../domain/sequencer/pianoRoll';
import {
  cloneRigPattern, newStep, RIG_CLOCKS, RIG_DIRECTIONS, RIG_MAX_STEPS, RIG_PATTERNS, type RigPattern, type RigStep,
} from '../domain/sequencer/rigSequencer';
import { patternPad, renderRigSongStrip, syncPatternPad } from './rigSongStrip';
import { el, renderKnob } from './widgets';

/**
 * The MOA-RIG's sequencer, plain for now (the SEQUENCER page's design replaces it): transport, patterns and the
 * chain, a lane per part with sixteen steps a page, and the selected step's values and locks.
 *
 * Click an empty step to put a note in it (the last one entered on that track), a full one to select it, the
 * selected one to empty it. A step's note: play it while the step is selected (stopped), turn NOTE, or move it with
 * the mouse wheel or the up and down keys over the step (shift for octaves). LOCK holds the selected step: the
 * synth's controls then lock onto it.
 */
const PAGE = 16;
const DIR_LABELS: Record<string, string> = { fwd: 'FWD', rev: 'REV', pingpong: 'P-P', random: 'RND' };
const NOTE_NAMES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];
const noteName = (n: number) => `${NOTE_NAMES[n % 12]}${Math.floor(n / 12) - 1}`;
const PARAM_LABELS = new Map(RIG_PARAMS.map((p) => [p.id, p]));

/** How a lock reads: the param's label and its value (a choice by its option). */
function lockText(id: string, v: number): string {
  const p = PARAM_LABELS.get(id);
  if (!p) return `${id} ${v}`;
  const value = p.kind === 'choice' ? p.options![Math.round(v)] : p.kind === 'toggle' ? (v >= 0.5 ? 'on' : 'off') : `${+v.toFixed(3)}${p.unit ? ` ${p.unit}` : ''}`;
  return `${p.label}: ${value}`;
}

const button = (cls: string, text: string, label?: string) => {
  const b = el('button', cls, text);
  b.type = 'button';
  if (label) b.setAttribute('aria-label', label);
  return b;
};

const select = (label: string, options: [string, string][], onChange: (v: string) => void) => {
  const s = el('select');
  s.setAttribute('aria-label', label);
  for (const [text, value] of options) s.add(new Option(text, value));
  s.addEventListener('change', () => onChange(s.value));
  return s;
};

export function renderRigSeqPanel(rig: RigSynth, now: () => number): HTMLElement {
  const seq = rig.seq;
  const panel = el('div', 'rig-panel rig-seq');
  panel.style.setProperty('--rig-accent', '#d6ef6a');
  let page = 0;
  let clipboard: RigPattern | undefined;
  const lastNote = new Array<number>(RIG_PARTS).fill(60);
  const track = () => seq.pattern.tracks[rig.part]!;
  /** A note as a part shows it: a kit part by its pad's name. */
  const noteOf = (p: number, n: number) => {
    const kit = rig.parts[p]!.kind === 'kit' ? rig.parts[p]!.kit : undefined;
    return kit ? kit.pads[n - RIG_FIRST_PAD_NOTE]?.name ?? noteName(n) : noteName(n);
  };
  const changed = () => seq.notify();

  // ---- the song, then the transport and patterns
  const song = renderRigSongStrip(rig, now);
  const bar = el('div', 'rig-setup rig-seq-bar');
  const play = button('rig-key rig-seq-play', 'PLAY');
  play.addEventListener('click', () => (seq.isPlaying ? rig.stop() : rig.play()));
  const rec = button('rig-key rig-seq-rec', 'REC');
  rec.addEventListener('click', () => rig.setRecording(!rig.isRecording));
  const click = button('rig-key rig-seq-click', 'CLICK', 'Metronome: a click on each beat while playing');
  click.addEventListener('click', () => { rig.metronome = !rig.metronome; });
  const tempo = new NumberControl('seq.tempo', 'Tempo', 40, 240, rig.bpm, 'BPM', (v) => { rig.bpm = v; });
  const shuffle = new NumberControl('seq.shuffle', 'Shuffle', 0, 50, seq.shuffle * 100, '%', (v) => { seq.shuffle = v / 100; seq.notify(); });
  const length = select('Pattern length', [['FREE', '0'], ...[16, 32, 48, 64, 96, 128, 192, 256].map((n): [string, string] => [`${n / 16} BAR${n > 16 ? 'S' : ''}`, String(n)])],
    (v) => { seq.pattern.length = Number(v); changed(); });
  const pads = el('div', 'rig-seq-pads');
  const padButtons = Array.from({ length: RIG_PATTERNS }, (_, i) => {
    const b = button('rig-seq-pad', String(i + 1), `Pattern ${i + 1}`);
    patternPad(rig, b, i);
    pads.append(b);
    return b;
  });
  const copy = button('rig-small rig-wide', 'COPY');
  copy.addEventListener('click', () => { clipboard = cloneRigPattern(seq.pattern); });
  const paste = button('rig-small rig-wide', 'PASTE');
  paste.addEventListener('click', () => { if (clipboard) { seq.patterns[seq.editing] = cloneRigPattern(clipboard); changed(); } });
  const pageButtons = [0, 1, 2, 3].map((k) => {
    const b = button('rig-small', `${k * PAGE + 1}–${(k + 1) * PAGE}`, `Steps ${k * PAGE + 1} to ${(k + 1) * PAGE}`);
    b.addEventListener('click', () => { page = k; sync(); });
    return b;
  });
  const field = (label: string, ...nodes: HTMLElement[]) => {
    const f = el('div', 'rig-field');
    f.append(el('span', 'knob-label', label), ...nodes);
    return f;
  };
  bar.append(
    play, rec, click, renderKnob(tempo, 'Sequencer', 'TEMPO', 30), renderKnob(shuffle, 'Sequencer', 'SHUFFLE', 30),
    field('Pattern', pads), field('Length', length), field('', copy, paste), field('Steps', ...pageButtons),
  );

  // ---- a lane per part
  const lanes = el('div', 'rig-seq-lanes');
  const lane = Array.from({ length: RIG_PARTS }, (_, p) => {
    const row = el('div', 'rig-seq-lane');
    const name = button('rig-seq-name', '', `Edit part ${p + 1}`);
    name.addEventListener('click', () => rig.selectStep(p, -1)); // the part, and no step: the keys just play
    const mute = button('rig-small', 'M', `Mute track ${p + 1}`);
    mute.addEventListener('click', () => { const t = seq.pattern.tracks[p]!; t.muted = !t.muted; changed(); });
    const solo = button('rig-small', 'S', `Solo track ${p + 1}`);
    solo.addEventListener('click', () => { const t = seq.pattern.tracks[p]!; t.solo = !t.solo; changed(); });
    const cells = Array.from({ length: PAGE }, (_, c) => {
      const b = button('rig-seq-cell', '');
      b.addEventListener('click', () => clickStep(p, page * PAGE + c));
      b.addEventListener('wheel', (e) => {
        if (!seq.pattern.tracks[p]!.steps[page * PAGE + c]?.notes.length) return;
        e.preventDefault();
        rig.transposeStep(p, page * PAGE + c, Math.sign(-e.deltaY) * (e.shiftKey ? 12 : 1));
      }, { passive: false });
      b.addEventListener('keydown', (e) => {
        if (e.key !== 'ArrowUp' && e.key !== 'ArrowDown') return;
        e.preventDefault();
        rig.transposeStep(p, page * PAGE + c, (e.key === 'ArrowUp' ? 1 : -1) * (e.shiftKey ? 12 : 1));
      });
      return b;
    });
    const steps = el('div', 'rig-seq-cells');
    steps.append(...cells);
    const len = select(`Track ${p + 1} length`, Array.from({ length: RIG_MAX_STEPS }, (_, i): [string, string] => [String(i + 1), String(i + 1)]),
      (v) => { seq.pattern.tracks[p]!.length = Number(v); changed(); });
    const clk = select(`Track ${p + 1} clock`, RIG_CLOCKS.map(([label, ticks]): [string, string] => [label, String(ticks)]),
      (v) => { seq.pattern.tracks[p]!.clock = Number(v); changed(); });
    const dir = select(`Track ${p + 1} direction`, RIG_DIRECTIONS.map((d): [string, string] => [DIR_LABELS[d]!, d]),
      (v) => { seq.pattern.tracks[p]!.direction = v as typeof RIG_DIRECTIONS[number]; changed(); });
    const prob = select(`Track ${p + 1} probability`, Array.from({ length: 11 }, (_, i): [string, string] => [`${100 - i * 10}%`, String(1 - i / 10)]),
      (v) => { seq.pattern.tracks[p]!.prob = Number(v); changed(); });
    row.append(name, mute, solo, steps, len, clk, dir, prob);
    lanes.append(row);
    return { row, name, mute, solo, cells, len, clk, dir, prob, lit: -1 };
  });

  function clickStep(p: number, i: number): void {
    const t = seq.pattern.tracks[p]!;
    const s = t.steps[i]!;
    const selected = p === rig.part && i === rig.step;
    const kit = rig.parts[p]!.kind === 'kit';
    if (kit && (lastNote[p]! < RIG_FIRST_PAD_NOTE || lastNote[p]! >= RIG_FIRST_PAD_NOTE + 16)) lastNote[p] = RIG_FIRST_PAD_NOTE;
    if (!s.notes.length) { s.notes = [lastNote[p]!]; rig.selectStep(p, i); }
    else if (selected) s.notes = [];
    else rig.selectStep(p, i);
    changed();
  }

  const typing = (e: KeyboardEvent) => {
    const t = e.target as HTMLElement | null;
    return !!t && (t.tagName === 'INPUT' || t.tagName === 'SELECT' || t.tagName === 'TEXTAREA' || t.isContentEditable);
  };
  // space starts and stops the sequencer (not on a key of the keyboard bed, which plays it, nor in a field)
  let spaceHandled = false;
  document.addEventListener('keydown', (e) => {
    if (e.key !== ' ' || e.defaultPrevented || typing(e) || e.altKey || e.metaKey || e.ctrlKey) return;
    e.preventDefault();
    spaceHandled = true;
    if (!e.repeat) { if (seq.isPlaying) rig.stop(); else rig.play(); }
  });
  // a focused button would be clicked by the space's key-up too
  document.addEventListener('keyup', (e) => { if (e.key === ' ' && spaceHandled) { spaceHandled = false; e.preventDefault(); } }, true);

  // ---- the piano roll: a synth part's notes, pitch up the side and the track's steps across, each note as long as it
  // lasts. Edits go on a selection, as in a DAW: pick notes (a click, shift-click, a box dragged round them, a key of
  // the keyboard for every note of its pitch, ⌘A), then move, stretch, copy or delete them together; ⌘Z takes it back.
  // A kit's part gets the same roll as a drum roll: its pads down the side (in a drum machine's order), its hits a step
  // wide, DRAW on to start (a click puts a hit in or takes it out, a drag paints along the row).
  const ROLL_LO = 24, ROLL_HI = 108, ROW = 12, PAD_ROW = 20; // C1 to C8
  /** A kit's rows, top first: its pads as a drum machine lays them out. */
  const PAD_ROWS = RIG_PAD_ORDER.map((pad) => RIG_FIRST_PAD_NOTE + pad);
  const roll = el('section', 'rig-section rig-piano-roll');
  const rollTitle = el('h3', 'rig-title');
  const rollView = el('div', 'rig-roll-view');
  const rollKeys = el('div', 'rig-roll-keys');
  const rollGrid = el('div', 'rig-roll-grid');
  const rollLines = el('div', 'rig-roll-lines');
  const rollNotes = el('div', 'rig-roll-notes');
  const rollBox = el('div', 'rig-roll-box');
  const rollPlay = el('div', 'rig-roll-playhead');
  rollBox.hidden = true;
  rollGrid.append(rollLines, rollNotes, rollBox, rollPlay);
  rollView.append(rollKeys, rollGrid);
  // the tools
  const drawBtn = button('rig-small rig-roll-tool', 'DRAW', 'Draw: a click puts a note in, a drag sets its length (B)');
  const foldBtn = button('rig-small rig-roll-tool', 'FOLD', 'Fold: only the pitches that have notes');
  const dupBtn = button('rig-small rig-roll-tool', 'DUPLICATE', 'Duplicate the selection after itself (⌘D)');
  const delBtn = button('rig-small rig-roll-tool', 'DELETE', 'Delete the selection (⌫)');
  const undoBtn = button('rig-small rig-roll-tool', 'UNDO', 'Undo (⌘Z)');
  const redoBtn = button('rig-small rig-roll-tool', 'REDO', 'Redo (⇧⌘Z)');
  const selInfo = el('span', 'rig-readout');
  const rollTools = el('div', 'rig-field rig-roll-tools');
  rollTools.append(drawBtn, foldBtn, dupBtn, delBtn, undoBtn, redoBtn, selInfo);
  const rollHint = el('p', 'rig-seq-hint');
  roll.append(rollTitle, rollTools, rollView, rollHint);
  const NOTE_HINT = 'Select: click a note (shift: more), drag a box round notes, click a key for every note of its pitch, ⌘A for all, Esc for none. '
    + 'Drag the selection to move it (alt: a copy), its right edge to lengthen it; ← → a step, ↑ ↓ a semitone (shift: an octave; shift ← →: length); '
    + 'the wheel over it is its velocity. Double-click: a note in, or a note out. ⌘C ⌘X ⌘V (where you last clicked), ⌘D duplicates, ⌫ deletes, ⌘Z / ⇧⌘Z undo and redo. '
    + 'DRAW (B): a click puts a note in.';
  const KIT_HINT = 'DRAW (B): click a cell for a hit or to take one out; drag along a row to paint hits (or rub them out). '
    + 'Press a pad’s name to hear it and select its hits (shift: more pads); ↑ ↓ then move whole rows (a row they pass swaps past). '
    + 'DRAW off: click a hit (shift: more), drag a box round hits, ⌘A, Esc; drag the selection to move it (alt: a copy); ← → a step, ↑ ↓ a pad. '
    + 'Wheel over a hit (or the selection): velocity. ⌘C ⌘X ⌘V, ⌘D duplicates, ⌫ deletes, ⌘Z / ⇧⌘Z undo and redo.';

  let draw = false, drawKit = true, fold = false;
  const isKit = () => rig.parts[rig.part]!.kind === 'kit';
  const drawing = () => (isKit() ? drawKit : draw);
  const toggleDraw = () => { if (isKit()) drawKit = !drawKit; else draw = !draw; drawRoll(); };
  /** Up and down go by these rows (lowest first) on a kit; by semitones (undefined) on a synth. */
  const order = () => (isKit() ? [...PAD_ROWS].reverse() : undefined);
  /** A kit's hits show (and are picked) a step wide, whatever their gate. */
  const shown = (notes: RollNote[]) => (isKit() ? notes.map((n) => ({ ...n, gate: 1 })) : notes);
  /** Pads picked by their names: while the selection is all their hits, ↑ ↓ swap the rows (as a drum machine does). */
  let rowSel: number[] = [];
  let rowH = ROW, rowsSig = '';
  let selected = new Set<string>();
  let clip: RollClip | undefined;
  let insertAt = -1; // where a paste goes: where the grid was last clicked (a step), or after what was copied
  let rollGate = 1; // the length a drawn note gets: the last one set
  let rollPart = -1, rollMid = 60, rollActive = false;
  /** Undo and redo, per track: the notes before each edit. */
  const history = new Map<number, { undo: RollNote[][]; redo: RollNote[][] }>();
  const hist = () => { let h = history.get(rig.part); if (!h) history.set(rig.part, h = { undo: [], redo: [] }); return h; };
  /** The pitches shown, top to bottom: all of them, or (folded) only those with notes. */
  let pitches: number[] = [];
  const rowOf = new Map<number, number>();
  const notesNow = () => readNotes(track());
  /** Writes notes (an edit), keeping `before` to undo it. */
  const commit = (before: RollNote[], after: RollNote[], sel?: Set<string>) => {
    if (sel) selected = sel; // before the redraw, which keeps only notes still there
    const h = hist();
    h.undo.push(before);
    if (h.undo.length > 200) h.undo.shift();
    h.redo = [];
    writeNotes(track(), after);
    changed();
  };
  const apply = (after: RollNote[], sel?: Set<string>) => { if (sel) selected = sel; writeNotes(track(), after); changed(); };
  const undo = (redo: boolean) => {
    const h = hist(), from = redo ? h.redo : h.undo, to = redo ? h.undo : h.redo;
    const notes = from.pop();
    if (!notes) return;
    to.push(notesNow());
    selected = new Set();
    rowSel = [];
    apply(notes);
  };
  let heard = -1;
  const hear = (n: number) => { if (heard === n) return; if (heard >= 0) rig.audition(heard, false); heard = n; if (n >= 0) rig.audition(n, true); };

  /** Where a pointer is on the grid: the step (fractional) and the pitch of its row. */
  const rollAt = (e: MouseEvent) => {
    const r = rollGrid.getBoundingClientRect();
    const x = Math.min(0.9999, Math.max(0, (e.clientX - r.left) / r.width)) * track().length;
    const row = Math.min(pitches.length - 1, Math.max(0, Math.floor((e.clientY - r.top) / rowH)));
    return { x, step: Math.floor(x), note: pitches[row] ?? 60, row };
  };
  const noteAt = (e: Event) => {
    const t = (e.target as HTMLElement).closest<HTMLElement>('.rig-roll-note');
    return t ? { step: Number(t.dataset.step), note: Number(t.dataset.note), edge: (e.target as HTMLElement).classList.contains('rig-roll-edge') } : undefined;
  };
  const addAt = (step: number, note: number) => {
    const before = notesNow();
    const after = [...before.filter((n) => !(n.step === step && n.note === note)), { step, note, gate: rollGate, vel: track().steps[step]?.vel ?? 0.8 }];
    commit(before, after, new Set([rollKey({ step, note })]));
  };

  type Drag =
    | { mode: 'move'; x0: number; row0: number; note0: number; before: RollNote[]; sel: Set<string>; copy: boolean; moved: boolean; key: string }
    | { mode: 'length'; x0: number; before: RollNote[]; sel: Set<string>; moved: boolean; drawn: boolean }
    | { mode: 'box'; x0: number; y0: number; base: Set<string>; notes: RollNote[] }
    | { mode: 'paint'; note: number; on: boolean; last: number; before: RollNote[] };
  let drag: Drag | undefined;
  document.addEventListener('pointerdown', (e) => { rollActive = roll.contains(e.target as Node); }, true);
  // a double-click, told by hand: the browser's needs both clicks on one element, and the first click redraws the notes
  let lastDown = { t: 0, x: 0, y: 0 };
  const doubleClick = (e: PointerEvent) => {
    const now = performance.now(), dbl = now - lastDown.t < 350 && Math.hypot(e.clientX - lastDown.x, e.clientY - lastDown.y) < 5;
    lastDown = dbl ? { t: 0, x: 0, y: 0 } : { t: now, x: e.clientX, y: e.clientY };
    return dbl;
  };
  rollGrid.addEventListener('pointerdown', (e) => {
    if (e.button !== 0) return;
    const at = rollAt(e), hit = noteAt(e);
    rowSel = [];
    if (doubleClick(e) && !drawing() && !e.shiftKey) {
      // a note out, or (on an empty place) a note in
      drag = undefined;
      const under = shown(notesNow()).find((n) => n.note === at.note && at.x >= n.step && at.x < n.step + Math.max(n.gate, 0.25));
      if (under) { const before = notesNow(); commit(before, deleteNotes(before, new Set([rollKey(under)])), new Set()); }
      else addAt(at.step, at.note);
      return;
    }
    rollGrid.setPointerCapture(e.pointerId);
    if (isKit() && drawKit && !e.shiftKey) {
      // a hit in or out, and on along the row as the pointer goes
      insertAt = at.step;
      const before = notesNow(), on = !before.some((n) => n.step === at.step && n.note === at.note);
      drag = { mode: 'paint', note: at.note, on, last: at.step, before };
      paint(at.step, at.step);
      if (on) hear(at.note);
    } else if (hit) {
      const key = rollKey(hit);
      if (e.shiftKey && !hit.edge) {
        // shift: in or out of the selection
        selected = new Set(selected);
        if (selected.has(key)) selected.delete(key); else selected.add(key);
        drawRoll();
        return;
      }
      if (!selected.has(key)) selected = new Set([key]);
      const before = notesNow();
      if (hit.edge) drag = { mode: 'length', x0: at.x, before, sel: selected, moved: false, drawn: false };
      else {
        drag = { mode: 'move', x0: at.x, row0: at.row, note0: hit.note, before, sel: selected, copy: e.altKey, moved: false, key };
        hear(hit.note);
      }
      rig.selectStep(rig.part, hit.step);
      drawRoll();
    } else if (draw && !isKit()) {
      insertAt = at.step;
      addAt(at.step, at.note);
      hear(at.note);
      drag = { mode: 'length', x0: at.step + rollGate, before: notesNow(), sel: selected, moved: false, drawn: true };
    } else {
      // a box round notes, from here
      insertAt = at.step;
      const r = rollGrid.getBoundingClientRect();
      drag = { mode: 'box', x0: e.clientX - r.left, y0: e.clientY - r.top, base: e.shiftKey ? selected : new Set(), notes: shown(notesNow()) };
      if (!e.shiftKey) { selected = new Set(); drawRoll(); }
    }
  });
  /** Puts hits in (or takes them out) along the painted row, from one step to another. */
  const paint = (from: number, to: number) => {
    if (drag?.mode !== 'paint') return;
    const { note, on } = drag, steps = new Set<number>();
    for (let i = Math.min(from, to); i <= Math.max(from, to); i++) steps.add(i);
    const rest = notesNow().filter((n) => !(n.note === note && steps.has(n.step)));
    const t = track();
    apply(on ? [...rest, ...[...steps].map((step) => ({ step, note, gate: t.steps[step]?.gate ?? 1, vel: t.steps[step]?.vel ?? 0.8 }))] : rest);
  };
  rollGrid.addEventListener('pointermove', (e) => {
    if (!drag) return;
    const at = rollAt(e);
    if (drag.mode === 'paint') {
      if (at.step !== drag.last) { paint(drag.last, at.step); drag.last = at.step; }
    } else if (drag.mode === 'move') {
      const ds = Math.round(at.x - drag.x0);
      // up and down by rows: folded, a row is the next pitch that has notes; on a kit, a row is a pad
      const target = pitches[Math.min(pitches.length - 1, Math.max(0, at.row))] ?? drag.note0;
      const ord = order();
      const dn = ord ? ord.indexOf(target) - ord.indexOf(drag.note0) : fold ? target - drag.note0 : drag.row0 - at.row;
      if (!ds && !dn && !drag.moved) return;
      const r = moveNotes(drag.before, drag.sel, ds, dn, track().length, drag.copy, ord);
      drag.moved = true;
      apply(r.notes, r.selected);
      hear(ord ? target : drag.note0 + dn);
    } else if (drag.mode === 'length') {
      const by = Math.round((at.x - drag.x0) * 4) / 4;
      if (!by && !drag.moved) return;
      const after = resizeNotes(drag.before, drag.sel, by);
      drag.moved = true;
      apply(after);
      const one = after.find((n) => drag!.mode === 'length' && drag!.sel.has(rollKey(n)));
      if (one) rollGate = one.gate;
    } else {
      const r = rollGrid.getBoundingClientRect(), x = e.clientX - r.left, y = e.clientY - r.top;
      const left = Math.min(x, drag.x0), top = Math.min(y, drag.y0);
      Object.assign(rollBox.style, { left: `${left}px`, top: `${top}px`, width: `${Math.abs(x - drag.x0)}px`, height: `${Math.abs(y - drag.y0)}px` });
      rollBox.hidden = false;
      const len = track().length, stepOf = (px: number) => (px / r.width) * len;
      const rowA = Math.max(0, Math.floor(top / rowH)), rowB = Math.min(pitches.length - 1, Math.floor((top + Math.abs(y - drag.y0)) / rowH));
      const inBox = notesIn(drag.notes, stepOf(left), stepOf(left + Math.abs(x - drag.x0)), pitches.slice(rowA, rowB + 1));
      selected = new Set([...drag.base, ...inBox]);
      drawRoll();
    }
  });
  const endDrag = () => {
    if (!drag) return;
    if (drag.mode === 'paint' || ((drag.mode === 'move' || drag.mode === 'length') && drag.moved)) {
      const h = hist();
      if (!(drag.mode === 'length' && drag.drawn)) { h.undo.push(drag.before); h.redo = []; }
    }
    rollBox.hidden = true;
    drag = undefined;
    hear(-1);
    drawRoll();
  };
  rollGrid.addEventListener('pointerup', endDrag);
  rollGrid.addEventListener('pointercancel', endDrag);
  let wheelAt = 0;
  rollGrid.addEventListener('wheel', (e) => {
    const hit = noteAt(e);
    if (!hit) return;
    e.preventDefault();
    const key = rollKey(hit), sel = selected.has(key) ? selected : new Set([key]);
    const before = notesNow(), after = nudgeVelocity(before, sel, Math.sign(-e.deltaY) * 0.05);
    // a turn of the wheel is one edit to undo, not one a notch
    if (performance.now() - wheelAt > 600) commit(before, after); else apply(after);
    wheelAt = performance.now();
  }, { passive: false });

  // the keys: a click hears it and selects every note of its pitch (shift: adds them)
  rollKeys.addEventListener('pointerdown', (e) => {
    const k = (e.target as HTMLElement).closest<HTMLElement>('.rig-roll-key');
    if (!k) return;
    const n = Number(k.dataset.note);
    hear(n);
    const ofPitch = notesOfPitch(notesNow(), [n]);
    if (e.shiftKey) { selected = new Set([...selected, ...ofPitch]); rowSel = rowSel.includes(n) ? rowSel : [...rowSel, n]; }
    else { selected = ofPitch; rowSel = [n]; }
    drawRoll();
  });
  rollKeys.addEventListener('pointerup', () => hear(-1));
  rollKeys.addEventListener('pointerleave', () => hear(-1));

  // the tools and the keys of the computer keyboard (while the roll was the last thing clicked)
  const deleteSel = () => { if (!selected.size) return; const before = notesNow(); commit(before, deleteNotes(before, selected)); selected = new Set(); };
  const duplicate = () => {
    const before = notesNow(), c = copyNotes(before, selected);
    if (!c) return;
    const first = Math.min(...before.filter((n) => selected.has(rollKey(n))).map((n) => n.step));
    const r = pasteNotes(before, c, first + c.span, track().length);
    commit(before, r.notes, r.selected);
  };
  const nudge = (ds: number, dn: number) => {
    const before = notesNow(), r = moveNotes(before, selected, ds, dn, track().length, false, order());
    commit(before, r.notes, r.selected);
  };
  /** Whether the selection is just the hits of the pads picked by their names (an empty row's too). */
  const wholeRows = () => {
    if (!isKit() || !rowSel.length) return false;
    const rows = notesOfPitch(notesNow(), rowSel);
    return rows.size === selected.size && [...rows].every((k) => selected.has(k));
  };
  /** Moves whole rows a pad up or down, swapping past the rows on the way. */
  const swapRows = (dir: -1 | 1) => {
    const before = notesNow();
    const pads = rig.moveRows(rig.part, rowSel.map((n) => n - RIG_FIRST_PAD_NOTE), dir);
    rowSel = pads.map((pad) => RIG_FIRST_PAD_NOTE + pad);
    const h = hist();
    h.undo.push(before);
    h.redo = [];
    selected = notesOfPitch(notesNow(), rowSel);
    drawRoll();
  };
  drawBtn.addEventListener('click', toggleDraw);
  foldBtn.addEventListener('click', () => { fold = !fold; rollPart = -1; drawRoll(); });
  dupBtn.addEventListener('click', duplicate);
  delBtn.addEventListener('click', deleteSel);
  undoBtn.addEventListener('click', () => undo(false));
  redoBtn.addEventListener('click', () => undo(true));
  document.addEventListener('keydown', (e) => {
    if (!rollActive || roll.hidden || e.defaultPrevented || typing(e)) return;
    const cmd = e.metaKey || e.ctrlKey, k = e.key.toLowerCase();
    const take = () => { e.preventDefault(); e.stopPropagation(); };
    if (cmd && k === 'z') { take(); undo(e.shiftKey); }
    else if (cmd && k === 'y') { take(); undo(true); }
    else if (cmd && k === 'a') { take(); rowSel = []; selected = new Set(notesNow().map(rollKey)); drawRoll(); }
    else if (cmd && (k === 'c' || k === 'x')) {
      take();
      const before = notesNow(), c = copyNotes(before, selected);
      if (!c) return;
      clip = c;
      insertAt = Math.min(...before.filter((n) => selected.has(rollKey(n))).map((n) => n.step)) + c.span;
      if (k === 'x') deleteSel();
    } else if (cmd && k === 'v') {
      take();
      if (!clip) return;
      const before = notesNow(), at = insertAt >= 0 ? insertAt : 0, r = pasteNotes(before, clip, at, track().length);
      commit(before, r.notes, r.selected);
      insertAt = at + clip.span; // the next paste goes after this one
    } else if (cmd && k === 'd') { take(); duplicate(); }
    else if (cmd) return;
    else if (k === 'backspace' || k === 'delete') { take(); deleteSel(); }
    else if (k === 'escape') { take(); rowSel = []; selected = new Set(); drawRoll(); }
    else if (k === 'b') { take(); toggleDraw(); }
    else if ((k === 'arrowup' || k === 'arrowdown') && wholeRows()) { take(); swapRows(k === 'arrowup' ? -1 : 1); }
    else if (selected.size && k.startsWith('arrow')) {
      take();
      if (e.shiftKey && !isKit() && (k === 'arrowleft' || k === 'arrowright')) {
        const before = notesNow();
        commit(before, resizeNotes(before, selected, k === 'arrowright' ? 1 : -1), selected);
      } else if (k === 'arrowleft' || k === 'arrowright') nudge(k === 'arrowright' ? 1 : -1, 0);
      else nudge(0, (k === 'arrowup' ? 1 : -1) * (e.shiftKey && !isKit() ? 12 : 1));
    }
  });

  /** Draws the edited track's notes, its rows (all pitches, or folded) and the tools' state. */
  const drawRoll = () => {
    const t = track(), len = t.length, notes = readNotes(t), part = rig.parts[rig.part]!, kit = part.kind === 'kit';
    rollTitle.textContent = kit
      ? `DRUM ROLL · TRACK ${rig.part + 1} · ${(part.kit?.name || 'KIT').toUpperCase()} · ${len} STEPS`
      : `PIANO ROLL · TRACK ${rig.part + 1} · ${(part.name || 'PART').toUpperCase()} · ${len} STEPS`;
    roll.classList.toggle('kit', kit);
    rollView.classList.toggle('kit', kit);
    rollHint.textContent = kit ? KIT_HINT : NOTE_HINT;
    rollGrid.style.setProperty('--steps', String(len));
    // the rows: a kit's pads, or the keyboard (folded: only those with notes)
    const used = new Set(notes.map((n) => n.note));
    const all = kit ? PAD_ROWS : Array.from({ length: ROLL_HI - ROLL_LO + 1 }, (_, i) => ROLL_HI - i);
    const want = fold ? (kit ? all.filter((n) => used.has(n)) : [...used].sort((a, b) => b - a)) : all;
    const rows = want.length ? want : [kit ? PAD_ROWS[0]! : 60];
    const label = (n: number) => {
      if (!kit) return fold || n % 12 === 0 ? noteName(n) : '';
      const pad = n - RIG_FIRST_PAD_NOTE, name = part.kit?.pads[pad]?.name ?? '', num = String(RIG_PAD_ORDER.indexOf(pad) + 1);
      return name && name !== String(pad + 1) ? `${num} ${name}` : num;
    };
    rowH = kit ? PAD_ROW : ROW;
    const sig = `${kit}|${rows.join()}|${rows.map(label).join()}`;
    if (sig !== rowsSig) {
      rowsSig = sig;
      pitches = rows;
      rowOf.clear();
      rows.forEach((n, i) => rowOf.set(n, i));
      rollGrid.style.height = `${rows.length * rowH}px`;
      rollKeys.style.height = rollGrid.style.height;
      rollKeys.replaceChildren(...rows.map((n) => {
        const black = !kit && [1, 3, 6, 8, 10].includes(n % 12);
        const key = button(`rig-roll-key${black ? ' black' : ''}${kit ? ' pad' : ''}`, label(n),
          kit ? `${label(n)}: hear it, select its hits` : `${noteName(n)}: hear it, select its notes`);
        key.dataset.note = String(n);
        key.style.height = `${rowH}px`;
        return key;
      }));
      rollLines.replaceChildren(...rows.map((n, i) => {
        const line = el('div', `rig-roll-row${!kit && [1, 3, 6, 8, 10].includes(n % 12) ? ' black' : ''}${!kit && n % 12 === 0 ? ' c' : ''}${kit && i % 2 ? ' black' : ''}`);
        line.style.height = `${rowH}px`;
        return line;
      }));
    }
    // the notes; a selection only of notes still there
    const there = new Set(notes.map(rollKey));
    selected = new Set([...selected].filter((k) => there.has(k)));
    let lo = 128, hi = -1;
    rollNotes.replaceChildren(...notes.filter((n) => rowOf.has(n.note)).map((n) => {
      const gate = Math.min(kit ? 1 : n.gate, len - n.step), key = rollKey(n);
      const bar = el('div', `rig-roll-note${selected.has(key) ? ' selected' : ''}`);
      bar.dataset.step = String(n.step); bar.dataset.note = String(n.note);
      bar.style.left = `${(n.step / len) * 100}%`;
      bar.style.width = `${(gate / len) * 100}%`;
      bar.style.top = `${rowOf.get(n.note)! * rowH}px`;
      bar.style.height = `${rowH - 1}px`;
      bar.style.setProperty('--vel', String(n.vel));
      bar.title = kit
        ? `${label(n.note)} · step ${n.step + 1} · velocity ${Math.round(n.vel * 127)}`
        : `${noteName(n.note)} · step ${n.step + 1} · ${n.gate} steps · velocity ${Math.round(n.vel * 127)}`;
      if (!kit) bar.append(el('div', 'rig-roll-edge'));
      lo = Math.min(lo, n.note); hi = Math.max(hi, n.note);
      return bar;
    }));
    rollMid = hi >= 0 ? (lo + hi) / 2 : 60;
    drawBtn.classList.toggle('on', drawing());
    foldBtn.classList.toggle('on', fold);
    rollGrid.classList.toggle('draw', drawing());
    const rowsPicked = wholeRows();
    for (const k of rollKeys.children as HTMLCollectionOf<HTMLElement>) k.classList.toggle('selected', rowsPicked && rowSel.includes(Number(k.dataset.note)));
    const h = history.get(rig.part);
    undoBtn.disabled = !h?.undo.length;
    redoBtn.disabled = !h?.redo.length;
    dupBtn.disabled = delBtn.disabled = !selected.size;
    selInfo.textContent = selected.size ? `${selected.size} SELECTED` : `${notes.length} ${kit ? 'HITS' : 'NOTES'}`;
  };
  /** A new part's roll opens on its notes (or middle C), once it is on the page (a hidden one cannot scroll). */
  const scrollRoll = () => {
    if (rig.part === rollPart || roll.hidden || !rollView.clientHeight) return;
    if (rollPart >= 0) { selected = new Set(); rowSel = []; } // another part: its own selection
    rollPart = rig.part;
    rollView.scrollTop = fold || isKit() ? 0 : Math.max(0, (rowOf.get(Math.round(rollMid)) ?? (ROLL_HI - rollMid)) * ROW - rollView.clientHeight / 2);
  };

  // ---- the selected step
  const editor = el('section', 'rig-section rig-seq-step');
  const title = el('h3', 'rig-title');
  const notes = el('span', 'rig-readout');
  let syncing = false;
  const stepControl = (id: string, label: string, min: number, max: number, unit: string, get: (s: RigStep) => number, put: (s: RigStep, v: number) => void, curve?: 'log') => {
    const c = new NumberControl(id, label, min, max, get(newStep()), unit, (v) => {
      const s = track().steps[rig.step];
      if (syncing || !s) return;
      put(s, v);
      changed();
    }, curve);
    return { c, get };
  };
  const knobs = [
    stepControl('step.vel', 'Velocity', 1, 127, '', (s) => Math.round(s.vel * 127), (s, v) => { s.vel = v / 127; }),
    // the step's length is every note's: turning it clears the notes' own lengths (the piano roll's)
    stepControl('step.gate', 'Gate', 0.1, 16, 'steps', (s) => s.gate, (s, v) => { s.gate = v; delete s.gates; }, 'log'),
    stepControl('step.prob', 'Probability', 0, 100, '%', (s) => s.prob * 100, (s, v) => { s.prob = v / 100; }),
    stepControl('step.micro', 'Micro-timing', -50, 50, '%', (s) => s.micro * 100, (s, v) => { s.micro = v / 100; }),
    stepControl('step.mod', 'Seq mod', 0, 100, '%', (s) => s.mod * 100, (s, v) => { s.mod = v / 100; }),
  ];
  // NOTE moves the step's chord so its lowest note is the knob's (an empty step gets that note)
  const note = new NumberControl('step.note', 'Note', 0, 127, 60, '', (v) => {
    const s = track().steps[rig.step];
    if (syncing || !s) return;
    const n = Math.round(v);
    if (!s.notes.length) { s.notes = [n]; changed(); } else rig.transposeStep(rig.part, rig.step, n - Math.min(...s.notes));
  });
  const lock = button('rig-key rig-wide rig-seq-lock', 'LOCK', 'Lock the synth controls onto this step');
  lock.addEventListener('click', () => (rig.holding ? rig.releaseStep() : rig.holdStep()));
  const clearStep = button('rig-small rig-wide', 'CLEAR STEP');
  clearStep.addEventListener('click', () => { const i = rig.step; if (i >= 0) { track().steps[i] = newStep(); changed(); } });
  const clearLocks = button('rig-small rig-wide', 'CLEAR TRACK LOCKS');
  clearLocks.addEventListener('click', () => { for (const s of track().steps) s.locks = {}; changed(); });
  const clearTrack = button('rig-small rig-wide', 'CLEAR TRACK');
  clearTrack.addEventListener('click', () => { const t = track(); t.steps = t.steps.map(() => newStep()); changed(); });
  const locks = el('div', 'rig-seq-locks');
  const controls = el('div', 'rig-controls');
  controls.append(renderKnob(note, 'Step', 'NOTE', 30, (v) => noteOf(rig.part, Math.round(v))),
    ...knobs.map((k) => renderKnob(k.c, 'Step', k.c.label.toUpperCase(), 30)), lock);
  const tools = el('div', 'rig-field');
  tools.append(clearStep, clearLocks, clearTrack);
  editor.append(title, field('Notes', notes), controls, locks, tools,
    el('p', 'rig-seq-hint', 'Click an empty step to fill it, a step to select it, the selected step to empty it. Change a note: stopped, play it with the step selected; or turn NOTE; or wheel / ↑↓ over the step (shift: octave). REC: stopped, the step moves on after each note or chord; playing, notes land on the beat. LOCK: the synth’s controls lock onto the step.'));

  /** Steps a longer gate before them covers (shown as a tie). */
  const ties = (steps: RigStep[], len: number) => {
    const tied = new Array<boolean>(len).fill(false);
    steps.slice(0, len).forEach((s, i) => {
      if (!s.notes.length) return;
      for (let k = i + 1; k < Math.min(len, i + Math.ceil(s.gate)); k++) tied[k] = true;
    });
    return tied;
  };

  function sync(): void {
    const pat = seq.pattern;
    play.textContent = seq.isPlaying ? 'STOP' : 'PLAY';
    play.classList.toggle('on', seq.isPlaying);
    rec.classList.toggle('on', rig.isRecording);
    click.classList.toggle('on', rig.metronome);
    padButtons.forEach((b, i) => {
      syncPatternPad(rig, b, i);
    });
    length.value = String(pat.length);
    pageButtons.forEach((b, k) => b.classList.toggle('on', k === page));
    lane.forEach((l, p) => {
      const t = pat.tracks[p]!;
      const pt = rig.parts[p]!;
      l.row.classList.toggle('selected', p === rig.part);
      const on = partPlays(pt);
      l.row.classList.toggle('empty', !on);
      l.row.classList.toggle('kit', pt.kind === 'kit');
      l.name.textContent = `${p + 1} ${on ? pt.name || 'Part' : 'EMPTY'}`;
      l.mute.classList.toggle('on', t.muted);
      l.solo.classList.toggle('on', t.solo);
      const tied = ties(t.steps, t.length);
      l.cells.forEach((c, k) => {
        const i = page * PAGE + k;
        const s = t.steps[i]!;
        const beyond = i >= t.length;
        const kit = pt.kind === 'kit';
        c.textContent = beyond ? '' : s.notes.length
          ? kit ? s.notes.map((n) => noteOf(p, n)).join(' ') : noteName(s.notes[0]!) + (s.notes.length > 1 ? `+${s.notes.length - 1}` : '')
          : tied[i] && !kit ? '~' : '';
        c.classList.toggle('kitnote', kit);
        c.className = 'rig-seq-cell';
        c.classList.toggle('beat', k % 4 === 0);
        c.classList.toggle('beyond', beyond);
        c.classList.toggle('note', !beyond && s.notes.length > 0);
        c.classList.toggle('tie', !beyond && !s.notes.length && tied[i]! && !kit);
        c.classList.toggle('locked', !beyond && Object.keys(s.locks).length > 0);
        c.classList.toggle('sel', p === rig.part && i === rig.step);
        c.setAttribute('aria-label', `Track ${p + 1} step ${i + 1}${s.notes.length ? ` ${s.notes.map((n) => noteOf(p, n)).join(' ')}` : ''}`);
      });
      l.lit = -1;
      l.len.value = String(t.length);
      l.clk.value = String(t.clock);
      l.dir.value = t.direction;
      l.prob.value = String(Math.round(t.prob * 10) / 10);
    });
    drawRoll();

    const i = rig.step;
    const s = track().steps[i];
    title.textContent = s ? `TRACK ${rig.part + 1} · STEP ${i + 1}` : `TRACK ${rig.part + 1} · NO STEP SELECTED`;
    notes.textContent = s?.notes.length ? s.notes.map((n) => noteOf(rig.part, n)).join(' ') : '—';
    if (s?.notes.length) lastNote[rig.part] = s.notes[0]!;
    syncing = true;
    for (const k of knobs) k.c.set(k.get(s ?? newStep()));
    note.set(s?.notes.length ? Math.min(...s.notes) : lastNote[rig.part]!);
    syncing = false;
    lock.classList.toggle('on', rig.holding);
    lock.disabled = !s;
    locks.replaceChildren(...Object.entries(s?.locks ?? {}).map(([id, v]) => {
      const chip = el('span', 'rig-seq-lockchip', lockText(id, v));
      const x = button('rig-small', '×', `Remove the ${PARAM_LABELS.get(id)?.label ?? id} lock`);
      x.addEventListener('click', () => { delete s!.locks[id]; changed(); });
      chip.append(x);
      return chip;
    }));
  }
  seq.onChange(sync);
  rig.onPartChange(sync);

  // ---- the playheads
  const frame = () => {
    const t = now();
    song.frame();
    lane.forEach((l, p) => {
      const step = seq.isPlaying && seq.editing === seq.current && partPlays(rig.parts[p]!) ? seq.stepAt(p, t) : -1;
      const k = step >= page * PAGE && step < (page + 1) * PAGE ? step - page * PAGE : -1;
      if (k === l.lit) return;
      if (l.lit >= 0) l.cells[l.lit]!.classList.remove('play');
      if (k >= 0) l.cells[k]!.classList.add('play');
      l.lit = k;
    });
    // the piano roll: open a new part's on its notes, and its playhead along the whole loop
    scrollRoll();
    const rollStep = !roll.hidden && seq.isPlaying && seq.editing === seq.current ? seq.stepAt(rig.part, t) : -1;
    rollPlay.hidden = rollStep < 0;
    if (rollStep >= 0) rollPlay.style.left = `${(rollStep / track().length) * 100}%`;
    requestAnimationFrame(frame);
  };
  requestAnimationFrame(frame);

  sync();
  panel.append(song, bar, lanes, roll, editor);
  return panel;
}

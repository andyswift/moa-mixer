import { NumberControl } from '../domain/devices/controls';
import { RIG_FIRST_PAD_NOTE } from '../domain/devices/rigKit';
import { RIG_PARAMS } from '../domain/devices/rigParams';
import { RIG_PARTS, type RigSynth } from '../domain/devices/rigSynth';
import {
  cloneRigPattern, newStep, RIG_CLOCKS, RIG_DIRECTIONS, RIG_MAX_STEPS, RIG_PATTERNS, type RigPattern, type RigStep,
} from '../domain/sequencer/rigSequencer';
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

  // ---- transport and patterns
  const bar = el('div', 'rig-setup rig-seq-bar');
  const play = button('rig-key rig-seq-play', 'PLAY');
  play.addEventListener('click', () => (seq.isPlaying ? rig.stop() : rig.play()));
  const rec = button('rig-key rig-seq-rec', 'REC');
  rec.addEventListener('click', () => rig.setRecording(!rig.isRecording));
  const tempo = new NumberControl('seq.tempo', 'Tempo', 40, 240, rig.bpm, 'BPM', (v) => { rig.bpm = v; });
  const shuffle = new NumberControl('seq.shuffle', 'Shuffle', 0, 50, seq.shuffle * 100, '%', (v) => { seq.shuffle = v / 100; seq.notify(); });
  const length = select('Pattern length', [['FREE', '0'], ...[16, 32, 48, 64, 96, 128, 192, 256].map((n): [string, string] => [`${n / 16} BAR${n > 16 ? 'S' : ''}`, String(n)])],
    (v) => { seq.pattern.length = Number(v); changed(); });
  const pads = el('div', 'rig-seq-pads');
  const padButtons = Array.from({ length: RIG_PATTERNS }, (_, i) => {
    const b = button('rig-seq-pad', String(i + 1), `Pattern ${i + 1}`);
    b.title = 'Click: play this pattern next. Shift-click: add to or take out of the chain.';
    b.addEventListener('click', (e) => {
      if (e.shiftKey) {
        const at = seq.chain.indexOf(i);
        seq.setChain(at >= 0 ? seq.chain.filter((_, k) => k !== at) : [...seq.chain, i]);
      } else seq.queue(i);
    });
    pads.append(b);
    return b;
  });
  const chain = el('span', 'rig-readout rig-seq-chain');
  const copy = button('rig-small rig-wide', 'COPY');
  copy.addEventListener('click', () => { clipboard = cloneRigPattern(seq.pattern); });
  const paste = button('rig-small rig-wide', 'PASTE');
  paste.addEventListener('click', () => { if (clipboard) { seq.patterns[seq.current] = cloneRigPattern(clipboard); changed(); } });
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
    play, rec, renderKnob(tempo, 'Sequencer', 'TEMPO', 30), renderKnob(shuffle, 'Sequencer', 'SHUFFLE', 30),
    field('Pattern', pads), field('Chain', chain), field('Length', length), field('', copy, paste), field('Steps', ...pageButtons),
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

  // ---- the drum grid: a kit's pads down, the steps across; click a cell for a hit, the wheel over one for its velocity
  const drums = el('section', 'rig-section rig-drum-grid');
  drums.style.setProperty('--rig-accent', '#ffa3c7');
  const drumTitle = el('h3', 'rig-title');
  const drumRows = el('div', 'rig-drum-rows');
  const drumRow = Array.from({ length: 16 }, (_, pad) => {
    const row = el('div', 'rig-drum-row');
    const note = RIG_FIRST_PAD_NOTE + pad;
    const name = button('rig-drum-name', '', `Hear pad ${pad + 1}`);
    name.addEventListener('pointerdown', (e) => { pickRow(pad, e); rig.audition(note, true); });
    for (const ev of ['pointerup', 'pointerleave'] as const) name.addEventListener(ev, () => rig.audition(note, false));
    const cells = Array.from({ length: PAGE }, (_, c) => {
      const b = button('rig-seq-cell rig-drum-cell', '');
      b.addEventListener('click', () => {
        const i = page * PAGE + c;
        selectRows([pad]);
        if (i < track().length) rig.toggleHit(rig.part, i, note);
      });
      b.addEventListener('wheel', (e) => {
        const st = track().steps[page * PAGE + c];
        if (!st?.notes.includes(note)) return;
        e.preventDefault();
        const v = st.vels?.[note] ?? st.vel;
        rig.setHitVelocity(rig.part, page * PAGE + c, note, v + Math.sign(-e.deltaY) * 0.05);
      }, { passive: false });
      return b;
    });
    const steps = el('div', 'rig-seq-cells');
    steps.append(...cells);
    row.append(name, steps);
    drumRows.append(row);
    return { row, name, cells };
  });
  drums.append(drumTitle, drumRows, el('p', 'rig-seq-hint', 'Click a cell to put a hit in or take it out. Mouse wheel over a hit: its velocity (brighter is harder). Press a pad’s name to hear it and select its row (shift or ⌘ for more rows). Backspace clears the selected rows; ↑ ↓ move them (a row they pass swaps past, it is not overwritten). Space starts and stops.'));
  let drumLit = -1;
  /** The selected rows (pads): Backspace or Delete clears their hits, up and down move them. */
  let drumSel: number[] = [];
  let drumPart = -1;
  const selectRows = (pads: number[]) => {
    drumSel = pads;
    drumRow.forEach((r, k) => r.row.classList.toggle('selected', pads.includes(k)));
  };
  /** A click picks a row; with shift or cmd/ctrl it adds the row to the selection (or takes it out). */
  const pickRow = (pad: number, e: MouseEvent | PointerEvent) => {
    if (e.shiftKey || e.metaKey || e.ctrlKey) selectRows(drumSel.includes(pad) ? drumSel.filter((p) => p !== pad) : [...drumSel, pad]);
    else selectRows([pad]);
  };
  const typing = (e: KeyboardEvent) => {
    const t = e.target as HTMLElement | null;
    return !!t && (t.tagName === 'INPUT' || t.tagName === 'SELECT' || t.tagName === 'TEXTAREA' || t.isContentEditable);
  };
  // on the page, as Safari does not focus a clicked button; not while typing in a field
  document.addEventListener('keydown', (e) => {
    if (e.defaultPrevented || !drumSel.length || drums.hidden || typing(e)) return;
    if (e.key === 'Backspace' || e.key === 'Delete') {
      e.preventDefault();
      for (const pad of drumSel) rig.clearHits(rig.part, RIG_FIRST_PAD_NOTE + pad);
    } else if (e.key === 'ArrowUp' || e.key === 'ArrowDown') {
      e.preventDefault();
      selectRows(rig.moveRows(rig.part, drumSel, e.key === 'ArrowUp' ? -1 : 1));
    }
  });
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
    stepControl('step.gate', 'Gate', 0.1, 16, 'steps', (s) => s.gate, (s, v) => { s.gate = v; }, 'log'),
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
    padButtons.forEach((b, i) => {
      b.classList.toggle('now', i === seq.current);
      b.classList.toggle('next', i === seq.next);
      b.classList.toggle('chained', seq.chain.includes(i));
      b.classList.toggle('used', seq.patterns[i]!.tracks.some((t) => t.steps.some((s) => s.notes.length || Object.keys(s.locks).length)));
    });
    chain.textContent = seq.chain.length ? seq.chain.map((i) => i + 1).join(' → ') : '—';
    length.value = String(pat.length);
    pageButtons.forEach((b, k) => b.classList.toggle('on', k === page));
    lane.forEach((l, p) => {
      const t = pat.tracks[p]!;
      const pt = rig.parts[p]!;
      l.row.classList.toggle('selected', p === rig.part);
      const on = pt.voices > 0 || pt.kind === 'kit';
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
    // the drum grid, when the edited part is a kit
    const kitPart = rig.parts[rig.part]!;
    drums.hidden = kitPart.kind !== 'kit';
    if (rig.part !== drumPart) { drumPart = rig.part; selectRows([]); }
    if (kitPart.kind === 'kit') {
      const t = track();
      drumTitle.textContent = `DRUM GRID · TRACK ${rig.part + 1} · ${kitPart.kit?.name ?? ''} · STEPS ${page * PAGE + 1}–${(page + 1) * PAGE}`;
      drumRow.forEach((r, pad) => {
        const note = RIG_FIRST_PAD_NOTE + pad;
        const padName = kitPart.kit?.pads[pad]?.name ?? '';
        r.name.textContent = padName && padName !== String(pad + 1) ? `${pad + 1} ${padName}` : String(pad + 1);
        r.cells.forEach((c, k) => {
          const i = page * PAGE + k;
          const st = t.steps[i]!;
          const on = i < t.length && st.notes.includes(note);
          const v = on ? st.vels?.[note] ?? st.vel : 0;
          c.className = 'rig-seq-cell rig-drum-cell';
          c.classList.toggle('beat', k % 4 === 0);
          c.classList.toggle('beyond', i >= t.length);
          c.classList.toggle('hit', on);
          c.style.setProperty('--vel', String(v));
          c.textContent = '';
          c.setAttribute('aria-pressed', String(on));
          c.setAttribute('aria-label', `Pad ${pad + 1} step ${i + 1}${on ? `, velocity ${Math.round(v * 127)}` : ''}`);
          c.title = on ? `velocity ${Math.round(v * 127)}` : '';
        });
      });
      drumLit = -1;
    }

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
    lane.forEach((l, p) => {
      const step = seq.isPlaying && (rig.parts[p]!.voices > 0 || rig.parts[p]!.kind === 'kit') ? seq.stepAt(p, t) : -1;
      const k = step >= page * PAGE && step < (page + 1) * PAGE ? step - page * PAGE : -1;
      if (k === l.lit) return;
      if (l.lit >= 0) l.cells[l.lit]!.classList.remove('play');
      if (k >= 0) l.cells[k]!.classList.add('play');
      l.lit = k;
    });
    // the drum grid's playhead column
    const kitStep = !drums.hidden && seq.isPlaying ? seq.stepAt(rig.part, t) : -1;
    const col = kitStep >= page * PAGE && kitStep < (page + 1) * PAGE ? kitStep - page * PAGE : -1;
    if (col !== drumLit) {
      for (const r of drumRow) {
        if (drumLit >= 0) r.cells[drumLit]!.classList.remove('play');
        if (col >= 0) r.cells[col]!.classList.add('play');
      }
      drumLit = col;
    }
    requestAnimationFrame(frame);
  };
  requestAnimationFrame(frame);

  sync();
  panel.append(bar, lanes, drums, editor);
  return panel;
}

import { type HoldKey, type Pad, type SequencerController, type ViewId } from '../domain/sequencer/controller';
import { nearestDivision } from '../domain/sequencer/division';
import { el } from './widgets';

/** What the panel needs from the page besides the controller. */
export interface SeqActions {
  playing: () => boolean;
  /** Start or stop; `quiet` plays without sending MIDI start/stop (Ctrl + Play). */
  togglePlay: (quiet: boolean) => void;
  /** The tick sounding now, for the playhead. */
  tick: () => number;
  busOn: () => boolean;
  setBusOn: (on: boolean) => void;
  outputs: () => { id: string; name: string }[];
  selectedOutput: () => string | undefined;
  selectOutput: (id: string | undefined) => void;
  auditionOn: () => boolean;
  setAudition: (on: boolean) => void;
  onChange: (fn: () => void) => void;
}

interface KnobSpec {
  id: string;
  primary: string;
  secondary: string;
  glyph: string;
  col: number;
  row: number;
  /** Not built yet (next round): drawn, but it does nothing. */
  later?: boolean;
}

const KNOBS: KnobSpec[] = [
  { id: 'steps', primary: 'steps', secondary: '', glyph: '○', col: 0, row: 0 },
  { id: 'pulses', primary: 'pulses', secondary: 'rotate', glyph: '●', col: 1, row: 0 },
  { id: 'cycles', primary: 'cycles', secondary: '', glyph: '↻', col: 2, row: 0 },
  { id: 'division', primary: 'division', secondary: '', glyph: '/', col: 3, row: 0 },
  { id: 'velocity', primary: 'velocity', secondary: 'probability', glyph: '◢', col: 4, row: 0 },
  { id: 'sustain', primary: 'sustain', secondary: '', glyph: '␣', col: 5, row: 0 },
  { id: 'pitch', primary: 'pitch', secondary: 'harmony', glyph: '♪', col: 6, row: 0 },
  { id: 'length', primary: 'length', secondary: 'quantize', glyph: '❙❙', col: 7, row: 0 },
  { id: 'tempo', primary: 'tempo', secondary: '', glyph: '♫', col: 8, row: 0 },
  { id: 'repeats', primary: 'repeats', secondary: 'offset', glyph: '∴', col: 0, row: 1 },
  { id: 'time', primary: 'time', secondary: 'pace', glyph: '∷', col: 1, row: 1 },
  { id: 'voicing', primary: 'voicing', secondary: 'style', glyph: '∴', col: 2, row: 1, later: true },
  { id: 'range', primary: 'range', secondary: 'phrase', glyph: 'ⵏ', col: 3, row: 1, later: true },
  { id: 'accent', primary: 'accent', secondary: 'groove', glyph: '◿', col: 4, row: 1 },
  { id: 'timing', primary: 'timing', secondary: 'delay', glyph: '␣', col: 5, row: 1 },
  { id: 'scale', primary: 'scale', secondary: 'root', glyph: '♪', col: 6, row: 1 },
  { id: 'channel', primary: 'channel', secondary: 'output', glyph: '◁▷', col: 7, row: 1 },
  { id: 'random', primary: 'random', secondary: 'rate', glyph: '⌇', col: 8, row: 1, later: true },
];

/** Photo coordinates of the original faceplate (x from 40, y from 392), which the layout is drawn in. */
const FACE = { x: 40, y: 392, w: 1118, h: 418 };
const COLS = [112, 233, 354, 475, 597, 718, 840, 960, 1081];
const ROWS = [478, 577];
const GROUPS = [
  { text: 'shape', x: 93, w: 462 },
  { text: 'groove', x: 577, w: 219 },
  { text: 'tonal', x: 820, w: 98 },
  { text: 'setup', x: 942, w: 190 },
];
const TOP_LABELS = ['/1', '/2', '/4', '/8', '/16', '/32', '/64', ''];
const BOTTOM_LABELS = ['chrom', 'major', 'minor', 'panta', 'hira', 'iwato', 'tetra', 'user'];
const TRIPLET_LABELS = ['', '', '/3', '/6', '/12', '/24', '/48', ''];

const pct = (v: number, total: number): string => `${((v / total) * 100).toFixed(3)}%`;
const fx = (x: number): number => x - FACE.x;
const fy = (y: number): number => y - FACE.y;
const cq = (px: number): string => `${((px / FACE.w) * 100).toFixed(3)}cqw`;

function place(node: HTMLElement, cx: number, cy: number, w: number, h = w): HTMLElement {
  node.classList.add('sq-placed');
  node.style.left = pct(fx(cx - w / 2), FACE.w);
  node.style.top = pct(fy(cy - h / 2), FACE.h);
  node.style.width = pct(w, FACE.w);
  node.style.height = pct(h, FACE.h);
  return node;
}

function text(cls: string, content: string, x: number, y: number, rotate = false): HTMLElement {
  const t = el('div', `sq-text ${cls}`, content);
  t.style.left = pct(fx(x), FACE.w);
  t.style.top = pct(fy(y), FACE.h);
  if (rotate) t.classList.add('sq-vertical');
  return t;
}

// ---------------------------------------------------------------- knobs

const CLICK_PIXELS = 7;

function makeKnob(c: SequencerController, spec: KnobSpec): HTMLElement {
  const knob = el('button', 'sq-knob');
  knob.type = 'button';
  knob.setAttribute('role', 'slider');
  knob.setAttribute('aria-label', `${spec.primary}${spec.secondary ? `, secondary ${spec.secondary} with Ctrl` : ''}`);
  const cap = el('i');
  knob.append(cap);
  if (spec.later) {
    knob.classList.add('sq-later');
    knob.title = `${spec.primary}: coming in the next round`;
    knob.setAttribute('aria-disabled', 'true');
    return knob;
  }
  let angle = (spec.col * 37 + spec.row * 91) % 360;
  const spin = (clicks: number) => {
    angle = (angle + clicks * 9) % 360;
    cap.style.transform = `rotate(${angle}deg)`;
  };
  spin(0);
  let drag: { y: number; carry: number } | undefined;
  knob.addEventListener('pointerdown', (e) => {
    e.preventDefault();
    knob.setPointerCapture(e.pointerId);
    drag = { y: e.clientY, carry: 0 };
    c.knobDown(spec.id);
  });
  knob.addEventListener('pointermove', (e) => {
    if (!drag) return;
    drag.carry += drag.y - e.clientY;
    drag.y = e.clientY;
    const clicks = Math.trunc(drag.carry / (e.shiftKey ? CLICK_PIXELS * 3 : CLICK_PIXELS));
    if (clicks !== 0) {
      drag.carry -= clicks * (e.shiftKey ? CLICK_PIXELS * 3 : CLICK_PIXELS);
      c.knobTurn(spec.id, clicks);
      spin(clicks);
    }
  });
  const end = () => {
    if (!drag) return;
    drag = undefined;
    c.knobUp();
  };
  knob.addEventListener('pointerup', end);
  knob.addEventListener('pointercancel', end);
  knob.addEventListener('dblclick', () => c.knobLock(spec.id));
  knob.addEventListener('wheel', (e) => {
    e.preventDefault();
    const clicks = e.deltaY < 0 ? 1 : -1;
    c.knobTurn(spec.id, clicks);
    spin(clicks);
  }, { passive: false });
  knob.addEventListener('keydown', (e) => {
    const map: Record<string, number> = { ArrowUp: 1, ArrowRight: 1, ArrowDown: -1, ArrowLeft: -1, PageUp: 5, PageDown: -5 };
    if (e.key in map) {
      e.preventDefault();
      c.knobTurn(spec.id, map[e.key]! * (e.shiftKey ? 1 : 1));
      spin(map[e.key]!);
    } else if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      c.knobLock(spec.id);
    }
  });
  return knob;
}

// ---------------------------------------------------------------- pads

interface PadEl {
  button: HTMLElement;
  index: number;
  label?: HTMLElement;
}

function makePad(c: SequencerController, index: number): PadEl {
  const button = el('button', 'sq-pad sq-off');
  button.type = 'button';
  button.setAttribute('aria-label', `Pad ${index + 1}`);
  const label = el('span', 'sq-pad-label');
  button.append(label);
  let down = false;
  button.addEventListener('pointerdown', (e) => {
    e.preventDefault();
    button.setPointerCapture(e.pointerId);
    down = true;
    c.pad(index, true);
  });
  const up = () => {
    if (!down) return;
    down = false;
    c.pad(index, false);
  };
  button.addEventListener('pointerup', up);
  button.addEventListener('pointercancel', up);
  button.addEventListener('keydown', (e) => {
    if ((e.key === 'Enter' || e.key === ' ') && !e.repeat) {
      e.preventDefault();
      c.pad(index, true);
    }
  });
  button.addEventListener('keyup', (e) => {
    if (e.key === 'Enter' || e.key === ' ') c.pad(index, false);
  });
  return { button, index, label };
}

function paintPad(p: PadEl, frame: Pad, withLabel: boolean): void {
  p.button.className = `sq-pad${p.button.classList.contains('sq-placed') ? ' sq-placed' : ''} sq-${frame.color}${frame.flash ? ' sq-flash' : ''}`;
  if (p.label) p.label.textContent = withLabel ? frame.label ?? '' : '';
}

// ---------------------------------------------------------------- control pads

interface ControlPads {
  play: HTMLElement;
  clear: HTMLElement;
  ctrl: HTMLElement;
  bank: HTMLElement;
  pattern: HTMLElement;
  temp: HTMLElement;
  mute: HTMLElement;
}

const LATCH_MS = 320;

function makeControls(c: SequencerController, a: SeqActions): ControlPads {
  const pad = (name: string, aria: string): HTMLElement => {
    const b = el('button', 'sq-ctrl-pad');
    b.type = 'button';
    b.setAttribute('aria-label', aria);
    b.dataset.name = name;
    return b;
  };
  const play = pad('play', 'Play and stop. With Ctrl: play without sending MIDI start and stop');
  play.addEventListener('click', () => a.togglePlay(c.ctrl));

  const ctrl = pad('ctrl', 'Ctrl: hold or tap to reach the secondary functions');
  ctrl.setAttribute('aria-pressed', 'false');
  ctrl.addEventListener('click', () => c.setCtrl(!c.ctrlLatch));

  const clear = pad('clear', 'Clear: hold and press a track, pattern or knob to reset it. With Ctrl: copy. Double tap empties the clipboard');
  let clearDown = false;
  clear.addEventListener('pointerdown', (e) => {
    e.preventDefault();
    clear.setPointerCapture(e.pointerId);
    clearDown = true;
    if (c.ctrl) c.copy();
    else c.hold('clear', true);
  });
  const clearUp = () => {
    if (!clearDown) return;
    clearDown = false;
    c.hold('clear', false);
  };
  clear.addEventListener('pointerup', clearUp);
  clear.addEventListener('pointercancel', clearUp);
  clear.addEventListener('dblclick', () => c.clearClipboard());

  /** A pad that works held down, or tapped to latch (so it works without a second finger). */
  const holdPad = (name: HoldKey, aria: string, tap?: () => void): HTMLElement => {
    const b = pad(name, aria);
    let started = 0;
    let presses = 0;
    let latched = false;
    b.addEventListener('pointerdown', (e) => {
      e.preventDefault();
      b.setPointerCapture(e.pointerId);
      started = performance.now();
      presses = c.padCount;
      if (latched) {
        latched = false;
        c.hold(name, false);
        started = 0;
        return;
      }
      c.hold(name, true);
    });
    const up = () => {
      if (started === 0) return;
      const quick = performance.now() - started < LATCH_MS && c.padCount === presses;
      started = 0;
      if (quick && !latched) {
        if (tap) {
          c.hold(name, false);
          tap();
        } else latched = true; // stays held until the next tap
      } else c.hold(name, false);
    };
    b.addEventListener('pointerup', up);
    b.addEventListener('pointercancel', up);
    return b;
  };
  const bank = holdPad('bank', 'Bank: hold and press a pad to choose a bank. Tap to go home. With Ctrl: save', () => c.tapBank());
  const pattern = holdPad('pattern', 'Pattern: hold and press a pad to queue a pattern; press several in order to chain');
  const temp = holdPad('temp', 'Temp: hold and turn a knob to change it only while held');
  const mute = holdPad('mute', 'Mute: hold, press tracks, let go to mute them. With Ctrl they mute at once');
  return { play, clear, ctrl, bank, pattern, temp, mute };
}

function paintControls(p: ControlPads, c: SequencerController, a: SeqActions): void {
  p.play.classList.toggle('sq-lit', a.playing());
  p.ctrl.classList.toggle('sq-lit', c.ctrl);
  p.ctrl.setAttribute('aria-pressed', String(c.ctrl));
  p.clear.classList.toggle('sq-green', c.hasClipboard);
  p.bank.classList.toggle('sq-lit', c.held.has('bank'));
  p.pattern.classList.toggle('sq-lit', c.held.has('pattern'));
  p.temp.classList.toggle('sq-lit', c.held.has('temp'));
  p.mute.classList.toggle('sq-lit', c.held.has('mute'));
}

// ---------------------------------------------------------------- the panel

/** The MOA-SEQ front panel: the faceplate on wide screens, stacked sections on narrow ones, and the readout. */
export function renderSeqPanel(c: SequencerController, a: SeqActions): HTMLElement {
  const root = el('div', 'sq-wrap');
  const desktop = buildDesktop(c, a);
  const mobile = buildMobile(c, a);
  const readout = buildReadout(c, a);
  root.append(desktop.root, mobile.root, readout.root, buildHelp());

  const repaint = () => {
    const tick = a.playing() ? a.tick() : -1;
    const t = c.track;
    const loop = t.steps * t.division;
    const step = tick >= 0 ? Math.floor((tick % Math.max(1, loop)) / t.division) : -1;
    const pads = c.pads(c.view === 'steps' || c.view === 'pulses' ? step : -1);
    desktop.paint(pads, c, a);
    mobile.paint(pads, c, a);
    readout.paint(step);
  };
  c.onChange(repaint);
  a.onChange(repaint);
  const frame = () => {
    c.decayFlashes();
    repaint();
    setTimeout(() => requestAnimationFrame(frame), 40);
  };
  requestAnimationFrame(frame);
  window.addEventListener('keydown', (e) => {
    if (e.key === 'Shift') c.setCtrlKey(true);
  });
  window.addEventListener('keyup', (e) => {
    if (e.key === 'Shift') c.setCtrlKey(false);
  });
  window.addEventListener('blur', () => c.setCtrlKey(false));
  return root;
}

function buildDesktop(c: SequencerController, a: SeqActions) {
  const root = el('div', 'sq-desktop');
  const faceplate = el('div', 'sq-face');
  root.append(faceplate);

  for (const g of GROUPS) {
    const line = text('sq-group', g.text, g.x, 437);
    line.style.width = pct(g.w, FACE.w);
    faceplate.append(line);
  }
  for (const k of KNOBS) {
    const x = COLS[k.col]!;
    const y = ROWS[k.row]!;
    faceplate.append(place(makeKnob(c, k), x, y, 46));
    faceplate.append(text('sq-primary', k.primary, x - 22, y + 25), text('sq-secondary', k.secondary, x - 22, y + 41), text('sq-glyph', k.glyph, x + 28, y - 10));
  }
  const pads: PadEl[] = [];
  for (let r = 0; r < 2; r++) {
    for (let col = 0; col < 8; col++) {
      const cx = 114 + col * 80.7;
      const cy = r === 0 ? 676 : 748;
      const pad = makePad(c, r * 8 + col);
      pads.push(pad);
      faceplate.append(place(pad.button, cx, cy, 58));
      const printed = r === 0 ? TOP_LABELS[col]! : BOTTOM_LABELS[col]!;
      if (printed) faceplate.append(text('sq-printed', printed, cx + 33, cy + 28, true));
      if (r === 1 && TRIPLET_LABELS[col]) faceplate.append(text('sq-printed sq-dim', TRIPLET_LABELS[col]!, cx + 33, cy + 55, true));
    }
  }
  const ctl = makeControls(c, a);
  const at = (node: HTMLElement, cx: number, cy: number) => faceplate.append(place(node, cx, cy, 58));
  at(ctl.play, 841, 675);
  at(ctl.clear, 1003, 675);
  at(ctl.ctrl, 1083, 675);
  at(ctl.bank, 841, 748);
  at(ctl.pattern, 921, 748);
  at(ctl.temp, 1003, 748);
  at(ctl.mute, 1083, 748);
  faceplate.append(
    text('sq-primary', 'clear', 975, 707), text('sq-secondary', 'copy', 1041, 700, true), text('sq-primary sq-vertical-ctrl', 'ctrl', 1119, 690, true),
    text('sq-primary', 'bank', 812, 785), text('sq-secondary', 'save', 880, 776, true), text('sq-primary', 'pattern', 893, 785),
    text('sq-secondary', 'select', 960, 780, true), text('sq-primary', 'temp', 975, 785), text('sq-primary', 'mute', 1055, 785),
  );
  const mark = el('div', 'sq-mark');
  mark.innerHTML = `<svg viewBox="0 0 34 150" role="img" aria-label="MOA-SEQ" fill="none" stroke="#f2f2f0" stroke-width="3" stroke-linecap="round" stroke-linejoin="round">
    <g transform="translate(4 146) rotate(-90) scale(0.4)">
      <g transform="translate(6 8)"><path d="M4 44 V6 L19 28 L34 6 V44"/></g>
      <g transform="translate(52 8)"><ellipse cx="19" cy="25" rx="16" ry="21"/></g>
      <g transform="translate(96 8)"><path d="M4 44 L19 5 L34 44 M10 31 H28"/></g>
      <g transform="translate(138 8)"><path d="M6 27 H22"/></g>
      <g transform="translate(160 8)"><path d="M34 12 C34 -2 4 -2 4 12 C4 26 34 22 34 36 C34 50 4 50 4 38"/></g>
      <g transform="translate(206 8)"><path d="M32 6 H6 V44 H32 M6 25 H26"/></g>
      <g transform="translate(250 8)"><ellipse cx="19" cy="25" rx="16" ry="21"/><path d="M26 36 L38 48"/></g>
    </g></svg>`; // static markup, no user data
  place(mark, 775, 720, 34, 150);
  faceplate.append(mark);
  const playIcon = el('div', 'sq-play-icon', '▷□');
  faceplate.append(text('sq-play-symbol', '▷', 875, 658), text('sq-play-symbol', '□', 875, 678));
  void playIcon;

  return {
    root,
    paint(frames: Pad[], ctrl: SequencerController, act: SeqActions) {
      pads.forEach((p, i) => paintPad(p, frames[i]!, false));
      paintControls(ctl, ctrl, act);
    },
  };
}

function buildMobile(c: SequencerController, a: SeqActions) {
  const root = el('div', 'sq-mobile');
  const groupDefs: { title: string; ids: string[] }[] = [
    { title: 'shape', ids: ['steps', 'pulses', 'cycles', 'division', 'repeats', 'time', 'voicing', 'range'] },
    { title: 'groove', ids: ['velocity', 'sustain', 'accent', 'timing'] },
    { title: 'tonal', ids: ['pitch', 'scale'] },
    { title: 'setup', ids: ['length', 'tempo', 'channel', 'random'] },
  ];
  for (const g of groupDefs) {
    const section = el('section', 'sq-m-group');
    section.append(el('h2', 'sq-m-title', g.title));
    const grid = el('div', 'sq-m-knobs');
    for (const id of g.ids) {
      const spec = KNOBS.find((k) => k.id === id)!;
      const cell = el('div', 'sq-m-knob');
      const knob = makeKnob(c, spec);
      cell.append(knob, el('span', 'sq-primary', spec.primary), el('span', 'sq-secondary', spec.secondary));
      grid.append(cell);
    }
    section.append(grid);
    root.append(section);
  }
  const padSection = el('section', 'sq-m-group');
  padSection.append(el('h2', 'sq-m-title', 'pads'));
  const padGrid = el('div', 'sq-m-pads');
  const pads: PadEl[] = [];
  for (let i = 0; i < 16; i++) {
    const pad = makePad(c, i);
    pads.push(pad);
    padGrid.append(pad.button);
  }
  padSection.append(padGrid);
  const ctl = makeControls(c, a);
  const ctlSection = el('section', 'sq-m-group');
  ctlSection.append(el('h2', 'sq-m-title', 'control'));
  const ctlGrid = el('div', 'sq-m-ctrl');
  const named: [HTMLElement, string, string][] = [
    [ctl.play, 'play', ''], [ctl.clear, 'clear', 'copy'], [ctl.ctrl, 'ctrl', ''], [ctl.mute, 'mute', ''],
    [ctl.bank, 'bank', 'save'], [ctl.pattern, 'pattern', 'select'], [ctl.temp, 'temp', ''],
  ];
  for (const [pad, name, second] of named) {
    const cell = el('div', 'sq-m-ctl');
    cell.append(pad, el('span', 'sq-primary', name), el('span', 'sq-secondary', second));
    ctlGrid.append(cell);
  }
  ctlSection.append(ctlGrid);
  root.append(padSection, ctlSection);
  return {
    root,
    paint(frames: Pad[], ctrl: SequencerController, act: SeqActions) {
      pads.forEach((p, i) => paintPad(p, frames[i]!, true));
      paintControls(ctl, ctrl, act);
    },
  };
}

function buildReadout(c: SequencerController, a: SeqActions) {
  const root = el('section', 'sq-readout');
  const info = el('div', 'sq-info');
  const line1 = el('div', 'sq-line1');
  line1.setAttribute('role', 'status');
  const line2 = el('div', 'sq-line2');
  info.append(line1, line2);
  const dots = el('div', 'sq-dots');
  dots.setAttribute('aria-label', 'Pulses of the selected track');
  const routes = el('div', 'sq-routes');

  const busBtn = el('button', 'sq-route');
  busBtn.type = 'button';
  busBtn.addEventListener('click', () => { a.setBusOn(!a.busOn()); });
  const outSel = el('select', 'sq-route sq-out');
  outSel.setAttribute('aria-label', 'MIDI output device');
  outSel.addEventListener('change', () => a.selectOutput(outSel.value || undefined));
  const audBtn = el('button', 'sq-route');
  audBtn.type = 'button';
  audBtn.addEventListener('click', () => { a.setAudition(!a.auditionOn()); });
  routes.append(busBtn, outSel, audBtn);
  root.append(info, dots, routes);

  let outputsKey = '\u0000';
  const paintRoutes = () => {
    busBtn.innerHTML = '<span class="sq-led"></span>MIDI bus';
    busBtn.classList.toggle('sq-on', a.busOn());
    busBtn.setAttribute('aria-pressed', String(a.busOn()));
    audBtn.innerHTML = '<span class="sq-led"></span>Audition';
    audBtn.classList.toggle('sq-on', a.auditionOn());
    audBtn.setAttribute('aria-pressed', String(a.auditionOn()));
    const outs = a.outputs();
    const key = outs.map((o) => o.id).join('|') + (a.selectedOutput() ?? '');
    if (key !== outputsKey) {
      outputsKey = key;
      outSel.replaceChildren(new Option('MIDI out: none', ''), ...outs.map((o) => new Option(o.name, o.id)));
      outSel.value = a.selectedOutput() ?? '';
    }
  };

  return {
    root,
    paint(step: number) {
      const t = c.track;
      const trackNo = String((c.selected[0] ?? 0) + 1).padStart(2, '0');
      const multi = c.selected.length > 1 ? ` +${c.selected.length - 1}` : '';
      line1.textContent = `TRACK ${trackNo}${multi}  ${c.last.name.toUpperCase()} ${c.last.value.toUpperCase()}${c.ctrl ? '  CTRL' : ''}${c.stepEdit.length ? '  STEP EDIT' : ''}`;
      const view = c.view as ViewId;
      const div = nearestDivision(t.division).label;
      line2.textContent = `BANK ${c.bankSlot + 1}${c.isUnsaved() ? '*' : ''}  PATTERN ${c.engine.patternIndex + 1}  ${c.bank.tempo} BPM  DIV ${div}  VIEW ${view.toUpperCase()}`;
      const pulses = c.pulseDots().slice(0, 64);
      if (dots.childElementCount !== pulses.length) {
        dots.replaceChildren(...pulses.map(() => el('i')));
      }
      pulses.forEach((on, i) => {
        const d = dots.children[i] as HTMLElement;
        d.className = `${on ? 'on' : ''}${i === step ? ' now' : ''}`;
      });
      paintRoutes();
    },
  };
}

function buildHelp(): HTMLElement {
  const d = el('details', 'sq-help');
  d.append(el('summary', undefined, 'How to play it'));
  const list = el('ul');
  for (const line of [
    'Pick a track with a pad (the pads start as the 16 tracks). Turn a knob (drag it up and down, use the wheel or the arrow keys) to change it for the selected track.',
    'Press a knob (hold it) to see its value on the pads; double-click to keep that view. Tap a pad to set a value, or to place a pulse in the pulses view. The bank pad takes you home.',
    'Ctrl (tap the pad, or hold Shift) switches to the grey secondary functions: rotate, probability, groove, delay, root, quantize, harmony, offset and pace.',
    'Hold bank, pattern or mute and press pads; tap them to latch without a second finger. Press several pattern pads in order to chain them. Hold temp and turn a knob to change it only while held.',
    'Clear is hold-and-press (a track, a pattern, or a knob to reset). Ctrl and Clear copies; hold Clear and press to paste. Ctrl and a pulse pad starts per-step editing: turn a knob to lock a value to that step.',
    'Play sends MIDI over the in-browser bus: open Lynch 106, MOA-DUO, MOA-DF2 or MOA-PIPE in other tabs (their Sequencer bus switch is on by default) and set their MIDI channel to a track’s channel. MIDI out sends to hardware.',
  ]) list.append(el('li', undefined, line));
  d.append(list);
  return d;
}


import type { AudioEngine, M2600View } from '../audio/engine';
import type { ChoiceControl, NumberControl, ToggleControl } from '../domain/devices/controls';
import type { M2600Synth } from '../domain/devices/m2600Synth';
import { M2600_CHANNELS } from '../domain/devices/m2600Synth';
import { DEST_JACKS, SOURCE_JACKS, jackKind, jackName } from '../domain/devices/m2600Cords';
import { type JackSpot, mountCables } from './m2600Cables';
import { STEPS, fromSlider, toSlider } from './controls';
import { persistPatch } from './m2600Storage';
import { el } from './widgets';

/**
 * The MOA-2600 front panel. On wide screens it is drawn like the hardware: a grey panel in layout units (W x H)
 * with white outlines and labels, LED-capped sliders, rocker switches and jacks, and a column for the SEM filter
 * after the VCF. Everything is placed from coordinates in this file, and the artwork (lines, boxes, labels) is drawn
 * from the same coordinates, so the jacks are already where the phase 2 patch cords will plug in. On narrow screens
 * the same controls stack in cards.
 */
const W = 1380;
const H = 925;
/** The top of the upper and lower sections; their contents are laid out in local y from there. */
const TOP = 50;
const BOT = 640;
/** Upper-section rows (local y): the three horizontal sliders, the vertical sliders, the input jack row. */
const HS = [48, 92, 140] as const;
const VS_TOP = 305;
const VS_BOT = 445;
const JACK_Y = 492;

type Num = NumberControl;
const num = (d: M2600Synth, id: string): Num => {
  const c = d.control(id);
  if (c.kind !== 'number') throw new Error(`${id} is not a number control`);
  return c;
};
const choice = (d: M2600Synth, id: string): ChoiceControl => {
  const c = d.control(id);
  if (c.kind !== 'choice') throw new Error(`${id} is not a choice control`);
  return c;
};
const toggle = (d: M2600Synth, id: string): ToggleControl => {
  const c = d.control(id);
  if (c.kind !== 'toggle') throw new Error(`${id} is not a toggle control`);
  return c;
};

/** A number for people: kHz above 1000 Hz, fewer decimals as values grow. */
function formatValue(c: Num): string {
  const v = c.value;
  if (c.unit === 'Hz' && v >= 1000) return `${(v / 1000).toFixed(2)} kHz`;
  const text = Math.abs(v) >= 100 ? v.toFixed(0) : Math.abs(v) >= 10 ? v.toFixed(1) : v.toFixed(2);
  return `${text}${c.unit ? ' ' + c.unit : ''}`;
}

const esc = (s: string): string => s.replace(/&/g, '&amp;').replace(/</g, '&lt;');

// ---------------------------------------------------------------- the readout

/** One line in the header that names the control last touched and its value. */
class Readout {
  readonly el = el('div', 'm26-readout');
  constructor() {
    this.el.setAttribute('aria-live', 'polite');
    this.el.textContent = 'Drag a slider; double-click resets it';
  }
  show(text: string): void {
    this.el.textContent = text;
  }
}

// ---------------------------------------------------------------- controls

/** An LED-capped slider over a transparent native range input (pointer, keyboard and screen readers all work). */
function slider(c: Num, section: string, vertical: boolean, readout?: Readout): HTMLElement {
  const wrap = el('div', `m26-slider ${vertical ? 'm26-v' : 'm26-h'}`);
  wrap.append(el('div', 'm26-slot'), el('div', 'm26-cap'));
  const input = el('input', 'm26-input');
  input.type = 'range';
  input.min = '0';
  input.max = String(STEPS);
  input.step = '1';
  input.setAttribute('aria-label', `${section} ${c.label}`);
  if (vertical) input.setAttribute('aria-orientation', 'vertical');
  const text = () => `${section} · ${c.label}  ${formatValue(c)}`;
  const sync = () => {
    const v = toSlider(c);
    wrap.style.setProperty('--t', String(v / STEPS));
    input.value = String(v);
    input.setAttribute('aria-valuetext', formatValue(c));
    input.title = text();
  };
  input.addEventListener('input', () => {
    c.set(fromSlider(c, Number(input.value)));
    readout?.show(text());
  });
  input.addEventListener('dblclick', () => {
    c.set(c.initial);
    readout?.show(text());
  });
  input.addEventListener('focus', () => readout?.show(text()));
  c.onChange(sync);
  sync();
  wrap.append(input);
  return wrap;
}

interface SwitchModel {
  positions: readonly string[];
  aria: string;
  get: () => number;
  set: (i: number) => void;
  subscribe: (fn: () => void) => void;
}
const choiceSwitch = (c: ChoiceControl, aria: string, order?: readonly string[]): SwitchModel => {
  const positions = order ?? c.options;
  return { positions, aria, get: () => positions.indexOf(c.value), set: (i) => c.set(positions[i]!), subscribe: (fn) => void c.onChange(fn) };
};
const toggleSwitch = (c: ToggleControl, aria: string, onFirst = true): SwitchModel => ({
  positions: onFirst ? ['on', 'off'] : ['off', 'on'], aria,
  get: () => (c.value === onFirst ? 0 : 1),
  set: (i) => c.set(onFirst ? i === 0 : i === 1),
  subscribe: (fn) => void c.onChange(fn),
});

/** A black rocker switch whose lever sits at the top, middle or bottom of its slot; click steps through, arrows move. */
function rocker(m: SwitchModel, readout?: Readout): HTMLElement {
  const b = el('button', 'm26-switch');
  b.type = 'button';
  b.setAttribute('aria-label', m.aria);
  b.append(el('i'));
  const last = m.positions.length - 1;
  const sync = () => {
    const i = m.get();
    b.style.setProperty('--p', String(last === 0 ? 0 : i / last));
    b.title = `${m.aria}: ${m.positions[i]}`;
    b.setAttribute('aria-description', m.positions[i]!);
  };
  const move = (i: number) => {
    m.set(Math.max(0, Math.min(last, i)));
    readout?.show(`${m.aria}: ${m.positions[m.get()]!.toUpperCase()}`);
  };
  b.addEventListener('click', () => move(m.get() === last ? 0 : m.get() + 1));
  b.addEventListener('keydown', (e) => {
    if (e.key === 'ArrowUp') { e.preventDefault(); move(m.get() - 1); }
    if (e.key === 'ArrowDown') { e.preventDefault(); move(m.get() + 1); }
  });
  m.subscribe(sync);
  sync();
  return b;
}

/** A momentary red button: held down while pressed. */
function momentary(aria: string, press: (on: boolean) => void): HTMLElement {
  const b = el('button', 'm26-button');
  b.type = 'button';
  b.setAttribute('aria-label', aria);
  b.title = aria;
  const down = (e: Event) => { e.preventDefault(); b.classList.add('down'); press(true); };
  const up = () => { if (b.classList.contains('down')) { b.classList.remove('down'); press(false); } };
  b.addEventListener('pointerdown', down);
  b.addEventListener('pointerup', up);
  b.addEventListener('pointerleave', up);
  b.addEventListener('pointercancel', up);
  b.addEventListener('keydown', (e) => { if ((e.key === ' ' || e.key === 'Enter') && !e.repeat) down(e); });
  b.addEventListener('keyup', (e) => { if (e.key === ' ' || e.key === 'Enter') up(); });
  return b;
}

/** A silver knob over a number control: drag up or down, wheel or arrow keys. */
function knob(c: Num, section: string, readout?: Readout): HTMLElement {
  const k = el('div', 'm26-knob');
  k.tabIndex = 0;
  k.setAttribute('role', 'slider');
  k.setAttribute('aria-label', `${section} ${c.label}`);
  k.setAttribute('aria-valuemin', '0');
  k.setAttribute('aria-valuemax', String(STEPS));
  k.append(el('i'));
  const text = () => `${section} · ${c.label}  ${formatValue(c)}`;
  const sync = () => {
    const v = toSlider(c);
    k.style.setProperty('--a', `${-135 + (v / STEPS) * 270}deg`);
    k.setAttribute('aria-valuenow', String(v));
    k.setAttribute('aria-valuetext', formatValue(c));
    k.title = text();
  };
  const nudge = (delta: number) => {
    c.set(fromSlider(c, Math.max(0, Math.min(STEPS, toSlider(c) + delta))));
    readout?.show(text());
  };
  let y0 = 0, v0 = 0;
  k.addEventListener('pointerdown', (e) => {
    y0 = e.clientY;
    v0 = toSlider(c);
    k.setPointerCapture(e.pointerId);
  });
  k.addEventListener('pointermove', (e) => {
    if (!k.hasPointerCapture(e.pointerId)) return;
    c.set(fromSlider(c, Math.max(0, Math.min(STEPS, v0 + (y0 - e.clientY) * 5))));
    readout?.show(text());
  });
  k.addEventListener('wheel', (e) => { e.preventDefault(); nudge(e.deltaY < 0 ? 20 : -20); }, { passive: false });
  k.addEventListener('keydown', (e) => {
    if (e.key === 'ArrowUp' || e.key === 'ArrowRight') { e.preventDefault(); nudge(20); }
    if (e.key === 'ArrowDown' || e.key === 'ArrowLeft') { e.preventDefault(); nudge(-20); }
  });
  k.addEventListener('dblclick', () => c.set(c.initial));
  c.onChange(sync);
  sync();
  return k;
}

function led(cls = ''): HTMLElement {
  const l = el('i', `m26-led ${cls}`.trim());
  l.setAttribute('aria-hidden', 'true');
  return l;
}

// ---------------------------------------------------------------- the desktop panel

/** Collects placed controls and the SVG artwork drawn around them. */
class Board {
  readonly root = el('div', 'm26-desktop');
  readonly jacks = new Map<string, JackSpot>();
  private svg: string[] = [];

  place(child: HTMLElement, cx: number, cy: number, w: number, h = w): HTMLElement {
    child.classList.add('m26-placed');
    child.style.left = `${(((cx - w / 2) / W) * 100).toFixed(3)}%`;
    child.style.top = `${(((cy - h / 2) / H) * 100).toFixed(3)}%`;
    child.style.width = `${((w / W) * 100).toFixed(3)}%`;
    child.style.height = `${((h / H) * 100).toFixed(3)}%`;
    this.root.append(child);
    return child;
  }

  // -- artwork
  draw(markup: string): void {
    this.svg.push(markup);
  }
  text(x: number, y: number, s: string, size = 9, anchor: 'start' | 'middle' | 'end' = 'middle', extra = ''): void {
    this.draw(`<text x="${x}" y="${y}" font-size="${size}" text-anchor="${anchor}" ${extra}>${esc(s)}</text>`);
  }
  /** Lines of text centred on x, the first baseline at y. */
  lines(x: number, y: number, s: string, size = 8.5, gap = size + 1): void {
    s.split('\n').forEach((line, i) => this.text(x, y + i * gap, line, size));
  }
  line(x1: number, y1: number, x2: number, y2: number, w = 1.2): void {
    this.draw(`<line x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}" stroke-width="${w}"/>`);
  }
  path(d: string, w = 1.2): void {
    this.draw(`<path d="${d}" fill="none" stroke-width="${w}"/>`);
  }
  /** A white outlined box with centred text (a module title). */
  box(x: number, y: number, w: number, h: number, s: string, size = 9.5): void {
    this.draw(`<rect x="${x}" y="${y}" width="${w}" height="${h}" fill="none" stroke-width="1.3"/>`);
    const rows = s.split('\n');
    const gap = size + 1.5;
    const first = y + h / 2 - ((rows.length - 1) * gap) / 2 + size * 0.36;
    rows.forEach((r, i) => this.text(x + w / 2, first + i * gap, r, size, 'middle', 'font-weight="700"'));
  }
  /** A bracket over a group of jacks with its name in the middle: ┌── NAME ──┐ */
  bracket(x1: number, x2: number, y: number, s: string): void {
    const mid = (x1 + x2) / 2;
    const half = s.length * 2.6 + 6;
    this.path(`M${x1} ${y + 6} V${y} H${mid - half} M${mid + half} ${y} H${x2} V${y + 6}`);
    this.text(mid, y + 3, s, 8.5, 'middle', 'font-weight="600"');
  }

  /** A jack socket: a button the patch cords plug into (the L/R outputs, which leave the synth, are not patchable). */
  jack(id: string, x: number, y: number, title: string): HTMLElement {
    if (!jackKind(id)) {
      const j = el('span', 'm26-jack');
      j.title = title;
      j.setAttribute('aria-hidden', 'true');
      return this.place(j, x, y, 21);
    }
    const j = el('button', 'm26-jack');
    j.type = 'button';
    j.dataset.jack = id;
    j.title = `${title} — drag to another jack to patch, double-click to unplug`;
    j.setAttribute('aria-label', `Jack ${jackName(id)}`);
    this.jacks.set(id, { el: j, x, y });
    return this.place(j, x, y, 21);
  }
  /** An input jack with the attenuator mark under it and its source in a small box below. */
  inJack(id: string, x: number, y: number, label: string, attenuated = true): void {
    this.jack(id, x, y, `Input: ${label.replace('\n', ' ')}`);
    if (attenuated) {
      this.draw(`<circle cx="${x}" cy="${y + 22}" r="5.5" fill="none" stroke-width="1"/><path d="M${x - 3} ${y + 25} L${x + 3} ${y + 19} M${x + 0.5} ${y + 19} H${x + 3} V${y + 21.5}" fill="none" stroke-width="1"/>`);
    }
    const rows = label.split('\n');
    const w = 26;
    const h = rows.length > 1 ? 21 : 13;
    this.draw(`<rect x="${x - w / 2}" y="${y + 31}" width="${w}" height="${h}" fill="none" stroke-width="0.9"/>`);
    rows.forEach((r, i) => this.text(x, y + 40 + i * 8.5, r, 7));
  }
  outJack(id: string, x: number, y: number, label: string, labelAbove = true): void {
    this.jack(id, x, y, `Output: ${label}`);
    this.text(x, labelAbove ? y - 15 : y + 22, label, 7.5);
  }

  vslider(c: Num, section: string, x: number, top: number, bottom: number, readout: Readout, ticks = true): HTMLElement {
    if (ticks) for (let i = 0; i <= 4; i++) this.line(x + 9, top + 8 + (i * (bottom - top - 16)) / 4, x + 14, top + 8 + (i * (bottom - top - 16)) / 4, 1);
    const s = slider(c, section, true, readout);
    return this.place(s, x, (top + bottom) / 2, 18, bottom - top);
  }
  hslider(c: Num, section: string, x1: number, x2: number, y: number, readout: Readout): HTMLElement {
    const s = slider(c, section, false, readout);
    return this.place(s, (x1 + x2) / 2, y, x2 - x1, 16);
  }

  finish(): HTMLElement {
    this.root.insertAdjacentHTML(
      'afterbegin',
      `<svg class="m26-art" viewBox="0 0 ${W} ${H}" aria-hidden="true" focusable="false"><g class="m26-ink">${this.svg.join('')}</g></svg>`,
    );
    return this.root;
  }
}

/** The patch display and its buttons (both layouts). */
function patchStrip(d: M2600Synth, cls: string): { name: HTMLElement; buttons: HTMLElement[] } {
  const name = el('div', `m26-patch-name ${cls}`);
  name.setAttribute('role', 'status');
  name.setAttribute('aria-label', 'Patch');
  let flash = false;
  const paint = () => {
    name.textContent = `${String(d.currentSlot + 1).padStart(2, '0')} ${d.currentPreset.name}${flash ? '  SAVED' : ''}`;
  };
  d.onPresetChange(paint);
  paint();
  const button = (text: string, aria: string, click: () => void): HTMLElement => {
    const b = el('button', 'm26-patch-btn', text);
    b.type = 'button';
    b.setAttribute('aria-label', aria);
    b.addEventListener('click', click);
    return b;
  };
  const step = (delta: number) => d.loadSlot((d.currentSlot + delta + d.slots.length) % d.slots.length);
  return {
    name,
    buttons: [
      button('◀', 'Previous patch', () => step(-1)),
      button('▶', 'Next patch', () => step(1)),
      button('SAVE', 'Save the panel into this patch slot', () => {
        persistPatch(d.currentSlot, d.saveSlot(d.currentSlot));
        flash = true;
        paint();
        window.setTimeout(() => { flash = false; paint(); }, 1500);
      }),
    ],
  };
}

/** The header button that pulls every cord out, with the number patched. */
function clearCords(d: M2600Synth): HTMLElement {
  const b = el('button', 'm26-patch-btn m26-clear');
  b.type = 'button';
  const sync = () => {
    b.textContent = `CORDS ${d.cords.length} ✕`;
    b.disabled = d.cords.length === 0;
    b.setAttribute('aria-label', `Remove all ${d.cords.length} patch cords`);
  };
  b.addEventListener('click', () => d.clearCords());
  d.onCordsChange(sync);
  sync();
  return b;
}

/** The cords as a list with remove buttons, and two pickers to add one: the phone layout's patch bay (and a keyboard-friendly one). */
function cordsCard(d: M2600Synth): HTMLElement {
  const card = el('section', 'm26-card');
  card.append(el('h2', 'm26-card-title', 'PATCH CORDS'));
  const list = el('ul', 'm26-cord-list');
  const picker = (label: string, ids: readonly string[]): HTMLSelectElement => {
    const s = el('select', 'm26-channel');
    s.setAttribute('aria-label', label);
    for (const id of ids) {
      const o = el('option', '', jackName(id));
      o.value = id;
      s.append(o);
    }
    return s;
  };
  const from = picker('Cord from', SOURCE_JACKS);
  const to = picker('Cord to', DEST_JACKS);
  const add = el('button', 'm26-patch-btn', 'CONNECT');
  add.type = 'button';
  const note = el('p', 'm26-cord-note');
  add.addEventListener('click', () => {
    note.textContent = d.connect(from.value, to.value) ? '' : 'Those two cannot be joined.';
  });
  const form = el('div', 'm26-cord-form');
  form.append(from, el('span', 'm26-item-label', '→'), to, add);
  const paint = () => {
    list.replaceChildren(...d.cords.map((c) => {
      const li = el('li', 'm26-cord');
      li.append(el('span', '', `${jackName(c.from)} → ${jackName(c.to)}`));
      const x = el('button', 'm26-patch-btn', '✕');
      x.type = 'button';
      x.setAttribute('aria-label', `Remove ${jackName(c.from)} to ${jackName(c.to)}`);
      x.addEventListener('click', () => d.setCords(d.cords.filter((k) => k !== c)));
      li.append(x);
      return li;
    }));
    if (d.cords.length === 0) list.append(el('li', 'm26-cord-note', 'No cords: the synth plays on its normalled routing.'));
  };
  d.onCordsChange(paint);
  paint();
  card.append(list, form, note);
  return card;
}

function channelSelect(d: M2600Synth): HTMLElement {
  const c = choice(d, 'play.channel');
  const s = el('select', 'm26-channel');
  s.setAttribute('aria-label', 'MIDI channel');
  for (const ch of M2600_CHANNELS) {
    const o = el('option', '', ch === 'omni' ? 'MIDI OMNI' : `MIDI CH ${ch}`);
    o.value = ch;
    s.append(o);
  }
  const sync = () => { s.value = c.value; };
  s.addEventListener('change', () => c.set(s.value));
  c.onChange(sync);
  sync();
  return s;
}

function buildDesktop(d: M2600Synth, lamps: Lamps): HTMLElement {
  const b = new Board();
  const readout = new Readout();
  const t = (y: number) => TOP + y;
  const u = (y: number) => BOT + y;

  // ---- frame, header and section dividers
  b.draw(`<rect class="m26-face" x="1" y="1" width="${W - 2}" height="${H - 2}" rx="10"/>`);
  for (const [x, y] of [[18, 18], [W - 18, 18], [18, H - 18], [W - 18, H - 18], [W / 2, 18], [W / 2, H - 18]] as const) {
    b.draw(`<g class="m26-screw"><circle cx="${x}" cy="${y}" r="7"/><path d="M${x - 4} ${y} H${x + 4} M${x} ${y - 4} V${y + 4}"/></g>`);
  }
  b.text(40, 37, 'MOA-2600', 28, 'start', 'class="m26-logo"');
  b.text(186, 36, 'SEMI-MODULAR SYNTHESIZER · DUAL FILTER', 10, 'start', 'letter-spacing="2" class="m26-sub"');
  b.place(readout.el, 590, 26, 280, 20);
  b.place(clearCords(d), 777, 26, 74, 24);
  const patch = patchStrip(d, 'm26-patch-desktop');
  b.place(patch.name, 950, 26, 250, 24);
  b.place(patch.buttons[0]!, 1095, 26, 28, 24);
  b.place(patch.buttons[1]!, 1127, 26, 28, 24);
  b.place(patch.buttons[2]!, 1170, 26, 46, 24);
  b.place(channelSelect(d), 1270, 26, 108, 24);
  b.draw(`<rect x="32" y="${TOP - 4}" width="${W - 64}" height="${BOT - TOP - 6}" rx="4" fill="none" stroke-width="1.4"/>`);
  for (const x of [200, 360, 520, 765, 975, 1100, 1240]) b.line(x, t(0), x, t(570), 1.4);
  b.draw(`<rect x="32" y="${BOT - 2}" width="${W - 64}" height="${H - BOT - 22}" rx="4" fill="none" stroke-width="1.4"/>`);
  for (const x of [270, 420, 570, 710, 1020, 1225]) b.line(x, u(4), x, u(252), 1.4);

  // ---- VCOs
  const vco = (n: 1 | 2 | 3, x0: number) => {
    const id = `vco${n}`;
    const name = `VCO ${n}`;
    const x1 = x0 + 12, x2 = x0 + 148;
    b.text((x1 + x2) / 2, t(18), 'INITIAL OSCILLATOR FREQUENCY', 8);
    ['10', '100', '1kHz', '10kHz'].forEach((s, i) => b.text(x1 + 8 + i * 40, t(31), s, 6.5));
    ['.03', '0.3', '3.0', '30.'].forEach((s, i) => b.text(x1 + 8 + i * 40, t(38), s, 6, 'middle', 'class="m26-dim"'));
    b.hslider(num(d, `${id}.freq`), name, x1, x2, t(HS[0]), readout);
    b.text((x1 + x2) / 2, t(74), 'FINE TUNE', 8);
    b.line((x1 + x2) / 2, t(78), (x1 + x2) / 2, t(83), 1);
    b.hslider(num(d, `${id}.fine`), name, x1, x2, t(HS[1]), readout);
    b.text((x1 + x2) / 2, t(120), 'PULSE WIDTH', 8);
    b.text(x1 + 6, t(128), '10%', 6.5); b.text((x1 + x2) / 2, t(128), '50%', 6.5); b.text(x2 - 6, t(128), '90%', 6.5);
    b.hslider(num(d, `${id}.pw`), name, x1, x2, t(HS[2]), readout);

    // title box and outputs
    if (n === 1) {
      b.box(x0 + 8, t(212), 92, 44, 'VOLTAGE\nCONTROLLED\nOSCILLATOR 1', 8.5);
      b.text(x0 + 135, t(178), 'OUTPUTS', 7, 'middle', 'class="m26-dim"');
      b.outJack('vco1.saw', x0 + 135, t(205), 'SAW');
      b.outJack('vco1.pulse', x0 + 135, t(262), 'PULSE');
      b.path(`M${x0 + 100} ${t(225)} H${x0 + 122} M${x0 + 100} ${t(245)} Q${x0 + 112} ${t(245)} ${x0 + 112} ${t(262)} H${x0 + 122}`);
      b.draw(`<g transform="translate(${x0 + 30} ${t(176)})" class="m26-mark"><circle cx="9" cy="9" r="9"/><path d="M3 12 L7 5 L9 10 L11 5 L15 12"/></g>`);
    } else {
      b.text(x0 + 20, t(176), 'SYNC', 7.5);
      b.text(x0 + 20, t(186), 'ON', 6.5);
      b.place(rocker(toggleSwitch(toggle(d, `${id}.sync`), `${name} sync to VCO 1`), readout), x0 + 20, t(206), 14, 30);
      b.text(x0 + 20, t(232), 'OFF', 6.5);
      b.box(x0 + 34, t(212), 64, 44, `VOLTAGE\nCONTROLLED\nOSCILLATOR ${n}`, 7.5);
      b.outJack(`${id}.tri`, x0 + 112, t(198), 'TRI');
      b.outJack(`${id}.saw`, x0 + 142, t(198), 'SAW');
      b.outJack(`${id}.sine`, x0 + 112, t(268), 'SINE', false);
      b.outJack(`${id}.pulse`, x0 + 142, t(268), 'PULSE', false);
      b.path(`M${x0 + 98} ${t(226)} H${x0 + 104} V${t(210)} M${x0 + 98} ${t(242)} H${x0 + 104} V${t(256)}`);
    }

    // range switch in the keyboard slot, FM sliders over their jacks
    const pitch = n === 1 ? 36 : 32;
    const first = n === 1 ? x0 + 22 : x0 + 18;
    const xs = Array.from({ length: n === 1 ? 4 : 5 }, (_, i) => first + i * pitch);
    b.text(xs[0]!, t(360), 'AUDIO', 7);
    b.text(xs[0]!, t(369), 'KYBD ON', 6.5);
    b.place(rocker(choiceSwitch(choice(d, `${id}.range`), `${name} range`), readout), xs[0]!, t(392), 14, 30);
    b.text(xs[0]!, t(418), 'KYBD OFF', 6.5);
    b.text(xs[0]!, t(427), 'LF', 7);
    const sliders: Record<1 | 2 | 3, [string, string][]> = {
      1: [['fm.sh', 'S/H\nOUT'], ['fm.adsr', 'ADSR'], ['fm.lfo', 'LFO']],
      2: [['fm.sh', 'S/H\nOUT'], ['fm.adsr', 'ADSR'], ['fm.vco1', 'VCO 1\n⊓⊔'], ['pwm', 'NOISE\nGEN']],
      3: [['fm.noise', 'NOISE\nGEN'], ['fm.adsr', 'ADSR'], ['fm.vco2', 'VCO 2\n∿'], ['pwm', 'ADSR']],
    };
    b.inJack(`${id}.fm.kybd`, xs[0]!, t(JACK_Y), 'KYBD\nCV', false);
    sliders[n].forEach(([key, label], i) => {
      const x = xs[i + 1]!;
      b.vslider(num(d, `${id}.${key}`), name, x, t(VS_TOP), t(VS_BOT), readout);
      b.inJack(`${id}.${key}`, x, t(JACK_Y), label);
      b.path(`M${x} ${t(VS_TOP - 6)} V${t(290)} L${x0 + (n === 1 ? 54 : 66) + (i - 1) * 8} ${t(258)}`, 1);
    });
    const fmEnd = n === 1 ? xs[3]! : xs[3]!;
    b.bracket(xs[0]! - 4, fmEnd + 4, t(468), 'FM CONTROL');
    if (n !== 1) b.text(xs[4]!, t(471), 'PWM', 8, 'middle', 'font-weight="600"');
  };
  vco(1, 40);
  vco(2, 200);
  vco(3, 360);

  // ---- VCF
  {
    const x1 = 575, x2 = 748;
    b.text((x1 + x2) / 2, t(18), 'INITIAL FILTER FREQUENCY', 8);
    ['10', '100', '1kHz', '10kHz'].forEach((s, i) => b.text(x1 + 10 + i * 51, t(31), s, 6.5));
    b.hslider(num(d, 'vcf.freq'), 'VCF', x1, x2, t(HS[0]), readout);
    b.text((x1 + x2) / 2, t(74), 'FINE TUNE', 8);
    b.hslider(num(d, 'vcf.fine'), 'VCF', x1, x2, t(HS[1]), readout);
    b.text((x1 + x2) / 2, t(120), 'RESONANCE', 8);
    b.text(x1 + 8, t(128), 'MIN', 6.5); b.text(x2 - 8, t(128), 'MAX', 6.5);
    b.hslider(num(d, 'vcf.res'), 'VCF', x1, x2, t(HS[2]), readout);
    b.text(548, t(176), 'MODE', 8);
    b.text(548, t(186), '4012', 6.5);
    b.place(rocker(choiceSwitch(choice(d, 'vcf.mode'), 'VCF mode, 4012 or 4072'), readout), 548, t(206), 14, 30);
    b.text(548, t(232), '4072', 6.5);
    b.box(598, t(196), 116, 52, 'VOLTAGE\nCONTROLLED\nFILTER / RESONATOR\nVCF', 8);
    b.outJack('vcf.out', 744, t(222), 'OUTPUT');
    b.line(714, t(222), 731, t(222));
    const audio: [string, string][] = [['in.ring', 'RING\nMOD'], ['in.vco1', 'VCO 1\n⊓⊔'], ['in.vco2', 'VCO 2\n⊓⊔'], ['in.vco3', 'VCO 3\n⩘'], ['in.noise', 'NOISE\nGEN']];
    const control: [string, string][] = [['cv.kybd', 'KYBD\nCV'], ['cv.adsr', 'ADSR'], ['cv.vco2', 'VCO 2\n∿']];
    [...audio, ...control].forEach(([key, label], i) => {
      const x = 542 + i * 30;
      b.vslider(num(d, `vcf.${key}`), 'VCF', x, t(VS_TOP), t(VS_BOT), readout);
      b.inJack(`vcf.${key}`, x, t(JACK_Y), label);
      b.path(`M${x} ${t(VS_TOP - 6)} V${t(282 + (i % 4) * 4)} L${606 + i * 14} ${t(248)}`, 1);
    });
    b.bracket(538, 666, t(468), 'AUDIO');
    b.bracket(688, 756, t(468), 'CONTROL');
  }

  // ---- SEM
  {
    const x1 = 790, x2 = 955;
    b.text((x1 + x2) / 2, t(18), 'SEM FILTER FREQUENCY', 8);
    ['10', '100', '1kHz', '10kHz'].forEach((s, i) => b.text(x1 + 10 + i * 48, t(31), s, 6.5));
    b.hslider(num(d, 'sem.freq'), 'SEM', x1, x2, t(HS[0]), readout);
    b.text((x1 + x2) / 2, t(74), 'RESONANCE', 8);
    b.text(x1 + 8, t(82), 'MIN', 6.5); b.text(x2 - 8, t(82), 'MAX', 6.5);
    b.hslider(num(d, 'sem.res'), 'SEM', x1, x2, t(HS[1]), readout);
    b.text((x1 + x2) / 2, t(120), 'MODE', 8);
    b.text(x1 + 6, t(128), 'LP', 7); b.text((x1 + x2) / 2, t(128), 'NOTCH', 7); b.text(x2 - 6, t(128), 'HP', 7);
    b.hslider(num(d, 'sem.mode'), 'SEM', x1, x2, t(HS[2]), readout);
    b.text(790, t(176), 'BAND', 7.5);
    b.text(790, t(186), 'BP', 6.5);
    b.place(rocker(toggleSwitch(toggle(d, 'sem.bp'), 'SEM band pass'), readout), 790, t(206), 14, 30);
    b.text(790, t(232), 'MODE', 6.5);
    b.text(828, t(176), 'ROUTE', 7.5);
    b.text(828, t(186), 'OFF', 6.5);
    b.place(rocker(choiceSwitch(choice(d, 'sem.route'), 'SEM route: off, series or parallel'), readout), 828, t(206), 14, 30);
    b.text(843, t(209), 'SER', 6.5, 'start');
    b.text(828, t(232), 'PARALLEL', 6.5);
    b.box(856, t(196), 82, 52, 'SEM\nSTATE-VARIABLE\nFILTER\nLP · N · HP · BP', 7.5);
    b.outJack('sem.out', 957, t(240), 'OUTPUT', false);
    b.path(`M938 ${t(222)} H957 V${t(229)}`);
    const audio: [string, string][] = [['in.vco1', 'VCO 1\n⩘'], ['in.vco2', 'VCO 2\n⩘'], ['in.vco3', 'VCO 3\n⊓⊔'], ['in.noise', 'NOISE\nGEN']];
    const control: [string, string][] = [['cv.kybd', 'KYBD\nCV'], ['cv.adsr', 'ADSR'], ['cv.lfo', 'LFO\n∿']];
    [...audio, ...control].forEach(([key, label], i) => {
      const x = 785 + i * 29.5;
      b.vslider(num(d, `sem.${key}`), 'SEM', x, t(VS_TOP), t(VS_BOT), readout);
      b.inJack(`sem.${key}`, x, t(JACK_Y), label);
      b.path(`M${x} ${t(VS_TOP - 6)} V${t(282 + (i % 4) * 4)} L${866 + i * 10} ${t(248)}`, 1);
    });
    b.bracket(781, 877, t(468), 'AUDIO');
    b.bracket(903, 966, t(468), 'CONTROL');
  }

  // ---- envelopes
  {
    const adsr: [string, string][] = [['attack', 'ATTACK\nTIME'], ['decay', 'DECAY\nTIME'], ['sustain', 'SUS\nLEVEL'], ['release', 'REL\nTIME']];
    adsr.forEach(([key, label], i) => {
      const x = 992 + i * 30;
      b.lines(x, t(14), label, 7.5);
      b.vslider(num(d, `adsr.${key}`), 'ADSR', x, t(30), t(175), readout);
    });
    b.box(984, t(186), 108, 26, 'ADSR\nENVELOPE GENERATOR', 7.5);
    b.text(994, t(230), 'x2', 6.5);
    b.place(rocker(choiceSwitch(choice(d, 'adsr.factor'), 'ADSR time factor', ['x2', 'x1', 'x0.5']), readout), 994, t(252), 14, 30);
    b.text(994, t(278), 'x0.5', 6.5);
    b.text(994, t(287), 'TIME', 6.5);
    b.outJack('adsr.out', 1080, t(240), 'OUTPUT', false);
    b.line(1080, t(212), 1080, t(229));
    // AR
    b.lines(994, t(304), 'ATTACK\nTIME', 7);
    b.vslider(num(d, 'ar.attack'), 'AR', 994, t(320), t(445), readout);
    b.lines(1082, t(304), 'REL\nTIME', 7);
    b.vslider(num(d, 'ar.release'), 'AR', 1082, t(320), t(445), readout);
    b.text(1024, t(310), 'MANUAL', 6.5);
    b.place(momentary('AR manual gate', (on) => d.setManual(on)), 1024, t(330), 18);
    b.outJack('ar.out', 1054, t(330), 'OUTPUT');
    b.box(1010, t(352), 58, 24, 'AR\nENV GEN', 7.5);
    b.text(1024, t(392), 'KYBD', 6.5);
    b.place(rocker(choiceSwitch(choice(d, 'ar.source'), 'AR gate: keyboard or S/H clock'), readout), 1024, t(412), 14, 28);
    b.text(1024, t(437), 'S/H', 6.5);
    b.text(1054, t(392), 'x2', 6.5);
    b.place(rocker(choiceSwitch(choice(d, 'ar.factor'), 'AR time factor', ['x2', 'x1', 'x0.5']), readout), 1054, t(412), 14, 28);
    b.text(1054, t(437), 'x0.5', 6.5);
    b.jack('adsr.gate', 996, t(JACK_Y), 'Input: ADSR gate (keyboard gate)');
    b.text(996, t(JACK_Y + 22), 'GATE IN', 6.5);
    b.jack('adsr.trig', 1030, t(JACK_Y), 'Input: ADSR trigger (keyboard trigger)');
    b.text(1030, t(JACK_Y + 22), 'TRIG IN', 6.5);
    b.jack('ar.gate', 1064, t(JACK_Y), 'Input: AR gate');
    b.text(1064, t(JACK_Y + 22), 'AR GATE', 6.5);
    b.text(1030, t(471), 'GATES', 8, 'middle', 'font-weight="600"');
  }

  // ---- VCA
  {
    b.lines(1120, t(14), 'INITIAL\nGAIN', 7.5);
    b.vslider(num(d, 'vca.gain'), 'VCA', 1120, t(30), t(175), readout);
    b.box(1144, t(186), 88, 40, 'VOLTAGE\nCONTROLLED\nAMPLIFIER', 8);
    b.outJack('vca.out', 1188, t(150), 'OUTPUT');
    b.line(1188, t(161), 1188, t(186));
    const inputs: [string, string][] = [['in.vcf', 'VCF\n/SEM'], ['in.sem', 'SEM'], ['in.ring', 'RING\nMOD'], ['cv.ar', 'AR'], ['cv.adsr', 'ADSR']];
    inputs.forEach(([key, label], i) => {
      const x = 1118 + i * 28;
      b.vslider(num(d, `vca.${key}`), 'VCA', x, t(VS_TOP), t(VS_BOT), readout);
      b.inJack(`vca.${key}`, x, t(JACK_Y), label);
      b.path(`M${x} ${t(VS_TOP - 6)} V${t(260 + i * 4)} L${1156 + i * 13} ${t(226)}`, 1);
    });
    b.bracket(1114, 1178, t(468), 'AUDIO');
    b.text(1200, t(471), 'LIN', 6.5); b.text(1228, t(471), 'EXP', 6.5);
  }

  // ---- outputs, reverb and mixer
  {
    b.outJack('out.L', 1262, t(30), 'L OUT', false);
    b.outJack('out.R', 1318, t(30), 'R OUT', false);
    b.text(1290, t(70), 'PAN', 7.5);
    b.hslider(num(d, 'mix.pan'), 'Output', 1252, 1328, t(84), readout);
    b.jack('out.left', 1262, t(118), 'Input: left output');
    b.text(1262, t(140), 'LEFT IN', 6.5);
    b.jack('out.right', 1318, t(118), 'Input: right output');
    b.text(1318, t(140), 'RIGHT IN', 6.5);
    b.text(1265, t(156), 'L', 7.5); b.text(1315, t(156), 'R', 7.5);
    b.vslider(num(d, 'reverb.left'), 'Reverb', 1265, t(162), t(240), readout);
    b.vslider(num(d, 'reverb.right'), 'Reverb', 1315, t(162), t(240), readout);
    b.box(1266, t(248), 48, 15, 'REVERB', 8);
    b.outJack('mix.out', 1262, t(285), 'MIX OUT', false);
    b.outJack('reverb.out', 1318, t(285), 'REV OUT', false);
    b.vslider(num(d, 'mix.vcf'), 'Mixer', 1265, t(VS_TOP + 20), t(VS_BOT - 10), readout);
    b.vslider(num(d, 'mix.vca'), 'Mixer', 1315, t(VS_TOP + 20), t(VS_BOT - 10), readout);
    b.box(1268, t(450), 44, 14, 'MIXER', 8);
    b.inJack('mix.in.vcf', 1265, t(JACK_Y), 'VCF\n/SEM');
    b.inJack('mix.in.vca', 1315, t(JACK_Y), 'VCA');
  }

  // ---- lower section: keyboard controller
  {
    const top: [string, number, string][] = [['kb.trig', 60, 'TRIG OUT'], ['kb.upper', 100, 'UPPER\nVOICE']];
    top.forEach(([id, x, label]) => { b.lines(x, u(14), label, 6.5); b.jack(id, x, u(38), `Output: ${label.replace('\n', ' ')}`); });
    b.text(60, u(64), 'GATE OUT', 6.5); b.jack('kb.gate', 60, u(84), 'Output: keyboard gate');
    b.text(100, u(64), 'KYBD CV', 6.5); b.jack('kb.cv', 100, u(84), 'Output: keyboard CV');
    b.lines(142, u(12), 'VOICE\nMODE', 7.5);
    b.text(142, u(32), 'MONO', 6.5);
    b.place(rocker(choiceSwitch(choice(d, 'kb.voice'), 'Voice mode: mono or duo'), readout), 142, u(54), 14, 30);
    b.text(142, u(80), 'DUO', 6.5);
    b.text(186, u(16), 'LFO ∿', 6.5); b.jack('lfo.tri', 186, u(38), 'Output: LFO triangle');
    b.text(186, u(64), 'LFO ⊓⊔', 6.5); b.jack('lfo.square', 186, u(84), 'Output: LFO square');
    b.lines(228, u(12), 'EXT VIB\nIN', 6.5); b.jack('kb.extvib', 228, u(38), 'Input: external vibrato');
    b.lines(228, u(60), 'LFO\nDELAYED', 6.5); b.jack('lfo.delayed', 228, u(84), 'Output: delayed LFO');
    b.text(54, u(120), 'ON', 6.5);
    b.place(rocker(toggleSwitch(toggle(d, 'kb.portaOn'), 'Portamento on or off'), readout), 54, u(142), 14, 30);
    b.text(54, u(168), 'OFF', 6.5);
    b.text(54, u(184), 'MOMEN', 6.5);
    b.place(momentary('Portamento, while held', (on) => d.setPortamentoHeld(on)), 54, u(200), 16);
    b.text(86, u(114), 'MAX', 6.5, 'end');
    b.text(86, u(214), 'MIN', 6.5, 'end');
    b.vslider(num(d, 'kb.porta'), 'Portamento', 98, u(108), u(220), readout, false);
    b.box(40, u(226), 74, 14, 'PORTAMENTO', 8);
    b.text(142, u(108), 'REPEAT', 7.5);
    b.text(142, u(117), 'KYBD', 6.5);
    b.place(rocker(choiceSwitch(choice(d, 'kb.repeat'), 'Repeat: keyboard, off or auto'), readout), 142, u(138), 14, 30);
    b.text(156, u(141), 'OFF', 6.5, 'start');
    b.text(142, u(163), 'AUTO', 6.5);
    b.lines(142, u(178), 'TRIG\nMODE', 7.5);
    b.text(142, u(196), 'SINGLE', 6.5);
    b.place(rocker(choiceSwitch(choice(d, 'kb.trig'), 'Trigger mode: single or multi'), readout), 142, u(214), 12, 22);
    b.text(142, u(233), 'MULTI', 6.5);
    const lfoLed = b.place(led('m26-lfo-led'), 186, u(104), 7);
    lamps.add(lfoLed, (v) => v.lfo);
    b.vslider(num(d, 'lfo.speed'), 'LFO', 186, u(112), u(212), readout);
    b.vslider(num(d, 'lfo.delay'), 'Vibrato', 216, u(112), u(212), readout);
    b.vslider(num(d, 'lfo.depth'), 'Vibrato', 246, u(112), u(212), readout);
    b.lines(186, u(224), 'LFO\nSPEED', 7);
    b.lines(216, u(224), 'VIB\nDELAY', 7);
    b.lines(246, u(224), 'VIB\nDEPTH', 7);
  }

  // ---- preamp and envelope follower
  {
    b.box(278, u(10), 46, 15, 'PREAMP', 7.5);
    b.outJack('pre.out', 312, u(48), 'OUTPUT', false);
    b.text(288, u(86), 'GAIN', 7);
    b.vslider(num(d, 'pre.gain'), 'Preamp', 288, u(94), u(220), readout, false);
    b.text(322, u(108), 'x1000', 6.5);
    b.place(rocker(choiceSwitch(choice(d, 'pre.range'), 'Preamp range', ['x1000', 'x100', 'x10']), readout), 322, u(132), 14, 30);
    b.text(322, u(158), 'x10', 6.5);
    b.text(322, u(186), 'INPUT', 6.5);
    b.jack('pre.in', 322, u(204), 'Input: preamp');
    b.box(350, u(8), 64, 22, 'ENV\nFOLLOWER', 7.5);
    b.outJack('envf.out', 396, u(52), 'OUTPUT', false);
    b.vslider(num(d, 'envf.gain'), 'Envelope follower', 362, u(94), u(220), readout);
    b.box(380, u(176), 34, 12, 'PREAMP', 6);
    b.jack('envf.in', 396, u(204), 'Input: envelope follower (normalled to the preamp)');
  }

  // ---- ring modulator
  {
    b.box(440, u(8), 74, 18, 'RING MOD', 9);
    b.outJack('ring.out', 548, u(30), 'OUTPUT', false);
    b.vslider(num(d, 'ring.a'), 'Ring mod', 444, u(70), u(220), readout);
    b.vslider(num(d, 'ring.b'), 'Ring mod', 548, u(70), u(220), readout);
    b.text(496, u(84), 'AUDIO', 6.5);
    b.place(rocker(choiceSwitch(choice(d, 'ring.mode'), 'Ring mod: audio or DC coupled'), readout), 496, u(106), 14, 30);
    b.text(496, u(132), 'DC', 6.5);
    b.box(462, u(166), 28, 20, 'VCO 1\n⩘', 6);
    b.jack('ring.a', 476, u(204), 'Input: ring mod A (VCO 1 saw)');
    b.box(502, u(166), 28, 20, 'VCO 2\n∧', 6);
    b.jack('ring.b', 516, u(204), 'Input: ring mod B (VCO 2 triangle)');
  }

  // ---- noise
  {
    b.box(580, u(8), 96, 18, 'NOISE GENERATOR', 8);
    b.outJack('noise.out', 692, u(44), 'OUTPUT', false);
    b.text(610, u(62), 'COLOR', 7.5);
    b.text(598, u(78), 'WHITE', 6.5, 'end');
    b.text(598, u(148), 'PINK', 6.5, 'end');
    b.text(598, u(212), 'LOW', 6.5, 'end');
    b.text(598, u(220), 'FREQ', 6.5, 'end');
    b.vslider(num(d, 'noise.color'), 'Noise', 610, u(72), u(222), readout, false);
    b.text(662, u(62), 'LEVEL', 7.5);
    b.vslider(num(d, 'noise.level'), 'Noise', 662, u(72), u(222), readout);
  }

  // ---- voltage processors and the mult
  {
    b.text(808, u(22), 'MULT', 7.5, 'end');
    [828, 858, 888, 918].forEach((x, i) => { b.jack(`mult.${i + 1}`, x, u(18), 'Mult'); if (i) b.line(x - 19, u(18), x - 11, u(18)); });
    b.box(796, u(38), 136, 18, 'VOLTAGE PROCESSOR', 9);
    const rows: [string, string, number][] = [['vp.2', '2  −10V', 86], ['vp.4', '4  KYBD CV', 124], ['vp.6', '6  +10V', 164], ['vp.lag', '7  ENV FOLL', 206]];
    for (const [id, label, y] of rows) {
      b.text(722, u(y - 14), label, 6.5, 'start');
      b.jack(id === 'vp.lag' ? 'vp.7' : id, 732, u(y), `Input: processor ${label}`);
      b.hslider(num(d, id), 'Voltage processor', 752, 892, u(y), readout);
    }
    b.text(822, u(226), '→ INCREASE LAG TIME →', 6.5);
    b.jack('vp.1', 918, u(70), 'Input: processor 1'); b.text(904, u(73), '1', 6.5, 'end');
    b.jack('vp.3', 918, u(104), 'Input: processor 3'); b.text(904, u(107), '3', 6.5, 'end');
    b.path(`M892 ${u(86)} H940 M892 ${u(124)} H940 V${u(86)} M929 ${u(70)} H940 V${u(86)} M929 ${u(104)} H940`);
    b.draw(`<path d="M948 ${u(88)} L962 ${u(88)} L955 ${u(74)} Z" fill="none" stroke-width="1"/>`);
    b.path(`M940 ${u(86)} H948`);
    b.outJack('vp.inv1', 996, u(86), 'INVERTER', false);
    b.path(`M962 ${u(86)} H985`);
    b.jack('vp.5', 918, u(144), 'Input: processor 5'); b.text(904, u(147), '5', 6.5, 'end');
    b.path(`M892 ${u(164)} H950 M918 ${u(155)} V${u(164)}`);
    b.draw(`<path d="M950 ${u(157)} L950 ${u(171)} L963 ${u(164)} Z" fill="none" stroke-width="1"/>`);
    b.outJack('vp.inv2', 996, u(164), 'INVERTER', false);
    b.path(`M963 ${u(164)} H985`);
    b.box(928, u(199), 30, 14, 'LAG', 7.5);
    b.path(`M892 ${u(206)} H928 M958 ${u(206)} H985`);
    b.jack('vp.lag', 996, u(206), 'Output: lag');
  }

  // ---- sample-and-hold and electronic switch
  {
    b.box(1058, u(8), 92, 18, 'SAMPLE & HOLD', 8.5);
    b.jack('sh.in', 1040, u(46), 'Input: S/H (normalled to noise)');
    b.box(1027, u(60), 26, 20, 'NOISE\nGEN', 6);
    b.jack('sh.clk', 1040, u(104), 'Output: S/H internal clock');
    b.lines(1062, u(98), 'INT\nCLK', 6.5);
    b.jack('sh.out', 1040, u(150), 'Output: S/H');
    b.lines(1062, u(146), 'S/H\nOUT', 6.5);
    b.jack('sh.extclk', 1040, u(200), 'Input: S/H external clock');
    b.lines(1062, u(196), 'EXT\nCLK', 6.5);
    const clkLed = b.place(led(), 1112, u(46), 8);
    lamps.add(clkLed, (v) => v.clk);
    b.text(1096, u(64), 'LEVEL', 6.5);
    b.vslider(num(d, 'sh.level'), 'S/H', 1096, u(72), u(220), readout);
    b.text(1136, u(64), 'RATE', 6.5);
    b.vslider(num(d, 'sh.rate'), 'S/H', 1136, u(72), u(220), readout);
    b.lines(1192, u(14), 'ELEC\nSWITCH', 7);
    b.jack('esw.a', 1174, u(46), 'Input: electronic switch A'); b.text(1174, u(64), 'A', 7);
    b.jack('esw.b', 1210, u(46), 'Input: electronic switch B'); b.text(1210, u(64), 'B', 7);
    const ledA = b.place(led('m26-amber'), 1174, u(76), 7);
    const ledB = b.place(led('m26-amber'), 1210, u(76), 7);
    lamps.add(ledA, (v) => v.esw === 0);
    lamps.add(ledB, (v) => v.esw === 1);
    b.draw(`<circle cx="1192" cy="${u(112)}" r="10" fill="none" stroke-width="1.2"/>`);
    b.path(`M1174 ${u(84)} V${u(100)} L1188 ${u(108)} M1210 ${u(84)} V${u(100)} L1196 ${u(108)} M1192 ${u(122)} V${u(134)}`);
    b.outJack('esw.c', 1192, u(146), 'C', false);
    b.box(1172, u(186), 40, 22, 'INT\nCLOCK', 7);
  }

  // ---- volume and gate lamp
  {
    b.text(1280, u(30), 'VOLUME', 8);
    b.place(knob(num(d, 'out.volume'), 'Output', readout), 1280, u(78), 58);
    ['0', '2', '4', '6', '8', '10'].forEach((s, i) => {
      const a = ((-135 + i * 54) * Math.PI) / 180;
      b.text(1280 + Math.sin(a) * 40, u(78) - Math.cos(a) * 40 + 3, s, 6.5);
    });
    const gate = b.place(led('m26-amber'), 1280, u(150), 10);
    lamps.add(gate, (v) => v.gate);
    b.text(1280, u(172), 'GATE', 8);
  }

  const root = b.finish();
  mountCables(root, d, b.jacks, W, H, (text) => readout.show(text));
  return root;
}

// ---------------------------------------------------------------- lamps


/** LEDs that follow the worklet's view, polled once a frame. */
class Lamps {
  private list: [HTMLElement, (v: M2600View) => boolean][] = [];
  add(e: HTMLElement, on: (v: M2600View) => boolean): void {
    this.list.push([e, on]);
  }
  start(engine: AudioEngine): void {
    const tick = () => {
      const v = engine.readM2600('m2600', 'synth');
      if (v) for (const [e, on] of this.list) e.classList.toggle('on', on(v));
      requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  }
}

// ---------------------------------------------------------------- the phone layout

/** Each module's controls, in panel order, for the stacked layout. */
const CARDS: [title: string, ids: string[]][] = [
  ['VCO 1', ['vco1.range', 'vco1.freq', 'vco1.fine', 'vco1.pw', 'vco1.fm.sh', 'vco1.fm.adsr', 'vco1.fm.lfo']],
  ['VCO 2', ['vco2.range', 'vco2.sync', 'vco2.freq', 'vco2.fine', 'vco2.pw', 'vco2.fm.sh', 'vco2.fm.adsr', 'vco2.fm.vco1', 'vco2.pwm']],
  ['VCO 3', ['vco3.range', 'vco3.sync', 'vco3.freq', 'vco3.fine', 'vco3.pw', 'vco3.fm.noise', 'vco3.fm.adsr', 'vco3.fm.vco2', 'vco3.pwm']],
  ['VCF', ['vcf.mode', 'vcf.freq', 'vcf.fine', 'vcf.res', 'vcf.in.ring', 'vcf.in.vco1', 'vcf.in.vco2', 'vcf.in.vco3', 'vcf.in.noise', 'vcf.cv.kybd', 'vcf.cv.adsr', 'vcf.cv.vco2']],
  ['SEM FILTER', ['sem.route', 'sem.bp', 'sem.freq', 'sem.res', 'sem.mode', 'sem.in.vco1', 'sem.in.vco2', 'sem.in.vco3', 'sem.in.noise', 'sem.cv.kybd', 'sem.cv.adsr', 'sem.cv.lfo']],
  ['ADSR', ['adsr.factor', 'adsr.attack', 'adsr.decay', 'adsr.sustain', 'adsr.release']],
  ['AR', ['ar.source', 'ar.factor', 'ar.attack', 'ar.release']],
  ['VCA', ['vca.gain', 'vca.in.vcf', 'vca.in.sem', 'vca.in.ring', 'vca.cv.ar', 'vca.cv.adsr']],
  ['MIXER & OUTPUT', ['mix.vcf', 'mix.vca', 'reverb.left', 'reverb.right', 'mix.pan', 'out.volume']],
  ['KEYBOARD & LFO', ['kb.voice', 'kb.trig', 'kb.repeat', 'kb.portaOn', 'kb.porta', 'lfo.speed', 'lfo.delay', 'lfo.depth']],
  ['RING MOD & NOISE', ['ring.mode', 'ring.a', 'ring.b', 'noise.color', 'noise.level']],
  ['SAMPLE & HOLD', ['sh.level', 'sh.rate']],
  ['PREAMP & PROCESSORS', ['pre.range', 'pre.gain', 'envf.gain', 'vp.2', 'vp.4', 'vp.6', 'vp.lag']],
];

function buildMobile(d: M2600Synth): HTMLElement {
  const root = el('div', 'm26-mobile');
  const patch = patchStrip(d, 'm26-patch-mobile');
  const row = el('div', 'm26-patch-row');
  row.append(patch.buttons[0]!, patch.name, patch.buttons[1]!, patch.buttons[2]!);
  const manual = momentary('AR manual gate', (on) => d.setManual(on));
  manual.classList.add('m26-manual-mobile');
  manual.textContent = 'AR MANUAL';
  const tools = el('div', 'm26-patch-row');
  tools.append(channelSelect(d), manual);
  root.append(row, tools, cordsCard(d));
  for (const [title, ids] of CARDS) {
    const card = el('section', 'm26-card');
    card.append(el('h2', 'm26-card-title', title));
    for (const id of ids) {
      const c = d.control(id);
      const item = el('div', 'm26-item');
      if (c.kind === 'number') {
        const name = el('span', 'm26-item-label', c.label);
        const value = el('span', 'm26-item-value');
        const sync = () => { value.textContent = formatValue(c); };
        c.onChange(sync);
        sync();
        item.append(name, value, slider(c, title, false));
      } else {
        item.classList.add('m26-item-choice');
        item.append(el('span', 'm26-item-label', c.label));
        const options = c.kind === 'choice' ? c.options : ['off', 'on'];
        const group = el('div', 'm26-seg');
        group.setAttribute('role', 'group');
        group.setAttribute('aria-label', `${title} ${c.label}`);
        const buttons = options.map((o) => {
          const btn = el('button', 'm26-seg-btn', o.toUpperCase());
          btn.type = 'button';
          btn.addEventListener('click', () => (c.kind === 'choice' ? c.set(o) : c.set(o === 'on')));
          group.append(btn);
          return [o, btn] as const;
        });
        const paint = () => buttons.forEach(([o, btn]) => {
          const on = c.kind === 'choice' ? c.value === o : (o === 'on') === c.value;
          btn.classList.toggle('on', on);
          btn.setAttribute('aria-pressed', String(on));
        });
        c.onChange(paint);
        paint();
        item.append(group);
      }
      card.append(item);
    }
    root.append(card);
  }
  return root;
}

/** The MOA-2600 front panel: the hardware-style layout on wide screens, stacked cards on narrow ones. */
export function renderM2600Panel(d: M2600Synth, engine?: AudioEngine): HTMLElement {
  const root = el('div', 'm26-case');
  const lamps = new Lamps();
  root.append(buildDesktop(d, lamps), buildMobile(d));
  if (engine) lamps.start(engine);
  return root;
}

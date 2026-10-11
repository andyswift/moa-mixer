import type { AudioEngine } from '../audio/engine';
import type { NumberControl, ToggleControl } from '../domain/devices/controls';
import { AUX_PAIRS, BUSES, type Mixer } from '../domain/devices/mixer';
import { el, renderFader, renderKnob, renderToggleButton } from './widgets';

const BLUE = '#4a9be0';
const ORANGE = '#e8742c';
const GREEN = '#4fb286';
const YELLOW = '#dcb43c';
const PINK = '#d9628a';

const FADER = { height: 240, capHeight: 40, tick: 24, unity: 1 };
const METER_HEIGHT = 240;
const METER_FLOOR_DB = -60;
const METER_CEIL_DB = 6;

function number(m: Mixer, id: string): NumberControl {
  const c = m.control(id);
  if (c.kind !== 'number') throw new Error(`${id} is not a number control`);
  return c;
}

function toggle(m: Mixer, id: string): ToggleControl {
  const c = m.control(id);
  if (c.kind !== 'toggle') throw new Error(`${id} is not a toggle control`);
  return c;
}

function heading(text: string, color: string): HTMLElement {
  const h = el('div', 'mix-heading');
  const bar = el('span', 'mix-heading-bar');
  bar.style.background = color;
  h.append(bar, el('h3', undefined, text));
  return h;
}

/** Vertical level meter; `read` returns the current peak (linear). Returns the element and its updater. */
function meter(label: string, height = METER_HEIGHT): { element: HTMLElement; update: (peak: number) => void } {
  const element = el('div', 'meter');
  element.style.height = `${height}px`;
  element.setAttribute('role', 'img');
  element.setAttribute('aria-label', label);
  const mask = el('div', 'meter-mask');
  element.append(mask, el('div', 'meter-grid'));
  let shown = 0;
  const update = (peak: number) => {
    const db = peak > 0 ? 20 * Math.log10(peak) : METER_FLOOR_DB;
    const level = Math.min(1, Math.max(0, (db - METER_FLOOR_DB) / (METER_CEIL_DB - METER_FLOOR_DB)));
    shown = Math.max(level, shown - 0.03); // fast attack, slow fall
    mask.style.height = `${Math.round((1 - shown) * height)}px`;
  };
  return { element, update };
}

/** One strip: a mono channel (`ch1`...) or a stereo FX return (`ret1`...). */
function renderStrip(m: Mixer, prefix: string, i: number, isReturn: boolean, name: string, deviceId: string,
  engine: AudioEngine, tickers: (() => void)[]): HTMLElement {
  const id = (n: string) => `${prefix}.${n}`;
  const section = isReturn ? `FX return ${i}` : `Channel ${i}`;
  const strip = el('section', isReturn ? 'mix-strip mix-strip-return' : 'mix-strip');

  const header = el('header', 'mix-strip-head');
  header.append(el('h2', undefined, isReturn ? `FX${i}` : String(i)), el('div', 'mix-strip-name', name));
  strip.append(header);

  strip.append(renderToggleButton(toggle(m, id('lowcutOn')), `${section} low cut 75 Hz`, () => 'Low cut', BLUE, 'btn btn-wide'));

  const eq = el('div', 'mix-group');
  eq.append(heading('EQ', BLUE));
  const eqGrid = el('div', 'mix-grid-2');
  for (const [cid, label] of [['eqHigh', 'High'], ['eqMid', 'Mid'], ['eqLow', 'Low'], ['eqMidFreq', 'Freq']] as const) {
    eqGrid.append(renderKnob(number(m, id(cid)), section, label, 32));
  }
  eq.append(eqGrid);
  strip.append(eq);

  const aux = el('div', 'mix-group');
  aux.append(heading('Aux', ORANGE));
  for (const [a, b] of AUX_PAIRS) {
    const row = el('div', 'aux-row');
    row.append(
      renderKnob(number(m, id(`aux${a}`)), section, String(a), 26),
      renderKnob(number(m, id(`aux${b}`)), section, String(b), 26),
      renderToggleButton(toggle(m, id(`auxPre${a}${b}`)), `${section} aux ${a}-${b} pre-fader`, (pre) => (pre ? 'Pre' : 'Post'), ORANGE, 'btn btn-small'),
    );
    aux.append(row);
  }
  strip.append(aux);

  strip.append(renderKnob(number(m, id('pan')), section, isReturn ? 'Bal' : 'Pan', 32));

  const ms = el('div', 'mix-row');
  ms.append(renderToggleButton(toggle(m, id('mute')), `${section} mute`, () => 'Mute', '#e0524a', 'btn'));
  if (!isReturn) ms.append(renderToggleButton(toggle(m, id('solo')), `${section} solo`, () => 'Solo', YELLOW, 'btn'));
  strip.append(ms);

  const buses = el('div', 'mix-group');
  buses.append(heading('Bus', GREEN));
  const busRow = el('div', 'mix-row');
  for (const bus of BUSES) {
    // A return that is fed by a bus has no assign to that bus.
    if (!m.controls.some((c) => c.id === id(`bus${bus}`))) continue;
    busRow.append(renderToggleButton(toggle(m, id(`bus${bus}`)), `${section} assign to bus ${bus}`, () => bus, GREEN, 'btn'));
  }
  buses.append(busRow);
  strip.append(buses);

  const faderRow = el('div', 'mix-fader-row');
  const fader = renderFader(number(m, id('fader')), section, 'Level', FADER);
  faderRow.append(fader);
  if (isReturn) {
    const pair = el('div', 'meter-pair');
    for (const side of ['L', 'R'] as const) {
      const mt = meter(`${section} ${side} level`);
      const nodeId = m.meters.find((x) => x.name === `${prefix}.${side}`)!.nodeId;
      tickers.push(() => mt.update(engine.readLevel(deviceId, nodeId)));
      pair.append(mt.element);
    }
    faderRow.append(pair);
  } else {
    const mt = meter(`${section} level`);
    const nodeId = m.meters.find((x) => x.name === prefix)!.nodeId;
    tickers.push(() => mt.update(engine.readLevel(deviceId, nodeId)));
    faderRow.append(mt.element);
  }
  strip.append(faderRow);

  return strip;
}

/** The mixer console: channel strips on the left, master section on the right. */
export function renderMixerPanel(
  m: Mixer, deviceId: string, engine: AudioEngine, channelNames: string[] = [], returnNames: string[] = [],
  busTags: Partial<Record<(typeof BUSES)[number], string>> = {},
): HTMLElement {
  const panel = el('div', 'mix-panel');

  const header = el('div', 'mix-header');
  const brand = el('div', 'mix-brand');
  brand.append(
    el('div', 'mix-name', 'MOA-MIX'),
    el('div', 'mix-subtitle', `${m.channelCount} channel${m.channelCount === 1 ? '' : 's'} · ${m.returnCount} FX return${m.returnCount === 1 ? '' : 's'} · 3 stereo buses · 6 aux sends`),
  );
  header.append(brand);
  panel.append(header);

  const body = el('div', 'mix-body');
  const tickers: (() => void)[] = []; // run every animation frame: meters and the solo indicator

  const strips = el('div', 'mix-strips');
  for (let i = 1; i <= m.channelCount; i++) {
    strips.append(renderStrip(m, `ch${i}`, i, false, channelNames[i - 1] ?? '', deviceId, engine, tickers));
  }
  for (let r = 1; r <= m.returnCount; r++) {
    strips.append(renderStrip(m, `ret${r}`, r, true, returnNames[r - 1] ?? '', deviceId, engine, tickers));
  }
  body.append(strips);

  // Master section
  const master = el('section', 'mix-master');
  const head = el('div', 'synth-section-head');
  const bar = el('span', 'synth-section-bar');
  bar.style.background = PINK;
  head.append(bar, el('h2', undefined, 'Master'));
  master.append(head);

  const auxGroup = el('div', 'mix-group');
  auxGroup.append(heading('Aux masters', ORANGE));
  const auxGrid = el('div', 'mix-grid-3');
  for (let k = 1; k <= 6; k++) auxGrid.append(renderKnob(number(m, `aux${k}.master`), 'Master', `Aux ${k}`, 36));
  auxGroup.append(auxGrid);
  master.append(auxGroup);

  const solo = el('div', 'mix-group');
  solo.append(heading('Monitor', YELLOW));
  const led = el('div', 'solo-led');
  led.append(el('span', 'solo-led-dot'), el('span', undefined, 'Solo active'));
  solo.append(led);
  master.append(solo);
  tickers.push(() => led.classList.toggle('on', m.soloActive));

  const busGroup = el('div', 'mix-group mix-group-grow');
  busGroup.append(heading('Stereo buses', GREEN));
  const busRow = el('div', 'bus-row');
  for (const bus of BUSES) {
    const col = el('div', 'bus-col');
    const faderRow = el('div', 'mix-fader-row');
    faderRow.append(renderFader(number(m, `bus${bus}.fader`), 'Bus', `Bus ${bus}`, FADER));
    const meters = el('div', 'meter-pair');
    for (const side of ['L', 'R'] as const) {
      const mt = meter(`Bus ${bus} ${side} level`);
      const nodeId = m.meters.find((x) => x.name === `bus${bus}.${side}`)!.nodeId;
      tickers.push(() => mt.update(engine.readLevel(deviceId, nodeId)));
      meters.append(mt.element);
    }
    faderRow.append(meters);
    col.append(faderRow);
    // "To main": off takes the bus out of the main mix, so it only goes where it is patched (e.g. into an effect).
    const route = el('div', 'bus-route');
    route.append(renderToggleButton(toggle(m, `bus${bus}.main`), `Bus ${bus} to main`, () => 'To main', GREEN, 'btn'));
    const tag = el('div', 'bus-tag', busTags[bus] ? `→ ${busTags[bus]}` : '');
    route.append(tag);
    const mainSwitch = toggle(m, `bus${bus}.main`);
    const paintTag = () => tag.classList.toggle('on', !mainSwitch.value && !!busTags[bus]);
    mainSwitch.onChange(paintTag);
    paintTag();
    col.append(route);
    busRow.append(col);
  }
  busGroup.append(busRow);
  master.append(busGroup);
  body.append(master);
  panel.append(body);

  const tick = () => {
    for (const t of tickers) t();
    requestAnimationFrame(tick);
  };
  requestAnimationFrame(tick);

  return panel;
}

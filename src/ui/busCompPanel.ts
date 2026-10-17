import type { AudioEngine } from '../audio/engine';
import type { BusCompFx } from '../domain/devices/busComp';
import type { ChoiceControl, NumberControl, ToggleControl } from '../domain/devices/controls';
import type { Mixer } from '../domain/devices/mixer';
import { loadSavedPatches, persistPatch } from './patchStorage';
import { el, renderFader, renderToggleButton } from './widgets';

const STORAGE_KEY = 'moa-fx2.patches';
const TEAL = '#3fb6c9';
const ORANGE = '#e8742c';
const PINK = '#d9628a';
const GREEN = '#4fb286';
const YELLOW = '#dcb43c';

const number = (d: BusCompFx, id: string): NumberControl => {
  const c = d.control(id);
  if (c.kind !== 'number') throw new Error(`${id} is not a number control`);
  return c;
};
const toggle = (d: BusCompFx, id: string): ToggleControl => {
  const c = d.control(id);
  if (c.kind !== 'toggle') throw new Error(`${id} is not a toggle control`);
  return c;
};

interface SourceOption {
  value: string;
  label: string;
}

/** A titled section in the MOA-1 style: a coloured bar, a name, and a body. */
function section(title: string, color: string, grow: number, cls = ''): { root: HTMLElement; body: HTMLElement } {
  const root = el('section', `synth-section ${cls}`.trim());
  root.style.flex = `${grow} 1 0`;
  const head = el('div', 'synth-section-head');
  const bar = el('span', 'synth-section-bar');
  bar.style.background = color;
  head.append(bar, el('h2', undefined, title));
  const body = el('div', 'synth-section-body');
  root.append(head, body);
  return { root, body };
}

/**
 * A horizontal bar meter: a smooth fill, a peak-hold tick that falls back after a moment, and the value in figures.
 * `fromLeft` false fills from the right (gain reduction reads as the bar growing leftwards from 0 dB).
 */
function barMeter(label: string, min: number, max: number, unit: string, color: string, fromLeft = true, marks: number[] = []) {
  const row = el('div', 'bc-meter');
  row.append(el('div', 'bc-meter-label', label));
  const track = el('div', 'bc-meter-track');
  track.setAttribute('role', 'meter');
  track.setAttribute('aria-label', label);
  track.setAttribute('aria-valuemin', String(min));
  track.setAttribute('aria-valuemax', String(max));
  const fill = el('div', 'bc-meter-fill');
  fill.style.background = color;
  fill.style[fromLeft ? 'left' : 'right'] = '0';
  const peak = el('div', 'bc-meter-peak');
  for (const m of marks) {
    const tick = el('div', 'bc-meter-mark');
    const t = (m - min) / (max - min);
    tick.style.left = `${(fromLeft ? t : 1 - t) * 100}%`;
    tick.dataset.label = String(m);
    track.append(tick);
  }
  track.append(fill, peak);
  const value = el('div', 'bc-meter-value');
  row.append(track, value);
  let shown = min, held = min, heldAt = 0;
  const set = (v: number, now: number, dt: number) => {
    const target = Math.min(max, Math.max(min, v));
    shown += (target - shown) * Math.min(1, (target > shown ? 18 : 6) * dt); // quick up, slower down
    if (shown >= held || now - heldAt > 1200) {
      held = shown;
      heldAt = now;
    }
    const t = (shown - min) / (max - min);
    const p = (held - min) / (max - min);
    fill.style.width = `${(t * 100).toFixed(1)}%`;
    peak.style.left = `calc(${((fromLeft ? p : 1 - p) * 100).toFixed(1)}% - 1px)`;
    peak.style.opacity = held > min + (max - min) * 0.01 ? '1' : '0';
    // gain reduction reads as a cut (-3.2 dB); a level reads in dBFS, or -inf when silent
    value.textContent = fromLeft
      ? `${shown <= min + 0.05 ? '-inf' : shown.toFixed(1)} ${unit}`
      : `${shown < 0.05 ? '0.0' : `-${shown.toFixed(1)}`} ${unit}`;
    track.setAttribute('aria-valuenow', shown.toFixed(1));
  };
  return { row, set };
}

/**
 * The MOA-FX2 front panel in the MOA-1's modern style: sections for the compressor, its output, the sidechain ducker,
 * the meters (gain reduction, input, output L/R and the duck, all at once) and the patches.
 */
export function renderBusCompPanel(d: BusCompFx, mixer: Mixer | undefined, deviceId: string, engine: AudioEngine,
  sources: SourceOption[]): HTMLElement {
  loadSavedPatches(STORAGE_KEY, d);
  d.loadSlot(d.currentSlot);

  const panel = el('div', 'synth-panel bc-modern');
  const bypass = toggle(d, 'bc.bypass');
  const listen = toggle(d, 'bc.listen');

  // ---- header: name, the insert it sits on, bypass
  const header = el('div', 'synth-header');
  const brand = el('div', 'synth-brand');
  brand.append(el('div', 'synth-name', 'MOA-FX2'), el('div', 'synth-subtitle', 'Bus Compressor · Sidechain'));
  const headRight = el('div', 'bc-head-right');
  const insert = el('div', 'bc-insert', 'Bus B insert');
  const bypassButton = renderToggleButton(bypass, 'Bypass the compressor', (on) => (on ? 'Bypassed' : 'Bypass'), ORANGE, 'btn bc-bypass');
  headRight.append(insert, bypassButton);
  header.append(brand, headRight);
  panel.append(header);

  // ---- row 1: compressor, output, sidechain ducker
  const row1 = el('div', 'synth-row');
  const comp = section('Compressor', TEAL, 4);
  for (const [id, label] of [['bc.threshold', 'Thresh'], ['bc.ratio', 'Ratio'], ['bc.attack', 'Attack'], ['bc.release', 'Release'], ['bc.knee', 'Knee']] as const) {
    comp.body.append(renderFader(number(d, id), 'Compressor', label));
  }
  const out = section('Output', PINK, 2);
  out.body.append(
    renderFader(number(d, 'bc.makeup'), 'Output', 'Make-up'),
    renderFader(number(d, 'bc.mix'), 'Output', 'Mix'),
  );
  const duck = section('Sidechain ducker', YELLOW, 4, 'bc-duck');
  const duckFaders = el('div', 'bc-duck-faders');
  duckFaders.append(
    renderFader(number(d, 'bc.duck.depth'), 'Ducker', 'Depth'),
    renderFader(number(d, 'bc.duck.release'), 'Ducker', 'Release'),
    renderFader(number(d, 'bc.duck.keyHp'), 'Ducker', 'Key HP'),
  );
  const keyCol = el('div', 'bc-key');
  keyCol.append(el('div', 'fader-label', 'Key'));
  const source = mixer?.control('key.source') as ChoiceControl | undefined;
  if (source && sources.length) {
    const grid = el('div', 'bc-key-grid');
    grid.setAttribute('role', 'group');
    grid.setAttribute('aria-label', 'Key source');
    const buttons = sources.map((s) => {
      const b = el('button', 'btn bc-key-btn', s.label);
      b.type = 'button';
      b.addEventListener('click', () => source.set(s.value));
      grid.append(b);
      return { b, value: s.value };
    });
    const paint = () => buttons.forEach(({ b, value }) => {
      const on = source.value === value;
      b.setAttribute('aria-pressed', String(on));
      b.style.background = on ? YELLOW : '';
      b.style.borderColor = on ? YELLOW : '';
    });
    source.onChange(paint);
    paint();
    keyCol.append(grid);
  } else {
    keyCol.append(el('div', 'bc-key-note', 'Chosen on the mixer'));
  }
  keyCol.append(renderToggleButton(listen, 'Listen to the key signal', () => 'Listen', YELLOW, 'btn bc-listen'));
  const keyLamp = el('div', 'bc-key-lamp');
  keyLamp.setAttribute('role', 'img');
  const lampRow = el('div', 'bc-key-activity');
  lampRow.append(keyLamp, el('span', 'fader-label', 'Keyed'));
  keyCol.append(lampRow);
  duck.body.append(duckFaders, keyCol);
  row1.append(comp.root, out.root, duck.root);
  panel.append(row1);

  // ---- row 2: meters, patches
  const row2 = el('div', 'synth-row');
  const meters = section('Meters', GREEN, 6, 'bc-meters');
  const grMeter = barMeter('Gain red.', 0, 24, 'dB', ORANGE, false, [0, 3, 6, 12, 24]);
  const duckMeter = barMeter('Duck', 0, 24, 'dB', YELLOW, false);
  const inMeter = barMeter('Input', -60, 3, 'dBFS', TEAL, true, [-48, -24, -12, -6, 0]);
  const outL = barMeter('Out L', -60, 3, 'dBFS', GREEN, true, [-48, -24, -12, -6, 0]);
  const outR = barMeter('Out R', -60, 3, 'dBFS', GREEN, true);
  const meterStack = el('div', 'bc-meter-stack');
  meterStack.append(grMeter.row, duckMeter.row, inMeter.row, outL.row, outR.row);
  meters.body.append(meterStack);

  const patches = section('Patches', ORANGE, 4, 'bc-patches');
  const grid = el('div', 'bc-patch-grid');
  const presetButtons = d.slots.map((_, i) => {
    const b = el('button', 'btn bc-patch');
    b.type = 'button';
    b.addEventListener('click', () => d.loadSlot(i));
    grid.append(b);
    return b;
  });
  const save = el('button', 'btn bc-save', 'Save');
  save.type = 'button';
  save.setAttribute('aria-label', 'Save the panel into the selected patch');
  let savedFlash = false;
  const paintPresets = () => {
    presetButtons.forEach((b, i) => {
      const on = i === d.currentSlot;
      b.textContent = `${i + 1}  ${d.slots[i]!.name}`;
      b.setAttribute('aria-pressed', String(on));
      b.style.background = on ? ORANGE : '';
      b.style.borderColor = on ? ORANGE : '';
    });
    save.textContent = savedFlash ? 'Saved' : 'Save';
  };
  save.addEventListener('click', () => {
    persistPatch(STORAGE_KEY, d.currentSlot, d.saveSlot(d.currentSlot));
    savedFlash = true;
    paintPresets();
    window.setTimeout(() => {
      savedFlash = false;
      paintPresets();
    }, 1500);
  });
  d.onPresetChange(paintPresets);
  paintPresets();
  patches.body.append(grid, save);
  row2.append(meters.root, patches.root);
  panel.append(row2);

  // ---- live meters
  const nodeOf = (name: string) => d.meters.find((m) => m.name === name)!.nodeId;
  const inNode = nodeOf('in');
  const duckNode = nodeOf('duck');
  const outNodes = [nodeOf('out.L'), nodeOf('out.R')];
  const depth = number(d, 'bc.duck.depth');
  const dbOf = (v: number) => (v > 0 ? 20 * Math.log10(v) : -120);
  let last = performance.now();
  const tick = () => {
    const now = performance.now();
    const dt = Math.min(0.1, (now - last) / 1000);
    last = now;
    const duckLevel = engine.readLevel(deviceId, duckNode);
    const duckDb = -dbOf(Math.max(0.001, 1 - depth.value * duckLevel));
    const compDb = Math.max(0, -engine.readReduction(deviceId, 'comp'));
    grMeter.set(bypass.value ? 0 : compDb + duckDb, now, dt);
    duckMeter.set(bypass.value ? 0 : duckDb, now, dt);
    inMeter.set(dbOf(engine.readLevel(deviceId, inNode)), now, dt);
    outL.set(dbOf(engine.readLevel(deviceId, outNodes[0]!)), now, dt);
    outR.set(dbOf(engine.readLevel(deviceId, outNodes[1]!)), now, dt);
    const keyed = duckLevel > 0.02;
    keyLamp.classList.toggle('on', keyed);
    keyLamp.setAttribute('aria-label', `Key signal ${keyed ? 'active' : 'off'}`);
    requestAnimationFrame(tick);
  };
  requestAnimationFrame(tick);
  return panel;
}

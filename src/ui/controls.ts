import type { Control } from '../domain/devices/controls';
import type { Device } from '../domain/devices/device';

const STEPS = 1000;

function toSlider(c: Extract<Control, { kind: 'number' }>): number {
  const t = c.curve === 'log'
    ? Math.log(c.value / c.min) / Math.log(c.max / c.min)
    : (c.value - c.min) / (c.max - c.min);
  return Math.round(t * STEPS);
}

function fromSlider(c: Extract<Control, { kind: 'number' }>, s: number): number {
  const t = s / STEPS;
  return c.curve === 'log' ? c.min * Math.pow(c.max / c.min, t) : c.min + t * (c.max - c.min);
}

function format(c: Extract<Control, { kind: 'number' }>): string {
  const v = c.value;
  return `${v >= 100 ? v.toFixed(0) : v.toFixed(2)}${c.unit ? ' ' + c.unit : ''}`;
}

export function renderControl(c: Control): HTMLElement {
  const wrap = document.createElement('label');
  wrap.className = `control control-${c.kind}`;
  const name = document.createElement('span');
  name.textContent = c.label;
  wrap.append(name);

  if (c.kind === 'number') {
    const input = document.createElement('input');
    input.type = 'range';
    input.min = '0';
    input.max = String(STEPS);
    input.value = String(toSlider(c));
    const readout = document.createElement('output');
    readout.textContent = format(c);
    input.addEventListener('input', () => {
      c.set(fromSlider(c, Number(input.value)));
      readout.textContent = format(c);
    });
    wrap.append(input, readout);
  } else if (c.kind === 'choice') {
    const select = document.createElement('select');
    for (const o of c.options) select.add(new Option(o, o, false, o === c.value));
    select.addEventListener('change', () => c.set(select.value));
    wrap.append(select);
  } else {
    const box = document.createElement('input');
    box.type = 'checkbox';
    box.checked = c.value;
    box.addEventListener('change', () => c.set(box.checked));
    wrap.append(box);
  }
  return wrap;
}

export function renderDevice(device: Device): HTMLElement {
  const section = document.createElement('section');
  section.className = 'device';
  const h = document.createElement('h2');
  h.textContent = device.name;
  section.append(h);
  const row = document.createElement('div');
  row.className = 'controls';
  for (const c of device.controls) row.append(renderControl(c));
  section.append(row);
  return section;
}

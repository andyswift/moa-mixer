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
  const text = v >= 100 ? v.toFixed(0) : v >= 10 ? v.toFixed(1) : v >= 1 ? v.toFixed(2) : v.toFixed(3);
  return `${text}${c.unit ? ' ' + c.unit : ''}`;
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

function groupTitle(prefix: string): string {
  const m = /^ch(\d+)$/.exec(prefix);
  if (m) return `Ch ${m[1]}`;
  const words = prefix.replace(/([a-z])([A-Z])/g, '$1 $2').toLowerCase(); // ampEnv -> amp env
  return words.charAt(0).toUpperCase() + words.slice(1);
}

export function renderDevice(device: Device): HTMLElement {
  const section = document.createElement('section');
  section.className = 'device';
  const h = document.createElement('h2');
  h.textContent = device.name;
  section.append(h);

  // Controls with ids like "ch1.pan" are grouped under "Ch 1"; others sit in an untitled group.
  const groups = new Map<string, HTMLElement>();
  for (const c of device.controls) {
    const prefix = c.id.includes('.') ? c.id.split('.')[0]! : '';
    let row = groups.get(prefix);
    if (!row) {
      row = document.createElement('div');
      row.className = 'controls';
      if (prefix) {
        const title = document.createElement('h3');
        title.textContent = groupTitle(prefix);
        section.append(title);
      }
      section.append(row);
      groups.set(prefix, row);
    }
    row.append(renderControl(c));
  }
  return section;
}

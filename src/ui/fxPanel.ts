import type { NumberControl } from '../domain/devices/controls';
import type { DelayFx, ReverbFx } from '../domain/devices/sendFx';
import { controlDial, renderDial } from './dial';
import { type Option, renderSelector } from './polyPanel';
import { el } from './widgets';

const PURPLE = '#a98ae0';
const AMBER = '#dcb43c';

const SIZES: Option[] = [
  { value: 'small', text: 'Small', glyph: 'M1 2 L8 9 L19 9', aria: 'small room' },
  { value: 'medium', text: 'Medium', glyph: 'M1 2 L13 9 L19 9', aria: 'medium hall' },
  { value: 'large', text: 'Large', glyph: 'M1 2 L19 9', aria: 'large space' },
];

function number(d: ReverbFx | DelayFx, id: string): NumberControl {
  const c = d.control(id);
  if (c.kind !== 'number') throw new Error(`${id} is not a number control`);
  return c;
}

function card(title: string, subtitle: string, color: string, body: HTMLElement[]): HTMLElement {
  const section = el('section', 'poly-section fx-card');
  const head = el('div', 'poly-section-head');
  const bar = el('span', 'poly-bar');
  bar.style.background = color;
  head.append(bar, el('h2', undefined, title), el('span', 'fx-card-sub', subtitle));
  const content = el('div', 'poly-section-body');
  content.append(...body);
  section.append(head, content);
  return section;
}

/** The two send effects: FX 1 reverb (aux 1) and FX 2 delay (aux 2). Their returns are strips in the console below. */
export function renderFxPanel(reverb: ReverbFx, delay: DelayFx): HTMLElement {
  const panel = el('div', 'fx-panel');
  const header = el('div', 'fx-header');
  header.append(el('div', 'synth-name', 'SEND FX'), el('div', 'synth-subtitle', 'Aux 1 · Aux 2 · stereo returns'));
  panel.append(header);

  const row = el('div', 'poly-row');
  const reverbControl = reverb.control('reverb.size');
  if (reverbControl.kind !== 'choice') throw new Error('reverb.size is not a choice control');
  row.append(
    card('FX 1 · Reverb', 'aux 1', PURPLE, [
      renderSelector(reverbControl, 'Size', 'Step reverb size', SIZES),
      ...['reverb.predelay', 'reverb.lowcut', 'reverb.damp'].map((id) => renderDial(controlDial(number(reverb, id), PURPLE), 'Reverb')),
    ]),
    card('FX 2 · Delay', 'aux 2', AMBER, [
      ...['delay.time', 'delay.feedback', 'delay.tone', 'delay.spread', 'delay.wobble', 'delay.drive']
        .map((id) => renderDial(controlDial(number(delay, id), AMBER), 'Delay')),
    ]),
  );
  panel.append(row);
  return panel;
}

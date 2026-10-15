import { INTERNAL, type InputStatus, type MixerInputs, NONE } from '../audio/mixerInputs';
import { el } from './widgets';

const STATUS_TEXT: Record<InputStatus, string> = {
  idle: 'Start audio to connect',
  internal: 'Using the instrument on this page',
  none: 'No input',
  connecting: 'Connecting',
  live: 'Receiving audio from another tab',
  missing: 'That tab is not open',
};

/** A strip's input chooser: a status LED and a dropdown of this page's instrument, nothing, and every live port. */
export function renderAudioInputSelect(inputs: MixerInputs, jack: string, label: string, internalLabel: string): HTMLElement {
  const row = el('div', 'mix-input');
  const led = el('span', 'led');
  const select = el('select', 'patch-select mix-input-select');
  select.setAttribute('aria-label', `${label} input`);

  const paint = () => {
    const selected = inputs.selection(jack);
    const names = inputs.portNames();
    select.replaceChildren(new Option(internalLabel, INTERNAL), new Option('None', NONE));
    for (const name of names) select.add(new Option(name, name));
    // A remembered port whose tab is closed stays in the list so the choice is visible.
    if (selected !== INTERNAL && selected !== NONE && !names.includes(selected)) select.add(new Option(`${selected} (not open)`, selected));
    select.value = selected;
    const status = inputs.status(jack);
    led.className = `led input-led input-led-${status}`;
    row.title = STATUS_TEXT[status];
  };
  select.addEventListener('change', () => inputs.setSelection(jack, select.value));
  inputs.onChange(paint);
  paint();

  row.append(led, select);
  return row;
}

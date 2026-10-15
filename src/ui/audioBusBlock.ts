import type { MonitorControl, MonitorMode } from '../audio/monitorControl';
import type { PcmBus } from '../audio/pcmBus';
import { el } from './widgets';

const MODES: [MonitorMode, string][] = [['auto', 'Auto'], ['on', 'On'], ['off', 'Off']];

/**
 * The instrument page's audio-bus block for the top strip: how many mixer tabs are listening to this page's audio, and
 * whether this page plays its own audio to its own speakers (Auto: only while nothing is listening).
 */
export function renderAudioBusBlock(pcm: PcmBus, monitor: MonitorControl): HTMLElement {
  const block = el('div', 'midi-block');
  block.append(el('div', 'fader-label', 'Audio bus'));

  const status = el('div', 'midi-bus');
  const led = el('span', 'led input-led');
  const text = el('span', 'bus-listening');
  status.append(led, text);

  const monitorRow = el('div', 'bus-monitor');
  monitorRow.append(el('span', 'fader-label', 'Speakers'));
  const buttons = MODES.map(([mode, label]) => {
    const b = el('button', 'btn btn-small', label);
    b.type = 'button';
    b.setAttribute('aria-label', `Own speakers: ${label}`);
    b.addEventListener('click', () => monitor.setMode(mode));
    monitorRow.append(b);
    return [mode, b] as const;
  });

  const paint = () => {
    const n = pcm.audience;
    text.textContent = n === 0 ? 'Nothing listening' : n === 1 ? '1 listener' : `${n} listeners`;
    led.classList.toggle('input-led-live', n > 0);
    for (const [mode, b] of buttons) b.setAttribute('aria-pressed', String(monitor.mode === mode));
    monitorRow.title = monitor.on ? 'Playing on this page\'s speakers' : 'This page\'s speakers are muted';
  };
  pcm.onAudience(paint);
  monitor.onChange(paint);
  paint();

  block.append(status, monitorRow);
  return block;
}

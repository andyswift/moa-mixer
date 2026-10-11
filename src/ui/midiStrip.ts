import type { MidiClock } from '../domain/midi/clock';
import type { MidiMonitor } from '../domain/midi/monitor';
import type { WebMidi } from '../midi/webMidi';
import { el } from './widgets';

const MONITOR_ROWS = 5;
const LED_MS = 150;

/** Global MIDI strip: device, incoming clock status, activity LEDs and a monitor of recent messages. */
export function renderMidiStrip(midi: WebMidi, clock: MidiClock, monitor: MidiMonitor): HTMLElement {
  const strip = el('section', 'midi-strip');

  // --- Device ---
  const device = el('div', 'midi-block');
  device.append(el('div', 'fader-label', 'MIDI input'));
  const deviceBody = el('div', 'midi-device');
  device.append(deviceBody);

  const renderDevice = () => {
    deviceBody.replaceChildren();
    if (midi.status === 'unsupported') {
      deviceBody.append(el('div', 'midi-message', 'MIDI is not available in this browser. Try Chrome or Edge.'));
    } else if (midi.status === 'denied') {
      deviceBody.append(el('div', 'midi-message', 'MIDI access was blocked. Allow it in the site settings, then reload.'));
    } else if (midi.status === 'idle') {
      const b = el('button', 'btn midi-connect', 'Connect MIDI');
      b.type = 'button';
      b.addEventListener('click', () => void midi.connect());
      deviceBody.append(b);
    } else {
      const select = el('select', 'patch-select');
      select.setAttribute('aria-label', 'MIDI input device');
      select.add(new Option(midi.inputs.length ? 'No device selected' : 'No MIDI devices found', ''));
      for (const input of midi.inputs) select.add(new Option(input.name, input.id));
      select.value = midi.selectedId ?? '';
      select.addEventListener('change', () => midi.select(select.value || undefined));
      deviceBody.append(select);
    }
  };
  midi.onChange(renderDevice);
  renderDevice();

  // --- Clock status ---
  const clockBlock = el('div', 'midi-block');
  clockBlock.append(el('div', 'fader-label', 'Incoming clock'));
  const bpm = el('div', 'midi-bpm', '--.-');
  const badges = el('div', 'midi-badges');
  const locked = el('span', 'badge', 'No clock');
  const running = el('span', 'badge', 'Stopped');
  badges.append(locked, running);
  clockBlock.append(bpm, badges);

  // --- Activity LEDs ---
  const leds = el('div', 'midi-block');
  leds.append(el('div', 'fader-label', 'Activity'));
  const ledRow = el('div', 'midi-leds');
  const ledEls = {
    note: el('span', 'led'),
    cc: el('span', 'led'),
    clock: el('span', 'led'),
  };
  for (const [kind, label] of [['note', 'Notes'], ['cc', 'CC'], ['clock', 'Clock']] as const) {
    const item = el('div', 'led-item');
    item.append(ledEls[kind], el('span', undefined, label));
    ledRow.append(item);
  }
  leds.append(ledRow);

  // --- Monitor ---
  const mon = el('div', 'midi-block midi-monitor-block');
  const head = el('div', 'midi-monitor-head');
  head.append(el('div', 'fader-label', 'Monitor'));
  const clear = el('button', 'btn btn-small midi-clear', 'Clear');
  clear.type = 'button';
  clear.addEventListener('click', () => monitor.clear());
  head.append(clear);
  const log = el('div', 'midi-log');
  log.setAttribute('role', 'log');
  log.setAttribute('aria-label', 'Recent MIDI messages');
  mon.append(head, log);
  const renderLog = () => {
    log.replaceChildren(
      ...monitor.lines.slice(-MONITOR_ROWS).map((line) => el('div', `midi-line midi-line-${line.kind}`, line.text)),
    );
  };
  monitor.onChange(renderLog);
  renderLog();

  strip.append(device, clockBlock, leds, mon);

  const tick = () => {
    const now = performance.now();
    const value = clock.bpm;
    const isLocked = clock.isLocked(now);
    bpm.textContent = value !== undefined && isLocked ? value.toFixed(1) : '--.-';
    locked.textContent = isLocked ? 'Clock locked' : 'No clock';
    locked.classList.toggle('on', isLocked);
    running.textContent = clock.running ? 'Running' : 'Stopped';
    running.classList.toggle('on', clock.running);
    for (const kind of ['note', 'cc', 'clock'] as const) {
      ledEls[kind].classList.toggle('on', now - monitor.lastSeen[kind] < LED_MS);
    }
    requestAnimationFrame(tick);
  };
  requestAnimationFrame(tick);

  return strip;
}

import type { ChoiceControl } from '../domain/devices/controls';
import type { Transport } from '../domain/devices/transport';
import type { Position } from '../domain/midi/clock';
import { el, renderToggleButton } from './widgets';

const PINK = '#d9628a';

/** What the block shows as running and as the position; defaults to the transport's own (the MIDI clock's). */
export interface TransportSource {
  running: () => boolean;
  position: () => Position;
}

/** Per-device transport: tempo, sync source, start/stop following, MIDI channel and position. */
export function renderTransportBlock(
  transport: Transport,
  source: TransportSource = { running: () => transport.running, position: () => transport.position },
): HTMLElement {
  const block = el('div', 'transport');

  // --- Tempo ---
  const tempo = el('div', 'transport-tempo');
  tempo.append(el('div', 'fader-label', 'Tempo'));
  const bpm = el('div', 'transport-bpm', '120.0');
  const tempoButtons = el('div', 'transport-tempo-buttons');
  const tap = el('button', 'btn btn-small transport-tap', 'Tap');
  tap.type = 'button';
  tap.addEventListener('click', () => transport.tap());
  const minus = el('button', 'btn btn-small', '−');
  minus.type = 'button';
  minus.setAttribute('aria-label', 'Tempo down');
  minus.addEventListener('click', () => transport.nudge(-1));
  const plus = el('button', 'btn btn-small', '+');
  plus.type = 'button';
  plus.setAttribute('aria-label', 'Tempo up');
  plus.addEventListener('click', () => transport.nudge(1));
  tempoButtons.append(tap, minus, plus);
  tempo.append(bpm, tempoButtons);

  // --- Sync and channel ---
  const sync = el('div', 'transport-sync');
  sync.append(el('div', 'fader-label', 'Sync'));
  const syncGroup = el('div', 'transport-seg');
  const labels: Record<string, string> = { internal: 'Internal', midi: 'MIDI clock' };
  const syncButtons = transport.sync.options.map((option) => {
    const b = el('button', 'btn btn-small', labels[option] ?? option);
    b.type = 'button';
    b.addEventListener('click', () => transport.sync.set(option));
    syncGroup.append(b);
    return b;
  });
  const follow = renderToggleButton(
    transport.followStartStop, 'Follow MIDI start and stop', (on) => `Start/stop: ${on ? 'On' : 'Off'}`, PINK, 'btn btn-small',
  );
  sync.append(syncGroup, follow);

  const channel = el('div', 'transport-channel');
  channel.append(el('div', 'fader-label', 'MIDI ch'));
  const channelSelect = el('select', 'patch-select transport-channel-select');
  channelSelect.setAttribute('aria-label', 'MIDI channel');
  for (const c of transport.channel.options) channelSelect.add(new Option(c === 'omni' ? 'Omni' : `Ch ${c}`, c));
  channelSelect.value = transport.channel.value;
  channelSelect.addEventListener('change', () => (transport.channel as ChoiceControl).set(channelSelect.value));
  channel.append(channelSelect);

  // --- Position ---
  const pos = el('div', 'transport-pos');
  pos.append(el('div', 'fader-label', 'Position'));
  const posRow = el('div', 'transport-pos-row');
  const led = el('span', 'led');
  const position = el('div', 'transport-position', '1 : 1 : 1');
  const dots = [0, 1, 2, 3].map(() => el('span', 'beat-dot'));
  const dotRow = el('div', 'beat-dots');
  dotRow.append(...dots);
  posRow.append(led, position);
  pos.append(posRow, dotRow);

  block.append(tempo, sync, channel, pos);

  const paint = () => {
    const synced = transport.synced;
    syncButtons.forEach((b, i) => {
      const on = transport.sync.options[i] === transport.sync.value;
      b.setAttribute('aria-pressed', String(on));
      b.style.background = on ? PINK : '';
      b.style.borderColor = on ? PINK : '';
    });
    for (const b of [tap, minus, plus]) b.disabled = synced;
    follow.disabled = !synced;
    tempoButtons.title = synced ? 'Tempo follows MIDI clock' : '';
    block.classList.toggle('is-synced', synced);
  };
  transport.sync.onChange(paint);
  paint();

  const tick = () => {
    const running = source.running();
    bpm.textContent = transport.bpm.toFixed(1);
    bpm.classList.toggle('locked', transport.locked);
    const p = source.position();
    position.textContent = `${p.bar} : ${p.beat} : ${p.sixteenth}`;
    led.classList.toggle('on', running);
    dots.forEach((d, i) => d.classList.toggle('on', running && p.beat === i + 1));
    requestAnimationFrame(tick);
  };
  requestAnimationFrame(tick);

  return block;
}

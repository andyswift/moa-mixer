import type { AudioEngine } from '../audio/engine';
import type { NumberControl, ToggleControl } from '../domain/devices/controls';
import { DRUM_NAMES, DRUM_VOICES, type DrumMachine, type DrumVoice } from '../domain/devices/drumMachine';
import { el, renderFader, renderToggleButton } from './widgets';

const COLORS: Record<DrumVoice, string> = {
  kick: '#e8742c',
  snare: '#4a9be0',
  clap: '#a98be0',
  closedHat: '#4fb286',
  openHat: '#dcb43c',
  ride: '#d9628a',
};

const FADER = { height: 120, capHeight: 32, tick: 12 };
const FADER_IDS = ['tune', 'decay', 'third', 'level'] as const;
const THIRD: Record<DrumVoice, string> = {
  kick: 'click', snare: 'snap', clap: 'spread', closedHat: 'tone', openHat: 'tone', ride: 'bell',
};
const CLAP_TONE_VOICE: DrumVoice = 'clap'; // the clap's first fader is Tone, not Tune
const SEGMENTS = 8;
const METER_FLOOR_DB = -48;

const VELOCITY = { soft: 0.4, normal: 0.8, hard: 1 };
const PAD_KEYS = ['1', '2', '3', '4', '5', '6'];

function num(d: DrumMachine, id: string): NumberControl {
  const c = d.control(id);
  if (c.kind !== 'number') throw new Error(`${id} is not a number control`);
  return c;
}

function toggle(d: DrumMachine, id: string): ToggleControl {
  const c = d.control(id);
  if (c.kind !== 'toggle') throw new Error(`${id} is not a toggle control`);
  return c;
}

function renderVoice(d: DrumMachine, voice: DrumVoice, index: number, engine: AudioEngine, deviceId: string,
  tickers: (() => void)[]): HTMLElement {
  const color = COLORS[voice];
  const name = DRUM_NAMES[voice];
  const section = el('section', 'synth-section drum-voice');
  const head = el('div', 'synth-section-head');
  const bar = el('span', 'synth-section-bar');
  bar.style.background = color;
  head.append(bar, el('h2', undefined, name));
  if (voice === 'closedHat' || voice === 'openHat') {
    const chip = renderToggleButton(d.choke, 'Closed hat chokes open hat', () => 'Choke', color, 'btn drum-choke');
    chip.style.marginLeft = 'auto';
    head.append(chip);
  }

  const pad = el('button', 'drum-pad');
  pad.type = 'button';
  pad.style.setProperty('--voice', color);
  pad.setAttribute('aria-label', `Play ${name}`);
  pad.append(el('span', 'drum-pad-key', PAD_KEYS[index]!));
  pad.addEventListener('pointerdown', (e) => {
    e.preventDefault();
    d.trigger(voice, e.shiftKey ? VELOCITY.soft : e.altKey ? VELOCITY.hard : VELOCITY.normal);
  });
  pad.addEventListener('keydown', (e) => {
    if (e.key === ' ' || e.key === 'Enter') {
      e.preventDefault();
      if (!e.repeat) d.trigger(voice, VELOCITY.normal);
    }
  });
  let flash: number | undefined;
  d.onHit((v, velocity) => {
    if (v !== voice) return;
    pad.style.setProperty('--hit', String(0.35 + 0.65 * velocity));
    pad.classList.add('hit');
    window.clearTimeout(flash);
    flash = window.setTimeout(() => pad.classList.remove('hit'), 110);
  });

  const faders = el('div', 'drum-faders');
  for (const f of FADER_IDS) {
    const id = f === 'third' ? THIRD[voice] : f === 'tune' && voice === CLAP_TONE_VOICE ? 'tone' : f;
    faders.append(renderFader(num(d, `${voice}.${id}`), name, num(d, `${voice}.${id}`).label, FADER));
  }

  const ms = el('div', 'drum-ms');
  ms.append(
    renderToggleButton(toggle(d, `${voice}.mute`), `${name} mute`, () => 'Mute', '#e8b43c', 'btn'),
    renderToggleButton(toggle(d, `${voice}.solo`), `${name} solo`, () => 'Solo', '#4fb286', 'btn'),
  );

  const out = el('div', 'drum-out');
  out.append(el('span', 'drum-jack'), el('span', 'drum-out-label', `Out ${index + 1}`));
  const segs = el('div', 'drum-meter');
  segs.setAttribute('role', 'img');
  segs.setAttribute('aria-label', `${name} output level`);
  const lights = Array.from({ length: SEGMENTS }, () => {
    const s = el('span', 'drum-seg');
    segs.append(s);
    return s;
  });
  out.append(segs);
  const nodeId = d.meters.find((m) => m.name === voice)!.nodeId;
  tickers.push(() => {
    const peak = engine.readLevel(deviceId, nodeId);
    const db = peak > 0 ? 20 * Math.log10(peak) : METER_FLOOR_DB;
    const lit = Math.round(Math.min(1, Math.max(0, (db - METER_FLOOR_DB) / -METER_FLOOR_DB)) * SEGMENTS);
    lights.forEach((s, i) => {
      s.style.background = i < lit ? color : '';
    });
  });

  section.append(head, pad, faders, ms, out);
  return section;
}

/** The drum machine's front panel: six voices, each with a pad, faders, mute/solo and its own output meter. */
export function renderDrumPanel(d: DrumMachine, deviceId: string, engine: AudioEngine): HTMLElement {
  const panel = el('div', 'synth-panel drum-panel');
  const header = el('div', 'synth-header');
  const brand = el('div', 'synth-brand');
  brand.append(el('div', 'synth-name', 'MOA-DR'), el('div', 'synth-subtitle', 'Drum Machine'));
  header.append(brand, el('div', 'drum-outputs-note', '6 individual outputs'));
  panel.append(header);

  const tickers: (() => void)[] = [];
  const row = el('div', 'drum-voices');
  DRUM_VOICES.forEach((voice, i) => row.append(renderVoice(d, voice, i, engine, deviceId, tickers)));
  panel.append(row);

  window.addEventListener('keydown', (e) => {
    if (e.repeat || e.metaKey || e.ctrlKey || e.altKey) return;
    const target = e.target;
    if (target instanceof HTMLSelectElement || target instanceof HTMLInputElement) return;
    const i = PAD_KEYS.indexOf(e.key);
    if (i >= 0) d.trigger(DRUM_VOICES[i]!, e.shiftKey ? VELOCITY.soft : VELOCITY.normal);
  });

  const tick = () => {
    for (const t of tickers) t();
    requestAnimationFrame(tick);
  };
  requestAnimationFrame(tick);
  return panel;
}

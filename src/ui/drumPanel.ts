import type { AudioEngine } from '../audio/engine';
import type { NumberControl, ToggleControl } from '../domain/devices/controls';
import { DRUM_NAMES, DRUM_VOICES, type DrumMachine, type DrumVoice } from '../domain/devices/drumMachine';
import { type DrumSequencer, PATTERNS, STEPS } from '../domain/devices/drumSequencer';
import { renderTransportBlock } from './transportBlock';
import { el, renderFader, renderKnob, renderToggleButton } from './widgets';

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

const ACCENT = '#4a9be0';
const VELOCITY_WORDS = ['off', 'soft', 'medium', 'hard'];
const FILL = ['0%', '34%', '67%', '100%'];

/** Transport strip: Play/Stop, the shared transport block (tempo, sync, channel, position), swing and pattern. */
function renderTransportStrip(seq: DrumSequencer, d: DrumMachine, tickers: (() => void)[]): HTMLElement {
  const strip = el('section', 'drum-transport');

  const run = el('div', 'drum-run');
  const play = el('button', 'btn drum-play', 'Play');
  play.type = 'button';
  play.addEventListener('click', () => seq.play());
  const stop = el('button', 'btn drum-stop', 'Stop');
  stop.type = 'button';
  stop.addEventListener('click', () => seq.stop());
  run.append(play, stop);
  tickers.push(() => {
    const following = seq.externallyDriven;
    play.setAttribute('aria-pressed', String(seq.running));
    play.style.background = seq.running ? ACCENT : '';
    play.style.borderColor = seq.running ? ACCENT : '';
    play.disabled = following;
    stop.disabled = following;
    run.title = following ? 'Following MIDI start/stop' : '';
  });

  const swing = el('div', 'drum-swing');
  swing.append(renderKnob(seq.swing, 'Sequencer', 'Swing', 34));

  const patterns = el('div', 'drum-patterns');
  patterns.append(el('div', 'fader-label', 'Pattern'));
  const group = el('div', 'transport-seg');
  group.setAttribute('role', 'group');
  group.setAttribute('aria-label', 'Pattern');
  const buttons = PATTERNS.map((name) => {
    const b = el('button', 'btn btn-small drum-pattern', name);
    b.type = 'button';
    b.addEventListener('click', () => seq.pattern.set(name));
    group.append(b);
    return b;
  });
  const paintPatterns = () => {
    buttons.forEach((b, i) => {
      const on = PATTERNS[i] === seq.pattern.value;
      b.setAttribute('aria-pressed', String(on));
      b.style.background = on ? ACCENT : '';
      b.style.borderColor = on ? ACCENT : '';
    });
  };
  seq.pattern.onChange(paintPatterns);
  paintPatterns();
  patterns.append(group);

  strip.append(
    run,
    renderTransportBlock(d.transport, { running: () => seq.running, position: () => seq.position }),
    swing,
    patterns,
  );
  return strip;
}

/** The step grid: one row per voice, 16 steps, click to cycle velocity; the playhead column is outlined. */
function renderStepGrid(seq: DrumSequencer, tickers: (() => void)[]): HTMLElement {
  const section = el('section', 'synth-section drum-seq');
  const head = el('div', 'synth-section-head');
  const bar = el('span', 'synth-section-bar');
  bar.style.background = ACCENT;
  head.append(bar, el('h2', undefined, 'Sequencer'), el('span', 'drum-seq-sub'),
    el('span', 'drum-seq-hint', 'Click a step to cycle velocity: soft · medium · hard · off'));
  const sub = head.querySelector('.drum-seq-sub') as HTMLElement;
  const paintSub = () => {
    sub.textContent = `${STEPS} steps · pattern ${seq.pattern.value}`;
  };
  seq.pattern.onChange(paintSub);
  paintSub();
  section.append(head);

  const numbers = el('div', 'drum-seq-row');
  numbers.append(el('div', 'drum-seq-label'));
  const numberGrid = el('div', 'drum-seq-grid');
  const heads = Array.from({ length: STEPS }, (_, i) => {
    const h = el('div', 'drum-seq-num', String(i + 1));
    numberGrid.append(h);
    return h;
  });
  numbers.append(numberGrid);
  section.append(numbers);

  const columns: HTMLElement[][] = Array.from({ length: STEPS }, () => []);
  const repaints: (() => void)[] = [];
  for (const voice of DRUM_VOICES) {
    const color = COLORS[voice];
    const name = DRUM_NAMES[voice];
    const row = el('div', 'drum-seq-row');
    const label = el('div', 'drum-seq-label');
    const dot = el('span', 'drum-seq-dot');
    dot.style.background = color;
    label.append(dot, el('span', undefined, name));
    const grid = el('div', 'drum-seq-grid');
    for (let step = 0; step < STEPS; step++) {
      const b = el('button', 'drum-step');
      b.type = 'button';
      b.dataset.group = String(Math.floor(step / 4) % 2);
      b.style.setProperty('--voice', color);
      const fill = el('span', 'drum-step-fill');
      b.append(fill);
      b.addEventListener('click', () => seq.cycle(voice, step));
      const paint = () => {
        const level = seq.level(voice, step);
        fill.style.height = FILL[level]!;
        b.setAttribute('aria-pressed', String(level > 0));
        b.setAttribute('aria-label', `${name} step ${step + 1}, velocity ${VELOCITY_WORDS[level]}`);
        b.classList.toggle('on', level > 0);
      };
      repaints.push(paint);
      paint();
      columns[step]!.push(b);
      grid.append(b);
    }
    row.append(label, grid);
    section.append(row);
  }
  seq.onChange(() => repaints.forEach((p) => p()));

  let shown: number | undefined;
  tickers.push(() => {
    const step = seq.currentStep();
    if (step === shown) return;
    if (shown !== undefined) {
      heads[shown]!.classList.remove('playhead');
      for (const b of columns[shown]!) b.classList.remove('playhead');
    }
    if (step !== undefined) {
      heads[step]!.classList.add('playhead');
      for (const b of columns[step]!) b.classList.add('playhead');
    }
    shown = step;
  });
  return section;
}

/** The drum machine's front panel: transport, six voices (pad, faders, mute/solo, own output meter) and the step grid. */
export function renderDrumPanel(d: DrumMachine, seq: DrumSequencer, deviceId: string, engine: AudioEngine): HTMLElement {
  const panel = el('div', 'synth-panel drum-panel');
  const header = el('div', 'synth-header');
  const brand = el('div', 'synth-brand');
  brand.append(el('div', 'synth-name', 'MOA-DR'), el('div', 'synth-subtitle', 'Drum Machine'));
  header.append(brand, el('div', 'drum-outputs-note', '6 individual outputs'));
  panel.append(header);

  const tickers: (() => void)[] = [];
  panel.append(renderTransportStrip(seq, d, tickers));
  const row = el('div', 'drum-voices');
  DRUM_VOICES.forEach((voice, i) => row.append(renderVoice(d, voice, i, engine, deviceId, tickers)));
  panel.append(row, renderStepGrid(seq, tickers));

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

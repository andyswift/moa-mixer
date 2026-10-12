import type { AudioEngine } from '../audio/engine';
import type { ChoiceControl, NumberControl, ToggleControl } from '../domain/devices/controls';
import { GRANULAR_BUFFER_SECONDS, type GranularFx } from '../domain/devices/granular';
import { type DialFace, controlDial, renderDial } from './dial';
import { mountKeyboardBed } from './keyboard';
import { loadSavedPatches, persistPatch } from './patchStorage';
import { el } from './widgets';

const STORAGE_KEY = 'moa-granular-patches';
const SWEEP = 270;
const INK = '#2b130e';
const BLUE = '#5b8cff';
const MAGENTA = '#e04fd0';
const ARC = 207.35; // length of the r=44 value arc, 270 degrees

/** A cream knob with a value arc around it, drawn at `size` px. */
const creamKnob = (size: number): DialFace => (t) => {
  const deg = Math.round((-SWEEP / 2 + t * SWEEP) * 10) / 10;
  return `<svg aria-hidden="true" width="${size}" height="${size}" viewBox="0 0 100 100">
    <path d="M18.89 81.11 A44 44 0 1 1 81.11 81.11" fill="none" stroke="${INK}" stroke-opacity="0.28" stroke-width="3"></path>
    <path d="M18.89 81.11 A44 44 0 1 1 81.11 81.11" fill="none" stroke="${INK}" stroke-width="3.5" stroke-linecap="round" stroke-dasharray="${(t * ARC).toFixed(1)} 300"></path>
    <circle cx="50" cy="52" r="31" fill="rgba(60,20,10,0.35)"></circle>
    <circle cx="50" cy="50" r="31" fill="${INK}"></circle>
    <circle cx="50" cy="50" r="28" fill="url(#grKnob)"></circle>
    <defs><radialGradient id="grKnob" cx="35%" cy="28%" r="80%"><stop offset="0" stop-color="#ffffff"></stop><stop offset="0.45" stop-color="#f2ece4"></stop><stop offset="1" stop-color="#cfc6bb"></stop></radialGradient></defs>
    <rect x="47.5" y="26" width="5" height="17" rx="2.5" fill="${INK}" transform="rotate(${deg} 50 50)"></rect>
  </svg>`;
};

function number(d: GranularFx, id: string): NumberControl {
  const c = d.control(id);
  if (c.kind !== 'number') throw new Error(`${id} is not a number control`);
  return c;
}

function knob(d: GranularFx, id: string, led: string, size: number): HTMLElement {
  const dial = renderDial(controlDial(number(d, id), led), 'Granular', creamKnob(size));
  const dot = el('i', 'gr-led');
  dot.style.background = led;
  dot.style.boxShadow = `0 0 8px ${led}`;
  dial.append(dot);
  return dial;
}

/** The Keys button (cloud plays only while notes are held) and the MIDI channel those notes come from. */
function playBlock(keys: ToggleControl, channel: ChoiceControl): HTMLElement {
  const wrap = el('div', 'gr-keys');
  const button = el('button', 'gr-tail-btn gr-keys-btn', 'Keys');
  button.type = 'button';
  button.title = 'Off: the cloud runs all the time. On: it plays only while notes are held (playing a key turns it on).';
  button.addEventListener('click', () => keys.set(!keys.value));
  const paint = () => button.setAttribute('aria-pressed', String(keys.value));
  keys.onChange(paint);
  paint();

  const select = el('select', 'gr-channel');
  select.setAttribute('aria-label', 'MIDI channel');
  for (const c of channel.options) select.add(new Option(c === 'omni' ? 'Omni' : `Ch ${c}`, c));
  select.value = channel.value;
  select.addEventListener('change', () => channel.set(select.value));
  channel.onChange(() => {
    select.value = channel.value;
  });
  wrap.append(button, select, el('div', 'dial-label', 'Play'));
  return wrap;
}

/** Three buttons for the reverb tail: small, medium, large. */
function tailSelector(c: ChoiceControl): HTMLElement {
  const wrap = el('div', 'gr-tail');
  const row = el('div', 'gr-tail-row');
  const buttons = c.options.map((value) => {
    const b = el('button', 'gr-tail-btn', value[0]!.toUpperCase());
    b.type = 'button';
    b.setAttribute('aria-label', `Reverb tail ${value}`);
    b.addEventListener('click', () => c.set(value));
    row.append(b);
    return b;
  });
  const paint = () => buttons.forEach((b, i) => b.setAttribute('aria-pressed', String(c.options[i] === c.value)));
  c.onChange(paint);
  paint();
  wrap.append(row, el('div', 'dial-label', 'Tail'));
  return wrap;
}

function rule(text?: string): HTMLElement {
  const row = el('div', 'gr-rule');
  if (text) row.append(el('span', undefined, text));
  return row;
}

/**
 * The MOA-GR front panel: the grain controls as knobs, a freeze button, a screen that draws the capture buffer with
 * the grains that are playing, eight patch buttons, a patch encoder and Save. The screen is fed by the grain engine
 * (`engine.readGranular`), so it moves with the sound.
 */
export function renderGranularPanel(d: GranularFx, deviceId: string, engine: AudioEngine): HTMLElement {
  loadSavedPatches(STORAGE_KEY, d);
  d.loadSlot(d.currentSlot);

  const panel = el('section', 'gr-panel');
  panel.setAttribute('aria-label', 'MOA-GR granular processor');

  const header = el('div', 'gr-header');
  const title = el('div', 'gr-title-row');
  title.append(el('div', 'gr-title', 'MOA-GR'), el('div', 'gr-sub', 'Granular processor'));
  header.append(title, el('div', 'gr-route', 'Aux 3 in · Return 5 out'));

  const main = el('div', 'gr-main');
  main.append(
    knob(d, 'gr.position', BLUE, 88), knob(d, 'gr.size', MAGENTA, 88), knob(d, 'gr.pitch', MAGENTA, 88),
    knob(d, 'gr.rate', BLUE, 88), knob(d, 'gr.feedback', MAGENTA, 88), knob(d, 'gr.mix', BLUE, 88),
  );
  const texture = el('div', 'gr-texture');
  texture.append(
    knob(d, 'gr.spread', BLUE, 64), knob(d, 'gr.cloud', MAGENTA, 64), knob(d, 'gr.detune', MAGENTA, 64),
    knob(d, 'gr.shape', BLUE, 64), knob(d, 'gr.reverse', MAGENTA, 64),
  );

  // Tone and space: the filter, the saturator and the reverb, after the grains.
  const space = el('div', 'gr-space');
  space.append(
    knob(d, 'gr.filter', BLUE, 64), knob(d, 'gr.reso', MAGENTA, 64), knob(d, 'gr.drive', MAGENTA, 64),
    knob(d, 'gr.reverb', BLUE, 64), knob(d, 'gr.tone', MAGENTA, 64), tailSelector(d.control('gr.tail') as ChoiceControl),
  );

  // Play: the envelope each note gets, Keys, and the MIDI channel.
  const play = el('div', 'gr-play');
  play.append(
    knob(d, 'gr.attack', BLUE, 64), knob(d, 'gr.decay', MAGENTA, 64), knob(d, 'gr.sustain', BLUE, 64),
    knob(d, 'gr.release', MAGENTA, 64), playBlock(d.control('gr.play') as ToggleControl, d.control('gr.channel') as ChoiceControl),
  );

  // Bottom: freeze | screen + patches | encoder + save.
  const bottom = el('div', 'gr-bottom');

  const freezeControl = d.control('gr.freeze') as ToggleControl;
  const freezeWrap = el('div', 'gr-freeze-wrap');
  const freeze = el('button', 'gr-freeze');
  freeze.type = 'button';
  freeze.setAttribute('aria-label', 'Freeze buffer');
  freeze.append(el('span', 'gr-freeze-lamp'));
  freeze.addEventListener('click', () => freezeControl.set(!freezeControl.value));
  freezeWrap.append(freeze, el('div', 'gr-freeze-label', 'Freeze'));

  const middle = el('div', 'gr-middle');
  const screen = el('div', 'gr-screen');
  const screenHead = el('div', 'gr-screen-head');
  const patchName = el('div', 'gr-screen-name');
  const bufferLabel = el('div', 'gr-screen-meta');
  screenHead.append(patchName, bufferLabel);
  const canvas = el('canvas', 'gr-canvas');
  canvas.setAttribute('role', 'img');
  canvas.setAttribute('aria-label', 'Capture buffer with the grains that are playing');
  const axis = el('div', 'gr-axis');
  axis.append(el('span', undefined, 'oldest'), el('span', undefined, 'position'), el('span', undefined, 'now'));
  screen.append(screenHead, canvas, axis);

  const patchRow = el('div', 'gr-patches');
  const patchButtons = d.slots.map((_, i) => {
    const b = el('button', 'gr-patch');
    b.type = 'button';
    b.append(el('span', 'gr-patch-n', String(i + 1)), el('span', 'gr-patch-name'));
    b.addEventListener('click', () => d.loadSlot(i));
    patchRow.append(b);
    return b;
  });
  middle.append(screen, patchRow);

  const side = el('div', 'gr-side');
  const encoder = el('div', 'gr-encoder');
  encoder.tabIndex = 0;
  encoder.setAttribute('role', 'slider');
  encoder.setAttribute('aria-label', 'Patch');
  encoder.setAttribute('aria-valuemin', '1');
  encoder.setAttribute('aria-valuemax', String(d.slots.length));
  encoder.append(el('i', 'gr-encoder-mark'));
  const stepPatch = (delta: number) => {
    const next = Math.min(d.slots.length - 1, Math.max(0, d.currentSlot + delta));
    if (next !== d.currentSlot) d.loadSlot(next);
  };
  let dragY: number | undefined;
  encoder.addEventListener('pointerdown', (e) => {
    encoder.setPointerCapture(e.pointerId);
    dragY = e.clientY;
  });
  encoder.addEventListener('pointermove', (e) => {
    if (dragY === undefined) return;
    const steps = Math.trunc((dragY - e.clientY) / 22);
    if (steps !== 0) {
      stepPatch(steps);
      dragY = e.clientY;
    }
  });
  const endDrag = () => {
    dragY = undefined;
  };
  encoder.addEventListener('pointerup', endDrag);
  encoder.addEventListener('pointercancel', endDrag);
  encoder.addEventListener('wheel', (e) => {
    e.preventDefault();
    stepPatch(e.deltaY < 0 ? 1 : -1);
  }, { passive: false });
  encoder.addEventListener('keydown', (e) => {
    const delta: Record<string, number> = { ArrowUp: 1, ArrowRight: 1, ArrowDown: -1, ArrowLeft: -1 };
    if (e.key in delta) {
      e.preventDefault();
      stepPatch(delta[e.key]!);
    }
  });
  const save = el('button', 'gr-save', 'Save');
  save.type = 'button';
  save.setAttribute('aria-label', 'Save patch');
  let savedFlash = false;
  save.addEventListener('click', () => {
    persistPatch(STORAGE_KEY, d.currentSlot, d.saveSlot(d.currentSlot));
    savedFlash = true;
    paintPatches();
    window.setTimeout(() => {
      savedFlash = false;
      paintPatches();
    }, 1500);
  });
  side.append(encoder, el('div', 'gr-side-label', 'Patch'), save);

  bottom.append(freezeWrap, middle, side);
  panel.append(header, rule(), main, rule('Texture'), texture, rule('Tone & space'), space, rule('Play · 8 voices'), play, rule(), bottom, mountKeyboardBed(d));

  const paintPatches = () => {
    patchButtons.forEach((b, i) => {
      const on = i === d.currentSlot;
      b.setAttribute('aria-pressed', String(on));
      b.querySelector('.gr-patch-name')!.textContent = d.slots[i]!.name;
    });
    patchName.textContent = d.currentPreset.name;
    const t = d.slots.length > 1 ? d.currentSlot / (d.slots.length - 1) : 0;
    encoder.style.transform = `rotate(${-SWEEP / 2 + t * SWEEP}deg)`;
    encoder.setAttribute('aria-valuenow', String(d.currentSlot + 1));
    encoder.setAttribute('aria-valuetext', d.currentPreset.name);
    save.textContent = savedFlash ? 'Saved' : 'Save';
  };
  d.onPresetChange(paintPatches);
  paintPatches();

  const paintFreeze = () => {
    freeze.setAttribute('aria-pressed', String(freezeControl.value));
    freeze.classList.toggle('gr-lit', freezeControl.value);
  };
  freezeControl.onChange(paintFreeze);
  paintFreeze();

  // The screen: buffer peaks, grain windows and where Position points, redrawn every frame.
  const position = number(d, 'gr.position');
  const draw = () => {
    const w = canvas.clientWidth;
    const h = canvas.clientHeight;
    if (!w || !h) return; // not attached yet
    const dpr = window.devicePixelRatio || 1;
    if (canvas.width !== Math.round(w * dpr) || canvas.height !== Math.round(h * dpr)) {
      canvas.width = Math.round(w * dpr);
      canvas.height = Math.round(h * dpr);
    }
    const g = canvas.getContext('2d');
    if (!g) return;
    g.setTransform(dpr, 0, 0, dpr, 0, 0);
    g.clearRect(0, 0, w, h);
    const view = engine.readGranular(deviceId, 'grains');
    const peaks = view?.peaks;
    const bins = peaks?.length ?? 96;
    const slot = w / bins;
    g.fillStyle = '#cdbfae';
    for (let i = 0; i < bins; i++) {
      const level = Math.min(1, Math.sqrt(peaks?.[i] ?? 0)); // a sqrt curve keeps quiet audio visible
      const bar = Math.max(2, level * h * 0.92);
      g.fillRect(i * slot + 0.5, (h - bar) / 2, Math.max(1, slot - 1.5), bar);
    }
    if (view) {
      g.fillStyle = 'rgba(255,126,104,0.38)';
      g.strokeStyle = '#ff9a86';
      for (let i = 0; i < view.grains.length; i += 2) {
        const x = view.grains[i]! * w;
        const width = Math.max(2, view.grains[i + 1]! * w);
        g.fillRect(x, 0, width, h);
        g.strokeRect(x + 0.5, 0.5, width, h - 1);
      }
    }
    g.fillStyle = '#ffe27a';
    g.fillRect((1 - position.value) * w - 1, 0, 2, h);
    bufferLabel.textContent = `${GRANULAR_BUFFER_SECONDS} s buffer · ${freezeControl.value ? 'frozen' : view ? 'live' : 'start audio'}`;
  };
  const tick = () => {
    draw();
    requestAnimationFrame(tick);
  };
  requestAnimationFrame(tick);

  return panel;
}

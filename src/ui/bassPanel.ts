import type { AudioEngine } from '../audio/engine';
import { fretLength } from '../domain/devices/bassPhysics';
import { BASS_FRETS, type BassGuitar } from '../domain/devices/bassGuitar';
import { BLUE, GREEN, ORANGE, PINK, renderSection, YELLOW } from './synthPanel';
import { el } from './widgets';

const FRET_DOTS = [3, 5, 7, 9, 15, 17, 19, 21];
const DOUBLE_DOTS = [12, 24];
/** How much slower than life the strings move on screen (each string's fundamental is shown at about this many Hz). */
const SHOWN_HZ = 1.4;
const TOUCH_PX = 9; // within this of a string, the pointer plucks it; further away it frets the nearest one

/**
 * The MOA-BASS panel: each string's live physics, a fretboard drawn to scale with the four strings vibrating in slow
 * motion (from the engine's mode amplitudes), and the controls, the amp and the cabinet. On the fretboard: click a
 * string to pluck it there, or grab it, pull it sideways and let go (the pull is the strength); click the neck between
 * strings to fret the nearest one.
 */
export function renderBassPanel(b: BassGuitar, engine: AudioEngine): HTMLElement {
  const panel = el('div', 'synth-panel bass-panel');
  const header = el('div', 'synth-header');
  const brand = el('div', 'synth-brand');
  brand.append(el('div', 'synth-name', 'MOA-BASS'), el('div', 'synth-subtitle', 'Four physically modelled strings'));
  header.append(brand);
  panel.append(header);

  // ---- each string's physics, live (G at the top, as in tab)
  const order = [3, 2, 1, 0];
  const table = el('table', 'bass-table');
  table.innerHTML = '<thead><tr><th>String</th><th>Note now</th><th>Frequency</th><th>Tension</th><th>Mass μ</th><th>Wave speed</th><th>Stiffness B</th><th>Fret · length</th></tr></thead>';
  const body = el('tbody');
  const cells = order.map((i) => {
    const tr = el('tr');
    const td = () => { const c = el('td'); tr.append(c); return c; };
    const name = td(); name.textContent = b.voices[i]!.name;
    const row = { note: td(), hz: td(), tension: td(), mu: td(), speed: td(), B: td(), fret: td() };
    body.append(tr);
    return { i, row };
  });
  table.append(body);
  const paintFacts = () => {
    for (const { i, row } of cells) {
      const r = b.readout(i);
      const c = r.now.cents;
      row.note.textContent = `${r.now.name} ${c >= 0 ? '+' : ''}${c.toFixed(1)}¢`;
      row.note.classList.toggle('bass-off', Math.abs(c) > 10);
      row.hz.textContent = `${r.now.hz.toFixed(2)} Hz`;
      row.tension.textContent = `${r.tension.toFixed(0)} N · ${(r.tension / 4.448222).toFixed(1)} lb`;
      row.mu.textContent = `${(r.mu * 1000).toFixed(1)} g/m`;
      row.speed.textContent = `${r.speed.toFixed(0)} m/s`;
      row.B.textContent = `${(r.B * 1e4).toFixed(1)}×10⁻⁴`;
      row.fret.textContent = `${r.fret} · ${(r.length * 100).toFixed(1)} cm`;
    }
  };
  b.onPhysicsChange(paintFacts);
  paintFacts();
  const tableWrap = el('div', 'bass-table-wrap');
  tableWrap.append(table);
  panel.append(tableWrap);

  // ---- the fretboard
  const board = el('div', 'bass-board');
  const canvas = el('canvas', 'bass-canvas');
  canvas.setAttribute('role', 'img');
  canvas.setAttribute('aria-label', 'The fretboard and the four strings. Click a string to pluck it, drag it to pull it, click the neck to fret the nearest string.');
  board.append(canvas, el('div', 'bass-hint', 'Click a string to pluck · drag it sideways and let go · click between strings to fret the nearest one'));
  panel.append(board);

  const ctx = canvas.getContext('2d')!;
  const geometry = () => {
    const w = canvas.clientWidth, h = canvas.clientHeight;
    const left = 46, right = w - 54;
    const scale = b.scale;
    const x = (fromBridge: number) => right - (fromBridge / scale) * (right - left);
    const fromBridge = (px: number) => ((right - px) / (right - left)) * scale;
    const spacing = (h - 56) / 4;
    /** The resting height of string i (E at the bottom). */
    const y = (i: number) => 28 + spacing * (3 - i + 0.5);
    return { w, h, left, right, scale, x, fromBridge, y, spacing };
  };

  let pull: { string: number; at: number; dy: number } | undefined;
  const phase0 = [0, 0, 0, 0].map(() => performance.now());
  b.onPluck((i) => { phase0[i] = performance.now(); });

  const draw = () => {
    const dpr = window.devicePixelRatio || 1;
    if (canvas.width !== Math.round(canvas.clientWidth * dpr)) {
      canvas.width = Math.round(canvas.clientWidth * dpr);
      canvas.height = Math.round(canvas.clientHeight * dpr);
    }
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    const g = geometry();
    ctx.clearRect(0, 0, g.w, g.h);
    const neck = ctx.createLinearGradient(0, 0, 0, g.h);
    neck.addColorStop(0, '#3a2516'); neck.addColorStop(0.5, '#4a3020'); neck.addColorStop(1, '#3a2516');
    ctx.fillStyle = neck;
    ctx.fillRect(g.left, 14, g.right - g.left, g.h - 28);
    ctx.fillStyle = '#2a2d31';
    ctx.fillRect(g.right, 6, g.w - g.right, g.h - 12);
    ctx.fillStyle = '#c9ccd1';
    ctx.fillRect(g.right + 6, 24, 10, g.h - 48);
    ctx.fillStyle = '#e8e4da';
    ctx.fillRect(g.left - 6, 14, 6, g.h - 28);
    const midY = g.h / 2;
    ctx.font = '10px "IBM Plex Mono", monospace';
    ctx.textAlign = 'center';
    for (let k = 1; k <= BASS_FRETS; k++) {
      const fx = g.x(fretLength(g.scale, k));
      ctx.fillStyle = '#b9b3a8';
      ctx.fillRect(fx - 1, 14, 2, g.h - 28);
      const between = (g.x(fretLength(g.scale, k - 1)) + fx) / 2;
      ctx.fillStyle = '#d8d2c4';
      if (FRET_DOTS.includes(k)) { ctx.beginPath(); ctx.arc(between, midY, 4, 0, Math.PI * 2); ctx.fill(); }
      if (DOUBLE_DOTS.includes(k)) for (const dy of [-g.spacing, g.spacing]) { ctx.beginPath(); ctx.arc(between, midY + dy, 4, 0, Math.PI * 2); ctx.fill(); }
      if (k % 2 === 1 || k === 12 || k === 24) { ctx.fillStyle = '#7f7a70'; ctx.fillText(String(k), between, g.h - 2); }
    }
    // the pickup across all four strings, the palm if muting, the pluck line
    const px = g.x(b.control('pickup.position').value as number);
    ctx.fillStyle = '#16171a';
    ctx.fillRect(px - 9, 20, 18, g.h - 40);
    ctx.fillStyle = '#5b5f66';
    for (let i = 0; i < 4; i++) { ctx.beginPath(); ctx.arc(px, g.y(i), 3, 0, Math.PI * 2); ctx.fill(); }
    const palm = b.control('palm').value as number;
    if (palm > 0) {
      ctx.fillStyle = `rgba(232, 116, 44, ${0.15 + palm * 0.35})`;
      ctx.fillRect(g.x(0.055), 18, g.x(0.005) - g.x(0.055), g.h - 36);
    }
    const pluckX = g.x(b.control('pluck.position').value as number);
    ctx.strokeStyle = 'rgba(79, 178, 134, 0.7)';
    ctx.setLineDash([3, 4]);
    ctx.beginPath(); ctx.moveTo(pluckX, 18); ctx.lineTo(pluckX, g.h - 18); ctx.stroke();
    ctx.setLineDash([]);

    const now = performance.now();
    const pxPerM = Math.min(9000, (g.spacing * 0.42) / 0.004); // 4 mm fills most of the gap to the next string
    b.voices.forEach((v, i) => {
      const y0 = g.y(i);
      const fretX = g.x(v.length);
      // the fretting finger, just behind its fret
      if (v.fret > 0) {
        const behind = (g.x(fretLength(g.scale, v.fret - 1)) + fretX) / 2;
        ctx.fillStyle = 'rgba(233, 196, 166, 0.85)';
        ctx.beginPath(); ctx.ellipse(behind + (fretX - behind) * 0.4, y0, 8, 11, 0, 0, Math.PI * 2); ctx.fill();
      }
      ctx.strokeStyle = i === 0 ? '#c9c2b4' : '#d7d9dc';
      ctx.lineWidth = 1.2 + (b.spec(i).outer / 0.00267) * 2.4; // drawn as thick as its gauge
      ctx.beginPath();
      ctx.moveTo(g.left, y0);
      ctx.lineTo(fretX, y0);
      const L = v.length;
      const amps = engine.readString('bass', v.node)?.amps;
      const hz = b.modeHz(i);
      const t = (now - phase0[i]!) / 1000;
      const slow = hz[0] ? hz[0] / SHOWN_HZ : 1;
      const limit = g.spacing * 0.48;
      for (let s = 1; s <= 120; s++) {
        const d = L * (1 - s / 120);
        let yy = 0;
        if (pull && pull.string === i) yy = d >= pull.at ? (pull.dy * (L - d)) / (L - pull.at) : (pull.dy * d) / pull.at;
        else if (amps) {
          for (let n = 0; n < amps.length && n < hz.length; n++) yy += amps[n]! * Math.cos((2 * Math.PI * hz[n]! * t) / slow) * Math.sin(((n + 1) * Math.PI * d) / L);
          yy *= pxPerM;
        }
        ctx.lineTo(g.x(d), y0 + Math.max(-limit, Math.min(limit, yy)));
      }
      ctx.stroke();
    });
    ctx.lineWidth = 1;
    requestAnimationFrame(draw);
  };
  requestAnimationFrame(draw);

  // ---- touching it
  const at = (e: PointerEvent) => {
    const r = canvas.getBoundingClientRect();
    return { px: e.clientX - r.left, py: e.clientY - r.top };
  };
  let down: { string: number; at: number; py: number } | undefined;
  canvas.addEventListener('pointerdown', (e) => {
    const g = geometry();
    const { px, py } = at(e);
    const d = g.fromBridge(px);
    let nearest = 0;
    for (let i = 1; i < 4; i++) if (Math.abs(py - g.y(i)) < Math.abs(py - g.y(nearest))) nearest = i;
    const v = b.voices[nearest]!;
    if (Math.abs(py - g.y(nearest)) < TOUCH_PX && d > 0.01 && d < v.length - 0.01) {
      canvas.setPointerCapture(e.pointerId);
      down = { string: nearest, at: d, py };
      b.control('pluck.position').set(Math.max(0.02, Math.min(0.4, d)) as never);
      return;
    }
    // the neck: the fret space clicked frets the nearest string (left of fret 1 opens it)
    if (d > b.scale || d < fretLength(b.scale, BASS_FRETS)) return;
    let fret = 0;
    for (let k = 1; k <= BASS_FRETS; k++) if (d < fretLength(b.scale, k - 1) && d >= fretLength(b.scale, k)) fret = k;
    b.setFret(nearest, fret);
  });
  canvas.addEventListener('pointermove', (e) => {
    if (!down || !canvas.hasPointerCapture(e.pointerId)) return;
    const g = geometry();
    const dy = at(e).py - g.y(down.string);
    if (Math.abs(at(e).py - down.py) > 4) pull = { string: down.string, at: down.at, dy };
  });
  canvas.addEventListener('pointerup', () => {
    if (!down) return;
    const g = geometry();
    const strength = pull ? Math.min(1, Math.abs(pull.dy) / (g.spacing * 0.9)) : undefined;
    b.pluck(down.string, down.at, strength);
    down = undefined;
    pull = undefined;
  });

  // ---- the controls: strings, hands, pickup; then the amp and the cabinet
  const button = (text: string, title: string, click: () => void) => {
    const btn = el('button', 'btn bass-action', text);
    btn.type = 'button';
    btn.title = title;
    btn.addEventListener('click', click);
    return btn;
  };
  const strings = renderSection(b, {
    title: 'Strings', color: BLUE, grow: 6, switches: ['string.wrap', 'string.winding', 'string.scale'],
    faders: b.voices.map((v) => ({ id: `${v.name}.tension`, label: v.name })),
  });
  strings.querySelector('.synth-section-body')!.append(button('Tune', 'Tune every string to its standard note (E1 A1 D2 G2)', () => b.tuneToStandard()));
  const pluck = renderSection(b, {
    title: 'Pluck', color: GREEN, grow: 3, switches: ['pluck.style'],
    faders: [{ id: 'pluck.position', label: 'At (m)' }, { id: 'pluck.strength', label: 'Strength' }],
  });
  const hands = renderSection(b, { title: 'Hands', color: ORANGE, grow: 2, faders: [{ id: 'palm', label: 'Palm' }] });
  hands.querySelector('.synth-section-body')!.append(button('Mute', 'Rest a hand on all the strings', () => b.voices.forEach((_, i) => b.release(i))));
  const pickup = renderSection(b, { title: 'Pickup', color: YELLOW, grow: 2, faders: [{ id: 'pickup.position', label: 'At (m)' }, 'tone'] });
  const amp = renderSection(b, {
    title: 'Amp', color: PINK, grow: 4,
    faders: [{ id: 'amp.gain', label: 'Gain' }, { id: 'amp.bass', label: 'Bass' }, { id: 'amp.mid', label: 'Mid' }, { id: 'amp.treble', label: 'Treble' }],
  });
  const cab = renderSection(b, {
    title: 'Cabinet & DI', color: PINK, grow: 4, switches: ['cab.type', 'cab.mic'],
    faders: [{ id: 'cab.blend', label: 'DI / Cab' }, 'level'],
  });
  const row1 = el('div', 'synth-row');
  row1.append(strings, pluck, hands, pickup);
  const row2 = el('div', 'synth-row');
  row2.append(amp, cab);
  panel.append(row1, row2);
  return panel;
}

import type { AudioEngine } from '../audio/engine';
import { fretLength } from '../domain/devices/bassPhysics';
import type { StringedInstrument } from '../domain/devices/stringedInstrument';
import { el } from './widgets';

const FRET_DOTS = [3, 5, 7, 9, 15, 17, 19, 21];
const DOUBLE_DOTS = [12, 24];
/** How much slower than life the strings move on screen (each string's fundamental is shown at about this many Hz). */
const SHOWN_HZ = 1.4;
const TOUCH_PX = 9; // within this of a string, the pointer plucks it; further away it frets the nearest one

/** The wood and its markings. */
export interface NeckLook {
  /** The fretboard's colour at its edges and down its middle. */
  wood: readonly [string, string];
  dots: string;
  numbers: string;
}

export const ROSEWOOD: NeckLook = { wood: ['#3a2516', '#4a3020'], dots: '#d8d2c4', numbers: '#7f7a70' };

/** Each string's physics, live, highest string at the top (as in tab). */
export function renderStringTable(b: StringedInstrument): HTMLElement {
  const order = b.voices.map((_, i) => i).reverse();
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
      row.mu.textContent = `${(r.mu * 1000).toFixed(r.mu < 0.001 ? 2 : 1)} g/m`;
      row.speed.textContent = `${r.speed.toFixed(0)} m/s`;
      row.B.textContent = `${(r.B * 1e4).toFixed(1)}×10⁻⁴`;
      row.fret.textContent = `${r.fret} · ${(r.length * 100).toFixed(1)} cm`;
    }
  };
  b.onPhysicsChange(paintFacts);
  paintFacts();
  const tableWrap = el('div', 'bass-table-wrap');
  tableWrap.append(table);
  return tableWrap;
}

/**
 * A fretboard drawn to scale with the strings vibrating in slow motion (from the engine's mode amplitudes). Click a
 * string to pluck it there, or grab it, pull it sideways and let go (the pull is the strength); click the neck between
 * strings to fret the nearest one.
 */
export function renderFretboard(b: StringedInstrument, engine: AudioEngine, deviceId: string, look: NeckLook): HTMLElement {
  const count = b.voices.length;
  const board = el('div', 'bass-board');
  const canvas = el('canvas', 'bass-canvas');
  canvas.setAttribute('role', 'img');
  canvas.setAttribute('aria-label', `The fretboard and the ${count} strings. Click a string to pluck it, drag it to pull it, click the neck to fret the nearest string.`);
  board.append(canvas, el('div', 'bass-hint', 'Click a string to pluck · drag it sideways and let go · click between strings to fret the nearest one'));

  const ctx = canvas.getContext('2d')!;
  const geometry = () => {
    const w = canvas.clientWidth, h = canvas.clientHeight;
    const left = 46, right = w - 54;
    const scale = b.scale;
    const x = (fromBridge: number) => right - (fromBridge / scale) * (right - left);
    const fromBridge = (px: number) => ((right - px) / (right - left)) * scale;
    const spacing = (h - 56) / count;
    /** The resting height of string i (the lowest at the bottom). */
    const y = (i: number) => 28 + spacing * (count - 1 - i + 0.5);
    return { w, h, left, right, scale, x, fromBridge, y, spacing };
  };

  let pull: { string: number; at: number; dy: number } | undefined;
  const phase0 = b.voices.map(() => performance.now());
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
    neck.addColorStop(0, look.wood[0]); neck.addColorStop(0.5, look.wood[1]); neck.addColorStop(1, look.wood[0]);
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
    for (let k = 1; k <= b.frets; k++) {
      const fx = g.x(fretLength(g.scale, k));
      ctx.fillStyle = '#b9b3a8';
      ctx.fillRect(fx - 1, 14, 2, g.h - 28);
      const between = (g.x(fretLength(g.scale, k - 1)) + fx) / 2;
      ctx.fillStyle = look.dots;
      if (FRET_DOTS.includes(k)) { ctx.beginPath(); ctx.arc(between, midY, 4, 0, Math.PI * 2); ctx.fill(); }
      if (DOUBLE_DOTS.includes(k)) for (const dy of [-g.spacing, g.spacing]) { ctx.beginPath(); ctx.arc(between, midY + dy, 4, 0, Math.PI * 2); ctx.fill(); }
      if (k % 2 === 1 || k === 12 || k === 24) { ctx.fillStyle = look.numbers; ctx.fillText(String(k), between, g.h - 2); }
    }
    // the pickups across all the strings (a humbucker's two coils side by side; the ones switched off dimmed), the
    // palm if muting, the pluck line
    for (const p of b.pickups()) {
      const px = g.x(p.position);
      const half = p.coils === 2 ? 15 : 9;
      ctx.fillStyle = p.on ? '#16171a' : 'rgba(22, 23, 26, 0.45)';
      ctx.fillRect(px - half, 20, half * 2, g.h - 40);
      ctx.fillStyle = p.on ? '#5b5f66' : '#3b3e43';
      const poles = p.coils === 2 ? [px - 7, px + 7] : [px];
      for (const pole of poles) for (let i = 0; i < count; i++) { ctx.beginPath(); ctx.arc(pole, g.y(i), 3, 0, Math.PI * 2); ctx.fill(); }
    }
    const palm = b.control('palm').value as number;
    if (palm > 0) {
      ctx.fillStyle = `rgba(232, 116, 44, ${0.15 + palm * 0.35})`;
      ctx.fillRect(g.x(b.palmAt + 0.025), 18, g.x(Math.max(0.005, b.palmAt - 0.025)) - g.x(b.palmAt + 0.025), g.h - 36);
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
        ctx.beginPath(); ctx.ellipse(behind + (fretX - behind) * 0.4, y0, 8, Math.min(11, g.spacing * 0.45), 0, 0, Math.PI * 2); ctx.fill();
      }
      ctx.strokeStyle = i === 0 ? '#c9c2b4' : '#d7d9dc';
      ctx.lineWidth = 1.2 + (b.spec(i).outer / 0.00267) * 2.4; // drawn as thick as its gauge (a .105 bass string at 3.6 px)
      ctx.beginPath();
      ctx.moveTo(g.left, y0);
      ctx.lineTo(fretX, y0);
      const L = v.length;
      const amps = engine.readString(deviceId, v.node)?.amps;
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
    for (let i = 1; i < count; i++) if (Math.abs(py - g.y(i)) < Math.abs(py - g.y(nearest))) nearest = i;
    const v = b.voices[nearest]!;
    if (Math.abs(py - g.y(nearest)) < Math.min(TOUCH_PX, g.spacing * 0.4) && d > 0.01 && d < v.length - 0.01) {
      canvas.setPointerCapture(e.pointerId);
      down = { string: nearest, at: d, py };
      b.control('pluck.position').set(Math.max(0.02, Math.min(0.4, d)) as never);
      return;
    }
    // the neck: the fret space clicked frets the nearest string (left of fret 1 opens it)
    if (d > b.scale || d < fretLength(b.scale, b.frets)) return;
    let fret = 0;
    for (let k = 1; k <= b.frets; k++) if (d < fretLength(b.scale, k - 1) && d >= fretLength(b.scale, k)) fret = k;
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
  return board;
}

/** A button in a panel section (Tune, Mute). */
export function actionButton(text: string, title: string, click: () => void): HTMLButtonElement {
  const btn = el('button', 'btn bass-action', text);
  btn.type = 'button';
  btn.title = title;
  btn.addEventListener('click', click);
  return btn;
}

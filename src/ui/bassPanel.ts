import type { AudioEngine } from '../audio/engine';
import { fretLength } from '../domain/devices/bassPhysics';
import { BASS_FRETS, type BassString } from '../domain/devices/bassString';
import { BLUE, GREEN, ORANGE, PINK, renderSection, YELLOW } from './synthPanel';
import { el } from './widgets';

const FRET_DOTS = [3, 5, 7, 9, 15, 17, 19, 21];
const DOUBLE_DOTS = [12, 24];
/** How much slower than life the string moves on screen (its fundamental is shown at about this many Hz). */
const SHOWN_HZ = 1.4;

/**
 * The MOA-BASS panel: the live physics as readouts, a fretboard drawn to scale with the string vibrating in slow motion
 * (from the engine's mode amplitudes), and the controls. On the fretboard: click the string to pluck it there, or grab
 * it, pull it sideways and let go (the pull is the strength); click the neck away from the string to choose a fret.
 */
export function renderBassPanel(b: BassString, engine: AudioEngine): HTMLElement {
  const panel = el('div', 'synth-panel bass-panel');
  const header = el('div', 'synth-header');
  const brand = el('div', 'synth-brand');
  brand.append(el('div', 'synth-name', 'MOA-BASS'), el('div', 'synth-subtitle', 'One physically modelled string'));
  header.append(brand);
  panel.append(header);

  // ---- the physics, live
  const facts = el('div', 'bass-facts');
  const fact = (label: string) => {
    const f = el('div', 'bass-fact');
    const v = el('div', 'bass-fact-value');
    f.append(el('div', 'bass-fact-label', label), v);
    facts.append(f);
    return v;
  };
  const note = fact('Note now');
  const tension = fact('Tension');
  const speed = fact('Wave speed √(T/μ)');
  const mass = fact('Mass μ');
  const stiff = fact('Stiffness B');
  const length = fact('Vibrating length');
  const paintFacts = () => {
    const r = b.readout;
    const cents = r.now.cents;
    note.textContent = `${r.now.name} ${cents >= 0 ? '+' : ''}${cents.toFixed(1)}¢ · ${r.now.hz.toFixed(2)} Hz`;
    note.classList.toggle('bass-off', Math.abs(cents) > 10);
    tension.textContent = `${r.tension.toFixed(1)} N · ${(r.tension / 4.448222).toFixed(1)} lb`;
    speed.textContent = `${r.speed.toFixed(1)} m/s`;
    mass.textContent = `${(r.mu * 1000).toFixed(1)} g/m`;
    mass.title = `${r.winding}, ${r.wrap.toLowerCase()} wrap`;
    stiff.textContent = `${(r.B * 1e4).toFixed(2)} × 10⁻⁴`;
    length.textContent = `${(r.length * 100).toFixed(1)} cm · fret ${b.fret}`;
  };
  b.onPhysicsChange(paintFacts);
  paintFacts();
  panel.append(facts);

  // ---- the fretboard
  const board = el('div', 'bass-board');
  const canvas = el('canvas', 'bass-canvas');
  canvas.setAttribute('role', 'img');
  canvas.setAttribute('aria-label', 'The fretboard and the string. Click the string to pluck it, drag it to pull it, click the neck to choose a fret.');
  board.append(canvas, el('div', 'bass-hint', 'Click the string to pluck · drag it sideways and let go · click the neck to choose a fret'));
  panel.append(board);

  const ctx = canvas.getContext('2d')!;
  const geometry = () => {
    const w = canvas.clientWidth, h = canvas.clientHeight;
    const left = 46, right = w - 54; // the nut and the bridge
    const scale = b.scale;
    /** x on screen for a distance from the bridge (m). */
    const x = (fromBridge: number) => right - (fromBridge / scale) * (right - left);
    const fromBridge = (px: number) => ((right - px) / (right - left)) * scale;
    return { w, h, left, right, scale, x, fromBridge, mid: h / 2 };
  };

  let pull: { at: number; dy: number } | undefined;
  let phase0 = performance.now();

  const draw = () => {
    const dpr = window.devicePixelRatio || 1;
    if (canvas.width !== Math.round(canvas.clientWidth * dpr)) {
      canvas.width = Math.round(canvas.clientWidth * dpr);
      canvas.height = Math.round(canvas.clientHeight * dpr);
    }
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    const g = geometry();
    ctx.clearRect(0, 0, g.w, g.h);
    // the neck
    const neckGrad = ctx.createLinearGradient(0, 0, 0, g.h);
    neckGrad.addColorStop(0, '#3a2516'); neckGrad.addColorStop(0.5, '#4a3020'); neckGrad.addColorStop(1, '#3a2516');
    ctx.fillStyle = neckGrad;
    ctx.fillRect(g.left, 14, g.right - g.left, g.h - 28);
    // the body past the end of the neck, the bridge and the nut
    ctx.fillStyle = '#2a2d31';
    ctx.fillRect(g.right, 6, g.w - g.right, g.h - 12);
    ctx.fillStyle = '#c9ccd1';
    ctx.fillRect(g.right + 6, g.mid - 18, 10, 36);
    ctx.fillStyle = '#e8e4da';
    ctx.fillRect(g.left - 6, 14, 6, g.h - 28);
    // frets and their numbers and dots
    ctx.font = '10px "IBM Plex Mono", monospace';
    ctx.textAlign = 'center';
    for (let k = 1; k <= BASS_FRETS; k++) {
      const fx = g.x(fretLength(g.scale, k));
      ctx.fillStyle = k === b.fret ? '#ffd25e' : '#b9b3a8';
      ctx.fillRect(fx - 1, 14, 2, g.h - 28);
      const between = (g.x(fretLength(g.scale, k - 1)) + fx) / 2;
      ctx.fillStyle = '#d8d2c4';
      if (FRET_DOTS.includes(k)) { ctx.beginPath(); ctx.arc(between, g.mid + 34, 4, 0, Math.PI * 2); ctx.fill(); }
      if (DOUBLE_DOTS.includes(k)) for (const dy of [-34, 34]) { ctx.beginPath(); ctx.arc(between, g.mid + dy, 4, 0, Math.PI * 2); ctx.fill(); }
      if (k % 2 === 1 || k === 12 || k === 24) { ctx.fillStyle = '#7f7a70'; ctx.fillText(String(k), between, g.h - 2); }
    }
    // the pickup (a bar under the string) and the palm, if muting
    const px = g.x(b.control('pickup.position').value as number);
    ctx.fillStyle = '#16171a';
    ctx.fillRect(px - 9, g.mid - 26, 18, 52);
    ctx.fillStyle = '#5b5f66';
    for (const dy of [-14, 14]) { ctx.beginPath(); ctx.arc(px, g.mid + dy, 3, 0, Math.PI * 2); ctx.fill(); }
    const palm = b.control('palm').value as number;
    if (palm > 0) {
      ctx.fillStyle = `rgba(232, 116, 44, ${0.15 + palm * 0.35})`;
      ctx.fillRect(g.x(0.055), g.mid - 30, g.x(0.005) - g.x(0.055), 60);
    }
    // the fretting finger, just behind the fret
    const fretX = g.x(b.vibratingLength);
    if (b.fret > 0) {
      const behind = (g.x(fretLength(g.scale, b.fret - 1)) + fretX) / 2;
      ctx.fillStyle = 'rgba(233, 196, 166, 0.85)';
      ctx.beginPath(); ctx.ellipse(behind + (fretX - behind) * 0.4, g.mid, 9, 14, 0, 0, Math.PI * 2); ctx.fill();
    }
    // the pluck point
    const pluckAt = Math.min(b.control('pluck.position').value as number, b.vibratingLength - 0.01);
    ctx.strokeStyle = 'rgba(79, 178, 134, 0.8)';
    ctx.setLineDash([3, 4]);
    ctx.beginPath(); ctx.moveTo(g.x(pluckAt), 18); ctx.lineTo(g.x(pluckAt), g.h - 18); ctx.stroke();
    ctx.setLineDash([]);

    // the string: still from the nut to the fret; from the fret to the bridge, its modes in slow motion (or the pull)
    ctx.strokeStyle = '#d7d9dc';
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.moveTo(g.left, g.mid);
    ctx.lineTo(fretX, g.mid);
    const L = b.vibratingLength;
    const view = engine.readString('bass', 'string');
    const hz = b.modeHz;
    const amps = view?.amps;
    const t = (performance.now() - phase0) / 1000;
    const slow = hz[0] ? hz[0] / SHOWN_HZ : 1;
    const pxPerM = Math.min(12000, (g.h * 0.32) / 0.004); // 4 mm fills about a third of the height
    const steps = 160;
    for (let i = 1; i <= steps; i++) {
      const d = L * (1 - i / steps); // from the fret towards the bridge
      let y = 0;
      if (pull) {
        // the pulled triangle
        y = d >= pull.at ? (pull.dy * (L - d)) / (L - pull.at) : (pull.dy * d) / pull.at;
      } else if (amps) {
        for (let n = 0; n < amps.length && n < hz.length; n++) {
          y += amps[n]! * Math.cos((2 * Math.PI * hz[n]! * t) / slow) * Math.sin(((n + 1) * Math.PI * d) / L);
        }
        y *= pxPerM;
      }
      ctx.lineTo(g.x(d), g.mid + Math.max(-g.h / 2 + 16, Math.min(g.h / 2 - 16, y)));
    }
    ctx.stroke();
    ctx.lineWidth = 1;
    requestAnimationFrame(draw);
  };
  requestAnimationFrame(draw);
  b.onPluck(() => { phase0 = performance.now(); });

  // ---- touching it
  const at = (e: PointerEvent) => {
    const r = canvas.getBoundingClientRect();
    return { px: e.clientX - r.left, py: e.clientY - r.top };
  };
  let down: { at: number; py: number } | undefined;
  canvas.addEventListener('pointerdown', (e) => {
    const g = geometry();
    const { px, py } = at(e);
    const d = g.fromBridge(px);
    const nearString = Math.abs(py - g.mid) < 26;
    if (nearString && d > 0.01 && d < b.vibratingLength - 0.01) {
      canvas.setPointerCapture(e.pointerId);
      down = { at: d, py };
      b.control('pluck.position').set(Math.max(0.02, Math.min(0.4, d)) as never);
      return;
    }
    // the neck: the fret space clicked (between fret k-1 and k plays fret k; left of fret 1 is the open string)
    if (d > b.scale) return;
    let fret = 0;
    for (let k = 1; k <= BASS_FRETS; k++) if (d < fretLength(b.scale, k - 1) && d >= fretLength(b.scale, k)) fret = k;
    if (d < fretLength(b.scale, BASS_FRETS)) return;
    b.control('fret').set(fret as never);
  });
  canvas.addEventListener('pointermove', (e) => {
    if (!down || !canvas.hasPointerCapture(e.pointerId)) return;
    const dy = at(e).py - geometry().mid;
    if (Math.abs(at(e).py - down.py) > 4) pull = { at: down.at, dy };
  });
  canvas.addEventListener('pointerup', () => {
    if (!down) return;
    const g = geometry();
    // a pull lets go with the strength it was pulled to; a click plucks with the Strength fader's
    const strength = pull ? Math.min(1, Math.abs(pull.dy) / (g.h * 0.4)) : undefined;
    b.pluck(down.at, strength);
    down = undefined;
    pull = undefined;
  });

  // ---- the controls
  const rows = el('div', 'synth-rows');
  const row = el('div', 'synth-row');
  const stringSection = renderSection(b, {
    title: 'String', color: BLUE, grow: 5, switches: ['string.gauge', 'string.wrap', 'string.winding', 'string.scale'],
    faders: [{ id: 'string.tension', label: 'Tension' }],
  });
  const tune = el('button', 'btn bass-action', 'Tune');
  tune.type = 'button';
  tune.title = 'Tune the open string to its standard note (E1, A1, D2 or G2)';
  tune.addEventListener('click', () => b.tuneToStandard());
  stringSection.querySelector('.synth-section-body')!.append(tune);
  const pluckSection = renderSection(b, {
    title: 'Pluck', color: GREEN, grow: 3, switches: ['pluck.style'],
    faders: [{ id: 'pluck.position', label: 'At (m)' }, { id: 'pluck.strength', label: 'Strength' }],
  });
  const pluckButton = el('button', 'btn bass-action', 'Pluck');
  pluckButton.type = 'button';
  pluckButton.addEventListener('click', () => b.pluck());
  pluckSection.querySelector('.synth-section-body')!.append(pluckButton);
  const handSection = renderSection(b, { title: 'Hands', color: ORANGE, grow: 2, faders: ['fret', { id: 'palm', label: 'Palm' }] });
  const mute = el('button', 'btn bass-action', 'Mute');
  mute.type = 'button';
  mute.addEventListener('click', () => b.release());
  handSection.querySelector('.synth-section-body')!.append(mute);
  const pickupSection = renderSection(b, {
    title: 'Pickup', color: YELLOW, grow: 3, faders: [{ id: 'pickup.position', label: 'At (m)' }, 'tone', 'level'],
  });
  row.append(stringSection, pluckSection, handSection, pickupSection);
  rows.append(row);
  panel.append(rows);
  void PINK;
  return panel;
}

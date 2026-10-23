import type { AudioEngine } from '../audio/engine';
import { besselJ } from '../domain/devices/drumPhysics';
import { KitGroove } from '../domain/sequencer/kitGroove';
import { CYMBAL_PIECES, DRUM_PIECES, KIT_PIECES, PIECE_NAMES, type DrumKit, type KitPiece } from '../domain/devices/drumKit';
import { actionButton } from './stringsPanel';
import { BLUE, GREEN, ORANGE, PINK, renderSection, YELLOW } from './synthPanel';
import { el } from './widgets';

/** How much slower than life the heads move on screen (each piece's lowest mode is shown at about this many Hz). */
const SHOWN_HZ = 1.2;
/** The grid each surface is worked out on, cells across. */
const GRID = 36;
/** Where each piece sits seen from above (the audience's view of a right-handed drummer, as on the band page): centre x, y as fractions of the view. */
const PLACE: Record<KitPiece, [number, number]> = {
  hat: [0.9, 0.62], crash: [0.78, 0.26], snare: [0.69, 0.7], tom: [0.53, 0.27], kick: [0.48, 0.7], floor: [0.28, 0.68], ride: [0.15, 0.3],
};
/** The computer keys that play it. */
const KEYS: Record<string, { piece: KitPiece; hat?: 'closed' | 'open' | 'pedal'; at?: number }> = {
  z: { piece: 'kick' }, x: { piece: 'snare' }, c: { piece: 'tom' }, v: { piece: 'floor' },
  a: { piece: 'hat', hat: 'closed' }, s: { piece: 'hat', hat: 'open' }, d: { piece: 'hat', hat: 'pedal' },
  q: { piece: 'crash' }, w: { piece: 'ride' }, e: { piece: 'ride', at: 0.12 },
};
const HEAD = { coated: [236, 232, 222], bronze: [205, 160, 66] } as const;

const isCymbal = (p: KitPiece) => (CYMBAL_PIECES as readonly string[]).includes(p);
const fmt = (x: number, d = 0) => x.toFixed(d);

/**
 * The MOA-KIT panel: each piece's live physics, the kit seen from above with every head and cymbal drawn as its
 * surface moving in slow motion (from the engine's mode amplitudes: blue below rest, orange above), and the controls.
 * Click a piece to hit it there (nearer the centre, fewer modes); the computer keys play it too.
 */
export function renderKitPanel(k: DrumKit, engine: AudioEngine): HTMLElement {
  const panel = el('div', 'synth-panel bass-panel kit-panel');
  const header = el('div', 'synth-header');
  const brand = el('div', 'synth-brand');
  brand.append(el('div', 'synth-name', 'MOA-KIT'), el('div', 'synth-subtitle', 'Seven physically modelled pieces'));
  const groove = new KitGroove(k);
  const play = actionButton('Play a rock beat', 'A plain rock beat at 112 bpm, with a fill every fourth bar', () => {
    if (groove.playing) groove.stop();
    else groove.start();
    play.textContent = groove.playing ? 'Stop the beat' : 'Play a rock beat';
  });
  play.classList.add('kit-groove');
  header.append(brand, play);
  panel.append(header);

  // ---- each piece's physics, live
  const table = el('table', 'bass-table');
  table.innerHTML = '<thead><tr><th>Piece</th><th>Size</th><th>Made of</th><th>Tension · stiffness</th><th>Lowest · note</th><th>Overtone</th><th>Lowest rings (−60 dB)</th><th>Modes</th></tr></thead>';
  const body = el('tbody');
  const rows = KIT_PIECES.map((p) => {
    const tr = el('tr');
    const td = () => { const c = el('td'); tr.append(c); return c; };
    td().textContent = PIECE_NAMES[p];
    const row = { size: td(), made: td(), tension: td(), low: td(), over: td(), ring: td(), modes: td() };
    body.append(tr);
    return { p, row };
  });
  table.append(body);
  const paintFacts = () => {
    for (const { p, row } of rows) {
      const r = k.readout(p);
      const inch = r.diameter / 0.0254;
      if (r.kind === 'drum') {
        row.size.textContent = `${fmt(inch)}" × ${fmt(r.depth / 0.0254, 1)}"`;
        row.made.textContent = r.head;
        row.tension.textContent = `${fmt(r.tension)} N/m · c ${fmt(r.speed)} m/s`;
        row.over.textContent = `(1,1) × ${r.ratio11.toFixed(2)}`;
      } else {
        row.size.textContent = `${fmt(inch)}" · ${(r.thickness * 1000).toFixed(2)} mm`;
        row.made.textContent = `B20 bronze, ${fmt(r.mass * 1000)} g`;
        row.tension.textContent = `D ${r.bending.toFixed(1)} N·m`;
        row.over.textContent = `to ${fmt(r.top / 1000, 1)} kHz`;
      }
      row.low.textContent = `${r.fundamental.hz.toFixed(1)} Hz · ${r.fundamental.name}`;
      row.ring.textContent = `${r.ring.toFixed(1)} s`;
      row.modes.textContent = String(r.modes);
    }
  };
  k.onPhysicsChange(paintFacts);
  paintFacts();
  const tableWrap = el('div', 'bass-table-wrap');
  tableWrap.append(table);
  panel.append(tableWrap);

  // ---- the kit from above
  const board = el('div', 'bass-board');
  const canvas = el('canvas', 'bass-canvas kit-canvas');
  canvas.setAttribute('role', 'img');
  canvas.setAttribute('aria-label', 'The kit from above, every head and cymbal moving in slow motion. Click a piece to hit it there.');
  board.append(canvas, el('div', 'bass-hint', 'Click a piece to hit it there · keys: Z kick · X snare · C tom · V floor · A hat · S open hat · D pedal · Q crash · W ride · E bell'));
  panel.append(board);
  const ctx = canvas.getContext('2d')!;

  // each piece's mode shapes on the grid (the first 48 modes, as the engine reports), worked out when its modes change
  type Basis = { key: string; shapes: Float32Array[]; inside: Uint8Array };
  const bases = new Map<KitPiece, Basis>();
  const basis = (p: KitPiece): Basis => {
    const modes = k.pieceModes(p).slice(0, 48);
    const key = modes.map((m) => `${m.m}/${'j' in m ? m.j : m.lambda}`).join(',');
    const known = bases.get(p);
    if (known && known.key === key) return known;
    const inside = new Uint8Array(GRID * GRID);
    const shapes = modes.map(() => new Float32Array(GRID * GRID));
    for (let y = 0; y < GRID; y++) {
      for (let x = 0; x < GRID; x++) {
        const u = ((x + 0.5) / GRID) * 2 - 1, v = ((y + 0.5) / GRID) * 2 - 1, r = Math.hypot(u, v);
        if (r > 1) continue;
        inside[y * GRID + x] = 1;
        const theta = Math.atan2(v, u);
        modes.forEach((m, i) => { shapes[i]![y * GRID + x] = besselJ(m.m, ('j' in m ? m.j : m.lambda) * r) * Math.cos(m.m * theta); });
      }
    }
    const b = { key, shapes, inside };
    bases.set(p, b);
    return b;
  };
  const images = new Map<KitPiece, ImageData>();
  const scratch = document.createElement('canvas');
  scratch.width = GRID; scratch.height = GRID;
  const sctx = scratch.getContext('2d')!;
  const started = performance.now();
  const flash = new Map<KitPiece, number>();
  k.onHit((p) => flash.set(p, performance.now()));
  const gains = new Map<KitPiece, number>();

  const geometry = () => {
    const w = canvas.clientWidth, h = canvas.clientHeight;
    const scale = Math.min(w / 2.6, h / 1.5); // px per metre-ish: a 22" kick about a third of the height
    return KIT_PIECES.map((p) => {
      const d = k.readout(p).diameter;
      return { p, cx: PLACE[p][0] * w, cy: PLACE[p][1] * h, r: (d / 2) * scale * 1.1 };
    });
  };

  const draw = () => {
    const dpr = window.devicePixelRatio || 1;
    if (canvas.width !== Math.round(canvas.clientWidth * dpr)) {
      canvas.width = Math.round(canvas.clientWidth * dpr);
      canvas.height = Math.round(canvas.clientHeight * dpr);
    }
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    const w = canvas.clientWidth, h = canvas.clientHeight;
    ctx.fillStyle = '#16171a';
    ctx.fillRect(0, 0, w, h);
    const t = (performance.now() - started) / 1000;
    for (const g of geometry()) {
      const p = g.p, cymbal = isCymbal(p);
      const b = basis(p);
      const amps = engine.readString('kit', p)?.amps;
      const modes = k.pieceModes(p);
      const slow = modes[0] ? (cymbal ? modes[4]?.hz ?? modes[0].hz : modes[0].hz) / SHOWN_HZ : 1;
      // the surface: the modes added up on the grid, scaled by the largest motion seen lately
      const field = new Float32Array(GRID * GRID);
      let peak = 0;
      if (amps) {
        for (let i = 0; i < b.shapes.length && i < amps.length; i++) {
          const a = amps[i]!;
          if (a < 1e-9) continue;
          const c = a * Math.cos((2 * Math.PI * modes[i]!.hz * t) / slow);
          const s = b.shapes[i]!;
          for (let q = 0; q < field.length; q++) field[q]! += c * s[q]!;
        }
        for (const v of field) peak = Math.max(peak, Math.abs(v));
      }
      const gain = Math.max(peak, (gains.get(p) ?? 0) * 0.97, 1e-6);
      gains.set(p, gain);
      const img = images.get(p) ?? new ImageData(GRID, GRID);
      images.set(p, img);
      const base = cymbal ? HEAD.bronze : HEAD.coated;
      for (let q = 0; q < field.length; q++) {
        const o = q * 4;
        if (!b.inside[q]) { img.data[o + 3] = 0; continue; }
        const v = Math.max(-1, Math.min(1, field[q]! / gain)) * Math.min(1, peak / 2e-6);
        // above rest towards orange, below towards blue
        const [r0, g0, b0] = v > 0 ? [232, 116, 44] : [74, 155, 224];
        const m = Math.abs(v) * 0.85;
        img.data[o] = base[0] + (r0 - base[0]) * m;
        img.data[o + 1] = base[1] + (g0 - base[1]) * m;
        img.data[o + 2] = base[2] + (b0 - base[2]) * m;
        img.data[o + 3] = 255;
      }
      sctx.putImageData(img, 0, 0);
      ctx.save();
      ctx.beginPath(); ctx.arc(g.cx, g.cy, g.r, 0, Math.PI * 2); ctx.clip();
      ctx.imageSmoothingEnabled = true;
      ctx.drawImage(scratch, g.cx - g.r, g.cy - g.r, g.r * 2, g.r * 2);
      ctx.restore();
      // the hoop or the cymbal's edge, the bell, and a flash where it was just hit
      ctx.lineWidth = cymbal ? 1.5 : 4;
      ctx.strokeStyle = cymbal ? '#a88228' : p === 'kick' ? '#8a2f2a' : '#b9bcc2';
      ctx.beginPath(); ctx.arc(g.cx, g.cy, g.r, 0, Math.PI * 2); ctx.stroke();
      if (cymbal) { ctx.fillStyle = 'rgba(168, 130, 40, 0.55)'; ctx.beginPath(); ctx.arc(g.cx, g.cy, g.r * 0.18, 0, Math.PI * 2); ctx.fill(); }
      const since = performance.now() - (flash.get(p) ?? -1e9);
      if (since < 200) { ctx.strokeStyle = `rgba(255, 210, 94, ${1 - since / 200})`; ctx.lineWidth = 3; ctx.beginPath(); ctx.arc(g.cx, g.cy, g.r + 5, 0, Math.PI * 2); ctx.stroke(); }
      ctx.font = '600 13px "Barlow Condensed", sans-serif';
      ctx.textAlign = 'center';
      ctx.fillStyle = '#a9adb3';
      ctx.fillText(PIECE_NAMES[p].toUpperCase(), g.cx, g.cy + g.r + 16);
    }
    ctx.lineWidth = 1;
    requestAnimationFrame(draw);
  };
  requestAnimationFrame(draw);

  const strength = () => k.control('strength').value as number;
  canvas.addEventListener('pointerdown', (e) => {
    const rect = canvas.getBoundingClientRect();
    const x = e.clientX - rect.left, y = e.clientY - rect.top;
    // the piece hit is the nearest one whose surface the pointer is on (cymbals sit above the drums)
    const hits = geometry().filter((g) => Math.hypot(x - g.cx, y - g.cy) <= g.r).sort((a, b) => Number(isCymbal(b.p)) - Number(isCymbal(a.p)));
    const g = hits[0];
    if (!g) return;
    if (g.p === 'hat') k.setHat(k.control('hat.open').value as number);
    k.hit(g.p, strength(), Math.hypot(x - g.cx, y - g.cy) / g.r);
  });
  window.addEventListener('keydown', (e) => {
    if (e.repeat || e.metaKey || e.ctrlKey || e.altKey || e.target instanceof HTMLInputElement || e.target instanceof HTMLSelectElement) return;
    const key = KEYS[e.key.toLowerCase()];
    if (!key) return;
    if (key.hat === 'pedal') return k.hatPedal(strength());
    if (key.hat) k.setHat(key.hat === 'open' ? 1 : 0);
    k.hit(key.piece, strength(), key.at);
  });

  // ---- the controls
  const drums = renderSection(k, {
    title: 'Tuning', color: BLUE, grow: 4,
    faders: DRUM_PIECES.map((p) => ({ id: `${p}.tension`, label: PIECE_NAMES[p].replace(' tom', '') })),
  });
  const muffle = renderSection(k, {
    title: 'Muffling', color: ORANGE, grow: 4,
    faders: DRUM_PIECES.map((p) => ({ id: `${p}.muffle`, label: PIECE_NAMES[p].replace(' tom', '') })),
  });
  const snare = renderSection(k, { title: 'Snare wires', color: GREEN, grow: 2, switches: ['snare.on'], faders: [{ id: 'snare.wires', label: 'Tension' }] });
  const cymbals = renderSection(k, {
    title: 'Cymbals', color: YELLOW, grow: 6, switches: ['cymbals.source', ...CYMBAL_PIECES.map((p) => `${p}.weight`)],
    faders: [{ id: 'cymbals.tail', label: 'Tail' }, { id: 'cymbals.layer', label: 'Model' }, { id: 'hat.open', label: 'Hat open' }],
  });
  cymbals.querySelector('.synth-section-body')!.append(actionButton('Chick', 'Bring the hi-hat pedal down', () => k.hatPedal(strength())));
  const mix = renderSection(k, {
    title: 'Mix', color: PINK, grow: 7,
    faders: [...KIT_PIECES.map((p) => ({ id: `${p}.level`, label: PIECE_NAMES[p].replace(' tom', '').replace('Hi-hat', 'Hat') })), { id: 'level', label: 'Kit' }, { id: 'strength', label: 'Hit' }],
  });
  const row1 = el('div', 'synth-row');
  row1.append(drums, muffle, snare);
  const row2 = el('div', 'synth-row');
  row2.append(cymbals, mix);
  panel.append(row1, row2);
  return panel;
}

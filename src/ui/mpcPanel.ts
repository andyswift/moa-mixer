import type { AudioEngine } from '../audio/engine';
import { evenSlices, loopTempo, mixDown, transients } from '../domain/devices/chop';
import { BANKS, type Mpc60, padName, PADS_PER_BANK } from '../domain/devices/mpc60';
import { type MpcSequencer, PPQ, SEQUENCES, TIMING, type Timing } from '../domain/sequencer/mpcSequencer';
import { ORANGE, PINK, renderSection, YELLOW } from './synthPanel';
import { el } from './widgets';

/** Computer keys for the 16 pads, laid out like them: the bottom row is pads 1 to 4. */
const PAD_KEYS = ['z', 'x', 'c', 'v', 'a', 's', 'd', 'f', 'q', 'w', 'e', 'r', '1', '2', '3', '4'];
const SOFT_VELOCITY = 0.35; // a click at the bottom edge of a pad; the top edge is full

export interface MpcPanelHooks {
  /** Files dropped or chosen: decode and add them, starting at the selected pad. */
  importFiles(files: File[]): Promise<void>;
  /** The kits to choose from (factory first, then saved ones). */
  kitNames(): Promise<{ factory: string[]; saved: string[] }>;
  loadKit(name: string, factory: boolean): Promise<void>;
  saveKit(name: string): Promise<void>;
  exportKit(): Promise<void>;
  importKit(file: File): Promise<void>;
  /** A pad pressed or let go on screen, by mouse, touch or key (the page records it and plays note repeat). */
  padDown(n: number, velocity: number, noteRepeat: boolean): void;
  padUp(n: number): void;
  /** Transport. */
  play(fromStart: boolean, record: boolean): void;
  stop(): void;
  /** A sound was removed from the pool. */
  soundRemoved(id: string): void;
}

/**
 * The MOA-60 front panel: the screen (the selected pad's sound with its start and end, which drag; what is playing;
 * the sequencer's place), the 16 pads with their banks, 16 Levels and note repeat, the transport, the pad's sound
 * settings, the sequence as a grid (click to add or take out a hit), and the sounds: import, chop, MPC60 or clean.
 */
export function renderMpcPanel(m: Mpc60, seq: MpcSequencer, engine: AudioEngine, hooks: MpcPanelHooks): HTMLElement {
  const panel = el('div', 'synth-panel mpc-panel');

  // ---- header: the name and the kit
  const header = el('div', 'synth-header');
  const brand = el('div', 'synth-brand');
  brand.append(el('div', 'synth-name', 'MOA-60'), el('div', 'synth-subtitle', 'Sampler and sequencer · 40 kHz · 12 bit'));
  const kitRow = el('div', 'mpc-kit');
  const kitSelect = el('select', 'patch-select');
  kitSelect.setAttribute('aria-label', 'Kit');
  const refreshKits = async () => {
    const { factory, saved } = await hooks.kitNames();
    kitSelect.replaceChildren(new Option(m.programName, '', true, true));
    for (const n of factory) kitSelect.add(new Option(`Factory · ${n}`, `f:${n}`));
    for (const n of saved) kitSelect.add(new Option(n, `s:${n}`));
  };
  kitSelect.addEventListener('change', () => {
    const v = kitSelect.value;
    if (!v) return;
    void hooks.loadKit(v.slice(2), v.startsWith('f:')).then(refreshKits);
  });
  const button = (text: string, label: string, onClick: () => void, cls = '') => {
    const b = el('button', `btn mpc-btn ${cls}`, text);
    b.type = 'button';
    b.setAttribute('aria-label', label);
    b.addEventListener('click', onClick);
    return b;
  };
  const kitFile = el('input');
  kitFile.type = 'file';
  kitFile.accept = '.json,.moa60';
  kitFile.hidden = true;
  kitFile.addEventListener('change', () => { const f = kitFile.files?.[0]; if (f) void hooks.importKit(f).then(refreshKits); kitFile.value = ''; });
  kitRow.append(
    el('div', 'fader-label', 'Kit'), kitSelect,
    button('Save', 'Save kit', () => {
      const name = prompt('Save the kit as', m.programName);
      if (name) void hooks.saveKit(name).then(refreshKits);
    }),
    button('Export', 'Export the kit to a file', () => void hooks.exportKit()),
    button('Import', 'Import a kit file', () => kitFile.click()),
    kitFile,
  );
  header.append(brand, kitRow);
  panel.append(header);
  void refreshKits();

  // ---- the screen and the pads, side by side
  const top = el('div', 'mpc-top');
  const screen = el('div', 'mpc-screen');
  const line1 = el('div', 'mpc-lcd-line');
  const canvas = el('canvas', 'mpc-wave');
  canvas.setAttribute('aria-label', "The selected pad's sound: drag the start and end markers");
  const line2 = el('div', 'mpc-lcd-line');
  screen.append(line1, canvas, line2);

  // chop and edit, under the screen
  const chopRow = el('div', 'mpc-row');
  const sens = el('input');
  sens.type = 'range'; sens.min = '0'; sens.max = '1'; sens.step = '0.05'; sens.value = '0.5';
  sens.setAttribute('aria-label', 'Chop sensitivity');
  const slices = el('select', 'mpc-select');
  slices.setAttribute('aria-label', 'Even slices');
  for (const n of [4, 8, 16]) slices.add(new Option(`${n} slices`, String(n), n === 8, n === 8));
  const beats = el('select', 'mpc-select');
  beats.setAttribute('aria-label', 'Loop length');
  for (const b of [1, 2, 4, 8, 16]) beats.add(new Option(`${b / 4 >= 1 ? `${b / 4} bar${b > 4 ? 's' : ''}` : `${b} beat${b > 1 ? 's' : ''}`}`, String(b), b === 8, b === 8));
  const chop = (starts: number[], frames: number, rate: number) => {
    const p = m.pads[m.selectedPad]!;
    if (!p.sound) return;
    const offset = p.start;
    const first = m.selectedPad - (m.selectedPad % PADS_PER_BANK); // the bank of the selected pad, from its first pad
    starts.slice(0, PADS_PER_BANK).forEach((s, i) => {
      const end = starts[i + 1] ?? frames;
      m.setPad(first + i, { sound: p.sound, start: offset + s / rate, end: offset + end / rate, reverse: false, loop: false });
    });
  };
  /** The selected pad's region of its sound, as played (mono, frames, rate). */
  const region = () => {
    const p = m.pads[m.selectedPad]!;
    const s = p.sound ? m.sounds.get(p.sound) : undefined;
    if (!s) return undefined;
    const from = Math.round(p.start * s.rate), to = p.end > p.start ? Math.round(p.end * s.rate) : s.channels[0]!.length;
    return { mono: mixDown(s.channels).subarray(from, to), rate: s.rate };
  };
  chopRow.append(
    button('Chop at hits', 'Chop the sound at its hits across the bank', () => {
      const r = region();
      if (r) chop(transients(r.mono, r.rate, Number(sens.value), PADS_PER_BANK), r.mono.length, r.rate);
    }),
    el('span', 'mpc-small', 'Sensitivity'), sens,
    button('Chop even', 'Chop the sound into even slices across the bank', () => {
      const r = region();
      if (r) chop(evenSlices(r.mono.length, Number(slices.value)), r.mono.length, r.rate);
    }),
    slices,
    beats,
    button('Tempo from loop', 'Set the tempo so the pad is this many beats', () => {
      const r = region();
      if (r) seq.setTempo(Math.round(loopTempo(r.mono.length, r.rate, Number(beats.value)) * 10) / 10, engine.currentTime);
      paintStatus();
    }),
  );
  const screenWrap = el('div', 'mpc-screen-wrap');
  screenWrap.append(screen, chopRow);

  // the pads
  const padArea = el('div', 'mpc-pad-area');
  const bankRow = el('div', 'mpc-row');
  const bankButtons = BANKS.map((b, i) => {
    const btn = button(`Bank ${b}`, `Bank ${b}`, () => { m.bank = i; paintPads(); }, 'mpc-bank');
    return btn;
  });
  bankRow.append(...bankButtons);
  const grid = el('div', 'mpc-pads');
  const fullLevel = el('input');
  fullLevel.type = 'checkbox';
  const padEls = Array.from({ length: PADS_PER_BANK }, (_, n) => {
    const pad = el('button', 'mpc-pad');
    pad.type = 'button';
    const name = el('span', 'mpc-pad-name'), sound = el('span', 'mpc-pad-sound'), key = el('span', 'mpc-pad-key', PAD_KEYS[n]!.toUpperCase());
    pad.append(name, sound, key);
    // pads 13-16 on the top row, 1-4 on the bottom, as on the machine
    pad.style.gridRow = String(4 - Math.floor(n / 4));
    pad.style.gridColumn = String((n % 4) + 1);
    pad.addEventListener('pointerdown', (e) => {
      e.preventDefault();
      pad.setPointerCapture(e.pointerId);
      const r = pad.getBoundingClientRect();
      const fromY = 1 - (1 - SOFT_VELOCITY) * Math.min(1, Math.max(0, (e.clientY - r.top) / r.height));
      const pressure = e.pointerType !== 'mouse' && e.pressure > 0 && e.pressure !== 0.5 ? e.pressure : undefined;
      hooks.padDown(n, fullLevel.checked ? 1 : pressure ?? fromY, repeat.checked);
    });
    const up = () => hooks.padUp(n);
    pad.addEventListener('pointerup', up);
    pad.addEventListener('pointercancel', up);
    grid.append(pad);
    return { pad, name, sound };
  });
  const options = el('div', 'mpc-row');
  const full = el('label', 'mpc-check');
  full.append(fullLevel, document.createTextNode(' Full level'));
  const levels = el('select', 'mpc-select');
  levels.setAttribute('aria-label', '16 Levels');
  for (const v of m.levels.options) levels.add(new Option(v === 'off' ? '16 Levels off' : `16 Levels: ${v}`, v));
  levels.addEventListener('change', () => m.levels.set(levels.value));
  m.levels.onChange(() => { levels.value = m.levels.value; });
  const repeat = el('input');
  repeat.type = 'checkbox';
  const repeatLabel = el('label', 'mpc-check');
  repeatLabel.append(repeat, document.createTextNode(' Note repeat'));
  options.append(full, levels, repeatLabel);
  padArea.append(bankRow, grid, options);
  top.append(screenWrap, padArea);
  panel.append(top);

  // ---- transport
  const transport = el('div', 'mpc-transport');
  const rec = button('● Rec', 'Record from the top', () => hooks.play(true, true), 'mpc-rec');
  const dub = button('Overdub', 'Record on or off while playing', () => { if (seq.isPlaying) seq.setRecording(!seq.isRecording); else hooks.play(true, true); }, 'mpc-rec');
  const stop = button('■ Stop', 'Stop', () => hooks.stop());
  const play = button('▶ Play', 'Play', () => hooks.play(false, false));
  const playStart = button('▶ Start', 'Play from the start', () => hooks.play(true, false));
  const seqSelect = el('select', 'mpc-select');
  seqSelect.setAttribute('aria-label', 'Sequence');
  for (let i = 0; i < SEQUENCES; i++) seqSelect.add(new Option(`Seq ${String(i + 1).padStart(2, '0')}`, String(i)));
  seqSelect.addEventListener('change', () => seq.select(Number(seqSelect.value)));
  const tempo = el('input', 'mpc-number');
  tempo.type = 'number'; tempo.min = '30'; tempo.max = '300'; tempo.step = '0.1';
  tempo.setAttribute('aria-label', 'Tempo');
  tempo.addEventListener('change', () => { seq.setTempo(Number(tempo.value), engine.currentTime); paintStatus(); });
  const swing = el('input');
  swing.type = 'range'; swing.min = '50'; swing.max = '75'; swing.step = '1';
  swing.setAttribute('aria-label', 'Swing');
  const swingValue = el('span', 'mpc-small');
  swing.addEventListener('input', () => { seq.swing = Number(swing.value); paintStatus(); });
  const tc = el('select', 'mpc-select');
  tc.setAttribute('aria-label', 'Timing correct');
  for (const k of Object.keys(TIMING)) tc.add(new Option(k === 'off' ? 'TC off' : `TC ${k}`, k));
  tc.addEventListener('change', () => { seq.timing = tc.value as Timing; paintStatus(); });
  const bars = el('select', 'mpc-select');
  bars.setAttribute('aria-label', 'Bars');
  for (let b = 1; b <= 16; b++) bars.add(new Option(`${b} bar${b > 1 ? 's' : ''}`, String(b)));
  bars.addEventListener('change', () => seq.setBars(Number(bars.value)));
  const check = (label: string, get: () => boolean, set: (v: boolean) => void) => {
    const box = el('input');
    box.type = 'checkbox';
    box.checked = get();
    box.addEventListener('change', () => set(box.checked));
    const l = el('label', 'mpc-check');
    l.append(box, document.createTextNode(` ${label}`));
    return { l, box };
  };
  const metro = check('Click', () => seq.metronome, (v) => { seq.metronome = v; });
  const countIn = check('Count in', () => seq.countIn, (v) => { seq.countIn = v; });
  const sync = el('select', 'mpc-select');
  sync.setAttribute('aria-label', 'Clock');
  sync.add(new Option('Internal clock', 'internal'));
  sync.add(new Option('MIDI clock', 'midi'));
  sync.addEventListener('change', () => { if (seq.isPlaying) hooks.stop(); seq.sync = sync.value as 'internal' | 'midi'; });
  transport.append(
    rec, dub, stop, play, playStart, seqSelect,
    el('span', 'mpc-small', 'BPM'), tempo,
    el('span', 'mpc-small', 'Swing'), swing, swingValue, tc, bars, metro.l, countIn.l, sync,
    button('Quantise', 'Move every hit onto the timing-correct grid, with swing', () => seq.quantise()),
    button('Erase pad', "Take out the selected pad's hits from this sequence", () => seq.erase(m.selectedPad)),
    button('Clear', 'Clear this sequence', () => { if (confirm('Clear this sequence?')) seq.clear(); }),
  );
  panel.append(transport);

  // ---- the pad's sound settings
  const row = el('div', 'synth-row');
  const padSection = renderSection(m, { title: 'Pad', color: ORANGE, grow: 7, switches: ['pad.mode', 'pad.reverse', 'pad.loop'], faders: ['pad.tune', 'pad.level', 'pad.pan', 'pad.attack', 'pad.decay', { id: 'pad.velocity', label: 'Vel' }] });
  // the mute group as a drop-down (nine buttons would crowd the section)
  const groupControl = m.control('pad.group');
  const group = el('select', 'mpc-select');
  group.setAttribute('aria-label', 'Mute group');
  if (groupControl.kind === 'choice') {
    for (const o of groupControl.options) group.add(new Option(o === 'off' ? 'No mute group' : `Mute group ${o}`, o));
    group.value = groupControl.value;
    group.addEventListener('change', () => groupControl.set(group.value));
    groupControl.onChange(() => { group.value = groupControl.value; });
  }
  const groupWrap = el('div', 'switch');
  groupWrap.append(el('div', 'fader-label', 'Mute group'), group);
  padSection.querySelector('.synth-section-body')?.prepend(groupWrap);
  row.append(
    padSection,
    renderSection(m, { title: 'Filter', color: YELLOW, grow: 3, faders: ['pad.cutoff', { id: 'pad.reso', label: 'Res' }, { id: 'pad.velFilter', label: 'Vel' }] }),
    renderSection(m, { title: 'Master', color: PINK, grow: 1, switches: ['mpc.character'], faders: ['mpc.level'] }),
  );
  panel.append(row);

  // ---- the sequence as a grid
  const seqWrap = el('div', 'mpc-seq');
  const seqCanvas = el('canvas', 'mpc-seq-canvas');
  seqCanvas.setAttribute('aria-label', 'The sequence: click to add or take out a hit on the timing-correct grid');
  seqWrap.append(el('div', 'mpc-hint', 'Sequence · click a row to add or take out a hit · the selected pad is always shown'), seqCanvas);
  panel.append(seqWrap);

  // ---- the sounds
  const pool = el('div', 'mpc-pool');
  const drop = el('div', 'mpc-drop');
  const fileInput = el('input');
  fileInput.type = 'file';
  fileInput.multiple = true;
  fileInput.accept = 'audio/*,.wav,.aif,.aiff,.mp3,.flac,.ogg,.m4a';
  fileInput.hidden = true;
  fileInput.addEventListener('change', () => { void hooks.importFiles([...(fileInput.files ?? [])]); fileInput.value = ''; });
  drop.append(el('span', undefined, 'Drop sounds here (wav, aiff, mp3, flac) or '), button('choose files', 'Choose sound files', () => fileInput.click()), fileInput,
    el('span', 'mpc-small', ' · they go on the pads from the selected one, and stay in this browser'));
  drop.addEventListener('dragover', (e) => { e.preventDefault(); drop.classList.add('over'); });
  drop.addEventListener('dragleave', () => drop.classList.remove('over'));
  drop.addEventListener('drop', (e) => {
    e.preventDefault();
    drop.classList.remove('over');
    void hooks.importFiles([...(e.dataTransfer?.files ?? [])].filter((f) => f.type.startsWith('audio') || /\.(wav|aiff?|mp3|flac|ogg|m4a)$/i.test(f.name)));
  });
  const list = el('div', 'mpc-sounds');
  pool.append(drop, list);
  panel.append(pool);

  const paintPool = () => {
    list.replaceChildren();
    for (const s of m.sounds.values()) {
      const r = el('div', 'mpc-sound');
      const name = el('span', 'mpc-sound-name', s.name);
      const len = el('span', 'mpc-small', `${m.duration(s.id).toFixed(2)} s · ${s.source.channels.length === 2 ? 'stereo' : 'mono'}`);
      const char = el('select', 'mpc-select');
      char.setAttribute('aria-label', `${s.name}: character`);
      char.add(new Option('MPC60 40k/12', 'MPC60'));
      char.add(new Option('Clean', 'Clean'));
      char.value = s.character;
      char.addEventListener('change', () => m.setCharacter(s.id, char.value as 'MPC60' | 'Clean'));
      const used = m.pads.map((p, i) => (p.sound === s.id ? padName(i) : '')).filter(Boolean);
      r.append(name, len, char,
        button('To pad', `Put ${s.name} on the selected pad`, () => m.assign(m.selectedPad, s.id)),
        el('span', 'mpc-small', used.length ? `on ${used.slice(0, 6).join(' ')}${used.length > 6 ? ' …' : ''}` : 'not on a pad'),
        button('✕', `Remove ${s.name}`, () => { if (confirm(`Remove ${s.name}?`)) { m.removeSound(s.id); hooks.soundRemoved(s.id); } }, 'mpc-x'));
      list.append(r);
    }
  };

  // ---- painting
  const flash = new Map<number, number>();
  m.onHit((h) => flash.set(h.pad, performance.now()));
  const paintPads = () => {
    bankButtons.forEach((b, i) => b.classList.toggle('active', m.bank === i));
    padEls.forEach(({ pad, name, sound }, n) => {
      const i = m.bank * PADS_PER_BANK + n, p = m.pads[i]!;
      name.textContent = padName(i);
      // a slice of a longer sound shows where it starts
      const whole = p.sound ? m.duration(p.sound) : 0;
      sound.textContent = p.sound ? `${m.sounds.get(p.sound)?.name ?? ''}${p.start > 0 || (p.end > 0 && p.end < whole - 0.001) ? ` @${p.start.toFixed(2)}` : ''}` : '';
      pad.classList.toggle('selected', i === m.selectedPad);
      pad.classList.toggle('empty', !p.sound);
      pad.setAttribute('aria-label', `Pad ${padName(i)}${p.sound ? `: ${m.sounds.get(p.sound)?.name ?? ''}` : ''}`);
    });
  };
  const paintStatus = () => {
    tempo.value = seq.tempo.toFixed(1);
    swing.value = String(seq.swing);
    swingValue.textContent = `${seq.swing}%`;
    tc.value = seq.timing;
    bars.value = String(seq.sequence.bars);
    seqSelect.value = String(seq.next ?? seq.current);
    sync.value = seq.sync;
    rec.classList.toggle('on', seq.isRecording);
    play.classList.toggle('on', seq.isPlaying);
  };
  m.onChange(() => {
    paintPads(); paintPool(); paintStatus();
    if (kitSelect.options[0] && kitSelect.options[0].text !== m.programName) kitSelect.options[0].text = m.programName;
  });
  seq.onChange(paintStatus);
  paintPads();
  paintPool();
  paintStatus();

  // waveform with start/end markers that drag
  let dragging: 'start' | 'end' | undefined;
  const peaksCache = new Map<string, Float32Array>();
  const peaksOf = (id: string, width: number) => {
    const key = `${id}/${width}/${m.sounds.get(id)?.rate}`;
    let pk = peaksCache.get(key);
    if (pk) return pk;
    const s = m.sounds.get(id)!;
    const x = s.channels[0]!, y = s.channels[1] ?? x;
    pk = new Float32Array(width);
    const per = x.length / width;
    for (let i = 0; i < width; i++) {
      let peak = 0;
      for (let j = Math.floor(i * per); j < Math.min(x.length, Math.floor((i + 1) * per)); j++) peak = Math.max(peak, Math.abs(x[j]!), Math.abs(y[j]!));
      pk[i] = peak;
    }
    peaksCache.set(key, pk);
    return pk;
  };
  const markerX = (seconds: number, total: number, w: number) => (seconds / total) * w;
  canvas.addEventListener('pointerdown', (e) => {
    const p = m.pads[m.selectedPad]!;
    if (!p.sound) return;
    const r = canvas.getBoundingClientRect(), total = m.duration(p.sound);
    const x = e.clientX - r.left;
    const sx = markerX(p.start, total, r.width), ex = markerX(p.end > p.start ? p.end : total, total, r.width);
    dragging = Math.abs(x - sx) < Math.abs(x - ex) ? 'start' : 'end';
    canvas.setPointerCapture(e.pointerId);
  });
  canvas.addEventListener('pointermove', (e) => {
    if (!dragging) return;
    const p = m.pads[m.selectedPad]!;
    if (!p.sound) return;
    const r = canvas.getBoundingClientRect(), total = m.duration(p.sound);
    const t = Math.min(total, Math.max(0, ((e.clientX - r.left) / r.width) * total));
    const end = p.end > p.start ? p.end : total;
    if (dragging === 'start') m.setPad(m.selectedPad, { start: Math.min(t, end - 0.002), end });
    else m.setPad(m.selectedPad, { end: Math.max(t, p.start + 0.002) });
  });
  canvas.addEventListener('pointerup', () => {
    if (dragging) m.hit(m.selectedPad, 1);
    dragging = undefined;
  });

  const lcdInk = '#1d2a12', lcdDim = 'rgba(29, 42, 18, 0.35)';
  const paintScreen = () => {
    const dpr = window.devicePixelRatio || 1;
    const w = canvas.clientWidth, h = canvas.clientHeight;
    if (canvas.width !== Math.round(w * dpr)) { canvas.width = Math.round(w * dpr); canvas.height = Math.round(h * dpr); }
    const g = canvas.getContext('2d')!;
    g.setTransform(dpr, 0, 0, dpr, 0, 0);
    g.clearRect(0, 0, w, h);
    const i = m.selectedPad, p = m.pads[i]!;
    const s = p.sound ? m.sounds.get(p.sound) : undefined;
    line1.textContent = `PAD ${padName(i)}  ${s ? s.name.slice(0, 28) : '(no sound)'}${s ? `  ${s.character === 'MPC60' ? '40k 12-bit' : `${(s.rate / 1000).toFixed(1)}k clean`}` : ''}`;
    if (s) {
      const total = m.duration(s.id);
      const pk = peaksOf(s.id, Math.max(1, Math.floor(w)));
      const sx = markerX(p.start, total, w), ex = markerX(p.end > p.start ? p.end : total, total, w);
      for (let x = 0; x < pk.length; x++) {
        g.fillStyle = x >= sx && x <= ex ? lcdInk : lcdDim;
        const a = Math.min(1, pk[x]!) * (h / 2 - 4);
        g.fillRect(x, h / 2 - a, 1, Math.max(1, 2 * a));
      }
      g.fillStyle = lcdInk;
      g.fillRect(sx - 1, 0, 2, h);
      g.fillRect(ex - 1, 0, 2, h);
      g.font = '11px "Share Tech Mono", monospace';
      g.fillText(`S ${p.start.toFixed(3)}`, Math.min(sx + 4, w - 70), 12);
      g.fillText(`E ${(p.end > p.start ? p.end : total).toFixed(3)}`, Math.max(0, ex - 64), h - 4);
      // what is playing on this pad
      for (const [pad, pos] of engine.readSampler('mpc', 'voices')?.voices ?? []) {
        if (pad !== i) continue;
        const x = sx + pos * (ex - sx);
        g.fillRect(x, 0, 1, h);
      }
    } else {
      g.fillStyle = lcdInk;
      g.font = '13px "Share Tech Mono", monospace';
      g.fillText('Drop a sound on the page, or choose one below', 10, h / 2);
    }
    const pos = seq.position(engine.currentTime);
    const bar = Math.floor(Math.max(0, pos) / (4 * PPQ)) + 1, beat = Math.floor((Math.max(0, pos) % (4 * PPQ)) / PPQ) + 1, tick = Math.floor(Math.max(0, pos) % PPQ);
    const state = seq.isRecording ? (pos < 0 ? 'COUNT IN' : 'REC') : seq.isPlaying ? 'PLAY' : 'STOP';
    line2.textContent = `SEQ ${String(seq.current + 1).padStart(2, '0')}  ${String(bar).padStart(3, '0')}.${beat}.${String(tick).padStart(2, '0')}  ${seq.tempo.toFixed(1)} BPM  SW ${seq.swing}%  TC ${seq.timing}  ${state}${seq.next !== undefined ? `  NEXT ${seq.next + 1}` : ''}`;
  };

  // sequence grid
  const ROW_H = 18, LABEL_W = 46;
  const rowsOf = () => {
    const pads = new Set(seq.sequence.events.map((e) => e.pad));
    pads.add(m.selectedPad);
    return [...pads].sort((a, b) => a - b);
  };
  seqCanvas.addEventListener('pointerdown', (e) => {
    const rows = rowsOf();
    const r = seqCanvas.getBoundingClientRect();
    const rowIndex = Math.floor((e.clientY - r.top) / ROW_H);
    const pad = rows[rowIndex];
    if (pad === undefined) return;
    const x = e.clientX - r.left - LABEL_W;
    if (x < 0) { m.selected.set(padName(pad)); return; }
    const ticks = seq.loopTicks, grid = TIMING[seq.timing === 'off' ? '1/16' : seq.timing];
    const tick = Math.min(ticks - grid, Math.round(((x / (r.width - LABEL_W)) * ticks) / grid) * grid);
    const near = seq.sequence.events.find((ev) => ev.pad === pad && Math.abs(ev.tick - tick) < grid / 2);
    seq.toggleStep(pad, near ? near.tick : tick);
  });
  const paintSeq = () => {
    const rows = rowsOf();
    const dpr = window.devicePixelRatio || 1;
    const w = seqCanvas.clientWidth, h = Math.max(ROW_H * 2, rows.length * ROW_H);
    seqCanvas.style.height = `${h}px`;
    if (seqCanvas.width !== Math.round(w * dpr) || seqCanvas.height !== Math.round(h * dpr)) { seqCanvas.width = Math.round(w * dpr); seqCanvas.height = Math.round(h * dpr); }
    const g = seqCanvas.getContext('2d')!;
    g.setTransform(dpr, 0, 0, dpr, 0, 0);
    g.clearRect(0, 0, w, h);
    const ticks = seq.loopTicks, inner = w - LABEL_W, xOf = (t: number) => LABEL_W + (t / ticks) * inner;
    // beats and bars
    for (let t = 0; t <= ticks; t += PPQ / 4) {
      g.fillStyle = t % (4 * PPQ) === 0 ? '#5a5e66' : t % PPQ === 0 ? '#3a3d42' : '#26292d';
      g.fillRect(Math.round(xOf(t)), 0, 1, h);
    }
    g.font = '12px "Barlow Condensed", system-ui, sans-serif';
    rows.forEach((pad, r) => {
      const y = r * ROW_H;
      g.fillStyle = pad === m.selectedPad ? '#ffd25e' : '#a9adb3';
      g.fillText(padName(pad), 6, y + 13);
      g.fillStyle = '#26292d';
      g.fillRect(LABEL_W, y + ROW_H - 1, inner, 1);
      for (const e of seq.sequence.events) {
        if (e.pad !== pad) continue;
        g.fillStyle = seq.muted.has(pad) ? '#5a5e66' : `rgba(232, 116, 44, ${0.35 + 0.65 * e.velocity})`;
        g.fillRect(xOf(e.tick), y + 3, Math.max(3, (e.length / ticks) * inner), ROW_H - 6);
      }
    });
    if (seq.isPlaying) {
      const pos = seq.position(engine.currentTime);
      if (pos >= 0) { g.fillStyle = '#f1eee6'; g.fillRect(xOf(pos % ticks), 0, 2, h); }
    }
  };

  let painting = true;
  const frame = () => {
    if (!painting) return;
    paintScreen();
    paintSeq();
    const now = performance.now();
    padEls.forEach(({ pad }, n) => {
      const i = m.levels.value === 'off' ? m.bank * PADS_PER_BANK + n : m.selectedPad;
      const t = flash.get(i);
      pad.classList.toggle('hit', t !== undefined && now - t < 90);
    });
    requestAnimationFrame(frame);
  };
  requestAnimationFrame(frame);
  window.addEventListener('pagehide', () => { painting = false; });

  // computer keys play the pads; space plays and stops
  const down = new Set<string>();
  window.addEventListener('keydown', (e) => {
    if (e.target instanceof HTMLInputElement || e.target instanceof HTMLSelectElement || e.metaKey || e.ctrlKey || e.altKey) return;
    const k = e.key.toLowerCase();
    if (k === ' ') { e.preventDefault(); if (seq.isPlaying) hooks.stop(); else hooks.play(false, false); return; }
    const n = PAD_KEYS.indexOf(k);
    if (n < 0 || down.has(k)) return;
    down.add(k);
    hooks.padDown(n, fullLevel.checked ? 1 : 0.85, repeat.checked);
  });
  window.addEventListener('keyup', (e) => {
    const k = e.key.toLowerCase();
    if (!down.delete(k)) return;
    hooks.padUp(PAD_KEYS.indexOf(k));
  });

  return panel;
}

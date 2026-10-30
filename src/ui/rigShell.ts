import { RIG_FIRST_PAD_NOTE } from '../domain/devices/rigKit';
import { RIG_DEFAULTS } from '../domain/devices/rigParams';
import { RIG_VOICES, type RigSynth } from '../domain/devices/rigSynth';
import { RIG_CLOCKS, RIG_PATTERNS } from '../domain/sequencer/rigSequencer';
import { el } from './widgets';

/**
 * The MOA-RIG's frame, after its design: a header (the name, the three pages, tempo, voices in use, the multi, SETUP
 * with the site's navigation and the audio and MIDI strip, KEYS with the keyboard, START AUDIO) over one page at a
 * time, sized for a 14" laptop's window. The number keys 1-3 change page.
 */
export interface RigShellPages {
  synth: HTMLElement;
  seq: HTMLElement;
  mix: HTMLElement;
  /** The multi bar, the site's frame and the keyboard bed, each in a drop-down of the header. */
  multi: HTMLElement;
  setup: HTMLElement;
  keys: HTMLElement;
  /** Starts the audio (the first time) and reports whether it runs. */
  start(): Promise<void>;
  running(): boolean;
}

const TABS = [['synth', '1 SYNTH'], ['seq', '2 SEQUENCER'], ['mix', '3 MIXER · FX']] as const;
type Tab = (typeof TABS)[number][0];
const TAB_KEY = 'moa-rig.tab';
const NOTE_NAMES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];
const noteName = (n: number) => `${NOTE_NAMES[n % 12]}${Math.floor(n / 12) - 1}`;

const button = (cls: string, text: string, label?: string) => {
  const b = el('button', cls, text);
  b.type = 'button';
  if (label) b.setAttribute('aria-label', label);
  return b;
};

export function renderRigShell(rig: RigSynth, pages: RigShellPages): HTMLElement {
  const shell = el('div', 'rig-wrap rig-shell');
  const header = el('header', 'rig-header');
  const logo = el('div', 'rig-logo', 'MOA-RIG');
  const tabs = el('nav', 'rig-tabs');
  tabs.setAttribute('aria-label', 'Pages');
  const bodies: Record<Tab, HTMLElement> = { synth: pages.synth, seq: pages.seq, mix: pages.mix };
  let tab: Tab = 'synth';
  try { const saved = localStorage.getItem(TAB_KEY); if (saved === 'seq' || saved === 'mix') tab = saved; } catch { /* the first page */ }
  const tabButtons = TABS.map(([id, label]) => {
    const b = button('rig-tab', label);
    b.addEventListener('click', () => show(id));
    tabs.append(b);
    return [id, b] as const;
  });
  function show(id: Tab): void {
    tab = id;
    for (const [t, b] of tabButtons) { b.classList.toggle('on', t === id); b.setAttribute('aria-current', t === id ? 'page' : 'false'); }
    for (const [t, body] of Object.entries(bodies)) body.hidden = t !== id;
    try { localStorage.setItem(TAB_KEY, id); } catch { /* not remembered */ }
  }

  // tempo: the readout turns with the wheel or a drag, double-click for 120
  const bpm = el('output', 'rig-readout rig-header-bpm');
  bpm.tabIndex = 0;
  bpm.title = 'Tempo: wheel or drag up and down; double-click for 120';
  bpm.setAttribute('role', 'slider');
  bpm.setAttribute('aria-label', 'Tempo');
  const setBpm = (v: number) => { rig.bpm = Math.round(Math.min(240, Math.max(40, v)) * 10) / 10; rig.seq.notify(); };
  bpm.addEventListener('wheel', (e) => { e.preventDefault(); setBpm(rig.bpm + Math.sign(-e.deltaY) * (e.shiftKey ? 0.1 : 1)); }, { passive: false });
  bpm.addEventListener('dblclick', () => setBpm(120));
  bpm.addEventListener('keydown', (e) => {
    if (e.key === 'ArrowUp' || e.key === 'ArrowDown') { e.preventDefault(); e.stopPropagation(); setBpm(rig.bpm + (e.key === 'ArrowUp' ? 1 : -1) * (e.shiftKey ? 0.1 : 1)); }
  });
  bpm.addEventListener('pointerdown', (e) => {
    const y0 = e.clientY, b0 = rig.bpm;
    bpm.setPointerCapture(e.pointerId);
    const move = (m: PointerEvent) => setBpm(b0 + (y0 - m.clientY) * 0.5);
    const up = () => { bpm.removeEventListener('pointermove', move); bpm.removeEventListener('pointerup', up); };
    bpm.addEventListener('pointermove', move);
    bpm.addEventListener('pointerup', up);
  });
  const voices = el('span', 'rig-header-stat');
  const multi = el('span', 'rig-header-stat');

  // the drop-downs: MULTI, SETUP, KEYS (one open at a time)
  const drops: [HTMLButtonElement, HTMLElement][] = [];
  const drop = (label: string, body: HTMLElement, cls: string) => {
    const b = button('rig-small rig-wide rig-drop-button', label);
    const box = el('div', `rig-drop ${cls}`);
    box.hidden = true;
    box.append(body);
    b.setAttribute('aria-expanded', 'false');
    b.addEventListener('click', () => {
      const open = box.hidden === true;
      for (const [ob, obox] of drops) { obox.hidden = true; ob.setAttribute('aria-expanded', 'false'); ob.classList.remove('on'); }
      box.hidden = !open;
      b.setAttribute('aria-expanded', String(open));
      b.classList.toggle('on', open);
    });
    drops.push([b, box]);
    return b;
  };
  const multiButton = drop('MULTI', pages.multi, 'rig-drop-multi');
  const setupButton = drop('SETUP', pages.setup, 'rig-drop-setup');
  const keysButton = drop('KEYS', pages.keys, 'rig-drop-keys');
  const start = button('rig-key rig-wide rig-start', 'START AUDIO');
  start.addEventListener('click', async () => { await pages.start(); syncHeader(); });

  header.append(logo, tabs, bpm, voices, multi, multiButton, setupButton, keysButton, start);
  const body = el('div', 'rig-pages');
  body.append(pages.synth, pages.seq, pages.mix);
  shell.append(header, ...drops.map(([, box]) => box), body);

  function syncHeader(): void {
    bpm.textContent = `${rig.bpm.toFixed(1)} BPM`;
    bpm.setAttribute('aria-valuenow', String(rig.bpm));
    const used = rig.parts.reduce((s, p) => s + p.voices, 0);
    voices.textContent = `VOICES ${used} / ${RIG_VOICES}`;
    multi.textContent = `MULTI · ${rig.multiName.toUpperCase()}`;
    const on = pages.running();
    start.textContent = on ? 'AUDIO ON' : 'START AUDIO';
    start.classList.toggle('on', on);
  }
  rig.onPartChange(syncHeader);
  rig.onEdit(syncHeader);
  rig.seq.onChange(syncHeader);
  syncHeader();

  // 1, 2, 3 change page (not while typing)
  document.addEventListener('keydown', (e) => {
    if (e.defaultPrevented || e.metaKey || e.ctrlKey || e.altKey) return;
    const t = e.target as HTMLElement | null;
    if (t && (t.tagName === 'INPUT' || t.tagName === 'SELECT' || t.tagName === 'TEXTAREA' || t.isContentEditable)) return;
    const i = ['1', '2', '3'].indexOf(e.key);
    if (i >= 0) { e.preventDefault(); show(TABS[i]![0]); }
  });
  show(tab);
  return shell;
}

/**
 * The SYNTH page's lane: the edited part's track, sixteen steps a page. Click an empty step to fill it, a full one
 * to select it, the selected one to empty it, as on the SEQUENCER page.
 */
export function renderRigTrackStrip(rig: RigSynth, now: () => number): HTMLElement {
  const seq = rig.seq;
  const sec = el('section', 'rig-section rig-track-strip');
  sec.style.setProperty('--rig-accent', '#d6ef6a');
  const title = el('h3', 'rig-title');
  const cells = el('div', 'rig-seq-cells');
  let page = 0, lit = -1;
  const cellButtons = Array.from({ length: 16 }, (_, k) => {
    const b = button('rig-seq-cell', '');
    b.addEventListener('click', () => {
      const i = page * 16 + k;
      const t = seq.pattern.tracks[rig.part]!;
      if (i >= t.length) return;
      const s = t.steps[i]!;
      if (!s.notes.length) { s.notes = [rig.parts[rig.part]!.kind === 'kit' ? RIG_FIRST_PAD_NOTE : 60]; rig.selectStep(rig.part, i); }
      else if (rig.step === i) s.notes = [];
      else rig.selectStep(rig.part, i);
      seq.notify();
    });
    cells.append(b);
    return b;
  });
  const pages = [0, 1, 2, 3].map((p) => {
    const b = button('rig-small', `${p * 16 + 1}–${p * 16 + 16}`);
    b.addEventListener('click', () => { page = p; sync(); });
    return b;
  });
  const info = el('span', 'rig-seq-hint');
  const foot = el('div', 'rig-field');
  foot.append(...pages, info);
  sec.append(title, cells, foot);

  function sync(): void {
    const pt = rig.parts[rig.part]!, t = seq.pattern.tracks[rig.part]!;
    const kit = pt.kind === 'kit';
    title.textContent = `TRACK ${rig.part + 1} · ${(pt.name || 'PART').toUpperCase()}`;
    info.textContent = `${t.length} STEPS · ${RIG_CLOCKS.find((c) => c[1] === t.clock)?.[0] ?? ''} · ${t.direction.toUpperCase()} · PATTERN ${seq.current + 1}`;
    pages.forEach((b, p) => b.classList.toggle('on', p === page));
    cellButtons.forEach((c, k) => {
      const i = page * 16 + k, s = t.steps[i]!, beyond = i >= t.length;
      const name = (n: number) => (kit ? pt.kit?.pads[n - RIG_FIRST_PAD_NOTE]?.name ?? noteName(n) : noteName(n));
      c.textContent = beyond || !s.notes.length ? '' : kit ? s.notes.map(name).join(' ') : name(s.notes[0]!) + (s.notes.length > 1 ? `+${s.notes.length - 1}` : '');
      c.className = 'rig-seq-cell';
      c.classList.toggle('beat', k % 4 === 0);
      c.classList.toggle('beyond', beyond);
      c.classList.toggle('note', !beyond && s.notes.length > 0);
      c.classList.toggle('kitnote', kit);
      c.classList.toggle('locked', !beyond && Object.keys(s.locks).length > 0);
      c.classList.toggle('sel', i === rig.step);
    });
    sec.classList.toggle('kit', kit);
    lit = -1;
  }
  seq.onChange(sync);
  rig.onPartChange(sync);
  sync();
  const frame = () => {
    const step = seq.isPlaying ? seq.stepAt(rig.part, now()) : -1;
    const k = step >= page * 16 && step < page * 16 + 16 ? step - page * 16 : -1;
    if (k !== lit) {
      if (lit >= 0) cellButtons[lit]!.classList.remove('play');
      if (k >= 0) cellButtons[k]!.classList.add('play');
      lit = k;
    }
    requestAnimationFrame(frame);
  };
  requestAnimationFrame(frame);
  return sec;
}

/** The SYNTH page's detail column: a scope of the output, the edited part at a glance, and the patterns. */
export function renderRigDetail(rig: RigSynth, analyser: () => AnalyserNode | undefined): HTMLElement {
  const col = el('aside', 'rig-detail');
  const scopeBox = el('section', 'rig-section rig-scope');
  scopeBox.style.setProperty('--rig-accent', '#ecece6');
  const canvas = el('canvas');
  canvas.width = 480;
  canvas.height = 150;
  canvas.setAttribute('aria-label', 'Output scope');
  canvas.setAttribute('role', 'img');
  scopeBox.append(el('h3', 'rig-title', 'OUTPUT'), canvas);

  const facts = el('section', 'rig-section rig-facts');
  facts.style.setProperty('--rig-accent', '#ecece6');
  const factTitle = el('h3', 'rig-title');
  const list = el('dl', 'rig-kv');
  facts.append(factTitle, list);

  const pats = el('section', 'rig-section rig-patterns');
  pats.style.setProperty('--rig-accent', '#d6ef6a');
  const patTitle = el('h3', 'rig-title');
  const pads = el('div', 'rig-pattern-pads');
  const padButtons = Array.from({ length: RIG_PATTERNS }, (_, i) => {
    const b = button('rig-seq-pad', String(i + 1), `Pattern ${i + 1}`);
    b.title = 'Click: play next. Shift-click: add to or take out of the chain.';
    b.addEventListener('click', (e) => {
      if (e.shiftKey) {
        const at = rig.seq.chain.indexOf(i);
        rig.seq.setChain(at >= 0 ? rig.seq.chain.filter((_, k) => k !== at) : [...rig.seq.chain, i]);
      } else rig.seq.queue(i);
    });
    pads.append(b);
    return b;
  });
  const play = button('rig-key rig-wide rig-seq-play', 'PLAY');
  play.addEventListener('click', () => (rig.seq.isPlaying ? rig.stop() : rig.play()));
  const rec = button('rig-key rig-wide rig-seq-rec', 'REC');
  rec.addEventListener('click', () => rig.setRecording(!rig.isRecording));
  const transport = el('div', 'rig-field');
  transport.append(play, rec);
  pats.append(patTitle, pads, transport);
  col.append(scopeBox, facts, pats);

  const kv = (k: string, v: string) => [el('dt', '', k), el('dd', '', v)];
  function sync(): void {
    const p = rig.part, pt = rig.parts[p]!;
    factTitle.textContent = `PART ${p + 1} · ${(pt.name || 'PART').toUpperCase()}${pt.kind === 'synth' ? ` · ${rig.side.toUpperCase()}` : ''}`;
    const side = pt[rig.side];
    const val = (id: string, unit = '', digits = 0) => `${(side.params[id] ?? RIG_DEFAULTS[id] ?? 0).toFixed(digits)}${unit}`;
    const rows = pt.kind === 'kit'
      ? [kv('TYPE', 'KIT'), kv('KIT', pt.kit?.name ?? '—'), kv('PADS', String(pt.kit?.pads.filter((x) => x.src === 'sample').length ?? 0) + ' SAMPLE · ' + String(pt.kit?.pads.filter((x) => x.src === 'analog').length ?? 0) + ' ANALOGUE')]
      : [kv('VOICES', `${pt.voices} OF ${RIG_VOICES}`), kv('LADDER', val('lad.cutoff', ' Hz')), kv('SEM', val('sem.cutoff', ' Hz')),
        kv('ROUTINGS', String(side.matrix.length)), kv('MORPH', val('out.morph', '', 2))];
    list.replaceChildren(...rows.flat(), ...kv('CHANNEL', pt.channel ? String(pt.channel) : 'ALL'), ...kv('RANGE', `${noteName(pt.lo)}–${noteName(pt.hi)}`));
    patTitle.textContent = `PATTERNS${rig.seq.chain.length ? ` · CHAIN ${rig.seq.chain.map((i) => i + 1).join(' → ')}` : ''}`;
    padButtons.forEach((b, i) => {
      b.classList.toggle('now', i === rig.seq.current);
      b.classList.toggle('next', i === rig.seq.next);
      b.classList.toggle('chained', rig.seq.chain.includes(i));
      b.classList.toggle('used', rig.seq.patterns[i]!.tracks.some((t) => t.steps.some((s) => s.notes.length)));
    });
    play.textContent = rig.seq.isPlaying ? 'STOP' : 'PLAY';
    play.classList.toggle('on', rig.seq.isPlaying);
    rec.classList.toggle('on', rig.isRecording);
  }
  rig.onPartChange(sync);
  rig.onEdit(sync);
  rig.seq.onChange(sync);
  sync();

  // the scope: the output's last few milliseconds, steadied on a rising zero crossing
  const g = canvas.getContext('2d');
  let buf: Float32Array<ArrayBuffer> | undefined;
  const frame = () => {
    const an = analyser();
    if (g && an && !scopeBox.closest('[hidden]')) {
      if (!buf || buf.length !== an.fftSize) buf = new Float32Array(an.fftSize);
      an.getFloatTimeDomainData(buf);
      let from = 0;
      for (let i = 1; i < buf.length / 2; i++) if (buf[i - 1]! <= 0 && buf[i]! > 0) { from = i; break; }
      const W = canvas.width, H = canvas.height, span = Math.min(buf.length - from, 960);
      g.clearRect(0, 0, W, H);
      g.strokeStyle = 'rgba(255,255,255,0.12)';
      g.beginPath(); g.moveTo(0, H / 2); g.lineTo(W, H / 2); g.stroke();
      g.strokeStyle = '#ffb27a';
      g.lineWidth = 2;
      g.beginPath();
      for (let x = 0; x < W; x++) {
        const y = H / 2 - buf[from + Math.floor((x / W) * span)]! * H * 0.45;
        if (x) g.lineTo(x, y); else g.moveTo(x, y);
      }
      g.stroke();
    }
    requestAnimationFrame(frame);
  };
  requestAnimationFrame(frame);
  return col;
}


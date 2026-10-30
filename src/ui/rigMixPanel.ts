import type { RigMeters } from '../audio/engine';
import type { Control, NumberControl, ToggleControl } from '../domain/devices/controls';
import { RIG_MIX_PARTS, RIG_RETURN_NAMES, RIG_RETURNS } from '../domain/devices/rigMix';
import type { RigSynth } from '../domain/devices/rigSynth';
import { renderChoice, renderToggle } from './rigPanel';
import { el, renderKnob } from './widgets';

/**
 * The MOA-RIG's mixer, plain for now (the MIXER · FX page's design replaces it): eight part strips at a time, the
 * four returns and the master always in view, then the effects, the drive insert and the compressor.
 */
const BANK = 8;
const LIME = '#d6ef6a', PINK = '#ffa3c7', BLUE = '#8fc3ff', WHITE = '#ecece6';
/** Fader travel: the bottom is silence, then -60 dB up to +6 dB at the top (0 dB at 91%). */
const FADER_STEPS = 1000;
const toGain = (pos: number) => (pos <= 0 ? 0 : 10 ** ((-60 + 66 * pos) / 20));
const toPos = (gain: number) => (gain <= 0.001 ? 0 : Math.min(1, Math.max(0, (20 * Math.log10(gain) + 60) / 66)));
const dbText = (gain: number) => (gain <= 0.001 ? '−∞' : `${(20 * Math.log10(gain)).toFixed(1)}`.replace('-', '−'));
/** A meter's height for a peak: -60 dB to 0 dB. */
const meterPos = (peak: number) => (peak <= 0.001 ? 0 : Math.min(1, Math.max(0, (20 * Math.log10(peak) + 60) / 60)));

function renderControl(c: Control, section: string, label?: string, size = 26): HTMLElement {
  if (c.kind === 'number') return renderKnob(c, section, (label ?? c.label).toUpperCase(), size);
  if (c.kind === 'choice') return renderChoice(c, section);
  if (c.kind === 'toggle') return renderToggle(c, section);
  return el('span');
}

/** A key that is on only while held (THROW). */
function momentary(c: ToggleControl, label: string, section: string): HTMLElement {
  const b = el('button', 'rig-key rig-wide rig-throw', label);
  b.type = 'button';
  b.setAttribute('aria-label', `${section} ${c.label}`);
  const set = (on: boolean) => { c.set(on); b.classList.toggle('on', on); };
  b.addEventListener('pointerdown', (e) => { e.preventDefault(); set(true); });
  for (const ev of ['pointerup', 'pointerleave', 'pointercancel'] as const) b.addEventListener(ev, () => { if (c.value) set(false); });
  b.addEventListener('keydown', (e) => { if ((e.key === 'Enter' || e.key === ' ') && !e.repeat) { e.preventDefault(); e.stopPropagation(); set(true); } });
  b.addEventListener('keyup', (e) => { if (e.key === 'Enter' || e.key === ' ') set(false); });
  return b;
}

function renderFader(c: NumberControl, section: string): { node: HTMLElement; meters: [HTMLElement, HTMLElement] } {
  const wrap = el('div', 'rig-fader');
  const input = el('input', 'rig-fader-input');
  input.type = 'range';
  input.min = '0';
  input.max = String(FADER_STEPS);
  input.setAttribute('aria-label', `${section} fader`);
  const readout = el('output', 'rig-readout rig-fader-db');
  const sync = () => {
    input.value = String(Math.round(toPos(c.value) * FADER_STEPS));
    readout.textContent = dbText(c.value);
    input.setAttribute('aria-valuetext', `${dbText(c.value)} dB`);
  };
  input.addEventListener('input', () => { c.set(toGain(Number(input.value) / FADER_STEPS)); sync(); });
  input.addEventListener('dblclick', () => { c.set(1); sync(); }); // back to 0 dB
  c.onChange(sync);
  sync();
  const mL = el('div', 'rig-meter'), mR = el('div', 'rig-meter');
  const travel = el('div', 'rig-fader-travel');
  travel.append(input, mL, mR);
  wrap.append(travel, readout);
  return { node: wrap, meters: [mL, mR] };
}

export function renderRigMixPanel(rig: RigSynth, meters: () => RigMeters | undefined): HTMLElement {
  const panel = el('div', 'rig-panel rig-mix');
  const d = (id: string) => rig.deskControl(id);
  let bank = 0;

  const bar = el('div', 'rig-setup rig-mix-bar');
  const bankButtons = [0, 1].map((b) => {
    const btn = el('button', 'rig-small rig-wide', `PARTS ${b * BANK + 1}–${(b + 1) * BANK}`);
    btn.type = 'button';
    btn.addEventListener('click', () => { bank = b; sync(); });
    return btn;
  });
  bar.append(el('span', 'knob-label', 'Mixer'), ...bankButtons,
    el('span', 'rig-seq-hint', 'Each return is a full strip: an echo can be EQ’d, filtered, thrown into the reverb or back into itself. Double-click a fader for 0 dB.'));

  // ---- strips: the parts (eight at a time), the returns, the master
  const desk = el('div', 'rig-mix-desk');
  const meterEls: [HTMLElement, HTMLElement][] = [];
  const strip = (id: string, accent: string, isReturn: boolean) => {
    const sec = el('section', 'rig-section rig-strip');
    sec.style.setProperty('--rig-accent', accent);
    const title = el('h3', 'rig-title');
    const sub = el('div', 'rig-strip-sub');
    const row = (...nodes: HTMLElement[]) => { const r = el('div', 'rig-strip-row'); r.append(...nodes); return r; };
    const name = isReturn ? `Return ${id.slice(1)}` : `Part ${id.slice(1)}`;
    const k = (p: string, label: string, size = 22) => renderKnob(d(`${id}.${p}`) as NumberControl, name, label, size);
    const fader = renderFader(d(`${id}.fader`) as NumberControl, name);
    meterEls.push(fader.meters);
    sec.append(title, sub,
      row(k('hi', 'HI'), k('mid', 'MID'), k('lo', 'LO')),
      row(k('filter', 'FILTER', 26), k('pan', 'PAN')),
      el('div', 'rig-strip-label', isReturn ? 'SENDS (ITSELF TOO)' : 'SENDS'),
      row(k('a', 'A'), k('b', 'B')), row(k('c', 'C'), k('d', 'D')),
      row(renderToggle(d(`${id}.mute`) as ToggleControl, name), renderToggle(d(`${id}.solo`) as ToggleControl, name)),
      momentary(d(`${id}.throw`) as ToggleControl, 'THROW A', name),
      fader.node);
    desk.append(sec);
    return { sec, title, sub };
  };
  const parts = Array.from({ length: RIG_MIX_PARTS }, (_, p) => strip(`p${p + 1}`, LIME, false));
  const returns = RIG_RETURNS.map((r, i) => {
    const s = strip(`r${r}`, BLUE, true);
    s.sec.classList.add('rig-return');
    s.title.textContent = `RTN ${r}`;
    s.sub.textContent = RIG_RETURN_NAMES[i]!;
    return s;
  });
  const master = el('section', 'rig-section rig-strip rig-master');
  master.style.setProperty('--rig-accent', WHITE);
  const peak = el('output', 'rig-readout');
  const masterFader = renderFader(d('master.fader') as NumberControl, 'Master');
  meterEls.push(masterFader.meters);
  const peakField = el('div', 'rig-field');
  peakField.append(el('span', 'knob-label', 'PEAK'), peak);
  master.append(el('h3', 'rig-title', 'MASTER'), el('div', 'rig-strip-sub', 'OUT'),
    renderToggle(d('master.limit') as ToggleControl, 'Master'), peakField, masterFader.node);
  desk.append(master);

  // ---- the effects, the drive insert and the compressor
  const fxRow = el('div', 'rig-mix-fx');
  const module = (title: string, sub: string, accent: string, ids: string[], extra: HTMLElement[] = []) => {
    const sec = el('section', 'rig-section');
    sec.style.setProperty('--rig-accent', accent);
    const body = el('div', 'rig-controls');
    body.append(...ids.map((id) => renderControl(d(id), title)), ...extra);
    sec.append(el('h3', 'rig-title', title), el('div', 'rig-strip-sub', sub), body);
    fxRow.append(sec);
    return sec;
  };
  module('DUB DELAY', 'SEND A · TAPE ECHO', BLUE, ['dub.time', 'dub.fdbk', 'dub.tone', 'dub.wow', 'dub.sat', 'dub.sync', 'dub.div'],
    [momentary(d('dub.throw') as ToggleControl, 'THROW', 'Dub delay')]);
  module('BBD DELAY', 'SEND B · BUCKET BRIGADE', BLUE, ['bbd.time', 'bbd.fdbk', 'bbd.mod', 'bbd.rate', 'bbd.age', 'bbd.sync', 'bbd.div', 'bbd.ping']);
  module('REVERB', 'SEND C', BLUE, ['rev.size', 'rev.damp', 'rev.pre', 'rev.tone', 'rev.shimmer', 'rev.type', 'rev.freeze']);
  module('CHORUS', 'SEND D · STEREO', BLUE, ['cho.rate', 'cho.depth', 'cho.width', 'cho.mode']);
  module('DRIVE', 'INSERT ON ONE PART', '#ff8466', ['drv.part', 'drv.drive', 'drv.tone', 'drv.blend', 'drv.level', 'drv.type']);
  const gr = el('output', 'rig-readout');
  const grField = el('div', 'rig-field');
  grField.append(el('span', 'knob-label', 'GR'), gr);
  module('COMPRESSOR', 'MASTER · SIDECHAIN', WHITE, ['cmp.thresh', 'cmp.ratio', 'cmp.atk', 'cmp.rel', 'cmp.makeup', 'cmp.mix', 'cmp.key', 'cmp.hpf'], [grField]);

  function sync(): void {
    bankButtons.forEach((b, i) => b.classList.toggle('on', i === bank));
    parts.forEach((s, p) => {
      const pt = rig.parts[p]!;
      s.sec.hidden = Math.floor(p / BANK) !== bank;
      s.sec.style.setProperty('--rig-accent', pt.kind === 'kit' ? PINK : LIME);
      s.title.textContent = `P${p + 1}`;
      s.sub.textContent = pt.voices > 0 || pt.kind === 'kit' ? (pt.name || 'PART').toUpperCase() : 'EMPTY';
    });
  }
  rig.onPartChange(sync);
  sync();

  // ---- meters, from the worklet about 30 times a second
  const frame = () => {
    const m = meters();
    if (m) {
      const NS = RIG_MIX_PARTS + RIG_RETURNS.length;
      for (let s = 0; s < NS; s++) {
        const [l, r] = meterEls[s]!;
        l.style.setProperty('--level', String(meterPos(m.strips[s * 2]!)));
        r.style.setProperty('--level', String(meterPos(m.strips[s * 2 + 1]!)));
      }
      const [l, r] = meterEls[NS]!;
      l.style.setProperty('--level', String(meterPos(m.master[0]!)));
      r.style.setProperty('--level', String(meterPos(m.master[1]!)));
      const pk = Math.max(m.master[0]!, m.master[1]!);
      peak.textContent = pk > 0.001 ? `${(20 * Math.log10(pk)).toFixed(1)} dB`.replace('-', '−') : '—';
      gr.textContent = `${m.gr.toFixed(1)} dB`.replace('-', '−');
    }
    requestAnimationFrame(frame);
  };
  requestAnimationFrame(frame);

  panel.append(bar, desk, fxRow);
  return panel;
}

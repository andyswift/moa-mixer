import type { AudioEngine } from '../audio/engine';
import { VOICE_SOURCE } from '../audio/voiceWorklet';
import { noteOf } from '../domain/devices/bassPhysics';
import type { NumberControl } from '../domain/devices/controls';
import { VOWELS, type VoxSinger, type VoxView } from '../domain/devices/voxSinger';
import { BLUE, GREEN, ORANGE, PINK, renderSection } from './synthPanel';
import { el } from './widgets';

interface PreviewCore {
  setLength(cm: number): void;
  setShape(s: object, jump: boolean): void;
  view(): VoxView;
}
/** The worklet's own model, run here only to draw the tract before the audio starts (the same shapes it will make). */
const { VoiceCore } = new Function(`${VOICE_SOURCE}; return { VoiceCore };`)() as { VoiceCore: new (sr: number, cm: number) => PreviewCore };

/**
 * The MOA-VOX panel: the vocal tract drawn as it moves (glottis to lips, the nose above, the velum between), the
 * pitch and the vowel being sung, buttons for the five vowels, and the controls.
 */
export function renderVoxPanel(v: VoxSinger, engine: AudioEngine): HTMLElement {
  const panel = el('div', 'synth-panel vox-panel');
  const header = el('div', 'synth-header');
  const brand = el('div', 'synth-brand');
  brand.append(el('div', 'synth-name', 'MOA-VOX'), el('div', 'synth-subtitle', 'A physically modelled singing voice'));
  header.append(brand);

  // ---- the tract
  const stage = el('div', 'vox-stage');
  const canvas = document.createElement('canvas');
  canvas.className = 'vox-canvas';
  canvas.setAttribute('role', 'img');
  canvas.setAttribute('aria-label', 'The vocal tract from the glottis to the lips, with the nose above, moving as the voice sings');
  const readouts = el('div', 'vox-readouts');
  const read = (label: string) => {
    const box = el('div', 'vox-read');
    const value = el('div', 'vox-read-value', '–');
    box.append(el('div', 'vox-read-label', label), value);
    readouts.append(box);
    return value;
  };
  const noteRead = read('Note'), hzRead = read('Pitch'), vowelRead = read('Vowel');
  stage.append(canvas, readouts);

  // ---- the vowels: a button each, lit for the one the knob is nearest
  const vowelControl = v.control('vowel') as NumberControl;
  const vowels = el('div', 'vox-vowels');
  const buttons = VOWELS.map((vowel, k) => {
    const b = el('button', 'vox-vowel', vowel.name);
    b.type = 'button';
    b.setAttribute('aria-label', `Sing ${vowel.name}`);
    b.addEventListener('click', () => vowelControl.set(k));
    vowels.append(b);
    return b;
  });

  const voice = renderSection(v, { title: 'Vowel', color: PINK, grow: 3, faders: ['vowel', 'nasal', { id: 'size', label: 'Tract' }] });
  const source = renderSection(v, { title: 'Folds', color: ORANGE, grow: 3, faders: ['tension', 'breath', 'level'] });
  const vibrato = renderSection(v, { title: 'Vibrato', color: BLUE, grow: 3, faders: [{ id: 'vibrato.depth', label: 'Depth' }, { id: 'vibrato.rate', label: 'Rate' }, { id: 'vibrato.delay', label: 'Delay' }] });
  const envelope = renderSection(v, { title: 'Phrasing', color: GREEN, grow: 3, faders: ['glide', 'attack', 'release'] });
  const row = el('div', 'synth-row');
  row.append(voice, source, vibrato, envelope);
  panel.append(header, stage, vowels, row);

  // ---- drawing, every frame: the live voice once the audio runs, before then the shape the knobs ask for
  const preview = new VoiceCore(48000, 17);
  const draw = () => {
    const live = engine.readVoice('vox', 'voice');
    let view = live;
    if (!view) {
      preview.setLength(v.control('size').value as number);
      preview.setShape(v.shape, true);
      view = preview.view();
    }
    paint(canvas, view);
    const k = vowelControl.value;
    buttons.forEach((b, i) => b.classList.toggle('on', Math.round(k) === i));
    const a = VOWELS[Math.floor(k)]!, b = VOWELS[Math.min(VOWELS.length - 1, Math.floor(k) + 1)]!, f = k - Math.floor(k);
    vowelRead.textContent = f < 0.05 ? a.name : f > 0.95 ? b.name : `${a.name}→${b.name}`;
    if (live && live.amp > 0.01) {
      noteRead.textContent = noteOf(live.hz).name;
      hzRead.textContent = `${live.hz.toFixed(1)} Hz`;
    } else {
      noteRead.textContent = '–';
      hzRead.textContent = '–';
    }
    requestAnimationFrame(draw);
  };
  requestAnimationFrame(draw);
  return panel;
}

/**
 * The tract side on: a tube from the glottis (left) to the lips (right), each section as wide as its diameter, the
 * mouth filled the brighter the louder the voice; the nose branching up at the velum, drawn as open as the velum is.
 */
function paint(canvas: HTMLCanvasElement, view: VoxView): void {
  const dpr = window.devicePixelRatio || 1;
  const w = canvas.clientWidth, h = canvas.clientHeight;
  if (canvas.width !== Math.round(w * dpr) || canvas.height !== Math.round(h * dpr)) {
    canvas.width = Math.round(w * dpr);
    canvas.height = Math.round(h * dpr);
  }
  const g = canvas.getContext('2d');
  if (!g) return;
  g.setTransform(dpr, 0, 0, dpr, 0, 0);
  g.clearRect(0, 0, w, h);
  const d = view.diameters, n = d.length;
  const left = 40, right = w - 30, mid = h * 0.62, scale = (h * 0.38) / 3.6;
  const x = (i: number) => left + ((right - left) * i) / n;
  // the tube
  g.beginPath();
  g.moveTo(x(0), mid - (d[0]! * scale) / 2);
  for (let i = 0; i < n; i++) g.lineTo(x(i + 0.5), mid - (d[i]! * scale) / 2);
  g.lineTo(x(n), mid - (d[n - 1]! * scale) / 2);
  g.lineTo(x(n), mid + (d[n - 1]! * scale) / 2);
  for (let i = n - 1; i >= 0; i--) g.lineTo(x(i + 0.5), mid + (d[i]! * scale) / 2);
  g.lineTo(x(0), mid + (d[0]! * scale) / 2);
  g.closePath();
  g.fillStyle = `rgba(217, 98, 138, ${(0.25 + 0.6 * Math.min(1, view.amp)).toFixed(3)})`;
  g.fill();
  g.strokeStyle = '#d9628a';
  g.lineWidth = 2;
  g.stroke();
  // the nose, from the velum up and forward, its join as open as the velum
  const vx = x(view.noseStart), top = mid - (d[view.noseStart]! * scale) / 2;
  const open = Math.max(1, view.velum * 30);
  g.strokeStyle = '#7f848b';
  g.lineWidth = 1.5;
  g.beginPath();
  g.moveTo(vx - open, top);
  g.bezierCurveTo(vx - open, top - h * 0.3, right - 60, top - h * 0.38, right - 10, top - h * 0.28);
  g.moveTo(vx + open, top);
  g.bezierCurveTo(vx + open, top - h * 0.2, right - 70, top - h * 0.28, right - 10, top - h * 0.2);
  g.stroke();
  // the glottis: a pulse that grows with the voice
  g.fillStyle = '#ffd25e';
  g.beginPath();
  g.ellipse(left - 14, mid, 4 + 8 * Math.min(1, view.amp), 4 + 8 * Math.min(1, view.amp), 0, 0, Math.PI * 2);
  g.fill();
  // labels
  g.fillStyle = '#7f848b';
  g.font = '600 12px "Barlow Condensed", system-ui, sans-serif';
  g.fillText('GLOTTIS', left - 26, mid + 30);
  g.fillText('LIPS', x(view.lipStart) + 4, mid + 36);
  g.fillText('NOSE', right - 50, top - h * 0.36);
}

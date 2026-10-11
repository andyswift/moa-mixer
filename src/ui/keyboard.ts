import type { Synthesizer } from '../domain/devices/synthesizer';

// Home-row piano: a w s e d f t g y h u j k  => C4..C5
const KEYS = ['a', 'w', 's', 'e', 'd', 'f', 't', 'g', 'y', 'h', 'u', 'j', 'k'];
const NAMES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B', 'C'];
const midiToHz = (m: number) => 440 * Math.pow(2, (m - 69) / 12);

export function mountKeyboard(synth: Synthesizer): HTMLElement {
  const el = document.createElement('div');
  el.className = 'keys';
  const held: string[] = [];
  const keyEls = new Map<string, HTMLElement>();

  const press = (k: string) => {
    const i = KEYS.indexOf(k);
    if (i < 0 || held.includes(k)) return;
    held.push(k);
    synth.noteOn(midiToHz(60 + i));
    keyEls.get(k)?.classList.add('active');
  };
  const release = (k: string) => {
    const idx = held.indexOf(k);
    if (idx < 0) return;
    held.splice(idx, 1);
    keyEls.get(k)?.classList.remove('active');
    const last = held[held.length - 1];
    if (last) synth.noteOn(midiToHz(60 + KEYS.indexOf(last)));
    else synth.noteOff();
  };

  KEYS.forEach((k, i) => {
    const key = document.createElement('div');
    key.className = 'key' + (NAMES[i]!.includes('#') ? ' black' : '');
    key.textContent = `${NAMES[i]} (${k})`;
    key.addEventListener('pointerdown', () => press(k));
    key.addEventListener('pointerup', () => release(k));
    key.addEventListener('pointerleave', () => release(k));
    keyEls.set(k, key);
    el.append(key);
  });

  window.addEventListener('keydown', (e) => {
    if (e.repeat || e.metaKey || e.ctrlKey || e.target instanceof HTMLSelectElement) return;
    press(e.key.toLowerCase());
  });
  window.addEventListener('keyup', (e) => release(e.key.toLowerCase()));
  return el;
}

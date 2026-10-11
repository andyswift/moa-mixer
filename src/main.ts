import './ui/style.css';
import { AudioEngine } from './audio/engine';
import type { Synthesizer } from './domain/devices/synthesizer';
import { Patch } from './domain/patch/patch';
import { mountKeyboard } from './ui/keyboard';
import type { Mixer } from './domain/devices/mixer';
import { renderMixerPanel } from './ui/mixerPanel';
import { renderSynthPanel } from './ui/synthPanel';

const patch = Patch.default();
const engine = new AudioEngine(patch);
const app = document.querySelector<HTMLDivElement>('#app')!;

const start = document.createElement('button');
start.className = 'start';
start.textContent = 'Start audio';
start.addEventListener('click', async () => {
  await engine.start();
  start.textContent = 'Audio running';
  start.disabled = true;
});

const synth = patch.device<Synthesizer>('synth');
app.append(renderSynthPanel(synth, start));

const hint = document.createElement('p');
hint.className = 'hint';
hint.textContent = 'Play with the keys a w s e d f t g y h u j k, or click the keyboard. Double-click a fader to reset it.';
app.append(hint, mountKeyboard(synth));

app.append(renderMixerPanel(patch.device<Mixer>('mixer'), 'mixer', engine, ['Synth']));

// Dev-only handle for poking at the engine from the browser console.
if (import.meta.env.DEV) Object.assign(window, { __mixer: { engine, patch } });

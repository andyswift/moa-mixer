import './ui/style.css';
import { AudioEngine } from './audio/engine';
import type { Synthesizer } from './domain/devices/synthesizer';
import { Patch } from './domain/patch/patch';
import { renderDevice } from './ui/controls';
import { mountKeyboard } from './ui/keyboard';

const patch = Patch.default();
const engine = new AudioEngine(patch);
const app = document.querySelector<HTMLDivElement>('#app')!;

const title = document.createElement('h1');
title.textContent = 'Mixer';
const start = document.createElement('button');
start.textContent = 'Start audio';
start.addEventListener('click', async () => {
  await engine.start();
  start.textContent = 'Audio running';
  start.disabled = true;
});
const hint = document.createElement('p');
hint.className = 'hint';
hint.textContent = 'Play with the keys a w s e d f t g y h u j k, or click the keyboard.';

app.append(title, start, hint);
for (const device of patch.devices.values()) app.append(renderDevice(device));
app.append(mountKeyboard(patch.device<Synthesizer>('synth')));

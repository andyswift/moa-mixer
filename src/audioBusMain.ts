import { PcmBus } from './audio/pcmBus';

// Proof-of-concept page for the audio bus: open it in two tabs. One sends a test tone (or clicks), the other picks the
// port and shows what arrives.
// Not part of the product; it exists to prove and measure the transport.
const pcm = new PcmBus();
const app = document.querySelector<HTMLDivElement>('#app')!;
app.style.cssText = 'font: 14px/1.5 ui-monospace, monospace; padding: 16px; max-width: 560px';
app.innerHTML = `
  <h1 style="font-size:18px">MOA audio bus test</h1>
  <fieldset><legend>Send</legend>
    <button id="send">Start sending a tone</button>
    <button id="click" disabled>Send one click</button>
  </fieldset>
  <fieldset><legend>Receive</legend>
    <select id="ports"></select>
    <button id="recv">Receive</button>
    <div>state: <b id="state">idle</b></div>
    <div>level: <b id="level">0.000</b> <meter id="meter" min="0" max="1" value="0"></meter></div>
    <div>buffer: <b id="buffer">-</b></div>
    <div>last click latency: <b id="latency">-</b></div>
  </fieldset>
`;
const $ = <T extends HTMLElement>(id: string) => app.querySelector<T>('#' + id)!;

let ctx: AudioContext | undefined;
let clickGain: GainNode | undefined;
let osc: OscillatorNode | undefined;
let stopPublish: (() => void) | undefined;

$('send').addEventListener('click', async () => {
  if (stopPublish) {
    stopPublish();
    stopPublish = undefined;
    osc?.stop();
    $('send').textContent = 'Start sending a tone';
    $<HTMLButtonElement>('click').disabled = true;
    return;
  }
  ctx ??= new AudioContext({ latencyHint: 'interactive' });
  await ctx.resume();
  osc = ctx.createOscillator();
  osc.frequency.value = 220;
  const tone = ctx.createGain();
  tone.gain.value = 0.2;
  clickGain = ctx.createGain();
  osc.connect(tone);
  tone.connect(clickGain);
  osc.start();
  stopPublish = await pcm.publish(ctx, clickGain, 'Test tone');
  $('send').textContent = 'Stop sending';
  $<HTMLButtonElement>('click').disabled = false;
});

// A click is a 5 ms burst; the sender wall-clocks it (localStorage is shared by the tabs) so the receiver can time it.
$('click').addEventListener('click', () => {
  if (!ctx || !clickGain) return;
  const click = ctx.createBufferSource();
  const buf = ctx.createBuffer(1, 240, ctx.sampleRate);
  buf.getChannelData(0).fill(0.9);
  click.buffer = buf;
  click.connect(clickGain);
  click.start();
  localStorage.setItem('moa.audioBus.clickAt', String(performance.timeOrigin + performance.now()));
});

const select = $<HTMLSelectElement>('ports');
const paintPorts = () => {
  const keep = select.value;
  select.replaceChildren(...pcm.ports.map((p) => new Option(`${p.name} (${p.id})`, p.id)));
  if (keep) select.value = keep;
};
pcm.onChange(paintPorts);
paintPorts();

interface Active {
  node: AudioNode;
  state: () => string;
  buffer: () => string;
  close: () => void;
}
let active: Active | undefined;
let analyser: AnalyserNode | undefined;
let rctx: AudioContext | undefined;
const buffer = new Float32Array(256);
let lastLevel = 0;
let armed = true;
const latencies: number[] = [];

$('recv').addEventListener('click', async () => {
  if (active) {
    active.close();
    active = undefined;
    $('state').textContent = 'idle';
    $('recv').textContent = 'Receive';
    return;
  }
  if (!select.value) return;
  rctx ??= new AudioContext({ latencyHint: 'interactive' });
  await rctx.resume();
  $('state').textContent = 'connecting';
  try {
    const r = await pcm.subscribe(rctx, select.value);
    active = {
      node: r.node,
      state: () => 'playing',
      buffer: () => `${r.stats().fill.toFixed(0)} ms, ${r.stats().underruns} underruns, ${r.stats().drops} drops`,
      close: () => r.close(),
    };
  } catch (e) {
    $('state').textContent = String(e);
    return;
  }
  analyser = rctx.createAnalyser();
  analyser.fftSize = 256;
  active.node.connect(analyser);
  analyser.connect(rctx.destination);
  $('recv').textContent = 'Stop receiving';
});

const poll = () => {
  if (!analyser || !active) return;
  analyser.getFloatTimeDomainData(buffer);
  let peak = 0;
  for (const v of buffer) peak = Math.max(peak, Math.abs(v));
  lastLevel = peak;
  $('level').textContent = peak.toFixed(3);
  $<HTMLMeterElement>('meter').value = peak;
  $('state').textContent = active.state();
  $('buffer').textContent = active.buffer();
  // A click is a peak above 0.5 after the level has been low.
  if (peak > 0.5 && armed) {
    armed = false;
    const sent = Number(localStorage.getItem('moa.audioBus.clickAt') ?? 0);
    if (sent) {
      const ms = performance.timeOrigin + performance.now() - sent;
      latencies.push(ms);
      $('latency').textContent = `${ms.toFixed(0)} ms`;
    }
  } else if (peak < 0.3) armed = true;
};
setInterval(poll, 2);

Object.assign(window, { __ab: { pcm, level: () => lastLevel, state: () => active?.state(), latencies } });

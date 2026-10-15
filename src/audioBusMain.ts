import { AudioBus } from './audio/bus';
import { publishNode, receiveInto, type Received } from './audio/busAudio';

// Proof-of-concept page for the audio bus: open it in two tabs. One sends a test tone (or clicks), the other picks the
// port and shows what arrives. Not part of the product; it exists to prove and measure the transport.
const bus = new AudioBus();
const app = document.querySelector<HTMLDivElement>('#app')!;
app.style.cssText = 'font: 14px/1.5 ui-monospace, monospace; padding: 16px; max-width: 520px';
app.innerHTML = `
  <h1 style="font-size:18px">MOA audio bus test</h1>
  <p id="support"></p>
  <fieldset><legend>Send</legend>
    <button id="send">Start sending a tone</button>
    <button id="click" disabled>Send one click</button>
  </fieldset>
  <fieldset><legend>Receive</legend>
    <select id="ports"></select>
    <button id="recv">Receive</button>
    <div>state: <b id="state">idle</b></div>
    <div>level: <b id="level">0.000</b> <meter id="meter" min="0" max="1" value="0"></meter></div>
    <div>last click latency: <b id="latency">-</b></div>
  </fieldset>`;
const $ = <T extends HTMLElement>(id: string) => app.querySelector<T>('#' + id)!;
$('support').textContent = bus.supported ? 'WebRTC + BroadcastChannel available.' : 'Not supported in this browser.';

let ctx: AudioContext | undefined;
let osc: OscillatorNode | undefined;
let clickGain: GainNode | undefined;
let stopPublish: (() => void) | undefined;
let sendClickAt = 0;

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
  clickGain.gain.value = 0;
  osc.connect(tone);
  tone.connect(clickGain);
  osc.start();
  stopPublish = publishNode(bus, ctx, clickGain, 'Test tone');
  clickGain.gain.value = 1;
  $('send').textContent = 'Stop sending';
  $<HTMLButtonElement>('click').disabled = false;
});

// A click is a 5 ms burst; the sender wall-clocks it so the receiver can estimate the one-way latency.
$('click').addEventListener('click', () => {
  if (!ctx || !clickGain) return;
  const click = ctx.createBufferSource();
  const buf = ctx.createBuffer(1, 240, ctx.sampleRate);
  buf.getChannelData(0).fill(0.9);
  click.buffer = buf;
  click.connect(clickGain);
  click.start();
  sendClickAt = performance.timeOrigin + performance.now();
  localStorage.setItem('moa.audioBus.clickAt', String(sendClickAt));
});

const select = $<HTMLSelectElement>('ports');
const paintPorts = () => {
  const keep = select.value;
  select.replaceChildren(...bus.ports.map((p) => new Option(p.name + ' (' + p.id + ')', p.id)));
  if (keep) select.value = keep;
};
bus.onChange(paintPorts);
paintPorts();

let received: Received | undefined;
let analyser: AnalyserNode | undefined;
let rctx: AudioContext | undefined;
const buffer = new Float32Array(256);
let lastLevel = 0;
let armed = true;

$('recv').addEventListener('click', async () => {
  if (received) {
    received.close();
    received = undefined;
    $('state').textContent = 'idle';
    $('recv').textContent = 'Receive';
    return;
  }
  if (!select.value) return;
  rctx ??= new AudioContext({ latencyHint: 'interactive' });
  await rctx.resume();
  $('state').textContent = 'connecting';
  try {
    received = await receiveInto(bus, rctx, select.value);
  } catch (e) {
    $('state').textContent = String(e);
    return;
  }
  analyser = rctx.createAnalyser();
  analyser.fftSize = 256;
  received.node.connect(analyser);
  analyser.connect(rctx.destination);
  $('recv').textContent = 'Stop receiving';
});

const latencies: number[] = [];
const poll = () => {
  if (analyser && received) {
    analyser.getFloatTimeDomainData(buffer);
    let peak = 0;
    for (const v of buffer) peak = Math.max(peak, Math.abs(v));
    lastLevel = peak;
    $('level').textContent = peak.toFixed(3);
    $<HTMLMeterElement>('meter').value = peak;
    $('state').textContent = received.subscription.state();
    // Click detection: a peak above 0.5 when the level was low just before.
    if (peak > 0.5 && armed) {
      armed = false;
      const sent = Number(localStorage.getItem('moa.audioBus.clickAt') ?? 0);
      if (sent) {
        const ms = performance.timeOrigin + performance.now() - sent;
        latencies.push(ms);
        $('latency').textContent = ms.toFixed(0) + ' ms';
      }
    } else if (peak < 0.3) armed = true;
  }
};
setInterval(poll, 2);

Object.assign(window, { __ab: { bus, level: () => lastLevel, state: () => received?.subscription.state(), latencies } });

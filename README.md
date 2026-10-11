# moa-mixer

A browser mixing console and synthesizer, built on the Web Audio API. Inspired by the Mackie 1604 and the Roland SH-101, but with six aux sends and three stereo buses instead of the 1604's two.

Live: **https://moaswift.no/mixer/**

> Click **Start audio**, then play the synth with `a w s e d f t g y h u j k` or the on-screen keys. Double-click any fader or knob to reset it.

## What it is today

- **MOA-1, a mono synthesizer** in the SH-101 mould
  - Saw, pulse (width, plus PWM from the LFO or the filter envelope), a sub-oscillator and noise, with an octave range switch.
  - 24 dB/oct resonant low-pass filter with envelope amount, LFO amount and key follow.
  - Two ADSR envelopes: one drives the VCA, one sweeps the filter.
  - LFO with triangle, square and sample-and-hold waves.
  - Portamento, with legato or retrigger behaviour for overlapping notes.
- **MOA-MIX, a mixer** (one channel strip so far, built to scale to 16)
  - Strip: low cut, 3-band EQ with a sweepable mid, six aux sends (pre/post per pair), pan, mute, solo, A/B/C bus assigns, fader and meter.
  - Master: three independent stereo buses with L/R meters, six aux masters, and a solo indicator.

## The plan

The project is built in small, audible iterations, and every step has to be playable. The design goal is a **hidden modular core with a high-level front**. Users see synthesizers, filters, mixers and effects with named controls. Under the hood, everything is voltage: audio and control signals are the same kind of thing, as in a modular synth.

### Architecture

```
src/
  domain/          pure TypeScript, no browser APIs, fully unit-tested
    circuit/       INTERNAL signal graph: nodes + cables (audio and CV are the same)
    devices/       PUBLIC: Synthesizer, Mixer, ... each wraps a Circuit and exposes controls and jacks
    patch/         the top-level aggregate: devices + how they are routed (what a preset will save)
  audio/           compiles a Patch into Web Audio nodes and keeps them in sync
  ui/              panels built only from device controls (never from circuit primitives)
```

- **Circuit** (hidden): `oscillator`, `filter`, `gain`, `pan`, `envelope`, `constant`, `waveshaper`, `noise`, `random` and `meter` nodes joined by cables. A cable can target a param, which is how CV works. Pitch is a CV in cents summed into every oscillator's detune, so the sub-oscillator and the filter's key follow track the keyboard for free.
- **Device** (public): the vocabulary users know. A device owns a Circuit and exposes only *controls* (number, choice, toggle), *jacks* (named audio in/out) and *meters*. Controls clamp their values and map one user-facing knob onto one or more internal params.
- **Patch** (public): devices plus routing. `Patch.default()` wires the synth into mixer channel 1 and the mixer's main output to the speakers.
- **Audio engine**: the only place Web Audio appears. Envelopes are CV sources automated on gate changes; the pulse wave is a sawtooth through a waveshaper with a width CV; param changes are smoothed to avoid zipper noise.
- **UI**: renders from device controls. Faders are a transparent native range input over a drawn cap (so pointer, keyboard and screen readers work); knobs are drag/keyboard sliders.

### Roadmap

| # | Step | Status |
|---|------|--------|
| 1 | Scaffold: Circuit, Synthesizer, one-channel Mixer, Patch, Web Audio engine | done |
| 2 | Strip depth: low cut, 3-band EQ, pan, solo | done |
| 3 | Synth voice: two envelopes, SH-101 oscillators and mixer, 24 dB filter, LFO, glide and legato, front panel | done |
| 4 | Mixer with three stereo buses, six aux sends, meters, master section (one strip) | done |
| 5 | **16 channels** and the full console layout | next |
| 6 | **Effects** (reverb, delay) on the aux returns | planned |
| 7 | Synth depth: polyphony, sequencer or arpeggiator | planned |
| 8 | Presets and persistence (save/load a Patch) | planned |
| 9 | Real inputs: audio files and microphone/line in per channel | planned |

### Design decisions worth knowing

- **Three independent stereo buses**, each assignable per channel (not main + subgroups).
- **Solo is solo-in-place**: while any channel is soloed the others are silenced, rather than the 1604's PFL/AFL listening bus. Mute wins over solo.
- **Mute sits before the aux taps**, so muting a channel silences its sends too. Pre-fader sends tap after the mute gate; post-fader sends tap after the fader.
- **A fixed `main` sum of the three buses** feeds the speakers, because the browser has a single stereo output. Each bus is also available as its own device output for routing later.
- **Filter resonance** sits on the first of two cascaded filter stages, so it does not self-oscillate like the original.

## Development

```sh
npm install
npm run dev        # http://localhost:5173
npm test           # unit tests (domain layer)
npm run typecheck
npm run build
```

In dev mode, `window.__mixer` exposes the engine and patch for experimenting from the browser console.

The site is a static build. It is deployed to `moaswift.no/mixer/` by building with `vite build --base=/mixer/` and copying `dist/` into the `www/mixer/` folder of the moaswift site repo.

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
  - **Keyboard bed** fused into the bottom of the panel: 49 keys (C2-C6, the home row plays from middle C), a spring-back **pitch wheel** (+/- 2 semitones), a **mod wheel** that adds LFO vibrato depth on top of the Mod fader, and `<` `>` octave buttons (-2 to +2). Keys light for notes from MIDI too.
  - **18 mono patches plus an Init** (basses, leads, brass, effects) from the patch picker in the panel header. The real SH-101 has no patch memory, so these are recipes for the sounds it is known for, not factory dumps.
- **MOA-6, a six-voice poly synth with one oscillator per voice**
  - Per voice: a saw, pulse or triangle oscillator plus a sub, a 24 dB low-pass filter, and two ADSR envelopes (1 sweeps the filter, 2 shapes the amplitude). One shared LFO (triangle, ramp up, ramp down, square, random; free-running or synced to a note division of the tempo) modulates pitch, pulse width, filter and amplitude.
  - **Voice modes**: poly (a new note takes the voice released longest ago, else steals the oldest), mono (one voice, legato glide) and unison (all six, detuned). Portamento and unison detune.
  - **Effects**: chorus (two LFO-modulated delays) and an echo with a darkened feedback loop.
  - **16 patches** in two banks of eight, and a **Save** button that stores the current sound in the selected slot (kept in the browser's local storage). Listens on MIDI channel 2 by default: notes, pitch bend, mod wheel (CC 1) and program change.
  - Shares the keyboard bed (wheels, octave buttons, 49 keys) with the MOA-1. The computer keys play whichever synth panel you clicked last.
- **MOA-PIPE, a physical-modelling synthesizer on its own page** (`pipe.html`, live at **https://moaswift.no/pipe/**)
  - Eight voices of a Karplus-Strong model, no oscillators. **Steam** (noise or DC pressure, low-passed and shaped by an ADSR) is blown into a **pipe**: a tuned delay with feedback through polarity, high-pass, low-pass, dispersion and a saturator (soft to hard, symmetric to asymmetric). **Push** feeds the pipe's contents back into the steam so the loop sings on its own (flutes, reeds, organ pipes); **Decay** and **Release** set how long the fundamental rings; **Delay box** stretches the partials (Harmonics, and a Split mode with two unequal sections for bells and wood).
  - The loop length is the note's period minus the delay its own filters and dispersion add, so notes stay in tune whatever the tone settings; HP and LP "comp" fade that compensation out for an overblown, slightly off-pitch pipe. Filters sit relative to the played note, so the tone follows the keyboard.
  - Poly, mono and unison (with glide, legato and detune), one LFO (pitch, filter, steam, saturation or push; free or tempo-synced; the mod wheel adds to its amount, so with the LFO on Filter it overblows), pitch bend, sustain pedal (CC 64), a built-in reverb, 16 patches in two banks with Save, and the shared keyboard bed. Listens on any MIDI channel by default.
  - **Spring reverb** behind it with a dry/wet mix: Length, Tension, Drip, Tilt and Dwell. Two springs of slightly different length (stereo), each a feedback loop around a delay and a long allpass chain that makes the chirpy "drip", with a tilt filter and damping in the loop and a saturating drive at the input. It is a separate device (`SpringReverb`), so it can go on the mixer later.
  - The engine runs sample by sample in an audio worklet (a feedback loop shorter than 128 samples cannot be built from DelayNodes); `pipeWorklet.ts` holds it as source text that the tests evaluate too.
- **Lynch 106, a six-voice polysynth on its own page** (`lynch.html`, live at **https://moaswift.no/lynch/**), inspired by the Roland Juno-106 (not affiliated with Roland; the name, logo and artwork are our own)
  - Six voices, one oscillator each: saw and pulse (pulse width manual or swept by the LFO), a sub-oscillator and noise, with 16', 8' and 4' ranges. A four-position high-pass (bass boost, flat, two cutoffs), a 24 dB resonant low-pass with envelope depth (normal or inverse), LFO and keyboard follow, and a VCA driven by the envelope or a plain gate. One ADSR, a triangle LFO with a delay that fades it in, and a stereo **chorus** with I, II and both (a fast, shallow third setting). No velocity, as on the original.
  - **Performance**: Poly 1, Poly 2 (always the lowest free voice) and Unison, portamento, Hold, key transpose, tuning and volume. The **bender** sits in its black cheek beside the keys: a lever you drag (left and right bend the pitch by the DCO sensitivity, pushing it up adds LFO modulation) with DCO, VCF and LFO sensitivity sliders and an LFO TRIG switch. It springs back when you let go; MIDI pitch bend, mod wheel and sustain pedal drive it too.
  - **128 patch memories** like the original: group A or B, 8 banks of 8, selected with the bank and patch keys and shown on the red display. 24 factory patches, the rest Init. **Write** stores the sound in the selected slot (kept in the browser's local storage), and **Manual** brings the panel's own settings back after you have been playing patches.
  - The panel, with its red section bars, black flat-capped sliders and cream, orange and blue keys, is drawn from the look of the original.
- **MOA-DF2, a dual dynamic multi-filter fed by the Lynch 106** (`df2.html`, live at **https://moaswift.no/df2/**), inspired by a small hardware filter box of the same idea (not affiliated with its maker; the name and artwork are our own)
  - The Lynch 106 sits on top; its left output goes to **Filter I** and its right output to **Filter II**, and its held keys can gate the box's envelopes. The Lynch page itself is unchanged.
  - **Two filters, each with two circuits and an 8-position FILTER TYPE knob.** The *GEN R-8* side is a gritty 12 dB/oct state-variable filter (low-pass, band-pass, high-pass, notch) that saturates its input and integrators; the *2045* side is a smooth four-pole 24 dB/oct low-pass. Three hybrid positions use both circuits at spaced cutoffs, so two features show: BP+ (band-pass into a 2045 low-pass), NOTCH+ and BANDSTOP+ (a wide reject band with a resonant peak at each edge). **Both circuits self-oscillate** with resonance up, and stay bounded. These are my own models of the character, not circuit-exact copies (those circuits are not public).
  - Per filter: cutoff, resonance, a bipolar depth from the envelope or the sample-and-hold, invert envelope, a NOISE source into the filter, a VCA that can follow the envelope, and a GATE block (audio THRESHOLD, ON/OFF, an OPEN button that holds the gate). **ENV I LINK** makes filter II use envelope I and **C.OFF LINK** ties filter II's cutoff to filter I's.
  - **Two envelopes**: ADSR or a looping AR that works as an LFO, linear or exponential, gated by the held keys or by the audio level of their filter's input crossing the threshold ("dynamic").
  - **Sample-and-hold** (noise or envelope I, rate, slew) and a **PT2399-style delay**: time, repeats, level, bipolar modulation from the S&H or envelope II. Its loop loses bandwidth as the time grows, is bit-crushed and soft-clipped, so past full repeats it holds a bounded, crunchy drone. A stereo/mono mixer (stereo: filter I left, filter II right, delay centred) and volume, behind a soft limiter.
  - 16 patch slots (14 factory sounds, saved with **Save** in the browser's local storage). The whole box is one audio worklet (`dfWorklet.ts`, source text that the tests evaluate too). Left out: the hardware's patch jacks.
- **MOA-DUO, a paraphonic synth with a routable dual filter** (`duo.html`, live at **https://moaswift.no/duo/**), inspired by a small hardware paraphonic synth (not affiliated with its maker; the name and artwork are our own, drawn from the look of the real panel)
  - **Two oscillators, one voice**: oscillator 1 is a saw or pulse (with pulse width), oscillator 2 a saw or triangle with a detune slider and hard **sync** to oscillator 1; each has glide, its own level and an octave switch (32/16/8 and 16/8/4), plus a TUNE knob that moves oscillator 2 only (so it detunes against oscillator 1), vibrato and a noise source. Paraphony: one key plays on both oscillators, two keys give oscillator 1 the low note and oscillator 2 the high one, three or more keep the lowest on oscillator 1 and put the last note played (if it is higher) on oscillator 2. Mono mode plays the newest key on both; legato stops a held key's neighbour from restarting the modulators.
  - **Dual filter**: two 12 dB state-variable filters that share CUTOFF and RESONANCE, with POST as an offset for filter 2, and **three routing knobs**: VCO (both oscillators to filter 1, split between the filters, both to filter 2, or straight to the VCA), VCF (low-pass into low-pass for 24 dB, high-pass into high-pass, two low-passes in parallel, or low-pass plus high-pass in parallel) and MOD (modulator 1 to both, both to both, one each, or modulator 1 to both with modulator 2 on filter 2 as well). Both filters self-oscillate and stay bounded, so with the VCO routing on VCA they work as extra sound sources.
  - **Three modulators** (filter 1, filter 2, VCA) with RISE, FALL, HOLD (fall becomes a release) and LFO (the envelope loops; with HOLD on, the gate pins it at the top) and, for the filters, a level.
  - A four-line **reverb** with pre-delay (TIME, which also brightens it), DECAY up to infinite (kept bounded) and MIX. Pitch wheel of 3 semitones, mod wheel into vibrato depth, sustain pedal, program change, and a MIDI channel switch that can lock to the last channel heard. 24 patch slots (Init and 16 factory sounds, including a detuned hoover lead) with **Save** in the browser's local storage. The panel keeps the real layout on wide screens (it scales with the window) and stacks into sections on a phone. Left out: the hardware's patch bay.
  - The synth is one audio worklet (`duoWorklet.ts`, source text that the tests evaluate too); the note assignment is plain code in `duoSynth.ts`. Not circuit-exact: it aims at the character.
- **MOA-DR, a 909-style drum machine**
  - Six synthesised voices, each with its own output into its own mixer channel: kick, snare, clap, closed hat, open hat and ride. Kick is a sine with a pitch drop plus a click, snare is two triangles plus noise, clap is band-passed noise through a stuttering burst envelope, hats and ride are six detuned squares through band-pass and high-pass filters (a synthesised stand-in for the 909's sampled cymbals).
  - Velocity scales level (and the kick click and snare snap a little more). A closed hat chokes the open hat (switchable). Per-voice tune, decay, character control, level, mute and solo.
  - **16-step sequencer** with velocity per step (click a step: soft, medium, hard, off), swing, and four patterns A-D (A, B and C ship with grooves, D is empty). It runs on the drum machine's own transport: its own tempo with Play/Stop, or following MIDI clock and start/stop (one step per 6 pulses). Hits are scheduled ahead on the audio clock, so timing does not depend on UI timers.
  - Play it from the pads (Shift soft, Alt hard), keys 1-6, or MIDI: General MIDI drum notes (36 kick, 38 snare, 39 clap, 42 closed hat, 46 open hat, 51 ride) on channel 10 by default.
- **Send FX: a reverb and a dub delay**, both mono in and stereo out. Aux 1 feeds the reverb, aux 2 feeds the delay, and each comes back on its own stereo FX return strip.
  - **Reverb**: small, medium or large generated stereo tail, with pre-delay, low cut and damping.
  - **Delay**: time (20 ms to 1.5 s), feedback up to 110 %, tone, ping-pong spread, tape wobble and drive. The feedback loop is darkened and soft-clipped, so past 100 % it holds a stable, distorted drone instead of blowing up, and backing off lets it die away.
- **Ouroboros (MOA-FX1), a dual-channel feedback delay on bus C**, deliberately unstable. Bus C feeds it, it returns on its own stereo strip (FX 3), and bus C is taken off main, so Ouroboros's dry/wet mix puts the clean bus back (Mix at 0 is the bus untouched).
- **Bus Comp (MOA-FX2), a vintage-style bus compressor with a sidechain ducker on bus B**. Bus B feeds it, it returns on its own stereo strip (FX 4), and bus B is taken off main. Threshold, ratio, attack, release, knee, make-up and a parallel Mix (the browser's automatic make-up gain is taken out, so 0 dB means 0 dB). The ducker listens to one mixer channel (the Key source, the kick by default; tapped before its fader) through a high-pass and a peak follower with fast attack and an adjustable release, and can only turn the bus down. Key Listen plays the key, Bypass bypasses, a VU needle shows gain reduction (or input/output level), and 8 patches can be saved. The follower is an audio worklet (`moa-follower`), the one node kind the browser's graph couldn't give us.
  - **Two channels** (A and B), each: gain (into a soft clipper), a long dull delay with bit-crush "grit", a resonant LP/HP filter, a clip stage and a level. They run in **series, parallel or ping-pong**.
  - **Four feedback paths** (A>A, A>B, B>A, B>B) let it ring and drone with no input; a tiny built-in noise floor starts a loop that is above unity from silence. Every loop passes a delay and a soft clipper, so it saturates into a loud wash and stays bounded. The Clip knob adds saturation, not loop gain.
  - **Modulator**: an LFO (triangle, ramp, square, random) or an envelope follower of the input with a manual trigger, with bipolar amounts to each channel's delay time, cutoff and gain.
  - **Kill** (hold: cuts all feedback) and **Freeze** (latch: each channel holds its own loop at 100 % and the input shuts). Eight patches (most decay over a few seconds, Karaoke Drone and Self Oscillator are meant to sustain), with Save. The panel is a fixed matte-black layout drawn from the design, with the signal flow as lines and a live feedback diagram.
- **MOA-MIX, a mixer** (eight channels, three stereo FX returns, three stereo buses, six aux sends; built to scale to 16)
  - **FX returns**: stereo strips (reverb, delay, Ouroboros, bus compressor) with low cut, EQ, aux sends, balance, mute, bus assigns, fader and an L/R meter. A return fed by a bus has no assign back to that bus. A return can send to its own aux (an effect feeding itself through the desk) or to the other effect (echo into the reverb): the dub tricks. Sends start at zero, and the reverb soft-clips and the delay saturates its loop, so even a runaway loop stays bounded.
  - **Bus "To main" switches**: take a bus off the main mix so it only goes where it is patched.
  - **Safe output**: the main sum runs through a limiter and a hard ceiling just under full scale, so feedback abuse is loud but never leaves the speakers' range.
  - Strip: low cut, 3-band EQ with a sweepable mid, a soft-clipping gain stage (transparent to 0.6, then hot signals ease into a ceiling at 1.0 instead of clipping hard), six aux sends (pre/post per pair), pan, mute, solo, A/B/C bus assigns, fader and meter.
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
| 3b | 18 mono synth patches with a patch picker (controls are observable so the panel follows) | done |
| 4 | Mixer with three stereo buses, six aux sends, meters, master section (one strip) | done |
| 4b | **MIDI in** (Web MIDI): notes on a chosen channel, default CC map, program change, MIDI clock in, per-synth transport, monitor | done |
| 4d | **Drum voices**: six synthesised 909-style voices with individual outputs, velocity, hat choke, pads and GM MIDI | done |
| 4e | **Drum sequencer**: 16 steps, velocity per step, swing, patterns A-D, own clock or MIDI clock and start/stop | done |
| 4f | **MOA-6 poly synth**: six one-oscillator voices, poly/mono/unison, LFO with tempo sync, chorus and delay, 16 patches with Save, shared keyboard bed | done |
| 4g | **Send FX**: reverb and dub delay on aux 1 and 2, stereo FX return strips, limiter and ceiling on the main output | done |
| 4c | MIDI learn, saved CC mappings, tempo-synced LFO | next |
| 5 | **16 channels** and the full console layout | planned |
| 4h | **Ouroboros** feedback delay on bus C with its own FX return strip, and a per-bus "To main" switch | done |
| 4i | **MOA-PIPE** physical-modelling synth (Karplus-Strong, 8 voices, 16 patches) with a **spring reverb**, on its own page | done |
| 4j | MOA-PIPE modulation matrix (five LFOs, CC sources A-D), external audio as the exciter, spring reverb in the mixer | planned |
| 4k | **Lynch 106** polysynth (six voices, chorus I/II, 128 patch memories, bender lever, hold, transpose) on its own page | done |
| 6 | **Bus processing**: a compressor with sidechain on bus B | done |
| 6b | More effects | next |
| 7 | Synth depth: polyphony, sequencer or arpeggiator | planned |
| 8 | Presets and persistence (save/load a Patch) | planned |
| 9 | Real inputs: audio files and microphone/line in per channel | planned |

### MIDI

- **Chrome or Edge** (Web MIDI; Safari has none). Click **Start audio** and **Connect MIDI** in the strip at the top and choose the input. A Torso T-1 is picked automatically if it is the only device or its name matches.
- **Per-synth transport**: each synth chooses *Internal* tempo or *MIDI clock*, whether it follows MIDI **start/stop**, and which **MIDI channel** it listens on (default channel 1). A synth that is not synced ignores incoming clock.
- **Default CC map** (editable in code, MIDI learn comes next): CC 70 cutoff, 71 resonance, 72 filter env amount, 73 filter decay, 74 amp decay, 75 amp release, 76 pulse width, 77 PWM, 78 pulse level, 79 sub level, 80 noise level, 81 LFO rate, 82 vibrato, 83 glide. The Torso T-1 is reported to send CC 70-83 from a CC track, which is unconfirmed: the on-screen monitor shows what a device really sends.
- **Program change** selects a patch (0 is Init).
- **Pitch bend** drives the pitch wheel (+/- 2 semitones) and **CC 1** the mod wheel, so a controller's wheels move the on-screen ones.
- Clock tempo is a trimmed mean of pulse spacing, so timestamp jitter does not make the BPM wobble.

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

The site is a static build with five pages. The mixer is deployed to `moaswift.no/mixer/` by building with `npm run build -- --base=/mixer/` and copying `dist/` into the `www/mixer/` folder of the moaswift site repo. MOA-PIPE has its own build, `npm run build:pipe` (base `/pipe/`, output `dist-pipe/`), whose `pipe.html` is copied to `www/pipe/index.html` with its assets, and so does the Lynch 106 (`npm run build:lynch`, base `/lynch/`, output `dist-lynch/`, `lynch.html` copied to `www/lynch/index.html`) MOA-DF2 (`npm run build:df2`, base `/df2/`, output `dist-df2/`, `df2.html` copied to `www/df2/index.html`) and MOA-DUO (`npm run build:duo`, base `/duo/`, output `dist-duo/`, `duo.html` copied to `www/duo/index.html`). `npm run dev` serves them all: `/` is the mixer, `/pipe.html` is MOA-PIPE, `/lynch.html` is the Lynch 106 and `/df2.html` is MOA-DF2 and `/duo.html` is MOA-DUO.

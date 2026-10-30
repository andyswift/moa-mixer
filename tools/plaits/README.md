# Plaits (and later Braids) for the MOA-RIG's OSC 3

`src/audio/plaits/` is a port to JavaScript of Mutable Instruments' Plaits engines (MIT, Emilie Gillet; see
`src/audio/plaits/LICENSE`). Two tools keep it honest; both need a checkout of the original source:

    git clone --depth 1 https://github.com/pichenettes/eurorack.git
    git clone --depth 1 https://github.com/pichenettes/stmlib.git eurorack/stmlib

- `node tools/plaits/extract-tables.mjs <eurorack>` writes `src/audio/plaits/plaitsTables.ts`: the lookup tables,
  with the C source's own float literals.
- `tools/plaits/build-reference.sh <eurorack>` compiles `reference.cc` against the original engines (the system C++
  compiler) and renders each one through a fixed automation of note, TIMBRE, MORPH, HARMONICS and triggers into
  `src/audio/plaits/__tests__/fixtures/<engine>.f32`. `ENGINES="fm chord"` renders only those.

`plaits.test.ts` plays the port through the same automation and compares. The port runs in double precision where
the module runs in single, so they differ by a little (a relative error of 10^-4 to 10^-3); a mistake in a port
shows up as an error near 1.

Adding an engine: port it into `plaitsEngines.ts` (its building blocks into `plaitsDsp.ts`), add it to the end of
`PL_ENGINES` with the module's output gains (from `plaits/dsp/voice.cc`), its name to the end of `RIG_MACRO_MODELS`
(`rigParams.ts`; patches keep the index), render its fixture and add it to `ENGINES` in the test.

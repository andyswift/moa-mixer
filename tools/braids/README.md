# Braids for the MOA-RIG's OSC 3

`src/audio/braids/` is a port to JavaScript of Mutable Instruments' Braids macro oscillator (MIT, Emilie Gillet; see
`src/audio/braids/LICENSE`). OSC 3 plays it in its BRAIDS mode: the model, TIMBRE, and MORPH as Braids' COLOR. Two tools
keep it honest; both need a checkout of the original source:

    git clone --depth 1 https://github.com/pichenettes/eurorack.git
    git clone --depth 1 https://github.com/pichenettes/stmlib.git eurorack/stmlib

- `node tools/braids/extract-tables.mjs <eurorack>` writes `src/audio/braids/braidsTables.ts`: every table of
  `braids/resources.cc`, as the typed array of its C type.
- `tools/braids/build-reference.sh <eurorack>` compiles `reference.cc` against the original macro oscillator (the system
  C++ compiler) and renders each model through a fixed automation of pitch, TIMBRE, COLOR and strikes into
  `src/audio/braids/__tests__/fixtures/<index>.i16`. `MODELS="0 1 2"` renders only those.

Braids is fixed point, so `braids.test.ts` expects the port to match the fixtures sample for sample, and all 48 models
do. A model without a fixture is skipped there (its behaviour is still tested). The module runs at 96 kHz and its tables are made for that
rate, so the rig runs it at twice its own rate in Braids' 24-sample blocks and brings it down with a half-band filter
(at 44.1 kHz Braids runs at 88.2 kHz, its pitch moved to stay in tune).

Adding a model: port it into `braidsOscillators.ts`, raise `BR_MODELS`, add its name to the end of `RIG_BRAIDS_MODELS`
(`rigParams.ts`; the models are in the module's order, so a patch keeps its index) and to `NAMES` in the test.

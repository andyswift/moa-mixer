// Renders one of Braids' models, from Mutable Instruments' own source (MIT, (c) Emilie Gillet), through a fixed
// automation of pitch, TIMBRE, COLOR and strikes, for the port's tests to compare against. See tools/braids/README.md.
//   reference <model index> > out.i16     (BLOCKS * BLOCK int16 samples at Braids' 96 kHz)
// The automation is repeated in src/audio/braids/__tests__/braids.test.ts; keep the two the same.
#include <cmath>
#include <cstdio>
#include <cstdlib>
#include <cstring>

#include "braids/macro_oscillator.h"

using namespace braids;

static const int kBlock = 24;
static const int kBlocks = 600;
static MacroOscillator osc;  // static, so zeroed before Init (as on the module, where it is a global)

int main(int argc, char** argv) {
  if (argc < 2) { fprintf(stderr, "usage: reference <model index>\n"); return 1; }
  int shape = atoi(argv[1]);
  if (shape < 0 || shape >= MACRO_OSC_SHAPE_LAST) { fprintf(stderr, "no model %d\n", shape); return 1; }
  osc.Init();
  osc.set_shape(static_cast<MacroOscillatorShape>(shape));
  uint8_t sync[kBlock];
  memset(sync, 0, sizeof(sync));
  int16_t out[kBlock];
  for (int b = 0; b < kBlocks; ++b) {
    // pitch (128ths of a semitone): C3, G3, C4, G4 in turn, a little off the semitone
    const int notes[4] = { 48, 55, 60, 67 };
    osc.set_pitch(static_cast<int16_t>((notes[(b / 150) % 4] << 7) + 37));
    int16_t timbre = static_cast<int16_t>(16384 + 15000 * sin(b * 0.05));
    int16_t color = static_cast<int16_t>(16384 + 15000 * sin(b * 0.031 + 1.0));
    osc.set_parameters(timbre, color);
    if (b % 150 == 0) osc.Strike();
    osc.Render(sync, out, kBlock);
    fwrite(out, sizeof(int16_t), kBlock, stdout);
  }
  return 0;
}

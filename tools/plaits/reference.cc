// Renders one of Plaits' engines, from Mutable Instruments' own source (MIT, (c) Emilie Gillet), through a fixed
// automation of its parameters, for the port's tests to compare against. See tools/plaits/README.md.
//   reference <engine> > out.f32     (OUT then AUX, BLOCKS * BLOCK float32 each)
// The automation is repeated in src/audio/plaits/__tests__/plaits.test.ts; keep the two the same.
#include <cmath>
#include <cstdio>
#include <cstring>
#include <string>

#include "stmlib/utils/buffer_allocator.h"
#include "plaits/dsp/engine/additive_engine.h"
#include "plaits/dsp/engine/bass_drum_engine.h"
#include "plaits/dsp/engine/chord_engine.h"
#include "plaits/dsp/engine/fm_engine.h"
#include "plaits/dsp/engine/grain_engine.h"
#include "plaits/dsp/engine/hi_hat_engine.h"
#include "plaits/dsp/engine/modal_engine.h"
#include "plaits/dsp/engine/noise_engine.h"
#include "plaits/dsp/engine/particle_engine.h"
#include "plaits/dsp/engine/snare_drum_engine.h"
#include "plaits/dsp/engine/speech_engine.h"
#include "plaits/dsp/engine/string_engine.h"
#include "plaits/dsp/engine/swarm_engine.h"
#include "plaits/dsp/engine/virtual_analog_engine.h"
#include "plaits/dsp/engine/waveshaping_engine.h"
#include "plaits/dsp/engine/wavetable_engine.h"

using namespace plaits;

static const int kBlock = 24;
static const int kBlocks = 200;
static char ram[65536 * 4];

int main(int argc, char** argv) {
  if (argc < 2) { fprintf(stderr, "usage: reference <engine>\n"); return 1; }
  std::string name = argv[1];
  Engine* e = nullptr;
  if (name == "va") e = new VirtualAnalogEngine();
  else if (name == "waveshaping") e = new WaveshapingEngine();
  else if (name == "fm") e = new FMEngine();
  else if (name == "grain") e = new GrainEngine();
  else if (name == "additive") e = new AdditiveEngine();
  else if (name == "wavetable") e = new WavetableEngine();
  else if (name == "chord") e = new ChordEngine();
  else if (name == "speech") e = new SpeechEngine();
  else if (name == "swarm") e = new SwarmEngine();
  else if (name == "noise") e = new NoiseEngine();
  else if (name == "particle") e = new ParticleEngine();
  else if (name == "string") e = new StringEngine();
  else if (name == "modal") e = new ModalEngine();
  else if (name == "bass_drum") e = new BassDrumEngine();
  else if (name == "snare_drum") e = new SnareDrumEngine();
  else if (name == "hi_hat") e = new HiHatEngine();
  if (!e) { fprintf(stderr, "unknown engine %s\n", argv[1]); return 1; }
  memset(ram, 0, sizeof(ram));
  stmlib::BufferAllocator allocator(ram, sizeof(ram));
  e->Init(&allocator);
  e->LoadUserData(nullptr);
  e->Reset();

  static float out[kBlock * kBlocks], aux[kBlock * kBlocks];
  for (int b = 0; b < kBlocks; ++b) {
    EngineParameters p;
    // three notes in turn, and the three macro knobs swept at different rates
    p.note = 48.0f + 12.0f * static_cast<float>((b / 67) % 3) + 0.37f;
    p.timbre = 0.5f + 0.45f * sinf(static_cast<float>(b) * 0.05f);
    p.morph = 0.5f + 0.45f * sinf(static_cast<float>(b) * 0.031f + 1.0f);
    p.harmonics = 0.5f + 0.45f * sinf(static_cast<float>(b) * 0.023f + 2.0f);
    p.accent = 0.8f;
    // a trigger every 50 blocks, held for 25
    int phase = b % 50;
    p.trigger = phase == 0 ? (TRIGGER_RISING_EDGE | TRIGGER_HIGH) : phase < 25 ? TRIGGER_HIGH : TRIGGER_LOW;
    bool enveloped = false;
    e->Render(p, out + b * kBlock, aux + b * kBlock, kBlock, &enveloped);
  }
  fwrite(out, sizeof(float), kBlock * kBlocks, stdout);
  fwrite(aux, sizeof(float), kBlock * kBlocks, stdout);
  return 0;
}

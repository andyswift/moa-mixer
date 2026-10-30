#!/bin/sh
# Builds tools/plaits/reference from a checkout of github.com/pichenettes/eurorack (with stmlib), and renders every
# engine into src/audio/plaits/__tests__/fixtures/<engine>.f32.   Usage: tools/plaits/build-reference.sh <eurorack>
set -e
EURO="$1"
[ -d "$EURO/plaits" ] && [ -d "$EURO/stmlib/dsp" ] || { echo "usage: $0 <eurorack checkout, with stmlib>"; exit 1; }
HERE="$(cd "$(dirname "$0")" && pwd)"
OUT="${TMPDIR:-/tmp}/plaits-reference"
SOURCES="$(find "$EURO/plaits/dsp" -name '*.cc' ! -name voice.cc) $EURO/plaits/resources.cc $EURO/stmlib/dsp/units.cc $EURO/stmlib/utils/random.cc"
c++ -O2 -std=c++11 -DTEST -w -I"$EURO" "$HERE/reference.cc" $SOURCES -o "$OUT"
FIX="$HERE/../../src/audio/plaits/__tests__/fixtures"
for e in ${ENGINES:-va waveshaping fm grain additive wavetable chord speech swarm noise particle string modal bass_drum snare_drum hi_hat}; do
  "$OUT" "$e" > "$FIX/$e.f32"
  echo "rendered $e"
done

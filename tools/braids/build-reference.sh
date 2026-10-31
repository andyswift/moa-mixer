#!/bin/sh
# Builds tools/braids/reference from a checkout of github.com/pichenettes/eurorack (with stmlib), and renders every
# model into src/audio/braids/__tests__/fixtures/<index>.i16.   Usage: tools/braids/build-reference.sh <eurorack>
set -e
EURO="$1"
[ -d "$EURO/braids" ] && [ -d "$EURO/stmlib/utils" ] || { echo "usage: $0 <eurorack checkout, with stmlib>"; exit 1; }
HERE="$(cd "$(dirname "$0")" && pwd)"
OUT="${TMPDIR:-/tmp}/braids-reference"
SOURCES="$EURO/braids/macro_oscillator.cc $EURO/braids/analog_oscillator.cc $EURO/braids/digital_oscillator.cc $EURO/braids/resources.cc $EURO/stmlib/utils/random.cc"
c++ -O2 -std=c++11 -w -I"$EURO" "$HERE/reference.cc" $SOURCES -o "$OUT"
FIX="$HERE/../../src/audio/braids/__tests__/fixtures"
mkdir -p "$FIX"
for m in ${MODELS:-$(seq 0 47)}; do
  "$OUT" "$m" > "$FIX/$m.i16"
done
echo "rendered ${MODELS:-0-47}"

#!/bin/bash
# usage: tests/story_shots.sh OUTDIR W H [state ...]
ROOT="$(cd "$(dirname "$0")/.." && pwd)"; CHROME="${CHROME:-/Applications/Google Chrome.app/Contents/MacOS/Google Chrome}"
OUT=$1; W=${2:-1440}; H=${3:-900}; shift 3 2>/dev/null; mkdir -p "$OUT"; STATES=${@:-e0 e1 e2 e3 e4 e4c e5 e6 e7 e8 e9 e10}
for s in $STATES; do
  perl -e 'alarm shift; exec @ARGV' 240 "$CHROME" --headless=new --disable-gpu --allow-file-access-from-files --hide-scrollbars --window-size=$W,$H --virtual-time-budget=15000 \
    --screenshot="$OUT/$s-$W.png" "file://$ROOT/tests/story_shots.html?s=$s&w=$W&h=$H&src=$ROOT/prototype/simulator.html" >/dev/null 2>&1 && echo "shot $s"
done

#!/bin/bash
# usage: tests/sim_shots.sh OUTDIR [W H] [state ...]   (writes PNGs of the real simulator in named states)
ROOT="$(cd "$(dirname "$0")/.." && pwd)"; CHROME="${CHROME:-/Applications/Google Chrome.app/Contents/MacOS/Google Chrome}"
OUT=$1; W=${2:-1440}; H=${3:-900}; shift 3 2>/dev/null; mkdir -p "$OUT"; STATES=${@:-e0 e1 e2 e3 e4 e5 e6 e7 m3 m5 m7 b5}
for s in $STATES; do
  perl -e 'alarm shift; exec @ARGV' 240 "$CHROME" --headless=new --disable-gpu --allow-file-access-from-files --hide-scrollbars --window-size=$W,$H --virtual-time-budget=20000 \
    --screenshot="$OUT/$s-$W.png" "file://$ROOT/tests/sim_shots.html?s=$s&w=$W&h=$H&src=$ROOT/prototype/simulator.html" >/dev/null 2>&1 && echo "shot $s"
done

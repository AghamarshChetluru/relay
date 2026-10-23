#!/bin/bash
# usage: tests/run_sim_v3.sh WIDTH HEIGHT [reduce]   (simulator v3 checks; "reduce" forces prefers-reduced-motion)
ROOT="$(cd "$(dirname "$0")/.." && pwd)"; CHROME="${CHROME:-/Applications/Google Chrome.app/Contents/MacOS/Google Chrome}"
OUT="${TMPDIR:-/tmp}/relay_tests"; mkdir -p "$OUT"; TAG="$1${3:+_reduce}"; FLAG=""; [ -n "$3" ] && FLAG="--force-prefers-reduced-motion"
"$CHROME" --headless=new --disable-gpu --allow-file-access-from-files --enable-logging=stderr --v=0 $FLAG --window-size=$1,$2 --virtual-time-budget=600000 \
  --dump-dom "file://$ROOT/tests/sim_v3_test.html?w=$1&h=$2&src=$ROOT/prototype/simulator.html" 2>"$OUT/simv3_err_$TAG.log" > "$OUT/simv3_out_$TAG.txt"
echo "sim-v3 w=$TAG PASS $(grep -c '^PASS' "$OUT/simv3_out_$TAG.txt") FAIL $(grep -c '^FAIL' "$OUT/simv3_out_$TAG.txt") EXC $(grep -c '^EXC' "$OUT/simv3_out_$TAG.txt") consoleLines $(grep -c 'CONSOLE' "$OUT/simv3_err_$TAG.log")"
grep -E '^(FAIL|EXC)' "$OUT/simv3_out_$TAG.txt" | cut -c1-320

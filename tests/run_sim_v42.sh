#!/bin/bash
# usage: tests/run_sim_v41.sh WIDTH HEIGHT   (v4.2 semantic + adversarial browser suite, real clicks)
ROOT="$(cd "$(dirname "$0")/.." && pwd)"; CHROME="${CHROME:-/Applications/Google Chrome.app/Contents/MacOS/Google Chrome}"
OUT="${TMPDIR:-/tmp}/relay_tests"; mkdir -p "$OUT"; TAG="$1"
perl -e 'alarm shift; exec @ARGV' 1500 "$CHROME" --headless=new --disable-gpu --allow-file-access-from-files --enable-logging=stderr --v=0 --window-size=$1,$2 --virtual-time-budget=2400000 \
  --dump-dom "file://$ROOT/tests/sim_v42_test.html?w=$1&h=$2&src=$ROOT/prototype/simulator.html" 2>"$OUT/simv42_err_$TAG.log" > "$OUT/simv42_out_$TAG.txt"
echo "sim-v42 w=$TAG PASS $(grep -c '^PASS' "$OUT/simv42_out_$TAG.txt") FAIL $(grep -c '^FAIL' "$OUT/simv42_out_$TAG.txt") EXC $(grep -c '^EXC' "$OUT/simv42_out_$TAG.txt") consoleLines $(grep -c 'CONSOLE' "$OUT/simv42_err_$TAG.log")"
grep -E '^(FAIL|EXC)' "$OUT/simv42_out_$TAG.txt" | cut -c1-420

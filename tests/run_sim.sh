#!/bin/bash
# usage: tests/run_sim.sh WIDTH HEIGHT [path/to/simulator.html]
ROOT="$(cd "$(dirname "$0")/.." && pwd)"; CHROME="${CHROME:-/Applications/Google Chrome.app/Contents/MacOS/Google Chrome}"
SRC=${3:-$ROOT/prototype/simulator.html}; OUT="${TMPDIR:-/tmp}/relay_tests"; mkdir -p "$OUT"
"$CHROME" --headless=new --disable-gpu --allow-file-access-from-files --enable-logging=stderr --v=0 --window-size=$1,$2 --virtual-time-budget=400000 \
  --dump-dom "file://$ROOT/tests/sim_v2_test.html?w=$1&h=$2&src=$SRC" 2>"$OUT/sim_err_$1.log" > "$OUT/sim_out_$1.txt"
echo "sim w=$1 PASS $(grep -c '^PASS' "$OUT/sim_out_$1.txt") FAIL $(grep -c '^FAIL' "$OUT/sim_out_$1.txt") EXC $(grep -c '^EXC' "$OUT/sim_out_$1.txt") consoleLines $(grep -c 'CONSOLE' "$OUT/sim_err_$1.log")"
grep -E '^(FAIL|EXC)' "$OUT/sim_out_$1.txt" | cut -c1-300

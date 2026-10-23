#!/bin/bash
# usage: tests/run_app22.sh WIDTH HEIGHT [path/to/index.html] [auto]   (needs Google Chrome; opens file:// pages, no server)
ROOT="$(cd "$(dirname "$0")/.." && pwd)"; CHROME="${CHROME:-/Applications/Google Chrome.app/Contents/MacOS/Google Chrome}"
SRC=${3:-$ROOT/prototype/index.html}; OUT="${TMPDIR:-/tmp}/relay_tests"; mkdir -p "$OUT"; TAG=$1${4:+_auto}
"$CHROME" --headless=new --disable-gpu --allow-file-access-from-files --enable-logging=stderr --v=0 --window-size=$1,$2 --virtual-time-budget=300000 \
  --dump-dom "file://$ROOT/tests/app_v22_test.html?w=$1&h=$2&src=$SRC${4:+&auto=1}" 2>"$OUT/app22_err_$TAG.log" > "$OUT/app22_out_$TAG.txt"
echo "app22 w=$TAG PASS $(grep -c '^PASS' "$OUT/app22_out_$TAG.txt") FAIL $(grep -c '^FAIL' "$OUT/app22_out_$TAG.txt") EXC $(grep -c '^EXC' "$OUT/app22_out_$TAG.txt") consoleLines $(grep -c 'CONSOLE' "$OUT/app22_err_$TAG.log")"
grep -E '^(FAIL|EXC)' "$OUT/app22_out_$TAG.txt" | cut -c1-330

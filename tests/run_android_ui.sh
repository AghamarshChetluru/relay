#!/bin/bash
# usage: tests/run_android_ui.sh WIDTH HEIGHT   (after ./gradlew :app:syncRelayAssets :app:testDebugUnitTest)
ROOT="$(cd "$(dirname "$0")/.." && pwd)"; CHROME="${CHROME:-/Applications/Google Chrome.app/Contents/MacOS/Google Chrome}"; OUT="${TMPDIR:-/tmp}/relay_tests"; mkdir -p "$OUT"
node "$ROOT/tests/android_ui/build_page.js" >/dev/null || exit 1
BASE="$ROOT/android/app/build/native_ui_test"
"$CHROME" --headless=new --disable-gpu --allow-file-access-from-files --enable-logging=stderr --v=0 --window-size=$1,$2 --virtual-time-budget=200000 \
  --dump-dom "file://$ROOT/tests/android_ui/native_ui_test.html?w=$1&h=$2&base=$BASE" 2>"$OUT/aui_err_$1.log" > "$OUT/aui_out_$1.txt"
echo "android-ui w=$1 PASS $(grep -c '^PASS' "$OUT/aui_out_$1.txt") FAIL $(grep -c '^FAIL' "$OUT/aui_out_$1.txt") EXC $(grep -c '^EXC' "$OUT/aui_out_$1.txt") consoleLines $(grep -c 'CONSOLE' "$OUT/aui_err_$1.log")"
grep -E '^(FAIL|EXC)' "$OUT/aui_out_$1.txt" | cut -c1-300

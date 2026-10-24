#!/bin/bash
# usage: tests/run_android_inbox.sh WIDTH HEIGHT   (after: cd android && ./gradlew :app:syncRelayAssets :app:testDebugUnitTest)
# Inbox / search / read state / banner / notification routing / refresh, on the exact web assets bundled in the APK, with REAL-engine snapshots.
ROOT="$(cd "$(dirname "$0")/.." && pwd)"; CHROME="${CHROME:-/Applications/Google Chrome.app/Contents/MacOS/Google Chrome}"; OUT="${TMPDIR:-/tmp}/relay_tests"; mkdir -p "$OUT"
node "$ROOT/tests/android_ui/build_page.js" >/dev/null || exit 1
BASE="$ROOT/android/app/build/native_ui_test"
perl -e 'alarm shift; exec @ARGV' 600 "$CHROME" --headless=new --disable-gpu --allow-file-access-from-files --enable-logging=stderr --v=0 --window-size=$1,$2 --virtual-time-budget=400000 \
  --dump-dom "file://$ROOT/tests/android_ui/inbox_test.html?w=$1&h=$2&base=$BASE" 2>"$OUT/ainbox_err_$1.log" > "$OUT/ainbox_out_$1.txt"
echo "android-inbox w=$1 PASS $(grep -c '^PASS' "$OUT/ainbox_out_$1.txt") FAIL $(grep -c '^FAIL' "$OUT/ainbox_out_$1.txt") EXC $(grep -c '^EXC' "$OUT/ainbox_out_$1.txt") consoleLines $(grep -c 'CONSOLE' "$OUT/ainbox_err_$1.log")"
grep -E '^(FAIL|EXC)' "$OUT/ainbox_out_$1.txt" | cut -c1-400

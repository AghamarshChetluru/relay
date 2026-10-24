#!/bin/bash
# usage: tests/android_ui/shots.sh OUTDIR [W H] [state ...]   (after node tests/android_ui/build_page.js)
ROOT="$(cd "$(dirname "$0")/../.." && pwd)"; CHROME="${CHROME:-/Applications/Google Chrome.app/Contents/MacOS/Google Chrome}"
OUT=$1; W=${2:-390}; H=${3:-844}; shift 3 2>/dev/null; mkdir -p "$OUT"; BASE="$ROOT/android/app/build/native_ui_test"; STATES=${@:-inbox search banner activity refresh detail many}
node "$ROOT/tests/android_ui/build_page.js" >/dev/null || exit 1
for s in $STATES; do
  perl -e 'alarm shift; exec @ARGV' 120 "$CHROME" --headless=new --disable-gpu --allow-file-access-from-files --hide-scrollbars --window-size=$W,$H --virtual-time-budget=12000 \
    --screenshot="$OUT/$s-$W.png" "file://$ROOT/tests/android_ui/inbox_shots.html?s=$s&w=$W&h=$H&base=$BASE" >/dev/null 2>&1 && echo "shot $s"
done

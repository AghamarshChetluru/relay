#!/bin/bash
# Structural checks on a built APK. usage: tests/verify_apk.sh path/to/app.apk
set -e
APK="${1:?apk path}"; AAPT="${ANDROID_HOME:-/opt/homebrew/share/android-commandlinetools}/build-tools/34.0.0/aapt2"; fail=0
need() { if unzip -l "$APK" | grep -q "$1"; then echo "PASS asset present: $1"; else echo "FAIL missing in APK: $1"; fail=1; fi; }
need "assets/web/app.html"; need "assets/web/app.js"; need "assets/web/mesh.js"; need "assets/web/native_bridge.js"; need "assets/web/style.css"
unzip -p "$APK" assets/web/app.html | grep -q "RELAY_NATIVE" && echo "PASS app.html is the native variant" || { echo "FAIL app.html lacks native flag"; fail=1; }
unzip -p "$APK" assets/web/native_bridge.js | grep -q "RelayAndroid" && echo "PASS native bridge adapter bundled" || { echo "FAIL bridge empty"; fail=1; }
if "$AAPT" dump permissions "$APK" | grep -qi "android.permission.INTERNET"; then echo "FAIL INTERNET permission present"; fail=1; else echo "PASS no INTERNET permission"; fi
"$AAPT" dump badging "$APK" | grep -E "^package:" | sed 's/^/INFO /'
[ $fail = 0 ] && echo "APK VERIFIED (structure only)" || { echo "APK CHECK FAILED"; exit 1; }

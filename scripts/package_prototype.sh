#!/bin/bash
# Packages ONLY the runnable browser prototype (HTML, CSS and JS) into a zip, for submissions that accept only those file types.
# usage: scripts/package_prototype.sh "<your name>_<your college>"      -> dist/<name>.zip
set -e
cd "$(dirname "$0")/.."
NAME="${1:-relay-prototype}"; NAME="$(printf '%s' "$NAME" | tr -c 'A-Za-z0-9._-' '_')"
mkdir -p dist; OUT="dist/$NAME.zip"; TMP="$(mktemp -d)"; DIR="$TMP/$NAME"; mkdir -p "$DIR"
for f in index.html simulator.html app.js mesh.js sim.js style.css sim.css; do cp "prototype/$f" "$DIR/$f"; done
cat > "$DIR/OPEN_ME.html" <<'HTML'
<!doctype html><meta charset="utf-8"><title>Relay prototype: open me</title>
<body style="font:16px/1.5 system-ui;max-width:42rem;margin:3rem auto;padding:0 1rem">
<h1>Relay: browser prototype</h1>
<p>A <b>simulation</b>: it uses no real Bluetooth, no install, no server and no internet. Open either page (Chrome recommended):</p>
<ul><li><a href="index.html">index.html</a>: the Relay mobile app. Best at about 390 px wide (use the browser's device toolbar).</li>
<li><a href="simulator.html">simulator.html</a>: the network simulator. Best on a laptop screen, 1280 px or wider. Pick a scenario and press Play.</li></ul>
<p>Only HTML, CSS and JavaScript files are included.</p></body>
HTML
rm -f "$OUT"; (cd "$TMP" && zip -qr "$OLDPWD/$OUT" "$NAME"); rm -rf "$TMP"
echo "wrote $OUT"; unzip -l "$OUT" | tail -n +4 | awk '{print "  " $4}' | grep -v '^  $'

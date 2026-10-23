#!/bin/bash
# Engine regression suites against the browser prototype's mesh.js.
set -e
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
node "$ROOT/tests/engine_v2_test.js" "$ROOT/prototype" | tail -1
node "$ROOT/tests/engine_v22_test.js" "$ROOT/prototype" | tail -1

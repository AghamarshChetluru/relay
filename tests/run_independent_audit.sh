#!/bin/bash
# Runs the independent audit scripts UNMODIFIED, in a scratch folder that holds a copy of the prototype files (they expect to sit beside mesh.js).
set -e
ROOT="$(cd "$(dirname "$0")/.." && pwd)"; T="$(mktemp -d)"; cp "$ROOT"/prototype/* "$T"/; cp "$ROOT"/tests/independent_audit/*.js "$T"/
( cd "$T" && echo "== independent_engine_tests.js" && node independent_engine_tests.js | tail -4 && echo "== stress_routing.js" && node stress_routing.js | tail -4 )
rm -rf "$T"

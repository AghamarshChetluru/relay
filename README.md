# Relay

Offline-first community help and missing-person coordination for when cellular networks are down.

> **Status of this repository**
> * `prototype/` is the **browser simulation** (Relay v2.2): a mobile-first web app, a separate desktop network simulator, and a deterministic in-memory mesh engine that simulates 80 phones inside one JavaScript process. **It does not use real Bluetooth.**
> * `android/` (added on the `feature/android-offline-mesh` branch) is the work toward a **real Android app** with a real phone-to-phone radio transport. See `docs/` for what is and is not verified.

## Layout

| Path | What it is |
|---|---|
| `prototype/` | Standalone offline browser files: `index.html` (mobile app), `simulator.html` (desktop simulator), `mesh.js` (engine), `app.js`, `sim.js`, `sim_explain.js`, `style.css`, `sim.css` |
| `tests/` | Engine, browser (headless Chrome) and routing tests, plus the independent audit scripts in `tests/independent_audit/` |
| `docs/` | Demo instructions, the independent audit, the Android handoff, screenshots, QA history, baseline checksums |
| `android/` | Android project (feature branch) |

## Run the browser prototype (no server, no internet)

Open `prototype/index.html` (mobile app; best at ~390 px wide) and `prototype/simulator.html` (laptop) directly in Chrome. See `docs/DEMO_INSTRUCTIONS.txt`.
The desktop simulator (v3) is an explanation-first walkthrough; how it works and why it is truthful to the engine: `docs/SIMULATOR_V3_DESIGN.md` (screenshots in `docs/screenshots/sim-v3/`).

## Run the tests

```bash
tests/run_engine.sh                    # Node: engine regression suites (63 + 75 checks)
tests/run_independent_audit.sh         # Node: the independent audit scripts, unmodified (28 + 120 scenarios)
tests/run_app22.sh 390 844             # headless Chrome (macOS path by default; set CHROME=... otherwise): app suite
tests/run_sim.sh 1440 860              # headless Chrome: simulator suite
```

Requires Node 18+ and Google Chrome. No dependencies are installed.

## Baseline integrity

The seven files in `prototype/` are byte-identical to `relay-prototype-v2.2.zip`; SHA-256 values are in `docs/BASELINE_CHECKSUMS.txt`. The baseline is tagged `v2.2-browser-baseline`.

## License

No open-source license has been chosen yet; until the owner decides, all rights are reserved. See `docs/LICENSE_DECISION.md`.

## What the browser prototype is not

It simulates radio links. Passing its tests says nothing about Bluetooth range, pairing, power use or phone-model differences. The independent audit (`docs/RELAY_V2_2_INDEPENDENT_AUDIT.md`) lists the gaps between the simulation and a usable Android app.

# Relay v2.2 independent test scripts

These tests were run against the seven source files extracted from `relay-prototype-v2.2.zip` on 23 Oct 2026.

## Run in a folder containing `mesh.js`, `app.js`, `sim.js`, `index.html`, `simulator.html`, `style.css`, and `sim.css`

- `node independent_engine_tests.js` — 28 core simulation checks. One check intentionally establishes that address payloads are plaintext (this is a **security finding**, not a security pass).
- `node stress_routing.js` — 120 deterministic directed-routing scenarios with bridge installed. It does **not** measure real radio performance.
- `python browser_smoke_tests.py` — 37 browser checks. Requires `playwright` Python and a local Chrome/Chromium binary. Due to the author's container navigation restrictions, this test injects original sources inline instead of loading external file URLs. Claude must separately test actual `file://` execution on the Mac.

All tests are **of a simulated mesh engine**, not Android Bluetooth or physical-device behavior. See `RELAY_V2_2_INDEPENDENT_AUDIT.md` for release blockers.

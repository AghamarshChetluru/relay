# Baseline: Relay v2.2 (browser simulation)

* Source of truth: `relay-prototype-v2.2.zip` (7 files). The working copy compared byte-for-byte equal; checksums in `BASELINE_CHECKSUMS.txt`.
* This commit only **reorganized** files (`prototype/`, `tests/`, `docs/`) and added repo scaffolding (README, `.gitignore`, test runner scripts with repo-relative paths).
  **No product code changed.** `index.html` and `simulator.html` still open standalone from disk.
* Verified from this layout before committing: engine suites 63/63 and 75/75; independent audit 28/28 and 120/120 routing scenarios; browser suites as recorded in `docs/history/QA_REPORT_browser_v2.2.md` and re-run results in the baseline tag notes.
* Known gaps (from the independent audit): no Android app, no real Bluetooth, no persistence, address packets are plaintext in the model, no real photo transfer, simulated clock.

# Relay Android — QA report (build 0.1.0-unverified-demo)

Date: 2026-10-23. Branch: `feature/android-offline-mesh`. **Status: UNVERIFIED-DEMO.**
No physical Android phone was available. Nothing below proves that Bluetooth works.

## Results

| Area | Result | Evidence |
|---|---|---|
| Baseline browser engine (mesh.js) | PASS 63/63 and 75/75 | tests/run_engine.sh |
| Baseline mobile UI (375/390/430) | PASS 140/140 per width | tests/run_app22.sh |
| Baseline simulator (1280/1440) | PASS 73/73 per width | tests/run_sim.sh |
| Independent audit engine tests | PASS 28/28 (incl. the cleartext-address detection test, which documents a flaw in the *browser* model) | tests/run_independent_audit.sh |
| Independent route stress | 120/120 scenarios ran; target area reached 120/120 (simulation only) | tests/run_independent_audit.sh |
| Kotlin protocol core, policy, store, link sessions | PASS 61/61 JVM tests | `./gradlew :app:testDebugUnitTest` |
| Native WebView adapter vs real engine snapshots | PASS 75/75 at 3 widths | tests/run_android_ui.sh |
| Android lint | 0 issues (a small, explicit lint.xml ignore list is committed) | `./gradlew :app:lintDebug` |
| Debug APK structure | PASS (web assets, native bridge, no INTERNET permission) | tests/verify_apk.sh |
| Instrumented tests on API 34 arm64 **emulator** | PASS 18/18 incl. real WebView loading bundled UI | `./gradlew :app:connectedDebugAndroidTest` |
| Emulator launch + onboarding screenshot | PASS (renders the mobile UI from APK assets) | manual, adb |
| Python `browser_smoke_tests.py` | UNTESTED here (Playwright MCP unavailable; the JS equivalents above cover the same flows) | — |

A defect found and fixed during QA: an earlier build packaged no web assets and the app showed
ERR_INVALID_RESPONSE. It was caught on the emulator, fixed with explicit Gradle task dependencies, and
guarded by `tests/verify_apk.sh` plus the real-WebView instrumented test.

## UNTESTED / UNVERIFIED (requires physical phones)

- BLE advertising, scanning, GATT connect, MTU negotiation, notify throughput on any real model
- Two-phone exchange with Wi-Fi/mobile data off
- Three-phone A→B→C store-and-forward with no direct A↔C link
- Cross-model compatibility (many phones cannot advertise or have scan quirks)
- Background and Doze behaviour, foreground-service survival, battery drain
- Reboot / app-kill recovery on hardware (SQLite persistence is covered only by JVM and emulator tests)
- Runtime-permission deny and regrant flows on hardware
- Malformed packets arriving over a real radio (codec fuzz/property tests exist at JVM level)
- Photo transfer over the radio (chunk/verify/resume logic is JVM-tested only)

## Release gates (docs/RELAY_V2_2_INDEPENDENT_AUDIT.md)

1 GitHub baseline: done. 2 Design: done. 3 Local build: done. 4 Physical radios: **NOT MET**.
5 Reliability on hardware: **NOT MET**. 6 Security: encryption of the sealed address is implemented
and unit-tested but unreviewed; no privacy claim is made. 7 Final release: **BLOCKED**.
No signed release APK was produced and `main` was not changed.

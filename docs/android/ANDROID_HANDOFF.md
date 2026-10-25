# Claude Code task — Relay GitHub baseline → native Android Bluetooth → tests → final APK

**Model recommendation:** Use Claude's highest available reasoning/coding effort for architecture, Bluetooth lifecycle, security, and debugging. Do not simplify this into a WebView packaging task.

You are continuing the existing Relay v2.2 project. The source currently implements a polished mobile web app, a separate desktop simulator, and a deterministic in-memory mesh engine. You also have the attached independent audit and test scripts. **A functioning simulation is not a working Bluetooth backend.**

## Non-negotiable execution order

### Phase 0 — FIRST create and push the GitHub repository, before editing product code

1. Identify the **correct local v2.2 working copy**, comparing source with `~/relay-submission/relay-prototype-v2.2.zip`. Do not accidentally use v1/v2.1. Check `git status`, `git remote -v`, and whether a Git history already exists. Preserve history if present and safeguard uncommitted work.
2. Check `gh auth status`. If unauthenticated, explain the one manual login/authorization step required. Do not claim GitHub push success without verifying the remote commit.
3. Create a new **private GitHub repository named `relay`** under the user's authenticated account. If the exact repo exists, investigate ownership and ask before overwriting, changing visibility, or force-pushing. Treat “project” as a GitHub repository, not an unrelated GitHub Projects board.
4. Organize original source, screenshots, docs, QA, and testing in a clean, discoverable structure without breaking `index.html` or `simulator.html` as standalone offline files. Suggested directories: `prototype/` (app, simulator, styles, engine); `tests/`; `docs/`; `android/` when created. Or use a different coherent structure that preserves standalone entry points. Include `README.md`, `LICENSE` decision, architecture notes, separate prototype and Android instructions, and `.gitignore`.
5. Exclude signing keys, secrets, node modules, Gradle caches/build directories, unneeded OS files, and debug APK binaries from normal source commits. Use GitHub Releases or release artifacts for builds.
6. Commit and push **unaltered v2.2 baseline** to `main`, with a message like `chore: import verified Relay v2.2 baseline`. Tag `v2.2-browser-baseline`, push the tag, and verify the GitHub URL, commit SHA, tree contents, and branch. **Do not start implementation before the baseline is safely pushed.**
7. Create a development branch named `feature/android-offline-mesh`.

### Phase 1 — Audit the actual existing backend, then design a real Android architecture

Read all existing code, the independent audit, and any tests. Report the current state plainly: `mesh.js` simulates 80 devices in one JavaScript process, and there is no Android BLE implementation. Explain which logic can be reused and which must be written as a true multi-device protocol.

Choose an Android approach that **preserves the mobile app design**, does not require an online backend during runtime, and supports explicit physical phone-to-phone exchange. You may use Kotlin Android with a carefully isolated UI WebView bridge or native UI, but do not substitute a generic WebView wrapper for the network implementation. Keep the desktop simulator separate and working.

Compare in a short architecture decision record:
- Native Android BLE scanner + advertiser + GATT / suitable data channel as the preferred path if avoiding Google services is essential. Validate both phone roles and hardware support.
- Nearby Connections as an optional alternative: works without internet for device discovery and data transfer, but depends on Google Play services and may leverage Wi-Fi; do not call it Bluetooth-only if that is not what the tests prove.
- Hybrid WebView UI + native transport versus fully native Android UI; state why the choice is practical.

Document radio role negotiation, discovery intervals, peer handshake, IDs, data transfer format, delivery/relay states, and what happens when Bluetooth is disabled or no peers are nearby. No central server, internet, satellite, GPS, or cloud account should be required to communicate.

### Phase 2 — Implement indispensable Android backend (NOT OPTIONAL for a usable APK)

1. **Discovery and radio exchange:** Actual hardware scanning, advertising, compatible client/server roles, user permission requests, connect/disconnect, error handling, peer identities and capability detection. Respect Android 12+ `BLUETOOTH_SCAN`, `BLUETOOTH_ADVERTISE`, `BLUETOOTH_CONNECT`, plus older-version support as applicable. Request only appropriate permissions at runtime.
2. **Versioned wire protocol:** Serialize full request/broadcast/reply/ack/resolve/renewal/address/attachment metadata to independently running phones. Use collision-resistant case IDs, packet IDs and attachment IDs, versioning, length limits, input validation, packet integrity and stable identities or keys; never rely on the simulator's global `S.requests` object or predictable IDs such as `R1`/`P1` across installations.
3. **Persistent store–carry–forward:** Use an on-device durable queue/database (e.g., Room/SQLite), persisted seen-ID records, recipient metadata, retry scheduling, queue caps, expiry, and attachment caching. Messages must survive app close/restart and device reboot as feasible. A phone should forward only while the OS permits, without inventing delivery receipts.
4. **Actual multi-hop:** A→B→C with A and C not directly connected. Relay should store messages and forward again when encountering a new peer. Propagation happens only on installed/authorized and OS-operational devices. Dedupe on receipt but forward to new peers as budgets allow.
5. **Per-type policies:** Emergency requests broad opportunistic forwarding and urgent-first scheduling; missing-person requests prefer user-declared target neighborhoods using the coarse offline graph, with same-area forwarding and bounded detours; community posts short-lived and lower priority. Keep location manually declared; do not depend on GPS. Do not prioritize an attachment over urgent text.
6. **Expiry and renewal:** Implement real elapsed time with clock-skew handling, TTL options, renewal referencing one stable case ID, packet replacement/dedupe without losing valid replies, resolve events, and honest local-only delivery statuses.
7. **Text and image bytes:** Transfer compact text first; compress photos locally, chunk actual image bytes, use integrity checks, safe reassembly and deduplication, and recover gracefully from interrupted transfers. A global attachment reference within one JS process does not count.
8. **Exact address confidentiality:** `mesh.js` currently includes the precise address in plaintext on `address` packets. **No privacy/security claim until authenticated end-to-end encryption is implemented** (using established Android cryptographic libraries, proper peer public-key handling, and a tested protocol). If full protection is not implemented, keep addresses on the source phone or expose only clearly labeled manual sharing; do not mislead users about secrecy.
9. **Foreground/background behavior:** Choose a permitted service model (e.g. connected-device foreground service when justified) and comply with notification requirements, Android OS restrictions, battery/Doze behavior and user stop controls. Document that background relaying cannot be guaranteed on all phones. Device reboot, task swipe-away, screen lock and Bluetooth toggles require testing.
10. **Offline installation/sharing:** Support explicit user-initiated Android APK sharing via the OS sharing mechanism (Quick Share where supported), checksum/signature checks where practical, Android installation consent and compatibility messaging. Do not implement silent installation or pretend an uninstalled phone can relay.
11. **User trust, abuse resistance, accessibility:** Prevent unbounded floods and malformed/replayed messages, cap file and text sizes, validate area metadata, avoid leaking private information in logs, include battery-friendly settings, clearly label unverified volunteers/sightings, and preserve the mobile application's simple flows.
12. **Remove simulation from the release experience:** No seeded fictional requests, simulated peer counts or advancing simulated minutes in a genuine Android radio mode. The browser prototype/demo may keep these with explicit labels. The desktop simulator must remain unchanged except any necessary backwards-compatible shared-protocol fixes.

### Phase 3 — Test extensively before calling the final APK usable

Run the existing engine/browser tests plus the independently supplied audit scripts. Add automated unit, property/invariant, Android instrumentation, serialization, database, migration, permission, lifecycle and failure tests.

#### Minimum real-device acceptance checks (do not fake or substitute emulators)

- **Two physically separate Android phones**: install the same Android build by user consent; disable mobile data, internet and Wi-Fi; leave Bluetooth enabled. Prove peer discovery/handshake and a real message moving from phone A to B over an actual local radio link. Confirm each device's own storage state.
- A reply or offer created on B returns to A; sender sees only honest local observations. Log real transfer timestamps and outcomes.
- **Three physical phones, ideally**: keep A and C out of direct radio range, bring B into range of A and then C, and demonstrate real A→B→C store–carry–forward (not mocked). If 3-phone test is unavailable, state explicitly that true mesh propagation is unverified and **do not certify** a usable multi-hop APK.
- Airplane mode test with Bluetooth manually re-enabled if the model supports it. Explicitly verify the app isn't silently depending on internet, Wi-Fi, GPS, Google services for routing, or a desktop simulator.
- Cold restart, process kill/relaunch, offline device reboot, connection interruption, Bluetooth disabled, permission denied/regranted, peer disappearance, repeated receipt, expired packet and renewed case, missing-person area update, actual photo byte delivery with hash match, address privacy, malicious/truncated payload, and battery/background operation.
- Cross-device app compatibility tests across relevant Android OS versions and hardware models. Document which BLE peripheral capabilities are required.
- Mobile UI regression at 375, 390, 430 dp equivalents; screen-reader labels, keyboard, error and empty states. Ensure the separate desktop simulator remains unchanged and passes existing tests.
- No fake success: unit tests and emulators cannot replace physical Bluetooth testing. Mark unsupported or untested cases in `QA_REPORT.md`, including video/log evidence where possible.

Note: A **debug/test APK is expected to be built earlier** to perform device testing. The final deliverable must not be labeled usable/release-ready until the relevant gates pass.

### Phase 4 — Build, report, and GitHub finalization

1. Confirm Android SDK/Gradle availability on the user's Mac. Set up a reproducible Android project and `README.md` build instructions. If a toolchain or real phones are unavailable, disclose the exact blocker and preserve working code; do not fabricate an APK or result.
2. Generate a debug/test APK as needed for physical tests. Only after tests pass, generate a final signed distributable APK with clear package ID, app display name, version and install instructions. Do not commit signing secrets or keystores.
3. Create `docs/architecture/ARCHITECTURE.md`, `docs/architecture/TRANSPORT_ADR.md`, `docs/architecture/SECURITY.md`, `docs/architecture/LIMITATIONS.md`, `QA_REPORT.md`, and a field-testing checklist. Explicitly separate tested radio behavior from simulated scenarios.
4. Run static scans, build, unit, UI, real-hardware and offline regression checks. Fix failures, rerun tests, and report test counts and **actual tested device models** (not invented ones).
5. If all mandatory release gates pass, commit the working changes, push the feature branch, merge or open a reviewed PR into `main`, then push a final verified commit/tag. Upload the APK as a GitHub Release artifact or equivalent and also save locally in a clearly named `dist/` location. Report the GitHub URL, final SHA, APK exact path, package name, checksum and installation instructions.
6. If real-device tests cannot be done, **do not claim completion**. You may build and label an `UNVERIFIED-DEMO` APK for further testing, push the development branch and report blockers; leave the last verified `main` baseline intact unless and until approved.
7. Never overwrite the original browser v2.2, simulator, or Git history. No `git push --force` or destructive cleanup without explicit user approval.

## Final response format

Give me (a) GitHub repo and baseline commit, (b) architecture and what is truly implemented, (c) Android build/APK link or exact local file, (d) tested phone models and offline radio proof, (e) full QA pass/fail/untested table, (f) known limitations and security caveats, and (g) final GitHub commit/tag or clear reasons you did not promote an unverified build.

**Start by securing the original v2.2 project on GitHub. Do not jump straight into making an APK. Then work through the implementation and evidence gates in order, without asking for unnecessary minor approvals.**

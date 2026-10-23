# Relay v2.2 independent review — 23 October 2026

## Scope and evidence

Inspected the user-uploaded `relay-prototype-v2.2.zip` (7 files: `index.html`, `simulator.html`, `app.js`, `sim.js`, `mesh.js`, `style.css`, `sim.css`). The artifact contains no Android Gradle project, native code, SDK manifest, operating-system Bluetooth integration, persistent mesh-message database, or cross-device transport. No physical Android phones or Android SDK were available in this review environment.

### Test results run independently

- ZIP integrity: PASS (`unzip -t`).
- JS syntax: PASS (`node --check` on mesh/app/simulator scripts).
- Engine checks: **28/28 passed**, covering topology, message creation, policies, expiry/renewal, duplicate suppression, basic propagation, join bridging, neighborhood staleness, attachment modeling, reply restrictions, and address packet inspection. **One passing check demonstrates a security flaw:** exact addresses are placed in cleartext in the simulated `address` packet's payload. It is a detection test, not proof of security.
- Additional route stress: **120/120 test scenarios ran without assertion failures** (12 participating origin phones × 10 neighborhood targets × 80 steps). With the simulated bridge installed, at least one phone in the target neighborhood received the packet in 120/120 scenarios. Without that bridge, it occurred in only 60/120 scenarios in the same deterministic environment. This is a **simulation comparison**, not a real-world delivery claim.
- Browser smoke checks: **37/37 passed**, across 375/390/430 px mobile and 1280/1440 px desktop. Verified onboarding, requesting help, feed/activity navigation, no mobile home-page horizontal overflow, simulator's 80-phone model and separate interface, no runtime errors in these flows, and no external requests from the evaluated pages. Browser executed **inlined source content** because the testing environment blocks local `file://` and `http://` page navigation. Consequently this did NOT independently verify the ZIP opening directly from disk.

Passing tests are not equivalent to exhaustive proof. They do not cover all user flows, all device models, sustained load, adversarial packets, or real wireless hardware.

## Backend readiness: major gaps before a usable Android APK

| Capability | Current v2.2 | Required next |
|---|---|---|
| Request / volunteer / community UI | Browser implementation | Retain and adapt to Android |
| Emergency broad flood, missing-person directed simulation, TTL, dedupe | Implemented in one-process `mesh.js` | Extract explicit protocol rules operating on independent-device state |
| Real nearby device discovery and radio communication | **Absent** | Android transport: advertising, scanning, connecting, exchanging bytes and handling failures |
| Real multi-hop store–carry–forward | **Absent** | Implement on separately installed phones and verify A→B→C with A and C out of range |
| Peer identity / packets | Deterministic IDs e.g. `R1`, `P1`, originating simulator node IDs | Collision-resistant IDs, device identity/public keys, versioned serialization |
| Persistence | Only declared area in localStorage; message world recreated | Durable on-device inbox, outbox, seen IDs, attachments, timers and pending retries |
| Message privacy | Exact address only hidden from intermediate devices in **UI**; cleartext within model packet | Real end-to-end encryption to selected responder OR do not transmit exact address as private |
| Photos | Shared global attachment object, no actual byte transfer | Transfer bytes in chunks with integrity, reassembly, dedupe, resume or clear failure |
| Message validity | Simulated minutes per model step | Timestamp handling, clock skew, monotonic elapsed timing and expiry policies |
| Background relay | Page steps only while browser is visible | Android service/lifecycle policy, power constraints and honest availability status |
| APK distribution | Consent dialog is a simulation | User-initiated offline APK sharing, Android installation consent, signing/checksum |
| Abuse safeguards | Minimal | Input bounds, payload validation, flood controls, malicious/corrupted/replayed packet handling |
| Android project / signed APK | **Absent** | Reproducible Android project, device build and install tests |

### Security detail: exact address

`mesh.js`'s `shareAddress()` constructs `newPacket('address', ..., {building: a.building, directions: a.directions})` in plaintext. The `sharedAddressAt()` method limits display to the intended node, but a forwarding device that has the serialized payload would be able to inspect it. **Do not claim cryptographic privacy.** For a genuine build, implement authenticated encryption using established libraries/protocol designs. If cryptography cannot be safely completed, retain the precise address locally and explain manual sharing rather than misrepresenting it as protected.

### Engineering risks

- A browser WebView wrapper alone does not enable native Bluetooth communication.
- Bluetooth LE APIs on Android need runtime permissions and hardware feature checks. Some phones cannot advertise; scanner/peripheral combinations differ by model.
- Android background scanning/advertising is constrained by OS lifecycle and battery policy. There is no general guarantee of perpetual forwarding while the app is closed.
- Nearby Connections supports offline transfers but is backed by Google Play services and may use Bluetooth/BLE/Wi-Fi. If the product premise requires no Google services, choose a direct Android BLE transport or disclose the dependency. Test truly disconnected devices.
- Users explicitly approving an APK share/install is not equivalent to a simulation toggling `hasApp=true`.
- In disaster coordination, success must mean at least a message delivered to a nearby device and a valid returned reply; receiving an offer is not proof of rescue.

## Release gates

1. GitHub baseline: new **private `relay` repository**, complete organized original source, tests and docs pushed, tag baseline, no destructive history rewrite, no secrets.
2. Engineering design: real Android app architecture with transport, protocol, state machine, storage, security, and runtime limitations documented.
3. Local build: Android debug APK compiles and installs (a test APK is allowed before final gate).
4. Physical radios: **minimum 2 Android phones**, fully offline with Wi-Fi off, discover/connect/exchange messages; preferably **3 Android phones** with proven A→B→C multi-hop and no direct A↔C link.
5. Reliability: reboot/reopen, loss/reconnection, dedupe, TTL/renewal, photo bytes, queued replies, battery/background behavior, runtime permission denied/regranted, malformed payload, plus app UI regression.
6. Security: exact-address protection backed by actual encryption, or feature restricted/labeled to avoid false privacy claims.
7. Final release: only mark **usable** if hardware tests pass. If hardware unavailable, label the APK **demo/test build**, commit work to feature branch, and clearly state release blocked. Do not fabricate physical test results.
8. Final GitHub push: commit verified changes, push source and tests, include reproducible build instructions, release the APK as a downloadable build artifact rather than committing keystores or binary build directories.

## Useful official Android references

- [Android Bluetooth permissions](https://developer.android.com/develop/connectivity/bluetooth/bt-permissions)
- [Communicate in background over BLE](https://developer.android.com/develop/connectivity/bluetooth/ble/background)
- [Background data-transfer work](https://developer.android.com/develop/background-work/background-tasks/data-transfer-options)
- [Bluetooth LE central/peripheral and GATT roles](https://developer.android.com/develop/connectivity/bluetooth/ble/ble-overview)
- [Nearby Connections API overview](https://developers.google.com/nearby/connections/overview)

The research sources above support feasibility of implementation, **not** a claim that Relay's actual mesh backend is complete or that any particular phone pair will work.

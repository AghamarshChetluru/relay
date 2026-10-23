# ADR-001: Phone-to-phone transport and app architecture

Status: accepted for the `feature/android-offline-mesh` branch. Date: 2026-10-23.
**Nothing in this ADR has been validated on physical radios yet** (see `QA_REPORT.md`).

## Context

Relay v2.2 is a browser simulation: `prototype/mesh.js` models 80 phones inside one JavaScript process. There is no radio, no persistence, no real identity, no real attachment transfer, and the exact address is plaintext in the modelled `address` packet (independent audit, release blocker). A usable app needs independently running phones that exchange bytes with no internet, no GPS, no server and no cloud account.

## Decision 1: transport = native Android Bluetooth LE (GATT), not Nearby Connections

| | Native BLE GATT (chosen) | Nearby Connections (alternative) |
|---|---|---|
| Needs Google Play services | **No** | Yes |
| Works offline | Yes | Yes |
| Radios used | Bluetooth LE only (what we claim and can state) | Bluetooth, BLE, **Wi-Fi** (chosen by the library; "Bluetooth-only" would be inaccurate) |
| Throughput | Low (~10–100 kB/s realistic). Fine for ~1 kB text and ~15 kB photos | Higher |
| Control over discovery, roles, back-off, budgets | Full | Limited (library decides) |
| Hardware requirement | LE advertiser support for "discoverable" role (not all phones) | Play-services-certified devices |
| Risk | Per-phone BLE quirks (MTU, advertising, background scan limits) | Dependency on a proprietary service |

Relay's premise is "works when infrastructure is gone", so avoiding a Google-services dependency wins. Nearby Connections stays a documented fallback; it is **not implemented** and not claimed.

Peers that cannot advertise (no LE peripheral support) still work as **scan-only initiators**: they can connect to and exchange with discoverable phones but cannot be discovered by others. This is detected at runtime and shown honestly ("this phone can only look for others").

## Decision 2: hybrid app = WebView hosting the existing mobile UI + native Kotlin core

* Keeps the approved mobile design (`prototype/index.html`, `style.css`, `app.js`) as the single UI source; Gradle copies it into the APK assets. The desktop simulator is untouched.
* **All networking, storage, crypto and routing run natively.** The WebView is only a screen. A bridge (`@JavascriptInterface`) sends user intents to native code and receives state snapshots. This is explicitly **not** a "WebView wrapper of the simulation": the simulation is not shipped in the Android app's radio mode.
* A fully native UI would take much longer to reach parity with the reviewed design and would fork the product. The cost of the hybrid choice is a JS adapter (`native_bridge.js`) that rebuilds the engine's view state from the on-device database.

## Radio roles and discovery

* Every phone runs a **GATT server** (service UUID `7e5a1c00-…`, characteristics `INBOX` write, `OUTBOX` notify) and, if supported, **advertises** the service UUID plus a 6-byte scan-response tag (4 B device tag + 2 B inventory digest).
* Every phone **scans** for the service UUID in duty cycles (default: 10 s scan every 60 s, low-power mode; 30 s/20 s burst for the first minute after the app opens or the inventory changes).
* **Role rule** (avoids two simultaneous connections): the phone with the lexicographically smaller device ID initiates; if only one side can advertise, the scan-only side initiates. A per-peer cooldown (default 60 s) and a global cap (2 concurrent sessions) bound battery and radio use. If the peer's inventory digest has not changed since the last session, no connection is made.
* After connect: request MTU 247, enable notifications, then run the link protocol below.

## Link protocol (versioned, transport-independent)

`HELLO` (protocol version, device ID, signing key, HPKE key, capabilities, declared neighbourhood + age) -> `INV` (id, type, priority, remaining lifetime, size, hops, for what the sender holds and policy allows) -> `WANT` (ids the receiver lacks and will accept) -> `PKT` (signed envelope + unsigned per-hop fields) -> `PACK` (peer stored it; this is the only thing that may be shown as "shared with a nearby phone") -> optional `ATT_REQ`/`ATT_CHUNK`/`ATT_ACK` for photo bytes with offset resume and SHA-256 verification.
All frames are length-prefixed and bounded; any malformed, oversized, unsigned or badly-signed frame closes the session.

## What happens when things are missing

| Situation | Behaviour |
|---|---|
| Bluetooth off | Core keeps working (create, read, store). Status shows "Bluetooth is off". Nothing is queued as "sent". Re-enable resumes scanning. |
| Permission denied | Radio stays off; UI explains which permission and offers Settings. Storage/UI still work. |
| No peers nearby | Packets stay stored and retried when a peer appears. UI says "Saved on this phone". |
| App killed / reboot | Durable store survives. Radio resumes when the app/service starts again (no silent auto-start on boot is promised). |
| Phone cannot advertise | Scan-only mode (above). |

## Consequences / risks (accepted)

* Background relaying is **not guaranteed**: it depends on a user-visible foreground service, OEM battery policy and Doze. Documented in `LIMITATIONS.md`.
* Real throughput and range are unmeasured until field tests are done.
* BLE GATT is a connection-oriented, per-pair channel; a phone talking to many peers uses small sequential sessions, not broadcasts.

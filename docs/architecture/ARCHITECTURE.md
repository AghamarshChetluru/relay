# Relay architecture (browser baseline vs Android build)

## 1. Current state of the baseline (plain audit)

* `prototype/mesh.js` simulates **80 devices in one JavaScript process** with a global state object `S` (nodes, edges, requests, packets, inboxes). It is deterministic and well tested, but it is a model, not a protocol.
* There is **no Android code, no Bluetooth, no durable storage** (only the declared area in `localStorage`), no cryptographic identity, predictable IDs (`R1`, `P1`), a simulated clock (1 step = 1 minute), a single shared in-memory attachment object instead of byte transfer, and exact addresses in plaintext inside the simulated `address` packet.
* `prototype/app.js` is coupled to that global world (seeded messages, persona switching, auto-stepping clock).

### What can be reused

| Reuse | Where |
|---|---|
| Per-type routing rules (flood / directed / opportunistic, detour, patience, fan-out, target containment), priorities, validity constants, 10-area neighbourhood graph | ported to Kotlin (`core/Policy.kt`, `core/Neighborhoods.kt`) and checked against the JS engine by shared scenarios |
| Phone-local status semantics (case vs packet versions, replies, ack, resolve, expiry) | `mesh.js` view functions are reused unchanged by the WebView through an adapter that loads real on-device data |
| Mobile UI and design | `prototype/index.html`, `style.css`, `app.js` (guarded `RelayNative` mode, no behaviour change in the browser) |
| Test ideas and invariants | re-expressed as Kotlin tests |

### What had to be written new (true multi-device protocol)

Collision-resistant IDs, signed envelopes and device identity, wire format with limits, link protocol (inventory / want / packet / ack), BLE GATT transport, durable store-carry-forward queue and seen-ID tombstones, real-time expiry with skew handling, chunked photo transfer with integrity, end-to-end encrypted address sharing, foreground-service lifecycle, runtime permissions, APK sharing, and abuse limits.

## 2. Android build structure

```
android/
  app/src/main/kotlin/app/relay/
    core/      pure Kotlin (JVM-testable): Ids, Wire (codec), Envelope, Validation, Policy, Neighborhoods,
               LinkProtocol (sessions over an abstract Channel), RelayEngine, Store (interface), CryptoProvider
    store/     SqliteStore (Android), schema + migrations
    ble/       BleTransport, GattServerController, GattClientSession, Framing (fragmentation), Advertiser/Scanner
    service/   RelayService (foreground, connectedDevice)
    ui/        MainActivity (permissions, WebView host), NativeBridge (@JavascriptInterface)
    share/     ApkShare (explicit user-initiated APK sharing + SHA-256)
  app/src/main/assets/   copied from prototype/ at build time + native_bridge.js
  app/src/test/          JVM unit/property tests
  app/src/androidTest/   instrumentation tests (need an emulator/device)
```

### Data flow

```
user action in WebView  --NativeBridge-->  RelayEngine.create*()  --> Store (SQLite) --> snapshot --> WebView re-render
BLE link session  --> LinkProtocol --> validate + dedupe + policy --> Store --> snapshot / forward to next peer
```

### Identities

* **Device ID** = first 16 bytes of SHA-256(Ed25519 public key). Key pair created on first run and kept in Android Keystore-protected storage.
* **Case ID**: 16 random bytes (SecureRandom) hex. **Packet ID**: first 16 bytes of SHA-256 over the canonical signed body (content-addressed, so integrity and dedupe are the same check). **Attachment ID**: first 16 bytes of SHA-256 of the photo bytes.

### Time

Each hop forwards a *remaining lifetime* (not an absolute timestamp); the receiver converts it to its own wall-clock expiry at receipt and never trusts the sender's absolute clock. Signed validity caps remaining lifetime. Display age = validity - remaining at receipt + elapsed since.

## 3. Reality checks

The browser prototype's tests cannot say anything about Bluetooth. See `QA_REPORT.md` for which Android behaviours were tested where (JVM, emulator, physical phones), and `LIMITATIONS.md`.

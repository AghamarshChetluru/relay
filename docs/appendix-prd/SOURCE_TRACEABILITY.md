# Source and verification ledger: Relay PRD appendix

Companion to `Relay_Complete_PRD_Appendix.pdf`. Readers of the PDF do not need this file; it records where each claim came from.

**Source of truth:** Android app, branch `feature/mobile-inbox-final-polish`, commit `8a2458596181dd9e80d5050e15022afae102733a`. Implementation facts come from that code. Product motivation comes from the supplied case materials. Where they disagree, the code wins and the disagreement is listed in section 4.

Source classes used below: **CODE** (Android/Kotlin and the bundled UI in `prototype/`), **DOCS** (repository docs), **CASE** (supplied handoff documents in `~/Downloads`), **EXT** (external research, verified), **ASSUME** (assumption or proposed future work, never presented as built).

## 1. Claim ledger

| Claim in the PDF | Class | Where it comes from |
|---|---|---|
| App is Kotlin BLE engine, SQLite store, bundled WebView UI, native notifications; not Flutter | CODE, DOCS | `android/app/src/main/kotlin/app/relay/{core,ble,store,ui,service}`; `docs/TRANSPORT_ADR.md` decision 2; `docs/INBOX_AND_NOTIFICATIONS.md` intro |
| Android 8.0+ with BLE | DOCS | `docs/QA_REPORT.md` (field-test build, minSdk 26) |
| No INTERNET permission | CODE, DOCS | `AndroidManifest.xml`; `docs/SECURITY.md` ("No network exfiltration") |
| Ten illustrative Delhi neighbourhoods, declared by the user | CODE | `core/Neighborhoods.kt`; onboarding screen in `prototype/app.js` (`screenOnboarding`) |
| Area reminder about every 30 min; unconfirmed after 60 min counts as unknown for routing | CODE | `core/Policy.kt` (`remindMs`, `staleMs`, `reliable`); `prototype/app.js` (`openArea`, `locationPrompt`) |
| Radio status strings and states | CODE | `prototype/app.js` `radioState()` |
| Request categories; urgent 30/60/120 min; general up to 360; missing 1440; replies up to 120; broadcast up to 60 | CODE | `core/Validation.kt` (`URGENT_CATS`, `MAX_*_MS`); lifetime chips seen in the UI; `prototype/mesh.js` `VALIDITY` |
| Field limits: description 240, broadcast 280, title 100, envelope 4096 B, 500 stored packets, 30 packets/hour per origin | CODE | `core/Limits.kt` |
| Title generated from category and landmark | CODE (observed) | Saved-confirmation screenshot: “Medical help needed near Hauz Khas Metro, Gate 2” |
| Photo ~10–15 KB, ≤ 32 KB JPEG, sent after text, lowest priority, 1 KB chunks, SHA-256 | CODE, DOCS | `core/Limits.kt`; UI copy on the Find someone form; `docs/SECURITY.md`; `docs/LIMITATIONS.md`; `core/Model.kt` `priorityOf` |
| Priorities: urgent 0, other requests 1, broadcast and attachment 2 | CODE | `core/Model.kt` `priorityOf` |
| Flood 60 hops for requests, replies, acks; broadcast 30 hops | CODE | `core/Policy.kt` `PolicyConfig`, `routeFor` |
| Directed routing for missing-person reports: 40 hops, 3 copies toward target, 1 detour (+2 when patient after 16 min), detour wait 3 min, ≤ 2 detour copies | CODE | `core/Policy.kt` `offer`, `PolicyConfig` |
| Opportunistic fallback: 10 hops, 3 copies | CODE | `core/Policy.kt` `routeFor` |
| Graph-hop proximity, not GPS | CODE | `core/Neighborhoods.kt` (`distance`, `distanceToSet`) |
| Remaining lifetime forwarded, receiver sets own expiry | DOCS, CODE | `docs/ARCHITECTURE.md` “Time”; `core/Engine.kt` `receive` (`remaining = min(hop.remainingMs, validityMs)`) |
| Stored copy dropped 30 min after expiry unless it involves this phone | DOCS, CODE | `docs/INBOX_AND_NOTIFICATIONS.md`; `core/Engine.kt` `EVICT_GRACE_MS` |
| Scan 10 s every 60 s; burst 10 s every 20 s for 3 min; ≥ 8 s between starts | CODE | `ble/BlePolicy.kt` `ScanPlanner` |
| Smaller tag dials; cooldown 60 s (10 s with news); back-off 15 s to 10 min; 2 sessions; skip when digests unchanged | CODE | `ble/BlePolicy.kt` `PeerPolicy`; `ble/BleTransport.kt`; `docs/TRANSPORT_ADR.md` |
| 6-byte advert tag (4 B rotating hourly + 2 B digest) | CODE | `ble/BlePolicy.kt` `AdvertisingState` |
| Link protocol HELLO → INV → WANT → PKT → PACK; only PACK may show “Shared with a nearby phone” | DOCS, CODE | `docs/TRANSPORT_ADR.md`; `docs/SECURITY.md` “Honest delivery state” |
| BLE GATT chosen over Nearby Connections (no Play services, BLE only) | DOCS | `docs/TRANSPORT_ADR.md` decision 1 |
| Throughput ~10–100 kB/s; background relaying not guaranteed; no restart after reboot | DOCS | `docs/LIMITATIONS.md` |
| Ed25519 signatures; ownership by case ID; sealed address to one volunteer (X25519, HKDF, AES-256-GCM); Keystore-wrapped keys; backup off | DOCS, CODE | `docs/SECURITY.md`; `core/Crypto.kt`; `store/KeystoreProtector.kt` |
| What is not protected (text, photos, areas readable; pseudonymous; no identity checks; custom crypto unreviewed; no audit) | DOCS | `docs/SECURITY.md` “What is NOT protected” |
| Inbox groups, search semantics, read state, refresh behaviour | DOCS, CODE | `docs/INBOX_AND_NOTIFICATIONS.md`; `prototype/app.js`; `core/Inbox.kt` |
| Notification rules and “important” classification | DOCS, CODE | `docs/INBOX_AND_NOTIFICATIONS.md`; `core/Inbox.kt` `classify`; `ui/Notifier.kt` |
| APK sharing from About, installer consent | CODE, DOCS | `prototype/app.js` (`about-share`, `NB.shareApp`); `share/ApkShare.kt`; `docs/SECURITY.md` |
| Test results (108 JVM, 28 instrumented, UI suites, lint) | DOCS | `docs/INBOX_AND_NOTIFICATIONS.md` final-polish results; `docs/QA_REPORT.md` for the earlier counts |
| Team-reported physical-phone success (no count quoted) | CASE | Handoff section 5 quotes success “in 2 phones”; the owner later said 4+ phones (session notes, 25 Oct 2026). Neither has models, settings, timings or logs, and the brief forbids inventing counts, so the PDF states no number |
| Problem framing, users and jobs, alternatives table, principles | CASE | “Product Context Handoff (Expanded)” sections 1, 1A.2 to 1A.4. The handoff itself says the alternatives table is a reasoned comparison, not a scored study; the PDF repeats that |
| Assumption register and validation methods | CASE, ASSUME | Handoff section 1A.7 (A04, A13 flagged as most fragile); condensed to seven rows |
| Proposed measures and north star | CASE, ASSUME | Handoff section 1A.8; all labelled proposed, none measured |
| RFC 4838; Epidemic Routing; Spray and Wait; Bluetooth Mesh spec; two Android pages | EXT | Section 3 below. Cited for design context only |
| Decision register (8 decisions) | CODE, DOCS, CASE | `docs/TRANSPORT_ADR.md`; `docs/SECURITY.md`; handoff section 4 and 1A.9. “Revisit if” column is the author’s proposal (ASSUME) |

**Not used on purpose:** the 19% replay figure (small simulated graph; not field evidence), any Briar comparison (the site was unreachable for checking), any adoption, battery or latency numbers (none exist).

## 2. Screenshot provenance

All screenshots are captures of the real Android app: debug build of commit `8a24585` on an Android 14 (API 34, arm64) emulator, 1080×2400, status bar removed for the page. **The emulator has no Bluetooth neighbours**, so some states needed staging.

| Asset | How it was produced | Staged? |
|---|---|---|
| `annotated_01_onboarding` | Fresh install, first launch | No |
| `annotated_02_home` | Hauz Khas phone, no messages | **Yes**: “Phones seen nearby · 4” injected into the radio’s recent-peer table by a test hook (no phone connected) |
| `annotated_03_request_composer`, `annotated_04_missing_person` | Text typed into the real form fields with `adb input` | No (data typed by hand) |
| `annotated_05_inbox` | Green Park phone | **Yes**: six requests and updates delivered as real signed packets from in-memory peer phones through the engine’s receive path; ages set through remaining lifetime; reminder state set by back-dating the last area confirmation |
| `annotated_06_offer_help` | Request sheet opened from the Inbox; offer text typed | Packets as above |
| `annotated_07_reply_ack` | Requester phone; the request was created in the real form | **Yes**: two offers created by in-memory peers and delivered as signed packets |
| `annotated_08_my_activity` | Same phone after a real link session | **Yes**: “Shared with a nearby phone” came from a real link session (`Pipe.run`) between the app and an in-memory peer |
| `strip_area_sheet`, `strip_photo_validity`, `strip_address_shared`, `strip_renew_resolve` | Crops of captures above | As their source |
| `strip_notification_summary` | `docs/screenshots/final-polish/android-shade-summary.png` from the repository (earlier emulator capture, same branch) | Notifications posted by the team’s manual fixture |

The staging code is test-only (`android/app/src/androidTest/kotlin/app/relay/ScreenshotFixture.kt`, copied to `build/ScreenshotFixture.kt.txt`). It was not committed and does not ship in the APK. No application code was changed.

Annotations were added by `build/annotate.py`: a translucent highlight band and a numbered marker outside the phone. The screenshot pixels are otherwise unchanged. Diagrams are hand-written SVG (`assets/diagram_*.svg`, `assets/wireframe_*.svg`). The information-architecture figure is labelled as a structural wireframe, not a screenshot.

## 3. External references checked

| Reference | Check |
|---|---|
| RFC 4838, `https://www.rfc-editor.org/rfc/rfc4838.html` | HTTP 200 |
| Vahdat and Becker, `https://cseweb.ucsd.edu/~vahdat/papers/epidemic.pdf` | HTTP 200 |
| Spyropoulos et al., `https://doi.org/10.1145/1080139.1080143` | The publisher blocks scripts (HTTP 403). Title, first author, year and venue confirmed through the Crossref API |
| Bluetooth Mesh Protocol, `https://www.bluetooth.com/specifications/specs/mesh-protocol/` | HTTP 200 |
| Android Bluetooth permissions; Android BLE background | HTTP 200 each |
| Briar (omitted) | Unreachable from the build machine; not cited |

## 4. Discrepancies found

1. **Physical testing.** `docs/LIMITATIONS.md` and `docs/QA_REPORT.md` say no physical radio testing had been done. The team later reported success on real phones: “2 phones” in the case handoff, “4+ phones” in a later statement. No result sheet was ever recorded (`docs/FIELD_TEST_CHECKLIST.md` is blank). Treated as team-reported, unmeasured, and no count is printed.
2. **Burst scanning.** `docs/TRANSPORT_ADR.md` says “30 s/20 s burst for the first minute”. The code is a 10 s window every 20 s for 3 minutes (`ScanPlanner`).
3. **Test counts.** QA report: 93 JVM, 18 instrumented. Final-polish notes: 108 JVM, 28 instrumented. Different dates; the PDF quotes the later figures and says so.
4. **UI label.** For a missing-person case the request detail sheet heads a sighting “Offer of help · Unverified”, while My activity says “Sighting received”. Behaviour is unaffected.
5. **Code layout.** `docs/ARCHITECTURE.md` lists planned file names (for example `Ids`, `Wire`, `LinkProtocol`); the actual core files are `Bytes`, `Crypto`, `Framing`, `Link` and others.
6. **Address encryption wording.** `docs/ARCHITECTURE.md` says “end-to-end encrypted address sharing”. The PDF says “sealed to one recipient” and states the app is not end-to-end encrypted overall, following `docs/SECURITY.md`.

## 5. Limits of the evidence

- No physical-device logs, models, timings or battery data are on record.
- Multi-hop delivery has been tested only with in-memory links, not real radios.
- Photo transfer over the radio, in-app APK installation, and behaviour with the screen off are untested on hardware.
- The two-pager itself was not available in the workspace, so the appendix aligns with the framing in the product-context handoff rather than the submitted wording.
- The feature inventory was used for scope; the PDF groups its 136 features into twelve capabilities rather than listing each.

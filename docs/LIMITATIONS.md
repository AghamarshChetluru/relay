# Known limitations

## Verification status (most important)
* **No physical-device radio testing has been done by the author of this build.** Bluetooth discovery, GATT exchange, advertising, MTU behaviour, background operation, battery use and multi-hop over real radios are **implemented but UNVERIFIED**. See `QA_REPORT.md` for exactly what was and was not tested, and `FIELD_TEST_CHECKLIST.md` for how to test it.
* Logic-level multi-hop (A→B→C) is tested with in-memory links. That proves the protocol rules, not Bluetooth.

## Radio and platform
* Some phones cannot advertise (no LE peripheral support); they can only look for others (shown in the UI). GATT stacks differ by model; connection errors (e.g. status 133) are handled by backing off, not by device-specific workarounds.
* BLE throughput is low (roughly 10-100 kB/s in practice). Text is instant; a 15 KB photo may take seconds to minutes per hop.
* Background relaying is **not guaranteed**: Android Doze, battery savers and OEM task killers can pause or stop the foreground service. There is no automatic start after reboot; the user opens the app (messages themselves are persistent).
* Android 11 and older tie BLE scanning to the location *permission* (Relay does not read location). Android 12+ uses nearby-device permissions with `neverForLocation`.
* Company ID 0xFFFF in advertisements is reserved for testing; a production build needs a registered ID or a different discovery scheme.
* Only two simultaneous sessions; a peer is retried with exponential back-off up to 10 minutes. Dense crowds will take longer to exchange.

## Protocol and product
* Directed (missing-person) routing is neighbourhood-aware, not geographic; the 10-area Delhi graph is an illustration, not a survey. In a small, connected city it saves roughly 19% of copies to first delivery in replay; savings at city scale are unmeasured. After a long time a message that is still alive can reach most phones.
* The pairwise policy differs from the browser simulation: decisions are made per contact, with a 3-minute wait before detours and a per-phone cap on detour copies (documented in `ARCHITECTURE.md`).
* Declared neighbourhood is manual. A phone that moves without updating is treated as unreliable after 60 minutes for routing, but is not corrected automatically.
* Photos: JPEG only, up to 32 KB; the UI targets 10-15 KB.
* One identity per install. Reinstalling or losing the Keystore key creates a new identity: old cases can no longer be renewed by the new install.
* Migrations: database schema v1 is the first version; `onUpgrade` is empty until the first schema change.
* The desktop simulator and browser prototype are unchanged simulations and are not part of the Android radio path.

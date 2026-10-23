# Relay v2.2 – QA report (23 Oct 2026)

Artifact: `relay-prototype-v2.2.zip` (7 files: index.html, simulator.html, style.css, sim.css, mesh.js, app.js, sim.js).
Every suite below was run against the **extracted ZIP over file://** in headless Chrome (no server). Chrome only; no real-phone testing.

## What changed
- **Routing by message type** (mesh.js): emergency = flood; missing person = neighbourhood-directed with bounded detours; broadcast = hop-limited low-priority flood.
- **Declared neighbourhood, no GPS**: first-run picker, area chip, manual update, 30-minute reminder, stale after 60 minutes (not trusted for routing).
- **Emergency form**: "Where is help needed?" with neighbourhood, landmark, optional private exact address shared only per volunteer (sealed packet).
- **Missing-person form**: last known location (drives the target neighbourhood), last contact, note, optional photo compressed on the phone (~10-15 KB).
- **Validity and renewal**: urgent 30 min / 1 h (default) / 2 h; general help 6 h; missing person 24 h; renewal = new packet, same case.
- **IDs and storage**: case / packet / attachment IDs, one stored copy per packet, superseded versions not forwarded, expired cache cleanup after a 30-minute grace, storage cap.
- **Help Others feed**: validity left, reported neighbourhood, proximity, age, photo / exact-address badges, "Expired or resolved" section, neighbourhood + type filters.
- **Simulator**: layout unchanged. Zone labels now Delhi neighbourhood names; scenario 2 names a target area; one narrative line for directed messages.

## Tests passed (extracted ZIP)
| Suite | Result |
|---|---|
| Engine regression (80 nodes, journey, broadcast, priority, local statuses, reset) | 63 / 63 |
| Engine v2.2 (neighbourhoods, reminders, flood vs directed, no-stuck property, expiry, renewal, dedup, attachments, sealed address, eviction/cap) | 75 / 75 |
| Mobile app at 375 / 390 / 430 px | 140 / 140 at each width (430 px run 3 times) |
| Mobile app with background delivery (no focus theft) | 4 / 4 |
| Desktop simulator at 1280 / 1440 px (all three scenarios) | 73 / 73 at each width |
| Top-level open of both pages with no browser flags | no console output |
| Static scan for network fetches / geolocation | none |

Brief items covered by tests: manual neighbourhood (1, 2), reminders that do not interrupt a request (3), broad emergency propagation (4), directed missing-person routing and
same-area + bounded-detour behaviour (5, 6), last known location (7), private address with intentional sharing (8), photo compression and display on received requests (9, 10),
expiry and no forwarding after expiry (11, 12), renewal keeps the case and creates a new packet (13), no duplicate cards (14), distinct replies kept (15), filters reflect only received
messages and never change forwarding (16), acknowledgment/resolution (17), simulator scenarios (18), 375/390/430 (19), extracted-ZIP file:// (20).

## Routing results (measured, not assumed)
Property test over every source phone and 10 target neighbourhoods, bridge installed: **0 of 621 source/target pairs ever stuck**.
Efficiency versus flooding (same pairs): final spread **54.6 vs 62.9 phones** (about 13% fewer); cost to first reach the target area **22.5 vs 25.4 phones**
(about 11% fewer) at **8.3 vs 7.7 steps** (about half a step slower). These savings are modest because the simulated city is small (80 phones, graph diameter 4).
A tighter setting that spreads to ~46 phones left 14 pairs stuck, which the brief rules out, so it was not used.

## Bugs found and fixed
- **Fan-out budget trapped packets** (a phone spent its budget on same-area neighbours and never used its only exit). Fixed: the budget now limits better-direction copies only; detours take over when exhausted.
- Directed routing initially behaved almost like flooding in this small graph; added away-limits, target-area containment and a measured patience escalation.
- Tests initially assumed too much (component size vs all phones; expiry timeline with cache grace; area staleness). Corrected.
- One early 430 px run failed to see the compressed-photo preview within the test's wait; with a longer wait it passed 5 of 5. Cause not proven (likely test timing against browser image-encoding threads).

## Limitations (honest)
- Everything is simulated: no Bluetooth, installation, GPS, or real emergency path. Seeded messages and nearby phones are fictional. The neighbourhood graph is a coarse illustration, not a survey.
- The sealed exact address is **modelled** (only the addressed phone can read it); a real build would need end-to-end encryption.
- Photos are tiny JPEGs and travel as a separate low-priority packet; real Bluetooth image transport is not implemented or claimed.
- A user's declared area changes how others route to them, but the simulated radio links do not change (we do not simulate movement).
- Directed routing helps less in a small, well-connected city; its value at city scale is not demonstrated here.
- App time is a simulated clock (1 step = 1 minute); the quiet background clock runs fast and slows when nothing moves. Reviewers can pause it or skip ahead.
- No persistence beyond the stored area. Chrome only. Simulator is desktop-first; the dedicated views of broad vs directed routing are deferred as agreed.

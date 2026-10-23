# Simulator V4.1: logic, semantics and interaction audit

Branch `feature/simulator-v4-logic-fixes`, from `feature/simulator-v4` at `64da7a4`. No redesign: the light interface, navy stage, camera, previews and Story/Explore split are unchanged. This document records what was wrong, why, how it was fixed, and which test now catches it.

## Method

1. Drove the real engine through all three scenarios in Node and compared what `sim_explain.js`, `sim.js` and `story.js` would say with what the engine state is (`/tmp` probes, now folded into `tests/sim_semantic_test.js`).
2. Drove the real page with real clicks and compared every claim on screen with the engine after every paint and action (`tests/sim_v41_test.html`).
3. Fixed **models, not strings**: a wording-only patch would have left the wrong number behind it. Where the old code had no model (eligibility, a true before/after, an active packet), one was added.
4. Ran each new suite against the **unfixed V4**: it fails there (30 of 68 engine-level checks; 25 browser checks plus a crash) and passes on the fix. Then re-broke three fixes on purpose to confirm the browser suite guards the models (section 5).

Engine routing, priorities, expiry and the simulated topology are unchanged. The only engine-file change is `Mesh.requestView` (a view function: which status words a phone shows), plus its tests.

## 1. Confirmed defects

| # | What the page said | What the engine state was | Root cause | Fix | Regression test |
|---|---|---|---|---|---|
| 2 | Reply: "I'm close by and can help. I'm a nurse (self-reported)." from p80, who declares Connaught Place, to a requester in Hauz Khas | p80 only *received a packet*. Nothing says it is near, qualified or willing | The demo script put credentials and proximity in the responder's mouth | Example reply is `I received your request. I may be able to help. Please share more details.`; action is **Send example offer**; card is **Example reply** with "The owner chooses whether to send it. Relay delivers; it does not decide."; the payload `area` is blank and the responder's *declared* area is shown as "From a phone that declares X"; nothing is sent unless the person acts | V4.1 §1: reply text/payload, banned-wording monitor on every paint, 4s no-response wait |
| 3 | A missing-person sighting was "Your offer is saved…/shared onward/Offer received" | the reply kind was `sighting` | `Mesh.requestView` had one vocabulary for every reply | Type-aware labels for saved, forwarded, received, acknowledged, and acknowledged-by-requester, both kinds (`replyWords`); notes differ ("unverified" vs "not proof of help") | Semantic §A: 14 checks per kind (saved, forwarded, received, no hidden receipt, ack, ack-arrival, no cross-vocabulary); V4.1 §3 (sighting statuses in the page); engine tests updated |
| 4 | Ack packet: "The requester accepted the offer of help." | `createAck` only records that the requester saw the reply | The explanation invented an acceptance step that does not exist | "The requester saw the offer. That does not mean it was accepted or that help is on the way." (sighting: "…checked or confirmed") | Semantic §A, V4.1 §1 (done: "acknowledged", never "accepted") |
| 5 | Zones drawn as "HAUZ KHAS", "LODHI COLONY · TARGET AREA / 2 STEPS AWAY" | 11 phones declare an area different from their cluster (p77, p80 declare Connaught Place but are drawn in Lodhi Colony). Routing uses the *declared* area | Zone rectangles were labelled and highlighted as if they were declared neighbourhoods | Clusters are named as clusters ("…CLUSTER" in Explore); the **target** is shown as the phones that actually declare it (violet rings, key "Declares Lodhi Colony"); tooltips say "Declares X (drawn with the Y cluster)"; the schematic note says clusters are where phones meet. Declared areas were **not** changed to fit the drawing | Semantic §B (11 mismatches, all described by what they declare; p77 is one step from Lodhi Colony, not "in" it); V4.1 §1 hover tips, §3 rings = declaring phones |
| 6 | "Could still receive 11" for a stopped steered packet; "Pending: a Relay route exists" | zero eligible next hand-offs; of 11 connected phones, 3 sit next to a holder that withholds it and 8 are not next to any holder | `groupsFor` is graph connectivity; the UI read it as eligibility | New `reach()` splits connected phones by the engine plan (eligible next / held back by policy / connected but not adjacent) and `stopReason()` names the cause (lifetime, gap, policy, nothing left) with both counts. Wording: "Connected, not received". Explore shows the breakdown and "Stopped by its routing policy"; the destination pill says "Connected: this policy may not send it there" for steered packets. Story keeps one outline style and its copy never promises delivery ("routing rules decide where it goes") | Semantic §D (counts 52/11/3/8, invariant over 320 steps); V4.1 §3, §3b (exact 52/11 case in Explore) |
| 7 | "Newly reachable" = everything now connected (33) | 1 phone was already connected; 31 became connected because of the install; the bridge is a 32nd, counted separately | The count was the whole post-install collection, not a difference | `snapshotConn`/`diffConn`: before and after sets; the bridge and already-connected phones are excluded. "Newly connected" is 31. The responder pool and the crossing sentence use the same set | Semantic §C (partition identity `after = before + new + bridge`, reproduction 1/31/33); V4.1 §1/§3 |
| 8 | A cached "A gets it / B held back" card stayed after the engine moved on | the plan changes almost every tick (5 distinct plans in 7 ticks) | `V.decision` was cached | The decision is recomputed (`decisionPair`) whenever the engine tick differs from the card's tick; **Step is hidden while a card is open**; the card says "Next step:" | Semantic §E; V4.1 §3 (outside Step, Explore round trip) |
| 9 | Story stopped when Explore had selected a finished request | Story was tracking the reply | `play()` and the tick loop used Explore's `st.pid` | `play(until, pid)` / `st.playPid`: Story passes its own active packet; Explore's selection is irrelevant to Story playback | V4.1 §2 (the exact 8-step sequence; fails on V4) |
| 10 | "The request reached 31 phones" | 31 includes the sender; 30 others received it | Loose "reached/received/have" | "have it" (includes the sender) for the big number; "reached N other phones" (excludes the sender) in the sentence | V4.1 §1 (sentence vs engine on every paint) |
| 11 | Reply: "Travels with its request" | it is a new flooding packet that may take any route | Copy reused the request's wording | "A new packet with its own route. It may not follow the request's path, and arrival is not guaranteed." Reply hop reasons no longer say "emergency requests go to every neighbour" | Semantic §A; V4.1 §3 (Explore message card) |
| 12 | "Water collection point open at City Hall, north entrance." (a fact, location unrelated to the poster) | scripted sample | Report written as fact | "A neighbour reports a water collection point in {poster's declared area}. Not verified." The urgent request is also a report in the poster's area; missing-person previews say "Reported by the requester, not confirmed" | V4.1 §4 (payload area = poster's declared area), §3 |
| 13 | Tooltips/dialogs could say "Clinic volunteer", "Green Park volunteer" | those are seeded engine names | Engine labels leaked | `SimExplain.nm`: only the requester ("My phone") and the bridge ("Crossroads phone") keep descriptive names; everyone else is "Phone pNN". The seeded nodes and routing are untouched | Semantic §B (all 80 phones), V4.1 §1 (hover), §6 (install dialog) |
| 14 | The demo ended in a reply as if reaching phones guaranteed one | success is a scripted human action | No statement of the choice or of the alternative | Story: "Its owner may or may not reply. This demo sends an example…"; completion: "The reply is a simulated person's example. Relay can't guarantee delivery, replies or help."; Explore: "A request can reach many phones and still get no reply…" | V4.1 §1, §5 |

## 2. Additional defects found independently

| What | Root cause | Fix | Test |
|---|---|---|---|
| An **expired** request was explained as "one phone without Relay separates these groups" | `sawStall` was set whenever the packet could not move, and `bridge()` ignored lifetime | `expired` is its own moment ("The request expired. It lived 90 simulated minutes…"); `bridge()` returns nothing for an expired message; stop reason `expired` | Semantic §F; V4.1 §5 (Story and Explore agree) |
| After the bridge opened, a steered request that stopped with no far-side candidate would leave Story stuck on "crossing" | The moment model had only two states after a stall | `stopped` moment with the real stop reason and Replay/Explore | Covered by the moment/consistency checker; no scenario reaches it today (stated in limitations) |
| The gap screen showed "32 cut off", then "31 newly connected" | The 32nd phone is cut off behind a *different* phone without Relay | Gap number is what the bridge would connect (`unlock`), matching the later "newly connected" | V4.1 §1, §3 |
| The stopped missing-person request has a second, small gap (1 phone) besides the policy limit | One classifier, one cause | `stopReason` reports both counts and ranks by size; Explore names both | Semantic §D, V4.1 §3b |
| "From a nearby volunteer in Connaught Place" in the shared web app; "A nearby person replied"; "Posted by X in Hauz Khas" | "nearby" and "in" asserted a location and a role | "From a phone that declares X"; "(declares X)" throughout | V4.1 banned-wording monitor |
| Install dialog: "Green Park volunteer is next to the crossroads phone" | Dialog read the engine label | Neutral names + declared area | V4.1 §6 |
| Numbers card described the same 8 phones two ways | Two strings for one fact | One wording: "connected, but not next to any holder, and the packet has stopped" | V4.1 §3b |
| The mobile-app engine test hard-coded the old wording | Test coupled to production words | Updated to the corrected labels (3 assertions) | `tests/engine_v2_test.js` |

## 3. Behaviour that was already right and is now tested

- Phone previews never contain network-wide numbers (checked on every paint).
- The engine refuses a reply from a phone that does not hold the request.
- A reply or acknowledgment is never shown as arrived before it is (every paint).

## 4. Tests

| Suite | Result |
|---|---|
| `node tests/sim_semantic_test.js` (new, engine level) | 68 checks, all pass; **30 fail on unfixed V4** |
| `tests/run_sim_v41.sh` (new, real clicks, adversarial) | 103 checks at 1440×900, 1280×720 and 1920×1080, all pass; 25 fail + crash on unfixed V4 |
| `tests/run_sim_v4.sh` (Story suite) | 113 checks at 1440/1280/1920, 114 under reduced motion; all pass (assertions updated where they encoded old wording) |
| V3 (62), original simulator (73), `sim_explain_test` (27), engine (63 + 75), independent audit (28), mobile app (140) | pass (assertions updated only where they encoded the old wording or the old zone rectangle; none removed or weakened) |

The adversarial sequences covered: Step during spread; pause near the gap; Explore round trips with a different packet selected (emergency, missing, community); manual Step behind an open decision card; Reset mid-propagation; scenario switch before completion and while messages move; Replay after completion; opening and closing previews repeatedly; consent open/Escape/Not now; expiry; no reply; delayed reply; hover tips; install dialog.

## 5. Do the tests guard the models?

Three fixes were re-broken one at a time and the new browser suite (1440×900) run. Each made it fail, and each was restored byte-for-byte afterwards:

| Deliberate regression | Result | Failing checks |
|---|---|---|
| M1: Story playback uses Explore's selected packet again | 2 fail | "Story keeps playing and the reply reaches the requester"; "the acknowledgment journey finishes" |
| M2: "newly connected" counts every connected phone (V4 behaviour) | 2 fail | "the already-connected phone is NOT counted as new: before 1, after 33, shown 33"; the connect copy for a steered packet |
| M3: decision card cached, no revalidation | 4 fail | "after an outside Step the old plan is not shown as current"; "recomputed card states the CURRENT reasons"; "after Explore stepping twice and returning, the card is current or gone" |

## 5b. A defect the tests found in my own work

During final verification the hover check failed about 1 run in 4. It was not test noise: the camera tween ran only on `requestAnimationFrame`, so when frames are throttled (a hidden tab, or headless virtual time) the camera could stay part-way between two views and leave the responder outside the visible stage. Fix: a timer fallback snaps the camera to its target shortly after the tween should have ended (`story.js: setCam`). Ten consecutive runs after the fix: 103/103 each.

Also found by the V3 suite after my first pass: I had shortened the Explore header and lost "Schematic network of 80 simulated phones". Restored (product text, not the test).

## 6. Screenshots

`docs/screenshots/sim-v41/` (1440×900, real page, produced by `tests/story_shots.sh`): emergency e0 opening, e3 spreading, e4 gap, e5 connect, e6 crossing, e7 responder, e9 reply arrived, e10 acknowledged; missing person mg gap, mc connect, mr/mrp responder and sighting, md result, m3 decision, m4 after decision, a1 manual Step after the decision; community bc report, bd urgent competition; z1 expiry; r1 Story→Explore→Story.

## 7. Remaining genuine limitations

- "Eligible next step" is the engine's one-step plan. Whether a connected phone *eventually* receives a packet depends on future hand-offs and is deliberately not predicted or promised.
- Story follows one packet at a time. In the community scenario both messages appear at the busy link, but the map is not a multi-message view.
- The 11 phones that declare an area different from their cluster are visible through tooltips, the target rings and Explore inspection; the general view does not mark them individually (it would add clutter).
- The responder and poster are demo participants chosen by a fixed hash from phones the engine places on the far side. They are not random, not volunteers, and nothing about them is verified.
- In the final acknowledgment frame the "Requester acknowledged the offer" chip can sit over the Lodhi Colony cluster caption. Cosmetic; not changed (no redesign).
- The `stopped` Story moment is implemented but no shipped scenario reaches it.
- Modeled steps are ordering, not latency; one packet per link per step is a modeling constraint; positions are schematic; declared area is not GPS; the Android BLE prototype is a separate system.
- No real users have tried this.

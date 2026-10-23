# Relay network simulator v4: follow the message

Entry point (works offline, no server): `prototype/simulator.html` (open with `file://`).
Explore mode directly: `prototype/simulator.html?mode=explore`.
> **Superseded in part by V4.1** (`docs/SIMULATOR_V4_LOGIC_AUDIT.md`, branch `feature/simulator-v4-logic-fixes`): several statements below (the scripted nurse reply, "newly reachable" counts, the zone-as-neighbourhood drawing, "accepted") were corrected there.

Branch `feature/simulator-v4`, built from `feature/simulator-v3` at `70a170d`. Not merged to `main`. The Android app and its branch are untouched.

## 1. What changed from v3

v3 explained the simulation with a large graph and a permanent sidebar of cards. v4 keeps all of that as **Explore** and adds a separate, default **Story** mode whose only job is to let someone who has never heard of Relay understand it in about two minutes by watching one message move.

| | Story (default) | Explore |
|---|---|---|
| Purpose | Understand what Relay does | Inspect how it decides |
| Layout | Top bar, one headline + one sentence, a dominant network stage, a bottom rail with one action | The v3 layout: graph, Walkthrough and Inspect tabs, legend, metrics |
| Text | Headline of 3-10 words, one supporting sentence, at most two numbers | Full explanations, routing tables, history, neighbourhood graph, priority tables |
| Controls | One primary action, small Step and Restart, scenario selector, Explore | Play, Pause, Step, speed, Reset, zoom, pan, phone and packet inspection |

Both modes drive the **same engine and the same scenario machine**. Switching modes keeps the scenario, the engine state and the selected packet (Story hands its tracked packet to Explore).

## 2. The emergency journey: five moments, driven by engine state

The current moment is **derived** from engine state (`story.js: moment()`), never from a slide counter. Every action calls the real engine.

| Moment | Derived from | Headline | Primary action | What the stage shows |
|---|---|---|---|---|
| **Need** | no request exists | Mobile networks are down. Someone needs help. | Send request | The origin phone and its neighbours; the draft request on the requester's phone |
| **Spread** | request exists, it can still move | One request. Passed from phone to phone. | Pause / Resume (it plays itself) | Real hand-offs; the camera widens as the request really spreads; "The request reached N phones." |
| **Gap** | the engine reports the request cannot move and unreached Relay phones remain | The request can't go any further. | Let this phone join Relay | Received group, the distinct cut-off group, the bridge phone with amber "could connect" links; received and cut-off counts |
| **Connection** | bridge phone now runs Relay, nothing new received yet | A new path is open. | Watch it cross | Newly reachable phones as outlines (not received), the one open route, "A route exists. Delivery hasn't happened yet."; received stays unchanged |
| **Crossing** | holders have increased since the install | The request is crossing. | Pause / Resume | Phones light up only as the engine stores the request; "N of the M newly reachable phones have it." |
| **Response** | a responder's phone holds the request | The request reached someone who could respond. | Send an offer | That person's phone: the request it really holds and a draft reply ("A person in Safdarjung Enclave has the request.") |
| Return | a reply packet exists, the requester lacks it | A nearby person replied. | Pause / Resume | The tracked packet becomes the reply (violet) |
| Arrived | the requester holds the reply | The reply reached the requester. | Acknowledge the offer | The requester's phone shows the real offer, marked unverified |
| Ack | an acknowledgment exists, the responder lacks it | The requester acknowledged the offer. | Pause / Resume | The acknowledgment travelling |
| Done | the responder holds the acknowledgment | Request received. Offer returned. Acknowledgment delivered. | Replay, Try the missing-person scenario, Explore | Honest qualification: the offer is self-reported; Relay can't guarantee delivery or that help arrives |

Phone previews appear only where they help (draft at the origin, the responder's phone, the requester's phone when the reply arrives) and collapse to a one-line chip while the request propagates. A preview is **phone-local**: it uses `Mesh.requestView`, `caseState`, `repliesAt` and `receivedBroadcasts` and shows only what that phone could know, such as "Saved on this phone", "Shared with a nearby phone", "Received on this phone", "Offer received". It never contains network-wide counts (a test fails if it does).

### Who helps is not fixed

The person who answers (or, in the community scenario, who posts) is **not a scripted character**. Nobody is named in advance, and nothing on screen says "clinic".

- **Responder (emergency, missing person).** After the bridge opens and the request really crosses, the story waits until at least six phones on the far side of the bridge hold it (or it can no longer move). It then picks one of those phones by a fixed hash of the scenario and phone id: deterministic, so tests and demos repeat, but not hard-wired. The candidate must hold the request, be on the far side, and be neither the requester nor the bridge phone. Their reply text and area come from that phone's own declared neighbourhood. In the shipped topology the two scenarios pick different phones (p80 and p77, both ordinary phones that declared Connaught Place), and the responder is not the old scripted "clinic volunteer" phone.
- **Poster (community update).** A phone chosen the same way from the Relay phones that start cut off from the requester's side posts the update, and the urgent request that joins it. Its area is the phone's declared area.
- **The engine enforces the rule.** `Mesh.createReply` refuses a phone that does not hold the request, and a test confirms it on a newly reachable phone that lacks it.
- **Regression flag.** Opening the page with `?responder=clinic` restores the original scripted phones. The older Explore test suites use it so their assertions stay exactly as written; Story and normal Explore use the dynamic choice.

## 3. The other two scenarios teach different things

- **Missing person: direction.** (The helper who sends the possible sighting is a far-side phone chosen as above.) The last-known neighbourhood is marked as declared, not GPS, and every area shows its steps away from the target in the offline neighbourhood graph. At the first real forwarding choice the story pauses on **one phone with two neighbours**: A (gets it) and B (held back, or a limited detour), each with the engine's own reason (`Mesh.plan` plus the neighbourhood distances), drawn as two labelled links. The test checks that A and B and their sentences are exactly the engine's plan, and that the next engine step does what the card said.
- **Community update: priority.** After the update has crossed, an urgent request joins it on one phone. The phone shows both waiting messages, urgent first. The priority claim appears only after the engine has resolved a real busy link: the view zooms to that link, singles it out, and shows the two messages as chips: the urgent request "went first", the update "waited". The number is the count of real contested links.

## 4. Visual and copy rules

- Light page, deep-navy network stage, system fonts only. Blue = received, violet = the reply or acknowledgment, teal = could now be reached (outline, not received), amber = the bridge/obstacle. State is never colour alone: received phones are filled, reachable ones are outlines, no-Relay phones are dashed, important phones have rings and labels.
- The graph is the engine's own schematic layout. Nothing is re-laid-out while messages move. A camera changes only the SVG viewBox. At the start only the origin and its neighbours are emphasised, not all 80 phones.
- Motion: camera easing and one dot per real hand-off. No pulsing, particles, glows or radio-range circles. Pause clears the dots. Reduced motion removes the camera tween and the dots.
- Copy: plain statements of fact ("The request reached 12 phones.", "This phone doesn't have Relay."). No slogans, no inspirational language. A test fails on a list of banned phrases, on headlines outside 3-10 words, and on supporting lines over 20 words.

## 5. Truthfulness contract (what is tested)

`tests/sim_v4_test.html` (105 checks per size) runs the real page with its own buttons. A **monitor runs on every paint of the whole session** and fails on any of these:

- the headline says the reply reached the requester, but the requester does not hold it
- "Acknowledgment delivered" is shown, but the responder lacks the acknowledgment
- "Send an offer / Send a sighting" is offered before the responder holds the request
- the requester's phone shows a reply it has not received
- a phone preview contains a network-wide statistic
- a phone is drawn as having the packet but the engine says it does not (or has no Relay)
- the number of received phones drawn differs from the engine's
- the story names a responder before one exists, or the responder is the requester or the bridge phone, or says "clinic"
- more than two metrics or more than one primary action; banned copy; over-long headline or sentence

Other assertions cover: Story is the default and Explore is hidden; the first screen states a human problem and one action; a new request exists on exactly one real phone; every animated dot has a real hand-off in `lastHops`; Pause stops the clock and clears motion; the stall is real and the received count stops; the bridge really blocks; installing changes reachability **before** receipt (received stays at 31, "can now reach" jumps); phones light up only as the engine stores the request; the engine refuses an early reply; the reply and acknowledgment travel along real links; Explore preserves tick, packets and the selected packet; all three scenarios run to completion; no external requests; and at every moment the headline, network, any phone preview and the primary action are visible together without scrolling, with no preview sitting on top of the phone it describes (checked at 1280×720, 1440×900, 1920×1080 and under reduced motion).

I also broke the page on purpose three ways (count newly reachable phones as received; show "delivered" as soon as the acknowledgment exists; offer the volunteer action at the gap). Each made the suite fail with a specific message.

Engine and routing are unchanged. `Mesh.plan` stays a read-only export. `tests/sim_explain_test.js` (27), the original simulator suite (73), the v3 suite (62), the engine suites (63 + 75), the independent audit (28) and the mobile app suite (140) all still pass. The v2 and v3 suites now open `?mode=explore`; only that URL changed, no assertion was removed.

## 6. First-time-user design review (self-review, not user testing)

I looked at each major state asking: what is the one thing to notice, can I tell what happened, can I tell why it matters, is the next action obvious, is any text redundant. Changes this caused: the explanation moved above the data; the colour key is hidden on the first screen (nothing can be received yet); the preview cards were moved so they never cover their own phone; the decision moment gained "A" and "B" labels on the map; the busy-link moment singles out one link; the consent step lost a phone id nobody would recognise. **No real users have tried this.** Whether someone understands Relay in two minutes is a hypothesis to test with people, not something this document shows.

## 7. Known limitations

- Designed for laptop screens, 1280×720 and wider. Below about 1000 px the progress strip is hidden and layout is not tuned.
- Story follows one packet at a time. In the community scenario both messages are shown at the busy link, but the map is not a multi-message view (Explore has the picker and tables).
- The missing-person comparison depends on the engine producing a phone with both a preferred and a held-back or detour neighbour. It did in the shipped deterministic scenario; if a future topology never produced one, the story would simply skip that step.
- Simulated steps are a model of ordering, not Bluetooth latency; the page says so. The phones, the install and the people are simulated.
- Fonts are the operating system's, so the exact look varies by platform.

## 8. Run the tests

| Command | What |
|---|---|
| `tests/run_sim_v4.sh 1440 900` (also `1280 720`, `1920 1080`, `1440 900 reduce`) | Story-mode suite (105 checks) |
| `tests/run_sim_v3.sh 1440 900` | v3 suite, opened in Explore |
| `tests/run_sim.sh 1280 760` | original simulator suite, opened in Explore |
| `node tests/sim_explain_test.js` | explanations vs engine |
| `tests/run_engine.sh`, `tests/run_independent_audit.sh`, `tests/run_app22.sh 390 844` | engine, audit, mobile app |
| `tests/story_shots.sh OUTDIR 1440 900 [states]` | screenshots of the real Story page in named states |

## 9. Demo walkthrough (about 100 seconds)

*(Open `prototype/simulator.html`. Emergency assistance is selected.)*

1. **(0:00)** "Mobile networks are down and someone needs a doctor. This is her phone with the request drafted. Relay passes messages between nearby phones without internet." *Click Send request.*
2. **(0:15)** "One request, passed from phone to phone. These are real hand-offs, and the count is live." *Let it run until it stops by itself.*
3. **(0:35)** "It can't go any further. One phone without Relay separates these two groups. 31 phones have it; 32 can't." *Click Let this phone join Relay, then Accept.*
4. **(0:50)** "A new path is open, but delivery hasn't happened. Received is still 31. These outlines are phones that can now be reached, not phones that have it." *Click Watch it cross.* "Now they light up one hand-off at a time."
5. **(1:10)** "It reached someone who could respond. This is the request on that person's own phone. It isn't a scripted volunteer, just a phone on the far side that really received it." *Click Send an offer.* "The reply travels back along real links."
6. **(1:25)** "The reply reached the requester, marked unverified. She acknowledges it." *Click Acknowledge the offer.* "Request received. Offer returned. Acknowledgment delivered. The offer is self-reported and Relay can't guarantee delivery. That's the claim: communication and coordination, not rescue."
7. **(1:40)** *(Optional)* Try the missing-person scenario for direction, or the community update for priority; Explore opens the detailed tools on the same state.

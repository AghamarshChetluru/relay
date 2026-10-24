# Simulator V4.2: topology and directed-routing correctness audit

Branch `feature/simulator-v4-routing-fixes`, from `feature/simulator-v4-logic-fixes` at `e8ca008`. The presentation (Story, Explore, camera, previews, colours) is unchanged. This document records what the audit found in the **network model and the forwarding decisions**, what was changed in the engine, and which test now guards each change. Nothing here was fixed by rewording: where a message took a strange path or an explanation turned out false, the model was corrected and the explanation then reads the corrected model.

## 0. In one page

| # | What was observed | Root cause | Change |
|---|---|---|---|
| 1 | P8 and P9 (both Relay, both in the Hauz Khas cluster, 87 units apart, cutoff 95) were not in contact; the Relay path between them was **13 hops** (their only shared contact, P4, has no Relay) | The generator joined each cluster by a minimum spanning tree plus "the two nearest neighbours" per phone. A pair inside the radius that was not among either phone's two nearest got no link | One documented rule: in-cluster contact whenever drawn distance < radius, at most 5 contacts per phone, shortest first, cluster kept connected by its spanning tree. P8-P9 is now one hop |
| 2 | In the missing-person decision card P12 chose P11 and "held back" P7; one minute later P12 sent P7 a copy | `out = usable.length ? usable : detour`: as soon as P12's closer neighbours **all had the packet**, the detour fallback fired. A "not selected now" had been written as if it were a verdict | Detours are used only by a phone with **nothing closer to hand it to**, or after it has waited 16 minutes with nothing closer left. P12 never sends P7 a copy. P7 still receives it from P11 (a dead end for this request), and the explanation says so |
| 3 | A request reported as stopped ("can't go any further") **moved again 13 minutes later** | The time-based "patience" allowance (16 min, wider detours) was invisible to `stats().canMove`. The Story/Explore stop claims did not know a move was scheduled | `stats()` now reports `waiting` and the exact `wakeTick`; `stopReason` carries them; Explore says "This is not final: at simulated minute N...". A stop that is not waiting is final and tested to stay final |
| 4 | Safdarjung Enclave to Lajpat Nagar: "detour through Vasant Vihar, then blocked" | Not one defect. (a) The engineered gap: the northern and southern groups meet only through a phone **without Relay**, so no Relay path exists. (b) Vasant Vihar is entered by the bounded detour, from two phones whose only other contact is there. (c) The explanation did not say any of this | See section 5. The failure is real, caused by (a), and is now named exactly; (b) is explained as the detour rule; once the crossroads phone joins, the request is delivered along a chain the graph predicts |
| 5 | Which of several equally-eligible neighbours got a copy depended on text order (`p10` before `p2`) and on the order phones were processed | String comparison of phone ids; planning against a live inbox | Numeric tie-break; every phone plans from the start-of-minute state; the lower-numbered sender is recorded when two send the same copy |
| 6 | A detour dead-end phone could send a copy to **every** farther neighbour | Detour copies were not counted | At most 2 detour copies per phone per packet |
| 7 | Explanations restated the rule in a second implementation (`decide`) and could drift from the engine | Duplicated logic | `Mesh.classify` is the one classification; `plan`, `step`, `stats` and every explanation read it |

## 1. Two layers, kept apart

- **Encounter topology** (`S.adj`, `Mesh.ENCOUNTER`, edge `kind`): which phones can exchange a packet. A message only ever moves along these links between phones that both run Relay. The drawing is schematic: it never creates a link, and nothing is animated that is not an engine hand-off (`lastHops`).
- **Neighbourhood routing graph** (`Mesh.NEIGHBORHOODS`, `NEIGH_EDGES`, `NEIGH_BASIS`): a coarse graph of declared areas. For a directed request it decides which of a phone's *existing* contacts count as "closer". It cannot create a contact. Safdarjung Enclave and Lajpat Nagar being two steps apart in this graph does not let a packet jump between them.

A hand-off therefore needs both: an encounter link and the packet's forwarding policy saying yes.

## 2. Topology

### 2.1 What the audit of all 80 phones found (V4.1)

| | V4.1 | V4.2 |
|---|---|---|
| encounter links | 111 | 148 |
| contacts per phone (avg / max) | 2.77 / 5 | 3.70 / 5 |
| phone pairs inside the six clusters | 496 | 496 |
| of those closer than 95 units | 146 | 146 |
| ...not in contact | **46** | **9** |
| ...not in contact, both Relay | 30 | 7 |
| ...both Relay with a Relay path of 3+ hops | **11** | **0** |
| longest Relay detour between two close Relay phones | **13 hops (P8-P9)**, then 7, 6, 5, 4 | 2 hops |

The 9 pairs that remain unlinked are exactly the pairs where one phone is already at its 5-contact limit. All of them are at most 2 hops apart.

### 2.2 The rules (`Mesh.ENCOUNTER = { radius: 95, maxContacts: 5 }`)

1. Phones in one encounter cluster are in contact when their drawn distance is under the radius.
2. A phone has at most `maxContacts` in-cluster contacts. Shorter contacts are chosen first; ties go to the lower phone number. Deterministic.
3. Each cluster is kept connected by its minimum spanning tree. A tree link longer than the radius would be kept and marked `stretched` (a deliberate, visible exception), so that a cluster is never split in two. In the shipped city there are none: every spanning-tree link is already shorter than the radius. The mark exists for other seeds and is tested.
4. Clusters meet only through the 11 `connector` links (people who travel between areas). They are long on purpose (124-195 units), are the only links that cross a cluster boundary, and every link carries its `kind` (`local`, `stretched`, `connector`), shown in Story and Explore tooltips.
5. Drawn proximity across clusters never implies a contact: the nearest two phones in different clusters are more than the radius apart (checked).

This does **not** promise radio discovery: the radius is a modelling parameter of a schematic simulation, not a Bluetooth range.

### 2.3 Engineered parts of the demonstration city (stated, not hidden)

- The three northern clusters and the three southern clusters are linked **only** through the crossroads phone D, which has no Relay. This is the adoption-gap lesson. Without D there is no Relay path between the groups (checked: no other link crosses). With D there is one.
- Everything else is rule-driven: the 16 phones without Relay are chosen by the seeded generator, not placed to make a point, and the layout seed is pinned (`TOPO_SEED = 7`, validated against the scenario constraints; the search falls back only if validation ever fails).
- The demonstration is two real groups of 31 Relay phones each plus one stray Relay phone, not a fragmented city.
- The topology change creates no route around the bridge (checked), so the V4.1 bridge story is reproducible: the emergency request still stalls at 31 holders and still crosses when the phone joins.

### 2.4 P8 / P9, before and after

| | V4.1 | V4.2 |
|---|---|---|
| P8 contacts | P11, P4 | P11, P4, P9 |
| P9 contacts | P4, P14 | P4, P14, P8, P2, P6 |
| adjacent | no | **yes** |
| Relay path | 13 hops (P4 has no Relay) | **1 hop** |

## 3. Forwarding policy

### 3.1 The contract

For a directed (missing-person) packet at a holder, with `ds` the holder's declared distance to the target and `dd` a neighbour's (both must be known and fresh):

- **Preferred**: `dd <= ds`, or both within 1 step of the target.
- **Forward**: if the holder has a preferred neighbour other than the phone it came from, it hands copies to the preferred neighbours that lack it, closest first, at most 3 in total. It does **not** detour.
- **Detour**: (a) **at once** when the holder has no preferred neighbour to forward to (a dead end for this packet), or (b) after the holder has held the packet **16 minutes** with every preferred neighbour already holding it. At most **2 detour copies** per phone, to neighbours at most 1 step farther (2 after waiting), while the copy's lineage has detours left (1, or 3 after waiting). A copy already inside the target area never detours.
- **Not selected now** is a statement about this phone and this minute. Each reason has a duration: `now`, `while` (as long as this phone keeps the same closer neighbours; time can lift it), `copy` (this copy's allowance is spent), `phone` (this phone's copy limit is spent; another phone may still pass it on).

### 3.2 The exact P12 / P11 / P7 sequence

Request from the requester's phone, target Lodhi Colony. P12 declares Hauz Khas (2 steps from Lodhi Colony), P11 Hauz Khas (2, equally close), P7 Jia Sarai (3).

| minute | V4.1: P12's plan before the step | V4.2: P12's plan before the step | hand-offs involving P12, P11, P7 (V4.1) | (V4.2) |
|---|---|---|---|---|
| 1 | does not have it yet | does not have it yet | P1>P12 | P1>P12 |
| 2 | P11 | P11 | P12>P11 | P12>P11 |
| 3 | **P7 (detour)** | nothing | P11>P8, **P12>P7** | P11>P7, P11>P8 |
| 4 | nothing | nothing | P7>P3 | P7>P3, P7>P5 |

V4.1 explanation for P7 at minute 2 ("Not forwarded: ... not closer ...") was true only for that minute. V4.2 explanation: "Not selected now: Jia Sarai is 3 steps from Lodhi Colony (this phone: 2 steps). This phone has 1 closer or equally close neighbour, so Relay does not send copies away from the target while those are available. If the message is still waiting on this phone at minute 17 (16 minutes after it arrived) with nothing closer left to hand it to, the detour allowance widens and this neighbour may be used then, if nothing closer is left to hand it to. Jia Sarai can still get it from another phone." And that is what happens: P7 receives it from P11, whose only contact other than its sender is P7.

### 3.3 Precise policy changes

1. `Mesh.classify(src, pid)` replaces the inline plan: one classification of every Relay neighbour with the engine's reason code (`closer`, `equal`, `same-area`, `fanout`, `closer-exists`, `detour`, `detour-used`, `detour-fanout`, `too-far`, `inside-target`). `plan`, `step`, `stats().canMove` and all explanations read it.
2. The fallback `usable.length ? usable : detour` is replaced by the forward / dead-end / wait rule above.
3. Detour copies are counted separately (`ROUTE.detourFanout = 2`).
4. `stats()` gains `waiting` and `wakeTick`; a stopped packet is final unless `waiting`.
5. Planning from the start-of-minute state; lower-numbered sender recorded on a same-minute duplicate; numeric tie-break.
6. Unchanged: preferred test, fan-out of 3, detour budget (1, 3 after waiting), patience (16), hop limits, expiry, flood/opportunistic policies, priorities, link capacity.

### 3.4 Was the old fallback "wrong"? What does the data say?

Run on every Relay phone as an origin to every other area (1,143 requests per engine), V4.2 topology:

| policy variant | delivered after the bridge | holders (avg) | holders farther from the target than the origin (avg) | minutes to first target phone (avg) |
|---|---|---|---|---|
| V4.2 (shipped) | 225 / 225 | 57.9 | 13.2 | 8.3 |
| V4.1-style fallback on the V4.2 topology | 225 / 225 | 57.9 | 13.3 | 6.9 |
| no widening after waiting | 224 / 225 | 51.1 | 9.1 | 8.2 |
| no waiting rule at all (dead-end detours only) | 203 / 225 | 38.2 | 2.5 | 6.6 |
| no detours | 173 / 225 | 29.4 | 0.0 | 6.0 |

(Every third Relay phone as origin, to every other area, after the bridge: 225 requests per row. The full matrix is in section 6.) Reading it honestly: the old fallback was not buying delivery, only an extra minute or so of speed, and it was the source of the contradiction in the card; removing it costs 1.4 minutes on average and changes nothing else. The *widening after waiting* is what makes a directed request reach almost every phone eventually (about 90% of the Relay phones); without it some requests are never delivered (up to 10%). I kept it, because "no request is permanently stuck" is an existing, tested product guarantee (`tests/engine_v22_test.js`), but its cost is now visible and the allowance is reported as a scheduled event rather than a surprise. If the product prefers tighter spread over guaranteed delivery, `ROUTE.patientExtra`, `ROUTE.patience` and `ROUTE.detourFanout` are the three dials, and this table says what each costs.

## 4. The neighbourhood routing graph

Ten declared areas, 15 edges, hop distance only (diameter 4). The weights are **not distances** and the graph is **not a map**. Basis for each edge (from general knowledge of south and central Delhi, not surveyed and not checked against a map source):

| edge | basis | note |
|---|---|---|
| Hauz Khas - Green Park | border | Green Park adjoins Hauz Khas to the north-east, along Aurobindo Marg |
| Hauz Khas - Safdarjung Enclave | border | adjoins to the north, across the Outer Ring Road |
| Hauz Khas - Ber Sarai | border | western side, near the IIT campus |
| Hauz Khas - Jia Sarai | border | western side, near the IIT campus |
| Ber Sarai - Jia Sarai | border | neighbouring villages |
| Ber Sarai - Vasant Vihar | road | Outer Ring Road through Munirka; they do not border |
| Green Park - Safdarjung Enclave | border | either side of Aurobindo Marg |
| Green Park - Lajpat Nagar | road | Ring Road through Defence Colony; they do not border |
| Safdarjung Enclave - Lodhi Colony | road | Aurobindo Marg and Lodhi Road past Safdarjung Airport |
| Safdarjung Enclave - Vasant Vihar | **loose** | Outer Ring Road and Africa Avenue. The weakest edge |
| Lodhi Colony - Connaught Place | road | Lodhi Road and Janpath, several kilometres |
| Lodhi Colony - Chanakyapuri | road | Lodhi Road and Kautilya Marg |
| Lodhi Colony - Lajpat Nagar | road | Lodhi Road and the Ring Road through Defence Colony; they do not border |
| Chanakyapuri - Connaught Place | road | Rajaji Marg and Janpath |
| Chanakyapuri - Vasant Vihar | border | south-west side of the diplomatic enclave |

**Safdarjung Enclave - Lajpat Nagar is deliberately not an edge.** The localities do not border; the real links between them run through Green Park or Lodhi Colony, which is how the graph already measures them (2 steps). Adding the edge would have made the graph say 1 step and would have changed nothing about whether a packet can get there. The weakest edge (Safdarjung Enclave - Vasant Vihar) was tested by removing it and re-running every origin/target/bridge case: no delivery outcome changes (`tests/sim_routing_test.js` section 7), so nothing hinges on it. Where real adjacency and the simulated encounter topology differ they are separate on purpose: the neighbourhood graph says which declared areas are closer; the encounter topology says who can meet.

## 5. Safdarjung Enclave to Lajpat Nagar, replayed

A real request from the first Relay phone declaring Safdarjung Enclave (P53), target Lajpat Nagar, run through the engine without any hard-coded route.

| | before the bridge | after the crossroads phone joins |
|---|---|---|
| 1. initial holder | P53 (cluster Safdarjung Enclave), declares Safdarjung Enclave | same |
| 2. distance-to-target scores | P53: 2 steps (Safdarjung Enclave); Green Park 1; Lodhi Colony 1; Vasant Vihar 3 | same |
| 3. Relay neighbours | P58, P59, P66, all Safdarjung Enclave, 2 steps | same |
| 4. preferred | P58, P59, P66 (equally close); selected the first minute: all three | same |
| 5. detours and reasons | t3 P57>P48 (Vasant Vihar), t4 P69>P77 and P69>P78 (Connaught Place), t22 P49>P47 (Vasant Vihar). Every sender was a phone with **no closer neighbour** (mode "detour"). V4.1 had seven: those four plus P56>P44 (Vasant Vihar, from a phone that still had closer neighbours), P69>P80 (a third detour copy from one phone) and P67>P76 (Chanakyapuri) | the same four, plus t8 P18>P2 (a Hauz Khas detour from a phone with nothing closer) |
| 6. actual hand-offs | 31 Relay phones receive it: Safdarjung Enclave 10, Lodhi Colony 7, Vasant Vihar 8, Chanakyapuri 3, Connaught Place 3 | all 63 of 64 Relay phones |
| 7. outcome | **not delivered**: 0 of the 8 Relay phones declaring Lajpat Nagar | **delivered**: 8 of 8 |
| 8. exact reason | none of them is in this phone's Relay component. The 32 phones on the northern side are cut off behind the crossroads phone (P62), which has no Relay. Stop code `gap` | chain: P53 > P66 > P65 > P62 (crossroads) > P26 (Green Park) > P16 > P20 > P35 (Lajpat Nagar) > P29, 8 hops against a shortest Relay path of 8 |

So the observed behaviour had three separate causes, and V4.2 changes how each is explained, and only one of them is a behaviour change:

- **It cannot reach Lajpat Nagar before the bridge**: structural, intentional, unchanged. The graph says 2 steps; the encounter topology says no path.
- **Vasant Vihar is entered by two bounded detours** (P57 and P56's only other contact is a Vasant Vihar phone). That is the dead-end rule working as designed, not a routing error. What V4.2 removed is the detours that fired from phones that still had closer neighbours (P56 into Vasant Vihar, P67 into Chanakyapuri) and the third detour copy P69 sent to Connaught Place. The cost of a permitted detour (8 Vasant Vihar phones hold it) is visible and bounded.
- **After the bridge the route is the geographically sensible one**: Safdarjung Enclave > Green Park > Lajpat Nagar, exactly what the neighbourhood graph predicts.

## 6. The origin x target matrix

Every Relay phone as an origin (63, or 64 after the bridge), every other declared area as a target, with and without the crossroads phone: **1,143 real requests per engine**, run to quiescence (quiet for longer than the waiting allowance).

| | requests | delivered | cannot (no Relay route to any phone declaring the target) | stalled by policy | holders (avg) | holders farther from the target than the origin (avg) | minutes to first target phone (avg) | hops to it (avg) |
|---|---|---|---|---|---|---|---|---|
| V4.1, before the bridge | 567 | 248 | 319 | 0 | 29.3 | 6.64 | 5.5 | 5.3 |
| **V4.2, before the bridge** | 567 | 248 | 319 | 0 | 29.6 | 6.78 | 4.6 | 4.5 |
| V4.1, after the bridge | 576 | 567 | 9 | 0 | 57.2 | 13.56 | 9.5 | 8.9 |
| **V4.2, after the bridge** | 576 | 567 | 9 | 0 | 57.7 | 13.84 | 8.1 | 6.9 |

- Outcomes are identical to V4.1: the classes of success and failure did not move, which is the point of changing the model without changing the demonstration. The 319 + 9 failures are all structural: before the bridge a request from one group cannot reach phones declaring a target that live only in the other group (stop code `gap` in every case, naming the crossroads phone); after it the 9 are origins stranded in a stray component. No request is stalled by the routing policy while a target phone is in its Relay component.
- The two engines differ in how they get there: first delivery is faster than V4.1 (9.5 to 8.1 minutes, 8.9 to 6.9 hops after the bridge) because of the denser, rule-driven contacts, and 1.4 minutes slower than the old fallback would be on the same topology (section 3.4), which is the price of not sending copies away from phones that still have closer neighbours.
- Aggregate spread is **not** smaller: V4.2's denser topology gives every request more places to go, and the retained waiting allowance lets almost every request reach almost every phone eventually (section 3.4). This is stated as a limitation, not hidden.
- Ordering: processing the phones in reverse order gives identical holders **and** identical "received from" links in all 180 pair/bridge cases.
- Degraded networks: 48 requests with 10-46% of the other phones switched off (12 seeds, 4 targets): the per-step contract holds in every one, delivery only ever happens through real Relay links, and none was policy-limited while a target phone was still in its Relay component.

Per-step contract checked on every hand-off of 504 audited runs (3 origin phones per area, 9 targets, with and without the bridge): every hand-off is along a real encounter link between two Relay phones, was in the engine's plan, every detour came from a dead-end phone or one that had waited 16 minutes with nothing closer left, no budget was exceeded, nothing moved after a "stopped (not waiting)" report, nothing moved before an announced `wakeTick`, and the announced detour did happen at that minute.

## 7. Language: what the screen now says

| Situation (engine state) | Wording |
|---|---|
| link exists, both Relay | "Both phones run Relay." plus, for a long link, "Long-range link between clusters (modelled: people who travel between areas)." |
| connected through other phones, not receiving | "Connected, not received" |
| already holds it | "Has it" / "Received it from X" |
| in the plan | "Selected for the next step" |
| plan says no, closer neighbours exist | "Not selected now: ... This phone has closer neighbours, so Relay does not send copies away from the target ... X can still get it from another phone." plus the minute a detour could apply |
| fan-out spent | "Not selected: this phone already handed the message to 3 closer neighbours (its limit). X can still get it from another phone." |
| detour spent / inside target | "Not selected: ... this copy has already used its detour" (duration `copy`) |
| waiting for the detour allowance | "This is not final: at simulated minute N (k from now) a phone that has held it long enough may try a bounded detour, if nothing else changes." |
| no Relay on the only link | "has no Relay ... it is the only link between two groups" (gap) |
| expired | "Message expired ... it lived 90 simulated minutes" |

"Will not receive", "will never", "is excluded", "Not forwarded" are banned on every paint of all three Story scenarios by a browser test, and "will not receive" is a failing mutation in the engine suite. In missing-person mode the card says the steering uses **declared neighbourhood distances, not the drawing**.

## 8. Tests

New:

| Suite | What it checks | Result |
|---|---|---|
| `node tests/sim_routing_test.js` | 1 topology rules (every pair in every cluster, P8/P9, connectors, bridge, density, determinism); 2 the exact P12/P11/P7 sequence, synthetic temporal rule, dead-end detour, exhausted budget, fan-out and ties, cycles/dedup, before/after with an already-connected phone; 3 Safdarjung Enclave > Lajpat Nagar replay before and after the bridge; 4 the matrix (per-step audit, every origin phone, reversed processing order, 12 degraded relay configurations, legitimate failures); 5 hand-off chains; 6 explanations vs engine on >1,000 decisions, and "stopped means stopped"; 7 the graph basis, with the weakest edge removed | **120 checks, all pass** (about 2.5 minutes) |
| `tests/run_sim_v42.sh` (browser, real clicks) | the drawn links equal the engine's links; P8-P9 drawn; connector tooltip; P12's neighbour table in Explore at minutes 2 and 3; a non-final stop announces its minute and the detour happens exactly then; all three Story scenarios run to the end with the forbidden-wording monitor on every paint; density and layout | **45 checks at 1440x900, 1280x720 and 1920x1080, all pass** |

Existing suites, none removed: V4.1 browser suite 105 at 1440 and 1280; V4 Story suite 113 at 1440, 1280, 1920 and 114 under reduced motion; V3 62; original simulator 73 (1280x760 and 1440x900); `sim_explain_test` 27; semantic suite 70; engine 63 + 75; independent audit 28; mobile app 140. All pass.

Assertions that encoded V4.1-specific behaviour were updated, and each is listed:

- `sim_v4_test.html`: the decision card is compared with the card's one-sentence form (`brief`), not the long text; "the held-back neighbour B did not" now says "was not selected"; the check that the two scenarios' helpers are different phones was removed because it asserted a coincidence of the V4.1 layout (both now pick P80); the other three hard-wiring conditions remain.
- `sim_v41_test.html`: the card comparison as above; the 52/11/3/8 Explore case is now derived from the engine plus a pinned snapshot of the new topology (53 hold it, 10 connected, 1 not selected now, 1 blocked for this copy, 8 not adjacent, 1 cut off) and an assertion that the stop is announced as not final; the browser reproduction of an "already-connected phone" no longer occurs naturally (0 connected before the bridge), so the identity "after = before + new + bridge" is checked in the browser and the exact case is reproduced on a synthetic network in `sim_routing_test.js` (P4 already connected, P5 the bridge, P6 and P7 newly connected).
- `sim_semantic_test.js`: same counts, engine-derived.
- None of the engine suites (63 + 75), the independent audit (28), the original simulator (73), V3 (62) or the mobile app (140) needed an assertion change.

### Do the tests guard the model? (deliberate regressions)

Each regression was applied to a copy of the engine and `sim_routing_test.js` run against it: 

| Deliberate regression | Failing checks | What caught it |
|---|---|---|
| M1: V4.1 fallback restored (detour whenever nothing is left to serve) | 14 | P12's plan at minute 3 is no longer empty; the covered state and its announced minute disappear; the synthetic temporal rule; explanations |
| M2: the old "MST + two nearest neighbours" topology rule | 11 | P8-P9 not adjacent; pairs inside the radius not in contact; density and path-length checks |
| M3: waiting hidden (`stats().waiting` always false) | 7 | the announced minute; the explanation's "not final"; the per-step audit: "the engine said cannot move, not waiting at minute 48, then handed it on at minute 62" in a real matrix run |
| M4: the card says "Will not receive" | 4 | wording on P7's card, the neighbour table, and the explanation-vs-engine audit |
| M5: links lose their `kind` | 3 | in-cluster links must be local or stretched; only the 11 connectors may cross a cluster |
| M6: detour copies unlimited (`detourFanout` 99) | 3 | a dead-end phone with three farther neighbours must refuse the third |
| M7: ties by text order instead of phone number | 4 | the fan-out choice order and the tie-break check (P10 chosen before P5) |

M3 and M6 first passed the suite; they were what made me add the "reported final, then moved" check to the per-step audit and the three-farther-neighbours case. Both are in the suite now.

## 9. Visual review

Screenshots in `docs/screenshots/sim-v42/` (1440x900, real page): 

| file | state |
|---|---|
| `e0` | emergency, opening |
| `e4` | emergency gap: 31 have it, 31 cut off behind the crossroads phone |
| `e5` | emergency after the install: the denser local mesh, 31 newly connected phones |
| `m3` | missing person, the forwarding decision: A chosen next, B "not selected now" with its distances |
| `m4` | missing person after the decision |
| `mg` | missing person gap |
| `mr` | missing person, the far-side phone and its example sighting |
| `md` | missing person result |
| `bc`, `bd` | community report, then the busy-link contest (4 of 4) |
| `x2` | Explore: Safdarjung Enclave to Lajpat Nagar before the bridge (a custom request injected through the engine API, so the scenario label still says Emergency): 31 hold it, 0 of 8 Lajpat Nagar phones (violet rings), "Stalled: no route across the gap" |
| `x3` | the same request after the crossroads phone joins: all 8 Lajpat Nagar phones hold it |
| `x4` | Explore, inspecting P12 at minute 2: P7 "Not selected now", with the reason and the minute a detour could apply |

Findings fixed: the decision card's long explanation did not fit its card, so the card uses a one-sentence form with the distances and the full text stays in Explore; the Explore neighbour table repeated "Not selected now. Not selected now:"; "1 more phones become connected" grammar; the legend and tooltips use the new vocabulary. Density: 148 links on 80 phones reads as a mesh rather than a tree and stays legible at 1440x900 and 1280x720; the camera, previews and colours are untouched.

## 10. Limitations

- The radius, contact limit and long-range links are modelling parameters of a schematic city, not radio physics. The graph basis is general knowledge, not a survey.
- The retained waiting allowance means a directed request eventually reaches most Relay phones (about 90%). It is bounded and now visible, but it is not a "tight" search.
- A detour into an area farther from the target (8 Vasant Vihar phones in the Safdarjung Enclave to Lajpat Nagar case) still happens from a dead-end phone; the model cannot know the pocket is a dead end.
- Delivery to a target area is measured as "some Relay phone declaring it holds the request", not as a person being found.
- The demonstration city's two-group structure is engineered; the matrix therefore has many structural failures before the bridge (319 of 567), by design.
- The waiting prediction ("at minute N") assumes nothing else changes; another phone delivering first cancels it, which is the safe direction.
- The Story still follows one packet at a time; no Android code, no BLE, no real devices.

## 11. Not touched

`android/`, `dist/`, `prototype/index.html`, `prototype/style.css`, `main` (f5e2a57), the Android branch, `feature/simulator-v3`, `feature/simulator-v4` and `feature/simulator-v4-logic-fixes` (e8ca008) are unchanged. The only `mesh.js` consumers affected are the simulator and the web prototype's engine tests (all pass).

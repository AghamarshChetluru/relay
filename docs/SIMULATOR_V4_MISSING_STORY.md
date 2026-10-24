# Missing-person Story: one continuous journey

Branch `feature/simulator-v4-story-simplify`, from `feature/simulator-v4-routing-fixes` at `220104f`. Only the Story presentation of the missing-person scenario changed. The engine's directed routing, every Explore explanation and the gap, bridge, sighting and completion journeys are unchanged.

## What was removed

The forced "Next step: one phone, two neighbours" screen (A chosen, B not selected). It interrupted the journey, hid the network behind a card, and the pair it picked did not show the headline's claim (that closer areas are favoured). Removed outright, not hidden:

- the `decision` moment, its camera case, dimming, A/B rings and labels, the pop-up card, the **Continue** button, the playback trigger that paused for it, the cached/revalidated decision state and its reset;
- the `.pop.decision` / `.cand` styles;
- `SimExplain.decisionPair` and the one-sentence "brief" forms that existed only for the card (Explore keeps the full per-neighbour explanations, which come from `SimExplain.decide`, unchanged).

## What the story does now

One request, spreading by itself from the first press until it reaches the gap:

| | Story |
|---|---|
| headline | "Phones pass it on, favouring areas near Lodhi Colony." (the area name comes from the request's own target) |
| the search area | the phones that **declare** Lodhi Colony keep their violet rings, with the key "Declares Lodhi Colony". While the request spreads, the camera keeps both the holders and those phones in view, so the destination is on screen the whole time |
| real hand-offs | the links used in the last step are drawn bright (they are the engine's own `lastHops`); the newest receivers carry the area they declare ("Declares Hauz Khas") |
| declared, not GPS | the sentence "Areas are declared by people, not GPS", the receivers' labels, and the stage note "Routing follows the area each phone declares, not the drawing or GPS" |
| detours | only when one actually happened in the last step: an amber dashed ring and the label "Detour · declares Jia Sarai", an amber dot on the link, the key entry "Detour hand-off", and the sentence "A copy just took a short detour, which routing allows." Nothing about detours appears otherwise, and nothing implies they cannot happen |
| gap, bridge, response, completion | unchanged |

Step stays available while it spreads (there is no longer a card describing only the next step).

## Tests

Comprehension and routing-event checks replace the old card assertions (`tests/sim_v4_test.html` section 10a, `tests/sim_v41_test.html` section 3, the consistency monitors in the V4.1 and V4.2 browser suites):

- the request spreads continuously (no `decision` moment ever occurs, no `#s-decision`, no "A ·" / "B ·" / "Continue" anywhere) and still stalls at the real gap;
- on a paused frame, the links drawn as hand-offs are exactly the engine's last-step hand-offs, and the labels on the newest receivers are the areas those phones declare;
- every spread paint keeps the headline, key and note; on every paint with a real detour the amber ring count equals the engine's detour count and the sentence says so; on every paint without one there is no detour wording at all;
- an outside Step, and a round trip through Explore, leave Story consistent with the engine;
- the engine-level forwarding tests are unchanged: `tests/sim_routing_test.js` (120), `tests/sim_explain_test.js` (27), the engine suites; `sim_semantic_test.js` now checks that every forwarding verdict is recomputed from the engine at the moment it is asked.

## Screenshots

`docs/screenshots/sim-v43/` (1440x900, plus `m3-1280`): `m0` opening, `m3` mid-spread with Lodhi Colony in view and the newest receivers labelled by declared area, `m4` a real detour hand-off, `mg` gap, `mr` the far-side phone, `md` result.

## Limitations

- The first request frames are zoomed out to keep Lodhi Colony in view, so individual phones are small until it nears them.
- Labels on the newest receivers change every minute; they are limited to three, and skipped next to the requester's own label.
- The story still follows one packet at a time.

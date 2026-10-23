# Relay network simulator v3: design and truthfulness

Entry point (works offline, no server): `prototype/simulator.html` (open it with `file://`).
Branch: `feature/simulator-v3`. Not merged to `main`. The Android app and its branch are untouched.

## 1. Purpose and rule

This is an **information-design** exercise, not a graphic-design one. The priority order is **understanding, then interaction, then aesthetics**.
Every element on the page must help a reviewer answer one of seven questions:

| # | Question | Where the page answers it | Engine source |
|---|---|---|---|
| 1 | What problem is this person trying to solve? | "The situation" card (full before the first message, a collapsed reminder afterwards) | scenario script + `Mesh.participating()` |
| 2 | What message was created, and who holds it? | "The message and who holds it" card (the real request text, badge, priority, policy) and blue "has the message" phones | `Mesh.state().requests/packets`, `Mesh.holders()` |
| 3 | How is it moving from phone to phone? | Map layers: *path it took*, *moved this step*, one moving dot per real hand-off | `inbox[...].via`, `Mesh.state().lastHops` |
| 4 | Why did Relay forward, or not forward, it? | "What is happening, and why": each hand-off with its reason; "held back" links; Inspect tab per-neighbour table | `Mesh.plan()` (the exact function `step()` calls) + the numbers it uses |
| 5 | Why did propagation stop? | "Stalled" headline + gap card naming the bridge phone and both sides; or "expired", "hop limit", "target area run its course" | `Mesh.stats()`, `SimExplain.bridge()/frontier()` |
| 6 | What changes when another person joins Relay? | "What changed when Relay was installed": newly connected / newly reachable / actually received, kept apart | `Mesh.join()`, `Mesh.components()` before and after |
| 7 | What human outcome became possible? | "The human response" card: the engine's reply, how many hand-offs it took to return, and a closing line that does not claim rescue | `Mesh.createReply/Ack`, `inbox.via` chain |

Walkthrough shape, derived from engine state (not from a counter): **Create → Spread → Obstacle → Change → Outcome**.

## 2. What was kept, what changed

Kept: the 80-phone deterministic engine, the three scenarios and their steps, every original control and element id, the light visual style, the schematic six-cluster drawing, the consent-based install dialog, the mobile app.
Changed: the explanation layer (`prototype/sim_explain.js`), the painting and side panels (`prototype/sim.js`), styles (`prototype/sim.css`), the page shell (`prototype/simulator.html`).
Dropped after the design clarification: organic maps, glows, a dark theme, cinematic camera moves, a full-screen landing page. A clean network diagram with labelled reasons beats a beautiful but confusing one.

## 3. Visual language (what each mark means)

Positions are a **schematic drawing** of the simulated network. The page says so. There are no roads, no GPS, no geography.

| Mark | Meaning |
|---|---|
| Filled blue circle | Relay phone that **received** the selected message |
| Hollow teal circle | Relay phone that **could still receive** it: it is connected, through Relay phones, to a holder. *Not* received. |
| Hollow grey circle | Relay phone **cut off** from it (no chain of Relay phones to any holder) |
| Dashed hollow grey circle | **No Relay**: cannot carry or pass on messages |
| Dark ring + "Origin" | Phone that created the message |
| Purple ring | "Possible responder" (a request is not addressed to anyone) or "Destination" (a reply or acknowledgment is) |
| Dashed amber ring | Phone without Relay that is the only link between two Relay groups (the bridge) |
| Dark blue outline | Holder that will hand the message on next step |
| Pale blue line | Connection the message really travelled (one per receiving phone, from `via`) |
| Thick dark blue line | Hand-off made in the last step |
| Dashed green line | Hand-off the engine will make next step |
| Dotted amber line | Holder and neighbour where the engine will **not** pass it, with the reason in the panel |
| Slightly larger node | First receipt in the last step (no animation) |

Layers: A (faint network lines), B (message history: path), C (active transfer: one small dot moving along each real hand-off). Animation is the only motion, runs only for hand-offs in `lastHops`, is cleared on Pause or Reset, and is disabled under `prefers-reduced-motion`. Nothing pulses forever.

Missing-person scenario: the target neighbourhood is outlined, and every cluster is labelled with its **steps away** from the target in the small offline neighbourhood graph. A "Why it is steered this way" card draws that graph (10 localities, distance rings centred on the target) with real counts of Relay phones and holders per declared area. The text says steps are hops in that graph, "not kilometres, and not GPS".

Community scenario: a priority card quotes the engine's priorities (urgent 0, update 2) and lists real **busy-link moments** (two messages wanted the same link in the same step) with which went first and which waited.

## 4. Truthfulness contract

1. **No invented events.** Nothing is drawn or counted that the engine did not produce. Animated packets are created from `Mesh.state().lastHops` only (`tests/sim_v3_test.html` checks one dot per hand-off, each on a real edge).
2. **Verdicts come from the engine.** "Will it be handed on next step?" is `Mesh.plan(src, pid)`, the function `Mesh.step()` itself calls. This is the **only change to `mesh.js`**: a read-only export (4 lines). Routing, priority, expiry, de-duplication and the simulated topology are unchanged. The engine suites (63 + 75), the independent audit (28) and the original simulator suite (73) pass unchanged except two selectors updated for the removed pulse animation.
3. **Reasons are descriptions, not decisions.** `SimExplain.decide()` labels why a pair was or was not in the plan using the same quantities the engine uses (target distance, detour budget, fan-out, hop limit, expiry, supersession). If a pair is not in the plan and no reason matches, the code is `other` and the test fails. `tests/sim_explain_test.js` audits **every** phone-to-phone decision of every step of all three scenarios (143 steps, 494 decisions): each decision agrees with `Mesh.plan`; each real hand-off was planned beforehand; each planned hand-off that did not happen is explained as link capacity or another phone delivering first; priority ordering on contested links is checked against the engine's priorities; the explanation functions are read-only.
4. **Potential reach is never receipt.** The page keeps *received*, *could still receive*, *cut off* and *no Relay* as four separate counts that always sum to 80 (checked against `Mesh.stats`). After an install the "received" number does not move until packets really cross (checked in the browser test).
5. **No guarantees, no rescue claims.** The limits card says Relay cannot promise delivery; offers and sightings are labelled unverified; the closing line is "A request travelled. Someone responded. Coordination became possible." plus "This simulation does not show that anyone was helped."
6. **Simulated minutes are not predictions** of Bluetooth delivery time, and the page says so, together with a permanent "Simulation · not real Bluetooth" tag.
7. **Presentation-only state** (which tab, zoom, selected phone) never touches the engine. Zoom and focus change only the SVG viewBox. Phone positions are the engine's own schematic coordinates; nothing is re-laid-out while messages move.

## 5. Interaction

- **Walkthrough tab** (default): phase strip, current step with one primary button, what is happening and why, then the data (message card, live numbers, scenario-specific numbers). In the Outcome phase the response and priority cards come first.
- **Inspect tab**: selected message (policy, hop limit, fan-out, detours allowed, link capacity, lifetime), a phone picker (a keyboard route to every phone), the selected phone's neighbours with the verdict for the selected message, how the message got there, its queue (urgent first), install action, and a step-by-step history.
- Views: **City**, **Neighbourhood** (frames the selected phone's cluster), **Phone** (zooms on one phone; phone ids appear below a zoom threshold: semantic zoom). Wheel zoom, drag pan, Fit.
- Controls: Play, Pause, Step, Reset, speed 0.5×–4×, scenario selector, Space toggles play/pause. Hover tooltip shows area, Relay state and who gave a phone the message.
- Accessibility: every control is a native focusable element, tabs have `role=tab`, the panel is an `aria-live` region, colour is never the only cue (fill, outline, dash and label differ), reduced motion is respected.

## 6. Offline and independence

Only local files are loaded: `simulator.html`, `mesh.js`, `sim_explain.js`, `sim.js`, `sim.css`. No fonts, tiles, scripts or requests to any server (checked in the browser test). The simulator does not use or change the Android code, BLE transport, field-test diagnostics or the mobile app files.

## 7. Known limitations

- The map shows one selected message at a time (a picker switches it); the priority card and the Inspect history cover the others.
- The reason sentences are English text built from engine numbers; they were written for these three scenarios and the 10-locality graph.
- Layout is designed for laptop screens 1280 px and wider. Below about 1000 px the panels stack and the page scrolls.
- The browser simulator models rules, not radio physics. Real Bluetooth behaviour is a separate question being tested on phones.
- The Midnight Atlas dark theme, organic regions, cinematic camera and adoption sliders from the first brief were deliberately not built (see section 2).

## 8. Tests and how to run them

| Command | What it checks |
|---|---|
| `node tests/sim_explain_test.js` | 27 checks: explanations vs engine on every step of all scenarios |
| `tests/run_sim_v3.sh 1440 900` (also `1280 720`, `1920 1080`, and `… reduce`) | 62 browser checks: the seven questions, animation = engine events, pause/speed, bridge blocking, connected/reachable/received separation, missing-person reasons, priority ordering, views, keyboard, reduced motion, offline, no rescue claims |
| `tests/run_sim.sh 1280 760` / `1440 900` | the original 73-assertion simulator suite |
| `tests/run_engine.sh`, `tests/run_independent_audit.sh`, `tests/run_app22.sh 390 844` | engine, independent audit, mobile-app regressions |
| `tests/sim_shots.sh OUTDIR 1440 900 [states]` | screenshots of the real simulator in named states (`docs/screenshots/sim-v3/`) |

## 9. Demo script (about 110 seconds)

*(Open `prototype/simulator.html`. Scenario 1 is selected. Speed 2×.)*

1. **(0:00)** "Mobile networks are down. This is a simulated area of 80 phones; the ones with a Relay app can pass short messages to phones right next to them, with no internet. Grey dashed phones don't have Relay." *(Point at the situation card.)*
2. **(0:15)** "A person in Hauz Khas needs a doctor." *Click Post request.* "That is the real message the engine created. Only one phone holds it." *Click Step once.* "Dashed lines are what the engine will do next, and the panel says why: emergency requests go to every Relay neighbour, because nobody knows where a helper is."
3. **(0:35)** *Click Play.* "It spreads in all directions along Relay links only. Light blue lines are the actual path it took." *It stalls.* "It stopped. Not slow: stopped. Thirty-one phones have it, and another thirty-one are cut off behind one phone that does not have Relay. The panel names it."
4. **(0:55)** *Click Share Relay at the gap, then Share install file, then Accept.* "A neighbour offers Relay and the owner accepts. Look at the numbers: received has not changed. What changed is *could still receive*, the hollow outlines. Reachable is not received." *Click Play.* "Now it crosses, and phones receive step by step."
5. **(1:15)** "The clinic volunteer is one phone that could respond. The request was never addressed to them." *Click Send offer, then Play.* "The offer is unverified, and it takes the same kind of path back. The requester acknowledges."
6. **(1:35)** "A request travelled. Someone responded. Coordination became possible. This does not show anyone was helped, and Relay cannot guarantee delivery." *(Optional: switch to Missing person to show 'steps away' from the target and the reasons, or Community broadcast to show the urgent request going first on busy links.)*

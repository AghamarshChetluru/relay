# Physical-device test protocol (required before this build may be called usable)

Record every result in a copy of the table at the bottom. **A pass requires evidence** (screenshots of both phones, `adb` output, or video). Do not mark a row passed from memory.

## 0. Setup (each phone)
1. Note model, Android version, build number. Install the **same** APK (`adb install -r`, or via About → Share this app).
2. Turn **off** mobile data, Wi-Fi and (if present) NFC; turn Bluetooth **on**. Optionally enable airplane mode, then re-enable Bluetooth only.
3. Open Relay, choose a neighbourhood, tap the radio chip → allow Bluetooth access. About must show "Bluetooth On, Permission Allowed", and note "Can be found by others".
4. Keep screens on and phones ~1 m apart for the first run.

## 1. Two phones (A, B) - discovery and exchange
1. On A create an urgent request (with an exact address) and a missing-person request with a photo. Note the photo ID shown in the request sheet.
2. Wait up to 2 minutes (the scanner runs in 10 s windows). On B open Help others: both requests must appear; B's About "Last exchange" must change; A's request status must read "Shared with a nearby phone" only after B received it.
3. Compare the **photo ID** (first 8 hex of the content hash) on A and B: must match. B shows the thumbnail.
4. On B send an offer. On A (within 2 minutes) the offer appears; acknowledge it, share the exact address. On B the address appears; **on a third Relay phone that carried the packets it must not**.
5. Record transfer timestamps from the phones' "Last exchange" and `adb logcat -s` (Relay logs no content).

## 2. Three phones (A, B, C) - real store-carry-forward
1. Place A and C where they cannot see each other (different rooms / > 30 m / separated by shielding). Verify: A's About never lists a C contact and vice versa; both are out of range if you walk them together.
2. Create a request on A. Bring B next to A until B has it. Move B away from A to C (A and C never within range). C must receive it (hops = 2). Then send a reply from C and carry B back to A: A receives it. Record all timestamps.
3. If A and C could have connected directly at any point, the run is **invalid**.

## 2b. Inbox and notifications (two phones, real BLE) - not yet exercised on hardware
1. B with the app **closed** (swiped from recents) and notifications allowed: on A create ONE ordinary request. B must show ONE notification for it; tapping it must open that exact request. Lock B: the lock screen must show only a generic line.
2. Create two more requests on A within a minute. B must show ONE "N new messages" notification (not three); tapping it opens the Inbox with all of them under "New to you", and no extra pop-up repeats them.
3. On B send an offer to a request from A, then on A (app closed) wait for the response: ONE notification "Someone sent a response"; tapping it opens that response, highlighted.
4. With B's app **open**, an ordinary request from A must not pop up (inbox badge only); an urgent request in B's declared area or next to it, or a response to B's own request, must pop up once and open that message when tapped; two at once become one "N new messages" pop-up.
5. Expired messages: after a request expires, B must list it behind open unread requests, show "Expired" once, and offer no reply form.
6. Record whether each notification arrived with the app closed, with the screen off, and after force-stop (expected: not after force-stop, because Android stops the radio service).

## 3. Robustness (each at least once)
Airplane mode + Bluetooth on only; screen off for 10 minutes; app swipe-away from recents; force-stop; phone reboot then reopen; toggle Bluetooth off/on; revoke then re-grant Bluetooth permission; walk out of range mid-photo then return (transfer resumes); request that expires while carried (not forwarded after expiry); renew a case (one card, replies preserved); change neighbourhood; stale area warning after 60 minutes; low-battery saver mode.
Malformed input: use a BLE tool (e.g. nRF Connect) to write random bytes to the Relay INBOX characteristic: the session must close and the app must keep working.
Battery: note % drop over one hour idle with Relay on vs off.

## 4. Compatibility matrix
Test at least: one Android 12+ phone, one Android 13/14, one Android 8-11 phone (location permission path), one phone that cannot advertise (if available). List model/OS and which checks passed.

## Result sheet
| Test | Phones (model, Android) | Result (pass/fail/untested) | Evidence | Notes |
|---|---|---|---|---|

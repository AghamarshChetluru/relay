# Inbox, search, read state, notifications and refresh (Android + browser prototype)

Branch `feature/mobile-inbox-notifications`, from `feature/android-offline-mesh` (`1a81af1`). The app is still the Kotlin BLE engine with SQLite storage and the bundled WebView UI from `prototype/` (Gradle copies it into the APK; the UI is not forked). Nothing was migrated to Flutter. The desktop simulator and its routing engine are not touched.

The aim is **discoverability and continuity**: receive a request, notice it, dismiss it, find it later, respond.

## What changed

| | Behaviour |
|---|---|
| **Refresh** | A refresh button in the header (labelled "Check for new messages", 44 px). It re-reads this phone's own SQLite snapshot immediately, then asks the existing BLE transport to start/resume looking for nearby phones if the phone allows it. It shows a subtle busy state and then a completion line. It counts arrivals **from the database**, never from the radio call: "N new messages arrived" only if packets were really stored; otherwise "Nothing new has arrived. Messages only come from nearby phones that have Relay." Bluetooth off / permission missing / no BLE each get their own honest line ("Showing messages saved on this phone. ..."). Taps within 1.2 s do nothing extra. Tab, scroll, search text, filters and every unfinished draft are kept. In the browser prototype it re-draws the list and says so; it never advances the simulated clock or creates a packet. No wording mentions a server or the internet |
| **In-app pop-up (important messages only)** | A compact live-region pop-up between the header and the content (never over an input): "Medical assistance requested · Lodhi Colony" with **Open message** and **Dismiss**; the message text is tappable too. It appears **only for important messages** (next section); every other new message just appears in *New to you* and on the Inbox badge, so the app never nags. It never repeats for the same packet; two at once queue; three or more at once become **one** pop-up ("3 important messages arrived", opens the inbox). Dismissing leaves the message unread. Opening routes to the exact message while a half-written form stays as typed. About has **In-app pop-ups: Important only / Off** (remembered); Off never affects the inbox |
| **Android notifications (app in background or closed)** | Posted from the engine's own "newly stored, validated packet" signal. Two channels: "Important: responses and urgent help near you" (high) and "New messages on this phone" (default). Each notification has its own PendingIntent (unique `relay://open/...` data URI + request code + extras), so two notifications can never open the same destination. Lock-screen content is generic ("New message on this phone"); the shade shows only type and area, never the message body. Every new message gets a system notification when the app is closed (quiet channel for ordinary ones, loud channel for important ones). A burst is batched (3 s window): important messages stand alone; more than two ordinary ones become one "N new messages" summary. **Important messages announced while the app was closed also pop up inside the app, once, the moment the person opens it** (unless they already opened that message from the notification). That memory is kept in the phone's database (flags `popup` / `popped`), so it survives Android killing the process; it stays on screen for 45 s or until acted on. If system notifications are off, in-app banners and the inbox still work; About shows the state and a button to turn them on. Opening a message withdraws the notifications that announced it |
| **Read / unread** | A durable per-message model in the existing `flags` table (kind `read`; `announced` for notification de-duplication), included in the snapshot. New messages are unread; opening the relevant message (not rendering a preview) marks it read; a new response to an older request, an acknowledgment of your offer, or a resolution notice for a case you answered makes that case need attention again; a renewal that only extends the time inherits the earlier version's read state, a renewal that changes the words does not. Existing messages on an upgraded phone are history (marked read, never announced). A read is local: **no packet is created, the sender is told nothing** |
| **Inbox** | Feed becomes **Inbox**: *New to you* (unread requests, updates, relevant responses) / *Active help requests* (priority: urgent, nearby, matching abilities, then recent activity) / *Community updates* / *Earlier messages* (collapsed: expired, resolved, older). Every message appears in exactly one group; each group is capped (4 / 5 / 3 / 5) with "Show N more". Filters (type, neighbourhood, abilities) are one collapsed row that states the current choice. An unread message that has expired stays in *New to you* but is labelled Expired. Cards: type, title, reported area, age or last activity, status, unread dot (and "Unread" for screen readers), and an action ("View request", "Share a sighting", "View response", "Open update"). My activity gets a **Needs your attention** section; the Inbox and My activity tabs show a badge |
| **Search** | A search icon in the Inbox opens a field. Case-insensitive, trimmed, every word must match, partial words work, results appear while typing and keyboard focus stays in the field (including across snapshot updates and refreshes). Searches title, description, category, reported area/landmark, neighbourhood, missing-person last-known place, note, community-update text and the response text this phone can show. Active **and** earlier messages. A match inside a response lists the parent request with the matching text and opens it with that response highlighted and focused. Type/area filters narrow the same search. Empty state: "No matching messages on this phone." / "Relay can only search messages that have reached this phone." No index, no network, no permission |
| **Navigation** | One function, `RelayUI.openMessage({t, caseId, packetId})`, used by cards, search results, banners, Android notifications and My activity. `reply` focuses that response; `ack` focuses the offer that was acknowledged; `broadcast` opens a new lightweight detail sheet; `resolve`/`request` open the case; an expired message opens as **Expired**; a message that is gone gets "no longer stored on this phone" and **Back to inbox** |

## Which messages interrupt? (the priority mechanism)

Decided on the phone, from the packet itself plus this phone's own declared neighbourhood. No server, no GPS, no learning.

| Message | In-app pop-up / loud channel? |
|---|---|
| A **response** (offer or possible sighting) to a request **you** made | **Important** |
| An **acknowledgment** of an offer **you** sent | **Important** |
| An **urgent** request whose reported area is your declared area **or one step away** in the neighbourhood graph | **Important** |
| A **missing-person** request whose search area (or reported area) is your declared area or one step away | **Important** |
| A request that was edited (new words) and meets the two area rules above | **Important** |
| A non-urgent request, an urgent one two or more steps away, a community update, a renewal that only extended the time, a resolution notice | not important: inbox badge + *New to you* (and a quiet system notification when the app is closed) |
| Anything on a phone with no fresh declared area | not important (the phone never guesses relevance) |

Why this shape: replies to your own request are the thing you are waiting for; nearby urgent help is what a neighbour can act on; everything else is reachable in one tap from the badge and would make the app unusable if it interrupted. The rules live in one place (`Inbox.classify`, mirrored for the browser prototype in `noticeFor`) and are unit-tested, including the negatives.

## Android plumbing

* `core/Inbox.kt`: `Ref` (validated identifiers), `Notice` (never carries body text), `ReadState`, `Inbox.classify` (what deserves attention), `NoticePlan` (batching). Pure Kotlin, unit-tested.
* `RelayEngine.onStored`: called once per packet that arrived from another phone and was newly stored. **Not** called for duplicates, rejected or expired packets, photo chunks, polling, radio-status changes, or anything this phone wrote. It runs before housekeeping (which deletes the older version of a renewed request) so a renewal can be compared with what it replaced. A failing observer cannot affect storage or forwarding.
* `NoticeCenter` (app open -> pop-up queue for important notices only; app closed -> batched system notification, and important ones are remembered to pop up when the app opens), `ui/Notifier` (channels, unique PendingIntents, private lock-screen version, cancellation), `MainActivity` (`singleTop`, `onNewIntent`, cold-start intent, one-shot hand-over via `takePendingOpen`, an Intent is marked handled so a re-delivery cannot re-open it), `NativeBridge` (`markRead`, `takeIncoming`, `takePendingOpen`, `refreshNow`, `notificationState`, ...).
* No new permission (`POST_NOTIFICATIONS` was already declared), no internet, no Firebase, no accounts, no GPS.

## Distinct words, kept distinct

Saved on this phone / Shared with a nearby phone / Received on this phone / **Opened (read) on this phone** / Acknowledged / Resolved. A banner or notification means "this phone stored a message"; it does not mean the sender knows it was read.

## Tests

| Suite | Checks |
|---|---|
| `./gradlew :app:testDebugUnitTest` | the existing JVM engine/protocol suites + `InboxTest` (classification for every packet type, duplicates/rejected/expired never signal, renewal rules, response routing, ack/resolve audience, batching, reference validation), `NoticeCenterTest` (one banner per genuinely new packet, none after restart + duplicate, renewal read inheritance), `InboxFixturesTest` (real-engine snapshots for the UI tests) |
| `tests/run_android_inbox.sh W H` | the exact web assets bundled in the APK, on real-engine snapshots: groups without duplicates, unread/read through open, restart persistence, banner (accessible, above the content, never repeated, dismiss leaves unread, draft kept), search (partial, trimmed, earlier items, response text, empty state, filters, focus kept), second response needs attention again, two notifications -> two destinations, cold-start open, expired/removed fallbacks, refresh (debounce, honest states, no invented messages, draft kept), many messages (capped groups), About notification state |
| `tests/run_android_ui.sh`, `tests/run_app22.sh` | the existing Android-adapter and browser-prototype suites (a few assertions updated: "Feed"/"Expired or resolved" are now "Inbox"/"Earlier messages", and an unread resolved/expired request first shows in New until opened) |
| `./gradlew :app:connectedDebugAndroidTest` (emulator, Android 14) | all 26 instrumented tests pass, 1 manual fixture skipped (the existing ones, unchanged, plus new in `InboxNotificationTest`): two real notifications are distinct, private on the lock screen and body-free, with different PendingIntents; duplicates post nothing; a six-message burst is one summary; a notification tap cold-starts the real WebView on the exact reply and a second tap while running (`onNewIntent`) opens a different one; read state survives reopening the SQLite database |

### While-away pop-up check on the emulator

After the same fixture (process dead, notifications in the tray), opening the app by hand shows the pop-up "Someone sent a response · Green Park — View response" above the Home content, with the Inbox and My activity badges (`docs/screenshots/inbox/android-in-app-popup-on-open.png`). The 12-second auto-hide used in the first version hid it before the (slow, first) WebView load finished; it now stays 45 s.

### Process restart check (manual, `ManualRestartFixture`)

`adb shell am instrument -w -e manual true -e class app.relay.ManualRestartFixture app.relay.mesh.test/androidx.test.runner.AndroidJUnitRunner` leaves two real notifications and exits; the app process is then not running (`pidof` empty) while the notifications are still in the shade; tapping "Someone sent a response" cold-starts the app and opens the request with that response outlined (`docs/screenshots/inbox/android-notification-shade.png`, `android-after-tap-cold-start.png`).

## Limitations

* **Retention.** The engine evicts a received request 30 minutes after it expires (unless it involves you). "Earlier messages" shows what is still on the phone; this feature does not extend retention, because that would change storage, not just the UI.
* The notification text for a request shows type and area; the title of the request is shown in the shade for responses ("about"). Lock-screen content is generic only if the phone is set to hide sensitive notification content (the default "private" visibility honours that setting).
* Notifications come only from a running process: they exist while the radio service/app runs. If Android stops the service (battery saver), no packet is received and nothing is announced; the unread state is still there when the app opens.
* A renewal with changed words shows "New" on the card (the label "Request updated" is used by the banner/notification, which see the earlier version).
* Not tested on two physical phones: this environment has one emulator and no radio peer, so message receipt over real BLE between two handsets was not exercised. BLE forwarding code is unchanged (`ble/*`, `Link.kt`, `Policy.kt`, `Framing.kt`, `mesh.js` have no diff), but receipt-to-notification on real hardware needs the two-phone test in `docs/FIELD_TEST_CHECKLIST.md`.
* "From a nearby volunteer" wording in the offer box is pre-existing text in this branch; it is not changed here.

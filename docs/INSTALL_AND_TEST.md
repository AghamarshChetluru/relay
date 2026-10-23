# Relay — install on two phones and test over Bluetooth (no internet)

**Status: UNVERIFIED-DEMO field-test build.** Nobody has yet shown that this app talks over Bluetooth between real phones. The point of this test is to find out. If something fails, that is useful information: see "If something goes wrong" at the end.

| | |
|---|---|
| File | `Relay-Android-FieldTest.apk` |
| Size | 2561048 bytes (2.44 MB) |
| SHA-256 | `2db6de720ee7a82e21c1e47c876208d1774809dcfbb20bfd884f569f9fed6d80` |
| Needs | Android 8.0 or newer, with Bluetooth LE (almost every phone since 2015) |
| Internet | The app has **no internet permission**. You need internet only for the transfer/install step, if you use a download or cloud method. |

---------------------------------------------------------------------

## Part 1 — Get the file onto both phones

Pick **one** method. All three install exactly the same file, so both phones will have the same app and the same signature.

### Method A (easiest, private): download straight from your Mac over Wi-Fi
1. Connect the Mac and both phones to the **same Wi-Fi**.
2. In the `Relay-Field-Test` folder, double-click **`Start-Private-Download.command`**. (If macOS says it can't be opened because it is from an unidentified developer: right-click it, choose **Open**, then **Open** again. If it says the file is not executable, open Terminal and run `bash ~/Desktop/Relay-Field-Test/Start-Private-Download.command`.)
3. A Terminal window prints an address like `http://192.168.1.23:8765/ab12cd34/Relay-Android-FieldTest.apk`.
4. On each phone, open **Chrome**, type that address exactly, and let the file download. If Chrome says "This type of file can harm your device", tap **Download anyway**.
5. The Mac only serves this one file, at that secret address, for 30 minutes, then stops. Your GitHub repository and your Mac's other files are never exposed. Close the Terminal window when both phones have the file.

### Method B: USB cable
1. Plug the phone into the Mac. On the phone, pull down the notification and change "Charging this device via USB" to **File transfer**.
2. Mac needs a helper to see Android files: install **OpenMTP** (free) or Google's **Android File Transfer**. Copy `Relay-Android-FieldTest.apk` into the phone's **Download** folder.
3. On the phone, open the **Files** app → **Download** → tap the APK.

### Method C: your own private cloud or messaging
Upload the APK to your own Google Drive / iCloud link / email to yourself, and download it on each phone. (The file is just the app; it contains no private data. Still, it is a third-party upload, so Method A or B is preferable.)

**Optional check (recommended):** the file should be 2561048 bytes (2.44 MB). On a Mac: `shasum -a 256 Relay-Android-FieldTest.apk` must print the SHA-256 above.

---------------------------------------------------------------------

## Part 2 — Install on each phone

1. Tap the downloaded file (Chrome's download notification, or the **Files** app → Downloads).
2. Android may say **"For your security, your phone isn't allowed to install unknown apps from this source."** That is normal for any app not from the Play Store.
   - Tap **Settings**, switch on **Allow from this source** (it is the app you opened the file from: Chrome, Files, Drive…), press Back.
   - You can switch it off again after installing.
3. Tap **Install**.
4. Google Play Protect may show **"App blocked / Unknown developer / Send for scanning"**. The app is signed with a personal test key, not a Play Store key. Tap **More details → Install anyway** (or **Install without scanning**). Do this only for this file that you built yourself.
5. Tap **Open**.

Install the **same file** on both phones. If a phone already has a different build of Relay (for example a debug build), uninstall that first: Settings → Apps → Relay → Uninstall.

---------------------------------------------------------------------

## Part 3 — First start and permissions (on each phone)

1. On the first screen, tap your neighbourhood (**Phone A: Hauz Khas**, **Phone B: Green Park**) and tap **Continue**.
2. On the home screen tap the yellow **Allow Bluetooth access** button (or the "Relay radio off · tap" chip at the top).
3. Android asks permissions. Choose:
   - **Android 12 or newer:** "Allow Relay to find, connect to and determine the relative position of nearby devices?" → **Allow**. (This is Android's standard wording for "Nearby devices" Bluetooth access. Relay does not use GPS or location.)
   - **Android 13 or newer:** "Allow Relay to send you notifications?" → **Allow**. This shows the "Relay is on" notification that keeps Bluetooth running.
   - **Android 8, 9, 10, 11 (older phones):** Android shows a **Location** permission instead, because on these versions Bluetooth scanning is tied to it. Choose **Allow only while using the app** (or "While using the app"). Relay never reads your location.
4. **Android 8–11 only:** the phone's **Location switch must also be ON** (pull down the quick settings and tap **Location**). If it is off, the phone silently finds no one. Relay will say so on the About screen. **Android 12+ does not need Location on.**
5. If Bluetooth was off, the app offers **Turn on Bluetooth**; tap it and allow. Keep Bluetooth on all through the test.
6. Recommended for this test: Settings → Apps → Relay → **Battery → Unrestricted** (wording varies by brand), and keep both screens on and the Relay app open for the first run. Phone makers (Xiaomi, Oppo, Vivo, Samsung "sleeping apps", etc.) are aggressive at stopping background apps; background reliability is **not yet tested**.

### How to confirm the Bluetooth service is really running
- A notification **"Relay is on — Looking for nearby phones. No internet is used."** is shown (pull down the notification shade). It has a **Stop Relay** button.
- The chip at the top of Relay reads **"Looking for phones…"** (not "Relay radio off", "Bluetooth is off" or "Relay paused").
- Tap the **ⓘ** icon (top right) → **About Relay** → scroll to **Field Test Diagnostics (for testers)** and tap it open. Steps **1–5** should read: Bluetooth **On**, Permissions **Allowed**, Relay running **Yes**, Scanning (Yes now and then — it scans in short windows), Advertising **Yes**. If "Advertising" says "Not supported on this phone", that phone can look for others but others cannot find it; both phones need to be able to advertise, or at least one of them.

---------------------------------------------------------------------

## Part 4 — The two-phone test

**Before you start:** on both phones turn **Wi-Fi OFF and mobile data OFF** (or Airplane mode, then turn **only Bluetooth** back on). Bluetooth must stay on. Put the phones **about 1 metre apart**. Have a clock/stopwatch ready and write times in the table at the bottom.

### Phone A (Hauz Khas)
1. Open Relay. Confirm the checks in Part 3.
2. Tap **Request** (bottom bar) → **Urgent assistance**. Fill in a short description (e.g. "Test: need a doctor"), street/landmark (e.g. "Test gate"), leave the other defaults, tap **Save request on this phone**. **Write down the time → T0.**
3. Open **My activity**. The request should say **"Saved on this phone"**. That is the honest starting status.

### Phone B (Green Park)
4. Open Relay and keep it on the home screen. Wait. When Phone A's request arrives you will see a message like "A new request reached your phone." and it appears under **Help others** (the **Feed** tab) with a **Urgent** label. **Write down the time → T1** (discovery + delivery).
5. Tap it → **I can help**, write "Test: I can help", tap **Send offer**. **Time → T2.**

### Back on Phone A
6. Wait for "A response reached your phone." The offer appears under the request in **My activity**. **Time → T3.**
7. Tap **Acknowledge offer**. **Time → T4.** The request also changes to "Shared with a nearby phone" only when Phone B itself confirmed it stored the request.

### Phone B
8. Wait for "The requester acknowledged your offer." **Time → T5.**

Relay only says something was *shared* or *delivered* when the **other phone confirmed** it stored it. "Saved on this phone" means it exists only on that phone.

**Pass** = steps 4, 6 and 8 happen with Wi-Fi and mobile data off. **Please report even a fail**, with the diagnostics (below).

### Short extra tests (only after the main test works)
| Test | Do this | Pass looks like |
|---|---|---|
| Community broadcast | Phone A: **Home → Share an update with people nearby**, send "Test: water point open" | Phone B: **Feed → Community updates** shows it once |
| No duplicates | Leave both phones together for 5 minutes | Each message appears **once** on each phone; Diagnostics "Duplicates ignored" may rise but cards never repeat |
| Photo | Phone A: **Request → Find someone**, fill in the form, tap **Add a photo**, pick a picture, save | Phone B shows the request, then the photo after a short while ("only if the network has room"). Record how long |
| Bluetooth drop | Phone B: turn **Bluetooth off** for 1 minute, then on. Phone A: make a new broadcast while B is off | After B's Bluetooth is back (Relay chip returns to "Looking for phones…"), B receives it. Relay must not crash or lose earlier messages |
| App restart | Swipe Relay away from recent apps on Phone A, reopen | Earlier requests are still there |

Tests **not** covered here (need three phones or more time): A→B→C relaying, background/battery behaviour overnight, different phone brands.

### Record your results
| Event | Time | Seconds after T0 |
|---|---|---|
| T0 request saved on A | | 0 |
| T1 request visible on B | | |
| T2 B sent offer | | |
| T3 offer visible on A | | |
| T4 A acknowledged | | |
| T5 ack visible on B | | |

---------------------------------------------------------------------

## Part 5 — Field Test Diagnostics: what the numbers mean

Open **ⓘ → About Relay → Field Test Diagnostics (for testers)**. It lists these in order; the first number that stays at 0 shows where it fails:

| # | Line | If it is wrong |
|---|---|---|
| 1 | Bluetooth | Turn Bluetooth on |
| 2 | Permissions | Tap Allow Bluetooth access; Android 8–11: allow Location, and turn the Location switch on |
| 3 | Relay running | Tap Start Relay / the chip; check the "Relay is on" notification |
| 4 | Scanning now | Short windows every 20–60 s; "No (between windows)" is normal |
| 5 | Advertising (findable) | "Not supported" = this phone can't be found by others |
| 6 | Relay phones found | 0 means discovery isn't working (distance, Location switch on Android 8–11, one phone can't advertise, or Bluetooth stack issue) |
| 7 | Connections made | Found but 0 connections: look at the events list for "connecting…" then "link closed before any exchange" (Bluetooth connect error such as status 133) |
| 8 | Exchanges | Connection but 0 completed: the events list shows why it ended |
| 9 | Our packets confirmed stored by another phone | The **only** number that proves the other phone stored our message |
| 10 | New packets stored from others | Messages we received and stored |

The **events** list below shows the last steps in plain words (e.g. "found a Relay phone (id a1b2)", "connected…", "exchange finished: 1 of ours confirmed stored by the other phone…"). It contains **no message text, addresses, message IDs, device addresses or keys**.

### If something goes wrong: collect a safe log
- **Easiest:** on that phone open Field Test Diagnostics and tap **Share diagnostic log**; send it to yourself (email/messaging). It is plain text: counters, short events, phone model and Android version. Do this on **both** phones, as soon as possible after the failure (it only keeps the latest ~80 events and clears when the app restarts).
- **With a USB cable (optional):** enable Developer options → USB debugging on the phone, then on the Mac: `adb logcat -d -s RelayDiag` prints the same event lines.
- Add: the two phone models and Android versions, how far apart the phones were, whether Wi-Fi/data were off, and the times from your table.
- Please **do not** send screenshots of the request text/addresses, or full `adb logcat` dumps; they can contain unrelated private information.

---------------------------------------------------------------------

## Known limitations of this build (read before judging results)
- **Never tested on real radios before this test.** Everything about Bluetooth discovery, connections and message exchange is unproven until you run it.
- Some phones **cannot advertise** over Bluetooth LE, so they cannot be found; some phone makers kill background apps; Bluetooth behaviour differs between brands. A failure on one pair of phones may not be Relay's fault, so note models.
- Android 8–11 needs the Location permission **and** the Location switch on (Part 3). Android 12+ does not.
- The app is **not for real emergencies**. It is a test build: delivery is never guaranteed. Messages and addresses are not independently security-reviewed; do not put real private addresses in test messages.
- The app advertises with a temporary test identifier (Bluetooth company ID `0xFFFF`); a real release would need a registered one.
- The "Share this app" feature inside Relay (phone to phone) is not part of this test.
- Signed with a **test key** stored on the developer's Mac (`~/.relay-field-test-keys/`). Back it up if you want to update the app later without uninstalling it.

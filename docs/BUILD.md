# Building and testing (macOS, reproducible)

## Prerequisites
* JDK 17 (`brew install openjdk@17`), Android SDK with `platform-tools`, `platforms;android-34`, `build-tools;34.0.0` (`brew install --cask android-commandlinetools`, then `sdkmanager`). Optional for emulator tests: `emulator`, `system-images;android-34;google_apis;arm64-v8a`.
* Gradle is provided by the wrapper (8.7). Node 18+ and Google Chrome for the browser-side tests.

```bash
export JAVA_HOME=/opt/homebrew/opt/openjdk@17/libexec/openjdk.jdk/Contents/Home
export ANDROID_HOME=/opt/homebrew/share/android-commandlinetools
echo "sdk.dir=$ANDROID_HOME" > android/local.properties      # git-ignored
```

## Tests
```bash
cd android && ./gradlew :app:testDebugUnitTest                 # JVM: protocol, engine, policy, store contract, replay (61 tests)
cd .. && tests/run_engine.sh && tests/run_independent_audit.sh # browser engine + independent audit scripts
cd android && ./gradlew :app:syncRelayAssets :app:testDebugUnitTest && cd .. && tests/run_android_ui.sh 390 844   # WebView adapter vs REAL engine snapshots
tests/run_app22.sh 390 844 && tests/run_sim.sh 1440 860        # browser prototype + simulator regression
cd android && ./gradlew :app:lintDebug
# emulator / device instrumented tests (SQLite contract, persistence, Keystore, bridge, manifest, WebView smoke):
./gradlew :app:connectedDebugAndroidTest
```

## Build
```bash
cd android && ./gradlew :app:assembleDebug     # -> app/build/outputs/apk/debug/app-debug.apk  (debug-signed, test only)
adb install -r app/build/outputs/apk/debug/app-debug.apk
```
A release build is signed from environment variables that are **never committed**: `RELAY_KEYSTORE`, `RELAY_KEYSTORE_PASSWORD`, `RELAY_KEY_ALIAS`, `RELAY_KEY_PASSWORD`, then `./gradlew :app:assembleRelease`. Without them the release APK is unsigned and not installable. A release must not be produced until the gates in `QA_REPORT.md` pass.

## Installing on another phone (explicit, user-approved)
Use the app's **About → Share this app** (Android share sheet). The recipient must approve installation from that source. The sender shows the SHA-256 printed by the app; the recipient can compare it with `shasum -a 256` on the file.


## Field-test signing (two-phone test builds)
Release builds are signed only when these environment variables are set (never committed): `RELAY_KEYSTORE`, `RELAY_KEYSTORE_PASSWORD`, `RELAY_KEY_ALIAS`, `RELAY_KEY_PASSWORD`. The author keeps a dedicated *test* keystore outside the repository (`~/.relay-field-test-keys/`) so every field-test APK has the same signature and installs over the previous one. It is not a production key. `.gitignore` excludes `*.jks`, `*.keystore`, `signing.env` and `dist/`.

    set -a; . ~/.relay-field-test-keys/signing.env; set +a
    cd android && ./gradlew assembleRelease     # -> app/build/outputs/apk/release/app-release.apk
    tests/verify_apk.sh android/app/build/outputs/apk/release/app-release.apk
    apksigner verify --print-certs <apk>
Install and test steps for testers: `docs/INSTALL_AND_TEST.md`.

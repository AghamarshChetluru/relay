# Relay documentation index

Start with the [root README](../README.md). This page lists every document by purpose.

## The case: why Relay exists and what was built

| Document | What it is |
|---|---|
| [`appendix-prd/Relay_Complete_PRD_Appendix.pdf`](appendix-prd/Relay_Complete_PRD_Appendix.pdf) | The as-built product requirements document: problem, users, screens, features, offline networking, privacy decisions, assumptions and proposed measures. Also available as [HTML](appendix-prd/Relay_Complete_PRD_Appendix.html) and [Markdown](appendix-prd/Relay_Complete_PRD_Appendix.md). |
| [`appendix-prd/SOURCE_TRACEABILITY.md`](appendix-prd/SOURCE_TRACEABILITY.md) | A ledger that records where each claim in the PRD came from (code, docs, case materials, external research, assumptions). |
| [`media/`](media/) | The 65-second explainer video, its poster and its voice-over script. |
| [`screenshots/product-case/`](screenshots/product-case/) | Real captures of the app used in the PRD and the README. |

## Architecture and security

| Document | What it is |
|---|---|
| [`architecture/ARCHITECTURE.md`](architecture/ARCHITECTURE.md) | How the Android app is built: engine, store, transport, UI bridge, and what is reused from the browser prototype. |
| [`architecture/TRANSPORT_ADR.md`](architecture/TRANSPORT_ADR.md) | Decision record for the Bluetooth LE transport: roles, discovery, handshake, framing, and the alternatives rejected. |
| [`architecture/SECURITY.md`](architecture/SECURITY.md) | The security model: what is protected, how, and what is not. Not independently reviewed. |
| [`architecture/LIMITATIONS.md`](architecture/LIMITATIONS.md) | Known limitations, written before physical-phone testing was reported. |

## Building, installing and testing the Android app

| Document | What it is |
|---|---|
| [`android/BUILD.md`](android/BUILD.md) | Requirements, building, signing (keys are never committed), and APK verification. |
| [`android/INSTALL_AND_TEST.md`](android/INSTALL_AND_TEST.md) | Installing on phones, including sharing the APK from one phone to another, and a first test. |
| [`android/FIELD_TEST_CHECKLIST.md`](android/FIELD_TEST_CHECKLIST.md) | The protocol and result sheet for testing on real phones (two, three and more phones, robustness, compatibility). |
| [`android/INBOX_AND_NOTIFICATIONS.md`](android/INBOX_AND_NOTIFICATIONS.md) | The inbox, search, read state, in-app pop-ups, Android notifications and refresh: behaviour, rules, tests and limits. |
| [`android/ANDROID_HANDOFF.md`](android/ANDROID_HANDOFF.md) | The original engineering brief for the Android build. |

## Quality and evidence

| Document | What it is |
|---|---|
| [`quality/QA_REPORT.md`](quality/QA_REPORT.md) | QA report for the Android field-test build (dated; predates the physical-phone reports). |
| [`quality/RELAY_V2_2_INDEPENDENT_AUDIT.md`](quality/RELAY_V2_2_INDEPENDENT_AUDIT.md) | An independent audit of the browser prototype and the gaps between simulation and a real app. |
| [`quality/BASELINE.md`](quality/BASELINE.md), [`quality/BASELINE_CHECKSUMS.txt`](quality/BASELINE_CHECKSUMS.txt) | Integrity record of the original browser baseline. |
| [`history/`](history/) | Earlier QA reports, kept for the record. |

## The browser prototype

| Document | What it is |
|---|---|
| [`prototype/DEMO_INSTRUCTIONS.txt`](prototype/DEMO_INSTRUCTIONS.txt) | A three-minute walkthrough of the app and the simulator. |

## Other

| Document | What it is |
|---|---|
| [`LICENSE_DECISION.md`](LICENSE_DECISION.md) | The licence is not yet chosen; options and trade-offs. |

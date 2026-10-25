# Security model (Android build)

**Status: not independently reviewed. Do not describe this app as "secure" or "private" without that qualification.**

## What is protected, and how

| Property | Mechanism | Tested |
|---|---|---|
| Packet authenticity and integrity | Every packet is Ed25519-signed; the packet ID is the SHA-256 of the signed body, so any bit flip changes the ID or fails verification | JVM: every single-bit flip rejected; forged/truncated/oversized packets rejected |
| Case ownership | `caseId = H(authorKey ‖ nonce)`, verified on receipt. Only the key holder can mint a case, renew it, or sign its ack / resolve / address / photo. Signers are checked before any status changes | JVM: forged case ID, forged resolve/ack/address/photo ignored |
| Exact address confidentiality | The address is never placed in a broadcast packet. The requester encrypts it to ONE volunteer's X25519 key (ephemeral X25519 + HKDF-SHA256 + AES-256-GCM, AAD binds case and reply, requester signs it). Relaying phones carry ciphertext they cannot read | JVM: carrier cannot open it; wrong key/AAD/tamper fail; address absent from every plaintext packet and from a carrier's UI snapshot |
| Photo integrity | Attachment ID = SHA-256 of the bytes; the photo must be signed by the requester; chunks are reassembled and hash-verified; a mismatch discards the bytes | JVM: corrupt chunk detected; resume works |
| Private keys at rest | Identity keys are wrapped with a non-exportable Android Keystore AES-256-GCM key; cloud backup and device transfer are disabled | Emulator instrumented tests |
| No network exfiltration | The manifest has **no INTERNET permission** | Verified from the built APK and by an instrumented test |
| Abuse limits | Size/field/route/hop limits, per-origin rate limit (30/hour), per-session frame/byte budget, strike-and-close on protocol violations, storage cap | JVM + fuzz-style tests |
| Honest delivery state | "Shared with a nearby phone" only after the peer sent a PACK "stored" receipt | JVM: dropped receipts are never invented |

## What is NOT protected (read this)

* **Request text, photos, neighbourhoods and community posts are not encrypted.** Any phone that carries a packet can read it. Only the exact-address share is encrypted.
* **Pseudonymous, not anonymous.** All packets from one phone share one signing key, so a observer holding packets can link them. The declared neighbourhood is included in requests.
* **Radio metadata.** Advertising uses a tag that rotates hourly, but after a connection both phones learn each other's stable device ID. The 2-byte inventory digest in the advertisement can fingerprint a phone's state while unchanged. Standard BLE address privacy applies; Relay adds no more.
* **No identity verification.** Volunteers' claims (nurse, doctor) are self-reported and labelled unverified. A malicious phone can post false requests or sightings within the rate limit.
* **Sybil / flooding.** Rate limits are per signing key, so an attacker with many keys can still fill caches; the storage cap evicts lowest priority first but cannot stop a determined local flood.
* **Clock.** Expiry uses each phone's own clock and the remaining lifetime sent hop by hop; a hostile sender cannot extend life beyond the signed validity, but a phone whose clock is changed by its user can mis-time its own copies.
* **Crypto review.** The sealed-box construction uses audited Tink primitives but is a custom composition (not RFC 9180 HPKE) and has not been reviewed by a cryptographer. The recipient's long-term X25519 key has no forward secrecy: if it is later extracted, past sealed addresses stored on carriers could be decrypted until they expire (60 minutes + cache grace).
* **Exact address on the requester's phone** is stored unencrypted in the app database (protected by Android's app sandbox and full-disk encryption only).
* **APK sharing** transfers the app file; Android shows its own install prompt and signer. Debug builds are signed with a developer debug key and must not be distributed as a release.

## Logging

The app writes no message content, addresses, or photos to logs. Radio status strings shown in the UI contain only coarse state.

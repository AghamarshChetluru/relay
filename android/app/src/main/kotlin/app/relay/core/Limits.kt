package app.relay.core

/** Every bound the protocol enforces. Anything larger is rejected, never truncated. */
object Limits {
    const val PROTOCOL_VERSION = 1
    const val MAX_ENVELOPE_BYTES = 4096
    const val MAX_FIELDS = 24
    const val MAX_KEY_CHARS = 24
    const val MAX_FIELD_BYTES = 1200
    const val MAX_TITLE = 100
    const val MAX_DESCRIPTION = 240
    const val MAX_AREA = 80
    const val MAX_NOTE = 240
    const val MAX_BROADCAST_TEXT = 280
    const val MAX_ADDRESS_FIELD = 160
    const val MAX_TARGETS = 6
    const val MAX_HOPS_CEILING = 64
    const val MAX_FANOUT_CEILING = 8
    const val MAX_CASE_VERSION = 50
    const val MAX_PHOTO_BYTES = 32 * 1024
    const val ATTACHMENT_CHUNK = 1000
    const val MAX_FRAME_BYTES = 4400
    const val MAX_INV_ENTRIES = 24
    const val MAX_WANT_IDS = 24
    const val MAX_SESSION_BYTES = 400 * 1024
    const val MAX_SESSION_FRAMES = 2000
    const val MAX_STORED_PACKETS = 500
    const val MAX_ATTACHMENT_STORE_BYTES = 8 * 1024 * 1024
    const val RATE_PER_ORIGIN_PER_HOUR = 30
    const val RATE_PER_PEER_PER_SESSION = 120
    const val MINUTE_MS = 60_000L
}

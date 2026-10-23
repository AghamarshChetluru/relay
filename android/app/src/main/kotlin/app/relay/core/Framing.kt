package app.relay.core

/**
 * BLE carries a byte stream split into MTU-sized writes/notifications. Each protocol frame is sent as [len:u16 big-endian][frame bytes].
 * The assembler enforces [Limits.MAX_FRAME_BYTES] so a hostile peer cannot make us buffer unbounded data.
 */
object Framing {
    fun encode(frame: ByteArray): ByteArray {
        require(frame.isNotEmpty() && frame.size <= Limits.MAX_FRAME_BYTES) { "frame size" }
        return Writer().u16(frame.size).raw(frame).toByteArray()
    }
    /** Split an encoded stream chunk into pieces that fit a BLE payload (ATT MTU - 3). */
    fun fragment(encoded: ByteArray, payload: Int): List<ByteArray> {
        require(payload >= 20)
        val out = ArrayList<ByteArray>(); var i = 0
        while (i < encoded.size) { val e = minOf(encoded.size, i + payload); out.add(encoded.copyOfRange(i, e)); i = e }
        return out
    }
}

class StreamAssembler {
    private var buf = ByteArray(0)
    var broken = false; private set
    /** Feed received bytes; returns the complete frames now available. Sets [broken] (and returns nothing) on any framing violation. */
    fun feed(bytes: ByteArray): List<ByteArray> {
        if (broken) return emptyList()
        buf += bytes
        val out = ArrayList<ByteArray>(); var p = 0
        while (true) {
            if (buf.size - p < 2) break
            val len = ((buf[p].toInt() and 0xff) shl 8) or (buf[p + 1].toInt() and 0xff)
            if (len == 0 || len > Limits.MAX_FRAME_BYTES) { broken = true; buf = ByteArray(0); return out }
            if (buf.size - p - 2 < len) break
            out.add(buf.copyOfRange(p + 2, p + 2 + len)); p += 2 + len
        }
        buf = if (p == 0) buf else buf.copyOfRange(p, buf.size)
        if (buf.size > Limits.MAX_FRAME_BYTES + 2) { broken = true; buf = ByteArray(0) }
        return out
    }
}

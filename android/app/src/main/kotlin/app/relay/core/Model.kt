package app.relay.core

import java.util.TreeMap

enum class PacketType(val code: Int, val label: String) {
    REQUEST(1, "request"), REPLY(2, "reply"), ACK(3, "ack"), RESOLVE(4, "resolve"), BROADCAST(5, "broadcast"), ADDRESS(6, "address"), ATTACHMENT(7, "attachment");
    companion object { fun fromCode(c: Int): PacketType = values().firstOrNull { it.code == c } ?: throw WireException("unknown packet type $c") }
}

enum class PolicyKind(val code: Int) {
    FLOOD(0), DIRECTED(1), OPPORTUNISTIC(2);
    companion object { fun fromCode(c: Int): PolicyKind = values().firstOrNull { it.code == c } ?: throw WireException("unknown policy $c") }
}

/** Routing instructions chosen by the author (signed): the per-type policy of the prototype engine. */
data class Route(val policy: PolicyKind, val maxHops: Int, val fanout: Int, val detourMax: Int, val detourAway: Int, val targets: List<String>) {
    fun encode(w: Writer) {
        w.u8(policy.code).u8(maxHops).u8(fanout).u8(detourMax).u8(detourAway).u8(targets.size)
        targets.forEach { w.str(it) }
    }
    companion object {
        fun decode(r: Reader): Route {
            val pol = PolicyKind.fromCode(r.u8()); val mh = r.u8(); val fo = r.u8(); val dm = r.u8(); val da = r.u8(); val n = r.u8()
            if (n > Limits.MAX_TARGETS) throw WireException("too many targets")
            return Route(pol, mh, fo, dm, da, List(n) { r.str(4) })
        }
    }
}

/** Priority class: 0 urgent, 1 normal, 2 broadcasts and attachments. Urgent text always goes before photo bytes. */
fun priorityOf(type: PacketType, urgent: Boolean): Int = if (type == PacketType.BROADCAST || type == PacketType.ATTACHMENT) 2 else if (urgent) 0 else 1

/**
 * A signed packet as it travels. Everything here is covered by the Ed25519 signature and by the content-addressed packet ID.
 * Per-hop values (hops, detours, remaining lifetime) are deliberately NOT part of it: they are carried beside it on each link.
 */
class Envelope(
    val type: PacketType, val caseId: ByteArray?, val caseVersion: Int, val origin: ByteArray, val createdMs: Long, val validityMs: Long,
    val urgent: Boolean, val route: Route, fieldsIn: Map<String, ByteArray>, val signature: ByteArray
) {
    val fields: Map<String, ByteArray> = TreeMap(fieldsIn)
    private var cachedBody: ByteArray? = null

    fun signedBody(): ByteArray = cachedBody ?: encodeBody().also { cachedBody = it }
    val id: String by lazy { id16(signedBody()).hex() }
    val caseHex: String? get() = caseId?.hex()
    val originDevice: String get() = Identity.deviceIdOf(origin)
    val priority: Int get() = priorityOf(type, urgent)
    fun wire(): ByteArray = signedBody() + signature

    fun s(key: String): String = fields[key]?.toString(Charsets.UTF_8) ?: ""
    fun has(key: String): Boolean = fields.containsKey(key)

    private fun encodeBody(): ByteArray {
        val w = Writer()
        w.raw(MAGIC).u8(Limits.PROTOCOL_VERSION).u8(type.code)
        if (caseId != null) { w.u8(1).raw(caseId) } else w.u8(0)
        w.u16(caseVersion).raw(origin).u64(createdMs).u32(validityMs).u8(if (urgent) 1 else 0)
        route.encode(w)
        w.u8(fields.size)
        for ((k, v) in fields) { w.str(k); w.bytes(v) }
        return w.toByteArray()
    }

    companion object {
        private val MAGIC = byteArrayOf('R'.code.toByte(), 'L'.code.toByte(), 'Y'.code.toByte())

        fun build(
            type: PacketType, caseId: ByteArray?, caseVersion: Int, createdMs: Long, validityMs: Long, urgent: Boolean, route: Route,
            fields: Map<String, ByteArray>, identity: Identity, crypto: Crypto
        ): Envelope {
            val unsigned = Envelope(type, caseId, caseVersion, identity.signPub, createdMs, validityMs, urgent, route, fields, ByteArray(64))
            val sig = crypto.sign(identity.signPriv, unsigned.signedBody())
            return Envelope(type, caseId, caseVersion, identity.signPub, createdMs, validityMs, urgent, route, fields, sig)
        }

        /** Strict parse. Any deviation (magic, version, trailing bytes, over-long fields) throws [WireException]. */
        fun decode(bytes: ByteArray): Envelope {
            if (bytes.size > Limits.MAX_ENVELOPE_BYTES) throw WireException("envelope too large")
            if (bytes.size < 3 + 1 + 1 + 1 + 2 + 32 + 8 + 4 + 1 + 6 + 1 + 64) throw WireException("envelope too small")
            val r = Reader(bytes, 0, bytes.size - 64)
            val m = r.raw(3); if (!m.contentEquals(MAGIC)) throw WireException("bad magic")
            val ver = r.u8(); if (ver != Limits.PROTOCOL_VERSION) throw WireException("unsupported version $ver")
            val type = PacketType.fromCode(r.u8())
            val hasCase = r.u8(); if (hasCase > 1) throw WireException("bad case flag")
            val caseId = if (hasCase == 1) r.raw(16) else null
            val cv = r.u16(); if (cv > Limits.MAX_CASE_VERSION) throw WireException("case version too high")
            val origin = r.raw(32); val created = r.u64(); val validity = r.u32()
            val flags = r.u8(); if (flags > 1) throw WireException("bad flags")
            val route = Route.decode(r)
            val n = r.u8(); if (n > Limits.MAX_FIELDS) throw WireException("too many fields")
            val fields = TreeMap<String, ByteArray>(); var last: String? = null
            repeat(n) {
                val k = r.str(Limits.MAX_KEY_CHARS); val v = r.bytes(Limits.MAX_FIELD_BYTES)
                if (last != null && k <= last!!) throw WireException("fields not in canonical order")   // also rejects duplicates
                last = k; fields[k] = v
            }
            if (r.remaining() != 0) throw WireException("trailing bytes")
            val sig = bytes.copyOfRange(bytes.size - 64, bytes.size)
            return Envelope(type, caseId, cv, origin, created, validity, flags == 1, route, fields, sig)
        }
    }
}

/** Unsigned, per-hop values that travel next to an envelope on a link. */
data class Hop(val hops: Int, val detours: Int, val tgt: Boolean, val remainingMs: Long)

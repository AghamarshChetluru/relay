package app.relay.core

/** A packet this phone holds, with its local (unsigned) state. */
data class StoredPacket(
    val env: Envelope, val hops: Int, val detours: Int, val tgt: Boolean,
    val receivedMs: Long, val expiresMs: Long, val ageAtReceiptMs: Long, val authored: Boolean, val via: String?
) {
    val id: String get() = env.id
    /** Approximate creation time for display only; never used for expiry decisions. */
    val createdApproxMs: Long get() = receivedMs - ageAtReceiptMs
}

data class AttachmentMeta(val id: String, val caseHex: String, val size: Int, val sha256Hex: String, val w: Int, val h: Int, val complete: Boolean, val received: Int, val authored: Boolean)

data class SentCounts(val total: Int, val good: Int, val detour: Int, val lastGoodMs: Long = 0L)

/** Durable state of one phone. [MemoryStore] backs tests; SqliteStore backs the app. Calls are serialized by the engine. */
interface Store {
    fun getPacket(id: String): StoredPacket?
    /** Returns false (and stores nothing) if the packet already exists. */
    fun putPacket(p: StoredPacket): Boolean
    fun deletePacket(id: String)
    fun packets(): List<StoredPacket>
    fun packetsForCase(caseHex: String): List<StoredPacket>

    fun markSeen(id: String, untilMs: Long)
    fun isSeen(id: String): Boolean
    fun purgeSeen(nowMs: Long)

    fun recordSent(id: String, peer: String, ms: Long, detour: Boolean)
    fun sentCounts(id: String): SentCounts
    fun hasSentTo(id: String, peer: String): Boolean

    fun noteOrigin(origin: String, ms: Long)
    fun originCount(origin: String, sinceMs: Long): Int

    fun getAttachmentMeta(id: String): AttachmentMeta?
    fun putAttachmentMeta(m: AttachmentMeta)
    fun attachmentBytes(id: String): ByteArray?
    /** Appends only if [offset] equals the bytes already held (contiguous, resumable). */
    fun appendAttachment(id: String, offset: Int, data: ByteArray): Boolean
    fun completeAttachment(id: String)
    fun resetAttachment(id: String)
    fun deleteAttachment(id: String)
    fun attachments(): List<AttachmentMeta>
    fun attachmentStoreBytes(): Long

    fun getSetting(key: String): ByteArray?
    fun setSetting(key: String, value: ByteArray)
    fun setFlag(kind: String, key: String)
    fun hasFlag(kind: String, key: String): Boolean
    fun flags(kind: String): Set<String>
    fun putPrivateAddress(caseHex: String, building: String, directions: String)
    fun getPrivateAddress(caseHex: String): Pair<String, String>?
}

class MemoryStore : Store {
    private val pk = LinkedHashMap<String, StoredPacket>()
    private val seen = HashMap<String, Long>()
    private val sent = HashMap<String, LinkedHashMap<String, Pair<Long, Boolean>>>()
    private val origins = HashMap<String, MutableList<Long>>()
    private val att = LinkedHashMap<String, AttachmentMeta>()
    private val attBytes = HashMap<String, java.io.ByteArrayOutputStream>()
    private val settings = HashMap<String, ByteArray>()
    private val flagSet = HashMap<String, MutableSet<String>>()
    private val priv = HashMap<String, Pair<String, String>>()

    override fun getPacket(id: String) = pk[id]
    override fun putPacket(p: StoredPacket): Boolean { if (pk.containsKey(p.id)) return false; pk[p.id] = p; return true }
    override fun deletePacket(id: String) { pk.remove(id) }
    override fun packets(): List<StoredPacket> = pk.values.toList()
    override fun packetsForCase(caseHex: String) = pk.values.filter { it.env.caseHex == caseHex }
    override fun markSeen(id: String, untilMs: Long) { seen[id] = maxOf(seen[id] ?: 0L, untilMs) }
    override fun isSeen(id: String) = seen.containsKey(id)
    override fun purgeSeen(nowMs: Long) { seen.entries.removeIf { it.value < nowMs } }
    override fun recordSent(id: String, peer: String, ms: Long, detour: Boolean) { sent.getOrPut(id) { LinkedHashMap() }.putIfAbsent(peer, ms to detour) }
    override fun sentCounts(id: String): SentCounts { val l = sent[id]?.values ?: return SentCounts(0, 0, 0); return SentCounts(l.size, l.count { !it.second }, l.count { it.second }, l.filter { !it.second }.maxOfOrNull { it.first } ?: 0L) }
    override fun hasSentTo(id: String, peer: String) = sent[id]?.containsKey(peer) == true
    override fun noteOrigin(origin: String, ms: Long) { origins.getOrPut(origin) { mutableListOf() }.add(ms) }
    override fun originCount(origin: String, sinceMs: Long) = origins[origin]?.count { it >= sinceMs } ?: 0
    override fun getAttachmentMeta(id: String) = att[id]
    override fun putAttachmentMeta(m: AttachmentMeta) { att[m.id] = m; if (m.complete.not()) attBytes.getOrPut(m.id) { java.io.ByteArrayOutputStream() } }
    override fun attachmentBytes(id: String): ByteArray? = attBytes[id]?.toByteArray()
    override fun appendAttachment(id: String, offset: Int, data: ByteArray): Boolean {
        val m = att[id] ?: return false; val o = attBytes.getOrPut(id) { java.io.ByteArrayOutputStream() }
        if (o.size() != offset || m.complete || offset + data.size > m.size) return false
        o.write(data); att[id] = m.copy(received = o.size()); return true
    }
    override fun completeAttachment(id: String) { att[id]?.let { att[id] = it.copy(complete = true, received = it.size) } }
    override fun resetAttachment(id: String) { attBytes[id] = java.io.ByteArrayOutputStream(); att[id]?.let { att[id] = it.copy(complete = false, received = 0) } }
    override fun deleteAttachment(id: String) { att.remove(id); attBytes.remove(id) }
    override fun attachments() = att.values.toList()
    override fun attachmentStoreBytes() = attBytes.values.sumOf { it.size().toLong() }
    override fun getSetting(key: String) = settings[key]
    override fun setSetting(key: String, value: ByteArray) { settings[key] = value }
    override fun setFlag(kind: String, key: String) { flagSet.getOrPut(kind) { mutableSetOf() }.add(key) }
    override fun hasFlag(kind: String, key: String) = flagSet[kind]?.contains(key) == true
    override fun flags(kind: String): Set<String> = flagSet[kind]?.toSet() ?: emptySet()
    override fun putPrivateAddress(caseHex: String, building: String, directions: String) { priv[caseHex] = building to directions }
    override fun getPrivateAddress(caseHex: String) = priv[caseHex]
}

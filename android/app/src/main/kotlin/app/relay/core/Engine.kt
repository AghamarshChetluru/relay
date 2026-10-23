package app.relay.core

interface Clock { fun nowMs(): Long }
object SystemClock : Clock { override fun nowMs(): Long = System.currentTimeMillis() }

class Outcome(val ok: Boolean, val error: String? = null, val caseId: String? = null, val packetId: String? = null) {
    companion object {
        fun fail(e: String) = Outcome(false, e)
        fun ok(caseId: String?, packetId: String?) = Outcome(true, null, caseId, packetId)
    }
}

data class HoodState(val id: String?, val name: String, val ageMs: Long, val reliable: Boolean, val due: Boolean, val stale: Boolean)

class RequestInput(
    val kind: String, val category: String, val title: String, val description: String = "", val area: String = "",
    val areaHood: String? = null, val areaHoodName: String = "", val urgent: Boolean = false, val validityMin: Int,
    val lastKnown: String = "", val lastContact: String = "", val note: String = "", val targets: List<String>? = null,
    val privateBuilding: String = "", val privateDirections: String = "", val photo: ByteArray? = null, val photoW: Int = 0, val photoH: Int = 0
)

class RenewInput(
    val validityMin: Int? = null, val description: String? = null, val area: String? = null, val targets: List<String>? = null,
    val lastKnown: String? = null, val lastContact: String? = null, val note: String? = null
)

class InvEntry(val id: String, val type: Int, val prio: Int, val remainingSec: Long, val size: Int)
class OutPacket(val id: String, val wire: ByteArray, val hop: Hop, val detour: Boolean)
enum class RxStatus { STORED, DUPLICATE, REJECTED, EXPIRED }
class RxResult(val status: RxStatus, val reason: String? = null, val packet: StoredPacket? = null)
class ChunkOut(val offset: Int, val total: Int, val data: ByteArray)
sealed class ChunkResult {
    class Next(val offset: Int) : ChunkResult()
    object Done : ChunkResult()
    object Bad : ChunkResult()
    object Ignore : ChunkResult()
}
class AttReq(val id: String, val offset: Int)
class HelloInfo(val deviceId: String, val signPub: ByteArray, val boxPub: ByteArray, val canAdvertise: Boolean, val hood: String?, val hoodAgeMs: Long)

/**
 * One phone's relay brain. It owns no radio: a transport feeds it frames (see Link.kt). All state is in the [Store].
 * Public methods are synchronized, so the BLE callbacks and the UI bridge can call from different threads.
 */
class RelayEngine(
    val store: Store, val crypto: Crypto, val identity: Identity, val clock: Clock = SystemClock,
    val cfg: PolicyConfig = PolicyConfig(), var canAdvertise: Boolean = true
) {
    @Volatile var onChange: (() -> Unit)? = null
    private val pendingOut = HashMap<String, Boolean>()   // "packetId|peer" -> was a detour

    private fun now() = clock.nowMs()
    private fun changed() { onChange?.invoke() }

    // ---------------------------------------------------------------- declared neighbourhood (no GPS)
    @Synchronized fun hoodState(): HoodState {
        val id = store.getSetting("hood")?.toString(Charsets.UTF_8)?.ifEmpty { null }
        val name = store.getSetting("hoodName")?.toString(Charsets.UTF_8) ?: ""
        val conf = store.getSetting("hoodConfirmedMs")?.let { Reader(it).u64() } ?: 0L
        val age = maxOf(0L, now() - conf)
        val valid = Neighborhoods.isValid(id)
        return HoodState(if (valid) id else null, if (valid) Neighborhoods.nameOf(id) else name, age, valid && age <= cfg.staleMs, age >= cfg.remindMs, age > cfg.staleMs)
    }
    @Synchronized fun setHood(id: String?, customName: String): Outcome {
        val name = customName.trim()
        if (id != null && !Neighborhoods.isValid(id)) return Outcome.fail("unknown neighbourhood")
        if (id == null && (name.isEmpty() || name.length > 60)) return Outcome.fail("area name must be 1-60 characters")
        store.setSetting("hood", (id ?: "").toByteArray()); store.setSetting("hoodName", (if (id != null) Neighborhoods.nameOf(id) else name).toByteArray())
        store.setSetting("hoodConfirmedMs", Writer().u64(now()).toByteArray()); changed(); return Outcome.ok(null, null)
    }
    @Synchronized fun confirmHood() { store.setSetting("hoodConfirmedMs", Writer().u64(now()).toByteArray()); changed() }
    private fun selfView(): SelfView { val h = hoodState(); return SelfView(h.id, h.ageMs) }

    // ---------------------------------------------------------------- helpers over stored packets
    internal fun requestVersions(caseHex: String): List<StoredPacket> =
        store.packetsForCase(caseHex).filter { it.env.type == PacketType.REQUEST }.sortedBy { it.env.caseVersion }
    internal fun latestRequest(caseHex: String): StoredPacket? = requestVersions(caseHex).lastOrNull()
    internal fun caseAuthorPub(caseHex: String): ByteArray? = requestVersions(caseHex).firstOrNull()?.env?.origin
    internal fun isAuthor(caseHex: String) = caseAuthorPub(caseHex)?.contentEquals(identity.signPub) == true
    internal fun isResolved(caseHex: String): Boolean {
        val author = caseAuthorPub(caseHex) ?: return false
        return store.packetsForCase(caseHex).any { it.env.type == PacketType.RESOLVE && it.env.origin.contentEquals(author) }
    }
    internal fun ackOf(replyId: String): Boolean {
        val reply = store.getPacket(replyId) ?: return false
        val author = caseAuthorPub(reply.env.caseHex ?: return false) ?: return false
        return store.packetsForCase(reply.env.caseHex!!).any { it.env.type == PacketType.ACK && it.env.s("replyPacketId") == replyId && it.env.origin.contentEquals(author) }
    }
    internal fun superseded(p: StoredPacket): Boolean =
        p.env.type == PacketType.REQUEST && requestVersions(p.env.caseHex!!).any { it.env.caseVersion > p.env.caseVersion }

    private fun storeAuthored(env: Envelope, validityMs: Long): StoredPacket {
        val n = now(); val route = env.route
        val tgt = route.policy == PolicyKind.DIRECTED && Neighborhoods.distanceToSet(Policy.reliable(selfView().hood, selfView().hoodAgeMs, cfg), route.targets) == 0
        val sp = StoredPacket(env, 0, 0, tgt, n, n + validityMs, 0L, true, null)
        store.putPacket(sp); store.markSeen(sp.id, sp.expiresMs + SEEN_GRACE_MS); store.noteOrigin(env.originDevice, n)
        return sp
    }
    private fun fieldsOf(vararg kv: Pair<String, String>): MutableMap<String, ByteArray> = kv.associate { it.first to it.second.toByteArray(Charsets.UTF_8) }.toMutableMap()

    // ---------------------------------------------------------------- authoring
    @Synchronized fun createRequest(i: RequestInput): Outcome {
        val hs = hoodState(); val n = now()
        val validityMs = i.validityMin * Limits.MINUTE_MS
        val targets = i.targets ?: if (i.kind == "missing" && i.areaHood != null) listOf(i.areaHood) else emptyList()
        val nonce = crypto.randomBytes(16); val caseId = id16(identity.signPub, nonce)
        var attId = ""; var photoSha = ""
        if (i.photo != null) {
            val bad = checkPhoto(i.photo, i.photoW, i.photoH); if (bad != null) return Outcome.fail(bad)
            photoSha = sha256(i.photo).hex(); attId = photoSha.substring(0, 32)
        }
        val f = fieldsOf(
            "kind" to i.kind, "category" to i.category, "title" to i.title.trim(), "description" to i.description.trim(), "area" to i.area.trim(),
            "areaHood" to (i.areaHood ?: ""), "areaHoodName" to i.areaHoodName, "authorHood" to (hs.id ?: ""), "authorHoodName" to hs.name,
            "lastKnown" to i.lastKnown, "lastContact" to i.lastContact, "note" to i.note.trim(),
            "hasPrivate" to (if (i.privateBuilding.isNotBlank() || i.privateDirections.isNotBlank()) "1" else ""), "attachmentId" to attId
        ); f["nonce"] = nonce
        val route = Policy.routeFor(PacketType.REQUEST, i.kind, targets, cfg)
        val env = Envelope.build(PacketType.REQUEST, caseId, 0, n, validityMs, i.urgent, route, f, identity, crypto)
        Validation.check(env)?.let { return Outcome.fail("invalid: $it") }
        val sp = storeAuthored(env, validityMs)
        if (f["hasPrivate"]!!.isNotEmpty()) store.putPrivateAddress(caseId.hex(), i.privateBuilding.trim(), i.privateDirections.trim())
        if (i.photo != null) addAttachment(caseId, i.photo, photoSha, i.photoW, i.photoH, route, i.urgent, validityMs)
        changed(); return Outcome.ok(caseId.hex(), sp.id)
    }

    private fun checkPhoto(b: ByteArray, w: Int, h: Int): String? {
        if (b.size < 100 || b.size > Limits.MAX_PHOTO_BYTES) return "photo must be 100 bytes to ${Limits.MAX_PHOTO_BYTES / 1024} KB"
        if (b.size < 3 || b[0] != 0xFF.toByte() || b[1] != 0xD8.toByte() || b[2] != 0xFF.toByte()) return "photo must be a JPEG"
        if (w < 1 || h < 1 || w > 4096 || h > 4096) return "photo dimensions out of range"
        return null
    }

    private fun addAttachment(caseId: ByteArray, bytes: ByteArray, sha: String, w: Int, h: Int, route: Route, urgent: Boolean, validityMs: Long) {
        val attId = sha.substring(0, 32)
        if (store.getAttachmentMeta(attId) == null) {
            store.putAttachmentMeta(AttachmentMeta(attId, caseId.hex(), bytes.size, sha, w, h, false, 0, true))
            store.appendAttachment(attId, 0, bytes); store.completeAttachment(attId)
        }
        val f = fieldsOf("attachmentId" to attId, "sha256" to sha, "mime" to "image/jpeg", "size" to bytes.size.toString(), "w" to w.toString(), "h" to h.toString())
        val env = Envelope.build(PacketType.ATTACHMENT, caseId, 0, now(), minOf(validityMs, Validation.MAX_MISSING_MS), urgent, route, f, identity, crypto)
        storeAuthored(env, env.validityMs)
    }

    @Synchronized fun renewRequest(caseHex: String, r: RenewInput): Outcome {
        val latest = latestRequest(caseHex) ?: return Outcome.fail("unknown case")
        if (!isAuthor(caseHex)) return Outcome.fail("only the requester can renew")
        if (isResolved(caseHex)) return Outcome.fail("already resolved")
        if (latest.env.caseVersion + 1 > Limits.MAX_CASE_VERSION) return Outcome.fail("too many renewals")
        val e0 = latest.env; val n = now()
        val f = HashMap<String, ByteArray>(e0.fields)
        fun put(k: String, v: String?) { if (v != null) f[k] = v.trim().toByteArray(Charsets.UTF_8) }
        put("description", r.description); put("area", r.area); put("lastKnown", r.lastKnown); put("lastContact", r.lastContact); put("note", r.note)
        val kind = e0.s("kind")
        val validityMs = (r.validityMin?.toLong() ?: (e0.validityMs / Limits.MINUTE_MS)) * Limits.MINUTE_MS
        val targets = r.targets ?: e0.route.targets
        val route = Policy.routeFor(PacketType.REQUEST, kind, targets, cfg)
        val env = Envelope.build(PacketType.REQUEST, e0.caseId, e0.caseVersion + 1, n, validityMs, e0.urgent, route, f, identity, crypto)
        Validation.check(env)?.let { return Outcome.fail("invalid: $it") }
        val sp = storeAuthored(env, validityMs)
        val attId = e0.s("attachmentId")
        if (attId.isNotEmpty()) store.getAttachmentMeta(attId)?.let { m -> store.attachmentBytes(attId)?.let { addAttachmentMetaOnly(e0.caseId!!, m, route, e0.urgent, validityMs) } }
        changed(); return Outcome.ok(caseHex, sp.id)
    }
    private fun addAttachmentMetaOnly(caseId: ByteArray, m: AttachmentMeta, route: Route, urgent: Boolean, validityMs: Long) {
        val f = fieldsOf("attachmentId" to m.id, "sha256" to m.sha256Hex, "mime" to "image/jpeg", "size" to m.size.toString(), "w" to m.w.toString(), "h" to m.h.toString())
        val env = Envelope.build(PacketType.ATTACHMENT, caseId, 0, now(), minOf(validityMs, Validation.MAX_MISSING_MS), urgent, route, f, identity, crypto)
        storeAuthored(env, env.validityMs)   // new metadata packet extends the photo's life; the bytes are stored once, by attachment ID
    }

    @Synchronized fun createReply(caseHex: String, kind: String, note: String, area: String): Outcome {
        val latest = latestRequest(caseHex) ?: return Outcome.fail("this phone has not received that request")
        if (isAuthor(caseHex)) return Outcome.fail("you cannot reply to your own request")
        if (now() >= latest.expiresMs) return Outcome.fail("this request has expired")
        if (isResolved(caseHex)) return Outcome.fail("the requester marked this resolved")
        val hs = hoodState()
        val f = fieldsOf("kind" to kind, "note" to note.trim(), "area" to area.trim(), "fromHood" to hs.name, "boxKey" to identity.boxPub.hex())
        val env = Envelope.build(PacketType.REPLY, latest.env.caseId, 0, now(), 90 * Limits.MINUTE_MS, latest.env.urgent,
            Policy.routeFor(PacketType.REPLY, null, emptyList(), cfg), f, identity, crypto)
        Validation.check(env)?.let { return Outcome.fail("invalid: $it") }
        val sp = storeAuthored(env, env.validityMs); changed(); return Outcome.ok(caseHex, sp.id)
    }

    @Synchronized fun createAck(replyId: String): Outcome {
        val reply = store.getPacket(replyId)?.takeIf { it.env.type == PacketType.REPLY } ?: return Outcome.fail("that response has not reached this phone")
        val caseHex = reply.env.caseHex!!
        if (!isAuthor(caseHex)) return Outcome.fail("only the requester can acknowledge")
        if (ackOf(replyId)) return Outcome.fail("already acknowledged")
        val urgent = latestRequest(caseHex)!!.env.urgent
        val env = Envelope.build(PacketType.ACK, reply.env.caseId, 0, now(), 90 * Limits.MINUTE_MS, urgent,
            Policy.routeFor(PacketType.ACK, null, emptyList(), cfg), fieldsOf("replyPacketId" to replyId), identity, crypto)
        val sp = storeAuthored(env, env.validityMs); changed(); return Outcome.ok(caseHex, sp.id)
    }

    @Synchronized fun createResolve(caseHex: String): Outcome {
        val latest = latestRequest(caseHex) ?: return Outcome.fail("unknown case")
        if (!isAuthor(caseHex)) return Outcome.fail("only the requester can resolve")
        if (isResolved(caseHex)) return Outcome.fail("already resolved")
        val env = Envelope.build(PacketType.RESOLVE, latest.env.caseId, 0, now(), 90 * Limits.MINUTE_MS, latest.env.urgent,
            Policy.routeFor(PacketType.RESOLVE, null, emptyList(), cfg), emptyMap(), identity, crypto)
        val sp = storeAuthored(env, env.validityMs); changed(); return Outcome.ok(caseHex, sp.id)
    }

    @Synchronized fun createBroadcast(text: String, category: String, area: String): Outcome {
        val hs = hoodState()
        val f = fieldsOf("text" to text.trim(), "category" to category, "area" to area.trim(), "hood" to (hs.id ?: ""), "hoodName" to hs.name)
        val env = Envelope.build(PacketType.BROADCAST, null, 0, now(), 45 * Limits.MINUTE_MS, false, Policy.routeFor(PacketType.BROADCAST, null, emptyList(), cfg), f, identity, crypto)
        Validation.check(env)?.let { return Outcome.fail("invalid: $it") }
        val sp = storeAuthored(env, env.validityMs); changed(); return Outcome.ok(null, sp.id)
    }

    /** Exact address: encrypted to ONE volunteer's key, signed by the requester. Relaying phones carry ciphertext they cannot read. */
    @Synchronized fun shareAddress(replyId: String): Outcome {
        val reply = store.getPacket(replyId)?.takeIf { it.env.type == PacketType.REPLY } ?: return Outcome.fail("that response has not reached this phone")
        val caseHex = reply.env.caseHex!!
        if (!isAuthor(caseHex)) return Outcome.fail("only the requester can share the address")
        val addr = store.getPrivateAddress(caseHex) ?: return Outcome.fail("no exact address saved")
        if (store.packetsForCase(caseHex).any { it.env.type == PacketType.ADDRESS && it.env.s("replyPacketId") == replyId && it.authored }) return Outcome.fail("already shared with this volunteer")
        val boxKey = try { reply.env.s("boxKey").unhex() } catch (e: WireException) { return Outcome.fail("volunteer key invalid") }
        val plain = Writer().str(addr.first).str(addr.second).toByteArray()
        val sealed = crypto.seal(boxKey, plain, reply.env.caseId!! + replyId.unhex())
        val to = reply.env.originDevice
        val env = Envelope.build(PacketType.ADDRESS, reply.env.caseId, 0, now(), 60 * Limits.MINUTE_MS, latestRequest(caseHex)!!.env.urgent,
            Policy.routeFor(PacketType.ADDRESS, null, emptyList(), cfg), HashMap<String, ByteArray>().apply {
                put("replyPacketId", replyId.toByteArray()); put("toDevice", to.toByteArray()); put("sealed", sealed) }, identity, crypto)
        Validation.check(env)?.let { return Outcome.fail("invalid: $it") }
        val sp = storeAuthored(env, env.validityMs); changed(); return Outcome.ok(caseHex, sp.id)
    }

    /** Only the addressed phone can open it, and only if the sender is the case author. */
    @Synchronized fun openAddress(p: StoredPacket): Pair<String, String>? {
        if (p.env.type != PacketType.ADDRESS || p.env.s("toDevice") != identity.deviceId) return null
        val caseHex = p.env.caseHex ?: return null
        if (caseAuthorPub(caseHex)?.contentEquals(p.env.origin) != true) return null
        val aad = p.env.caseId!! + p.env.s("replyPacketId").unhex()
        val plain = crypto.open(identity.boxPriv, identity.boxPub, p.env.fields["sealed"]!!, aad) ?: return null
        return try { val r = Reader(plain); r.str(Limits.MAX_ADDRESS_FIELD) to r.str(Limits.MAX_ADDRESS_FIELD) } catch (e: WireException) { null }
    }

    // ---------------------------------------------------------------- receiving
    @Synchronized fun receive(wire: ByteArray, hop: Hop, fromPeer: String): RxResult {
        val n = now()
        val env = try { Envelope.decode(wire) } catch (e: WireException) { return RxResult(RxStatus.REJECTED, "malformed: ${e.message}") }
        if (!crypto.verify(env.origin, env.signature, env.signedBody())) return RxResult(RxStatus.REJECTED, "bad signature")
        Validation.check(env)?.let { return RxResult(RxStatus.REJECTED, "invalid: $it") }
        val id = env.id
        if (store.getPacket(id) != null || store.isSeen(id)) return RxResult(RxStatus.DUPLICATE)
        if (hop.hops < 0 || hop.hops > env.route.maxHops || hop.detours < 0 || hop.detours > 16) return RxResult(RxStatus.REJECTED, "hop counters")
        val remaining = minOf(hop.remainingMs, env.validityMs)
        if (remaining <= 0) { store.markSeen(id, n + SEEN_GRACE_MS); return RxResult(RxStatus.EXPIRED) }
        if (store.originCount(env.originDevice, n - 60 * Limits.MINUTE_MS) >= Limits.RATE_PER_ORIGIN_PER_HOUR) return RxResult(RxStatus.REJECTED, "origin rate limit")
        val me = selfView()
        val tgt = hop.tgt || (env.route.policy == PolicyKind.DIRECTED && Neighborhoods.distanceToSet(Policy.reliable(me.hood, me.hoodAgeMs, cfg), env.route.targets) == 0)
        val sp = StoredPacket(env, hop.hops, hop.detours, tgt, n, n + remaining, env.validityMs - remaining, false, fromPeer)
        if (!store.putPacket(sp)) return RxResult(RxStatus.DUPLICATE)
        store.markSeen(id, sp.expiresMs + SEEN_GRACE_MS); store.noteOrigin(env.originDevice, n)
        if (env.type == PacketType.ATTACHMENT && store.getAttachmentMeta(env.s("attachmentId")) == null) {
            store.putAttachmentMeta(AttachmentMeta(env.s("attachmentId"), env.caseHex!!, env.s("size").toInt(), env.s("sha256"), env.s("w").toInt(), env.s("h").toInt(), false, 0, false))
        }
        housekeeping(); changed()
        return RxResult(RxStatus.STORED, null, sp)
    }

    // ---------------------------------------------------------------- forwarding
    @Synchronized fun inventory(peer: PeerView, limit: Int = 200): List<InvEntry> {
        val n = now(); val me = selfView()
        return store.packets().asSequence()
            .filter { it.via != peer.deviceId && !store.hasSentTo(it.id, peer.deviceId) }
            .mapNotNull { p -> Policy.offer(p, me, peer, n, store.sentCounts(p.id), superseded(p), cfg)?.let { p } }
            .sortedWith(compareBy({ it.env.priority }, { it.createdApproxMs }, { it.id }))
            .take(limit).map { InvEntry(it.id, it.env.type.code, it.env.priority, (it.expiresMs - n) / 1000, it.env.wire().size) }.toList()
    }

    @Synchronized fun wanted(entries: List<InvEntry>, maxIds: Int = Limits.MAX_WANT_IDS): List<String> {
        val out = ArrayList<String>()
        for (e in entries) {
            if (out.size >= maxIds) break
            if (e.remainingSec <= 0 || e.size > Limits.MAX_ENVELOPE_BYTES || e.size <= 0) continue
            if (store.getPacket(e.id) != null || store.isSeen(e.id)) continue
            if (e.id.length != 32) continue
            out.add(e.id)
        }
        return out
    }

    @Synchronized fun outgoing(id: String, peer: PeerView): OutPacket? {
        val p = store.getPacket(id) ?: return null; val n = now()
        val offer = Policy.offer(p, selfView(), peer, n, store.sentCounts(id), superseded(p), cfg) ?: return null
        pendingOut["$id|${peer.deviceId}"] = offer.detour
        return OutPacket(id, p.env.wire(), Hop(p.hops + 1, p.detours + (if (offer.detour) 1 else 0), false, p.expiresMs - n), offer.detour)
    }

    /** Called only when the peer answered PACK(stored): this is the one honest basis for "shared with a nearby phone". */
    @Synchronized fun markDelivered(id: String, peerId: String) {
        val detour = pendingOut.remove("$id|$peerId") ?: false
        store.recordSent(id, peerId, now(), detour); changed()
    }

    // ---------------------------------------------------------------- attachments (photo bytes)
    @Synchronized fun attachmentRequests(limit: Int = 4): List<AttReq> {
        val n = now(); val out = ArrayList<AttReq>()
        for (m in store.attachments()) {
            if (m.complete || m.authored || out.size >= limit) continue
            val metaPkt = store.packetsForCase(m.caseHex).firstOrNull { it.env.type == PacketType.ATTACHMENT && it.env.s("attachmentId") == m.id && n < it.expiresMs } ?: continue
            val author = caseAuthorPub(m.caseHex) ?: continue
            if (!author.contentEquals(metaPkt.env.origin)) continue                    // photo must come from the requester
            if (store.attachmentStoreBytes() + m.size > Limits.MAX_ATTACHMENT_STORE_BYTES) continue
            out.add(AttReq(m.id, m.received))
        }
        return out
    }
    @Synchronized fun attachmentChunk(attId: String, offset: Int): ChunkOut? {
        val m = store.getAttachmentMeta(attId)?.takeIf { it.complete } ?: return null
        val bytes = store.attachmentBytes(attId) ?: return null
        if (offset < 0 || offset >= bytes.size) return null
        val end = minOf(bytes.size, offset + Limits.ATTACHMENT_CHUNK)
        return ChunkOut(offset, m.size, bytes.copyOfRange(offset, end))
    }
    @Synchronized fun receiveChunk(attId: String, offset: Int, total: Int, data: ByteArray): ChunkResult {
        val m = store.getAttachmentMeta(attId) ?: return ChunkResult.Ignore
        if (m.complete || total != m.size || data.isEmpty() || data.size > Limits.ATTACHMENT_CHUNK) return ChunkResult.Ignore
        if (!store.appendAttachment(attId, offset, data)) return ChunkResult.Next(m.received)   // out-of-order: tell the sender where we are
        val cur = store.getAttachmentMeta(attId)!!
        if (cur.received < cur.size) return ChunkResult.Next(cur.received)
        val all = store.attachmentBytes(attId)
        if (all == null || sha256(all).hex() != m.sha256Hex || checkPhoto(all, m.w, m.h) != null) { store.resetAttachment(attId); return ChunkResult.Bad }
        store.completeAttachment(attId); changed(); return ChunkResult.Done
    }

    // ---------------------------------------------------------------- link identity
    fun hello(): HelloInfo { val h = hoodState(); return HelloInfo(identity.deviceId, identity.signPub, identity.boxPub, canAdvertise, h.id, h.ageMs) }
    @Synchronized fun inventoryDigest(): Int = store.packets().filter { now() < it.expiresMs }.fold(0) { a, p -> a xor p.id.hashCode() } and 0xffff

    // ---------------------------------------------------------------- housekeeping
    private fun involved(p: StoredPacket): Boolean {
        if (p.authored) return true
        val pl = p.env
        if (pl.type == PacketType.ADDRESS && pl.s("toDevice") == identity.deviceId) return true
        if (pl.type == PacketType.ACK) { val r = store.getPacket(pl.s("replyPacketId")); if (r != null && r.authored) return true }
        if (pl.type == PacketType.REPLY && isAuthor(pl.caseHex!!)) return true
        if (pl.type == PacketType.RESOLVE && store.packetsForCase(pl.caseHex!!).any { it.authored && it.env.type == PacketType.REPLY }) return true
        return false
    }

    @Synchronized fun housekeeping() {
        val n = now()
        for (p in store.packets()) {
            if (involved(p)) continue
            if (n >= p.expiresMs + EVICT_GRACE_MS || superseded(p)) store.deletePacket(p.id)
        }
        val cand = store.packets().filter { !involved(it) }
        if (cand.size > Limits.MAX_STORED_PACKETS) {
            cand.sortedWith(compareByDescending<StoredPacket> { n >= it.expiresMs }.thenByDescending { it.env.priority }.thenBy { it.receivedMs })
                .take(cand.size - Limits.MAX_STORED_PACKETS).forEach { store.deletePacket(it.id) }
        }
        val liveCases = store.packets().mapNotNull { it.env.caseHex }.toSet()
        for (m in store.attachments()) if (!m.authored && m.caseHex !in liveCases) store.deleteAttachment(m.id)
        store.purgeSeen(n)
    }

    companion object {
        const val SEEN_GRACE_MS = 2 * 60 * Limits.MINUTE_MS
        const val EVICT_GRACE_MS = 30 * Limits.MINUTE_MS
    }
}

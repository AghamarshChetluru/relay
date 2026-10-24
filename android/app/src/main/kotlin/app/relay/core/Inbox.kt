package app.relay.core

/**
 * Where a stored message lives, as an identifier the UI and Android notifications can both use.
 *  request   -> caseId                     reply / sighting -> caseId + the reply's packetId
 *  broadcast -> packetId                   ack              -> the acknowledged reply's packetId + caseId
 *  resolve   -> caseId                     inbox            -> the "New to you" part of the inbox (used by summaries)
 */
data class Ref(val t: String, val caseId: String?, val packetId: String?) {
    fun toJson(): String = JsonObj().str("t", t).str("caseId", caseId).str("packetId", packetId).end()
    /** Unique per destination, so two notifications can never share one PendingIntent. */
    val key: String get() = "$t|${caseId ?: ""}|${packetId ?: ""}"
    companion object {
        val TYPES = setOf("request", "reply", "ack", "resolve", "broadcast", "inbox")
        private val HEX = Regex("^[0-9a-f]{32}$")
        /** Untrusted input (an Intent from outside, JS): only well-formed references are ever accepted. */
        fun parse(t: String?, caseId: String?, packetId: String?): Ref? {
            if (t == null || t !in TYPES) return null
            val c = caseId?.takeIf { it.isNotEmpty() }; val p = packetId?.takeIf { it.isNotEmpty() }
            if (c != null && !HEX.matches(c)) return null
            if (p != null && !HEX.matches(p)) return null
            return Ref(t, c, p)
        }
    }
}

enum class NoticeKind(val priority: Boolean) { REQUEST(false), REQUEST_UPDATE(false), REPLY(true), ACK(true), RESOLVE(false), BROADCAST(false) }

/** Something this phone has just genuinely stored that the user probably wants to know about. Never contains message body text. */
/**
 * [important] decides the in-app pop-up and the loud notification channel; everything else still reaches the inbox (badge, "New to you") and, when the app is closed, a quiet system notification.
 * Important = (a) a response to YOUR request or an acknowledgment of YOUR offer, (b) an URGENT request whose reported area is your declared area or one step from it,
 * (c) a missing-person search aimed at your declared area or one step from it. A phone with no fresh declared area never guesses relevance.
 */
class Notice(val kind: NoticeKind, val ref: Ref, val title: String, val where: String, val about: String, val urgent: Boolean, val eventId: String = "", val important: Boolean = kind.priority) {
    val line: String get() = if (where.isEmpty()) title else "$title · $where"
    val action: String get() = when (kind) { NoticeKind.REPLY, NoticeKind.ACK -> "View response"; NoticeKind.BROADCAST -> "Open update"; else -> "Open message" }
    fun toJson(): String = JsonObj().str("kind", kind.name.lowercase()).raw("ref", ref.toJson()).str("title", title).str("where", where).str("about", about).str("eventId", eventId)
        .bool("urgent", urgent).bool("priority", important).str("line", line).str("action", action).end()
}

/** Durable "which messages has the user opened" model. Local to this phone: opening a message tells nobody anything. */
object ReadState {
    const val READ = "read"; const val ANNOUNCED = "announced"; private const val INIT = "inboxInit"
    fun markRead(store: Store, ids: Collection<String>) { ids.forEach { if (it.length == 32) store.setFlag(READ, it) } }
    fun isRead(store: Store, id: String) = store.hasFlag(READ, id)
    /** First run of the inbox model on a phone that already holds messages: they are history, not news. */
    fun initIfNeeded(store: Store) {
        if (store.getSetting(INIT) != null) return
        store.packets().forEach { store.setFlag(READ, it.id); store.setFlag(ANNOUNCED, it.id) }
        store.setSetting(INIT, byteArrayOf(1))
    }
}

object Inbox {
    /** What a request says that a person would care about if it changed. Validity/renewal alone is not content. */
    fun contentKey(e: Envelope): String = listOf("title", "description", "area", "areaHoodName", "lastKnown", "lastContact", "note", "category").joinToString("\u0001") { e.s(it).trim() }

    private fun helpTitle(e: Envelope): String {
        if (e.s("kind") == "missing") return "Missing person reported"
        return when (e.s("category")) {
            "Medical" -> "Medical assistance requested"; "Rescue" -> "Rescue requested"; "Food & water" -> "Food and water requested"
            "Shelter" -> "Shelter requested"; else -> "Help requested"
        }
    }
    private fun whereOf(e: Envelope): String = e.s("areaHoodName").ifEmpty { e.s("area") }.ifEmpty { e.s("authorHoodName") }
    /** Is this request about the area I am in (or right next to it)? Uses only my declared, still-fresh neighbourhood and the request's own areas. */
    fun nearYou(engine: RelayEngine, e: Envelope): Boolean {
        val hs = engine.hoodState(); val mine = (if (hs.reliable) hs.id else null) ?: return false
        val areas = (listOf(e.s("areaHood")) + e.route.targets).filter { it.isNotEmpty() }
        return areas.any { (Neighborhoods.distance(mine, it) ?: 99) <= 1 }
    }
    private fun requestImportant(engine: RelayEngine, e: Envelope) = (e.urgent || e.s("kind") == "missing") && nearYou(engine, e)
    private fun clip(s: String, n: Int = 60) = if (s.length > n) s.substring(0, n - 1).trimEnd() + "…" else s

    /**
     * Decides whether a packet that was JUST stored from the network deserves the user's attention. Called once per genuinely new, signature-checked
     * packet (duplicates, photo chunks, hello/inventory traffic and anything this phone wrote itself never reach it).
     */
    fun classify(engine: RelayEngine, sp: StoredPacket): Notice? {
        if (sp.authored) return null
        val e = sp.env; val c = e.caseHex
        when (e.type) {
            PacketType.REQUEST -> {
                if (c == null || engine.isAuthor(c)) return null
                val ref = Ref("request", c, sp.id)
                if (e.caseVersion == 0) return Notice(NoticeKind.REQUEST, ref, helpTitle(e), whereOf(e), clip(e.s("title")), e.urgent, sp.id, requestImportant(engine, e))
                // a renewal: only meaningful when the words changed against the newest earlier version this phone holds
                val prev = engine.requestVersions(c).lastOrNull { it.env.caseVersion < e.caseVersion } ?: return Notice(NoticeKind.REQUEST, ref, helpTitle(e), whereOf(e), clip(e.s("title")), e.urgent, sp.id, requestImportant(engine, e))
                return if (contentKey(prev.env) != contentKey(e)) Notice(NoticeKind.REQUEST_UPDATE, ref, "Request updated", whereOf(e), clip(e.s("title")), e.urgent, sp.id, requestImportant(engine, e)) else null
            }
            PacketType.REPLY -> {
                if (c == null || !engine.isAuthor(c)) return null          // other people's offers that merely pass through this phone are not news here
                val about = engine.latestRequest(c)?.env?.s("title") ?: ""
                val sighting = e.s("kind") == "sighting"
                return Notice(NoticeKind.REPLY, Ref("reply", c, sp.id), if (sighting) "Someone sent a possible sighting" else "Someone sent a response", e.s("fromHood"), clip(about), engine.latestRequest(c)?.env?.urgent == true, sp.id)
            }
            PacketType.ACK -> {
                val reply = engine.store.getPacket(e.s("replyPacketId"))?.takeIf { it.authored && it.env.type == PacketType.REPLY } ?: return null
                val sighting = reply.env.s("kind") == "sighting"
                return Notice(NoticeKind.ACK, Ref("ack", reply.env.caseHex, reply.id), if (sighting) "The requester acknowledged your sighting" else "The requester acknowledged your offer", "", clip(engine.latestRequest(reply.env.caseHex!!)?.env?.s("title") ?: ""), false, sp.id)
            }
            PacketType.RESOLVE -> {
                if (c == null || engine.store.packetsForCase(c).none { it.authored && it.env.type == PacketType.REPLY }) return null
                return Notice(NoticeKind.RESOLVE, Ref("resolve", c, sp.id), "A request you responded to was marked resolved", "", clip(engine.latestRequest(c)?.env?.s("title") ?: ""), false, sp.id)
            }
            PacketType.BROADCAST -> return Notice(NoticeKind.BROADCAST, Ref("broadcast", null, sp.id), "Community update received", e.s("area").ifEmpty { e.s("hoodName") }, "", false, sp.id)
            else -> return null           // address / attachment packets are carried quietly; the message they belong to already announced itself
        }
    }
}

/** How a burst of notices becomes notifications: replies to your own requests always stand alone; a flood of the rest becomes one summary. */
object NoticePlan {
    sealed class Out {
        class One(val notice: Notice) : Out()
        class Summary(val count: Int, val priority: Boolean) : Out()
    }
    fun plan(batch: List<Notice>, maxOthers: Int = 2, maxPriority: Int = 4): List<Out> {
        val out = ArrayList<Out>(); val pri = batch.filter { it.important }; val rest = batch.filter { !it.important }
        pri.take(maxPriority).forEach { out.add(Out.One(it)) }
        if (pri.size > maxPriority) out.add(Out.Summary(pri.size - maxPriority, true))
        if (rest.size <= maxOthers) rest.forEach { out.add(Out.One(it)) } else out.add(Out.Summary(rest.size, false))
        return out
    }
}

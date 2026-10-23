package app.relay.core

/** What the radio layer knows right now; shown honestly in the UI. Nothing here is inferred from the simulator. */
data class RadioStatus(
    val bluetoothSupported: Boolean = true, val bluetoothEnabled: Boolean = false, val permissionsGranted: Boolean = false,
    val canAdvertise: Boolean = false, val scanning: Boolean = false, val advertising: Boolean = false, val serviceRunning: Boolean = false,
    val recentPeers: List<String> = emptyList(), val connectedPeers: Int = 0, val lastContactMs: Long = 0L, val lastError: String = "",
    val diagJson: String = "null"
) {
    fun toJson(): String = JsonObj().bool("bluetoothSupported", bluetoothSupported).bool("bluetoothEnabled", bluetoothEnabled).bool("permissionsGranted", permissionsGranted)
        .bool("canAdvertise", canAdvertise).bool("scanning", scanning).bool("advertising", advertising).bool("serviceRunning", serviceRunning)
        .raw("recentPeers", jsonStrings(recentPeers)).num("connectedPeers", connectedPeers.toLong()).num("lastContactMs", lastContactMs).str("lastError", lastError).raw("diag", diagJson).end()
}

/** Serialises the phone's own durable state for the WebView. Contains only what THIS phone holds; never any global/simulated data. */
object Snapshot {
    fun build(engine: RelayEngine, radio: RadioStatus): String {
        val store = engine.store; val now = engine.clock.nowMs(); val hs = engine.hoodState()
        val hoodSet = store.getSetting("hoodConfirmedMs") != null
        val pk = store.packets().map { p ->
            val e = p.env; val f = JsonObj()
            val opened = if (e.type == PacketType.ADDRESS) engine.openAddress(p) else null
            for ((k, v) in e.fields) {
                if (e.type == PacketType.ADDRESS && k == "sealed") continue
                f.str(k, v.toString(Charsets.UTF_8).let { if (k == "nonce") "" else it })
            }
            if (opened != null) f.str("building", opened.first).str("directions", opened.second).bool("opened", true)
            val caseHex = e.caseHex
            val byAuthor = e.type == PacketType.REQUEST || (caseHex != null && engine.caseAuthorPub(caseHex)?.contentEquals(e.origin) == true)
            val route = JsonObj().str("policy", e.route.policy.name.lowercase()).num("maxHops", e.route.maxHops.toLong()).num("fanout", e.route.fanout.toLong()).raw("targets", jsonStrings(e.route.targets)).end()
            JsonObj().str("id", p.id).str("type", e.type.label).str("caseId", caseHex).num("version", e.caseVersion.toLong()).str("origin", e.originDevice)
                .bool("mine", p.authored).bool("byAuthor", byAuthor).num("createdMs", p.createdApproxMs).num("expiresMs", p.expiresMs).num("receivedMs", p.receivedMs)
                .num("hops", p.hops.toLong()).num("detours", p.detours.toLong()).bool("tgt", p.tgt).bool("urgent", e.urgent).num("prio", e.priority.toLong())
                .num("validityMs", e.validityMs).raw("route", route).raw("fields", f.end()).num("sentTo", store.sentCounts(p.id).total.toLong())
                .str("via", p.via).end()
        }
        val att = store.attachments().map { JsonObj().str("id", it.id).str("caseId", it.caseHex).num("size", it.size.toLong()).num("w", it.w.toLong()).num("h", it.h.toLong())
            .bool("complete", it.complete).num("received", it.received.toLong()).bool("mine", it.authored).end() }
        val priv = JsonObj(); store.packets().filter { it.authored && it.env.type == PacketType.REQUEST }.mapNotNull { it.env.caseHex }.distinct().forEach { c ->
            store.getPrivateAddress(c)?.let { a -> priv.raw(c, JsonObj().str("building", a.first).str("directions", a.second).end()) } }
        val hood = JsonObj().str("id", hs.id).str("name", hs.name).num("ageMs", hs.ageMs).bool("reliable", hs.reliable).bool("due", hs.due).bool("stale", hs.stale).bool("set", hoodSet)
        return JsonObj().num("now", now).raw("me", JsonObj().str("id", engine.identity.deviceId).raw("hood", hood.end()).end())
            .raw("packets", jsonArray(pk)).raw("attachments", jsonArray(att)).raw("privateAddr", priv.end())
            .raw("flags", JsonObj().raw("hidden", jsonStrings(store.flags("hidden"))).raw("notRelevant", jsonStrings(store.flags("notRelevant"))).end())
            .raw("radio", radio.toJson()).end()
    }
}

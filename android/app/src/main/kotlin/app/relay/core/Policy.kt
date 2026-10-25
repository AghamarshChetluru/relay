package app.relay.core

/**
 * Per-message-type routing, ported from prototype/mesh.js (`plan`). Differences forced by real phones (documented in docs/architecture/ARCHITECTURE.md):
 *  - decisions are made pairwise at contact time (we only ever know the peer in front of us, not "all neighbours"),
 *  - time is real wall-clock minutes, not simulation steps,
 *  - detour copies per phone are capped (the simulation could see every neighbour at once).
 */
data class PolicyConfig(
    val floodHops: Int = 60, val broadcastHops: Int = 30, val directedHops: Int = 40, val directedFanout: Int = 3,
    val detourMax: Int = 1, val detourAway: Int = 1, val patienceMs: Long = 16 * Limits.MINUTE_MS, val patientExtra: Int = 2,
    val oppHops: Int = 10, val oppFanout: Int = 3, val detourCopies: Int = 2, val detourWaitMs: Long = 3 * Limits.MINUTE_MS,
    val staleMs: Long = 60 * Limits.MINUTE_MS, val remindMs: Long = 30 * Limits.MINUTE_MS
)

data class PeerView(val deviceId: String, val hood: String?, val hoodAgeMs: Long, val canAdvertise: Boolean = true)
data class SelfView(val hood: String?, val hoodAgeMs: Long)
data class Offer(val detour: Boolean, val score: Int)

object Policy {
    fun routeFor(type: PacketType, kind: String?, targets: List<String>, cfg: PolicyConfig): Route {
        if (type == PacketType.BROADCAST) return Route(PolicyKind.FLOOD, cfg.broadcastHops, 0, 0, 0, emptyList())
        if (type == PacketType.REQUEST && kind == "missing") {
            val tg = targets.filter { Neighborhoods.isValid(it) }.distinct().take(Limits.MAX_TARGETS)
            return if (tg.isNotEmpty()) Route(PolicyKind.DIRECTED, cfg.directedHops, cfg.directedFanout, cfg.detourMax, cfg.detourAway, tg)
            else Route(PolicyKind.OPPORTUNISTIC, cfg.oppHops, cfg.oppFanout, 0, 0, emptyList())
        }
        return Route(PolicyKind.FLOOD, cfg.floodHops, 0, 0, 0, emptyList())
    }

    /** A declared neighbourhood is only trusted for routing while it was confirmed recently. */
    fun reliable(hood: String?, ageMs: Long, cfg: PolicyConfig): String? = if (Neighborhoods.isValid(hood) && ageMs <= cfg.staleMs) hood else null

    /**
     * Should [me] hand this packet to [peer] now? null = no. Mirrors the prototype's rules:
     * flood always; opportunistic until its small fan-out is used; directed prefers same/closer/in-area peers, then bounded detours
     * (widened only for copies that have waited [PolicyConfig.patienceMs] without reaching the target area; none once they have).
     */
    fun offer(
        p: StoredPacket, me: SelfView, peer: PeerView, nowMs: Long, sent: SentCounts, superseded: Boolean, cfg: PolicyConfig
    ): Offer? {
        if (nowMs >= p.expiresMs || superseded) return null
        val rt = p.env.route
        if (p.hops >= rt.maxHops) return null
        when (rt.policy) {
            PolicyKind.FLOOD -> return Offer(false, 0)
            PolicyKind.OPPORTUNISTIC -> return if (sent.total < rt.fanout) Offer(false, 0) else null
            PolicyKind.DIRECTED -> {
                val ds = Neighborhoods.distanceToSet(reliable(me.hood, me.hoodAgeMs, cfg), rt.targets)
                val dd = Neighborhoods.distanceToSet(reliable(peer.hood, peer.hoodAgeMs, cfg), rt.targets)
                val inArea = dd != null && dd <= 1 && ds != null && ds <= 1
                val good = dd != null && ds != null && (dd <= ds || inArea)
                if (good) return if (sent.good < rt.fanout) Offer(false, dd!!) else null   // fan-out budget: better-direction peers beyond it get nothing (as in the prototype)
                val patient = !p.tgt && nowMs - p.receivedMs >= cfg.patienceMs
                // The prototype detours only when no better-direction neighbour still lacks the packet. Pairwise equivalent: this phone has not handed the
                // packet to a better-direction peer for [detourWaitMs] (counted from receipt or from its last such handoff), or it has used up its
                // better-direction budget. Patience only raises the budgets below; it does NOT bypass this rule (that made every copy flood).
                val since = maxOf(p.receivedMs, sent.lastGoodMs)
                if (!(sent.good >= rt.fanout || nowMs - since >= cfg.detourWaitMs)) return null
                val dmax = if (p.tgt) 0 else rt.detourMax + (if (patient) cfg.patientExtra else 0)
                val away = rt.detourAway + (if (patient) 1 else 0)
                val copiesOk = sent.detour < cfg.detourCopies + (if (patient) cfg.patientExtra else 0)
                if (p.detours < dmax && copiesOk && (dd == null || ds == null || dd - ds <= away)) return Offer(true, dd ?: 99)
                return null
            }
        }
    }
}

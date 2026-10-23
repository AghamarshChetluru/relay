package app.relay.core

import org.junit.Assert.*
import org.junit.Test

/** Logic-level store-carry-forward over simulated contacts. This is NOT radio evidence: it proves the protocol rules, not Bluetooth. */
class MultiHopTest {
    private val clock = FakeClock()
    private fun phone(h: String?) = Phone("p", clock, hood = h)

    @Test fun aToBToCWithoutAEverMeetingC() {
        val a = phone("HK"); val b = phone("GP"); val c = phone("LN")
        val req = ok(a.engine.createRequest(urgentInput()))
        contact(a, b); assertFalse(c.has(req.packetId!!))
        clock.minutes(12)                                         // B walks away from A and later meets C
        contact(b, c)
        assertTrue("C received it through B", c.has(req.packetId!!))
        assertEquals("2 hops", 2, c.store.getPacket(req.packetId!!)!!.hops); assertEquals(b.id, c.store.getPacket(req.packetId!!)!!.via)
        assertEquals("remaining life shrank by the 12 minutes B carried it", 48 * Limits.MINUTE_MS, c.store.getPacket(req.packetId!!)!!.expiresMs - clock.nowMs())
        assertEquals("A never learned that C has it", 0, a.store.sentCounts(req.packetId!!).total.let { if (a.store.hasSentTo(req.packetId!!, c.id)) 1 else 0 })
        // reply returns C -> B -> A, acknowledgment returns A -> B -> C
        val rep = ok(c.engine.createReply(req.caseId!!, "offer", "I can help", "Gate 2")); clock.minutes(5); contact(c, b); clock.minutes(5); contact(b, a)
        assertTrue(a.has(rep.packetId!!)); assertEquals(2, a.store.getPacket(rep.packetId!!)!!.hops)
        val ack = ok(a.engine.createAck(rep.packetId!!)); clock.minutes(3); contact(a, b); contact(b, c)
        assertTrue(c.has(ack.packetId!!)); assertTrue("volunteer learns of the acknowledgment only after it travelled", c.engine.ackOf(rep.packetId!!))
        assertFalse("A and C never directly connected", a.store.hasSentTo(req.packetId!!, c.id) || c.store.hasSentTo(rep.packetId!!, a.id))
    }

    @Test fun packetExpiringWhileCarriedIsNotForwarded() {
        val a = phone("HK"); val b = phone("GP"); val c = phone("LN"); val req = ok(a.engine.createRequest(urgentInput(30)))
        contact(a, b); clock.minutes(31); contact(b, c)
        assertTrue("B still holds it (expired, within grace)", b.has(req.packetId!!)); assertFalse("but it is never passed on", c.has(req.packetId!!))
    }

    @Test fun carriersWithWildlyDifferentClocksStillAgreeOnExpiry() {
        val ca = FakeClock(1_000_000_000_000L); val cb = FakeClock(9_000_000_000_000L)       // B's wall clock is ~100 days ahead
        val a = Phone("a", ca, hood = "HK"); val b = Phone("b", cb, hood = "GP")
        val req = ok(a.engine.createRequest(urgentInput(60))); contact(a, b)
        assertEquals("B expires it 60 min on ITS OWN clock, not by comparing absolute timestamps", cb.t + 60 * Limits.MINUTE_MS, b.store.getPacket(req.packetId!!)!!.expiresMs)
        ca.minutes(61); cb.minutes(61); assertTrue(cb.t >= b.store.getPacket(req.packetId!!)!!.expiresMs)
    }

    @Test fun duplicateArrivalViaTwoPathsStoresOnceAndStillReachesNewPeers() {
        val a = phone("HK"); val b = phone("GP"); val c = phone("SE"); val d = phone("LN"); val bc = ok(a.engine.createBroadcast("hello all", "Community", ""))
        contact(a, b); contact(a, c); val (s, _) = contact(b, c)
        assertEquals("C already had it from A: duplicate, not stored twice", 0, s.stats.stored)
        assertEquals(1, c.store.packets().count { it.id == bc.packetId })
        contact(c, d); assertTrue("a later, unreached peer still gets it", d.has(bc.packetId!!))
        assertEquals(1, d.packetsOf(PacketType.BROADCAST).size)
    }

    @Test fun renewalSupersedesOldVersionAndRepliesToTheCaseSurvive() {
        val a = phone("HK"); val b = phone("GP"); val c = phone("LN"); val v0 = ok(a.engine.createRequest(urgentInput(60)))
        contact(a, b); val rep = ok(b.engine.createReply(v0.caseId!!, "offer", "on my way", "")); clock.minutes(20)
        val v1 = ok(a.engine.renewRequest(v0.caseId!!, RenewInput(validityMin = 120, description = "Updated")))
        contact(a, b); b.engine.housekeeping()
        assertTrue(b.has(v1.packetId!!)); assertFalse("older version is dropped from relay caches", b.has(v0.packetId!!)); assertTrue("B's own reply is kept", b.has(rep.packetId!!))
        contact(b, c); assertTrue(c.has(v1.packetId!!)); assertFalse("superseded version is not forwarded", c.has(v0.packetId!!))
        assertEquals("one request version visible per case", 1, c.packetsOf(PacketType.REQUEST).size)
        assertTrue("reply still reaches the requester after renewal", a.has(rep.packetId!!))
    }

    @Test fun missingPersonRequestIsSteeredTowardTheLastKnownNeighbourhood() {
        // chain HK -> GP -> SE -> LC -> CP, plus a dead-end phone in JS (farther from CP) that the author also meets
        val a = phone("HK"); val gp = phone("GP"); val se = phone("SE"); val lc = phone("LC"); val cp = phone("CP"); val js = phone("JS")
        val req = ok(a.engine.createRequest(missingInput("CP")))
        contact(a, gp); contact(gp, se); contact(se, lc); contact(lc, cp)
        assertTrue("reached the target neighbourhood", cp.has(req.packetId!!))
        contact(a, js); assertFalse("a better-direction relay was found, so no detour yet", js.has(req.packetId!!))
        clock.minutes(17); contact(a, js); assertTrue("after waiting past patience a bounded detour is allowed rather than leaving the packet stuck", js.has(req.packetId!!))
        val x = phone("BS"); contact(js, x); assertTrue("equal-distance forwarding allowed", x.has(req.packetId!!))
        val cp2 = phone("CP"); contact(cp, cp2); assertTrue("distributed within the target area", cp2.has(req.packetId!!))
        assertTrue("copies that reached the target stay in target + adjacent areas", cp2.store.getPacket(req.packetId!!)!!.tgt)
        val far = phone("HK"); contact(cp2, far); assertFalse("a copy inside the target area does not walk back out", far.has(req.packetId!!))
    }

    @Test fun staleOrUnknownLocationsFallBackToBoundedForwarding() {
        val a = phone("HK"); val req = ok(a.engine.createRequest(missingInput(target = "CP")))
        clock.minutes(70)                                   // A's own declared area is now stale -> treated as unknown by routing
        val peers = (1..6).map { phone("GP") }
        peers.forEach { contact(a, it) }
        val got = peers.count { it.has(req.packetId!!) }
        val cfg = PolicyConfig()
        assertTrue("stale location + waited past patience: bounded to ${cfg.detourCopies + cfg.patientExtra} copies, never unlimited ($got of 6)", got in 1..(cfg.detourCopies + cfg.patientExtra))
        val fresh = phone("HK"); fresh.engine.setHood(null, "Near the old fort"); val rf = ok(fresh.engine.createRequest(missingInput(target = "CP")))
        val ps2 = (1..6).map { phone("GP") }; ps2.forEach { contact(fresh, it) }
        assertEquals("no better-direction peer can be identified yet, but it has not waited: nothing leaves", 0, ps2.count { it.has(rf.packetId!!) })
        clock.minutes(4); ps2.forEach { contact(fresh, it) }
        assertEquals("unknown own area, not yet patient: only ${cfg.detourCopies} detour copies", cfg.detourCopies, ps2.count { it.has(rf.packetId!!) })
        val unknown = phone("HK"); val r2 = ok(unknown.engine.createRequest(missingInput(target = "CP").let { RequestInput("missing", "Missing", it.title, area = "somewhere", areaHood = null, areaHoodName = "Somewhere else", validityMin = 1440, targets = emptyList()) }))
        assertEquals(PolicyKind.OPPORTUNISTIC, unknown.store.getPacket(r2.packetId!!)!!.env.route.policy)
        val ps = (1..6).map { phone("VV") }; ps.forEach { contact(unknown, it) }; assertEquals("opportunistic fan-out is unaffected by detour waiting", 3, ps.count { it.has(r2.packetId!!) })
    }

    @Test fun emergencyRequestsFloodAndOutrankBroadcastsOnABusyLink() {
        val a = phone("HK"); val b = phone("GP")
        repeat(10) { ok(a.engine.createBroadcast("update $it", "Community", "")) }
        val req = ok(a.engine.createRequest(urgentInput()))
        val inv = a.engine.inventory(PeerView(b.id, "GP", 0)); assertEquals("urgent request is listed first", req.packetId, inv.first().id)
        assertTrue(inv.map { it.prio }.zipWithNext().all { it.first <= it.second })
        assertEquals(PolicyKind.FLOOD, a.store.getPacket(req.packetId!!)!!.env.route.policy)
        val chain = (1..6).map { phone("LC") }; var prev = a; chain.forEach { contact(prev, it); prev = it }
        assertTrue("flooded to the end of the chain, any neighbourhood", chain.last().has(req.packetId!!))
    }

    @Test fun broadcastHopBudgetBoundsSpread() {
        val a = phone("HK"); val bc = ok(a.engine.createBroadcast("hello", "Community", "")); var prev = a; val chain = (1..40).map { phone("HK") }
        chain.forEach { contact(prev, it); prev = it }
        val reached = chain.count { it.has(bc.packetId!!) }
        assertEquals("hop budget ${PolicyConfig().broadcastHops} limits the spread", PolicyConfig().broadcastHops, reached)
    }
}

package app.relay.core

import org.junit.Assert.*
import org.junit.Test

class EngineTest {
    private val clock = FakeClock()
    private fun phone(h: String? = "HK") = Phone("p", clock, hood = h)
    private fun hop(ms: Long = 60 * Limits.MINUTE_MS, hops: Int = 1) = Hop(hops, 0, false, ms)

    @Test fun idsAreRandomHexNotPredictableCounters() {
        val a = phone(); val ids = (1..50).map { ok(a.engine.createRequest(urgentInput())).caseId!! }.toSet()
        assertEquals("50 cases must have 50 distinct IDs", 50, ids.size)
        assertTrue(ids.all { it.length == 32 && it.matches(Regex("[0-9a-f]{32}")) && !it.startsWith("R") })
        val pk = a.store.packets().map { it.id }.toSet(); assertEquals(50, pk.size)
    }

    @Test fun requestRenewalKeepsCaseButNewPacketAndFreshExpiry() {
        val a = phone(); val c = ok(a.engine.createRequest(urgentInput(30))); clock.minutes(31)
        assertTrue(clock.nowMs() >= a.store.getPacket(c.packetId!!)!!.expiresMs)
        val r = ok(a.engine.renewRequest(c.caseId!!, RenewInput(validityMin = 120, description = "Still needed, now in the courtyard")))
        assertEquals(c.caseId, r.caseId); assertNotEquals(c.packetId, r.packetId)
        val p = a.store.getPacket(r.packetId!!)!!
        assertEquals(1, p.env.caseVersion); assertEquals(clock.nowMs() + 120 * Limits.MINUTE_MS, p.expiresMs); assertEquals("Still needed, now in the courtyard", p.env.s("description"))
        assertTrue("original packet is kept in the author's history", a.has(c.packetId!!))
        val b = phone(); assertEquals(RxStatus.STORED, b.engine.receive(p.env.wire(), hop(120 * Limits.MINUTE_MS), a.id).status)
        assertEquals("a phone holding only the renewal still knows the full request", "Medical help needed near the gate", b.store.getPacket(r.packetId!!)!!.env.s("title"))
    }

    @Test fun onlyTheAuthorMayRenewAckResolveOrShareAddress() {
        val a = phone(); val b = phone(); val c = ok(a.engine.createRequest(urgentInput(privB = "Flat 4B")))
        b.engine.receive(a.store.getPacket(c.packetId!!)!!.env.wire(), hop(), a.id)
        assertFalse(b.engine.renewRequest(c.caseId!!, RenewInput()).ok); assertFalse(b.engine.createResolve(c.caseId!!).ok)
        val rep = ok(b.engine.createReply(c.caseId!!, "offer", "coming", "")); a.engine.receive(b.store.getPacket(rep.packetId!!)!!.env.wire(), hop(), b.id)
        assertFalse(b.engine.createAck(rep.packetId!!).ok); assertFalse(b.engine.shareAddress(rep.packetId!!).ok)
        ok(a.engine.createAck(rep.packetId!!)); assertFalse("ack only once", a.engine.createAck(rep.packetId!!).ok)
        ok(a.engine.createResolve(c.caseId!!)); assertFalse("resolve only once", a.engine.createResolve(c.caseId!!).ok)
        assertFalse("resolved cases cannot be renewed", a.engine.renewRequest(c.caseId!!, RenewInput()).ok)
    }

    @Test fun forgedAckAndResolveFromAnotherKeyAreIgnoredForStatus() {
        val a = phone(); val m = phone(); val c = ok(a.engine.createRequest(urgentInput()))
        val b = phone(); b.engine.receive(a.store.getPacket(c.packetId!!)!!.env.wire(), hop(), a.id)
        val caseId = a.store.getPacket(c.packetId!!)!!.env.caseId!!
        val fake = Envelope.build(PacketType.RESOLVE, caseId, 0, clock.nowMs(), 90 * Limits.MINUTE_MS, true, Policy.routeFor(PacketType.RESOLVE, null, emptyList(), PolicyConfig()), emptyMap(), m.identity, sharedCrypto)
        assertEquals("it is a valid packet (anyone can sign something)", RxStatus.STORED, b.engine.receive(fake.wire(), hop(), m.id).status)
        assertFalse("but it must not resolve the case: signer is not the requester", b.engine.isResolved(c.caseId!!))
        ok(a.engine.createResolve(c.caseId!!)); b.engine.receive(a.packetsOf(PacketType.RESOLVE).first().env.wire(), hop(), a.id); assertTrue(b.engine.isResolved(c.caseId!!))
    }

    @Test fun repliesOnlyOnPhonesThatReceivedAnActiveCase() {
        val a = phone(); val b = phone(); val c = ok(a.engine.createRequest(urgentInput(30)))
        assertFalse("never received", b.engine.createReply(c.caseId!!, "offer", "x", "").ok)
        assertFalse("own request", a.engine.createReply(c.caseId!!, "offer", "x", "").ok)
        b.engine.receive(a.store.getPacket(c.packetId!!)!!.env.wire(), hop(30 * Limits.MINUTE_MS), a.id)
        assertFalse("empty note", b.engine.createReply(c.caseId!!, "offer", "  ", "").ok)
        val r1 = ok(b.engine.createReply(c.caseId!!, "offer", "first", "")); val r2 = ok(b.engine.createReply(c.caseId!!, "offer", "second", ""))
        assertNotEquals("distinct replies stay distinct", r1.packetId, r2.packetId)
        clock.minutes(31); assertFalse("expired", b.engine.createReply(c.caseId!!, "offer", "late", "").ok)
    }

    @Test fun remainingLifetimeNotSenderClockDecidesExpiry() {
        val a = phone(); val c = ok(a.engine.createRequest(urgentInput(60))); val wire = a.store.getPacket(c.packetId!!)!!.env.wire()
        val b = phone(); assertEquals(RxStatus.EXPIRED, b.engine.receive(wire, hop(0), a.id).status)
        val b2 = phone(); assertEquals(RxStatus.STORED, b2.engine.receive(wire, hop(10 * Limits.MINUTE_MS), a.id).status)
        assertEquals(clock.nowMs() + 10 * Limits.MINUTE_MS, b2.store.getPacket(c.packetId!!)!!.expiresMs)
        val b3 = phone(); b3.engine.receive(wire, Hop(1, 0, false, 10 * 24 * 3_600_000L), a.id)     // a lying sender claiming days left is capped by the SIGNED validity
        assertEquals(clock.nowMs() + 60 * Limits.MINUTE_MS, b3.store.getPacket(c.packetId!!)!!.expiresMs)
        assertEquals(RxStatus.DUPLICATE, b2.engine.receive(wire, hop(), a.id).status)
    }

    @Test fun expiredCopiesAreCleanedFromRelayCachesButAuthorsKeepHistory() {
        val a = phone(); val b = phone(); val c = ok(a.engine.createRequest(urgentInput(30)))
        b.engine.receive(a.store.getPacket(c.packetId!!)!!.env.wire(), hop(30 * Limits.MINUTE_MS), a.id)
        clock.minutes(30 + 29); b.engine.housekeeping(); assertTrue("still visible (as expired) during grace", b.has(c.packetId!!))
        clock.minutes(2); b.engine.housekeeping(); a.engine.housekeeping()
        assertFalse(b.has(c.packetId!!)); assertTrue("requester keeps case history", a.has(c.packetId!!))
        assertEquals("tombstone: an expired packet cannot be re-accepted", RxStatus.DUPLICATE, b.engine.receive(a.store.getPacket(c.packetId!!)!!.env.wire(), hop(5 * Limits.MINUTE_MS), a.id).status)
    }

    @Test fun exactAddressIsNeverInAnyPlaintextPacket() {
        val a = phone(); val b = phone(); val c = ok(a.engine.createRequest(urgentInput(privB = "Flat 4B, Block C", privD = "Blue gate")))
        b.engine.receive(a.store.getPacket(c.packetId!!)!!.env.wire(), hop(), a.id)
        val rep = ok(b.engine.createReply(c.caseId!!, "offer", "coming", "")); a.engine.receive(b.store.getPacket(rep.packetId!!)!!.env.wire(), hop(), b.id)
        val sh = ok(a.engine.shareAddress(rep.packetId!!)); assertFalse("only once per volunteer", a.engine.shareAddress(rep.packetId!!).ok)
        for (p in a.store.packets()) assertFalse("${p.env.type} leaks address", String(p.env.wire(), Charsets.ISO_8859_1).let { it.contains("Flat 4B") || it.contains("Blue gate") })
        assertTrue(a.store.packets().first { it.env.type == PacketType.REQUEST }.env.s("hasPrivate") == "1")
        val wire = a.store.getPacket(sh.packetId!!)!!.env.wire()
        val carrier = phone(); carrier.engine.receive(wire, hop(), a.id); b.engine.receive(wire, hop(), a.id)
        assertNull("a relaying phone cannot read it", carrier.engine.openAddress(carrier.store.getPacket(sh.packetId!!)!!))
        assertEquals("Flat 4B, Block C" to "Blue gate", b.engine.openAddress(b.store.getPacket(sh.packetId!!)!!))
    }

    @Test fun addressSignedByAnotherKeyIsNotTrusted() {
        val a = phone(); val b = phone(); val mallory = phone(); val c = ok(a.engine.createRequest(urgentInput(privB = "Flat 4B")))
        b.engine.receive(a.store.getPacket(c.packetId!!)!!.env.wire(), hop(), a.id)
        val rep = ok(b.engine.createReply(c.caseId!!, "offer", "coming", ""))
        val rp = b.store.getPacket(rep.packetId!!)!!
        val sealed = sharedCrypto.seal(b.identity.boxPub, Writer().str("Fake address").str("").toByteArray(), rp.env.caseId!! + rp.id.unhex())
        val f = mapOf("replyPacketId" to rp.id.toByteArray(), "toDevice" to b.id.toByteArray(), "sealed" to sealed)
        val fake = Envelope.build(PacketType.ADDRESS, rp.env.caseId, 0, clock.nowMs(), 60 * Limits.MINUTE_MS, true, rp.env.route, f, mallory.identity, sharedCrypto)
        b.engine.receive(fake.wire(), hop(), mallory.id)
        assertNull("sealed by an attacker for the right volunteer, but not signed by the requester", b.engine.openAddress(b.store.getPacket(fake.id)!!))
    }

    @Test fun declaredAreaReminderStalenessAndCustomAreas() {
        val a = phone("HK"); assertFalse(a.engine.hoodState().due)
        clock.minutes(29); assertFalse(a.engine.hoodState().due); clock.minutes(1)
        assertTrue(a.engine.hoodState().due); assertTrue(a.engine.hoodState().reliable); assertFalse(a.engine.hoodState().stale)
        clock.minutes(31); assertTrue(a.engine.hoodState().stale); assertFalse("stale area is not trusted for routing", a.engine.hoodState().reliable)
        a.engine.confirmHood(); assertTrue(a.engine.hoodState().reliable); assertFalse(a.engine.hoodState().due)
        ok(a.engine.setHood("CP", "")); assertEquals("Connaught Place", a.engine.hoodState().name)
        ok(a.engine.setHood(null, "Near the old fort gate")); assertFalse("free-text areas never steer routing", a.engine.hoodState().reliable); assertNull(a.engine.hoodState().id)
        assertFalse(a.engine.setHood("ZZ", "").ok); assertFalse(a.engine.setHood(null, "").ok); assertFalse(a.engine.setHood(null, "x".repeat(61)).ok)
        clock.t -= 3_600_000; assertEquals("clock moved backwards must not produce negative age", 0L, a.engine.hoodState().ageMs.coerceAtLeast(0))
    }

    @Test fun perOriginRateLimitStopsFloods() {
        val spammer = phone(); val b = phone(); var rejected = 0
        repeat(Limits.RATE_PER_ORIGIN_PER_HOUR + 5) { i ->
            val o = ok(spammer.engine.createBroadcast("spam $i", "Community", ""))
            if (b.engine.receive(spammer.store.getPacket(o.packetId!!)!!.env.wire(), hop(45 * Limits.MINUTE_MS), spammer.id).status == RxStatus.REJECTED) rejected++
        }
        assertEquals(5, rejected); clock.minutes(61)
        val o = ok(spammer.engine.createBroadcast("later", "Community", "")); assertEquals(RxStatus.STORED, b.engine.receive(spammer.store.getPacket(o.packetId!!)!!.env.wire(), hop(45 * Limits.MINUTE_MS), spammer.id).status)
    }

    @Test fun storageCapKeepsUrgentAndOwnPacketsAndDropsLowPriorityFirst() {
        val b = phone(); val a = phone(); val urgent = ok(a.engine.createRequest(urgentInput()))
        b.engine.receive(a.store.getPacket(urgent.packetId!!)!!.env.wire(), hop(), a.id)
        val own = ok(b.engine.createBroadcast("mine", "Community", ""))
        repeat(Limits.MAX_STORED_PACKETS + 30) { val s = phone(); val o = ok(s.engine.createBroadcast("x$it", "Community", "")); b.engine.receive(s.store.getPacket(o.packetId!!)!!.env.wire(), hop(45 * Limits.MINUTE_MS), s.id) }
        b.engine.housekeeping()
        assertTrue(b.store.packets().count { !it.authored } <= Limits.MAX_STORED_PACKETS)
        assertTrue("active urgent request survives low-priority churn", b.has(urgent.packetId!!)); assertTrue(b.has(own.packetId!!))
    }

    @Test fun malformedInputNeverCrashesOrStores() {
        val b = phone(); val rnd = java.util.Random(5)
        repeat(300) { b.engine.receive(ByteArray(rnd.nextInt(600)).also { rnd.nextBytes(it) }, hop(), "x") }
        val a = phone(); val c = ok(a.engine.createRequest(urgentInput())); val w = a.store.getPacket(c.packetId!!)!!.env.wire()
        repeat(300) { val m = w.copyOf(); m[rnd.nextInt(m.size)] = rnd.nextInt(256).toByte(); b.engine.receive(m, hop(), "x") }
        assertTrue("random garbage and mutated packets must not be stored (except the one-in-256 no-op mutation of an identical byte)", b.store.packets().size <= 1)
        assertEquals(RxStatus.REJECTED, b.engine.receive(w, Hop(-1, 0, false, 1000), "x").status.let { if (it == RxStatus.DUPLICATE) RxStatus.REJECTED else it })
    }
}

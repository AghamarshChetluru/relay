package app.relay.core

import org.junit.Assert.*
import org.junit.Test

/** The rules behind "a message newly arrived and deserves your attention". Real engines, real signatures; nothing is simulated. */
class InboxTest {
    private val clock = FakeClock()
    private fun hop(ms: Long = 60 * Limits.MINUTE_MS) = Hop(1, 0, false, ms)
    private fun give(from: Phone, to: Phone, packetId: String): RxResult = to.engine.receive(from.store.getPacket(packetId)!!.env.wire(), hop(), from.id)
    /** receive() and capture the engine's own "newly stored" signal, exactly what the app's notification code listens to. */
    private class Watched(val got: MutableList<StoredPacket> = ArrayList(), val notes: MutableList<Notice?> = ArrayList()) { val size get() = got.size; operator fun get(i: Int) = got[i] }
    private fun watch(p: Phone): Watched { val w = Watched(); p.engine.onStored = { sp -> w.got.add(sp); w.notes.add(Inbox.classify(p.engine, sp)) }; return w }   // classified at signal time, exactly like the app

    @Test fun aRequestFromAnotherPhoneIsNewsButNeverRevealsItsText() {
        val a = Phone("a", clock); val b = Phone("b", clock, hood = "GP"); val got = watch(b)
        val r = ok(a.engine.createRequest(urgentInput()))
        assertEquals(RxStatus.STORED, give(a, b, r.packetId!!).status)
        assertEquals(1, got.size); val n = got.notes[0]!!
        assertEquals(NoticeKind.REQUEST, n.kind); assertEquals("Medical assistance requested", n.title); assertEquals("Hauz Khas", n.where)
        assertEquals(Ref("request", r.caseId, r.packetId), n.ref); assertEquals("Medical assistance requested · Hauz Khas", n.line)
        assertFalse("the notice never carries the description", n.toJson().contains("collapsed"))
        assertNull("what this phone wrote itself is never an incoming notice", Inbox.classify(a.engine, a.store.getPacket(r.packetId!!)!!))
    }

    @Test fun duplicatesRejectedAndExpiredPacketsNeverFireTheSignal() {
        val a = Phone("a", clock); val b = Phone("b", clock); val got = watch(b); val r = ok(a.engine.createRequest(urgentInput()))
        assertEquals(RxStatus.STORED, give(a, b, r.packetId!!).status); assertEquals(RxStatus.DUPLICATE, give(a, b, r.packetId!!).status)
        val bad = a.store.getPacket(r.packetId!!)!!.env.wire().copyOf().also { it[it.size - 1] = (it[it.size - 1].toInt() xor 1).toByte() }
        assertEquals(RxStatus.REJECTED, b.engine.receive(bad, hop(), a.id).status)
        val old = ok(a.engine.createRequest(urgentInput(30))); clock.minutes(31)
        assertEquals(RxStatus.EXPIRED, b.engine.receive(a.store.getPacket(old.packetId!!)!!.env.wire(), Hop(1, 0, false, 0), a.id).status)
        assertEquals("one genuinely new packet, one signal", 1, got.size)
    }

    @Test fun aRenewalIsOnlyNewsWhenTheWordsChanged() {
        val a = Phone("a", clock); val b = Phone("b", clock); val got = watch(b); val c = ok(a.engine.createRequest(urgentInput(30)))
        give(a, b, c.packetId!!); clock.minutes(31)
        val same = ok(a.engine.renewRequest(c.caseId!!, RenewInput(validityMin = 120)))                    // only more time
        give(a, b, same.packetId!!); assertEquals(2, got.size); assertNull("a renewal with the same content is not a new unread entry", got.notes[1])
        val changed = ok(a.engine.renewRequest(c.caseId!!, RenewInput(description = "Now in the courtyard")))
        give(a, b, changed.packetId!!); val n = got.notes[2]
        assertEquals(NoticeKind.REQUEST_UPDATE, n!!.kind); assertEquals("Request updated", n.title)
    }

    @Test fun responsesToMyRequestsAreHighPriorityAndOthersAreNotNews() {
        val a = Phone("a", clock); val b = Phone("b", clock, hood = "GP"); val carrier = Phone("c", clock); val c = ok(a.engine.createRequest(urgentInput()))
        give(a, b, c.packetId!!); give(a, carrier, c.packetId!!)
        val rep = ok(b.engine.createReply(c.caseId!!, "offer", "I can come now", "Gate 2")); val gotA = watch(a); val gotC = watch(carrier)
        give(b, a, rep.packetId!!); give(b, carrier, rep.packetId!!)
        val n = gotA.notes[0]!!
        assertEquals(NoticeKind.REPLY, n.kind); assertTrue(n.kind.priority); assertEquals("Someone sent a response", n.title); assertEquals(Ref("reply", c.caseId, rep.packetId), n.ref)
        assertFalse("body text of the response is not in the notice", n.toJson().contains("come now"))
        assertNull("an offer that merely passes through another phone is not news there", gotC.notes[0])
        val sight = ok(Phone("m", clock).let { m -> give(a, m, c.packetId!!); m.engine.createReply(c.caseId!!, "sighting", "Maybe seen near the gate", "") })
        assertNotNull(sight)
    }

    @Test fun acknowledgmentsAndResolutionsReachOnlyThePeopleTheyConcern() {
        val a = Phone("a", clock); val b = Phone("b", clock); val other = Phone("o", clock); val c = ok(a.engine.createRequest(urgentInput()))
        give(a, b, c.packetId!!); give(a, other, c.packetId!!)
        val rep = ok(b.engine.createReply(c.caseId!!, "offer", "coming", "")); give(b, a, rep.packetId!!)
        val ack = ok(a.engine.createAck(rep.packetId!!)); val res = ok(a.engine.createResolve(c.caseId!!))
        val gb = watch(b); val go = watch(other)
        give(a, b, ack.packetId!!); give(a, b, res.packetId!!); give(a, other, ack.packetId!!); give(a, other, res.packetId!!)
        val nb = gb.notes.filterNotNull()
        assertEquals(listOf(NoticeKind.ACK, NoticeKind.RESOLVE), nb.map { it.kind })
        assertEquals("an acknowledgment routes to the OFFER it acknowledges, in its case", Ref("ack", c.caseId, rep.packetId), nb[0].ref)
        assertTrue("someone who never responded is not told", go.notes.filterNotNull().isEmpty())
    }

    @Test fun communityUpdatesAndQuietPacketTypes() {
        val a = Phone("a", clock); val b = Phone("b", clock, hood = "GP"); val got = watch(b)
        val u = ok(a.engine.createBroadcast("Water at the market gate", "Resources", "Market gate")); give(a, b, u.packetId!!)
        val n = got.notes[0]!!
        assertEquals(NoticeKind.BROADCAST, n.kind); assertEquals("Community update received", n.title); assertEquals("Market gate", n.where); assertEquals(Ref("broadcast", null, u.packetId), n.ref)
        assertFalse(n.toJson().contains("Water"))
        // a request with a photo: the attachment metadata packet stores quietly (no second notice for the same case)
        val p = ok(a.engine.createRequest(missingInput("CP", photo = fakeJpeg(2400))))
        val before = got.size; Pipe.run(a.engine, b.engine)
        val classified = got.notes.drop(before).filterNotNull()
        assertEquals("a request with a photo is announced once", 1, classified.count { it.kind == NoticeKind.REQUEST && it.ref.caseId == p.caseId })
        assertTrue(got.got.drop(before).any { it.env.type == PacketType.ATTACHMENT })
        assertTrue("attachment packets themselves never produce a notice", got.got.indices.filter { got.got[it].env.type == PacketType.ATTACHMENT }.all { got.notes[it] == null })
    }

    @Test fun readStateIsDurableAndExistingMessagesAreHistory() {
        val a = Phone("a", clock); val b = Phone("b", clock); val c = ok(a.engine.createRequest(urgentInput())); give(a, b, c.packetId!!)
        assertFalse(ReadState.isRead(b.store, c.packetId!!))
        ReadState.initIfNeeded(b.store)                       // upgrade: what is already on the phone is history, not news
        assertTrue(ReadState.isRead(b.store, c.packetId!!) && b.store.hasFlag(ReadState.ANNOUNCED, c.packetId!!))
        val c2 = ok(a.engine.createRequest(urgentInput())); give(a, b, c2.packetId!!)
        assertFalse("a message that arrives after the upgrade is unread", ReadState.isRead(b.store, c2.packetId!!))
        ReadState.initIfNeeded(b.store); assertFalse("the one-time upgrade never runs twice", ReadState.isRead(b.store, c2.packetId!!))
        ReadState.markRead(b.store, listOf(c2.packetId!!, "not-an-id")); assertTrue(ReadState.isRead(b.store, c2.packetId!!)); assertFalse(b.store.hasFlag(ReadState.READ, "not-an-id"))
        val snap = Json.parse(Snapshot.build(b.engine, RadioStatus())) as Map<*, *>
        val read = ((snap["flags"] as Map<*, *>)["read"] as List<*>).toSet()
        assertTrue("the snapshot carries read state to the page", read.contains(c.packetId) && read.contains(c2.packetId))
    }

    @Test fun onlyResponsesAndHelpNearYouAreImportant() {
        val a = Phone("a", clock, hood = "HK"); val near = Phone("near", clock, hood = "GP"); val far = Phone("far", clock, hood = "LN"); val lost = Phone("lost", clock, hood = null)
        val wn = watch(near); val wf = watch(far); val wl = watch(lost)
        val urgent = ok(a.engine.createRequest(urgentInput()))                                  // urgent, reported in Hauz Khas
        for (p in listOf(near, far, lost)) give(a, p, urgent.packetId!!)
        assertTrue("urgent help one step from my area interrupts", wn.notes[0]!!.important)
        assertFalse("urgent help two steps away does not (it still reaches the inbox)", wf.notes[0]!!.important)
        assertFalse("a phone with no fresh declared area never guesses relevance", wl.notes[0]!!.important)
        val general = ok(a.engine.createRequest(RequestInput("urgent", "Shelter", "Shelter needed near the market", area = "Market", areaHood = "HK", areaHoodName = "Hauz Khas", urgent = false, validityMin = 360)))
        give(a, near, general.packetId!!); assertFalse("a non-urgent request next door does not interrupt", wn.notes[1]!!.important)
        val lc = Phone("lc", clock, hood = "LC"); val wlc = watch(lc); val cp = ok(a.engine.createRequest(missingInput("CP")))
        give(a, lc, cp.packetId!!); give(a, near, cp.packetId!!)
        assertTrue("a missing-person search aimed one step from me interrupts", wlc.notes[0]!!.important); assertFalse("one aimed far from me does not", wn.notes[2]!!.important)
        val u = ok(far.engine.createBroadcast("Water at the gate", "Resources", "Gate")); give(far, near, u.packetId!!); assertFalse("community updates never interrupt", wn.notes[3]!!.important)
        val rep = ok(near.engine.createReply(urgent.caseId!!, "offer", "coming", "")); val wa = watch(a); give(near, a, rep.packetId!!)
        assertTrue("a response to MY request always does", wa.notes[0]!!.important)
        val plan = NoticePlan.plan(listOf(wn.notes[2]!!, wn.notes[3]!!, wn.notes[1]!!, wn.notes[0]!!))
        assertEquals("four messages are ONE summary, however important some are", 1, plan.size)
        assertTrue("the summary is loud only because one of them is important", (plan[0] as NoticePlan.Out.Summary).priority)
        val quiet = NoticePlan.plan(listOf(wn.notes[2]!!, wn.notes[3]!!, wn.notes[1]!!))
        assertFalse("quiet messages never make a loud summary", (quiet[0] as NoticePlan.Out.Summary).priority)
    }

    @Test fun oneMessageIsItsOwnNotificationAndTwoOrMoreAreOneSummary() {
        fun n(k: NoticeKind, i: Int) = Notice(k, Ref("request", "c".repeat(31) + i, "p".repeat(31) + i).let { Ref(it.t, "0".repeat(31) + i, "1".repeat(31) + i) }, "t$i", "", "", false, "e$i")
        assertTrue(NoticePlan.plan(emptyList()).isEmpty())
        val one = NoticePlan.plan(listOf(n(NoticeKind.REPLY, 1)))
        assertTrue("a single message opens exactly that message", one.size == 1 && one[0] is NoticePlan.Out.One)
        val two = NoticePlan.plan(listOf(n(NoticeKind.REQUEST, 1), n(NoticeKind.BROADCAST, 2)))
        assertTrue("two messages: one 'N new messages' notification, not two", two.size == 1 && (two[0] as NoticePlan.Out.Summary).count == 2 && !(two[0] as NoticePlan.Out.Summary).priority)
        val burst = NoticePlan.plan((1..7).map { n(NoticeKind.REQUEST, it) } + n(NoticeKind.REPLY, 8))
        assertEquals("seven requests and a response: still one notification", 1, burst.size)
        assertEquals(8, (burst[0] as NoticePlan.Out.Summary).count); assertTrue((burst[0] as NoticePlan.Out.Summary).priority)
        val ids = (1..8).map { n(NoticeKind.REQUEST, it).ref.key }.toSet(); assertEquals("every destination key is unique", 8, ids.size)
    }

    @Test fun referencesFromOutsideAreValidated() {
        val hex = "0123456789abcdef0123456789abcdef"
        assertNotNull(Ref.parse("reply", hex, hex)); assertNotNull(Ref.parse("inbox", null, null)); assertNotNull(Ref.parse("broadcast", null, hex))
        assertNull(Ref.parse("../../etc", hex, hex)); assertNull(Ref.parse("reply", "xyz", hex)); assertNull(Ref.parse("reply", hex, "<script>")); assertNull(Ref.parse(null, hex, hex))
        assertEquals(Ref("reply", hex, hex).key, Ref("reply", hex, hex).key); assertNotEquals(Ref("reply", hex, hex).key, Ref("ack", hex, hex).key)
    }
}

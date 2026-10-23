package app.relay.core

import org.junit.Assert.*
import org.junit.Test

class ValidationTest {
    private val clock = FakeClock()
    private fun phone() = Phone("p", clock)

    private fun mutate(e: Envelope, id: Identity, change: (MutableMap<String, ByteArray>) -> Unit, validityMs: Long = e.validityMs, route: Route = e.route, urgent: Boolean = e.urgent): String? {
        val f = HashMap(e.fields); change(f)
        val n = Envelope.build(e.type, e.caseId, e.caseVersion, e.createdMs, validityMs, urgent, route, f, id, sharedCrypto)
        return Validation.check(n)
    }

    @Test fun legitimatePacketsOfEveryTypePass() {
        val a = phone(); val b = phone()
        val c = ok(a.engine.createRequest(urgentInput())); val pk = a.store.getPacket(c.packetId!!)!!
        assertNull(Validation.check(pk.env))
        b.store.putPacket(pk.copy(authored = false)); b.engine.receive(pk.env.wire(), Hop(1, 0, false, 3_600_000), a.id)
        val r = ok(b.engine.createReply(c.caseId!!, "offer", "I can come", "Gate 2"))
        assertNull(Validation.check(b.store.getPacket(r.packetId!!)!!.env))
        ok(a.engine.createBroadcast("hello", "Community", ""))
        a.store.packets().forEach { assertNull("${it.env.type}", Validation.check(it.env)) }
    }

    @Test fun rejectsBadRequestFields() {
        val a = phone(); val c = ok(a.engine.createRequest(urgentInput())); val e = a.store.getPacket(c.packetId!!)!!.env
        assertNotNull(mutate(e, a.identity, { it["kind"] = "weird".toByteArray() }))
        assertNotNull(mutate(e, a.identity, { it["category"] = "Gold".toByteArray() }))
        assertNotNull(mutate(e, a.identity, { it["title"] = ByteArray(0) }))
        assertNotNull(mutate(e, a.identity, { it["title"] = "x".repeat(Limits.MAX_TITLE + 1).toByteArray() }))
        assertNotNull(mutate(e, a.identity, { it["description"] = "bad\u0001control".toByteArray() }))
        assertNotNull(mutate(e, a.identity, { it["areaHood"] = "ZZ".toByteArray() }))
        assertNotNull(mutate(e, a.identity, { it["hasPrivate"] = "yes".toByteArray() }))
        assertNotNull(mutate(e, a.identity, { it["attachmentId"] = "nothex".toByteArray() }))
        assertNotNull(mutate(e, a.identity, { it.remove("nonce") }))
        assertNotNull("urgent validity capped at 2 h", mutate(e, a.identity, {}, validityMs = 121 * Limits.MINUTE_MS))
        assertNotNull(mutate(e, a.identity, {}, validityMs = 0))
        assertNotNull(mutate(e, a.identity, {}, route = e.route.copy(maxHops = 0)))
        assertNotNull(mutate(e, a.identity, {}, route = e.route.copy(maxHops = 200)))
        assertNotNull(mutate(e, a.identity, {}, route = e.route.copy(fanout = 99)))
        assertNotNull(mutate(e, a.identity, {}, route = e.route.copy(targets = listOf("QQ"))))
        assertNotNull(mutate(e, a.identity, {}, route = e.route.copy(policy = PolicyKind.DIRECTED, targets = emptyList())))
    }

    @Test fun caseIdCannotBeForgedForAnotherKey() {
        val a = phone(); val mallory = Identity.create(sharedCrypto)
        val c = ok(a.engine.createRequest(urgentInput())); val e = a.store.getPacket(c.packetId!!)!!.env
        // Mallory re-signs a renewal for Alice's case ID with her own key: caseId != H(mallory.pub, nonce) => invalid
        val forged = Envelope.build(PacketType.REQUEST, e.caseId, 1, e.createdMs, e.validityMs, e.urgent, e.route, e.fields, mallory, sharedCrypto)
        assertEquals("request.caseId", Validation.check(forged))
    }

    @Test fun otherTypesEnforceTheirOwnLimits() {
        val a = phone(); val b = ok(a.engine.createBroadcast("hello", "Community", "")); val e = a.store.getPacket(b.packetId!!)!!.env
        assertNotNull(mutate(e, a.identity, { it["text"] = "x".repeat(281).toByteArray() }))
        assertNotNull(mutate(e, a.identity, { it["category"] = "News".toByteArray() }))
        assertNotNull(mutate(e, a.identity, {}, validityMs = 61 * Limits.MINUTE_MS))
        val noCase = Envelope.build(PacketType.REPLY, null, 0, 0, 1000, false, e.route, mapOf("kind" to "offer".toByteArray()), a.identity, sharedCrypto)
        assertEquals("case.missing", Validation.check(noCase))
        val att = Envelope.build(PacketType.ATTACHMENT, ByteArray(16), 0, 0, 1000, false, e.route, mapOf("attachmentId" to "00".repeat(16).toByteArray(), "sha256" to "11".repeat(32).toByteArray(),
            "mime" to "image/jpeg".toByteArray(), "size" to "500".toByteArray(), "w" to "10".toByteArray(), "h" to "10".toByteArray()), a.identity, sharedCrypto)
        assertEquals("attachment.idMismatch", Validation.check(att))
    }
}

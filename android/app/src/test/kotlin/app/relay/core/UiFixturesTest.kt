package app.relay.core

import org.junit.Assert.*
import org.junit.Test
import java.io.File
import java.util.Base64

/** Produces REAL snapshots (from the real engine, real signatures, real link sessions) for the WebView adapter/UI tests. Output: app/build/fixtures/ui_fixtures.js */
class UiFixturesTest {
    private val clock = FakeClock()
    private fun jpeg(): ByteArray = fakeJpeg(2400, 21)   // valid JPEG magic + hash identity; the browser test substitutes a drawn image for display
    private fun snap(p: Phone, radio: RadioStatus = RadioStatus(true, true, true, true, true, true, true, listOf("a1b2c3d4"), 0, 0, "")) = Snapshot.build(p.engine, radio)

    @Test fun writeFixtures() {
        val photo = jpeg(); assertTrue(photo.size in 500..Limits.MAX_PHOTO_BYTES)
        val a = Phone("requester", clock, hood = "HK"); val b = Phone("volunteer", clock, hood = "GP"); val c = Phone("carrier", clock, hood = "LN")
        val req = ok(a.engine.createRequest(missingInput("CP", photo = photo).let { RequestInput("missing", "Missing", it.title, it.description, it.area, "CP", "Connaught Place", false, 1440, it.lastKnown, it.lastContact, "With her school group", null, "Flat 4B, Block C", "Blue gate", photo, 160, 120) }))
        val urg = ok(a.engine.createRequest(urgentInput(120, privB = "Flat 9, Lane 3", privD = "Ring the bell twice")))
        contact(a, b); contact(b, c)
        val rep = ok(b.engine.createReply(urg.caseId!!, "offer", "I am a nurse nearby, I can come now", "Gate 2")); contact(a, b)
        val fixtures = LinkedHashMap<String, String>(); val attachments = LinkedHashMap<String, String>()
        fixtures["requester_with_offer"] = snap(a)
        ok(a.engine.shareAddress(rep.packetId!!)); contact(a, b)
        fixtures["volunteer_with_address"] = snap(b); fixtures["relay_carrier"] = snap(c)
        // expired + renewed + resolved cases on the requester
        val old = ok(a.engine.createRequest(urgentInput(30))); clock.minutes(31)
        val ren = ok(a.engine.renewRequest(old.caseId!!, RenewInput(validityMin = 120, description = "Still needed, now in the courtyard")))
        val done = ok(a.engine.createRequest(RequestInput("urgent", "Shelter", "Shelter needed near the market", area = "Market", areaHood = "HK", areaHoodName = "Hauz Khas", urgent = false, validityMin = 360))); ok(a.engine.createResolve(done.caseId!!))
        fixtures["expired_renewed_resolved"] = snap(a)
        // forged ack/resolve from another key must not change status
        val m = Phone("mallory", clock, hood = "HK"); val v = Phone("victim", clock, hood = "HK"); val vr = ok(v.engine.createRequest(urgentInput(120)))
        val e = v.store.getPacket(vr.packetId!!)!!.env; val f1 = Envelope.build(PacketType.RESOLVE, e.caseId, 0, clock.nowMs(), 90 * Limits.MINUTE_MS, true, e.route, emptyMap(), m.identity, sharedCrypto)
        val reader = Phone("reader", clock, hood = "GP"); reader.engine.receive(e.wire(), Hop(1, 0, false, 3_600_000), v.id); reader.engine.receive(f1.wire(), Hop(1, 0, false, 3_600_000), m.id)
        fixtures["forged_resolve"] = snap(reader)
        // a phone that received the request but whose photo bytes never arrived (link dropped during the photo phase)
        val d = Phone("photo-pending", clock, hood = "GP")
        Pipe.run(a.engine, d.engine, tamperAtoB = { f -> if (f[0].toInt() == Frame.ATT_CHUNK) null else f })
        fixtures["photo_pending"] = snap(d)
        fixtures["empty_new_phone"] = Snapshot.build(Phone("new", clock, hood = null).let { p -> p.store.setSetting("hood", ByteArray(0)); p.store.setSetting("hoodName", ByteArray(0)); RelayEngine(MemoryStore(), sharedCrypto, p.identity, clock) }, RadioStatus(true, false, false, false, false, false, false, emptyList(), 0, 0, ""))
        // radio variants on the requester snapshot
        fixtures["radio_permission_missing"] = snap(a, RadioStatus(true, true, false, true, false, false, false))
        fixtures["radio_bluetooth_off"] = snap(a, RadioStatus(true, false, true, true, false, false, true))
        fixtures["radio_looking"] = snap(a, RadioStatus(true, true, true, false, true, false, true))
        fixtures["radio_peers"] = snap(a, RadioStatus(true, true, true, true, true, true, true, listOf("11223344", "55667788"), 1, clock.nowMs() - 5 * Limits.MINUTE_MS, ""))
        val dg = Diagnostics(clock = { clock.nowMs() }); dg.count("sightings", 5); dg.peerSeen("a1b2"); dg.count("connectAttempts", 2); dg.count("connectionsEstablished", 1); dg.count("sessionsCompleted", 1)
        dg.count("packetsConfirmedStoredByPeer", 3); dg.count("packetsStoredFromPeer", 2); dg.event("found a Relay phone (id a1b2)"); dg.event("problem: Scan failed (2)")
        fixtures["radio_diag"] = snap(a, RadioStatus(true, true, true, true, true, true, true, listOf("a1b2c3d4"), 0, clock.nowMs() - 60_000, "Scan failed (2)", dg.toJson()))
        fixtures["radio_unsupported"] = snap(a, RadioStatus(false, false, false, false, false, false, false))
        val aid = a.store.attachments().first { it.authored }.id
        attachments[aid] = "data:image/jpeg;base64," + Base64.getEncoder().encodeToString(a.store.attachmentBytes(aid)!!)
        val meta = mapOf("requesterReplyId" to rep.packetId!!, "urgentCase" to urg.caseId!!, "missingCase" to req.caseId!!, "oldCase" to old.caseId!!, "doneCase" to done.caseId!!, "attachmentId" to aid,
            "victimCase" to vr.caseId!!, "requesterId" to a.id, "volunteerId" to b.id)
        val js = StringBuilder("window.__FIX=").append(JsonObj().raw("snapshots", "{" + fixtures.entries.joinToString(",") { Json.esc(it.key) + ":" + it.value } + "}")
            .raw("attachments", "{" + attachments.entries.joinToString(",") { Json.esc(it.key) + ":" + Json.esc(it.value) } + "}")
            .raw("meta", "{" + meta.entries.joinToString(",") { Json.esc(it.key) + ":" + Json.esc(it.value) } + "}").end()).append(";")
        val dir = File("build/fixtures"); dir.mkdirs(); File(dir, "ui_fixtures.js").writeText(js.toString())
        assertTrue(File(dir, "ui_fixtures.js").length() > 10_000)
    }
}

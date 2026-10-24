package app.relay.core

import org.junit.Assert.*
import org.junit.Test
import java.io.File

/** Real-engine snapshots for the inbox UI tests (tests/android_ui/inbox_test.html). Output: app/build/fixtures/inbox_fixtures.js */
class InboxFixturesTest {
    private val clock = FakeClock()
    private fun hop(ms: Long = 24 * 60 * Limits.MINUTE_MS) = Hop(1, 0, false, ms)
    private fun give(from: Phone, to: Phone, id: String) = to.engine.receive(from.store.getPacket(id)!!.env.wire(), hop(), from.id)
    private fun snap(p: Phone) = Snapshot.build(p.engine, RadioStatus(true, true, true, true, true, true, true, listOf("a1b2c3d4"), 0, 0, ""))
    private fun req(kind: String, cat: String, title: String, desc: String, area: String, hood: String?, hoodName: String, urgent: Boolean, validity: Int, last: String = "") =
        RequestInput(kind, cat, title, desc, area, hood, hoodName, urgent, validity, last, if (last.isEmpty()) "" else "Earlier today")

    @Test fun writeInboxFixtures() {
        val fx = LinkedHashMap<String, String>(); val meta = LinkedHashMap<String, String>()
        val r = Phone("requester", clock, hood = "HK"); val me = Phone("me", clock, hood = "GP"); val o = Phone("other", clock, hood = "LN")
        // t0: an urgent medical request (30 min), a missing-person request (24 h), a community update (45 min)
        val med = ok(r.engine.createRequest(req("urgent", "Medical", "Medical help needed near the gate", "Elderly neighbour collapsed, needs a doctor", "Gate 2", "HK", "Hauz Khas", true, 30)))
        val mis = ok(r.engine.createRequest(req("missing", "Missing", "Looking for Meera", "Red school bag, blue uniform", "Metro gate", "LC", "Lodhi Colony", false, 1440, "Metro gate, Lodhi Colony")))
        val upd = ok(o.engine.createBroadcast("Water is available at the Green Park market entrance", "Resources", "Green Park market"))
        give(r, me, med.packetId!!); give(r, me, mis.packetId!!); give(o, me, upd.packetId!!)
        clock.minutes(40)                                                    // the medical request has now expired (10 minutes ago); the update has 5 minutes left
        fx["inbox_s1"] = snap(me)
        // a few minutes later: a NEW medical request in Lodhi Colony, and the missing-person request is renewed with new words
        clock.minutes(2)
        val med2 = ok(r.engine.createRequest(req("urgent", "Medical", "Insulin needed urgently near Lodhi Road", "Diabetic neighbour has run out of insulin", "Lodhi Road clinic lane", "LC", "Lodhi Colony", true, 120)))
        val ren = ok(r.engine.renewRequest(mis.caseId!!, RenewInput(description = "Last seen wearing a yellow raincoat")))
        give(r, me, med2.packetId!!); give(r, me, ren.packetId!!)
        fx["inbox_s2"] = snap(me)
        // the requester's side: one offer arrives, then a second one for the SAME request
        val q = Phone("requester2", clock, hood = "HK"); val v1 = Phone("volunteer1", clock, hood = "GP"); val v2 = Phone("volunteer2", clock, hood = "LN")
        val qm = ok(q.engine.createRequest(req("urgent", "Medical", "Medical help needed near the market", "Someone has a deep cut", "Market lane", "HK", "Hauz Khas", true, 120)))
        give(q, v1, qm.packetId!!); give(q, v2, qm.packetId!!)
        val o1 = ok(v1.engine.createReply(qm.caseId!!, "offer", "I am a nurse nearby and can come now", "Market gate")); give(v1, q, o1.packetId!!)
        fx["inbox_r1"] = snap(q)
        clock.minutes(5)
        val o2 = ok(v2.engine.createReply(qm.caseId!!, "offer", "I have a first-aid kit and a car", "Lane 4")); give(v2, q, o2.packetId!!)
        fx["inbox_r2"] = snap(q)
        // many messages: nothing may become one uninterrupted list
        val big = Phone("big", clock, hood = "GP"); val cats = listOf("Medical", "Rescue", "Food & water", "Shelter", "Medical", "Rescue", "Food & water", "Shelter", "Medical", "Rescue", "Food & water", "Shelter")
        cats.forEachIndexed { i, c -> val x = ok(r.engine.createRequest(req("urgent", c, "$c request number ${i + 1} near the park", "Details ${i + 1}", "Park lane ${i + 1}", "HK", "Hauz Khas", i % 3 == 0, if (i % 3 == 0) 120 else 360))); give(r, big, x.packetId!!); clock.minutes(1) }
        (1..8).forEach { i -> val b = ok(o.engine.createBroadcast("Community notice $i: tea at the hall", "Community", "Hall $i")); give(o, big, b.packetId!!); clock.minutes(1) }
        fx["inbox_many"] = snap(big)
        meta["med"] = med.caseId!!; meta["medPkt"] = med.packetId!!; meta["mis"] = mis.caseId!!; meta["misPkt"] = mis.packetId!!; meta["upd"] = upd.packetId!!
        meta["med2"] = med2.caseId!!; meta["med2Pkt"] = med2.packetId!!; meta["renPkt"] = ren.packetId!!
        meta["qm"] = qm.caseId!!; meta["o1"] = o1.packetId!!; meta["o2"] = o2.packetId!!
        val js = "Object.assign(window.__FIX.snapshots,{" + fx.entries.joinToString(",") { Json.esc(it.key) + ":" + it.value } + "});window.__INBOX=" + "{" + meta.entries.joinToString(",") { Json.esc(it.key) + ":" + Json.esc(it.value) } + "};"
        val dir = File("build/fixtures"); dir.mkdirs(); File(dir, "inbox_fixtures.js").writeText(js)
        assertTrue(File(dir, "inbox_fixtures.js").length() > 5_000)
    }
}

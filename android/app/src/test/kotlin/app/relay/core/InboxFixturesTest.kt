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
        // mixed unread messages: open ones (urgent+close, urgent+far, ordinary+close) must outrank expired / resolved ones, even though the expired ones arrived later
        val mx = Phone("mixed", clock, hood = "GP"); val mr = Phone("mixedRequester", clock, hood = "HK"); val mo = Phone("mixedOther", clock, hood = "LN")
        val mxN = ok(mr.engine.createRequest(req("urgent", "Food & water", "Food packets needed for a family", "Three children, no food since morning", "Lane 3", "HK", "Hauz Khas", false, 360)))
        val mxUF = ok(mo.engine.createRequest(req("urgent", "Rescue", "Boat needed near the bridge", "Water rising", "Bridge road", "CP", "Connaught Place", true, 120)))
        give(mr, mx, mxN.packetId!!); give(mo, mx, mxUF.packetId!!); clock.minutes(3)
        val mxRS = ok(mr.engine.createRequest(req("urgent", "Shelter", "Shelter for two people tonight", "Roof collapsed", "Lane 9", "HK", "Hauz Khas", false, 360)))
        give(mr, mx, mxRS.packetId!!); val mxRes = ok(mr.engine.createResolve(mxRS.caseId!!)); give(mr, mx, mxRes.packetId!!)
        val mxEU = ok(mr.engine.createRequest(req("urgent", "Medical", "Medical help needed near the clinic gate", "Elderly neighbour collapsed", "Clinic gate", "HK", "Hauz Khas", true, 30)))
        val mxEN = ok(mo.engine.createRequest(req("urgent", "Shelter", "Blankets needed at the hall", "Cold night", "Community hall", "LN", "Lajpat Nagar", false, 30)))
        val mxEB = ok(mo.engine.createBroadcast("Tea is available at the hall", "Resources", "Community hall"))
        give(mr, mx, mxEU.packetId!!); give(mo, mx, mxEN.packetId!!); give(mo, mx, mxEB.packetId!!)
        clock.minutes(52)                                                    // the 30/45-minute messages have expired (but are still stored: eviction is 30 minutes after expiry); the open ones are still open
        val mxUN = ok(mr.engine.createRequest(req("urgent", "Medical", "Insulin needed urgently near Green Park", "Diabetic neighbour has run out", "Green Park main road", "GP", "Green Park", true, 120)))
        give(mr, mx, mxUN.packetId!!)
        fx["inbox_mixed"] = snap(mx)
        meta["mxUN"] = mxUN.caseId!!; meta["mxUF"] = mxUF.caseId!!; meta["mxN"] = mxN.caseId!!; meta["mxEU"] = mxEU.caseId!!; meta["mxEN"] = mxEN.caseId!!; meta["mxRS"] = mxRS.caseId!!; meta["mxEB"] = mxEB.packetId!!
        // what the phone can say about a sender: only the area that phone declared (or nothing at all)
        val sq = Phone("senderRequester", clock, hood = "HK"); val sgp = Phone("senderGP", clock, hood = "GP"); val slc = Phone("senderLC", clock, hood = "LC"); val sno = Phone("senderNoArea", clock, hood = null)
        val sh = ok(sq.engine.createRequest(req("urgent", "Medical", "Help with a wound near the lane", "Deep cut on a hand", "Lane 5", "HK", "Hauz Khas", true, 120)))
        val sm = ok(sq.engine.createRequest(req("missing", "Missing", "Looking for Arjun", "Grey jacket", "Metro gate", "HK", "Hauz Khas", false, 1440, "Metro gate, Hauz Khas")))
        sno.store.setSetting("hood", ByteArray(0)); sno.store.setSetting("hoodName", ByteArray(0))        // this phone never declared an area
        listOf(sgp, slc, sno).forEach { give(sq, it, sh.packetId!!); give(sq, it, sm.packetId!!) }
        val shGp = ok(sgp.engine.createReply(sh.caseId!!, "offer", "I can bring a first-aid kit", "Lane 4")); val shNo = ok(sno.engine.createReply(sh.caseId!!, "offer", "I am a few streets away", ""))
        val smLc = ok(slc.engine.createReply(sm.caseId!!, "sighting", "A boy in a grey jacket near the metro stairs", "Metro stairs"))
        listOf(shGp, shNo).forEach { give(if (it === shGp) sgp else sno, sq, it.packetId!!) }; give(slc, sq, smLc.packetId!!)
        fx["inbox_senders"] = snap(sq)
        meta["sh"] = sh.caseId!!; meta["sm"] = sm.caseId!!; meta["shGp"] = shGp.packetId!!; meta["shNo"] = shNo.packetId!!; meta["smLc"] = smLc.packetId!!
        meta["med"] = med.caseId!!; meta["medPkt"] = med.packetId!!; meta["mis"] = mis.caseId!!; meta["misPkt"] = mis.packetId!!; meta["upd"] = upd.packetId!!
        meta["med2"] = med2.caseId!!; meta["med2Pkt"] = med2.packetId!!; meta["renPkt"] = ren.packetId!!
        meta["qm"] = qm.caseId!!; meta["o1"] = o1.packetId!!; meta["o2"] = o2.packetId!!
        val js = "Object.assign(window.__FIX.snapshots,{" + fx.entries.joinToString(",") { Json.esc(it.key) + ":" + it.value } + "});window.__INBOX=" + "{" + meta.entries.joinToString(",") { Json.esc(it.key) + ":" + Json.esc(it.value) } + "};"
        val dir = File("build/fixtures"); dir.mkdirs(); File(dir, "inbox_fixtures.js").writeText(js)
        assertTrue(File(dir, "inbox_fixtures.js").length() > 5_000)
    }
}

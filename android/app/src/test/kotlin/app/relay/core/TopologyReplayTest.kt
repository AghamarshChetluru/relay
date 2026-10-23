package app.relay.core

import org.junit.Assert.*
import org.junit.Test

/**
 * Replays the browser prototype's 80-phone contact graph with REAL Kotlin engines, real signatures and real link sessions.
 * It checks the routing properties on independent phones. Contacts are idealised (every edge meets once a minute): this is
 * protocol-logic evidence, not Bluetooth range or timing evidence.
 */
class TopologyReplayTest {
    @Suppress("UNCHECKED_CAST")
    private fun topo() = (ParityTest.fx["topology"] as Map<String, Any?>)

    private class World(val phones: Map<String, Phone>, val edges: List<Pair<String, String>>, val clock: FakeClock) {
        fun round() {
            clock.minutes(1)
            phones.values.forEach { it.engine.confirmHood() }           // the other (simulated) people keep confirming their area
            edges.forEach { (a, b) -> contact(phones[a]!!, phones[b]!!) }
        }
    }

    private fun world(bridgeInstalled: Boolean = true): Pair<World, Map<String, Any?>> {
        val t = topo(); val clock = FakeClock(); val keys = t["keys"] as Map<*, *>; val d = keys["D"] as String
        val nodes = (t["nodes"] as List<*>).map { it as Map<*, *> }
        val phones = HashMap<String, Phone>()
        for (n in nodes) { val id = n["id"] as String; val has = n["hasApp"] as Boolean || (bridgeInstalled && id == d); if (has) phones[id] = Phone(id, clock, hood = n["hood"] as String) }
        val edges = (t["edges"] as List<*>).map { (it as List<*>).let { e -> (e[0] as String) to (e[1] as String) } }.filter { phones.containsKey(it.first) && phones.containsKey(it.second) }
        return World(phones, edges, clock) to t
    }

    @Test fun missingPersonRoutingNeverGetsStuckAndSpreadsLessThanFlooding() {
        val (w, _) = world(); val ids = w.phones.keys.sorted()
        val sources = ids.filterIndexed { i, _ -> i % 5 == 0 }.take(12)
        val targets = listOf("CP", "LC", "VV", "JS")
        data class Run(val src: String, val tg: String, val dir: String, val fl: String)
        val runs = ArrayList<Run>()
        for (s in sources) for (tg in targets) {
            val dir = ok(w.phones[s]!!.engine.createRequest(missingInput(tg).let { RequestInput("missing", "Missing", it.title + " $s$tg", area = "x", areaHood = tg, areaHoodName = Neighborhoods.nameOf(tg), validityMin = 1440) }))
            val fl = ok(w.phones[s]!!.engine.createRequest(RequestInput("urgent", "Medical", "Flood $s$tg", area = "x", areaHood = tg, areaHoodName = "x", urgent = true, validityMin = 120)))
            runs.add(Run(s, tg, dir.packetId!!, fl.packetId!!))
        }
        fun holders(id: String) = w.phones.values.filter { it.has(id) }
        val firstD = HashMap<String, Int>(); val firstF = HashMap<String, Int>()
        repeat(100) {
            w.round()
            for (r in runs) {
                if (r.dir !in firstD && holders(r.dir).any { it.engine.hoodState().id == r.tg }) firstD[r.dir] = holders(r.dir).size
                if (r.fl !in firstF && holders(r.fl).any { it.engine.hoodState().id == r.tg }) firstF[r.fl] = holders(r.fl).size
            }
        }
        var stuck = 0; var possible = 0; var dSum = 0; var fSum = 0
        for (r in runs) {
            val fh = holders(r.fl); val dh = holders(r.dir)
            val floodReaches = fh.any { Neighborhoods.distance(it.engine.hoodState().id, r.tg) == 0 }
            if (floodReaches) { possible++; if (dh.none { it.engine.hoodState().id == r.tg }) stuck++ }
            dSum += dh.size; fSum += fh.size
        }
        val both = runs.filter { it.dir in firstD && it.fl in firstF }
        val dFirst = both.sumOf { firstD[it.dir]!! }.toDouble() / both.size; val fFirst = both.sumOf { firstF[it.fl]!! }.toDouble() / both.size
        println("TOPOLOGY REPLAY: runs=${runs.size} possible=$possible stuck=$stuck finalDirected=${dSum / runs.size} finalFlood=${fSum / runs.size} phonesCarryingAtFirstDelivery directed=${"%.1f".format(dFirst)} flood=${"%.1f".format(fFirst)}")
        assertTrue("replay must exercise real cases", possible >= 40)
        assertEquals("no source/target pair may be permanently stuck", 0, stuck)
        assertTrue("cost to first reach the target: directed ($dFirst) must be below flooding ($fFirst)", dFirst < fFirst)
        assertTrue("final spread must not exceed flooding", dSum <= fSum)
    }

    @Test fun withoutTheBridgePhoneTheTwoHalvesStayApartAndAfterItJoinsTheyConnect() {
        val (w0, t) = world(bridgeInstalled = false); val keys = t["keys"] as Map<*, *>; val a = keys["A"] as String; val e = keys["E"] as String
        val req = ok(w0.phones[a]!!.engine.createRequest(urgentInput(120)))
        repeat(60) { w0.round() }
        assertFalse("gap: E is cut off while the crossroads phone has no Relay", w0.phones[e]!!.has(req.packetId!!))
        assertTrue("but A's side did receive it", w0.phones.values.count { it.has(req.packetId!!) } > 10)
        val (w1, _) = world(bridgeInstalled = true); val req1 = ok(w1.phones[a]!!.engine.createRequest(urgentInput(120)))
        repeat(60) { w1.round() }
        assertTrue("after the bridge phone installs Relay the request crosses", w1.phones[e]!!.has(req1.packetId!!))
        val reply = ok(w1.phones[e]!!.engine.createReply(req1.caseId!!, "offer", "I can come", "")); repeat(60) { w1.round() }
        assertTrue("and the offer returns to the requester", w1.phones[a]!!.has(reply.packetId!!))
    }

    @Test fun invariantsHoldAcrossTheWholeWorldAfterHeavyTraffic() {
        val (w, _) = world(); val ids = w.phones.keys.sorted()
        for ((i, s) in ids.withIndex()) if (i % 7 == 0) { w.phones[s]!!.engine.createBroadcast("update from $s", "Community", ""); if (i % 14 == 0) w.phones[s]!!.engine.createRequest(urgentInput()) }
        repeat(80) { w.round() }
        for (p in w.phones.values) {
            val seenIds = HashSet<String>()
            for (sp in p.store.packets()) {
                assertTrue("one stored copy per packet", seenIds.add(sp.id))
                assertTrue("hop budget respected", sp.hops <= sp.env.route.maxHops)
                assertNull("every stored packet is valid", Validation.check(sp.env))
                assertTrue("signature valid", sharedCrypto.verify(sp.env.origin, sp.env.signature, sp.env.signedBody()))
                assertTrue("never outlives its signed validity", sp.expiresMs - sp.receivedMs <= sp.env.validityMs)
            }
            assertTrue(p.store.packets().count { !it.authored } <= Limits.MAX_STORED_PACKETS)
        }
        for (p in w.phones.values) for (sp in p.store.packets()) for (peer in w.phones.values) if (p.store.hasSentTo(sp.id, peer.id))
            assertTrue("a sender only records 'shared with a peer' if that peer really stored it", peer.has(sp.id) || peer.store.isSeen(sp.id))
    }
}

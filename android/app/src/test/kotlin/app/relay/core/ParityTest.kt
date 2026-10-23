package app.relay.core

import org.junit.Assert.*
import org.junit.Test

/** The Kotlin port must agree with prototype/mesh.js on every shared constant and on the neighbourhood graph. The fixture is generated from mesh.js. */
class ParityTest {
    companion object {
        @Suppress("UNCHECKED_CAST")
        val fx: Map<String, Any?> by lazy { Json.parse(ParityTest::class.java.getResource("/parity.json")!!.readText(), maxDepth = 12, maxLen = 5_000_000) as Map<String, Any?> }
        fun num(m: Any?, k: String): Long = ((m as Map<*, *>)[k] as Number).toLong()
    }

    @Test fun neighbourhoodsEdgesAndAllPairDistancesMatchTheBrowserEngine() {
        val hs = (fx["neighborhoods"] as List<*>).map { it as Map<*, *> }
        assertEquals(hs.map { it["id"] as String to it["name"] as String }, Neighborhoods.all)
        val edges = (fx["edges"] as List<*>).map { (it as List<*>).let { e -> e[0] as String to e[1] as String } }
        assertEquals(edges, Neighborhoods.edges)
        val d = fx["distances"] as Map<*, *>
        var checked = 0
        for ((a, row) in d) for ((b, v) in (row as Map<*, *>)) { assertEquals("$a->$b", (v as Number).toInt(), Neighborhoods.distance(a as String, b as String)); checked++ }
        assertEquals(100, checked)
    }

    @Test fun routingBudgetsValidityAndTimeConstantsMatch() {
        val r = fx["route"]; val c = PolicyConfig()
        assertEquals(num(r, "floodHops").toInt(), c.floodHops); assertEquals(num(r, "broadcastHops").toInt(), c.broadcastHops); assertEquals(num(r, "directedHops").toInt(), c.directedHops)
        assertEquals(num(r, "directedFanout").toInt(), c.directedFanout); assertEquals(num(r, "detourMax").toInt(), c.detourMax); assertEquals(num(r, "detourAway").toInt(), c.detourAway)
        assertEquals(num(r, "patience") * Limits.MINUTE_MS, c.patienceMs); assertEquals(num(r, "patientExtra").toInt(), c.patientExtra)
        assertEquals(num(r, "oppHops").toInt(), c.oppHops); assertEquals(num(r, "oppFanout").toInt(), c.oppFanout)
        val v = fx["validity"] as Map<*, *>
        assertEquals((v["urgentOptions"] as List<*>).map { (it as Number).toLong() }, listOf(30L, 60L, 120L)); assertEquals(120L * Limits.MINUTE_MS, Validation.MAX_URGENT_MS)
        assertEquals(num(v, "general") * Limits.MINUTE_MS, Validation.MAX_GENERAL_MS); assertEquals(num(v, "missing") * Limits.MINUTE_MS, Validation.MAX_MISSING_MS)
        assertEquals(num(fx, "remind") * Limits.MINUTE_MS, c.remindMs); assertEquals(num(fx, "stale") * Limits.MINUTE_MS, c.staleMs); assertEquals(num(fx, "evictGrace") * Limits.MINUTE_MS, RelayEngine.EVICT_GRACE_MS)
        val ttl = fx["ttl"]; assertEquals(num(ttl, "broadcast") * Limits.MINUTE_MS, Validation.MAX_BROADCAST_MS - 15 * Limits.MINUTE_MS); assertEquals(num(ttl, "reply") * Limits.MINUTE_MS, 90 * Limits.MINUTE_MS)
        assertEquals(num(fx, "maxBroadcast").toInt(), Limits.MAX_BROADCAST_TEXT)
    }
}

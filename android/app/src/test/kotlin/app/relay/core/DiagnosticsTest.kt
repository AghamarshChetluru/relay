package app.relay.core

import org.junit.Assert.*
import org.junit.Test

class DiagnosticsTest {
    private var t = 1_000_000L
    private fun d(cap: Int = 5) = Diagnostics(cap, { t })

    @Test fun countersAccumulateAndDistinctPeersAreDeduplicated() {
        val g = d(); g.count("sightings"); g.count("sightings", 4); assertEquals(5, g.counter("sightings")); assertEquals(0, g.counter("never"))
        assertTrue(g.peerSeen("ab12")); assertFalse(g.peerSeen("ab12")); assertTrue(g.peerSeen("cd34")); assertEquals(2, g.counter("distinctPeersSeen"))
    }

    @Test fun eventLogIsBoundedAndKeepsTheNewest() {
        val g = d(3); (1..10).forEach { t += 1000; g.event("e$it") }
        assertEquals(listOf("e8", "e9", "e10"), g.snapshotEvents().map { it.text })
    }

    @Test fun identicalNeighbouringEventsCollapseWithARepeatCount() {
        val g = d(); repeat(50) { g.event("problem: Bluetooth is off") }; g.event("other")
        assertEquals(2, g.snapshotEvents().size); assertEquals(50, g.snapshotEvents()[0].repeats)
    }

    @Test fun jsonIsValidNewestFirstAndEscapesText() {
        val g = d(); g.count("errors", 2); g.event("first"); t += 5000; g.event("quote \" and \\ slash")
        val o = Json.parse(g.toJson()) as Map<*, *>
        assertEquals(2.0, ((o["counters"] as Map<*, *>)["errors"] as Number).toDouble(), 0.0)
        val ev = o["events"] as List<*>; assertEquals("quote \" and \\ slash", (ev[0] as Map<*, *>)["text"]); assertEquals("first", (ev[1] as Map<*, *>)["text"])
    }

    @Test fun reportContainsHeaderCountersAndEventsAndNothingElse() {
        val g = d(); g.count("packetsConfirmedStoredByPeer", 3); g.event("exchange finished: 3 of ours confirmed stored by the other phone")
        val r = g.report(listOf("Phone: Test Model", "Android: 14 (API 34)"), t + 7000)
        assertTrue(r.contains("Phone: Test Model")); assertTrue(r.contains("packetsConfirmedStoredByPeer = 3")); assertTrue(r.contains("-7s  exchange finished"))
        assertTrue(r.contains("no message text, addresses or keys"))
    }

    @Test fun overlongEventTextIsTruncated() { val g = d(); g.event("x".repeat(5000)); assertEquals(160, g.snapshotEvents()[0].text.length) }

    @Test fun theSinkReceivesEveryEventSoItCanGoToLogcat() { val got = ArrayList<String>(); val g = Diagnostics(5, { t }, { got.add(it) }); g.event("a"); g.event("a"); assertEquals(listOf("a", "a"), got) }

    /** A real exchange between two engines must put nothing private into diagnostics: only the counts. */
    @Test fun nothingPrivateCanAppearBecauseEventsAreFixedPhrasesPlusAFourCharTag() {
        val a = Phone("p", FakeClock(), hood = "HK"); val rq = ok(a.engine.createRequest(urgentInput(privB = "Flat 4B Secret Apartments", privD = "blue gate")))
        val g = d(); g.event("found a Relay phone (id ab12)"); g.event("exchange finished: 1 of ours confirmed stored by the other phone, 0 new stored from it, 0 already had, 0 rejected, 0 photos")
        val all = g.report(listOf("Phone: X")) + g.toJson()
        assertFalse(all.contains("Secret")); assertFalse(all.contains("blue gate")); assertFalse(all.contains(rq.packetId!!)); assertFalse(all.contains(a.engine.identity.deviceId))
    }
}

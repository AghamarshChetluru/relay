package app.relay.core

import org.junit.Assert.*
import org.junit.Test

class FramingJsonSnapshotTest {
    private val clock = FakeClock()

    @Test fun fragmentedStreamReassemblesIncludingByteAtATimeDelivery() {
        val frames = listOf(ByteArray(1) { 7 }, ByteArray(500) { it.toByte() }, ByteArray(Limits.MAX_FRAME_BYTES) { (it * 3).toByte() })
        val stream = frames.map { Framing.encode(it) }.reduce { a, b -> a + b }
        for (payload in listOf(20, 23, 100, 244)) {
            val asm = StreamAssembler(); val got = ArrayList<ByteArray>()
            Framing.fragment(stream, payload).forEach { got.addAll(asm.feed(it)) }
            assertEquals(3, got.size); frames.indices.forEach { assertArrayEquals(frames[it], got[it]) }; assertFalse(asm.broken)
        }
        val asm = StreamAssembler(); val got = ArrayList<ByteArray>(); stream.forEach { got.addAll(asm.feed(byteArrayOf(it))) }; assertEquals(3, got.size)
    }

    @Test fun assemblerRejectsZeroAndOversizedLengthsAndNeverBuffersUnbounded() {
        assertTrue(StreamAssembler().also { it.feed(byteArrayOf(0, 0)) }.broken)
        assertTrue(StreamAssembler().also { it.feed(byteArrayOf(0xFF.toByte(), 0xFF.toByte(), 1)) }.broken)
        val asm = StreamAssembler(); asm.feed(Writer().u16(Limits.MAX_FRAME_BYTES).toByteArray()); repeat(50) { asm.feed(ByteArray(200)) }
        assertTrue("after the one allowed maximum-size frame, further garbage is refused", asm.broken)
        assertEquals(emptyList<ByteArray>(), StreamAssembler().also { it.feed(byteArrayOf(0, 0)) }.feed(Framing.encode(byteArrayOf(1))))
        assertThrows(IllegalArgumentException::class.java) { Framing.encode(ByteArray(Limits.MAX_FRAME_BYTES + 1)) }
    }

    @Test fun jsonRoundTripAndHostileInput() {
        val s = "line1\nquote\" back\\ tab\t unicode ✓ \u0001"
        assertEquals(s, Json.parse(Json.esc(s)))
        val m = Json.parse("""{"a":[1,2.5,true,null,"x"],"b":{"c":"d"},"n":-5}""") as Map<*, *>
        assertEquals(listOf(1L, 2.5, true, null, "x"), m["a"]); assertEquals(-5L, m["n"]); assertEquals("d", (m["b"] as Map<*, *>)["c"])
        for (bad in listOf("{", "[1,", "{\"a\"}", "tru", "\"abc", "{\"a\":1} x", "[" .repeat(50) + "]".repeat(50), "{'a':1}"))
            assertThrows("should reject: $bad", WireException::class.java) { Json.parse(bad) }
        assertThrows(WireException::class.java) { Json.parse("[" + "1,".repeat(100_000) + "1]") }
    }

    @Test fun snapshotHoldsOnlyThisPhonesStateAndNeverLeaksPrivateOrSealedData() {
        val a = Phone("a", clock, hood = "HK"); val b = Phone("b", clock, hood = "GP")
        val c = ok(a.engine.createRequest(urgentInput(privB = "Flat 4B, Block C", privD = "Blue gate")))
        contact(a, b); val rep = ok(b.engine.createReply(c.caseId!!, "offer", "coming", "Gate 2")); contact(a, b)
        ok(a.engine.shareAddress(rep.packetId!!)); contact(a, b)
        val sa = Snapshot.build(a.engine, RadioStatus()); val sb = Snapshot.build(b.engine, RadioStatus(bluetoothEnabled = true))
        val ja = Json.parse(sa) as Map<*, *>; val jb = Json.parse(sb) as Map<*, *>
        assertTrue("requester's own snapshot carries its private address", (ja["privateAddr"] as Map<*, *>).containsKey(c.caseId))
        assertFalse("the volunteer's snapshot has no private address table entry", (jb["privateAddr"] as Map<*, *>).containsKey(c.caseId))
        assertTrue("volunteer opened the sealed address", sb.contains("Flat 4B, Block C")); assertTrue(sb.contains("\"opened\":true"))
        val carrier = Phone("c", clock, hood = "LN"); contact(b, carrier); contact(a, carrier)
        val sc = Snapshot.build(carrier.engine, RadioStatus())
        assertFalse("a relaying phone's UI state never contains the address", sc.contains("Flat 4B") || sc.contains("Blue gate"))
        assertFalse("nor the sealed ciphertext field", sc.contains("\"sealed\""))
        assertEquals(a.id, ((ja["me"] as Map<*, *>)["id"])); assertTrue((ja["packets"] as List<*>).isNotEmpty())
        assertEquals("a brand-new phone starts empty (no seeded fiction)", 0, (Json.parse(Snapshot.build(Phone("n", clock).engine, RadioStatus())) as Map<*, *>).let { (it["packets"] as List<*>).size })
    }
}

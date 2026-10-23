package app.relay.core

import org.junit.Assert.*
import org.junit.Test

/** The behaviour every [Store] must have. Run against MemoryStore on the JVM and against SqliteStore on a device/emulator. */
abstract class StoreContract {
    abstract fun newStore(): Store
    private val clock = FakeClock()
    private fun packet(store: Store): Pair<StoredPacket, Phone> {
        val a = Phone("a", clock); val o = ok(a.engine.createRequest(urgentInput())); return a.store.getPacket(o.packetId!!)!! to a
    }

    @Test fun packetsRoundTripAndDuplicatesAreRefused() {
        val s = newStore(); val (p, _) = packet(s)
        assertTrue(s.putPacket(p)); assertFalse("same ID twice", s.putPacket(p))
        val back = s.getPacket(p.id)!!
        assertEquals(p.id, back.id); assertArrayEquals(p.env.wire(), back.env.wire()); assertEquals(p.hops, back.hops); assertEquals(p.expiresMs, back.expiresMs); assertEquals(p.authored, back.authored)
        assertEquals(1, s.packets().size); assertEquals(1, s.packetsForCase(p.env.caseHex!!).size); assertTrue(s.packetsForCase("00".repeat(16)).isEmpty())
        s.deletePacket(p.id); assertNull(s.getPacket(p.id)); assertEquals(0, s.packets().size)
    }
    @Test fun seenTombstonesAndOriginRates() {
        val s = newStore(); s.markSeen("aa", 1000); assertTrue(s.isSeen("aa")); assertFalse(s.isSeen("bb"))
        s.purgeSeen(2000); assertFalse("expired tombstone purged", s.isSeen("aa"))
        s.noteOrigin("o", 100); s.noteOrigin("o", 500); assertEquals(1, s.originCount("o", 300)); assertEquals(2, s.originCount("o", 0))
    }
    @Test fun sentReceiptsCountPerPeerAndTrackLastGoodHandoff() {
        val s = newStore(); assertEquals(SentCounts(0, 0, 0, 0), s.sentCounts("p"))
        s.recordSent("p", "peer1", 10, false); s.recordSent("p", "peer2", 20, true); s.recordSent("p", "peer1", 99, false)
        assertEquals(SentCounts(2, 1, 1, 10), s.sentCounts("p")); assertTrue(s.hasSentTo("p", "peer2")); assertFalse(s.hasSentTo("p", "peer3"))
    }
    @Test fun attachmentsAppendContiguouslyResumeAndReset() {
        val s = newStore(); val data = fakeJpeg(3000)
        s.putAttachmentMeta(AttachmentMeta("a1", "c".repeat(32), 3000, sha256(data).hex(), 10, 10, false, 0, false))
        assertFalse("gap", s.appendAttachment("a1", 100, data.copyOfRange(100, 200))); assertTrue(s.appendAttachment("a1", 0, data.copyOfRange(0, 1000)))
        assertEquals(1000, s.getAttachmentMeta("a1")!!.received); assertFalse("overlap", s.appendAttachment("a1", 500, data.copyOfRange(500, 1500)))
        assertTrue(s.appendAttachment("a1", 1000, data.copyOfRange(1000, 3000))); assertFalse("too long", s.appendAttachment("a1", 3000, ByteArray(1)))
        s.completeAttachment("a1"); assertTrue(s.getAttachmentMeta("a1")!!.complete); assertArrayEquals(data, s.attachmentBytes("a1")); assertEquals(3000L, s.attachmentStoreBytes())
        s.resetAttachment("a1"); assertFalse(s.getAttachmentMeta("a1")!!.complete); assertEquals(0, s.getAttachmentMeta("a1")!!.received); assertEquals(0, s.attachmentBytes("a1")!!.size)
        s.deleteAttachment("a1"); assertNull(s.getAttachmentMeta("a1"))
    }
    @Test fun settingsFlagsAndPrivateAddress() {
        val s = newStore(); assertNull(s.getSetting("k")); s.setSetting("k", byteArrayOf(1, 2)); s.setSetting("k", byteArrayOf(3)); assertArrayEquals(byteArrayOf(3), s.getSetting("k"))
        s.setFlag("hidden", "x"); s.setFlag("hidden", "x"); s.setFlag("hidden", "y"); assertEquals(setOf("x", "y"), s.flags("hidden")); assertTrue(s.hasFlag("hidden", "x")); assertFalse(s.hasFlag("other", "x"))
        assertNull(s.getPrivateAddress("c")); s.putPrivateAddress("c", "Flat 4B", "Blue gate"); assertEquals("Flat 4B" to "Blue gate", s.getPrivateAddress("c"))
    }
    @Test fun engineRunsOnThisStoreEndToEnd() {
        val a = Phone("a", clock, store = (newStore() as? MemoryStore) ?: return); val b = Phone("b", clock)
        ok(a.engine.createRequest(urgentInput())); contact(a, b); assertEquals(1, b.packetsOf(PacketType.REQUEST).size)
    }
}

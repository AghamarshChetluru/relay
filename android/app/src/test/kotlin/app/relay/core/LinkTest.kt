package app.relay.core

import org.junit.Assert.*
import org.junit.Test

class LinkTest {
    private val clock = FakeClock()
    private fun phone(h: String? = "HK") = Phone("p", clock, hood = h)

    @Test fun twoPhonesExchangeBothWaysAndReceiptsAreHonest() {
        val a = phone(); val b = phone("GP")
        val req = ok(a.engine.createRequest(urgentInput())); val bc = ok(b.engine.createBroadcast("Water point open", "Resources", "Market"))
        val (sa, sb) = contact(a, b)
        assertTrue(b.has(req.packetId!!)); assertTrue(a.has(bc.packetId!!))
        assertEquals(setOf(req.packetId), sa.deliveredIds.toSet()); assertEquals(setOf(bc.packetId), sb.deliveredIds.toSet())
        assertEquals("sender may only claim 'shared' after the peer stored it", 1, a.store.sentCounts(req.packetId!!).total)
        assertTrue(sa.closed && sb.closed); assertEquals("done", sa.closeReason)
        val (sa2, _) = contact(a, b)
        assertEquals("second contact moves nothing and re-sends nothing", 0, sa2.stats.sentPackets + sa2.stats.stored)
        assertEquals(1, b.packetsOf(PacketType.REQUEST).size)
    }

    @Test fun noInventedReceiptIfThePeerAckNeverArrives() {
        val a = phone(); val b = phone(); val req = ok(a.engine.createRequest(urgentInput()))
        // drop every PACK frame travelling B -> A (phone B stored the packet, but A never hears about it)
        Pipe.run(a.engine, b.engine, tamperBtoA = { f -> if (f[0].toInt() == Frame.PACK) null else f })
        assertTrue("B really stored it", b.has(req.packetId!!))
        assertEquals("A must NOT claim it was shared", 0, a.store.sentCounts(req.packetId!!).total)
    }

    @Test fun corruptedPacketInTransitIsRejectedAndNeverStored() {
        val a = phone(); val b = phone(); val req = ok(a.engine.createRequest(urgentInput()))
        val (_, sb) = Pipe.run(a.engine, b.engine, tamperAtoB = { f -> if (f[0].toInt() == Frame.PKT) f.copyOf().also { it[f.size / 2] = (it[f.size / 2].toInt() xor 0x20).toByte() } else f })
        assertFalse(b.has(req.packetId!!)); assertEquals(1, sb.stats.rejected)
        assertEquals("a rejected packet must not count as delivered", 0, a.store.sentCounts(req.packetId!!).total)
    }

    private class Capture : LinkIo { val sent = ArrayList<ByteArray>(); var closedWith: String? = null
        override fun send(frame: ByteArray) { sent.add(frame) }; override fun close(reason: String) { closedWith = reason } }

    private fun helloFrame(p: Phone, deviceId: String = p.id): ByteArray = Writer().u8(Frame.HELLO).u8(1).raw(deviceId.unhex()).raw(p.identity.signPub).raw(p.identity.boxPub).u8(1).u8(1).str("HK").u32(0).toByteArray()

    @Test fun protocolViolationsCloseTheSession() {
        val victim = phone(); val evil = phone()
        fun session() = Capture().let { io -> LinkSession(victim.engine, io) to io }
        run { val (s, io) = session(); s.onFrame(Writer().u8(Frame.INV).u8(1).u8(0).toByteArray()); assertTrue("frame before HELLO", s.closed) }
        run { val (s, _) = session(); s.onFrame(helloFrame(evil, deviceId = "00".repeat(16))); assertTrue("device ID must be the hash of the key", s.closed) }
        run { val (s, _) = session(); s.onFrame(helloFrame(victim)); assertTrue("cannot connect to self", s.closed) }
        run { val (s, _) = session(); s.onFrame(ByteArray(Limits.MAX_FRAME_BYTES + 1)); assertTrue(s.closed) }
        run { val (s, _) = session(); s.onFrame(ByteArray(0)); assertTrue(s.closed) }
        run { val (s, _) = session(); s.onFrame(byteArrayOf(Frame.HELLO.toByte(), 9)); assertTrue("unsupported version / truncated hello", s.closed) }
        run {
            val (s, _) = session(); s.onFrame(helloFrame(evil))
            val req = ok(evil.engine.createRequest(urgentInput())); val wire = evil.store.getPacket(req.packetId!!)!!.env.wire()
            repeat(5) { s.onFrame(Writer().u8(Frame.PKT).raw(req.packetId!!.unhex()).u8(1).u8(0).u32(100).bytes(wire).toByteArray()) }
            assertTrue("unsolicited packets are refused and the session ends", s.closed); assertFalse(victim.has(req.packetId!!))
        }
    }

    @Test fun randomFramesNeverCrashASession() {
        val victim = phone(); val evil = phone(); val rnd = java.util.Random(11)
        repeat(300) {
            val s = LinkSession(victim.engine, Capture()); s.onFrame(helloFrame(evil))
            repeat(20) { s.onFrame(ByteArray(1 + rnd.nextInt(80)).also { f -> rnd.nextBytes(f); if (rnd.nextBoolean()) f[0] = (1 + rnd.nextInt(11)).toByte() }) }
        }
        assertEquals(0, victim.store.packets().size)
    }

    @Test fun sessionByteBudgetIsEnforced() {
        val a = phone(); val b = phone()
        repeat(40) { ok(a.engine.createBroadcast("update number $it " + "x".repeat(200), "Community", "")) }
        val (sa, _) = contact(a, b)
        assertTrue(sa.stats.bytesOut <= Limits.MAX_SESSION_BYTES && sa.stats.framesOut <= Limits.MAX_SESSION_FRAMES)
    }

    @Test fun photoBytesTransferWithIntegrityAndDedupe() {
        val a = phone(); val b = phone(); val photo = fakeJpeg(21_000)
        val req = ok(a.engine.createRequest(missingInput(photo = photo)))
        val aid = a.store.packets().first { it.env.type == PacketType.ATTACHMENT }.env.s("attachmentId")
        assertEquals(sha256(photo).hex().substring(0, 32), aid)
        val (sa, sb) = contact(a, b)
        assertEquals(1, sb.stats.attachmentsDone); assertTrue(b.store.getAttachmentMeta(aid)!!.complete)
        assertArrayEquals("bytes match end to end", photo, b.store.attachmentBytes(aid))
        val c = phone(); contact(b, c)
        assertArrayEquals("a relay re-serves the exact bytes", photo, c.store.attachmentBytes(aid))
        assertEquals("one stored copy per phone", 1, c.store.attachments().size)
        assertTrue("text packet is delivered before photo bytes", sb.stats.stored >= 2)
    }

    @Test fun interruptedPhotoTransferResumesFromTheLastGoodOffset() {
        val a = phone(); val b = phone(); val photo = fakeJpeg(25_000, 3)
        ok(a.engine.createRequest(missingInput(photo = photo))); val aid = a.store.packets().first { it.env.type == PacketType.ATTACHMENT }.env.s("attachmentId")
        var chunks = 0
        Pipe.run(a.engine, b.engine, tamperAtoB = { f -> if (f[0].toInt() == Frame.ATT_CHUNK) { chunks++; if (chunks > 8) null else f } else f })   // the link "dies" after 8 chunks
        val partial = b.store.getAttachmentMeta(aid)!!
        assertFalse(partial.complete); assertTrue("some bytes kept", partial.received in 1000..25_000)
        val before = partial.received
        val (_, sb) = contact(a, b)
        assertTrue("completed after reconnect", b.store.getAttachmentMeta(aid)!!.complete); assertArrayEquals(photo, b.store.attachmentBytes(aid))
        assertTrue("resumed instead of restarting", sb.stats.bytesIn < photo.size + 6000 && before > 0)
    }

    @Test fun corruptedPhotoChunkIsDetectedByHashAndDiscarded() {
        val a = phone(); val b = phone(); val photo = fakeJpeg(8_000, 9)
        ok(a.engine.createRequest(missingInput(photo = photo))); val aid = a.store.packets().first { it.env.type == PacketType.ATTACHMENT }.env.s("attachmentId")
        var hit = false
        Pipe.run(a.engine, b.engine, tamperAtoB = { f -> if (f[0].toInt() == Frame.ATT_CHUNK && !hit) { hit = true; f.copyOf().also { it[f.size - 5] = (it[f.size - 5].toInt() xor 0x55).toByte() } } else f })
        assertFalse("tampered photo must not be accepted", b.store.getAttachmentMeta(aid)!!.complete); assertEquals(0, b.store.getAttachmentMeta(aid)!!.received)
        contact(a, b); assertTrue("a clean retry succeeds", b.store.getAttachmentMeta(aid)!!.complete)
    }

    @Test fun photoFromSomeoneOtherThanTheRequesterIsNeverFetched() {
        val a = phone(); val b = phone(); val mallory = phone(); val photo = fakeJpeg(5_000, 4)
        val req = ok(a.engine.createRequest(missingInput())); b.engine.receive(a.store.getPacket(req.packetId!!)!!.env.wire(), Hop(1, 0, false, 3_600_000), a.id)
        val sha = sha256(photo).hex(); val f = mapOf("attachmentId" to sha.substring(0, 32).toByteArray(), "sha256" to sha.toByteArray(), "mime" to "image/jpeg".toByteArray(), "size" to "5000".toByteArray(), "w" to "100".toByteArray(), "h" to "100".toByteArray())
        val fake = Envelope.build(PacketType.ATTACHMENT, a.store.getPacket(req.packetId!!)!!.env.caseId, 0, clock.nowMs(), 3_600_000, false, a.store.getPacket(req.packetId!!)!!.env.route, f, mallory.identity, sharedCrypto)
        b.engine.receive(fake.wire(), Hop(1, 0, false, 3_600_000), mallory.id)
        assertTrue("no bytes requested for a photo not signed by the requester", b.engine.attachmentRequests().isEmpty())
    }

    @Test fun photoLimitsAndTypesAreChecked() {
        val a = phone()
        assertFalse(a.engine.createRequest(missingInput(photo = fakeJpeg(Limits.MAX_PHOTO_BYTES + 1))).ok)
        assertFalse(a.engine.createRequest(missingInput(photo = ByteArray(5_000))).ok)             // no JPEG magic
        assertFalse(a.engine.createRequest(missingInput(photo = fakeJpeg(50))).ok)
        assertTrue(a.engine.createRequest(missingInput(photo = fakeJpeg(Limits.MAX_PHOTO_BYTES))).ok)
    }
}

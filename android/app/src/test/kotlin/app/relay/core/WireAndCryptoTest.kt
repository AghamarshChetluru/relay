package app.relay.core

import org.junit.Assert.*
import org.junit.Test

class WireAndCryptoTest {
    private val c = sharedCrypto
    private fun env(type: PacketType = PacketType.BROADCAST): Pair<Envelope, Identity> {
        val id = Identity.create(c)
        val f = mapOf("text" to "Water point open".toByteArray(), "category" to "Resources".toByteArray(), "area" to "".toByteArray(), "hood" to "HK".toByteArray(), "hoodName" to "Hauz Khas".toByteArray())
        return Envelope.build(type, null, 0, 1_000L, 45 * Limits.MINUTE_MS, false, Route(PolicyKind.FLOOD, 30, 0, 0, 0, emptyList()), f, id, c) to id
    }

    @Test fun varintAndPrimitivesRoundTrip() {
        val w = Writer().u8(255).u16(65535).u32(4_000_000_000L).u64(Long.MAX_VALUE).varint(0).varint(127).varint(128).varint(300_000).str("héllo ✓").bytes(byteArrayOf(1, 2, 3))
        val r = Reader(w.toByteArray())
        assertEquals(255, r.u8()); assertEquals(65535, r.u16()); assertEquals(4_000_000_000L, r.u32()); assertEquals(Long.MAX_VALUE, r.u64())
        assertEquals(0, r.varint()); assertEquals(127, r.varint()); assertEquals(128, r.varint()); assertEquals(300_000, r.varint())
        assertEquals("héllo ✓", r.str(50)); assertArrayEquals(byteArrayOf(1, 2, 3), r.bytes(10)); assertEquals(0, r.remaining())
    }

    @Test fun readerRejectsTruncationOverlongAndBadUtf8() {
        assertThrows(WireException::class.java) { Reader(byteArrayOf(1)).u16() }
        assertThrows(WireException::class.java) { Reader(Writer().varint(500).toByteArray()).bytes(100) }                 // declared 500 > limit
        assertThrows(WireException::class.java) { Reader(byteArrayOf(0x85.toByte(), 0x85.toByte(), 0x85.toByte(), 0x85.toByte(), 0x85.toByte(), 0x01)).varint() }
        assertThrows(WireException::class.java) { Reader(Writer().bytes(byteArrayOf(0xC3.toByte(), 0x28)).toByteArray()).str(10) }   // invalid UTF-8
        assertThrows(WireException::class.java) { "zz".unhex() }; assertThrows(WireException::class.java) { "abc".unhex() }
    }

    @Test fun envelopeRoundTripsAndIdIsContentAddressed() {
        val (e, _) = env(); val d = Envelope.decode(e.wire())
        assertEquals(e.id, d.id); assertEquals(32, e.id.length); assertEquals(PacketType.BROADCAST, d.type); assertEquals("Water point open", d.s("text"))
        assertTrue(c.verify(d.origin, d.signature, d.signedBody()))
    }

    @Test fun anySingleBitFlipIsRejectedByDecodeOrSignature() {
        val (e, _) = env(); val wire = e.wire(); var accepted = 0
        for (i in wire.indices) {
            val m = wire.copyOf(); m[i] = (m[i].toInt() xor 0x01).toByte()
            val ok = try { val d = Envelope.decode(m); c.verify(d.origin, d.signature, d.signedBody()) && d.id == e.id } catch (x: WireException) { false }
            if (ok) accepted++
        }
        assertEquals("a flipped bit must never yield the same valid packet", 0, accepted)
    }

    @Test fun truncatedTrailingAndNonCanonicalEnvelopesFail() {
        val (e, _) = env(); val w = e.wire()
        for (cut in listOf(0, 1, 10, w.size / 2, w.size - 1)) assertThrows(WireException::class.java) { Envelope.decode(w.copyOf(cut)) }
        assertThrows(WireException::class.java) { Envelope.decode(w + byteArrayOf(0)) }
        assertThrows(WireException::class.java) { Envelope.decode(ByteArray(Limits.MAX_ENVELOPE_BYTES + 1)) }
        val bad = w.copyOf(); bad[3] = 9    // version
        assertThrows(WireException::class.java) { Envelope.decode(bad) }
        val badMagic = w.copyOf(); badMagic[0] = 'X'.code.toByte(); assertThrows(WireException::class.java) { Envelope.decode(badMagic) }
    }

    @Test fun signatureBindsToTheSignerAndDeviceIdBindsToTheKey() {
        val (e, id) = env(); val other = Identity.create(c)
        assertEquals(Identity.deviceIdOf(id.signPub), id.deviceId); assertNotEquals(other.deviceId, id.deviceId)
        assertFalse(c.verify(other.signPub, e.signature, e.signedBody()))
        assertFalse(c.verify(id.signPub, ByteArray(64), e.signedBody()))
        assertFalse(c.verify(ByteArray(5), e.signature, e.signedBody()))
    }

    @Test fun sealedBoxOnlyOpensWithRightKeyAndAad() {
        val rcpt = c.newBoxKeyPair(); val other = c.newBoxKeyPair(); val aad = "case|reply".toByteArray(); val msg = "Flat 4B, Block C".toByteArray()
        val sealed = c.seal(rcpt.pub, msg, aad)
        assertArrayEquals(msg, c.open(rcpt.priv, rcpt.pub, sealed, aad))
        assertNull(c.open(other.priv, other.pub, sealed, aad)); assertNull(c.open(rcpt.priv, rcpt.pub, sealed, "other".toByteArray()))
        for (i in sealed.indices step 7) { val m = sealed.copyOf(); m[i] = (m[i].toInt() xor 0x40).toByte(); assertNull("tamper at $i", c.open(rcpt.priv, rcpt.pub, m, aad)) }
        assertNull(c.open(rcpt.priv, rcpt.pub, ByteArray(10), aad))
        assertFalse("ciphertext must not contain the plaintext", String(sealed, Charsets.ISO_8859_1).contains("Flat 4B"))
        assertFalse("two seals of the same plaintext must differ (fresh ephemeral key + iv)", sealed.contentEquals(c.seal(rcpt.pub, msg, aad)))
    }

    @Test fun identityKeysSerialiseAndRestore() {
        val id = Identity.create(c); val back = Identity.deserialize(id.serialize())
        assertEquals(id.deviceId, back.deviceId); assertArrayEquals(id.boxPriv, back.boxPriv)
        assertThrows(WireException::class.java) { Identity.deserialize(byteArrayOf(1, 2, 3)) }
    }
}

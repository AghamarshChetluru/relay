package app.relay

import androidx.test.platform.app.InstrumentationRegistry
import app.relay.core.*
import app.relay.store.KeystoreProtector
import app.relay.store.SqliteStore
import org.junit.After
import org.junit.Assert.*
import org.junit.Before
import org.junit.Test

/** Simulates process death by discarding the engine and reopening the on-disk database with a fresh object graph. */
class PersistenceTest {
    private val ctx = InstrumentationRegistry.getInstrumentation().targetContext
    private val dbName = "relay-persist-test.db"
    private val crypto = TinkCrypto()
    @Before fun clean() { ctx.deleteDatabase(dbName) }
    @After fun cleanup() { ctx.deleteDatabase(dbName) }

    private fun open(identity: Identity? = null): Pair<RelayEngine, SqliteStore> {
        val st = SqliteStore(ctx, dbName); val id = identity ?: Identity.create(crypto); return RelayEngine(st, crypto, id) to st
    }

    @Test fun messagesPhotosAddressesAndSettingsSurviveRestart() {
        val (e1, s1) = open(); val id = e1.identity
        e1.setHood("HK", "")
        val photo = ByteArray(3000) { (it * 7).toByte() }.also { it[0] = 0xFF.toByte(); it[1] = 0xD8.toByte(); it[2] = 0xFF.toByte() }
        val c = e1.createRequest(RequestInput("urgent", "Medical", "Help near the gate", "details", "Gate 2", "HK", "Hauz Khas", true, 60, privateBuilding = "Flat 4B", photo = photo, photoW = 100, photoH = 80))
        assertTrue(c.error, c.ok); e1.createBroadcast("hello", "Community", "")
        s1.setFlag("hidden", "abc"); s1.close()
        val (e2, s2) = open(id)   // "process restarted"
        assertEquals(3, s2.packets().size)    // request + attachment meta + broadcast
        assertEquals("Hauz Khas", e2.hoodState().name); assertTrue(e2.hoodState().reliable)
        assertEquals("Flat 4B" to "", s2.getPrivateAddress(c.caseId!!)); assertTrue(s2.hasFlag("hidden", "abc"))
        val att = s2.attachments().single(); assertTrue(att.complete); assertArrayEquals(photo, s2.attachmentBytes(att.id))
        assertTrue("the same signed packet is still valid after restart", s2.packets().all { sharedOk(it) })
        s2.close()
    }
    private fun sharedOk(p: StoredPacket) = crypto.verify(p.env.origin, p.env.signature, p.env.signedBody()) && Validation.check(p.env) == null

    @Test fun duplicateIsStillRefusedAfterRestartBecauseSeenTombstonesAreDurable() {
        val (e1, s1) = open(); val other = RelayEngine(SqliteStore(ctx, null), crypto, Identity.create(crypto))
        val o = other.createBroadcast("hi", "Community", ""); val wire = other.store.getPacket(o.packetId!!)!!.env.wire()
        assertEquals(RxStatus.STORED, e1.receive(wire, Hop(1, 0, false, 30 * 60_000), "x").status); s1.close()
        val (e2, s2) = open(e1.identity); assertEquals(RxStatus.DUPLICATE, e2.receive(wire, Hop(1, 0, false, 30 * 60_000), "x").status); s2.close()
    }

    @Test fun deliveryReceiptsAndFanoutBudgetSurviveRestart() {
        val (e1, s1) = open(); val o = e1.createRequest(RequestInput("missing", "Missing", "Looking for X", area = "gate", areaHood = "CP", areaHoodName = "Connaught Place", validityMin = 1440))
        e1.markDelivered(o.packetId!!, "peerA"); s1.close()
        val (_, s2) = open(e1.identity); assertTrue(s2.hasSentTo(o.packetId!!, "peerA")); assertEquals(1, s2.sentCounts(o.packetId!!).total); s2.close()
    }

    @Test fun keystoreWrapsAndRestoresTheIdentityAndRejectsTampering() {
        val prot = KeystoreProtector("relay_test_wrap_key"); val id = Identity.create(crypto); val wrapped = prot.wrap(id.serialize())
        assertFalse("private key must not appear in the stored blob", String(wrapped, Charsets.ISO_8859_1).contains(String(id.signPriv, Charsets.ISO_8859_1)))
        assertEquals(id.deviceId, Identity.deserialize(prot.unwrap(wrapped)).deviceId)
        val bad = wrapped.copyOf(); bad[bad.size - 3] = (bad[bad.size - 3].toInt() xor 1).toByte()
        assertThrows(Exception::class.java) { prot.unwrap(bad) }
    }

    @Test fun corruptedPacketRowIsSkippedNotFatal() {
        val (e1, s1) = open(); e1.createBroadcast("one", "Community", ""); e1.createBroadcast("two", "Community", "")
        s1.writableDatabase.execSQL("UPDATE packets SET wire = x'0102030405' WHERE rowid = (SELECT MIN(rowid) FROM packets)")
        assertEquals("the damaged row is skipped, the other survives, nothing crashes", 1, s1.packets().size); s1.close()
    }
}

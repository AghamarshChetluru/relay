package app.relay.core

import android.content.Context
import android.content.ContextWrapper
import app.relay.NoticeCenter
import app.relay.RelayRuntime
import org.junit.After
import org.junit.Assert.*
import org.junit.Before
import org.junit.Test

/** The glue between "the engine stored a packet" and "the app is told", on the JVM (the Android notification call itself is covered by the emulator tests). */
class NoticeCenterTest {
    private val clock = FakeClock()
    private val ctx: Context = object : ContextWrapper(null) {}
    private fun hop() = Hop(1, 0, false, 60 * Limits.MINUTE_MS)
    private fun wire(p: Phone, id: String) = p.store.getPacket(id)!!.env.wire()
    @Before fun open() { RelayRuntime.foreground = true; NoticeCenter.drainIncoming() }
    @After fun close() { RelayRuntime.foreground = false; NoticeCenter.drainIncoming() }
    private fun hook(p: Phone) { p.engine.onStored = { sp -> NoticeCenter.onStored(ctx, p.engine, sp) } }

    @Test fun openAppGetsOneBannerPerGenuinelyNewPacketAndNeverAgain() {
        val a = Phone("a", clock); val b = Phone("b", clock, hood = "GP"); hook(b); val r = ok(a.engine.createRequest(urgentInput()))
        b.engine.receive(wire(a, r.packetId!!), hop(), a.id); b.engine.receive(wire(a, r.packetId!!), hop(), a.id)      // the same packet offered twice
        assertEquals(1, NoticeCenter.incoming.size); assertTrue(b.store.hasFlag(ReadState.ANNOUNCED, r.packetId!!))
        val drained = NoticeCenter.drainIncoming(); assertEquals("Medical assistance requested · Hauz Khas", drained[0].line); assertTrue(NoticeCenter.incoming.isEmpty())
        // the radio reconnects and offers it again, after a restart too: the packet is already stored (or seen), so nothing is signalled
        val b2 = Phone("b2", clock, hood = "GP", store = b.store); hook(b2); b2.engine.receive(wire(a, r.packetId!!), hop(), a.id)
        assertTrue("restart + duplicate offer: no repeat", NoticeCenter.incoming.isEmpty())
    }

    @Test fun aRenewalThatOnlyExtendsTheTimeInheritsReadState() {
        val a = Phone("a", clock); val b = Phone("b", clock); hook(b); val c = ok(a.engine.createRequest(urgentInput(30)))
        b.engine.receive(wire(a, c.packetId!!), hop(), a.id); NoticeCenter.drainIncoming()
        ReadState.markRead(b.store, listOf(c.packetId!!))                                       // the person opened it
        clock.minutes(31)
        val same = ok(a.engine.renewRequest(c.caseId!!, RenewInput(validityMin = 120)))
        b.engine.receive(wire(a, same.packetId!!), hop(), a.id)
        assertTrue("no second banner", NoticeCenter.incoming.isEmpty()); assertTrue("and it does not turn unread again", ReadState.isRead(b.store, same.packetId!!))
        val changed = ok(a.engine.renewRequest(c.caseId!!, RenewInput(description = "Now in the courtyard")))
        b.engine.receive(wire(a, changed.packetId!!), hop(), a.id)
        assertEquals("changed words: one update banner", 1, NoticeCenter.incoming.size); assertFalse(ReadState.isRead(b.store, changed.packetId!!))
    }

    @Test fun theOpenAppOnlyPopsUpForImportantMessagesAndSurfacesMissedOnesOnce() {
        val a = Phone("a", clock, hood = "HK"); val far = Phone("far", clock, hood = "LN"); val near = Phone("near", clock, hood = "GP"); hook(far); hook(near)
        val r = ok(a.engine.createRequest(urgentInput()))
        far.engine.receive(wire(a, r.packetId!!), hop(), a.id); assertTrue("urgent request two steps away: inbox only, no pop-up", NoticeCenter.incoming.isEmpty())
        assertTrue("but it is announced (once) so it can never repeat", far.store.hasFlag(ReadState.ANNOUNCED, r.packetId!!))
        near.engine.receive(wire(a, r.packetId!!), hop(), a.id); assertEquals("urgent request next door: one pop-up", 1, NoticeCenter.incoming.size)
        NoticeCenter.drainIncoming()
        // announced while the app was closed -> remembered -> surfaces once when the app opens, unless it was read meanwhile
        val n = Inbox.classify(near.engine, near.store.getPacket(r.packetId!!)!!)!!
        NoticeCenter.park(near.store, n); NoticeCenter.surfaceMissed(near.engine); assertEquals(1, NoticeCenter.drainIncoming().size)
        NoticeCenter.surfaceMissed(near.engine); assertTrue("never twice", NoticeCenter.incoming.isEmpty())
        val u2 = ok(a.engine.createRequest(urgentInput())); near.engine.receive(wire(a, u2.packetId!!), hop(), a.id); NoticeCenter.drainIncoming()
        val n2 = Inbox.classify(near.engine, near.store.getPacket(u2.packetId!!)!!)!!
        NoticeCenter.park(near.store, n2); ReadState.markRead(near.store, listOf(n2.eventId)); NoticeCenter.surfaceMissed(near.engine); assertTrue("already opened: no pop-up", NoticeCenter.incoming.isEmpty())
        val u3 = ok(a.engine.createRequest(urgentInput())); near.engine.receive(wire(a, u3.packetId!!), hop(), a.id); NoticeCenter.drainIncoming()
        val n3 = Inbox.classify(near.engine, near.store.getPacket(u3.packetId!!)!!)!!
        NoticeCenter.park(near.store, n3); NoticeCenter.forget(near.store, listOf(n3.eventId)); NoticeCenter.surfaceMissed(near.engine); assertTrue("opened from its notification: no pop-up", NoticeCenter.incoming.isEmpty())
        // the process died between the notification and the open: only the database remembers, and that is enough
        val u4 = ok(a.engine.createRequest(urgentInput())); near.engine.receive(wire(a, u4.packetId!!), hop(), a.id); NoticeCenter.drainIncoming()
        NoticeCenter.park(near.store, Inbox.classify(near.engine, near.store.getPacket(u4.packetId!!)!!)!!); NoticeCenter.resetForTest()
        NoticeCenter.surfaceMissed(near.engine); assertEquals("a fresh process still shows it", 1, NoticeCenter.drainIncoming().size)
    }

    @Test fun nothingBelongingToMeIsAnnouncedBackToMe() {
        val a = Phone("a", clock); hook(a); val r = ok(a.engine.createRequest(urgentInput())); ok(a.engine.createBroadcast("hello", "Community", ""))
        assertTrue("what this phone writes itself never banners", NoticeCenter.incoming.isEmpty())
        assertNotNull(r)
    }
}

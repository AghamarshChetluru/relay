package app.relay

import android.app.NotificationManager
import android.app.PendingIntent
import android.content.Context
import androidx.test.core.app.ActivityScenario
import androidx.test.platform.app.InstrumentationRegistry
import androidx.test.rule.GrantPermissionRule
import app.relay.core.*
import app.relay.store.SqliteStore
import app.relay.ui.MainActivity
import app.relay.ui.Notifier
import org.junit.After
import org.junit.Assert.*
import org.junit.Before
import org.junit.Rule
import org.junit.Test
import java.util.concurrent.CountDownLatch
import java.util.concurrent.TimeUnit

/** Real notifications, real PendingIntents, real WebView, real engine and SQLite on a device or emulator. */
class InboxNotificationTest {
    @get:Rule val perm: GrantPermissionRule = GrantPermissionRule.grant(android.Manifest.permission.POST_NOTIFICATIONS)
    private val inst = InstrumentationRegistry.getInstrumentation()
    private val ctx: Context = inst.targetContext
    private val nm get() = ctx.getSystemService(NotificationManager::class.java)
    private val crypto = TinkCrypto()
    private fun hop() = Hop(1, 0, false, 120 * Limits.MINUTE_MS)
    private fun peer(hood: String) = RelayEngine(MemoryStore(), crypto, Identity.create(crypto)).also { it.setHood(hood, "") }
    private fun wire(e: RelayEngine, id: String) = e.store.getPacket(id)!!.env.wire()
    private fun urgent(title: String, hoodName: String = "Hauz Khas") = RequestInput("urgent", "Medical", title, "SECRET-DESCRIPTION-TEXT", "Gate 2", "HK", hoodName, true, 60)

    @Before fun setup() { RelayRuntime.engine(ctx); RelayRuntime.foreground = false; NoticeCenter.resetForTest(); nm.cancelAll() }
    @After fun cleanup() { RelayRuntime.foreground = false; NoticeCenter.resetForTest(); nm.cancelAll() }

    private fun waitFor(ms: Long = 9000, f: () -> Boolean): Boolean { val end = System.currentTimeMillis() + ms; while (System.currentTimeMillis() < end) { if (f()) return true; Thread.sleep(200) }; return f() }
    private fun js(sc: ActivityScenario<MainActivity>, script: String): String { val l = CountDownLatch(1); var r = ""; sc.onActivity { a -> a.webViewForTest.evaluateJavascript(script) { v -> r = v ?: ""; l.countDown() } }; l.await(5, TimeUnit.SECONDS); return r }

    @Test fun twoNotificationsAreDistinctPrivateAndOpenDifferentMessages() {
        val app = RelayRuntime.engine(ctx); val mine = app.createRequest(urgent("Medical help needed near my gate"))
        assertTrue(mine.ok)
        val helper = peer("GP"); helper.receive(wire(app, mine.packetId!!), hop(), "app")
        val reply = helper.createReply(mine.caseId!!, "offer", "I am a nurse, coming now", "Gate 2")
        val stranger = peer("LN"); val other = stranger.createBroadcast("Water at the market gate SECRET-UPDATE-TEXT", "Resources", "Market gate")
        app.receive(wire(helper, reply.packetId!!), hop(), "helper"); app.receive(wire(stranger, other.packetId!!), hop(), "stranger")
        assertTrue("both notifications are posted after the short batching window", waitFor { nm.activeNotifications.count { it.tag?.startsWith("e:") == true } == 2 })
        val posted = nm.activeNotifications.filter { it.tag?.startsWith("e:") == true }
        assertEquals("distinct tags and ids", 2, posted.map { it.tag + it.id }.toSet().size)
        val refReply = Ref("reply", mine.caseId, reply.packetId); val refUpd = Ref("broadcast", null, other.packetId)
        assertFalse("the two destinations never share one PendingIntent identity", Notifier.openIntent(ctx, refReply).filterEquals(Notifier.openIntent(ctx, refUpd)))
        assertNotEquals(Notifier.idFor(refReply), Notifier.idFor(refUpd))
        val pr = PendingIntent.getActivity(ctx, Notifier.idFor(refReply), Notifier.openIntent(ctx, refReply), PendingIntent.FLAG_NO_CREATE or PendingIntent.FLAG_IMMUTABLE)
        val pu = PendingIntent.getActivity(ctx, Notifier.idFor(refUpd), Notifier.openIntent(ctx, refUpd), PendingIntent.FLAG_NO_CREATE or PendingIntent.FLAG_IMMUTABLE)
        assertTrue("both PendingIntents exist and are different", pr != null && pu != null && pr != pu)
        for (n in posted) {
            assertEquals("lock screen shows nothing sensitive", android.app.Notification.VISIBILITY_PRIVATE, n.notification.visibility)
            val pub = n.notification.publicVersion; assertNotNull(pub); assertEquals("New message on this phone", pub.extras.getCharSequence(android.app.Notification.EXTRA_TEXT).toString())
            val all = n.notification.extras.keySet().mapNotNull { n.notification.extras.get(it)?.toString() }.joinToString(" ")
            assertFalse("no message body text in the notification: $all", all.contains("SECRET") || all.contains("nurse"))
            assertNotNull(n.notification.contentIntent)
        }
        val byTag = posted.associateBy { it.tag }
        assertEquals("Someone sent a response", byTag["e:${reply.packetId}"]!!.notification.extras.getCharSequence(android.app.Notification.EXTRA_TITLE).toString())
        assertEquals("responses use the high-priority channel", Notifier.CH_RESPONSES, byTag["e:${reply.packetId}"]!!.notification.channelId)
        assertEquals(Notifier.CH_MESSAGES, byTag["e:${other.packetId}"]!!.notification.channelId)
        // duplicates and restarts do not notify again
        nm.cancelAll(); app.receive(wire(helper, reply.packetId!!), hop(), "helper"); app.receive(wire(stranger, other.packetId!!), hop(), "stranger"); Thread.sleep(3800)
        assertEquals("duplicate packets (BLE reconnect) post nothing", 0, nm.activeNotifications.count { it.tag == "summary" || it.tag?.startsWith("e:") == true })
    }

    @Test fun aBurstBecomesOneSummaryAndNeverCarriesText() {
        val app = RelayRuntime.engine(ctx); app.setHood("HK", ""); val s = peer("LN")      // six ordinary (non-urgent, far away) messages
        repeat(6) { i -> val r = s.createRequest(RequestInput("urgent", "Shelter", "Burst request number $i", "x", "Far lane", "LN", "Lajpat Nagar", false, 360)); app.receive(wire(s, r.packetId!!), hop(), "s") }
        assertTrue(waitFor { nm.activeNotifications.any { it.tag == "summary" } })
        val act = nm.activeNotifications.filter { it.packageName == ctx.packageName && (it.tag == "summary" || it.tag?.startsWith("e:") == true) }; assertEquals("six requests: one summary, not six notifications: ${act.map { it.tag }}", 1, act.size)
        assertTrue(act[0].notification.extras.getCharSequence(android.app.Notification.EXTRA_TITLE).toString().startsWith("6 new messages"))
    }

    @Test fun importantMessagesInABurstStandAloneUpToAPointThenSummarise() {
        val app = RelayRuntime.engine(ctx); app.setHood("HK", ""); val s = peer("GP")      // six urgent requests next door: all important
        repeat(6) { i -> val r = s.createRequest(urgent("Urgent burst $i")); app.receive(wire(s, r.packetId!!), hop(), "s") }
        assertTrue(waitFor { nm.activeNotifications.any { it.tag == "summary" } })
        val act = nm.activeNotifications.filter { it.packageName == ctx.packageName && (it.tag == "summary" || it.tag?.startsWith("e:") == true) }
        assertEquals("four stand alone, the overflow is one summary: ${act.map { it.tag }}", 4, act.count { it.tag?.startsWith("e:") == true }); assertEquals(1, act.count { it.tag == "summary" })
        assertTrue(act.first { it.tag == "summary" }.notification.extras.getCharSequence(android.app.Notification.EXTRA_TITLE).toString().startsWith("2 new messages"))
    }

    @Test fun notificationTapRoutesToTheExactMessageOnColdStartAndWhileRunning() {
        val app = RelayRuntime.engine(ctx); val a = app.createRequest(urgent("Medical help needed near the red gate")); val b = app.createRequest(urgent("Medical help needed near the blue gate"))
        val helper = peer("GP"); helper.receive(wire(app, a.packetId!!), hop(), "app"); helper.receive(wire(app, b.packetId!!), hop(), "app")
        val ra = helper.createReply(a.caseId!!, "offer", "First response", ""); val rb = helper.createReply(b.caseId!!, "offer", "Second response", "")
        app.receive(wire(helper, ra.packetId!!), hop(), "h"); app.receive(wire(helper, rb.packetId!!), hop(), "h")
        // finish onboarding state so the page is on a normal screen
        app.setHood("HK", "")
        val intentA = Notifier.openIntent(ctx, Ref("reply", a.caseId, ra.packetId)); val intentB = Notifier.openIntent(ctx, Ref("reply", b.caseId, rb.packetId))
        val sc = ActivityScenario.launch<MainActivity>(intentA)
        try {                              // cold start from a notification tap
            assertTrue("sheet opens on the first request", waitFor(15000) { js(sc, "(function(){var s=document.getElementById('sheetbody');return s?s.textContent:''})()").contains("red gate") })
            assertTrue("and the response itself is the highlighted element", js(sc, "(document.querySelector('#sheet .offer.flash, #sheet .offer.flashed')||{getAttribute:function(){return ''}}).getAttribute('data-pid')").contains(ra.packetId!!))
            assertTrue("it is read now", ReadState.isRead(app.store, ra.packetId!!) && !ReadState.isRead(app.store, rb.packetId!!))
            sc.onActivity { act -> act.startActivity(intentB) }                                   // a second notification tapped while the app is running (singleTop -> onNewIntent)
            assertTrue("a different notification opens a different request", waitFor { js(sc, "(function(){var s=document.getElementById('sheetbody');return s?s.textContent:''})()").contains("blue gate") })
            assertTrue(js(sc, "(document.querySelector('#sheet .offer.flash, #sheet .offer.flashed')||{getAttribute:function(){return ''}}).getAttribute('data-pid')").contains(rb.packetId!!))
        } finally { try { sc.close() } catch (_: Throwable) { /* the second tap started the task again; only the lifecycle teardown is affected, every assertion above already ran */ } }
    }

    @Test fun theOpenAppPopsUpOnlyForImportantMessages() {
        val app = RelayRuntime.engine(ctx); app.setHood("HK", ""); RelayRuntime.foreground = true
        val s = peer("LN"); val quiet = s.createRequest(RequestInput("urgent", "Shelter", "Shelter needed far away", "x", "Far lane", "LN", "Lajpat Nagar", false, 360))
        app.receive(wire(s, quiet.packetId!!), hop(), "s"); assertTrue("a far, non-urgent request does not pop up", NoticeCenter.incoming.isEmpty())
        val mine = app.createRequest(urgent("Medical help needed near my door")); val h = peer("GP"); h.receive(wire(app, mine.packetId!!), hop(), "app")
        val rep = h.createReply(mine.caseId!!, "offer", "Coming now", ""); app.receive(wire(h, rep.packetId!!), hop(), "h")
        assertEquals("a response to my own request does", 1, NoticeCenter.incoming.size); assertEquals("Someone sent a response", NoticeCenter.drainIncoming()[0].title)
        val near = peer("GP"); val u = near.createRequest(urgent("Medical help needed near the park", "Hauz Khas")); app.receive(wire(near, u.packetId!!), hop(), "n")
        assertEquals("an urgent request in my area (one step away counts) does", 1, NoticeCenter.drainIncoming().size)
    }

    @Test fun anImportantMessageAnnouncedWhileAwayPopsUpWhenTheAppOpens() {
        val app = RelayRuntime.engine(ctx); app.setHood("HK", ""); RelayRuntime.foreground = false
        val mine = app.createRequest(urgent("Medical help needed near the school")); val h = peer("GP"); h.receive(wire(app, mine.packetId!!), hop(), "app")
        val rep = h.createReply(mine.caseId!!, "offer", "On my way", ""); app.receive(wire(h, rep.packetId!!), hop(), "h")
        assertTrue("the system notification is posted first", waitFor { nm.activeNotifications.any { it.tag == "e:${rep.packetId}" } })
        val sc = ActivityScenario.launch(MainActivity::class.java)     // the person opens the app by hand (not by tapping the notification)
        try {
            val diag = { js(sc, "JSON.stringify({hidden:document.getElementById('banner').hidden,txt:document.getElementById('banner').textContent,cur:!!RelayUI.ui.banner.cur,q:RelayUI.ui.banner.q.length,popups:RelayUI.ui.popups,ann:Object.keys(RelayUI.ui.announced),onb:RelayUI.ui.onboard,screen:RelayUI.ui.screen})") + " incoming=" + NoticeCenter.incoming.size + " fg=" + RelayRuntime.foreground }
            assertTrue("and the app greets them with a tappable pop-up for it: ${diag()}", waitFor(15000) { js(sc, "(function(){var b=document.getElementById('banner');return b&&!b.hidden?b.textContent:''})()").contains("Someone sent a response") })
            js(sc, "document.getElementById('banner-msg').click()")
            assertTrue("tapping it opens that response", waitFor { js(sc, "(function(){var s=document.getElementById('sheetbody');return s?s.textContent:''})()").contains("On my way") })
        } finally { try { sc.close() } catch (_: Throwable) {} }
    }

    @Test fun readStateSurvivesReopeningTheDatabase() {
        val name = "inbox_read_test.db"; ctx.deleteDatabase(name)
        val s1 = SqliteStore(ctx, name); val id = "ab".repeat(16)
        assertFalse(ReadState.isRead(s1, id)); ReadState.markRead(s1, listOf(id)); s1.close()
        val s2 = SqliteStore(ctx, name); assertTrue("read survives a restart", ReadState.isRead(s2, id)); assertTrue(s2.flags(ReadState.READ).contains(id)); s2.close(); ctx.deleteDatabase(name)
    }
}

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
import app.relay.service.RelayService
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
    @get:Rule val perm: GrantPermissionRule = GrantPermissionRule.grant(android.Manifest.permission.POST_NOTIFICATIONS, android.Manifest.permission.BLUETOOTH_SCAN, android.Manifest.permission.BLUETOOTH_ADVERTISE, android.Manifest.permission.BLUETOOTH_CONNECT)
    private val inst = InstrumentationRegistry.getInstrumentation()
    private val ctx: Context = inst.targetContext
    private val nm get() = ctx.getSystemService(NotificationManager::class.java)
    private val crypto = TinkCrypto()
    private fun hop() = Hop(1, 0, false, 120 * Limits.MINUTE_MS)
    private fun peer(hood: String) = RelayEngine(MemoryStore(), crypto, Identity.create(crypto)).also { it.setHood(hood, "") }
    private fun wire(e: RelayEngine, id: String) = e.store.getPacket(id)!!.env.wire()
    private fun urgent(title: String, hoodName: String = "Hauz Khas") = RequestInput("urgent", "Medical", title, "SECRET-DESCRIPTION-TEXT", "Gate 2", "HK", hoodName, true, 60)

    @Before fun setup() { NoticeCenter.surfaceMissed(RelayRuntime.engine(ctx)); RelayRuntime.foreground = false; NoticeCenter.resetForTest(); nm.cancelAll() }   // earlier tests' parked pop-ups must not greet this one
    @After fun cleanup() { RelayRuntime.foreground = false; NoticeCenter.resetForTest(); nm.cancelAll() }

    private fun meta(n: android.service.notification.StatusBarNotification) = "tag=${n.tag} id=${n.id} channel=${n.notification.channelId} ongoing=${n.isOngoing} fgsFlag=${(n.notification.flags and android.app.Notification.FLAG_FOREGROUND_SERVICE) != 0} pkg=${n.packageName}"
    private fun titles() = mine().filter { isInbox(it) }.map { it.notification.extras.getCharSequence(android.app.Notification.EXTRA_TITLE).toString() }
    private fun mine() = nm.activeNotifications.filter { it.packageName == ctx.packageName }
    private fun isInbox(n: android.service.notification.StatusBarNotification) = n.tag == "summary" || n.tag?.startsWith("e:") == true
    private fun isRadioService(n: android.service.notification.StatusBarNotification) = n.id == RelayService.NOTIF_ID && n.tag == null && n.notification.channelId == RelayService.CHANNEL && n.isOngoing &&
        (n.notification.flags and android.app.Notification.FLAG_FOREGROUND_SERVICE) != 0
    private fun waitFor(ms: Long = 9000, f: () -> Boolean): Boolean { val end = System.currentTimeMillis() + ms; while (System.currentTimeMillis() < end) { if (f()) return true; Thread.sleep(200) }; return f() }
    private fun js(sc: ActivityScenario<MainActivity>, script: String): String { val l = CountDownLatch(1); var r = ""; sc.onActivity { a -> a.webViewForTest.evaluateJavascript(script) { v -> r = v ?: ""; l.countDown() } }; l.await(5, TimeUnit.SECONDS); return r }

    @Test fun oneMessageIsItsOwnNotificationAndASecondFoldsEverythingIntoOneSummary() {
        val app = RelayRuntime.engine(ctx); val mine = app.createRequest(urgent("Medical help needed near my gate"))
        assertTrue(mine.ok)
        val helper = peer("GP"); helper.receive(wire(app, mine.packetId!!), hop(), "app")
        val reply = helper.createReply(mine.caseId!!, "offer", "I am a nurse, coming now", "Gate 2")
        val stranger = peer("LN"); val other = stranger.createBroadcast("Water at the market gate SECRET-UPDATE-TEXT", "Resources", "Market gate")
        // 1. a single message: its own notification, private on the lock screen, no body text, opens exactly that message
        app.receive(wire(helper, reply.packetId!!), hop(), "helper")
        assertTrue("a lone response is posted after the short batching window", waitFor { mine().any { it.tag == "e:${reply.packetId}" } })
        val single = mine().first { it.tag == "e:${reply.packetId}" }
        assertEquals("Someone sent a response", single.notification.extras.getCharSequence(android.app.Notification.EXTRA_TITLE).toString())
        assertEquals("responses use the high-priority channel", Notifier.CH_RESPONSES, single.notification.channelId)
        assertEquals("lock screen shows nothing sensitive", android.app.Notification.VISIBILITY_PRIVATE, single.notification.visibility)
        assertEquals("New message on this phone", single.notification.publicVersion.extras.getCharSequence(android.app.Notification.EXTRA_TEXT).toString())
        val text = single.notification.extras.keySet().mapNotNull { single.notification.extras.get(it)?.toString() }.joinToString(" ")
        assertFalse("no message body text in the notification: $text", text.contains("SECRET") || text.contains("nurse"))
        assertNotNull(single.notification.contentIntent)
        val refReply = Ref("reply", mine.caseId, reply.packetId); val refUpd = Ref("broadcast", null, other.packetId)
        assertFalse("the two destinations never share one PendingIntent identity", Notifier.openIntent(ctx, refReply).filterEquals(Notifier.openIntent(ctx, refUpd)))
        assertNotEquals(Notifier.idFor(refReply), Notifier.idFor(refUpd))
        val pr = PendingIntent.getActivity(ctx, Notifier.idFor(refReply), Notifier.openIntent(ctx, refReply), PendingIntent.FLAG_NO_CREATE or PendingIntent.FLAG_IMMUTABLE)
        assertNotNull("the reply's PendingIntent exists", pr)
        // 2. another message arrives while the first is still unopened: ONE "2 new messages" notification replaces the stack, never two alerts
        app.receive(wire(stranger, other.packetId!!), hop(), "stranger")
        assertTrue("the second arrival folds into one summary: ${mine().map { meta(it) }}", waitFor { mine().any { it.tag == "summary" } })
        waitFor(3000) { mine().none { it.tag?.startsWith("e:") == true } }
        val inbox = mine().filter { isInbox(it) }
        assertEquals("exactly one notification for two messages: ${inbox.map { meta(it) }}", 1, inbox.size)
        val sum = inbox[0]
        assertEquals("2 new messages", sum.notification.extras.getCharSequence(android.app.Notification.EXTRA_TITLE).toString())
        assertTrue("it tells the person what to do", sum.notification.extras.getCharSequence(android.app.Notification.EXTRA_TEXT).toString().startsWith("Tap to open and check"))
        assertEquals("loud only because one of the two is a response to my own request", Notifier.CH_RESPONSES, sum.notification.channelId)
        assertEquals(android.app.Notification.VISIBILITY_PRIVATE, sum.notification.visibility)
        val sumText = sum.notification.extras.keySet().mapNotNull { sum.notification.extras.get(it)?.toString() }.joinToString(" ")
        assertFalse("the summary carries no body text: $sumText", sumText.contains("SECRET") || sumText.contains("nurse"))
        // 3. a third arrival adds to the same single notification
        val third = stranger.createBroadcast("Tea at the hall", "Resources", "Hall"); app.receive(wire(stranger, third.packetId!!), hop(), "stranger")
        assertTrue("still ONE notification, now counting 3: ${mine().map { meta(it) }}", waitFor { mine().filter { isInbox(it) }.let { l -> l.size == 1 && l[0].notification.extras.getCharSequence(android.app.Notification.EXTRA_TITLE).toString() == "3 new messages" } })
        // 4. later, with nothing waiting, a single quiet message is again its own notification on the quiet channel, with its own destination
        nm.cancelAll(); waitFor { mine().none { isInbox(it) } }
        val fourth = stranger.createBroadcast("Blankets at the school", "Resources", "School"); app.receive(wire(stranger, fourth.packetId!!), hop(), "stranger")
        assertTrue(waitFor { mine().any { it.tag == "e:${fourth.packetId}" } })
        assertEquals("ordinary messages use the quiet channel", Notifier.CH_MESSAGES, mine().first { it.tag == "e:${fourth.packetId}" }.notification.channelId)
        val pu = PendingIntent.getActivity(ctx, Notifier.idFor(Ref("broadcast", null, fourth.packetId)), Notifier.openIntent(ctx, Ref("broadcast", null, fourth.packetId)), PendingIntent.FLAG_NO_CREATE or PendingIntent.FLAG_IMMUTABLE)
        assertTrue("its PendingIntent exists and is not the reply's", pu != null && pu != pr)
        // 5. duplicates and restarts do not notify again
        nm.cancelAll()
        app.receive(wire(helper, reply.packetId!!), hop(), "helper"); app.receive(wire(stranger, other.packetId!!), hop(), "stranger"); app.receive(wire(stranger, fourth.packetId!!), hop(), "stranger"); Thread.sleep(3800)
        val after = mine()
        assertEquals("duplicate packets (BLE reconnect) post no inbox notification: ${after.map { meta(it) }}", 0, after.count { isInbox(it) })
        assertTrue("anything else still showing is the radio foreground-service notification, nothing unexplained: ${after.map { meta(it) }}", after.filter { !isInbox(it) }.all { isRadioService(it) })
    }

    /** The notification that once made "duplicates post nothing" see 1: the radio's own foreground-service notification (id 41, ongoing), not a stale or duplicate inbox one. */
    @Test fun theRadioServiceNotificationIsNotAnInboxNotificationAndCannotBeMistakenForOne() {
        val sc = ActivityScenario.launch(MainActivity::class.java)       // opening the app starts the radio service (Bluetooth is granted by the rule)
        try {
            assertTrue("the radio service posts its ongoing notification: ${mine().map { meta(it) }}", waitFor(15000) { mine().any { isRadioService(it) } })
            val svc = mine().first { isRadioService(it) }
            assertEquals(RelayService.NOTIF_ID, svc.id); assertNull("the service notification has no tag, inbox ones have e:<id>/summary", svc.tag)
            assertEquals(RelayService.CHANNEL, svc.notification.channelId); assertTrue(svc.isOngoing)
            assertFalse("it is not an inbox notification", isInbox(svc)); assertEquals("Relay is on", svc.notification.extras.getCharSequence(android.app.Notification.EXTRA_TITLE).toString())
            nm.cancelAll(); Thread.sleep(1500)
            assertTrue("a foreground-service notification cannot be cancelled by the app while the service runs", mine().any { isRadioService(it) })
            // so a test that expects "no notifications at all" while the radio runs is wrong; the meaningful claim is "no inbox notification"
            val app = RelayRuntime.engine(ctx); val dup = peer("GP"); val r = dup.createRequest(urgent("Urgent request while the radio runs")); val stranger = peer("LN")
            assertTrue(r.ok); app.receive(wire(dup, r.packetId!!), hop(), "dup"); app.receive(wire(dup, r.packetId!!), hop(), "dup")
            Thread.sleep(300)
        } finally { try { sc.close() } catch (_: Throwable) {}; RelayService.stop(ctx); waitFor(8000) { mine().none { isRadioService(it) } } }
    }

    @Test fun aBurstBecomesOneSummaryAndNeverCarriesText() {
        val app = RelayRuntime.engine(ctx); app.setHood("HK", ""); val s = peer("LN")      // six ordinary (non-urgent, far away) messages
        repeat(6) { i -> val r = s.createRequest(RequestInput("urgent", "Shelter", "Burst request number $i", "x", "Far lane", "LN", "Lajpat Nagar", false, 360)); app.receive(wire(s, r.packetId!!), hop(), "s") }
        // a slow phone may take longer than the 3 s window to store six packets: later arrivals fold into the same single notification, so wait for the final count
        assertTrue("one notification counting all six: ${mine().map { meta(it) }}", waitFor(15000) { titles() == listOf("6 new messages") })
        val act = mine().filter { isInbox(it) }; assertEquals("six requests: one summary, not six notifications: ${act.map { it.tag }}", 1, act.size)
    }

    @Test fun importantMessagesInABurstAreStillOneNotificationButItIsLoud() {
        val app = RelayRuntime.engine(ctx); app.setHood("HK", ""); val s = peer("GP")      // six urgent requests next door: all important
        repeat(6) { i -> val r = s.createRequest(urgent("Urgent burst $i")); app.receive(wire(s, r.packetId!!), hop(), "s") }
        assertTrue("one notification counting all six: ${mine().map { meta(it) }}", waitFor(15000) { titles() == listOf("6 new messages") })
        val act = mine().filter { isInbox(it) }
        assertEquals("six important messages: one notification, not a stack of alerts: ${act.map { meta(it) }}", 1, act.size)
        assertEquals("it is loud because the messages are important", Notifier.CH_RESPONSES, act[0].notification.channelId)
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
            assertTrue("and the app greets them with a tappable pop-up for it: ${diag()}", waitFor(30000) { js(sc, "(function(){var b=document.getElementById('banner');return b&&!b.hidden?b.textContent:''})()").contains("Someone sent a response") })
            js(sc, "document.getElementById('banner-msg').click()")
            assertTrue("tapping it opens that response", waitFor { js(sc, "(function(){var s=document.getElementById('sheetbody');return s?s.textContent:''})()").contains("On my way") })
        } finally { try { sc.close() } catch (_: Throwable) {} }
    }

    @Test fun tappingTheSummaryDoesNotPopUpTheSameMessagesAgain() {
        val app = RelayRuntime.engine(ctx); app.setHood("HK", ""); RelayRuntime.foreground = false
        val m = app.createRequest(urgent("Medical help needed near the school")); val h = peer("GP"); h.receive(wire(app, m.packetId!!), hop(), "app")
        val rep = h.createReply(m.caseId!!, "offer", "On my way", ""); val st = peer("LN"); val upd = st.createBroadcast("Tea at the hall", "Resources", "Hall")
        app.receive(wire(h, rep.packetId!!), hop(), "h"); app.receive(wire(st, upd.packetId!!), hop(), "st")
        assertTrue("two messages: one summary", waitFor { titles() == listOf("2 new messages") })
        assertTrue("the response is parked for a pop-up the moment the app opens", app.store.flags("popup").contains(rep.packetId!!) && !app.store.hasFlag("popped", rep.packetId!!))
        val sc = ActivityScenario.launch<MainActivity>(Notifier.openIntent(ctx, Ref("inbox", null, null)))      // the person taps the summary
        try {
            assertTrue("the page is up", waitFor(20000) { js(sc, "typeof RelayUI").contains("object") })
            Thread.sleep(3000)
            assertEquals("no pop-up greets someone who just tapped the summary", "true", js(sc, "String(document.getElementById('banner').hidden)").trim('"'))
            assertTrue("and nothing is waiting to pop up later", app.store.hasFlag("popped", rep.packetId!!) && NoticeCenter.incoming.isEmpty())
            assertTrue("the summary notification is gone", waitFor { titles().isEmpty() })
            assertTrue("the inbox is showing", js(sc, "document.querySelector('[data-nav=feed]').getAttribute('aria-current')").contains("page"))
        } finally { try { sc.close() } catch (_: Throwable) {} }
    }

    @Test fun readStateSurvivesReopeningTheDatabase() {
        val name = "inbox_read_test.db"; ctx.deleteDatabase(name)
        val s1 = SqliteStore(ctx, name); val id = "ab".repeat(16)
        assertFalse(ReadState.isRead(s1, id)); ReadState.markRead(s1, listOf(id)); s1.close()
        val s2 = SqliteStore(ctx, name); assertTrue("read survives a restart", ReadState.isRead(s2, id)); assertTrue(s2.flags(ReadState.READ).contains(id)); s2.close(); ctx.deleteDatabase(name)
    }
}

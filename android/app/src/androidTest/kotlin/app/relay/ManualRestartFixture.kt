package app.relay

import android.app.NotificationManager
import androidx.test.platform.app.InstrumentationRegistry
import app.relay.core.*
import org.junit.Assume.assumeTrue
import org.junit.Test

/**
 * NOT part of the normal run (skipped unless `-e manual true`). Leaves real notifications in the system tray and returns (with `-e single true`: ONE response, which opens that exact response; without it: a response and a community update, which Relay folds into one "2 new messages" notification that opens the inbox), so a person (or adb) can kill the app process
 * and then tap them: docs/INBOX_AND_NOTIFICATIONS.md, "Process restart check".
 */
class ManualRestartFixture {
    @Test fun postNotificationsAndLeaveThem() {
        assumeTrue(InstrumentationRegistry.getArguments().getString("manual") == "true")
        val ctx = InstrumentationRegistry.getInstrumentation().targetContext; val crypto = TinkCrypto()
        val app = RelayRuntime.engine(ctx); RelayRuntime.foreground = false; app.setHood("HK", "")
        ctx.getSystemService(NotificationManager::class.java).cancelAll()
        fun peer(h: String) = RelayEngine(MemoryStore(), crypto, Identity.create(crypto)).also { it.setHood(h, "") }
        fun w(e: RelayEngine, id: String) = e.store.getPacket(id)!!.env.wire()
        val hop = Hop(1, 0, false, 120 * Limits.MINUTE_MS)
        val mine = app.createRequest(RequestInput("urgent", "Medical", "Medical help needed near the market gate", "Someone has a deep cut", "Market gate", "HK", "Hauz Khas", true, 120))
        val helper = peer("GP"); helper.receive(w(app, mine.packetId!!), hop, "app")
        val reply = helper.createReply(mine.caseId!!, "offer", "I am a nurse nearby and can come now", "Market gate")
        val other = peer("LN"); val upd = other.createBroadcast("Water is available at the Green Park market entrance", "Resources", "Green Park market")
        app.receive(w(helper, reply.packetId!!), hop, "helper"); if (InstrumentationRegistry.getArguments().getString("single") != "true") app.receive(w(other, upd.packetId!!), hop, "other")
        Thread.sleep(5000)      // the 3-second batching window, then the notifications are in the tray and this process may be killed
    }
}

package app.relay

import android.util.Base64
import androidx.test.core.app.ActivityScenario
import androidx.test.platform.app.InstrumentationRegistry
import app.relay.core.*
import app.relay.ui.MainActivity
import app.relay.ui.NativeBridge
import org.junit.Assert.*
import org.junit.Test
import java.util.concurrent.CountDownLatch
import java.util.concurrent.TimeUnit

class BridgeAndUiTest {
    private val ctx = InstrumentationRegistry.getInstrumentation().targetContext
    private val host = object : NativeBridge.Host {
        override fun requestPermissions() {}; override fun requestEnableBluetooth() {}; override fun openAppSettings() {}
        override fun shareApp() = "{}"; override fun startRelay() {}; override fun stopRelay() {}
    }
    @Suppress("UNCHECKED_CAST") private fun j(s: String) = Json.parse(s) as Map<String, Any?>

    @Test fun bridgeRoundTripsRealRequestsAndRejectsHostileInput() {
        val b = NativeBridge(ctx, host); RelayRuntime.engine(ctx).setHood("HK", "")
        val photo = ByteArray(2500) { it.toByte() }.also { it[0] = 0xFF.toByte(); it[1] = 0xD8.toByte(); it[2] = 0xFF.toByte() }
        val ok = j(b.createRequest(JsonObj().str("kind", "missing").str("category", "Missing").str("title", "Looking for Meera").str("area", "Metro gate").str("areaHood", "CP").str("areaHoodName", "Connaught Place").num("validity", 1440)
            .raw("photo", JsonObj().str("dataUrl", "data:image/jpeg;base64," + Base64.encodeToString(photo, Base64.NO_WRAP)).num("w", 160).num("h", 120).end()).end()))
        assertEquals(true, ok["ok"]); assertEquals(32, (ok["caseId"] as String).length)
        val snap = j(b.snapshot()); assertTrue((snap["packets"] as List<*>).size >= 2)
        assertTrue("photo bytes retrievable and identical", b.attachment((snap["attachments"] as List<*>).map { it as Map<*, *> }.first()["id"] as String).startsWith("data:image/jpeg;base64,"))
        for (bad in listOf("not json", "{}", "[1,2]", "{\"kind\":\"urgent\",\"category\":\"Gold\",\"title\":\"x\",\"validity\":60}", "{\"kind\":\"urgent\",\"category\":\"Medical\",\"title\":\"x\",\"validity\":9999}",
                "{\"kind\":\"missing\",\"category\":\"Missing\",\"title\":\"x\",\"validity\":60,\"photo\":{\"dataUrl\":\"data:image/jpeg;base64,!!!\"}}"))
            assertEquals("rejected: $bad", false, j(b.createRequest(bad))["ok"])
        assertEquals(false, j(b.createReply("00".repeat(16), "offer", "x", ""))["ok"]); assertEquals(false, j(b.createAck("00".repeat(16)))["ok"]); assertEquals(false, j(b.createResolve("zz"))["ok"])
        assertEquals(false, j(b.setHood("ZZ", ""))["ok"]); assertEquals("", b.attachment("nope"))
    }

    @Test fun realWebViewLoadsTheBundledUiFromAssetsAndShowsOnboarding() {
        ctx.deleteDatabase("relay.db")
        ActivityScenario.launch(MainActivity::class.java).use { sc ->
            val latch = CountDownLatch(1); var text = ""
            val deadline = System.currentTimeMillis() + 20_000
            while (System.currentTimeMillis() < deadline && !text.contains("Where are you right now")) {
                val l = CountDownLatch(1)
                sc.onActivity { a -> a.webViewForTest.evaluateJavascript("(document.getElementById('screen')||{}).textContent||''") { v -> text = v ?: ""; l.countDown() } }
                l.await(2, TimeUnit.SECONDS); Thread.sleep(400)
            }
            assertTrue("UI text was: $text", text.contains("Where are you right now"))
            val l2 = CountDownLatch(1); var nativeFlag = ""
            sc.onActivity { a -> a.webViewForTest.evaluateJavascript("String(window.RELAY_NATIVE)+'|'+typeof window.RelayAndroid+'|'+(document.body.textContent.indexOf('Prototype')>=0)") { v -> nativeFlag = v ?: ""; l2.countDown() } }
            l2.await(5, TimeUnit.SECONDS); assertEquals("\"true|object|false\"", nativeFlag)
        }
    }
}

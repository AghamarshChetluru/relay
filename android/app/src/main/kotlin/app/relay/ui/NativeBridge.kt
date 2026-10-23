package app.relay.ui

import android.content.Context
import android.util.Base64
import android.webkit.JavascriptInterface
import app.relay.RelayRuntime
import app.relay.core.*

/**
 * The ONLY door between the WebView and the engine. Exposed to our own bundled pages only (the WebView refuses any other origin).
 * Every method validates its input again natively; the page is not trusted to enforce limits. All methods return a JSON string.
 */
class NativeBridge(private val ctx: Context, private val host: Host) {
    interface Host {
        fun requestPermissions(); fun requestEnableBluetooth(); fun openAppSettings(); fun shareApp(): String; fun startRelay(); fun stopRelay()
    }
    private val engine get() = RelayRuntime.engine(ctx)

    private fun res(o: Outcome) = JsonObj().bool("ok", o.ok).str("error", o.error).str("caseId", o.caseId).str("packetId", o.packetId).end()
    private fun fail(msg: String) = JsonObj().bool("ok", false).str("error", msg).str("caseId", null).str("packetId", null).end()
    @Suppress("UNCHECKED_CAST") private fun obj(s: String): Map<String, Any?>? = try { Json.parse(s) as? Map<String, Any?> } catch (e: WireException) { null }
    private fun str(m: Map<String, Any?>, k: String, d: String = "") = (m[k] as? String) ?: d
    private fun int(m: Map<String, Any?>, k: String, d: Int = 0) = (m[k] as? Number)?.toInt() ?: d

    @JavascriptInterface fun snapshot(): String = RelayRuntime.snapshot(ctx)

    @JavascriptInterface fun createRequest(json: String): String {
        val m = obj(json) ?: return fail("bad request")
        val photoUrl = (m["photo"] as? Map<*, *>)?.get("dataUrl") as? String
        var photo: ByteArray? = null
        if (photoUrl != null) photo = try { Base64.decode(photoUrl.substringAfter("base64,"), Base64.DEFAULT) } catch (e: IllegalArgumentException) { return fail("bad photo") }
        val pa = m["privateAddress"] as? Map<*, *>
        val targets = (m["targets"] as? List<*>)?.filterIsInstance<String>()
        val ph = m["photo"] as? Map<*, *>
        return res(engine.createRequest(RequestInput(
            kind = str(m, "kind"), category = str(m, "category"), title = str(m, "title"), description = str(m, "description"), area = str(m, "area"),
            areaHood = str(m, "areaHood").ifEmpty { null }, areaHoodName = str(m, "areaHoodName"), urgent = m["urgent"] == true, validityMin = int(m, "validity", 60),
            lastKnown = str(m, "lastKnown"), lastContact = str(m, "lastContact"), note = str(m, "note"), targets = targets,
            privateBuilding = (pa?.get("building") as? String) ?: "", privateDirections = (pa?.get("directions") as? String) ?: "",
            photo = photo, photoW = (ph?.get("w") as? Number)?.toInt() ?: 0, photoH = (ph?.get("h") as? Number)?.toInt() ?: 0)).also { nudge() })
    }
    @JavascriptInterface fun renewRequest(caseId: String, json: String): String {
        val m = obj(json) ?: return fail("bad request")
        return res(engine.renewRequest(caseId, RenewInput(validityMin = (m["validity"] as? Number)?.toInt(), description = m["description"] as? String,
            targets = (m["targets"] as? List<*>)?.filterIsInstance<String>(), area = m["area"] as? String, lastKnown = m["lastKnown"] as? String,
            lastContact = m["lastContact"] as? String, note = m["note"] as? String)).also { nudge() })
    }
    @JavascriptInterface fun createReply(caseId: String, kind: String, note: String, area: String) = res(engine.createReply(caseId, kind, note, area).also { nudge() })
    @JavascriptInterface fun createAck(replyId: String) = res(engine.createAck(replyId).also { nudge() })
    @JavascriptInterface fun createResolve(caseId: String) = res(engine.createResolve(caseId).also { nudge() })
    @JavascriptInterface fun createBroadcast(json: String): String { val m = obj(json) ?: return fail("bad request"); return res(engine.createBroadcast(str(m, "text"), str(m, "category", "Community"), str(m, "area")).also { nudge() }) }
    @JavascriptInterface fun shareAddress(replyId: String) = res(engine.shareAddress(replyId).also { nudge() })
    @JavascriptInterface fun setHood(id: String, name: String) = res(engine.setHood(id.ifEmpty { null }, name))
    @JavascriptInterface fun confirmHood(): String { engine.confirmHood(); return res(Outcome.ok(null, null)) }
    @JavascriptInterface fun hide(caseId: String): String { engine.store.setFlag("hidden", caseId); RelayRuntime.notifyChanged(); return res(Outcome.ok(null, null)) }
    @JavascriptInterface fun notRelevant(packetId: String): String { engine.store.setFlag("notRelevant", packetId); RelayRuntime.notifyChanged(); return res(Outcome.ok(null, null)) }

    /** Photo bytes as a data URL, only if fully received and hash-verified. */
    @JavascriptInterface fun attachment(id: String): String {
        val m = engine.store.getAttachmentMeta(id) ?: return ""; if (!m.complete) return ""
        val b = engine.store.attachmentBytes(id) ?: return ""; return "data:image/jpeg;base64," + Base64.encodeToString(b, Base64.NO_WRAP)
    }

    @JavascriptInterface fun requestPermissions() = host.requestPermissions()
    @JavascriptInterface fun requestEnableBluetooth() = host.requestEnableBluetooth()
    @JavascriptInterface fun openAppSettings() = host.openAppSettings()
    @JavascriptInterface fun startRelay() = host.startRelay()
    @JavascriptInterface fun stopRelay() = host.stopRelay()
    @JavascriptInterface fun shareApp(): String = host.shareApp()
    private fun nudge() { try { RelayRuntime.ble(ctx).nudge() } catch (_: Exception) {} }
}

package app.relay.ui

import android.annotation.SuppressLint
import android.app.Activity
import android.bluetooth.BluetoothAdapter
import android.content.Intent
import android.content.pm.ApplicationInfo
import android.net.Uri
import android.os.Build
import android.os.Bundle
import android.os.Handler
import android.os.Looper
import android.provider.Settings
import android.webkit.*
import androidx.webkit.WebViewAssetLoader
import app.relay.RelayRuntime
import app.relay.ble.BleTransport
import app.relay.core.JsonObj
import app.relay.service.RelayService
import app.relay.share.ApkShare

/** Hosts the existing mobile UI (bundled assets, served from a local https origin; no network, no file access). */
class MainActivity : Activity(), NativeBridge.Host {
    private lateinit var web: WebView
    internal val webViewForTest: WebView get() = web
    private val main = Handler(Looper.getMainLooper())
    private companion object { const val REQ_PHOTO = 9 }
    private var pendingPush = false
    private var fileCallback: ValueCallback<Array<Uri>>? = null      // photo picker for <input type=file>; must ALWAYS be answered or the input stays dead
    private val listener: () -> Unit = {
        if (!pendingPush) { pendingPush = true; main.postDelayed({ pendingPush = false; push() }, 250) }
    }

    @SuppressLint("SetJavaScriptEnabled")
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        val debuggable = (applicationInfo.flags and ApplicationInfo.FLAG_DEBUGGABLE) != 0
        WebView.setWebContentsDebuggingEnabled(debuggable)
        web = WebView(this)
        web.settings.apply {
            javaScriptEnabled = true; domStorageEnabled = true; allowFileAccess = false; allowContentAccess = false
            setSupportZoom(false); mediaPlaybackRequiresUserGesture = true; cacheMode = WebSettings.LOAD_NO_CACHE
        }
        val loader = WebViewAssetLoader.Builder().addPathHandler("/assets/", WebViewAssetLoader.AssetsPathHandler(this)).build()
        web.webViewClient = object : WebViewClient() {
            override fun shouldInterceptRequest(v: WebView, r: WebResourceRequest): WebResourceResponse? = loader.shouldInterceptRequest(r.url)
            override fun shouldOverrideUrlLoading(v: WebView, r: WebResourceRequest): Boolean = r.url.host != "appassets.androidplatform.net"   // never navigate away from our own pages
        }
        // Without this, <input type=file> silently does nothing in a WebView and photos could never be attached. Images only, via the system picker (no storage permission).
        web.webChromeClient = object : WebChromeClient() {
            override fun onShowFileChooser(v: WebView, cb: ValueCallback<Array<Uri>>, p: FileChooserParams): Boolean {
                fileCallback?.onReceiveValue(null); fileCallback = cb
                return try {
                    startActivityForResult(Intent.createChooser(Intent(Intent.ACTION_GET_CONTENT).addCategory(Intent.CATEGORY_OPENABLE).setType("image/*"), "Choose a photo"), REQ_PHOTO); true
                } catch (e: Exception) { fileCallback = null; cb.onReceiveValue(null); false }
            }
        }
        web.addJavascriptInterface(NativeBridge(this, this), "RelayAndroid")
        setContentView(web)
        web.loadUrl("https://appassets.androidplatform.net/assets/web/app.html")
        RelayRuntime.engine(this)
        if (getSharedPreferences("relay", MODE_PRIVATE).getBoolean("enabled", true)) startRelay()
    }

    override fun onResume() { super.onResume(); RelayRuntime.listeners.add(listener); push() }
    override fun onPause() { RelayRuntime.listeners.remove(listener); super.onPause() }
    @Deprecated("system back goes to background so the radio service is not interrupted") override fun onBackPressed() { moveTaskToBack(true) }

    private fun push() { if (::web.isInitialized) web.evaluateJavascript("window.__relayChanged&&window.__relayChanged()", null) }

    // ---- NativeBridge.Host
    override fun requestPermissions() {
        runOnUiThread {
            val need = (BleTransport.requiredPermissions().toList() + (if (Build.VERSION.SDK_INT >= 33) listOf(android.Manifest.permission.POST_NOTIFICATIONS) else emptyList()))
                .filter { checkSelfPermission(it) != android.content.pm.PackageManager.PERMISSION_GRANTED }
            if (need.isEmpty()) { startRelay(); push() } else requestPermissions(need.toTypedArray(), 7)
        }
    }
    override fun onRequestPermissionsResult(requestCode: Int, permissions: Array<out String>, grantResults: IntArray) {
        super.onRequestPermissionsResult(requestCode, permissions, grantResults); startRelay(); RelayRuntime.notifyChanged()
    }
    override fun requestEnableBluetooth() {
        runOnUiThread {
            if (Build.VERSION.SDK_INT >= 31 && checkSelfPermission(android.Manifest.permission.BLUETOOTH_CONNECT) != android.content.pm.PackageManager.PERMISSION_GRANTED) { requestPermissions(); return@runOnUiThread }
            try { startActivityForResult(Intent(BluetoothAdapter.ACTION_REQUEST_ENABLE), 8) } catch (_: Exception) { startActivity(Intent(Settings.ACTION_BLUETOOTH_SETTINGS)) }
        }
    }
    @Deprecated("photo picker result and refresh after the system Bluetooth prompt") override fun onActivityResult(requestCode: Int, resultCode: Int, data: Intent?) {
        super.onActivityResult(requestCode, resultCode, data)
        if (requestCode == REQ_PHOTO) { fileCallback?.onReceiveValue(WebChromeClient.FileChooserParams.parseResult(resultCode, data)); fileCallback = null; return }   // null when cancelled
        startRelay(); RelayRuntime.notifyChanged()
    }
    override fun onDestroy() { fileCallback?.onReceiveValue(null); fileCallback = null; super.onDestroy() }
    override fun openAppSettings() { runOnUiThread { startActivity(Intent(Settings.ACTION_APPLICATION_DETAILS_SETTINGS, Uri.fromParts("package", packageName, null))) } }
    override fun startRelay() { RelayService.start(this); RelayRuntime.ble(this).start() }
    override fun stopRelay() { RelayService.stop(this) }
    /** Field-test report: counters + short event phrases + phone model. Contains no message text, addresses, IDs or keys (see core/Diagnostics.kt). The user picks where it goes. */
    override fun shareDiagnostics(): String = try {
        val ble = RelayRuntime.ble(this); val st = ble.status()
        val header = listOf("App: ${packageManager.getPackageInfo(packageName, 0).versionName}", "Phone: ${Build.MANUFACTURER} ${Build.MODEL}", "Android: ${Build.VERSION.RELEASE} (API ${Build.VERSION.SDK_INT})",
            "Bluetooth LE: ${st.bluetoothSupported}, enabled: ${st.bluetoothEnabled}, permissions: ${st.permissionsGranted}, can advertise: ${st.canAdvertise}",
            "Radio running: ${st.serviceRunning}, scanning: ${st.scanning}, advertising: ${st.advertising}, last problem: ${st.lastError.ifEmpty { "none" }}")
        val text = ble.diag.report(header)
        runOnUiThread { startActivity(Intent.createChooser(Intent(Intent.ACTION_SEND).setType("text/plain").putExtra(Intent.EXTRA_SUBJECT, "Relay diagnostics").putExtra(Intent.EXTRA_TEXT, text), "Share diagnostics")) }
        JsonObj().bool("ok", true).str("error", null).end()
    } catch (e: Exception) { JsonObj().bool("ok", false).str("error", "Could not prepare the report").end() }
    override fun shareApp(): String = try {
        val p = ApkShare.prepare(this); runOnUiThread { startActivity(ApkShare.intent(this, p)) }
        JsonObj().bool("ok", true).str("sha256", p.sha256).num("bytes", p.bytes).str("error", null).end()
    } catch (e: Exception) { JsonObj().bool("ok", false).str("error", "Could not prepare the app file").str("sha256", null).num("bytes", 0).end() }
}

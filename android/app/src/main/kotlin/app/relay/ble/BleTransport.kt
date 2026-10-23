package app.relay.ble

import android.Manifest
import android.annotation.SuppressLint
import android.bluetooth.*
import android.bluetooth.le.*
import android.content.*
import android.content.pm.PackageManager
import android.os.*
import app.relay.core.*
import java.util.UUID
import java.util.concurrent.ConcurrentHashMap

/**
 * Bluetooth LE transport (docs/TRANSPORT_ADR.md). Every phone is a GATT server (INBOX write / OUTBOX notify), advertises the Relay service
 * when the hardware allows, scans in duty cycles, and connects to peers following a deterministic role rule. Each connection runs one
 * [LinkSession]. UNVERIFIED ON PHYSICAL RADIOS: see QA_REPORT.md. All callbacks are marshalled onto one worker thread.
 */
@SuppressLint("MissingPermission")   // every entry point checks hasPermissions() first
class BleTransport(private val ctx: Context, private val engine: RelayEngine, private val onStatus: () -> Unit) {
    companion object {
        val SERVICE: UUID = UUID.fromString("7e5a1c00-8f3b-4d6e-9a41-52c0de3a77b1")
        val INBOX: UUID = UUID.fromString("7e5a1c01-8f3b-4d6e-9a41-52c0de3a77b1")
        val OUTBOX: UUID = UUID.fromString("7e5a1c02-8f3b-4d6e-9a41-52c0de3a77b1")
        val CCCD: UUID = UUID.fromString("00002902-0000-1000-8000-00805f9b34fb")
        const val COMPANY_ID = 0xFFFF            // reserved for testing/internal use; a production build must use a registered ID
        const val SCAN_WINDOW_MS = 10_000L; const val SCAN_PERIOD_MS = 60_000L; const val BURST_PERIOD_MS = 20_000L
        const val MAX_SESSIONS = 2; const val COOLDOWN_MS = 60_000L; const val MAX_BACKOFF_MS = 10 * 60_000L
        const val IDLE_TIMEOUT_MS = 20_000L; const val SESSION_TIMEOUT_MS = 120_000L; const val CONNECT_TIMEOUT_MS = 15_000L
        const val RECENT_PEER_MS = 2 * 60_000L; const val DESIRED_MTU = 247

        fun requiredPermissions(): Array<String> =
            if (Build.VERSION.SDK_INT >= 31) arrayOf(Manifest.permission.BLUETOOTH_SCAN, Manifest.permission.BLUETOOTH_ADVERTISE, Manifest.permission.BLUETOOTH_CONNECT)
            else arrayOf(Manifest.permission.ACCESS_FINE_LOCATION)     // Android <= 11 ties BLE scanning to the location permission; Relay never reads location
    }

    private val worker = HandlerThread("relay-ble").also { it.start() }
    private val h = Handler(worker.looper)
    private val btManager = ctx.getSystemService(Context.BLUETOOTH_SERVICE) as BluetoothManager
    private val adapter: BluetoothAdapter? get() = btManager.adapter

    @Volatile private var running = false
    private var server: BluetoothGattServer? = null
    private var advertising = false; private var scanning = false; private var lastError = ""
    private var lastContactMs = 0L; private var adCallback: AdvertiseCallback? = null; private var lastAdDigest = -1
    private val links = ConcurrentHashMap<String, Link>()             // key: device address
    private val seenTags = ConcurrentHashMap<String, Long>()          // tag hex -> last seen ms
    private class Memory(var lastAttempt: Long = 0, var fails: Int = 0, var theirDigest: Int = -1, var myDigest: Int = -1, var lastSession: Long = 0)
    private val memory = ConcurrentHashMap<String, Memory>()

    fun hasPermissions(): Boolean = requiredPermissions().all { ctx.checkSelfPermission(it) == PackageManager.PERMISSION_GRANTED }
    private fun bleSupported() = ctx.packageManager.hasSystemFeature(PackageManager.FEATURE_BLUETOOTH_LE) && adapter != null
    private fun canAdvertise() = adapter?.isMultipleAdvertisementSupported == true && adapter?.bluetoothLeAdvertiser != null

    fun status(): RadioStatus {
        val now = System.currentTimeMillis()
        val recent = seenTags.entries.filter { now - it.value < RECENT_PEER_MS }.map { it.key }
        return RadioStatus(bleSupported(), adapter?.isEnabled == true, hasPermissions(), canAdvertise(), scanning, advertising, running, recent, links.values.count { it.session != null && !it.session!!.closed }, lastContactMs, lastError)
    }

    private val stateReceiver = object : BroadcastReceiver() {
        override fun onReceive(c: Context, i: Intent) {
            if (i.action != BluetoothAdapter.ACTION_STATE_CHANGED) return
            when (i.getIntExtra(BluetoothAdapter.EXTRA_STATE, -1)) {
                BluetoothAdapter.STATE_OFF -> h.post { stopRadio("Bluetooth turned off"); onStatus() }
                BluetoothAdapter.STATE_ON -> h.post { if (running) startRadio() }
            }
        }
    }
    private var receiverRegistered = false

    /** Idempotent. Returns false (with [status] explaining why) if the radio cannot run right now; storage and UI keep working regardless. */
    fun start(): Boolean {
        if (!receiverRegistered) { ctx.registerReceiver(stateReceiver, IntentFilter(BluetoothAdapter.ACTION_STATE_CHANGED)); receiverRegistered = true }
        running = true; engine.canAdvertise = canAdvertise()
        h.post { startRadio(); onStatus() }
        return hasPermissions() && adapter?.isEnabled == true
    }
    fun stop() { running = false; h.post { stopRadio("stopped by user"); onStatus() }; if (receiverRegistered) { try { ctx.unregisterReceiver(stateReceiver) } catch (_: Exception) {}; receiverRegistered = false } }

    // ------------------------------------------------------------------ radio lifecycle
    private fun startRadio() {
        if (!running) return
        if (!bleSupported()) { lastError = "This phone has no Bluetooth LE"; return }
        if (!hasPermissions()) { lastError = "Bluetooth permission not granted"; return }
        if (adapter?.isEnabled != true) { lastError = "Bluetooth is off"; return }
        lastError = ""; engine.canAdvertise = canAdvertise()
        try {
            if (server == null) openServer()
            scheduleScan(0)
        } catch (e: SecurityException) { lastError = "Permission revoked" } catch (e: Exception) { lastError = "Radio start failed: ${e.javaClass.simpleName}" }
    }

    private fun stopRadio(reason: String) {
        h.removeCallbacksAndMessages(null)
        try { stopScan() } catch (_: Exception) {}
        try { stopAdvertising() } catch (_: Exception) {}
        links.values.toList().forEach { it.teardown("radio stopped") }
        try { server?.close() } catch (_: Exception) {}; server = null
        if (reason.isNotEmpty() && !running) lastError = ""
    }

    // ------------------------------------------------------------------ identity tag (rotating: no stable identifier on air)
    private fun myTag(): ByteArray = tagFor(engine.identity.deviceId)
    private fun tagFor(deviceId: String): ByteArray = sha256(deviceId.unhex(), Writer().u64(System.currentTimeMillis() / 3_600_000L).toByteArray()).copyOf(4)
    private fun cmp(a: ByteArray, b: ByteArray): Int { for (i in a.indices) { val d = (a[i].toInt() and 0xff) - (b[i].toInt() and 0xff); if (d != 0) return d }; return 0 }

    // ------------------------------------------------------------------ advertising
    private fun refreshAdvertising() {
        if (!running || !canAdvertise() || adapter?.isEnabled != true) return
        val dg = engine.inventoryDigest()
        if (advertising && dg == lastAdDigest) return
        try { stopAdvertising() } catch (_: Exception) {}
        val adv = adapter!!.bluetoothLeAdvertiser ?: return
        val settings = AdvertiseSettings.Builder().setAdvertiseMode(AdvertiseSettings.ADVERTISE_MODE_LOW_POWER).setTxPowerLevel(AdvertiseSettings.ADVERTISE_TX_POWER_MEDIUM).setConnectable(true).setTimeout(0).build()
        val data = AdvertiseData.Builder().setIncludeDeviceName(false).setIncludeTxPowerLevel(false).addServiceUuid(ParcelUuid(SERVICE)).build()
        val tag = myTag() + byteArrayOf((dg ushr 8).toByte(), dg.toByte())
        val scanResp = AdvertiseData.Builder().setIncludeDeviceName(false).addManufacturerData(COMPANY_ID, tag).build()
        val cb = object : AdvertiseCallback() {
            override fun onStartSuccess(s: AdvertiseSettings) { advertising = true; lastAdDigest = dg; onStatus() }
            override fun onStartFailure(errorCode: Int) { advertising = false; lastError = "Advertising failed ($errorCode)"; onStatus() }
        }
        adCallback = cb; adv.startAdvertising(settings, data, scanResp, cb)
    }
    private fun stopAdvertising() { adCallback?.let { adapter?.bluetoothLeAdvertiser?.stopAdvertising(it) }; adCallback = null; advertising = false }

    // ------------------------------------------------------------------ scanning (duty cycled)
    private val scanCb = object : ScanCallback() {
        override fun onScanResult(callbackType: Int, r: ScanResult) { val dev = r.device; val rec = r.scanRecord; h.post { onSighting(dev, rec) } }
        override fun onScanFailed(errorCode: Int) { scanning = false; lastError = "Scan failed ($errorCode)"; onStatus() }
    }
    private var burstUntil = 0L
    // ONE scan loop, ever: start() may be called several times (activity + service), so scheduling always replaces the pending tick.
    private val scanTick = object : Runnable {
        override fun run() {
            if (!running || adapter?.isEnabled != true || !hasPermissions()) return
            try {
                refreshAdvertising(); startScan()
                h.removeCallbacks(stopScanTick); h.postDelayed(stopScanTick, SCAN_WINDOW_MS)
            } catch (e: SecurityException) { lastError = "Permission revoked" } catch (e: Exception) { lastError = "Scan error: ${e.javaClass.simpleName}" }
            val period = if (System.currentTimeMillis() < burstUntil) BURST_PERIOD_MS else SCAN_PERIOD_MS
            scheduleScan(period)
        }
    }
    private val stopScanTick = Runnable { try { stopScan() } catch (_: Exception) {}; housekeeping() }
    private fun scheduleScan(delay: Long) { h.removeCallbacks(scanTick); h.postDelayed(scanTick, delay) }
    private fun startScan() {
        val sc = adapter?.bluetoothLeScanner ?: return
        if (scanning) return
        val filters = listOf(ScanFilter.Builder().setServiceUuid(ParcelUuid(SERVICE)).build())
        sc.startScan(filters, ScanSettings.Builder().setScanMode(ScanSettings.SCAN_MODE_LOW_POWER).build(), scanCb); scanning = true; onStatus()
    }
    private fun stopScan() { if (scanning) { adapter?.bluetoothLeScanner?.stopScan(scanCb); scanning = false; onStatus() } }
    /** Call when new local data exists (a post, a reply): shortens the scan period for a few minutes so it leaves sooner. */
    fun nudge() { burstUntil = System.currentTimeMillis() + 3 * 60_000L; h.post { if (running) { refreshAdvertising() } } }

    private fun onSighting(dev: BluetoothDevice, rec: ScanRecord?) {
        val md = rec?.getManufacturerSpecificData(COMPANY_ID) ?: return
        if (md.size != 6) return
        val tag = md.copyOf(4); val digest = ((md[4].toInt() and 0xff) shl 8) or (md[5].toInt() and 0xff); val key = tag.hex()
        seenTags[key] = System.currentTimeMillis(); onStatus()
        if (!running || links.values.any { it.tagKey == key } || links.size >= MAX_SESSIONS) return
        val mem = memory.getOrPut(key) { Memory() }; val now = System.currentTimeMillis()
        val backoff = minOf(MAX_BACKOFF_MS, COOLDOWN_MS shl minOf(mem.fails, 4))
        if (now - mem.lastAttempt < backoff) return
        // role rule: scan-only phones always initiate; otherwise the smaller tag initiates (avoids two simultaneous connections)
        val iInitiate = !canAdvertise() || cmp(myTag(), tag) < 0
        if (!iInitiate) return
        val myDigest = engine.inventoryDigest()
        if (digest == mem.theirDigest && myDigest == mem.myDigest && now - mem.lastSession < 10 * 60_000L) return    // nothing changed on either side
        mem.lastAttempt = now; connect(dev, key, digest)
    }

    private fun connect(dev: BluetoothDevice, tagKey: String, theirDigest: Int) {
        val link = Link(dev.address, tagKey, theirDigest, client = true); links[dev.address] = link
        link.gatt = dev.connectGatt(ctx, false, link.clientCb, BluetoothDevice.TRANSPORT_LE)
        h.postDelayed({ if (link.session == null && links[dev.address] === link) { memory[tagKey]?.let { it.fails++ }; link.teardown("connect timeout") } }, CONNECT_TIMEOUT_MS)
        onStatus()
    }

    private fun housekeeping() { val now = System.currentTimeMillis(); seenTags.entries.removeIf { now - it.value > 30 * 60_000L }; engine.housekeeping(); onStatus() }

    // ------------------------------------------------------------------ GATT server
    private fun openServer() {
        val srv = btManager.openGattServer(ctx, serverCb) ?: throw IllegalStateException("no gatt server")
        val svc = BluetoothGattService(SERVICE, BluetoothGattService.SERVICE_TYPE_PRIMARY)
        svc.addCharacteristic(BluetoothGattCharacteristic(INBOX, BluetoothGattCharacteristic.PROPERTY_WRITE, BluetoothGattCharacteristic.PERMISSION_WRITE))
        val out = BluetoothGattCharacteristic(OUTBOX, BluetoothGattCharacteristic.PROPERTY_NOTIFY, BluetoothGattCharacteristic.PERMISSION_READ)
        out.addDescriptor(BluetoothGattDescriptor(CCCD, BluetoothGattDescriptor.PERMISSION_READ or BluetoothGattDescriptor.PERMISSION_WRITE))
        svc.addCharacteristic(out); server = srv; srv.addService(svc)
    }
    private val serverCb = object : BluetoothGattServerCallback() {
        override fun onServiceAdded(status: Int, service: BluetoothGattService) { h.post { if (status == BluetoothGatt.GATT_SUCCESS) refreshAdvertising() else lastError = "Service add failed ($status)"; onStatus() } }
        override fun onConnectionStateChange(device: BluetoothDevice, status: Int, newState: Int) {
            h.post {
                if (newState == BluetoothProfile.STATE_CONNECTED) { if (links.size >= MAX_SESSIONS) { server?.cancelConnection(device); return@post }; links[device.address] = Link(device.address, "", -1, client = false).also { it.device = device } }
                else links[device.address]?.teardown("peer disconnected")
            }
        }
        override fun onMtuChanged(device: BluetoothDevice, mtu: Int) { h.post { links[device.address]?.mtu = mtu } }
        override fun onDescriptorWriteRequest(device: BluetoothDevice, requestId: Int, d: BluetoothGattDescriptor, prepared: Boolean, needResponse: Boolean, offset: Int, value: ByteArray) {
            h.post {
                if (needResponse) server?.sendResponse(device, requestId, BluetoothGatt.GATT_SUCCESS, 0, null)
                if (d.uuid == CCCD && value.contentEquals(BluetoothGattDescriptor.ENABLE_NOTIFICATION_VALUE)) links[device.address]?.beginSession()
            }
        }
        override fun onCharacteristicWriteRequest(device: BluetoothDevice, requestId: Int, c: BluetoothGattCharacteristic, prepared: Boolean, needResponse: Boolean, offset: Int, value: ByteArray) {
            h.post { if (needResponse) server?.sendResponse(device, requestId, BluetoothGatt.GATT_SUCCESS, 0, null); if (c.uuid == INBOX && !prepared) links[device.address]?.onBytes(value) }
        }
        override fun onNotificationSent(device: BluetoothDevice, status: Int) { h.post { links[device.address]?.onWritten(status == BluetoothGatt.GATT_SUCCESS) } }
    }

    // ------------------------------------------------------------------ one connection = one session
    private inner class Link(val address: String, var tagKey: String, val theirDigest: Int, val client: Boolean) : LinkIo {
        var gatt: BluetoothGatt? = null; var device: BluetoothDevice? = null; var mtu = 23
        var session: LinkSession? = null; private val asm = StreamAssembler(); private val outQueue = ArrayDeque<ByteArray>(); private var writing = false
        private var lastActivity = System.currentTimeMillis(); private val startedAt = System.currentTimeMillis(); private var done = false
        private var inboxChar: BluetoothGattCharacteristic? = null; private var outboxChar: BluetoothGattCharacteristic? = null
        private fun payload() = maxOf(20, minOf(mtu - 3, 244))

        val clientCb = object : BluetoothGattCallback() {
            override fun onConnectionStateChange(g: BluetoothGatt, status: Int, newState: Int) {
                h.post { if (newState == BluetoothProfile.STATE_CONNECTED && status == BluetoothGatt.GATT_SUCCESS) { if (!g.requestMtu(DESIRED_MTU)) g.discoverServices() } else { if (session == null) memory[tagKey]?.let { it.fails++ }; teardown("disconnected ($status)") } }
            }
            override fun onMtuChanged(g: BluetoothGatt, m: Int, status: Int) { h.post { if (status == BluetoothGatt.GATT_SUCCESS) mtu = m; g.discoverServices() } }
            override fun onServicesDiscovered(g: BluetoothGatt, status: Int) {
                h.post {
                    val svc = g.getService(SERVICE); inboxChar = svc?.getCharacteristic(INBOX); outboxChar = svc?.getCharacteristic(OUTBOX)
                    if (status != BluetoothGatt.GATT_SUCCESS || inboxChar == null || outboxChar == null) { memory[tagKey]?.let { it.fails++ }; teardown("not a Relay peer"); return@post }
                    g.setCharacteristicNotification(outboxChar, true)
                    val cccd = outboxChar!!.getDescriptor(CCCD)
                    if (Build.VERSION.SDK_INT >= 33) g.writeDescriptor(cccd, BluetoothGattDescriptor.ENABLE_NOTIFICATION_VALUE) else { @Suppress("DEPRECATION") cccd.value = BluetoothGattDescriptor.ENABLE_NOTIFICATION_VALUE; @Suppress("DEPRECATION") g.writeDescriptor(cccd) }
                }
            }
            override fun onDescriptorWrite(g: BluetoothGatt, d: BluetoothGattDescriptor, status: Int) { h.post { if (status == BluetoothGatt.GATT_SUCCESS) beginSession() else teardown("subscribe failed ($status)") } }
            override fun onCharacteristicWrite(g: BluetoothGatt, c: BluetoothGattCharacteristic, status: Int) { h.post { onWritten(status == BluetoothGatt.GATT_SUCCESS) } }
            override fun onCharacteristicChanged(g: BluetoothGatt, c: BluetoothGattCharacteristic, value: ByteArray) { h.post { onBytes(value) } }
            @Deprecated("Deprecated in API 33; used on older systems")
            override fun onCharacteristicChanged(g: BluetoothGatt, c: BluetoothGattCharacteristic) { if (Build.VERSION.SDK_INT < 33) { @Suppress("DEPRECATION") val v = c.value ?: return; h.post { onBytes(v) } } }
        }

        fun beginSession() {
            if (session != null) return
            val s = LinkSession(engine, this, client); session = s; touch(); s.start(); onStatus(); watchdog()
        }
        private fun touch() { lastActivity = System.currentTimeMillis() }
        private fun watchdog() {
            h.postDelayed({
                if (done) return@postDelayed
                val now = System.currentTimeMillis()
                if (now - lastActivity > IDLE_TIMEOUT_MS || now - startedAt > SESSION_TIMEOUT_MS) teardown("timeout") else watchdog()
            }, 5_000)
        }

        fun onBytes(b: ByteArray) {
            touch(); val s = session ?: return
            val frames = asm.feed(b); if (asm.broken) { s.close("framing violation"); return }
            for (f in frames) s.onFrame(f)
            if (s.closed && !done) finish(s)
        }

        override fun send(frame: ByteArray) {
            Framing.fragment(Framing.encode(frame), payload()).forEach { outQueue.add(it) }; pump()
        }
        override fun close(reason: String) { h.postDelayed({ session?.let { finish(it) } }, 400) }   // let BYE flush first

        private fun pump() {
            if (writing || done) return
            val frag = outQueue.firstOrNull() ?: return
            writing = true
            val ok = try {
                if (client) {
                    val c = inboxChar ?: return; c.writeType = BluetoothGattCharacteristic.WRITE_TYPE_DEFAULT
                    if (Build.VERSION.SDK_INT >= 33) gatt!!.writeCharacteristic(c, frag, BluetoothGattCharacteristic.WRITE_TYPE_DEFAULT) == BluetoothStatusCodes.SUCCESS
                    else { @Suppress("DEPRECATION") c.value = frag; @Suppress("DEPRECATION") gatt!!.writeCharacteristic(c) }
                } else {
                    val c = server?.getService(SERVICE)?.getCharacteristic(OUTBOX) ?: return
                    if (Build.VERSION.SDK_INT >= 33) server!!.notifyCharacteristicChanged(device!!, c, false, frag) == BluetoothStatusCodes.SUCCESS
                    else { @Suppress("DEPRECATION") c.value = frag; @Suppress("DEPRECATION") server!!.notifyCharacteristicChanged(device!!, c, false) }
                }
            } catch (e: Exception) { false }
            if (!ok) { writing = false; teardown("write failed") }
        }
        fun onWritten(success: Boolean) { writing = false; touch(); if (!success) { teardown("write error"); return }; outQueue.removeFirstOrNull(); pump() }

        private fun finish(s: LinkSession) {
            if (done) return
            val mem = memory.getOrPut(tagKey) { Memory() }
            if (s.closeReason == "done") { mem.fails = 0; lastContactMs = System.currentTimeMillis() } else mem.fails++
            mem.lastSession = System.currentTimeMillis(); mem.theirDigest = theirDigest; mem.myDigest = engine.inventoryDigest()
            teardown(s.closeReason ?: "closed")
        }
        fun teardown(reason: String) {
            if (done) return; done = true; links.remove(address)
            session?.let { if (!it.closed) it.close(reason) }
            try { gatt?.close() } catch (_: Exception) {}
            try { if (!client) device?.let { server?.cancelConnection(it) } } catch (_: Exception) {}
            engine.onChange?.invoke(); onStatus()
        }
    }
}

package app.relay.service

import android.app.*
import android.content.Context
import android.content.Intent
import android.content.pm.ServiceInfo
import android.os.Build
import android.os.IBinder
import androidx.core.app.NotificationCompat
import app.relay.R
import app.relay.RelayRuntime
import app.relay.ble.BleTransport
import app.relay.ui.MainActivity

/**
 * Keeps the radio running while the user wants Relay on. It is a user-visible foreground service (type connectedDevice) with a Stop button.
 * Android and phone makers may still restrict background Bluetooth (Doze, battery savers): relaying is best-effort, never guaranteed.
 */
class RelayService : Service() {
    companion object {
        const val ACTION_STOP = "app.relay.STOP"; const val CHANNEL = "relay_radio"; const val NOTIF_ID = 41
        fun start(ctx: Context) {
            if (!BleTransport.requiredPermissions().all { ctx.checkSelfPermission(it) == android.content.pm.PackageManager.PERMISSION_GRANTED }) return
            val i = Intent(ctx, RelayService::class.java); if (Build.VERSION.SDK_INT >= 26) ctx.startForegroundService(i) else ctx.startService(i)
        }
        fun stop(ctx: Context) { ctx.startService(Intent(ctx, RelayService::class.java).setAction(ACTION_STOP)) }
    }

    override fun onBind(i: Intent?): IBinder? = null

    override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
        if (intent?.action == ACTION_STOP) {
            RelayRuntime.ble(this).stop(); getSharedPreferences("relay", MODE_PRIVATE).edit().putBoolean("enabled", false).apply()
            stopForeground(STOP_FOREGROUND_REMOVE); stopSelf(); return START_NOT_STICKY
        }
        getSharedPreferences("relay", MODE_PRIVATE).edit().putBoolean("enabled", true).apply()
        val nm = getSystemService(NotificationManager::class.java)
        if (Build.VERSION.SDK_INT >= 26) nm.createNotificationChannel(NotificationChannel(CHANNEL, "Relay radio", NotificationManager.IMPORTANCE_LOW).apply { description = "Shown while Relay looks for nearby phones" })
        val open = PendingIntent.getActivity(this, 0, Intent(this, MainActivity::class.java), PendingIntent.FLAG_IMMUTABLE)
        val stop = PendingIntent.getService(this, 1, Intent(this, RelayService::class.java).setAction(ACTION_STOP), PendingIntent.FLAG_IMMUTABLE)
        val n = NotificationCompat.Builder(this, CHANNEL).setSmallIcon(R.drawable.ic_notification).setContentTitle("Relay is on")
            .setContentText("Looking for nearby phones. No internet is used.").setContentIntent(open).setOngoing(true)
            .addAction(0, "Stop Relay", stop).setCategory(NotificationCompat.CATEGORY_SERVICE).build()
        try {
            if (Build.VERSION.SDK_INT >= 29) startForeground(NOTIF_ID, n, ServiceInfo.FOREGROUND_SERVICE_TYPE_CONNECTED_DEVICE) else startForeground(NOTIF_ID, n)
        } catch (e: Exception) { stopSelf(); return START_NOT_STICKY }     // e.g. permission revoked: stay honest, do not pretend to run
        RelayRuntime.ble(this).start()
        return START_STICKY
    }

    override fun onDestroy() { RelayRuntime.ble(this).stop(); super.onDestroy() }
}

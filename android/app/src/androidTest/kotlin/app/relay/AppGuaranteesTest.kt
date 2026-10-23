package app.relay

import android.content.pm.PackageManager
import androidx.test.platform.app.InstrumentationRegistry
import org.junit.Assert.*
import org.junit.Test

/** Structural guarantees of the installed package (what the OS enforces, independent of our code). */
class AppGuaranteesTest {
    private val ctx = InstrumentationRegistry.getInstrumentation().targetContext
    @Suppress("DEPRECATION") private fun pkg() = ctx.packageManager.getPackageInfo(ctx.packageName, PackageManager.GET_PERMISSIONS or PackageManager.GET_SERVICES)

    @Test fun appHasNoInternetOrLocationPermissionOnModernAndroid() {
        val perms = pkg().requestedPermissions.orEmpty().toList()
        assertFalse("must not request INTERNET", perms.contains("android.permission.INTERNET"))
        assertFalse(perms.contains("android.permission.ACCESS_NETWORK_STATE")); assertFalse(perms.contains("android.permission.ACCESS_WIFI_STATE"))
        assertFalse("no coarse location", perms.contains("android.permission.ACCESS_COARSE_LOCATION"))
        assertTrue(perms.contains("android.permission.BLUETOOTH_SCAN") && perms.contains("android.permission.BLUETOOTH_ADVERTISE") && perms.contains("android.permission.BLUETOOTH_CONNECT"))
    }
    @Test fun radioServiceIsAUserVisibleConnectedDeviceForegroundService() {
        val s = pkg().services!!.single { it.name.endsWith("RelayService") }
        assertFalse(s.exported); assertEquals(android.content.pm.ServiceInfo.FOREGROUND_SERVICE_TYPE_CONNECTED_DEVICE, s.foregroundServiceType)
    }
    @Test fun backupIsDisabledSoMessagesAndKeysDoNotLeaveThePhone() {
        assertEquals(0, ctx.applicationInfo.flags and android.content.pm.ApplicationInfo.FLAG_ALLOW_BACKUP)
    }
}

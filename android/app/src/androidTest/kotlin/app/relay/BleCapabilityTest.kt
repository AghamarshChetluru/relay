package app.relay

import android.Manifest
import android.content.pm.PackageManager
import androidx.test.platform.app.InstrumentationRegistry
import androidx.test.rule.GrantPermissionRule
import app.relay.ble.BleTransport
import org.junit.Assert.*
import org.junit.Assume.assumeTrue
import org.junit.Rule
import org.junit.Test

/** Hardware-dependent: SKIPPED (not passed) where there is no Bluetooth LE, e.g. on the emulator. A pass here still only proves the stack starts, NOT that phones can exchange data. */
class BleCapabilityTest {
    private val ctx = InstrumentationRegistry.getInstrumentation().targetContext
    @get:Rule val grant: GrantPermissionRule = GrantPermissionRule.grant(Manifest.permission.BLUETOOTH_SCAN, Manifest.permission.BLUETOOTH_ADVERTISE, Manifest.permission.BLUETOOTH_CONNECT)

    @Test fun statusIsTruthfulWhenThereIsNoBluetoothLe() {
        val ble = RelayRuntime.ble(ctx); val st = ble.status()
        if (!ctx.packageManager.hasSystemFeature(PackageManager.FEATURE_BLUETOOTH_LE)) { assertFalse(st.bluetoothSupported); assertFalse("no radio => never claims to run", ble.start() && st.scanning) }
        else assertTrue(st.bluetoothSupported)
    }
    @Test fun radioStartsAndStopsOnRealHardware() {
        assumeTrue("needs Bluetooth LE hardware", ctx.packageManager.hasSystemFeature(PackageManager.FEATURE_BLUETOOTH_LE))
        val ble = RelayRuntime.ble(ctx); ble.start(); Thread.sleep(3000)
        assertTrue(ble.status().serviceRunning); ble.stop(); Thread.sleep(1000); assertFalse(ble.status().serviceRunning)
        assertArrayEquals(arrayOf(Manifest.permission.BLUETOOTH_SCAN, Manifest.permission.BLUETOOTH_ADVERTISE, Manifest.permission.BLUETOOTH_CONNECT), BleTransport.requiredPermissions())
    }
}

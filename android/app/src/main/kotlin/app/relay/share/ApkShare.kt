package app.relay.share

import android.content.Context
import android.content.Intent
import androidx.core.content.FileProvider
import app.relay.core.hex
import app.relay.core.sha256
import java.io.File

/** Explicit, user-initiated sharing of THIS installed APK through the system share sheet (Quick Share / Bluetooth where available). Never silent. */
object ApkShare {
    class Prepared(val file: File, val sha256: String, val bytes: Long)

    fun prepare(ctx: Context): Prepared {
        val src = File(ctx.applicationInfo.sourceDir); val dir = File(ctx.cacheDir, "share").apply { mkdirs() }
        val out = File(dir, "Relay-${ctx.packageManager.getPackageInfo(ctx.packageName, 0).versionName}.apk")
        src.copyTo(out, overwrite = true)
        return Prepared(out, sha256(out.readBytes()).hex(), out.length())
    }

    fun intent(ctx: Context, p: Prepared): Intent {
        val uri = FileProvider.getUriForFile(ctx, "${ctx.packageName}.files", p.file)
        val send = Intent(Intent.ACTION_SEND).setType("application/vnd.android.package-archive").putExtra(Intent.EXTRA_STREAM, uri)
            .putExtra(Intent.EXTRA_TEXT, "Relay app (SHA-256 ${p.sha256}). To install, allow installs from this source when Android asks; installing is your choice.")
            .addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION)
        return Intent.createChooser(send, "Share Relay with a nearby person")
    }
}

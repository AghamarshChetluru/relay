package app.relay.ble

import app.relay.core.sha256
import app.relay.core.unhex
import app.relay.core.Writer

/*
 * Pure (no android.*) discovery decisions, so they can be unit-tested on the JVM. BleTransport only executes what these classes decide.
 * None of this is evidence that radios work: see docs/quality/QA_REPORT.md.
 */

/** What is on air: a 4-byte tag that rotates every hour plus a 2-byte inventory digest. Advertising must be restarted when EITHER changes. */
class AdvertisingState(private val deviceId: String) {
    companion object {
        const val EPOCH_MS = 3_600_000L
        fun epochOf(nowMs: Long) = Math.floorDiv(nowMs, EPOCH_MS)
        fun tagFor(deviceId: String, epoch: Long): ByteArray = sha256(deviceId.unhex(), Writer().u64(epoch).toByteArray()).copyOf(4)
    }
    private data class Key(val epoch: Long, val digest: Int)
    private var requested: Key? = null
    private var advertisedTag: ByteArray? = null

    /** Returns the 6-byte manufacturer payload when advertising must be (re)started now, or null when what is on air is already current. */
    fun refresh(nowMs: Long, digest: Int): ByteArray? {
        val k = Key(epochOf(nowMs), digest and 0xffff)
        if (k == requested) return null
        val tag = tagFor(deviceId, k.epoch)
        requested = k; advertisedTag = tag
        return tag + byteArrayOf((k.digest ushr 8).toByte(), k.digest.toByte())
    }
    /** The platform rejected (or lost) the advertisement: the next refresh must try again even though nothing changed. */
    fun failed() { requested = null }
    fun stopped() { requested = null; advertisedTag = null }
    /** The tag a peer sees from us. The role rule must compare THIS, not a freshly computed one, or the two phones disagree around hour boundaries. */
    fun tagForRoleRule(nowMs: Long): ByteArray = advertisedTag ?: tagFor(deviceId, epochOf(nowMs))
}

/** Scan duty cycle. A local change (new request/reply) opens a burst: high-intensity windows, short period, and an immediate first window. */
class ScanPlanner(
    val windowMs: Long = 10_000, val periodMs: Long = 60_000, val burstPeriodMs: Long = 20_000, val burstMs: Long = 3 * 60_000,
    /** Android silently stops delivering results after >5 scan starts per 30 s; staying >=8 s apart keeps us at <=4. */
    val minRestartMs: Long = 8_000,
) {
    enum class Intensity { LOW, HIGH }
    class NudgePlan(val delayMs: Long, val restartActiveScan: Boolean)

    var burstUntil = 0L; private set
    private var lastStart = Long.MIN_VALUE / 4
    private var lastIntensity = Intensity.LOW
    private var notBefore = Long.MIN_VALUE / 4

    fun inBurst(nowMs: Long) = nowMs < burstUntil
    fun intensity(nowMs: Long) = if (inBurst(nowMs)) Intensity.HIGH else Intensity.LOW
    fun periodAfterStart(nowMs: Long) = if (inBurst(nowMs)) burstPeriodMs else periodMs
    fun onScanStarted(nowMs: Long, i: Intensity) { lastStart = nowMs; lastIntensity = i }
    /** Platform said we scan too often: stay quiet for a while instead of hammering it. */
    fun coolOff(nowMs: Long, forMs: Long) { notBefore = maxOf(notBefore, nowMs + forMs) }
    /** Delay before a scan start would be allowed (0 = now). */
    fun allowedIn(nowMs: Long) = maxOf(0L, lastStart + minRestartMs - nowMs, notBefore - nowMs)

    fun onNudge(nowMs: Long, scanActive: Boolean): NudgePlan {
        burstUntil = nowMs + burstMs
        if (scanActive && lastIntensity == Intensity.HIGH) return NudgePlan(maxOf(allowedIn(nowMs), burstPeriodMs - (nowMs - lastStart)), false)
        return NudgePlan(allowedIn(nowMs), scanActive)
    }
}

/** When to dial a peer we just saw, and who dials. */
object PeerPolicy {
    const val COOLDOWN_MS = 60_000L             // after a successful session with nothing new locally
    const val URGENT_COOLDOWN_MS = 10_000L      // after a success, but our inventory has changed since (new request/reply)
    const val FAIL_BASE_MS = 15_000L; const val MAX_BACKOFF_MS = 10 * 60_000L
    const val FALLBACK_INITIATE_MS = 3 * 60_000L
    const val QUIET_MS = 10 * 60_000L

    fun backoffMs(fails: Int, inventoryChangedSinceLastSession: Boolean): Long =
        if (fails > 0) minOf(MAX_BACKOFF_MS, FAIL_BASE_MS shl minOf(fails - 1, 6))
        else if (inventoryChangedSinceLastSession) URGENT_COOLDOWN_MS else COOLDOWN_MS

    fun cmp(a: ByteArray, b: ByteArray): Int { for (i in 0 until minOf(a.size, b.size)) { val d = (a[i].toInt() and 0xff) - (b[i].toInt() and 0xff); if (d != 0) return d }; return a.size - b.size }

    /**
     * Scan-only phones (or phones whose advertising failed) always dial. Otherwise the smaller tag dials, which avoids two simultaneous
     * connections. Phones' clocks differ, so two phones can disagree about who is smaller (or both see a stale tag); if a peer has been
     * visible for [FALLBACK_INITIATE_MS] without any session, dial anyway rather than waiting for a call that may never come.
     */
    fun shouldInitiate(advertisingWorks: Boolean, myAdvertisedTag: ByteArray, theirTag: ByteArray, unservedMs: Long): Boolean =
        !advertisingWorks || cmp(myAdvertisedTag, theirTag) < 0 || unservedMs >= FALLBACK_INITIATE_MS

    /** Nothing changed on either side since the last full session, and it was recent. */
    fun nothingNew(theirDigest: Int, lastTheirDigest: Int, myDigest: Int, lastMyDigest: Int, sinceLastSessionMs: Long) =
        theirDigest == lastTheirDigest && myDigest == lastMyDigest && sinceLastSessionMs < QUIET_MS
}

package app.relay.ble

import app.relay.ble.ScanPlanner.Intensity
import org.junit.Assert.*
import org.junit.Test

/** Regression tests for discovery decisions. These prove the scheduling LOGIC only; they say nothing about real radios. */
class BlePolicyTest {
    private val dev = "ab".repeat(16)
    private val H = AdvertisingState.EPOCH_MS

    // ---------------------------------------------------------------- 1. advertising rotation
    @Test fun firstRefreshStartsAdvertising() { assertNotNull(AdvertisingState(dev).refresh(1_000, 0x1234)) }

    @Test fun unchangedTagAndDigestDoNotRestartAdvertising() {
        val a = AdvertisingState(dev); val t0 = 5 * H + 10
        assertNotNull(a.refresh(t0, 0x1234))
        assertNull(a.refresh(t0 + 20_000, 0x1234)); assertNull(a.refresh(t0 + 30 * 60_000, 0x1234))
    }

    @Test fun tagRotatesAtTheHourEvenWhenTheInventoryDigestIsUnchanged() {       // the reported defect
        val a = AdvertisingState(dev); val t0 = 5 * H + 10
        val first = a.refresh(t0, 0x1234)!!
        assertNull(a.refresh(5 * H + H - 1, 0x1234))                              // last millisecond of the hour: still current
        val second = a.refresh(6 * H, 0x1234)
        assertNotNull("hour boundary with an unchanged digest must restart advertising", second)
        assertFalse("the on-air tag must actually change", first.copyOf(4).contentEquals(second!!.copyOf(4)))
        assertArrayEquals("digest bytes are carried through unchanged", first.copyOfRange(4, 6), second.copyOfRange(4, 6))
        assertNull(a.refresh(6 * H + 60_000, 0x1234))                             // and it settles again
    }

    @Test fun digestChangeRestartsAdvertisingWithTheSameTag() {
        val a = AdvertisingState(dev); val t = 5 * H + 10
        val first = a.refresh(t, 0x1234)!!; val second = a.refresh(t + 1, 0x1235)
        assertNotNull(second); assertArrayEquals(first.copyOf(4), second!!.copyOf(4))
        assertEquals(0x12.toByte(), second[4]); assertEquals(0x35.toByte(), second[5])
    }

    @Test fun afterAPlatformFailureTheNextRefreshRetriesEvenIfNothingChanged() {
        val a = AdvertisingState(dev); a.refresh(1_000, 7); a.failed()
        assertNotNull(a.refresh(2_000, 7)); assertNull(a.refresh(3_000, 7))
    }

    @Test fun tagsDifferByDeviceAndNoStableIdentifierIsOnAir() {
        val tags = (0 until 6).map { AdvertisingState.tagFor(dev, 100L + it).toList() }.toSet()
        assertEquals("six consecutive hours give six different tags", 6, tags.size)
        assertNotEquals(AdvertisingState.tagFor(dev, 1).toList(), AdvertisingState.tagFor("cd".repeat(16), 1).toList())
    }

    @Test fun roleRuleUsesTheTagActuallyAdvertisedNotAFreshOne() {
        val a = AdvertisingState(dev); a.refresh(5 * H + 10, 1)
        val onAir = a.tagForRoleRule(5 * H + 20)
        assertArrayEquals("past the hour but before the next refresh the peer still sees the old tag", onAir, a.tagForRoleRule(6 * H + 5))
        a.refresh(6 * H + 5, 1)
        assertFalse(onAir.contentEquals(a.tagForRoleRule(6 * H + 6)))
    }

    @Test fun differentClocksNeverBreakTagHandling() {                            // a tag is only ever an opaque value to the other phone
        val fast = AdvertisingState(dev); val slow = AdvertisingState("cd".repeat(16))
        fast.refresh(10 * H + 100, 1); slow.refresh(3 * H + 100, 1)
        assertNotEquals(0, PeerPolicy.cmp(fast.tagForRoleRule(10 * H + 100), slow.tagForRoleRule(3 * H + 100)))
        assertNotNull(AdvertisingState(dev).refresh(0, 0)); assertNotNull(AdvertisingState(dev).refresh(-5, 0))   // clock at/before the epoch
    }

    // ---------------------------------------------------------------- 2. prompt discovery for an urgent request
    private val W = 10_000L; private val P = 60_000L; private val B = 20_000L

    @Test fun idleNudgeStartsAHighIntensityScanImmediately() {
        val p = ScanPlanner(); p.onScanStarted(0, Intensity.LOW)                     // an ordinary window ran long ago and ended
        val now = 45_000L; assertFalse(p.inBurst(now))
        val plan = p.onNudge(now, scanActive = false)
        assertEquals("must not wait for the next 60 s tick (15 s away)", 0L, plan.delayMs); assertFalse(plan.restartActiveScan)
        assertEquals(Intensity.HIGH, p.intensity(now)); assertEquals(B, p.periodAfterStart(now))
    }

    @Test fun nudgeBeforeAnyScanHasEverRunIsImmediate() { assertEquals(0L, ScanPlanner().onNudge(1_000, false).delayMs) }

    @Test fun nudgeDuringASlowWindowReplacesItWithAFastOne() {
        val p = ScanPlanner(); p.onScanStarted(0, Intensity.LOW)
        val plan = p.onNudge(9_000, scanActive = true)
        assertTrue(plan.restartActiveScan); assertEquals("respects the 8 s minimum restart gap", 0L, plan.delayMs)
        val soon = ScanPlanner(); soon.onScanStarted(0, Intensity.LOW)
        val p2 = soon.onNudge(2_000, true); assertTrue(p2.restartActiveScan); assertEquals(6_000L, p2.delayMs)
    }

    @Test fun nudgeDuringAFastWindowDoesNotRestartItButPullsTheNextWindowIn() {
        val p = ScanPlanner(); p.onNudge(0, false); p.onScanStarted(0, Intensity.HIGH)
        val plan = p.onNudge(4_000, true)
        assertFalse(plan.restartActiveScan); assertEquals(B - 4_000, plan.delayMs)
    }

    @Test fun burstEndsAndTheOrdinaryScheduleReturns() {
        val p = ScanPlanner(); p.onNudge(0, false)
        assertTrue(p.inBurst(179_999)); assertFalse(p.inBurst(180_000))
        assertEquals(P, p.periodAfterStart(180_000)); assertEquals(Intensity.LOW, p.intensity(180_000))
    }

    @Test fun repeatedNudgesExtendTheBurst() { val p = ScanPlanner(); p.onNudge(0, false); p.onNudge(170_000, false); assertTrue(p.inBurst(300_000)) }

    /** Drives the planner exactly like BleTransport (tick -> start -> reschedule; nudge -> reschedule) while a user posts constantly. */
    @Test fun spammingNudgesNeverStartScansFasterThanAndroidAllows() {
        val p = ScanPlanner(); val starts = ArrayList<Long>(); var nextTick = 0L; var windowEnd = -1L
        var now = 0L
        while (now < 300_000) {
            if (now % 500 == 0L) { val plan = p.onNudge(now, scanActive = now < windowEnd); if (plan.restartActiveScan) windowEnd = -1; nextTick = now + plan.delayMs }
            if (now >= nextTick) {
                val wait = p.allowedIn(now)
                if (wait > 0) nextTick = now + wait
                else { p.onScanStarted(now, p.intensity(now)); starts += now; windowEnd = now + W; nextTick = now + p.periodAfterStart(now) }
            }
            now += 100
        }
        assertTrue("some scans happened", starts.size > 5)
        starts.zipWithNext().forEach { (a, b) -> assertTrue("starts $a and $b are < 8 s apart", b - a >= 8_000) }
        for (t in starts) assertTrue("more than 5 starts in a 30 s window at $t", starts.count { it >= t && it < t + 30_000 } <= 4)
    }

    @Test fun anUrgentPostIsScannedForWithinSecondsNotAMinute() {
        val p = ScanPlanner(); p.onScanStarted(0, Intensity.LOW)
        val now = 12_000L                                                          // window over; ordinary next start would be at 60_000
        val plan = p.onNudge(now, false); assertTrue(plan.delayMs <= 0L + p.minRestartMs); assertTrue(now + plan.delayMs < 60_000)
    }

    @Test fun platformThrottlingMakesUsBackOff() { val p = ScanPlanner(); p.onScanStarted(0, Intensity.LOW); p.coolOff(1_000, 30_000); assertEquals(30_000L, p.allowedIn(1_000)); assertEquals(0L, p.allowedIn(31_000)) }

    // ---------------------------------------------------------------- connection policy
    @Test fun anUrgentPostSkipsTheOrdinaryCooldownAfterACleanSession() {
        assertEquals(PeerPolicy.COOLDOWN_MS, PeerPolicy.backoffMs(0, false))
        assertEquals(PeerPolicy.URGENT_COOLDOWN_MS, PeerPolicy.backoffMs(0, true)); assertTrue(PeerPolicy.URGENT_COOLDOWN_MS < B)
    }

    @Test fun failuresBackOffExponentiallyAndAreCapped() {
        assertEquals(15_000L, PeerPolicy.backoffMs(1, true)); assertEquals(30_000L, PeerPolicy.backoffMs(2, false)); assertEquals(60_000L, PeerPolicy.backoffMs(3, false))
        assertEquals(PeerPolicy.MAX_BACKOFF_MS, PeerPolicy.backoffMs(40, false)); assertEquals(PeerPolicy.MAX_BACKOFF_MS, PeerPolicy.backoffMs(Int.MAX_VALUE, false))
    }

    private val lo = byteArrayOf(1, 0, 0, 0); private val hi = byteArrayOf(9, 0, 0, 0)

    @Test fun roleRuleScanOnlyPhonesAlwaysDialAndOtherwiseTheSmallerTagDials() {
        assertTrue(PeerPolicy.shouldInitiate(false, hi, lo, 0))                    // cannot advertise (or advertising failed): must dial
        assertTrue(PeerPolicy.shouldInitiate(true, lo, hi, 0)); assertFalse(PeerPolicy.shouldInitiate(true, hi, lo, 0))
        assertFalse("equal tags: nobody dials by rule", PeerPolicy.shouldInitiate(true, lo, lo, 0))
    }

    @Test fun ifTheOtherSideNeverDialsWeEventuallyDoAfterThreeMinutes() {           // stale tags / skewed clocks can leave both thinking the other should dial
        assertFalse(PeerPolicy.shouldInitiate(true, hi, lo, PeerPolicy.FALLBACK_INITIATE_MS - 1))
        assertTrue(PeerPolicy.shouldInitiate(true, hi, lo, PeerPolicy.FALLBACK_INITIATE_MS))
    }

    @Test fun twoPhonesThatCannotAdvertiseStillDecideConsistently() {              // nobody is discoverable: documented limitation, but no crash and both would dial if they ever saw each other
        assertTrue(PeerPolicy.shouldInitiate(false, lo, hi, 0)); assertTrue(PeerPolicy.shouldInitiate(false, hi, lo, 0))
    }

    @Test fun skipsOnlyWhenNothingChangedOnEitherSideAndItWasRecent() {
        assertTrue(PeerPolicy.nothingNew(5, 5, 7, 7, 60_000))
        assertFalse(PeerPolicy.nothingNew(6, 5, 7, 7, 60_000)); assertFalse(PeerPolicy.nothingNew(5, 5, 8, 7, 60_000))
        assertFalse("after 10 min sync again regardless", PeerPolicy.nothingNew(5, 5, 7, 7, PeerPolicy.QUIET_MS))
    }

    @Test fun cmpHandlesDifferentLengthsAndHighBytes() {
        assertTrue(PeerPolicy.cmp(byteArrayOf(0x7f), byteArrayOf(0x80.toByte())) < 0)                 // unsigned compare
        assertTrue(PeerPolicy.cmp(byteArrayOf(1), byteArrayOf(1, 0)) < 0); assertEquals(0, PeerPolicy.cmp(byteArrayOf(), byteArrayOf()))
    }
}

package app.relay

import android.app.NotificationManager
import androidx.test.platform.app.InstrumentationRegistry
import app.relay.core.*
import org.junit.Assume.assumeTrue
import org.junit.Test

/**
 * TEST-ONLY staging for the product screenshots. NOT part of the normal run (skipped unless `-e scene <name>`), never shipped in the APK.
 * It puts the REAL engine and SQLite store of the installed app into a believable state by delivering REAL signed packets created by
 * in-memory peer phones (the same path the BLE transport uses). Nothing about the UI is faked; only the packets that "arrived" are staged.
 * Ages are set through the packet's remaining validity (what a real hop carries), never by touching the clock.
 *   scene=responder : a nearby phone (Green Park) whose Inbox holds requests and community updates, incl. the Hauz Khas urgent medical request
 *   scene=requester : the Hauz Khas requester phone that authored the urgent request and has received two offers of help
 */
class ScreenshotFixture {
    private val ctx = InstrumentationRegistry.getInstrumentation().targetContext
    private val crypto = TinkCrypto()
    private fun arg(k: String) = InstrumentationRegistry.getArguments().getString(k)
    private fun peer(h: String) = RelayEngine(MemoryStore(), crypto, Identity.create(crypto)).also { it.setHood(h, "") }
    private fun wire(e: RelayEngine, id: String) = e.store.getPacket(id)!!.env.wire()
    /** Deliver one packet to the app as if it arrived over BLE [ageMin] minutes after it was created. */
    private fun deliver(app: RelayEngine, from: RelayEngine, id: String, ageMin: Long, hops: Int = 1) {
        val validity = from.store.getPacket(id)!!.env.validityMs
        app.receive(wire(from, id), Hop(hops, 0, false, validity - ageMin * Limits.MINUTE_MS), "staged")
    }

    @Test fun stage() {
        val scene = arg("scene"); assumeTrue(scene != null)
        val app = RelayRuntime.engine(ctx); RelayRuntime.foreground = false
        ctx.getSystemService(NotificationManager::class.java).cancelAll()
        when (scene) { "responder" -> responder(app); "requester" -> requester(app); "hood" -> app.setHood(arg("hood") ?: "HK", ""); "offers" -> offers(app); "share" -> share(app); "peers" -> peers(); "sighting" -> sighting(app); "missing" -> { share(app); sighting(app) }; else -> error("unknown scene $scene") }
        Thread.sleep(5000)      // the 3-second notification batching window
    }

    private fun responder(app: RelayEngine) {
        app.setHood("GP", "")
        val read = ArrayList<String>()
        // the hero request, from Hauz Khas (one neighbourhood away from Green Park)
        val hk = peer("HK")
        val hero = hk.createRequest(RequestInput("urgent", "Medical", "Injured neighbour needs medical help",
            "Fell from a ladder. Deep cut on the leg and cannot walk. A first-aid kit or someone with medical training would help.",
            "Near Hauz Khas Metro, Gate 2", "HK", "Hauz Khas", true, 60))
        // older, ordinary requests
        val se = peer("SE")
        val water = se.createRequest(RequestInput("urgent", "Food & water", "Drinking water for an elderly couple",
            "Two seniors, no clean water since yesterday. Ground floor, easy to reach.", "Safdarjung Enclave market", "SE", "Safdarjung Enclave", false, 180))
        val ln = peer("LN")
        val shelter = ln.createRequest(RequestInput("urgent", "Shelter", "Family of four needs a dry place tonight",
            "Two adults and two children. Their ground floor is flooded.", "Lajpat Nagar central market", "LN", "Lajpat Nagar", false, 240))
        val gone = se.createRequest(RequestInput("urgent", "Medical", "Elderly man needs his insulin",
            "Out of insulin since the morning.", "Safdarjung Enclave, A block", "SE", "Safdarjung Enclave", true, 30))
        // community updates
        val gp = peer("GP")
        val tanker = gp.createBroadcast("Free drinking water tanker at the Green Park market gate until 6 pm. Bring your own container.", "Resources", "Green Park market gate")
        val lane = hk.createBroadcast("Service lane behind Hauz Khas Metro is waterlogged. Use the main road.", "Safety information", "Hauz Khas Metro")
        // deliver oldest first
        deliver(app, se, gone.packetId!!, 40, 2)
        deliver(app, ln, shelter.packetId!!, 52, 2)
        deliver(app, se, water.packetId!!, 34, 1)
        deliver(app, hk, lane.packetId!!, 20, 1)
        deliver(app, gp, tanker.packetId!!, 9, 0)
        deliver(app, hk, hero.packetId!!, 6, 1)
        // already looked at: everything except the hero request and the water tanker update
        read += listOf(gone, shelter, water, lane).map { it.packetId!! }
        ReadState.markRead(app.store, read)
        if (arg("reminder") == "true") app.store.setSetting("hoodConfirmedMs", Writer().u64(System.currentTimeMillis() - 40 * Limits.MINUTE_MS).toByteArray())
    }

    private fun requester(app: RelayEngine) {
        app.setHood("HK", "")
        val mine = app.createRequest(RequestInput("urgent", "Medical", "Injured neighbour needs medical help",
            "Fell from a ladder. Deep cut on the leg and cannot walk. A first-aid kit or someone with medical training would help.",
            "Near Hauz Khas Metro, Gate 2", "HK", "Hauz Khas", true, 60,
            privateBuilding = "Flat 204, Sunrise Apartments (demo address)", privateDirections = "Second lane behind the blue pharmacy. Ring the bell twice."))
        check(mine.ok) { mine.error ?: "createRequest failed" }
        val nurse = peer("GP"); nurse.receive(wire(app, mine.packetId!!), Hop(1, 0, false, 55 * Limits.MINUTE_MS), "app")
        val r1 = nurse.createReply(mine.caseId!!, "offer", "I am a trained nurse, about 10 minutes away. I have a first-aid kit.", "Green Park")
        val driver = peer("SE"); driver.receive(wire(app, mine.packetId!!), Hop(1, 0, false, 55 * Limits.MINUTE_MS), "app")
        val r2 = driver.createReply(mine.caseId!!, "offer", "I have a car and can take them to a hospital.", "Safdarjung Enclave")
        deliver(app, nurse, r1.packetId!!, 4)
        deliver(app, driver, r2.packetId!!, 2)
    }

    /** The request the person typed into the real composer on this phone (newest authored request of the given kind). */
    private fun mineOf(app: RelayEngine, kind: String): StoredPacket =
        app.store.packets().filter { it.authored && it.env.type == PacketType.REQUEST && it.env.s("kind") == kind }.maxByOrNull { it.receivedMs } ?: error("no authored $kind request; create it in the UI first")

    /** Two nearby phones received the request over BLE and each answered it with an offer, which then reached the requester. */
    private fun offers(app: RelayEngine) {
        val req = mineOf(app, "urgent"); val caseId = req.env.caseId!!.hex()
        val nurse = peer("GP"); nurse.receive(wire(app, req.id), Hop(1, 0, false, 55 * Limits.MINUTE_MS), "app")
        val r1 = nurse.createReply(caseId, "offer", "I am a trained nurse, about 10 minutes away. I have a first-aid kit.", "Green Park")
        val driver = peer("SE"); driver.receive(wire(app, req.id), Hop(1, 0, false, 55 * Limits.MINUTE_MS), "app")
        val r2 = driver.createReply(caseId, "offer", "I have a car and can take them to a hospital.", "Safdarjung Enclave")
        deliver(app, nurse, r1.packetId!!, 4); deliver(app, driver, r2.packetId!!, 2)
    }

    /** A real in-memory link session (the same LinkSession protocol the BLE transport runs) between the app and a fresh nearby phone: that phone stores the request and confirms it, which is what lets the UI say "Shared with a nearby phone". */
    private fun share(app: RelayEngine) { Pipe.run(app, peer("GP")) }

    /**
     * TEST-ONLY: the emulator has no real Bluetooth neighbours, so put four recent "sightings" into the radio's own table (the one BleTransport fills from real scan results)
     * so the real status line reads "Phones seen nearby · 4". Nothing is connected to or exchanged. Instrumentation shares the app's process, so this keeps refreshing
     * (the table only counts sightings from the last 2 minutes) while the screen is captured.
     */
    @Suppress("UNCHECKED_CAST")
    private fun peers() {
        val ble = RelayRuntime.ble(ctx)
        val f = app.relay.ble.BleTransport::class.java.getDeclaredField("seenTags"); f.isAccessible = true
        val seen = f.get(ble) as java.util.concurrent.ConcurrentHashMap<String, Long>
        repeat(14) { seen.clear(); listOf("a1b2c3d4", "e5f60718", "293a4b5c", "6d7e8f90").forEach { seen[it] = System.currentTimeMillis() }; RelayRuntime.notifyChanged(); Thread.sleep(8000) }
    }

    /** A possible sighting of the missing person, from a phone in the target area. */
    private fun sighting(app: RelayEngine) {
        val req = mineOf(app, "missing"); val caseId = req.env.caseId!!.hex()
        val p = peer("LN"); Pipe.run(app, p)                                   // a real link session: the report is passed toward its target area
        if (p.store.getPacket(req.id) == null) p.receive(wire(app, req.id), Hop(1, 0, false, 23 * 60 * Limits.MINUTE_MS), "app")
        val r = p.createReply(caseId, "offer", "Possible sighting: someone matching this description was near the Lajpat Nagar metro gate about 20 minutes ago.", "Lajpat Nagar metro gate")
        Pipe.run(app, p)                                                       // and the answer travels back
        if (app.store.getPacket(r.packetId!!) == null) deliver(app, p, r.packetId!!, 3)
    }
}

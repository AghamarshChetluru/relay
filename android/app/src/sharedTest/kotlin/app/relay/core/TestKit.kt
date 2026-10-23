package app.relay.core

import org.junit.Assert.assertTrue

class FakeClock(var t: Long = 1_760_000_000_000L) : Clock {
    override fun nowMs() = t
    fun minutes(m: Long) { t += m * Limits.MINUTE_MS }
}

val sharedCrypto = TinkCrypto()

class Phone(val name: String, val clock: FakeClock, cfg: PolicyConfig = PolicyConfig(), hood: String? = "HK", val store: MemoryStore = MemoryStore()) {
    val identity: Identity = Identity.create(sharedCrypto)
    val engine = RelayEngine(store, sharedCrypto, identity, clock, cfg)
    val id: String get() = identity.deviceId
    init { if (hood != null) engine.setHood(hood, "") else engine.setHood(null, "Somewhere near the old fort") }
    fun packetsOf(type: PacketType) = store.packets().filter { it.env.type == type }
    fun has(packetId: String) = store.getPacket(packetId) != null
}

fun ok(o: Outcome): Outcome { assertTrue("expected success but got: ${o.error}", o.ok); return o }

fun urgentInput(validityMin: Int = 60, privB: String = "", privD: String = "", photo: ByteArray? = null) = RequestInput(
    kind = "urgent", category = "Medical", title = "Medical help needed near the gate", description = "Elderly neighbour collapsed", area = "Gate 2",
    areaHood = "HK", areaHoodName = "Hauz Khas", urgent = true, validityMin = validityMin, privateBuilding = privB, privateDirections = privD,
    photo = photo, photoW = 160, photoH = 120
)

fun missingInput(target: String = "CP", photo: ByteArray? = null) = RequestInput(
    kind = "missing", category = "Missing", title = "Looking for Meera", description = "Red bag", area = "Metro gate", areaHood = target,
    areaHoodName = Neighborhoods.nameOf(target), urgent = false, validityMin = 1440, lastKnown = "Metro gate, ${Neighborhoods.nameOf(target)}", lastContact = "Earlier today",
    photo = photo, photoW = 160, photoH = 120
)

/** A syntactically valid JPEG-like blob (SOI marker + deterministic body). The engine checks magic, size and SHA-256, not pixel content. */
fun fakeJpeg(size: Int, seed: Int = 7): ByteArray {
    val b = ByteArray(size); java.util.Random(seed.toLong()).nextBytes(b)
    b[0] = 0xFF.toByte(); b[1] = 0xD8.toByte(); b[2] = 0xFF.toByte(); b[size - 2] = 0xFF.toByte(); b[size - 1] = 0xD9.toByte(); return b
}

fun contact(a: Phone, b: Phone): Pair<LinkSession, LinkSession> = Pipe.run(a.engine, b.engine)

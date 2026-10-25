package app.relay.core

/** Frame type codes of the link protocol (docs/architecture/TRANSPORT_ADR.md). Transport-independent: BLE fragments frames, tests pass them directly. */
object Frame {
    const val HELLO = 1; const val INV = 2; const val WANT = 3; const val PKT = 4; const val PACK = 5
    const val ATT_REQ = 6; const val ATT_CHUNK = 7; const val ATT_ACK = 8; const val BYE = 9; const val ERR = 10; const val NOPKT = 11
    const val PACK_STORED = 0; const val PACK_DUPLICATE = 1; const val PACK_REJECTED = 2; const val PACK_EXPIRED = 3
}

interface LinkIo {
    fun send(frame: ByteArray)
    fun close(reason: String)
}

class SessionStats { var framesIn = 0; var framesOut = 0; var bytesIn = 0L; var bytesOut = 0L; var stored = 0; var duplicates = 0; var rejected = 0; var sentPackets = 0; var attachmentsDone = 0 }

/**
 * One contact between two phones, both directions at once.
 *   HELLO -> INV (what I may give you) -> WANT (what I lack) -> PKT/NOPKT -> PACK (honest "stored" receipt) -> photo bytes by ATT_REQ/ATT_CHUNK -> BYE.
 * Every frame is length-bounded; unsolicited or malformed input is counted and ends the session after a few strikes.
 */
class LinkSession(private val engine: RelayEngine, private val io: LinkIo, private val initiator: Boolean = true) {
    val stats = SessionStats()
    var peer: PeerView? = null; private set
    var peerBoxPub: ByteArray? = null; private set
    var closed = false; private set
    var closeReason: String? = null; private set
    val deliveredIds = ArrayList<String>()

    private var gotHello = false
    private var peerInvLast = false
    private var wantSent = false
    private val pending = LinkedHashSet<String>()          // ids we asked for and have not answered yet
    private val attQueue = ArrayDeque<AttReq>()
    private var attStarted = false
    private var ourBye = false; private var peerBye = false
    private var strikes = 0

    fun start() { sendHello() }

    private fun send(frame: ByteArray) {
        if (closed) return
        if (frame.size > Limits.MAX_FRAME_BYTES) { fail("outgoing frame too large"); return }
        stats.framesOut++; stats.bytesOut += frame.size
        if (stats.framesOut > Limits.MAX_SESSION_FRAMES || stats.bytesOut > Limits.MAX_SESSION_BYTES) { fail("session budget"); return }
        io.send(frame)
    }
    private fun fail(reason: String) { if (closed) return; try { io.send(Writer().u8(Frame.ERR).str(reason.take(60)).toByteArray()) } catch (_: Exception) {}; close(reason) }
    fun close(reason: String) { if (closed) return; closed = true; closeReason = reason; io.close(reason) }
    private fun strike(why: String) { strikes++; if (strikes > 3) fail("too many violations: $why") }

    private fun sendHello() {
        val h = engine.hello()
        val w = Writer().u8(Frame.HELLO).u8(Limits.PROTOCOL_VERSION).raw(h.deviceId.unhex()).raw(h.signPub).raw(h.boxPub)
            .u8(if (h.canAdvertise) 1 else 0).u8(if (h.hood != null) 1 else 0).str(h.hood ?: "").u32(h.hoodAgeMs / 1000)
        send(w.toByteArray())
    }

    fun onFrame(data: ByteArray) {
        if (closed) return
        stats.framesIn++; stats.bytesIn += data.size
        if (data.isEmpty() || data.size > Limits.MAX_FRAME_BYTES) { fail("bad frame size"); return }
        if (stats.framesIn > Limits.MAX_SESSION_FRAMES || stats.bytesIn > Limits.MAX_SESSION_BYTES) { fail("session budget"); return }
        try { handle(data) } catch (e: WireException) { fail("protocol error: ${e.message}") }
    }

    private fun handle(data: ByteArray) {
        val r = Reader(data); val t = r.u8()
        if (t != Frame.HELLO && !gotHello) { fail("frame before HELLO"); return }
        when (t) {
            Frame.HELLO -> onHello(r)
            Frame.INV -> onInv(r)
            Frame.WANT -> onWant(r)
            Frame.PKT -> onPkt(r)
            Frame.NOPKT -> { pending.remove(r.raw(16).hex()); afterIncoming() }
            Frame.PACK -> { val id = r.raw(16).hex(); val st = r.u8(); if (st == Frame.PACK_STORED) { engine.markDelivered(id, peer!!.deviceId); deliveredIds.add(id); stats.sentPackets++ } }
            Frame.ATT_REQ -> onAttReq(r)
            Frame.ATT_CHUNK -> onAttChunk(r)
            Frame.ATT_ACK -> { r.raw(16); r.u8(); nextAttachment() }
            Frame.BYE -> { r.u8(); peerBye = true; maybeFinish() }
            Frame.ERR -> { close("peer error: ${r.str(60)}") }
            else -> strike("unknown frame $t")
        }
    }

    private fun onHello(r: Reader) {
        if (gotHello) { strike("second HELLO"); return }
        val ver = r.u8(); if (ver != Limits.PROTOCOL_VERSION) { fail("unsupported protocol $ver"); return }
        val dev = r.raw(16).hex(); val sp = r.raw(32); val bp = r.raw(32); val caps = r.u8(); val hasHood = r.u8(); val hood = r.str(4); val ageSec = r.u32()
        if (Identity.deviceIdOf(sp) != dev) { fail("device id does not match key"); return }
        if (dev == engine.identity.deviceId) { fail("connected to self"); return }
        gotHello = true; peerBoxPub = bp
        peer = PeerView(dev, if (hasHood == 1 && Neighborhoods.isValid(hood)) hood else null, minOf(ageSec, 10_000_000L) * 1000, caps and 1 == 1)
        sendInventory()
    }

    private fun sendInventory() {
        val inv = engine.inventory(peer!!)
        if (inv.isEmpty()) { send(Writer().u8(Frame.INV).u8(1).u8(0).toByteArray()); return }
        inv.chunked(Limits.MAX_INV_ENTRIES).forEachIndexed { idx, chunk ->
            val last = (idx + 1) * Limits.MAX_INV_ENTRIES >= inv.size
            val w = Writer().u8(Frame.INV).u8(if (last) 1 else 0).u8(chunk.size)
            chunk.forEach { w.raw(it.id.unhex()).u8(it.type).u8(it.prio).u32(it.remainingSec).u16(it.size) }
            send(w.toByteArray())
        }
    }

    private val invCollected = ArrayList<InvEntry>()
    private fun onInv(r: Reader) {
        val last = r.u8() == 1; val n = r.u8(); if (n > Limits.MAX_INV_ENTRIES) throw WireException("inventory too large")
        repeat(n) { invCollected.add(InvEntry(r.raw(16).hex(), r.u8(), r.u8(), r.u32(), r.u16())) }
        if (invCollected.size > 400) throw WireException("inventory flood")
        if (!last) return
        peerInvLast = true
        val want = engine.wanted(invCollected).take(Limits.RATE_PER_PEER_PER_SESSION)
        pending.addAll(want)
        if (want.isEmpty()) send(Writer().u8(Frame.WANT).u8(1).u8(0).toByteArray())
        else want.chunked(Limits.MAX_WANT_IDS).forEachIndexed { idx, chunk ->
            val lastChunk = (idx + 1) * Limits.MAX_WANT_IDS >= want.size
            val w = Writer().u8(Frame.WANT).u8(if (lastChunk) 1 else 0).u8(chunk.size); chunk.forEach { w.raw(it.unhex()) }; send(w.toByteArray())
        }
        wantSent = true; afterIncoming()
    }

    private fun onWant(r: Reader) {
        r.u8(); val n = r.u8(); if (n > Limits.MAX_WANT_IDS) throw WireException("want too large")
        repeat(n) {
            val id = r.raw(16).hex(); val out = engine.outgoing(id, peer!!)
            if (out == null) send(Writer().u8(Frame.NOPKT).raw(id.unhex()).toByteArray())
            else send(Writer().u8(Frame.PKT).raw(id.unhex()).u8(out.hop.hops).u8(out.hop.detours).u32(maxOf(0L, out.hop.remainingMs / 1000)).bytes(out.wire).toByteArray())
        }
    }

    private fun onPkt(r: Reader) {
        val id = r.raw(16).hex(); val hops = r.u8(); val det = r.u8(); val remSec = r.u32(); val wire = r.bytes(Limits.MAX_ENVELOPE_BYTES)
        if (!pending.remove(id)) { strike("unsolicited packet"); return }
        val res = engine.receive(wire, Hop(hops, det, false, remSec * 1000), peer!!.deviceId)
        if (res.packet != null && res.packet.id != id) { stats.rejected++; send(Writer().u8(Frame.PACK).raw(id.unhex()).u8(Frame.PACK_REJECTED).toByteArray()); strike("id mismatch"); return }
        val code = when (res.status) {
            RxStatus.STORED -> { stats.stored++; Frame.PACK_STORED }
            RxStatus.DUPLICATE -> { stats.duplicates++; Frame.PACK_DUPLICATE }
            RxStatus.EXPIRED -> Frame.PACK_EXPIRED
            RxStatus.REJECTED -> { stats.rejected++; strike(res.reason ?: "rejected"); Frame.PACK_REJECTED }
        }
        send(Writer().u8(Frame.PACK).raw(id.unhex()).u8(code).toByteArray())
        afterIncoming()
    }

    private fun afterIncoming() {
        if (closed || !wantSent || pending.isNotEmpty()) return
        if (!attStarted) { attStarted = true; attQueue.addAll(engine.attachmentRequests()); nextAttachment(first = true) }
    }

    private fun nextAttachment(first: Boolean = false) {
        if (!first && attQueue.isNotEmpty()) attQueue.removeFirst()
        val a = attQueue.firstOrNull()
        if (a != null) { send(Writer().u8(Frame.ATT_REQ).raw(a.id.unhex()).u32(a.offset.toLong()).toByteArray()); return }
        if (attStarted && !ourBye) { ourBye = true; send(Writer().u8(Frame.BYE).u8(0).toByteArray()); maybeFinish() }
    }

    private fun onAttReq(r: Reader) {
        val id = r.raw(16).hex(); val off = r.u32()
        val c = if (off > Int.MAX_VALUE) null else engine.attachmentChunk(id, off.toInt())
        if (c == null) send(Writer().u8(Frame.ATT_ACK).raw(id.unhex()).u8(2).toByteArray())
        else send(Writer().u8(Frame.ATT_CHUNK).raw(id.unhex()).u32(c.offset.toLong()).u32(c.total.toLong()).bytes(c.data).toByteArray())
    }

    private fun onAttChunk(r: Reader) {
        val id = r.raw(16).hex(); val off = r.u32(); val total = r.u32(); val data = r.bytes(Limits.ATTACHMENT_CHUNK)
        if (attQueue.firstOrNull()?.id != id || off > Int.MAX_VALUE || total > Int.MAX_VALUE) { strike("unsolicited chunk"); return }
        when (val res = engine.receiveChunk(id, off.toInt(), total.toInt(), data)) {
            is ChunkResult.Next -> send(Writer().u8(Frame.ATT_REQ).raw(id.unhex()).u32(res.offset.toLong()).toByteArray())
            ChunkResult.Done -> { stats.attachmentsDone++; send(Writer().u8(Frame.ATT_ACK).raw(id.unhex()).u8(0).toByteArray()); nextAttachment() }
            ChunkResult.Bad -> { send(Writer().u8(Frame.ATT_ACK).raw(id.unhex()).u8(1).toByteArray()); nextAttachment() }
            ChunkResult.Ignore -> nextAttachment()
        }
    }

    private fun maybeFinish() { if (ourBye && peerBye) close("done") }
}

/** In-memory link between two sessions for tests: delivers frames in order, optionally tampering, until both are quiet. */
class Pipe(private val a: LinkSession? = null) {
    companion object {
        class End(val inbox: ArrayDeque<ByteArray> = ArrayDeque())

        fun run(
            engineA: RelayEngine, engineB: RelayEngine, tamperAtoB: ((ByteArray) -> ByteArray?)? = null, tamperBtoA: ((ByteArray) -> ByteArray?)? = null,
            maxSteps: Int = 20000
        ): Pair<LinkSession, LinkSession> {
            val toA = End(); val toB = End()
            lateinit var sa: LinkSession; lateinit var sb: LinkSession
            sa = LinkSession(engineA, object : LinkIo {
                override fun send(frame: ByteArray) { val f = tamperAtoB?.invoke(frame) ?: if (tamperAtoB == null) frame else null; if (f != null) toB.inbox.add(f) }
                override fun close(reason: String) {}
            }, true)
            sb = LinkSession(engineB, object : LinkIo {
                override fun send(frame: ByteArray) { val f = tamperBtoA?.invoke(frame) ?: if (tamperBtoA == null) frame else null; if (f != null) toA.inbox.add(f) }
                override fun close(reason: String) {}
            }, false)
            sa.start(); sb.start()
            var steps = 0
            while ((toA.inbox.isNotEmpty() || toB.inbox.isNotEmpty()) && steps++ < maxSteps) {
                if (toB.inbox.isNotEmpty()) sb.onFrame(toB.inbox.removeFirst())
                if (toA.inbox.isNotEmpty()) sa.onFrame(toA.inbox.removeFirst())
            }
            return sa to sb
        }
    }
}

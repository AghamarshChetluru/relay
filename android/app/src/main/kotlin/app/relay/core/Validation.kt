package app.relay.core

/** Semantic validation after the signature has been verified. Returns null if acceptable, else a short reason (never logs private content). */
object Validation {
    private val URGENT_CATS = setOf("Medical", "Rescue", "Food & water", "Shelter", "Other")
    private val BROADCAST_CATS = setOf("Community", "Safety information", "Resources", "Check-in")
    const val MAX_URGENT_MS = 120 * Limits.MINUTE_MS
    const val MAX_GENERAL_MS = 360 * Limits.MINUTE_MS
    const val MAX_MISSING_MS = 1440 * Limits.MINUTE_MS
    const val MAX_REPLY_MS = 120 * Limits.MINUTE_MS
    const val MAX_BROADCAST_MS = 60 * Limits.MINUTE_MS

    private fun clean(s: String, max: Int, allowEmpty: Boolean = true): Boolean {
        if (s.length > max || (!allowEmpty && s.isBlank())) return false
        return s.none { it.code < 0x20 && it != '\n' && it != '\t' || it.code == 0x7f }
    }
    private fun hex(s: String, bytes: Int) = s.length == bytes * 2 && s.all { it in '0'..'9' || it in 'a'..'f' }
    private fun hoodOk(s: String) = s.isEmpty() || Neighborhoods.isValid(s)

    fun check(e: Envelope): String? {
        if (e.validityMs <= 0) return "validity"
        if (e.route.maxHops < 1 || e.route.maxHops > Limits.MAX_HOPS_CEILING) return "route.maxHops"
        if (e.route.fanout > Limits.MAX_FANOUT_CEILING || e.route.detourMax > 8 || e.route.detourAway > 4) return "route.budget"
        if (e.route.targets.any { !Neighborhoods.isValid(it) }) return "route.targets"
        if (e.route.policy == PolicyKind.DIRECTED && e.route.targets.isEmpty()) return "route.directed.targets"
        if (e.type != PacketType.REQUEST && e.caseVersion != 0) return "caseVersion"
        if (e.type == PacketType.BROADCAST) { if (e.caseId != null) return "broadcast.case" } else if (e.caseId == null) return "case.missing"
        for ((k, v) in e.fields) {
            if (k.isEmpty() || !k.all { it.isLetterOrDigit() || it == '_' }) return "field.key"
            if (v.size > Limits.MAX_FIELD_BYTES) return "field.size"
        }
        return when (e.type) {
            PacketType.REQUEST -> request(e)
            PacketType.REPLY -> reply(e)
            PacketType.ACK -> if (hex(e.s("replyPacketId"), 16) && e.validityMs <= MAX_REPLY_MS) null else "ack"
            PacketType.RESOLVE -> if (e.validityMs <= MAX_REPLY_MS) null else "resolve"
            PacketType.BROADCAST -> broadcast(e)
            PacketType.ADDRESS -> address(e)
            PacketType.ATTACHMENT -> attachment(e)
        }
    }

    private fun request(e: Envelope): String? {
        val kind = e.s("kind"); val cat = e.s("category")
        if (kind != "urgent" && kind != "missing") return "request.kind"
        if (kind == "urgent" && cat !in URGENT_CATS) return "request.category"
        if (kind == "missing" && cat != "Missing") return "request.category"
        if (!clean(e.s("title"), Limits.MAX_TITLE, false) || !clean(e.s("description"), Limits.MAX_DESCRIPTION) || !clean(e.s("area"), Limits.MAX_AREA)) return "request.text"
        if (!clean(e.s("note"), Limits.MAX_NOTE) || !clean(e.s("lastKnown"), 120) || !clean(e.s("lastContact"), 40)) return "request.text2"
        if (!clean(e.s("areaHoodName"), 60) || !clean(e.s("authorHoodName"), 60)) return "request.hoodname"
        if (!hoodOk(e.s("areaHood")) || !hoodOk(e.s("authorHood"))) return "request.hood"
        if (e.s("hasPrivate").let { it != "" && it != "1" }) return "request.hasPrivate"
        e.s("attachmentId").let { if (it != "" && !hex(it, 16)) return "request.attachmentId" }
        val nonce = e.fields["nonce"] ?: return "request.nonce"
        if (nonce.size != 16 || e.caseId == null || !id16(e.origin, nonce).contentEquals(e.caseId)) return "request.caseId"   // only the key holder can mint this case ID
        val max = if (kind == "missing") MAX_MISSING_MS else if (e.urgent) MAX_URGENT_MS else MAX_GENERAL_MS
        if (e.validityMs > max) return "request.validity"
        if (e.urgent && kind == "missing") return "request.urgentMissing"
        return null
    }
    private fun reply(e: Envelope): String? {
        if (e.s("kind") != "offer" && e.s("kind") != "sighting") return "reply.kind"
        if (!clean(e.s("note"), Limits.MAX_NOTE, false) || !clean(e.s("area"), Limits.MAX_AREA) || !clean(e.s("fromHood"), 60)) return "reply.text"
        if (!hex(e.s("boxKey"), 32)) return "reply.boxKey"
        if (e.validityMs > MAX_REPLY_MS) return "reply.validity"
        return null
    }
    private fun broadcast(e: Envelope): String? {
        if (!clean(e.s("text"), Limits.MAX_BROADCAST_TEXT, false)) return "broadcast.text"
        if (e.s("category") !in BROADCAST_CATS) return "broadcast.category"
        if (!clean(e.s("area"), Limits.MAX_AREA) || !clean(e.s("hoodName"), 60) || !hoodOk(e.s("hood"))) return "broadcast.area"
        if (e.validityMs > MAX_BROADCAST_MS) return "broadcast.validity"
        return null
    }
    private fun address(e: Envelope): String? {
        if (!hex(e.s("replyPacketId"), 16) || !hex(e.s("toDevice"), 16)) return "address.ids"
        val sealed = e.fields["sealed"] ?: return "address.sealed"
        if (sealed.size < 60 || sealed.size > 700) return "address.sealed.size"
        if (e.validityMs > MAX_REPLY_MS) return "address.validity"
        return null
    }
    private fun attachment(e: Envelope): String? {
        if (!hex(e.s("attachmentId"), 16) || !hex(e.s("sha256"), 32)) return "attachment.ids"
        if (e.s("mime") != "image/jpeg") return "attachment.mime"
        val size = e.s("size").toIntOrNull() ?: return "attachment.size"
        if (size < 100 || size > Limits.MAX_PHOTO_BYTES) return "attachment.size.range"
        val w = e.s("w").toIntOrNull() ?: return "attachment.w"; val h = e.s("h").toIntOrNull() ?: return "attachment.h"
        if (w < 1 || h < 1 || w > 4096 || h > 4096) return "attachment.dims"
        if (e.s("attachmentId") != e.s("sha256").substring(0, 32)) return "attachment.idMismatch"   // the ID is the hash: bytes can be verified end to end
        if (e.validityMs > MAX_MISSING_MS) return "attachment.validity"
        return null
    }
}

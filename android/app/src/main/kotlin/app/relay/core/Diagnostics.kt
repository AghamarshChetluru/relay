package app.relay.core

/**
 * Field-test diagnostics: counters and a short event log kept in memory only. By design it never holds message text, addresses, packet or
 * case IDs, device addresses (MACs), or any key material: events are short fixed phrases plus the first 4 hex chars of a peer's rotating tag.
 * It exists so a tester can tell WHICH step of discovery/connection/exchange failed. It is not a delivery log: "confirmed stored" counts only
 * packets the other phone itself acknowledged as stored.
 */
class Diagnostics(private val capacity: Int = 80, private val clock: () -> Long = { System.currentTimeMillis() }, var sink: ((String) -> Unit)? = null) {
    class Event(val atMs: Long, val text: String, val repeats: Int)
    private val events = ArrayDeque<Event>()
    private val counters = LinkedHashMap<String, Long>()
    private val peers = HashSet<String>()

    @Synchronized fun count(name: String, by: Long = 1) { counters[name] = (counters[name] ?: 0L) + by }
    @Synchronized fun counter(name: String): Long = counters[name] ?: 0L
    @Synchronized fun peerSeen(tag4: String): Boolean { val isNew = peers.add(tag4); counters["distinctPeersSeen"] = peers.size.toLong(); return isNew }

    @Synchronized fun event(text: String) {
        val t = text.take(160)
        val last = events.lastOrNull()
        if (last != null && last.text == t) { events.removeLast(); events.addLast(Event(clock(), t, last.repeats + 1)) }   // collapse identical neighbours (e.g. a problem repeating every scan)
        else { events.addLast(Event(clock(), t, 1)); while (events.size > capacity) events.removeFirst() }
        sink?.invoke(t)
    }

    @Synchronized fun snapshotEvents(): List<Event> = events.toList()
    @Synchronized fun snapshotCounters(): Map<String, Long> = LinkedHashMap(counters)

    @Synchronized fun toJson(limit: Int = 40): String {
        val c = JsonObj(); counters.forEach { (k, v) -> c.num(k, v) }
        val ev = events.toList().takeLast(limit).reversed().map { JsonObj().num("at", it.atMs).str("text", it.text).num("n", it.repeats.toLong()).end() }
        return JsonObj().raw("counters", c.end()).raw("events", jsonArray(ev)).end()
    }

    /** Plain-text report a tester can paste into a message. [header] lines describe the phone (model, Android version, capabilities), never the user. */
    @Synchronized fun report(header: List<String>, nowMs: Long = clock()): String {
        val sb = StringBuilder("Relay field-test diagnostics (no message text, addresses or keys are included)\n")
        header.forEach { sb.append(it).append('\n') }
        sb.append("\nCounters\n"); counters.forEach { (k, v) -> sb.append("  ").append(k).append(" = ").append(v).append('\n') }
        sb.append("\nEvents (newest last; time = seconds before this report)\n")
        events.forEach { sb.append("  -").append(maxOf(0L, (nowMs - it.atMs) / 1000)).append("s  ").append(it.text).append(if (it.repeats > 1) "  (x${it.repeats})" else "").append('\n') }
        return sb.toString()
    }
}

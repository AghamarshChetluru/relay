package app.relay.core

/**
 * Coarse, illustrative offline neighbourhood graph for south/central Delhi (same data as prototype/mesh.js).
 * NOT a survey: an edge means "neighbouring or directly linked by a main road". Only hop distance is used. No coordinates, no GPS.
 */
object Neighborhoods {
    val all: List<Pair<String, String>> = listOf(
        "HK" to "Hauz Khas", "GP" to "Green Park", "SE" to "Safdarjung Enclave", "BS" to "Ber Sarai", "JS" to "Jia Sarai",
        "VV" to "Vasant Vihar", "CP" to "Connaught Place", "LC" to "Lodhi Colony", "CK" to "Chanakyapuri", "LN" to "Lajpat Nagar"
    )
    val edges: List<Pair<String, String>> = listOf(
        "HK" to "GP", "HK" to "SE", "HK" to "BS", "HK" to "JS", "BS" to "JS", "BS" to "VV", "GP" to "SE", "GP" to "LN",
        "SE" to "LC", "SE" to "VV", "LC" to "CP", "LC" to "CK", "LC" to "LN", "CK" to "CP", "CK" to "VV"
    )
    private val names = all.toMap()
    private val dist: Map<String, Map<String, Int>> = run {
        val adj = HashMap<String, MutableList<String>>(); all.forEach { adj[it.first] = mutableListOf() }
        edges.forEach { adj[it.first]!!.add(it.second); adj[it.second]!!.add(it.first) }
        all.associate { (id, _) ->
            val d = HashMap<String, Int>(); d[id] = 0; val q = ArrayDeque<String>(); q.add(id)
            while (q.isNotEmpty()) { val c = q.removeFirst(); for (o in adj[c]!!) if (!d.containsKey(o)) { d[o] = d[c]!! + 1; q.add(o) } }
            id to d
        }
    }
    fun isValid(id: String?): Boolean = id != null && names.containsKey(id)
    fun nameOf(id: String?): String = if (id == null) "" else names[id] ?: ""
    fun distance(a: String?, b: String?): Int? = if (a == null || b == null) null else dist[a]?.get(b)
    fun distanceToSet(h: String?, targets: List<String>): Int? {
        if (h == null) return null
        var best: Int? = null
        for (t in targets) { val d = distance(h, t); if (d != null && (best == null || d < best)) best = d }
        return best
    }
}

package app.relay.core

/** Tiny dependency-free JSON (so the UI bridge is unit-testable on the JVM). Numbers parse as Double/Long; objects as Map; arrays as List. */
object Json {
    fun esc(s: String): String {
        val sb = StringBuilder(s.length + 2); sb.append('"')
        for (c in s) when {
            c == '"' -> sb.append("\\\""); c == '\\' -> sb.append("\\\\"); c == '\n' -> sb.append("\\n"); c == '\r' -> sb.append("\\r"); c == '\t' -> sb.append("\\t")
            c.code < 0x20 || c == ' ' || c == ' ' -> sb.append(String.format("\\u%04x", c.code))
            else -> sb.append(c)
        }
        return sb.append('"').toString()
    }

    fun parse(text: String, maxDepth: Int = 12, maxLen: Int = 200_000): Any? {
        if (text.length > maxLen) throw WireException("json too large")
        val p = Parser(text, maxDepth); val v = p.value(0); p.ws(); if (!p.end()) throw WireException("trailing json"); return v
    }

    private class Parser(val s: String, val maxDepth: Int) {
        var i = 0
        fun end() = i >= s.length
        fun ws() { while (i < s.length && s[i].isWhitespace()) i++ }
        fun value(depth: Int): Any? {
            if (depth > maxDepth) throw WireException("json too deep"); ws()
            if (i >= s.length) throw WireException("json eof")
            return when (val c = s[i]) {
                '{' -> obj(depth); '[' -> arr(depth); '"' -> str()
                't' -> lit("true", true); 'f' -> lit("false", false); 'n' -> lit("null", null)
                else -> if (c == '-' || c.isDigit()) num() else throw WireException("json char $c")
            }
        }
        fun lit(w: String, v: Any?): Any? { if (!s.startsWith(w, i)) throw WireException("json literal"); i += w.length; return v }
        fun num(): Any { val st = i; if (s[i] == '-') i++; while (i < s.length && (s[i].isDigit() || s[i] in ".eE+-")) i++
            val t = s.substring(st, i); return t.toLongOrNull() ?: t.toDoubleOrNull() ?: throw WireException("json number") }
        fun str(): String {
            i++; val sb = StringBuilder()
            while (true) {
                if (i >= s.length) throw WireException("json string eof")
                val c = s[i++]
                if (c == '"') return sb.toString()
                if (c == '\\') {
                    if (i >= s.length) throw WireException("json escape")
                    when (val e = s[i++]) {
                        '"' -> sb.append('"'); '\\' -> sb.append('\\'); '/' -> sb.append('/'); 'n' -> sb.append('\n'); 'r' -> sb.append('\r'); 't' -> sb.append('\t'); 'b' -> sb.append('\b'); 'f' -> sb.append('\u000c')
                        'u' -> { if (i + 4 > s.length) throw WireException("json unicode"); sb.append(s.substring(i, i + 4).toInt(16).toChar()); i += 4 }
                        else -> throw WireException("json escape $e")
                    }
                } else sb.append(c)
            }
        }
        fun arr(depth: Int): List<Any?> {
            i++; val out = ArrayList<Any?>(); ws(); if (i < s.length && s[i] == ']') { i++; return out }
            while (true) { out.add(value(depth + 1)); ws(); if (i >= s.length) throw WireException("json arr eof"); if (s[i] == ',') { i++; continue }; if (s[i] == ']') { i++; return out }; throw WireException("json arr") }
        }
        fun obj(depth: Int): Map<String, Any?> {
            i++; val out = LinkedHashMap<String, Any?>(); ws(); if (i < s.length && s[i] == '}') { i++; return out }
            while (true) {
                ws(); if (i >= s.length || s[i] != '"') throw WireException("json key"); val k = str(); ws()
                if (i >= s.length || s[i] != ':') throw WireException("json colon"); i++
                out[k] = value(depth + 1); ws()
                if (i >= s.length) throw WireException("json obj eof"); if (s[i] == ',') { i++; continue }; if (s[i] == '}') { i++; return out }; throw WireException("json obj")
            }
        }
    }
}

/** Minimal JSON writer. */
class JsonObj {
    private val sb = StringBuilder("{"); private var first = true
    private fun k(key: String) { if (!first) sb.append(','); first = false; sb.append(Json.esc(key)).append(':') }
    fun str(key: String, v: String?): JsonObj { k(key); sb.append(if (v == null) "null" else Json.esc(v)); return this }
    fun num(key: String, v: Long): JsonObj { k(key); sb.append(v); return this }
    fun bool(key: String, v: Boolean): JsonObj { k(key); sb.append(v); return this }
    fun raw(key: String, json: String): JsonObj { k(key); sb.append(json); return this }
    fun end(): String = sb.append('}').toString()
}
fun jsonArray(items: List<String>): String = items.joinToString(",", "[", "]")
fun jsonStrings(items: Collection<String>): String = jsonArray(items.map { Json.esc(it) })

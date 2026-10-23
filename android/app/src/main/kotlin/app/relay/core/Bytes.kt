package app.relay.core

import java.io.ByteArrayOutputStream
import java.security.MessageDigest

/** Thrown for any malformed, truncated or over-limit wire data. Always safe to catch: it means "drop the peer's frame/session". */
class WireException(message: String) : Exception(message)

private val HEX = "0123456789abcdef".toCharArray()

fun ByteArray.hex(): String {
    val c = CharArray(size * 2)
    for (i in indices) { val v = this[i].toInt() and 0xff; c[i * 2] = HEX[v ushr 4]; c[i * 2 + 1] = HEX[v and 15] }
    return String(c)
}

fun String.unhex(): ByteArray {
    if (length % 2 != 0) throw WireException("odd hex length")
    val out = ByteArray(length / 2)
    for (i in out.indices) {
        val hi = Character.digit(this[i * 2], 16); val lo = Character.digit(this[i * 2 + 1], 16)
        if (hi < 0 || lo < 0) throw WireException("bad hex")
        out[i] = ((hi shl 4) or lo).toByte()
    }
    return out
}

fun sha256(vararg parts: ByteArray): ByteArray {
    val md = MessageDigest.getInstance("SHA-256")
    for (p in parts) md.update(p)
    return md.digest()
}

/** 16-byte truncated SHA-256, the size of every ID in the protocol. */
fun id16(vararg parts: ByteArray): ByteArray = sha256(*parts).copyOf(16)

class Writer {
    private val out = ByteArrayOutputStream()
    fun u8(v: Int): Writer { out.write(v and 0xff); return this }
    fun u16(v: Int): Writer { out.write((v ushr 8) and 0xff); out.write(v and 0xff); return this }
    fun u32(v: Long): Writer { for (s in intArrayOf(24, 16, 8, 0)) out.write(((v ushr s) and 0xff).toInt()); return this }
    fun u64(v: Long): Writer { for (s in intArrayOf(56, 48, 40, 32, 24, 16, 8, 0)) out.write(((v ushr s) and 0xff).toInt()); return this }
    fun varint(v: Int): Writer {
        require(v >= 0)
        var x = v
        while (x >= 0x80) { out.write((x and 0x7f) or 0x80); x = x ushr 7 }
        out.write(x); return this
    }
    fun raw(b: ByteArray): Writer { out.write(b); return this }
    fun bytes(b: ByteArray): Writer { varint(b.size); out.write(b); return this }
    fun str(s: String): Writer = bytes(s.toByteArray(Charsets.UTF_8))
    fun toByteArray(): ByteArray = out.toByteArray()
}

class Reader(private val b: ByteArray, private var p: Int = 0, private val end: Int = b.size) {
    fun remaining(): Int = end - p
    private fun need(n: Int) { if (n < 0 || n > end - p) throw WireException("truncated") }
    fun u8(): Int { need(1); return b[p++].toInt() and 0xff }
    fun u16(): Int { need(2); val v = ((b[p].toInt() and 0xff) shl 8) or (b[p + 1].toInt() and 0xff); p += 2; return v }
    fun u32(): Long { need(4); var v = 0L; repeat(4) { v = (v shl 8) or (b[p++].toLong() and 0xff) }; return v }
    fun u64(): Long { need(8); var v = 0L; repeat(8) { v = (v shl 8) or (b[p++].toLong() and 0xff) }; return v }
    fun varint(): Int {
        var shift = 0; var v = 0
        while (true) {
            val x = u8()
            v = v or ((x and 0x7f) shl shift)
            if (x and 0x80 == 0) { if (v < 0) throw WireException("varint overflow"); return v }
            shift += 7
            if (shift > 28) throw WireException("varint too long")
        }
    }
    fun raw(n: Int): ByteArray { need(n); val r = b.copyOfRange(p, p + n); p += n; return r }
    fun bytes(maxLen: Int): ByteArray { val n = varint(); if (n > maxLen) throw WireException("field too long ($n > $maxLen)"); return raw(n) }
    fun str(maxLen: Int): String {
        val raw = bytes(maxLen * 4)
        val s = try { Charsets.UTF_8.newDecoder().decode(java.nio.ByteBuffer.wrap(raw)).toString() } catch (e: java.nio.charset.CharacterCodingException) { throw WireException("bad utf-8") }
        if (s.length > maxLen) throw WireException("string too long")
        return s
    }
}

package app.relay.store

import android.content.ContentValues
import android.content.Context
import android.database.sqlite.SQLiteDatabase
import android.database.sqlite.SQLiteOpenHelper
import app.relay.core.*

/**
 * Durable on-device state: the store-carry-forward queue, seen-ID tombstones, per-peer send receipts, attachments, settings.
 * Survives app close, process kill and reboot. Calls are serialized by the engine; each write is a single statement or transaction.
 */
class SqliteStore(ctx: Context, name: String? = "relay.db") : SQLiteOpenHelper(ctx, name, null, VERSION), Store {
    companion object { const val VERSION = 1 }

    override fun onConfigure(db: SQLiteDatabase) { db.setForeignKeyConstraintsEnabled(false); db.enableWriteAheadLogging() }

    override fun onCreate(db: SQLiteDatabase) {
        db.execSQL("CREATE TABLE packets(id TEXT PRIMARY KEY, case_id TEXT, type INTEGER NOT NULL, version INTEGER NOT NULL, origin TEXT NOT NULL, wire BLOB NOT NULL, hops INTEGER NOT NULL, detours INTEGER NOT NULL, tgt INTEGER NOT NULL, received_ms INTEGER NOT NULL, expires_ms INTEGER NOT NULL, age_ms INTEGER NOT NULL, authored INTEGER NOT NULL, via TEXT)")
        db.execSQL("CREATE INDEX packets_case ON packets(case_id)")
        db.execSQL("CREATE TABLE seen(id TEXT PRIMARY KEY, until_ms INTEGER NOT NULL)")
        db.execSQL("CREATE TABLE sent(id TEXT NOT NULL, peer TEXT NOT NULL, ms INTEGER NOT NULL, detour INTEGER NOT NULL, PRIMARY KEY(id, peer))")
        db.execSQL("CREATE TABLE origins(origin TEXT NOT NULL, ms INTEGER NOT NULL)")
        db.execSQL("CREATE INDEX origins_o ON origins(origin, ms)")
        db.execSQL("CREATE TABLE attachments(id TEXT PRIMARY KEY, case_id TEXT NOT NULL, size INTEGER NOT NULL, sha TEXT NOT NULL, w INTEGER NOT NULL, h INTEGER NOT NULL, complete INTEGER NOT NULL, received INTEGER NOT NULL, authored INTEGER NOT NULL, data BLOB)")
        db.execSQL("CREATE TABLE settings(k TEXT PRIMARY KEY, v BLOB)")
        db.execSQL("CREATE TABLE flags(kind TEXT NOT NULL, k TEXT NOT NULL, PRIMARY KEY(kind, k))")
        db.execSQL("CREATE TABLE private_addr(case_id TEXT PRIMARY KEY, building TEXT NOT NULL, directions TEXT NOT NULL)")
    }
    override fun onUpgrade(db: SQLiteDatabase, oldVersion: Int, newVersion: Int) { /* v1 is the first schema; future migrations are added here and covered by MigrationTest */ }

    private fun rowToPacket(c: android.database.Cursor): StoredPacket? = try {
        StoredPacket(Envelope.decode(c.getBlob(0)), c.getInt(1), c.getInt(2), c.getInt(3) == 1, c.getLong(4), c.getLong(5), c.getLong(6), c.getInt(7) == 1, c.getString(8))
    } catch (e: WireException) { null }   // a corrupted row is skipped, never crashes the app
    private val COLS = "wire,hops,detours,tgt,received_ms,expires_ms,age_ms,authored,via"

    override fun getPacket(id: String): StoredPacket? = readableDatabase.rawQuery("SELECT $COLS FROM packets WHERE id=?", arrayOf(id)).use { if (it.moveToFirst()) rowToPacket(it) else null }
    override fun putPacket(p: StoredPacket): Boolean {
        val v = ContentValues().apply {
            put("id", p.id); put("case_id", p.env.caseHex); put("type", p.env.type.code); put("version", p.env.caseVersion); put("origin", p.env.originDevice)
            put("wire", p.env.wire()); put("hops", p.hops); put("detours", p.detours); put("tgt", if (p.tgt) 1 else 0); put("received_ms", p.receivedMs)
            put("expires_ms", p.expiresMs); put("age_ms", p.ageAtReceiptMs); put("authored", if (p.authored) 1 else 0); put("via", p.via)
        }
        return writableDatabase.insertWithOnConflict("packets", null, v, SQLiteDatabase.CONFLICT_IGNORE) != -1L
    }
    override fun deletePacket(id: String) { writableDatabase.delete("packets", "id=?", arrayOf(id)) }
    override fun packets(): List<StoredPacket> = readableDatabase.rawQuery("SELECT $COLS FROM packets ORDER BY received_ms", null).use { c -> val o = ArrayList<StoredPacket>(); while (c.moveToNext()) rowToPacket(c)?.let { o.add(it) }; o }
    override fun packetsForCase(caseHex: String): List<StoredPacket> = readableDatabase.rawQuery("SELECT $COLS FROM packets WHERE case_id=? ORDER BY received_ms", arrayOf(caseHex)).use { c -> val o = ArrayList<StoredPacket>(); while (c.moveToNext()) rowToPacket(c)?.let { o.add(it) }; o }

    override fun markSeen(id: String, untilMs: Long) { writableDatabase.execSQL("INSERT INTO seen(id,until_ms) VALUES(?,?) ON CONFLICT(id) DO UPDATE SET until_ms=MAX(until_ms,excluded.until_ms)", arrayOf<Any>(id, untilMs)) }
    override fun isSeen(id: String) = readableDatabase.rawQuery("SELECT 1 FROM seen WHERE id=?", arrayOf(id)).use { it.moveToFirst() }
    override fun purgeSeen(nowMs: Long) { writableDatabase.delete("seen", "until_ms<?", arrayOf(nowMs.toString())); writableDatabase.delete("origins", "ms<?", arrayOf((nowMs - 2 * 3_600_000L).toString())) }

    override fun recordSent(id: String, peer: String, ms: Long, detour: Boolean) { writableDatabase.execSQL("INSERT OR IGNORE INTO sent(id,peer,ms,detour) VALUES(?,?,?,?)", arrayOf<Any>(id, peer, ms, if (detour) 1 else 0)) }
    override fun sentCounts(id: String): SentCounts = readableDatabase.rawQuery("SELECT COUNT(*), SUM(CASE WHEN detour=0 THEN 1 ELSE 0 END), SUM(CASE WHEN detour=1 THEN 1 ELSE 0 END), MAX(CASE WHEN detour=0 THEN ms END) FROM sent WHERE id=?", arrayOf(id))
        .use { it.moveToFirst(); SentCounts(it.getInt(0), it.getInt(1), it.getInt(2), if (it.isNull(3)) 0L else it.getLong(3)) }
    override fun hasSentTo(id: String, peer: String) = readableDatabase.rawQuery("SELECT 1 FROM sent WHERE id=? AND peer=?", arrayOf(id, peer)).use { it.moveToFirst() }

    override fun noteOrigin(origin: String, ms: Long) { writableDatabase.execSQL("INSERT INTO origins(origin,ms) VALUES(?,?)", arrayOf<Any>(origin, ms)) }
    override fun originCount(origin: String, sinceMs: Long) = readableDatabase.rawQuery("SELECT COUNT(*) FROM origins WHERE origin=? AND ms>=?", arrayOf(origin, sinceMs.toString())).use { it.moveToFirst(); it.getInt(0) }

    private fun metaOf(c: android.database.Cursor) = AttachmentMeta(c.getString(0), c.getString(1), c.getInt(2), c.getString(3), c.getInt(4), c.getInt(5), c.getInt(6) == 1, c.getInt(7), c.getInt(8) == 1)
    private val ACOLS = "id,case_id,size,sha,w,h,complete,received,authored"
    override fun getAttachmentMeta(id: String) = readableDatabase.rawQuery("SELECT $ACOLS FROM attachments WHERE id=?", arrayOf(id)).use { if (it.moveToFirst()) metaOf(it) else null }
    override fun putAttachmentMeta(m: AttachmentMeta) {
        val v = ContentValues().apply { put("id", m.id); put("case_id", m.caseHex); put("size", m.size); put("sha", m.sha256Hex); put("w", m.w); put("h", m.h); put("complete", if (m.complete) 1 else 0); put("received", m.received); put("authored", if (m.authored) 1 else 0); put("data", ByteArray(0)) }
        writableDatabase.insertWithOnConflict("attachments", null, v, SQLiteDatabase.CONFLICT_IGNORE)
    }
    override fun attachmentBytes(id: String): ByteArray? = readableDatabase.rawQuery("SELECT data FROM attachments WHERE id=?", arrayOf(id)).use { if (it.moveToFirst()) it.getBlob(0) else null }
    override fun appendAttachment(id: String, offset: Int, data: ByteArray): Boolean {
        val db = writableDatabase; db.beginTransaction()
        try {
            val m = getAttachmentMeta(id) ?: return false; val cur = attachmentBytes(id) ?: ByteArray(0)
            if (cur.size != offset || m.complete || offset + data.size > m.size) return false
            val nb = cur + data; val v = ContentValues().apply { put("data", nb); put("received", nb.size) }
            db.update("attachments", v, "id=?", arrayOf(id)); db.setTransactionSuccessful(); return true
        } finally { db.endTransaction() }
    }
    override fun completeAttachment(id: String) { writableDatabase.execSQL("UPDATE attachments SET complete=1, received=size WHERE id=?", arrayOf<Any>(id)) }
    override fun resetAttachment(id: String) { writableDatabase.execSQL("UPDATE attachments SET complete=0, received=0, data=x'' WHERE id=?", arrayOf<Any>(id)) }
    override fun deleteAttachment(id: String) { writableDatabase.delete("attachments", "id=?", arrayOf(id)) }
    override fun attachments(): List<AttachmentMeta> = readableDatabase.rawQuery("SELECT $ACOLS FROM attachments", null).use { c -> val o = ArrayList<AttachmentMeta>(); while (c.moveToNext()) o.add(metaOf(c)); o }
    override fun attachmentStoreBytes(): Long = readableDatabase.rawQuery("SELECT COALESCE(SUM(received),0) FROM attachments", null).use { it.moveToFirst(); it.getLong(0) }

    override fun getSetting(key: String): ByteArray? = readableDatabase.rawQuery("SELECT v FROM settings WHERE k=?", arrayOf(key)).use { if (it.moveToFirst()) it.getBlob(0) else null }
    override fun setSetting(key: String, value: ByteArray) { val v = ContentValues().apply { put("k", key); put("v", value) }; writableDatabase.insertWithOnConflict("settings", null, v, SQLiteDatabase.CONFLICT_REPLACE) }
    override fun setFlag(kind: String, key: String) { writableDatabase.execSQL("INSERT OR IGNORE INTO flags(kind,k) VALUES(?,?)", arrayOf<Any>(kind, key)) }
    override fun hasFlag(kind: String, key: String) = readableDatabase.rawQuery("SELECT 1 FROM flags WHERE kind=? AND k=?", arrayOf(kind, key)).use { it.moveToFirst() }
    override fun flags(kind: String): Set<String> = readableDatabase.rawQuery("SELECT k FROM flags WHERE kind=?", arrayOf(kind)).use { c -> val o = HashSet<String>(); while (c.moveToNext()) o.add(c.getString(0)); o }
    override fun putPrivateAddress(caseHex: String, building: String, directions: String) { writableDatabase.execSQL("INSERT OR REPLACE INTO private_addr(case_id,building,directions) VALUES(?,?,?)", arrayOf<Any>(caseHex, building, directions)) }
    override fun getPrivateAddress(caseHex: String): Pair<String, String>? = readableDatabase.rawQuery("SELECT building,directions FROM private_addr WHERE case_id=?", arrayOf(caseHex)).use { if (it.moveToFirst()) it.getString(0) to it.getString(1) else null }
}

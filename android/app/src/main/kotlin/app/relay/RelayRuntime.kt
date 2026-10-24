package app.relay

import android.content.Context
import app.relay.ble.BleTransport
import app.relay.core.*
import app.relay.store.KeystoreProtector
import app.relay.store.SqliteStore
import java.util.concurrent.CopyOnWriteArrayList

/** Process-wide holder of the engine and radio. Created lazily; the durable state lives in SQLite, so a killed process loses nothing. */
@android.annotation.SuppressLint("StaticFieldLeak")   // holds only the application context
object RelayRuntime {
    private var engine: RelayEngine? = null
    private var ble: BleTransport? = null
    val listeners = CopyOnWriteArrayList<() -> Unit>()
    @Volatile var identityWasReset = false; private set
    /** True while MainActivity is in front. Decides banner (open) versus Android notification (closed). */
    @Volatile var foreground = false
    /** A message the user asked to open (notification tap) before the page was ready to show it. Taken by the page exactly once. */
    @Volatile var pendingOpen: Ref? = null

    fun engineOrNull(): RelayEngine? = engine
    @Synchronized fun engine(ctx: Context): RelayEngine {
        engine?.let { return it }
        val app = ctx.applicationContext
        val store = SqliteStore(app); val crypto = TinkCrypto(); val prot = KeystoreProtector()
        val identity = try { store.getSetting("identity")?.let { Identity.deserialize(prot.unwrap(it)) } } catch (e: Exception) { null }
            ?: Identity.create(crypto).also { fresh ->
                if (store.getSetting("identity") != null) identityWasReset = true    // keystore key lost (e.g. restore on another phone): old authorship cannot be proven any more
                store.setSetting("identity", prot.wrap(fresh.serialize()))
            }
        ReadState.initIfNeeded(store)
        val e = RelayEngine(store, crypto, identity)
        e.onChange = { notifyChanged() }
        e.onStored = { sp -> NoticeCenter.onStored(app, e, sp) }
        engine = e
        ble = BleTransport(app, e) { notifyChanged() }
        return e
    }
    @Synchronized fun ble(ctx: Context): BleTransport { engine(ctx); return ble!! }
    fun snapshot(ctx: Context): String = Snapshot.build(engine(ctx), ble(ctx).status())
    fun notifyChanged() { listeners.forEach { try { it() } catch (_: Exception) {} } }
}

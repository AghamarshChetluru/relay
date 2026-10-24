package app.relay

import android.content.Context
import android.os.Handler
import android.os.Looper
import app.relay.core.*
import app.relay.ui.Notifier
import java.util.concurrent.CopyOnWriteArrayList

/**
 * Turns "a packet was newly stored" into either an in-app banner (the app is open) or an Android notification (it is not).
 * It never looks at snapshots, so polling, radio-status changes, duplicates and photo chunks cannot trigger anything.
 */
object NoticeCenter {
    private const val WINDOW_MS = 3_000L
    private val main = Handler(Looper.getMainLooper())
    private val batch = ArrayList<Notice>()
    private var scheduled = false                    // one flush pending at a time, whatever else happened in between
    private val flushTask = Runnable { flush() }     // one cancellable task, so a reset can never leave an old timer to fire into later work
    /** Notices waiting for the open app to show them as banners. Drained by NativeBridge.takeIncoming(). */
    val incoming = CopyOnWriteArrayList<Notice>()
    @Volatile var appContext: Context? = null

    fun onStored(ctx: Context, engine: RelayEngine, sp: StoredPacket) {
        inheritRead(engine, sp)
        val n = Inbox.classify(engine, sp) ?: return
        if (engine.store.hasFlag(ReadState.ANNOUNCED, sp.id)) return          // never announce the same packet twice, even across restarts
        engine.store.setFlag(ReadState.ANNOUNCED, sp.id)
        appContext = ctx.applicationContext
        if (RelayRuntime.foreground) {                      // the app is open: only IMPORTANT messages interrupt with a pop-up; the rest just appear in the inbox (badge, "New to you")
            if (n.important) { incoming.add(n); while (incoming.size > 20) incoming.removeAt(0) }
            RelayRuntime.notifyChanged(); return }
        synchronized(batch) { batch.add(n); if (!scheduled) { scheduled = true; main.postDelayed(flushTask, WINDOW_MS) } }
    }

    /** A renewal that only extended the time carries the earlier version's read state, so one request never turns unread twice. (Runs before housekeeping removes the old version.) */
    private fun inheritRead(engine: RelayEngine, sp: StoredPacket) {
        val e = sp.env; val c = e.caseHex
        if (e.type != PacketType.REQUEST || c == null || e.caseVersion == 0 || sp.authored) return
        val prev = engine.requestVersions(c).lastOrNull { it.env.caseVersion < e.caseVersion } ?: return
        if (Inbox.contentKey(prev.env) == Inbox.contentKey(e) && ReadState.isRead(engine.store, prev.id)) { ReadState.markRead(engine.store, listOf(sp.id)); engine.store.setFlag(ReadState.ANNOUNCED, sp.id) }
    }

    private fun flush() {
        val ctx = appContext ?: return
        val list = synchronized(batch) { val c = ArrayList(batch); batch.clear(); scheduled = false; c }
        if (list.isEmpty()) return
        if (RelayRuntime.foreground) { list.filter { it.important }.forEach { incoming.add(it) }; RelayRuntime.notifyChanged(); return }   // the user opened the app during the window: pop-ups (important ones) instead
        RelayRuntime.engineOrNull()?.let { e -> list.filter { it.important }.forEach { park(e.store, it) } }          // remembered so the app can show them as a pop-up the moment it is opened
        Notifier.post(ctx, NoticePlan.plan(list))
    }
    /**
     * Important notices announced while the app was closed. They are remembered in the phone's own database (flags "popup" = queued, "popped" = already shown or opened from the
     * notification), so they still greet the person when the app opens even if Android killed the process in between. Each shows at most once, and never if it was already read.
     */
    internal fun park(store: Store, n: Notice) { if (n.eventId.isNotEmpty()) store.setFlag(POPUP, n.eventId) }
    fun surfaceMissed(engine: RelayEngine) {
        val st = engine.store; var any = false
        for (id in st.flags(POPUP)) {
            if (st.hasFlag(POPPED, id)) continue
            st.setFlag(POPPED, id)
            if (ReadState.isRead(st, id)) continue
            val sp = st.getPacket(id) ?: continue
            val n = Inbox.classify(engine, sp.copy(authored = false)) ?: continue
            if (n.important) { incoming.add(n); any = true }
        }
        while (incoming.size > 20) incoming.removeAt(0)
        if (any) RelayRuntime.notifyChanged()
    }
    /** The person opened the message from its notification (or by hand): it must not pop up again. */
    fun forget(store: Store, eventIds: Collection<String>) { eventIds.forEach { store.setFlag(POPPED, it) } }
    /** The person tapped the "N new messages" notification: they are looking at the inbox, so nothing parked for a pop-up needs to greet them again. */
    fun forgetAllParked(store: Store) { store.flags(POPUP).forEach { store.setFlag(POPPED, it) } }
    private const val POPUP = "popup"; private const val POPPED = "popped"
    /** Tests only: forget everything pending. */
    internal fun resetForTest() { main.removeCallbacks(flushTask); synchronized(batch) { batch.clear(); scheduled = false }; incoming.clear() }
    fun drainIncoming(): List<Notice> { val l = incoming.toList(); incoming.clear(); return l }
}

package app.relay.ui

import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.content.Context
import android.content.Intent
import android.net.Uri
import android.os.Build
import androidx.core.app.NotificationCompat
import androidx.core.app.NotificationManagerCompat
import app.relay.R
import app.relay.core.NoticeKind
import app.relay.core.NoticePlan
import app.relay.core.Notice
import app.relay.core.Ref

/**
 * Android system notifications for newly received messages. A notification means "this phone stored a message"; it says nothing to the sender.
 * Every notification gets its own PendingIntent (unique data URI + request code), so two notifications can never open the same destination by mistake.
 * Lock-screen content is generic by default (the full line is only shown once the phone is unlocked).
 */
object Notifier {
    const val CH_RESPONSES = "relay_responses"; const val CH_MESSAGES = "relay_messages"
    const val ACTION_OPEN = "app.relay.OPEN_MESSAGE"
    const val X_TYPE = "relay.t"; const val X_CASE = "relay.c"; const val X_PACKET = "relay.p"
    private const val SUMMARY_ID = 4242

    fun ensureChannels(ctx: Context) {
        val nm = ctx.getSystemService(NotificationManager::class.java)
        nm.createNotificationChannel(NotificationChannel(CH_RESPONSES, "Important: responses and urgent help near you", NotificationManager.IMPORTANCE_HIGH).apply {
            description = "Someone replied to your request or acknowledged your offer, or an urgent request was reported in your area"; lockscreenVisibility = android.app.Notification.VISIBILITY_PRIVATE })
        nm.createNotificationChannel(NotificationChannel(CH_MESSAGES, "New messages on this phone", NotificationManager.IMPORTANCE_DEFAULT).apply {
            description = "Help requests and community updates that reached this phone"; lockscreenVisibility = android.app.Notification.VISIBILITY_PRIVATE })
    }

    fun enabled(ctx: Context): Boolean = NotificationManagerCompat.from(ctx).areNotificationsEnabled()

    /** The intent a notification (or anything else) uses to open one stored message. Data makes it unique; extras carry the reference. */
    fun openIntent(ctx: Context, ref: Ref): Intent = Intent(ctx, MainActivity::class.java).setAction(ACTION_OPEN)
        .setData(Uri.Builder().scheme("relay").authority("open").appendPath(ref.t).appendQueryParameter("c", ref.caseId ?: "").appendQueryParameter("p", ref.packetId ?: "").build())
        .putExtra(X_TYPE, ref.t).putExtra(X_CASE, ref.caseId).putExtra(X_PACKET, ref.packetId)
        .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_SINGLE_TOP or Intent.FLAG_ACTIVITY_CLEAR_TOP)

    fun refFrom(i: Intent?): Ref? = if (i?.action == ACTION_OPEN) Ref.parse(i.getStringExtra(X_TYPE), i.getStringExtra(X_CASE), i.getStringExtra(X_PACKET)) else null

    fun idFor(ref: Ref): Int = (ref.key.hashCode() and 0x7fffffff).let { if (it == SUMMARY_ID) it + 1 else it }
    private fun pending(ctx: Context, ref: Ref): PendingIntent = PendingIntent.getActivity(ctx, idFor(ref), openIntent(ctx, ref), PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT)

    private const val X_COUNT = "relay.count"; private const val X_PRI = "relay.pri"
    private fun isInboxTag(t: String?) = t == "summary" || t?.startsWith("e:") == true

    /** A new notification while earlier ones are still unopened in the shade: they all fold into ONE "N new messages" notification, never a growing stack. */
    private fun fold(ctx: Context, outs: List<NoticePlan.Out>): List<NoticePlan.Out> {
        if (outs.isEmpty()) return outs
        val nm = ctx.getSystemService(NotificationManager::class.java)
        val old = try { nm.activeNotifications.filter { it.packageName == ctx.packageName && isInboxTag(it.tag) } } catch (_: Exception) { emptyList() }
        if (old.isEmpty()) return outs
        val prior = old.sumOf { if (it.tag == "summary") it.notification.extras.getInt(X_COUNT, 1) else 1 }
        val priorPri = old.any { if (it.tag == "summary") it.notification.extras.getBoolean(X_PRI, false) else it.notification.channelId == CH_RESPONSES }
        val added = outs.sumOf { when (it) { is NoticePlan.Out.One -> 1; is NoticePlan.Out.Summary -> it.count } }
        val pri = priorPri || outs.any { when (it) { is NoticePlan.Out.One -> it.notice.important; is NoticePlan.Out.Summary -> it.priority } }
        old.filter { it.tag != "summary" }.forEach { try { nm.cancel(it.tag, it.id) } catch (_: Exception) {} }
        return listOf(NoticePlan.Out.Summary(prior + added, pri))
    }

    fun post(ctx: Context, planned: List<NoticePlan.Out>) {
        if (!enabled(ctx)) return           // in-app banners and the inbox still work; nothing is posted
        ensureChannels(ctx); val nm = NotificationManagerCompat.from(ctx)
        try {
            val outs = fold(ctx, planned)
            for (o in outs) when (o) {
                is NoticePlan.Out.One -> {
                    val n = o.notice; val ref = n.ref; val ch = if (n.important) CH_RESPONSES else CH_MESSAGES
                    val publicVersion = NotificationCompat.Builder(ctx, ch).setSmallIcon(R.drawable.ic_notification).setContentTitle("Relay").setContentText("New message on this phone").build()
                    val b = NotificationCompat.Builder(ctx, ch).setSmallIcon(R.drawable.ic_notification).setContentTitle(n.title)
                        .setContentText(listOf(n.where, n.about).filter { it.isNotEmpty() }.joinToString(" · ").ifEmpty { "Received on this phone" })
                        .setContentIntent(pending(ctx, ref)).setAutoCancel(true).setCategory(NotificationCompat.CATEGORY_MESSAGE)
                        .setVisibility(NotificationCompat.VISIBILITY_PRIVATE).setPublicVersion(publicVersion).setOnlyAlertOnce(true)
                        .setPriority(if (n.important) NotificationCompat.PRIORITY_HIGH else NotificationCompat.PRIORITY_DEFAULT)
                        .addAction(0, n.action, pending(ctx, ref))
                    nm.notify("e:" + n.eventId, idFor(ref), b.build())
                }
                is NoticePlan.Out.Summary -> {
                    val ref = Ref("inbox", null, null); val ch = if (o.priority) CH_RESPONSES else CH_MESSAGES
                    val publicVersion = NotificationCompat.Builder(ctx, ch).setSmallIcon(R.drawable.ic_notification).setContentTitle("Relay").setContentText("New messages on this phone").build()
                    nm.notify("summary", SUMMARY_ID, NotificationCompat.Builder(ctx, ch).setSmallIcon(R.drawable.ic_notification)
                        .setContentTitle("${o.count} new messages").setContentText("Tap to open and check them. Nothing is sent to the senders.")
                        .setContentIntent(pending(ctx, ref)).setAutoCancel(true).setVisibility(NotificationCompat.VISIBILITY_PRIVATE).setPublicVersion(publicVersion)
                        .setPriority(if (o.priority) NotificationCompat.PRIORITY_HIGH else NotificationCompat.PRIORITY_DEFAULT)
                        .addExtras(android.os.Bundle().apply { putInt(X_COUNT, o.count); putBoolean(X_PRI, o.priority) }).build())
                }
            }
        } catch (_: SecurityException) { /* permission revoked between the check and the post: stay quiet, never crash the radio */ }
    }

    /** Opening a message removes the notifications that announced it (the system tag is the stored packet's id). */
    fun cancelEvents(ctx: Context, eventIds: Collection<String>) {
        val tags = eventIds.map { "e:$it" }.toSet(); if (tags.isEmpty()) return
        val nm = ctx.getSystemService(NotificationManager::class.java)
        try { nm.activeNotifications.filter { it.tag in tags }.forEach { nm.cancel(it.tag, it.id) } } catch (_: Exception) {}
    }
    fun cancelSummaries(ctx: Context) { NotificationManagerCompat.from(ctx).cancel("summary", SUMMARY_ID) }
}

package com.smsweb.gateway

import android.app.AlarmManager
import android.app.PendingIntent
import android.content.Context
import android.content.Intent
import android.os.SystemClock

object MissedCallScheduler {
    // Silence window after the last missed call before a sequence is
    // finalized into a request. Tune this after testing on a real device.
    const val DEBOUNCE_WINDOW_MS = 9_000L

    private const val EXTRA_SENDER = "sender"

    fun schedule(context: Context, sender: String) {
        val intent = Intent(context, MissedCallFinalizeReceiver::class.java).apply {
            putExtra(EXTRA_SENDER, sender)
        }
        val pendingIntent = PendingIntent.getBroadcast(
            context,
            requestCode(sender),
            intent,
            PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE
        )
        val alarmManager = context.getSystemService(AlarmManager::class.java)
        alarmManager.setAndAllowWhileIdle(
            AlarmManager.ELAPSED_REALTIME_WAKEUP,
            SystemClock.elapsedRealtime() + DEBOUNCE_WINDOW_MS,
            pendingIntent
        )
    }

    fun senderFrom(intent: Intent?): String? = intent?.getStringExtra(EXTRA_SENDER)

    private fun requestCode(sender: String): Int {
        val digitSeed = sender.filter(Char::isDigit).takeLast(8).toLongOrNull()
        val bucket = if (digitSeed != null) (digitSeed % 100_000).toInt() else sender.hashCode().mod(100_000)
        return 200_000 + bucket
    }
}

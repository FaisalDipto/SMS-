package com.smsweb.gateway

import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent

class MissedCallFinalizeReceiver : BroadcastReceiver() {
    override fun onReceive(context: Context, intent: Intent?) {
        val sender = MissedCallScheduler.senderFrom(intent) ?: return
        val appContext = context.applicationContext
        val pendingResult = goAsync()
        Thread {
            try {
                MissedCallCoordinator(appContext).finalizeSequence(sender)
            } finally {
                pendingResult.finish()
            }
        }.start()
    }
}

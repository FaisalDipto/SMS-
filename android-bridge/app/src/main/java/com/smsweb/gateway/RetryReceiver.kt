package com.smsweb.gateway

import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent

class RetryReceiver : BroadcastReceiver() {
    override fun onReceive(context: Context, intent: Intent?) {
        val pendingResult = goAsync()
        Thread {
            try {
                GatewayCoordinator(context.applicationContext).flush()
            } finally {
                pendingResult.finish()
            }
        }.start()
    }
}

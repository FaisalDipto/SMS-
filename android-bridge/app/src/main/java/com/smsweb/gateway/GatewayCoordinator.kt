package com.smsweb.gateway

import android.content.Context
import android.os.Build
import android.telephony.SmsManager
import android.telephony.SubscriptionManager

class GatewayCoordinator(private val context: Context) {
    private val database = GatewayDatabase(context)
    private val pi = PiHttpClient(context)

    fun acceptIncomingSms(sender: String, text: String, subscriptionId: Int) {
        if (!GatewayConfig.isSenderAllowed(context, sender) || !SmsProtocol.isRequest(text)) return
        if (!database.enqueueToPi(sender, text, subscriptionId)) return
        flush()
    }

    fun flush() {
        var retryNeeded = false

        database.pending("TO_PI").forEach { item ->
            try {
                val response = pi.incoming(item.sender, item.text)
                database.markForwarded(item.id)
                database.enqueueToUser(response.recipient, response.text, item.subscriptionId)
            } catch (_: Exception) {
                database.markRetry(item.id)
                retryNeeded = true
            }
        }

        database.pending("TO_USER").forEach { item ->
            try {
                smsManager(item.subscriptionId)
                    .sendTextMessage(item.recipient, null, item.text, null, null)
                database.markSent(item.id)
                SmsProtocol.messageId(item.text)?.let { requestId ->
                    runCatching { pi.responseStatus(requestId, "sent") }
                }
            } catch (_: Exception) {
                database.markRetry(item.id)
                retryNeeded = true
            }
        }

        if (retryNeeded) RetryScheduler.schedule(context)
    }

    @Suppress("DEPRECATION")
    private fun smsManager(subscriptionId: Int): SmsManager {
        if (subscriptionId == SubscriptionManager.INVALID_SUBSCRIPTION_ID) {
            return SmsManager.getDefault()
        }

        return if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
            context.getSystemService(SmsManager::class.java)
                .createForSubscriptionId(subscriptionId)
        } else {
            SmsManager.getSmsManagerForSubscriptionId(subscriptionId)
        }
    }
}

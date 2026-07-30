package com.smsweb.gateway

import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.provider.Telephony
import android.telephony.SubscriptionManager

class SmsReceiver : BroadcastReceiver() {
    override fun onReceive(context: Context, intent: Intent) {
        if (intent.action != Telephony.Sms.Intents.SMS_RECEIVED_ACTION) return

        val pendingResult = goAsync()
        Thread {
            try {
                val subscriptionId = intent.getIntExtra(
                    SubscriptionManager.EXTRA_SUBSCRIPTION_INDEX,
                    SubscriptionManager.INVALID_SUBSCRIPTION_ID
                )
                val messagesBySender = Telephony.Sms.Intents.getMessagesFromIntent(intent)
                    .groupBy { message -> message.originatingAddress.orEmpty() }
                for ((sender, messages) in messagesBySender) {
                    val completeText = messages.joinToString(separator = "") { message ->
                        message.messageBody.orEmpty()
                    }
                    GatewayCoordinator(context.applicationContext)
                        .acceptIncomingSms(
                            sender,
                            completeText,
                            subscriptionId
                        )
                }
            } finally {
                pendingResult.finish()
            }
        }.start()
    }

}

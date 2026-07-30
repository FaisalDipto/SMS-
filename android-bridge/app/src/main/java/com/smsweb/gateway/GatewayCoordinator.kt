package com.smsweb.gateway

import android.content.Context
import android.content.Intent
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
                response.messages.forEach { responseText ->
                    val authentication = MessageAuthenticator.verify(
                        responseText,
                        GatewayConfig.authenticationKey(context)
                    )
                    if (authentication.status != AuthenticationStatus.AUTHENTICATED) {
                        broadcastSecurityRejection(authentication.reason)
                        return@forEach
                    }
                    val signature = authentication.signature ?: return@forEach
                    if (!database.rememberAuthenticatedMessage(
                            signature,
                            authentication.replayExpiresAt
                        )
                    ) {
                        broadcastSecurityRejection("A replayed authenticated response was blocked.")
                        return@forEach
                    }
                    if (database.enqueueToUser(
                            response.recipient,
                            responseText,
                            item.subscriptionId,
                            AuthenticationStatus.AUTHENTICATED.name
                        )
                    ) {
                        context.sendBroadcast(Intent(GatewayEvents.ACTION_PI_RESPONSE).apply {
                            setPackage(context.packageName)
                            putExtra(GatewayEvents.EXTRA_REQUEST_ID, SmsProtocol.messageId(responseText))
                            putExtra(GatewayEvents.EXTRA_TEXT, responseText)
                            putExtra(
                                GatewayEvents.EXTRA_AUTHENTICATION,
                                AuthenticationStatus.AUTHENTICATED.name
                            )
                        })
                    }
                }
            } catch (_: Exception) {
                database.markRetry(item.id)
                retryNeeded = true
            }
        }

        database.pending("TO_USER").forEach { item ->
            if (item.authentication != AuthenticationStatus.AUTHENTICATED.name) {
                database.markRejected(item.id)
                broadcastSecurityRejection("A legacy unauthenticated queued response was blocked.")
                return@forEach
            }
            try {
                SmsTransport.send(
                    smsManager(item.subscriptionId),
                    item.recipient,
                    item.text
                )
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

    private fun broadcastSecurityRejection(message: String) {
        context.sendBroadcast(Intent(GatewayEvents.ACTION_SECURITY_REJECTION).apply {
            setPackage(context.packageName)
            putExtra(GatewayEvents.EXTRA_ERROR, message)
        })
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

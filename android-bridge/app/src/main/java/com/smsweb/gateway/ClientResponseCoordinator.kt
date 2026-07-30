package com.smsweb.gateway

import android.content.Context
import android.content.Intent

class ClientResponseCoordinator(private val context: Context) {
    private val database = GatewayDatabase(context)

    fun acceptIncomingResponse(sender: String, text: String, subscriptionId: Int) {
        val requestId = SmsProtocol.messageId(text)
        if (!SmsProtocol.isResponse(text)) return
        if (!GatewayConfig.isServiceSender(context, sender)) {
            reject(requestId, "Response sender does not match the configured SMS service number.")
            return
        }

        val authentication = MessageAuthenticator.verify(
            text,
            GatewayConfig.authenticationKey(context)
        )
        if (authentication.status != AuthenticationStatus.AUTHENTICATED) {
            reject(requestId, authentication.reason)
            return
        }
        val signature = authentication.signature
        if (signature == null ||
            !database.rememberAuthenticatedMessage(signature, authentication.replayExpiresAt)
        ) {
            reject(requestId, "A replayed authenticated response was blocked.")
            return
        }
        if (!database.enqueueToWeb(
                sender,
                text,
                subscriptionId,
                AuthenticationStatus.AUTHENTICATED.name
            )
        ) {
            database.recordEvent(requestId, "DUPLICATE", "Duplicate response SMS was ignored.")
            return
        }

        database.recordEvent(
            requestId,
            "AUTHENTICATED",
            "Response SMS verified and saved for the user dashboard."
        )
        context.sendBroadcast(Intent(GatewayEvents.ACTION_PI_RESPONSE).apply {
            setPackage(context.packageName)
            putExtra(GatewayEvents.EXTRA_REQUEST_ID, requestId)
            putExtra(GatewayEvents.EXTRA_TEXT, text)
            putExtra(
                GatewayEvents.EXTRA_AUTHENTICATION,
                AuthenticationStatus.AUTHENTICATED.name
            )
        })
    }

    private fun reject(requestId: String?, message: String) {
        database.recordEvent(requestId, "REJECTED", message)
        context.sendBroadcast(Intent(GatewayEvents.ACTION_SECURITY_REJECTION).apply {
            setPackage(context.packageName)
            putExtra(GatewayEvents.EXTRA_ERROR, message)
        })
    }
}

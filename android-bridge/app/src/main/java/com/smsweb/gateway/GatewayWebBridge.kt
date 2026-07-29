package com.smsweb.gateway

import android.content.Context
import android.telephony.SmsManager
import android.webkit.JavascriptInterface
import android.webkit.WebView

class GatewayWebBridge(
    context: Context,
    private val webView: WebView
) {
    private val appContext = context.applicationContext

    @JavascriptInterface
    fun getGatewayStatus(): String = "ready"

    @JavascriptInterface
    fun getPiUrl(): String = GatewayConfig.piUrl(appContext)

    @JavascriptInterface
    fun savePiUrl(value: String): String {
        GatewayConfig.savePiUrl(appContext, value)
        return GatewayConfig.piUrl(appContext)
    }

    @JavascriptInterface
    fun getServiceNumber(): String = GatewayConfig.serviceNumber(appContext)

    @JavascriptInterface
    fun saveServiceNumber(value: String): String {
        GatewayConfig.saveServiceNumber(appContext, value)
        return GatewayConfig.serviceNumber(appContext)
    }

    @Suppress("DEPRECATION")
    @JavascriptInterface
    fun sendSms(recipient: String, text: String): String {
        if (recipient.trim().isEmpty() || !SmsProtocol.isRequest(text)) {
            return "invalid"
        }

        return try {
            SmsManager.getDefault().sendTextMessage(recipient.trim(), null, text, null, null)
            "queued"
        } catch (_: SecurityException) {
            "permission-denied"
        } catch (_: IllegalArgumentException) {
            "invalid"
        }
    }

    @JavascriptInterface
    fun checkPiConnection() {
        Thread {
            val connected = runCatching { PiHttpClient(appContext).health() }.getOrDefault(false)
            webView.post {
                webView.evaluateJavascript(
                    "window.SMSWeb?.gateway?.receiveConnectionStatus($connected)",
                    null
                )
            }
        }.start()
    }
}

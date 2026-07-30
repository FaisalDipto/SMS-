package com.smsweb.gateway

import android.telephony.SmsManager
import android.webkit.JavascriptInterface
import android.webkit.WebView
import org.json.JSONArray
import org.json.JSONObject

class GatewayWebBridge(
    private val activity: MainActivity,
    private val webView: WebView
) {
    private val appContext = activity.applicationContext

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

    @JavascriptInterface
    fun getPendingResponses(): String {
        val responses = JSONArray()
        GatewayDatabase(appContext).unreadWebResponses().forEach { response ->
            responses.put(JSONObject().apply {
                put("id", response.id)
                put("text", response.text)
            })
        }
        return responses.toString()
    }

    @JavascriptInterface
    fun acknowledgeResponse(text: String) {
        GatewayDatabase(appContext).markWebDeliveredByText(text)
    }

    @JavascriptInterface
    fun requestCurrentLocation(): String {
        activity.requestCurrentLocationForWeb()
        return "queued"
    }

    @Suppress("DEPRECATION")
    @JavascriptInterface
    fun sendSms(recipient: String, text: String): String {
        if (recipient.trim().isEmpty() || !SmsProtocol.isRequest(text)) {
            return "invalid"
        }

        return try {
            SmsTransport.send(SmsManager.getDefault(), recipient.trim(), text)
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

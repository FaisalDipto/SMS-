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
    fun getAppRole(): String = GatewayConfig.appRole(appContext)

    @JavascriptInterface
    fun isRoleLocked(): Boolean = GatewayConfig.isRoleLocked()

    @JavascriptInterface
    fun isUserConfigurationLocked(): Boolean = GatewayConfig.isUserEdition()

    @JavascriptInterface
    fun saveAppRole(value: String): String = GatewayConfig.saveAppRole(appContext, value)

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
    fun getAuthenticationStatus(): String =
        if (GatewayConfig.hasAuthenticationKey(appContext)) "configured" else "missing"

    @JavascriptInterface
    fun saveAuthenticationKey(value: String): String =
        if (GatewayConfig.saveAuthenticationKey(appContext, value)) "configured" else "invalid"

    @JavascriptInterface
    fun getPendingResponses(): String {
        val responses = JSONArray()
        GatewayDatabase(appContext).unreadWebResponses().forEach { response ->
            responses.put(JSONObject().apply {
                put("id", response.id)
                put("text", response.text)
                put("authentication", response.authentication)
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

    @JavascriptInterface
    fun submitAuthorityUpdate(kind: String, payload: String): String {
        if (!GatewayConfig.hasAuthenticationKey(appContext)) return "authentication-missing"
        Thread {
            val result = runCatching {
                PiHttpClient(appContext).administratorUpdate(kind, JSONObject(payload))
            }
            val success = result.isSuccess
            val message = result.fold(
                onSuccess = { "Authority ${kind.lowercase()} update saved and signed for distribution." },
                onFailure = { it.message ?: "Authority update failed." }
            )
            GatewayDatabase(appContext).recordEvent(
                "",
                if (success) "AUTHORITY_UPDATE" else "AUTHORITY_ERROR",
                message
            )
            webView.post {
                webView.evaluateJavascript(
                    "window.SMSWeb?.admin?.receiveResult(" +
                        "${JSONObject.quote(kind)},$success,${JSONObject.quote(message)})",
                    null
                )
            }
        }.start()
        return "queued"
    }

    @JavascriptInterface
    fun getGatewayActivity(): String {
        val events = JSONArray()
        GatewayDatabase(appContext).recentEvents().forEach { event ->
            events.put(JSONObject().apply {
                put("id", event.id)
                put("requestId", event.requestId)
                put("state", event.state)
                put("detail", event.detail)
                put("createdAt", event.createdAt)
            })
        }
        return events.toString()
    }

    @JavascriptInterface
    fun retryQueuedMessages(): String {
        Thread { GatewayCoordinator(appContext).flush() }.start()
        GatewayDatabase(appContext).recordEvent("", "MANUAL_RETRY", "Operator requested an immediate retry.")
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
            GatewayDatabase(appContext).recordEvent(
                SmsProtocol.messageId(text),
                "HANDOFF",
                "Request SMS handed to Android for delivery."
            )
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

package com.smsweb.gateway

import android.content.Context
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

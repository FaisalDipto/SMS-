package com.smsweb.gateway

import android.webkit.JavascriptInterface

class GatewayWebBridge {
    @JavascriptInterface
    fun getGatewayStatus(): String = "ready"
}

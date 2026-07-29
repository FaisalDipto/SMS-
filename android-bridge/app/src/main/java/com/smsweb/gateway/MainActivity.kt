package com.smsweb.gateway

import android.Manifest
import android.app.Activity
import android.os.Bundle
import android.webkit.WebView
import android.webkit.WebViewClient

class MainActivity : Activity() {
    private lateinit var webView: WebView

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)

        webView = WebView(this)
        setContentView(webView)

        with(webView) {
            settings.javaScriptEnabled = true
            settings.domStorageEnabled = true
            settings.allowFileAccess = true
            settings.allowContentAccess = true
            webViewClient = WebViewClient()
            addJavascriptInterface(GatewayWebBridge(), "smsWeb")
            WebView.setWebContentsDebuggingEnabled(BuildConfig.DEBUG)
            loadUrl("file:///android_asset/index.html")
        }

        if (android.os.Build.VERSION.SDK_INT >= android.os.Build.VERSION_CODES.M) {
            requestPermissions(
                arrayOf(Manifest.permission.RECEIVE_SMS, Manifest.permission.READ_SMS, Manifest.permission.SEND_SMS),
                100
            )
        }
    }

    override fun onDestroy() {
        webView.destroy()
        super.onDestroy()
    }
}

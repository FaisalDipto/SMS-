package com.smsweb.gateway

import android.Manifest
import android.app.Activity
import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.content.IntentFilter
import android.os.Build
import android.os.Bundle
import android.webkit.WebView
import android.webkit.WebViewClient
import org.json.JSONObject

class MainActivity : Activity() {
    private lateinit var webView: WebView

    private val responseReceiver = object : BroadcastReceiver() {
        override fun onReceive(context: Context, intent: Intent) {
            val rawText = intent.getStringExtra(GatewayEvents.EXTRA_TEXT) ?: return
            webView.post {
                webView.evaluateJavascript(
                    "window.SMSWeb?.gateway?.receiveSms(${JSONObject.quote(rawText)})",
                    null
                )
            }
        }
    }

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
            addJavascriptInterface(GatewayWebBridge(this@MainActivity, this), "smsWeb")
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

    override fun onStart() {
        super.onStart()
        val filter = IntentFilter(GatewayEvents.ACTION_PI_RESPONSE)
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
            registerReceiver(responseReceiver, filter, Context.RECEIVER_NOT_EXPORTED)
        } else {
            registerReceiver(responseReceiver, filter)
        }
    }

    override fun onStop() {
        unregisterReceiver(responseReceiver)
        super.onStop()
    }
}

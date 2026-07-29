package com.smsweb.gateway

import android.Manifest
import android.app.Activity
import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.content.IntentFilter
import android.os.Build
import android.os.Bundle
import android.webkit.GeolocationPermissions
import android.webkit.WebChromeClient
import android.webkit.WebView
import android.webkit.WebViewClient
import org.json.JSONObject

class MainActivity : Activity() {
    private companion object {
        const val LOCATION_PERMISSION_REQUEST = 200
    }

    private lateinit var webView: WebView
    private var pendingGeolocationOrigin: String? = null
    private var pendingGeolocationCallback: GeolocationPermissions.Callback? = null

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
            settings.setGeolocationEnabled(true)
            webViewClient = WebViewClient()
            webChromeClient = object : WebChromeClient() {
                override fun onGeolocationPermissionsShowPrompt(
                    origin: String,
                    callback: GeolocationPermissions.Callback
                ) {
                    if (hasLocationPermission()) {
                        callback.invoke(origin, true, false)
                        return
                    }

                    pendingGeolocationOrigin = origin
                    pendingGeolocationCallback = callback
                    requestPermissions(
                        arrayOf(
                            Manifest.permission.ACCESS_FINE_LOCATION,
                            Manifest.permission.ACCESS_COARSE_LOCATION
                        ),
                        LOCATION_PERMISSION_REQUEST
                    )
                }
            }
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

    private fun hasLocationPermission(): Boolean {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.M) return true
        return checkSelfPermission(Manifest.permission.ACCESS_FINE_LOCATION) ==
            android.content.pm.PackageManager.PERMISSION_GRANTED ||
            checkSelfPermission(Manifest.permission.ACCESS_COARSE_LOCATION) ==
            android.content.pm.PackageManager.PERMISSION_GRANTED
    }

    override fun onRequestPermissionsResult(
        requestCode: Int,
        permissions: Array<out String>,
        grantResults: IntArray
    ) {
        super.onRequestPermissionsResult(requestCode, permissions, grantResults)
        if (requestCode != LOCATION_PERMISSION_REQUEST) return

        val granted = grantResults.any {
            it == android.content.pm.PackageManager.PERMISSION_GRANTED
        }
        pendingGeolocationCallback?.invoke(pendingGeolocationOrigin, granted, false)
        pendingGeolocationOrigin = null
        pendingGeolocationCallback = null
    }

    override fun onDestroy() {
        pendingGeolocationCallback?.invoke(pendingGeolocationOrigin, false, false)
        pendingGeolocationOrigin = null
        pendingGeolocationCallback = null
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

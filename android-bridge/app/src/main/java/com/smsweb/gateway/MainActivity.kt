package com.smsweb.gateway

import android.Manifest
import android.app.Activity
import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.content.IntentFilter
import android.location.Location
import android.location.LocationListener
import android.location.LocationManager
import android.os.Build
import android.os.Bundle
import android.os.Handler
import android.os.Looper
import android.os.SystemClock
import android.webkit.GeolocationPermissions
import android.webkit.WebChromeClient
import android.webkit.WebView
import androidx.webkit.WebViewAssetLoader
import androidx.webkit.WebViewClientCompat
import org.json.JSONObject

class MainActivity : Activity() {
    private companion object {
        const val LOCATION_PERMISSION_REQUEST = 200
    }

    private lateinit var webView: WebView
    private var pendingGeolocationOrigin: String? = null
    private var pendingGeolocationCallback: GeolocationPermissions.Callback? = null
    private var pendingNativeLocation = false
    private var activeLocationListener: LocationListener? = null
    private val locationHandler = Handler(Looper.getMainLooper())

    private val responseReceiver = object : BroadcastReceiver() {
        override fun onReceive(context: Context, intent: Intent) {
            if (intent.action == GatewayEvents.ACTION_SECURITY_REJECTION) {
                val error = intent.getStringExtra(GatewayEvents.EXTRA_ERROR)
                    ?: "An unauthenticated response was blocked."
                webView.post {
                    webView.evaluateJavascript(
                        "window.SMSWeb?.gateway?.receiveSecurityError(${JSONObject.quote(error)})",
                        null
                    )
                }
                return
            }
            val rawText = intent.getStringExtra(GatewayEvents.EXTRA_TEXT) ?: return
            val authentication = intent.getStringExtra(GatewayEvents.EXTRA_AUTHENTICATION)
                ?: AuthenticationStatus.UNSIGNED.name
            webView.post {
                webView.evaluateJavascript(
                    "window.SMSWeb?.gateway?.receiveSms(" +
                        "${JSONObject.quote(rawText)},${JSONObject.quote(authentication)})",
                    null
                )
            }
        }
    }

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)

        webView = WebView(this)
        setContentView(webView)
        val assetLoader = WebViewAssetLoader.Builder()
            .addPathHandler(
                "/assets/",
                WebViewAssetLoader.AssetsPathHandler(this)
            )
            .build()

        with(webView) {
            settings.javaScriptEnabled = true
            settings.domStorageEnabled = true
            settings.allowFileAccess = false
            settings.allowContentAccess = false
            settings.setGeolocationEnabled(true)
            webViewClient = object : WebViewClientCompat() {
                override fun shouldInterceptRequest(
                    view: WebView,
                    request: android.webkit.WebResourceRequest
                ): android.webkit.WebResourceResponse? {
                    return assetLoader.shouldInterceptRequest(request.url)
                }
            }
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
            loadUrl("https://appassets.androidplatform.net/assets/index.html")
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

    fun requestCurrentLocationForWeb() {
        webView.post {
            if (!hasLocationPermission()) {
                pendingNativeLocation = true
                requestPermissions(
                    arrayOf(
                        Manifest.permission.ACCESS_FINE_LOCATION,
                        Manifest.permission.ACCESS_COARSE_LOCATION
                    ),
                    LOCATION_PERMISSION_REQUEST
                )
                return@post
            }

            locateForWeb()
        }
    }

    @Suppress("DEPRECATION", "MissingPermission")
    private fun locateForWeb() {
        val locationManager = getSystemService(LocationManager::class.java)
        val providers = listOf(
            LocationManager.NETWORK_PROVIDER,
            LocationManager.GPS_PROVIDER
        ).filter { provider ->
            runCatching { locationManager.isProviderEnabled(provider) }.getOrDefault(false)
        }

        if (providers.isEmpty()) {
            sendLocationError("Turn on Location services and try again.")
            return
        }

        val recentLocation = providers
            .mapNotNull { provider ->
                runCatching { locationManager.getLastKnownLocation(provider) }.getOrNull()
            }
            .filter { location -> System.currentTimeMillis() - location.time <= 120_000 }
            .maxByOrNull { location -> location.time }

        if (recentLocation != null) {
            sendLocationToWeb(recentLocation)
            return
        }

        activeLocationListener?.let(locationManager::removeUpdates)
        val listener = object : LocationListener {
            override fun onLocationChanged(location: Location) {
                locationHandler.removeCallbacksAndMessages(this)
                locationManager.removeUpdates(this)
                activeLocationListener = null
                sendLocationToWeb(location)
            }

            override fun onProviderDisabled(provider: String) = Unit
            override fun onProviderEnabled(provider: String) = Unit
            override fun onStatusChanged(provider: String?, status: Int, extras: Bundle?) = Unit
        }
        activeLocationListener = listener

        try {
            locationManager.requestSingleUpdate(providers.first(), listener, Looper.getMainLooper())
            locationHandler.postAtTime({
                if (activeLocationListener === listener) {
                    locationManager.removeUpdates(listener)
                    activeLocationListener = null
                    sendLocationError("Current location timed out. Move near a window or enable precise location.")
                }
            }, listener, SystemClock.uptimeMillis() + 20_000)
        } catch (_: SecurityException) {
            activeLocationListener = null
            sendLocationError("Location permission was denied.")
        }
    }

    private fun sendLocationToWeb(location: Location) {
        webView.post {
            webView.evaluateJavascript(
                "window.SMSWeb?.navigation?.receiveNativeLocation(" +
                    "${location.latitude},${location.longitude},${location.accuracy})",
                null
            )
        }
    }

    private fun sendLocationError(message: String) {
        webView.post {
            webView.evaluateJavascript(
                "window.SMSWeb?.navigation?.receiveNativeLocationError(${JSONObject.quote(message)})",
                null
            )
        }
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
        if (pendingNativeLocation) {
            pendingNativeLocation = false
            if (granted) {
                locateForWeb()
            } else {
                sendLocationError("Location permission was denied.")
            }
        }
    }

    override fun onDestroy() {
        pendingGeolocationCallback?.invoke(pendingGeolocationOrigin, false, false)
        pendingGeolocationOrigin = null
        pendingGeolocationCallback = null
        activeLocationListener?.let {
            getSystemService(LocationManager::class.java).removeUpdates(it)
        }
        activeLocationListener = null
        locationHandler.removeCallbacksAndMessages(null)
        webView.destroy()
        super.onDestroy()
    }

    override fun onStart() {
        super.onStart()
        val filter = IntentFilter().apply {
            addAction(GatewayEvents.ACTION_PI_RESPONSE)
            addAction(GatewayEvents.ACTION_SECURITY_REJECTION)
        }
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

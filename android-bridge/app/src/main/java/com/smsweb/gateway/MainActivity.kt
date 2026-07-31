package com.smsweb.gateway

import android.Manifest
import android.app.Activity
import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.content.IntentFilter
import android.location.GnssStatus
import android.location.Location
import android.location.LocationListener
import android.location.LocationManager
import android.os.Build
import android.os.Bundle
import android.os.Handler
import android.os.Looper
import android.webkit.GeolocationPermissions
import android.webkit.WebChromeClient
import android.webkit.WebView
import androidx.webkit.WebViewAssetLoader
import androidx.webkit.WebViewClientCompat
import com.google.android.gms.location.CurrentLocationRequest
import com.google.android.gms.location.FusedLocationProviderClient
import com.google.android.gms.location.LocationServices
import com.google.android.gms.location.Priority
import com.google.android.gms.tasks.CancellationTokenSource
import org.json.JSONObject

class MainActivity : Activity() {
    private companion object {
        const val LOCATION_PERMISSION_REQUEST = 200
        const val LOCATION_TIMEOUT_MS = 300_000L
        const val FUSED_LOCATION_TIMEOUT_MS = 60_000L
        const val RECENT_LOCATION_MAX_AGE_MS = 10 * 60_000L
        const val ACCEPTED_LOCATION_ACCURACY_METERS = 100f
        const val FALLBACK_LOCATION_ACCURACY_METERS = 200f
        const val GNSS_PROGRESS_INTERVAL_MS = 3_000L
    }

    private lateinit var webView: WebView
    private lateinit var fusedLocationClient: FusedLocationProviderClient
    private var pendingGeolocationOrigin: String? = null
    private var pendingGeolocationCallback: GeolocationPermissions.Callback? = null
    private var pendingNativeLocation = false
    private var activeLocationListener: LocationListener? = null
    private var activeGnssCallback: GnssStatus.Callback? = null
    private var activeFusedCancellation: CancellationTokenSource? = null
    private var lastGnssProgressAt = 0L
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

        fusedLocationClient = LocationServices.getFusedLocationProviderClient(this)
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
            val permissions = mutableListOf(
                Manifest.permission.RECEIVE_SMS,
                Manifest.permission.READ_SMS,
                Manifest.permission.SEND_SMS
            )
            when (GatewayConfig.appRole(this)) {
                GatewayConfig.ROLE_GATEWAY -> {
                    permissions.add(Manifest.permission.READ_PHONE_STATE)
                    permissions.add(Manifest.permission.READ_CALL_LOG)
                }
                GatewayConfig.ROLE_USER -> {
                    permissions.add(Manifest.permission.READ_PHONE_STATE)
                    permissions.add(Manifest.permission.CALL_PHONE)
                }
            }
            requestPermissions(permissions.toTypedArray(), 100)
        }
    }

    private fun hasLocationPermission(): Boolean {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.M) return true
        return checkSelfPermission(Manifest.permission.ACCESS_FINE_LOCATION) ==
            android.content.pm.PackageManager.PERMISSION_GRANTED ||
            checkSelfPermission(Manifest.permission.ACCESS_COARSE_LOCATION) ==
            android.content.pm.PackageManager.PERMISSION_GRANTED
    }

    private fun hasFineLocationPermission(): Boolean {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.M) return true
        return checkSelfPermission(Manifest.permission.ACCESS_FINE_LOCATION) ==
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
        val requestedProviders = buildList {
            if (hasFineLocationPermission()) add(LocationManager.GPS_PROVIDER)
            add(LocationManager.NETWORK_PROVIDER)
        }
        val providers = requestedProviders.distinct().filter { provider ->
            runCatching { locationManager.isProviderEnabled(provider) }.getOrDefault(false)
        }

        if (providers.isEmpty()) {
            sendLocationError(
                "Turn on Location services. For offline use, enable GPS and allow precise location."
            )
            return
        }

        val recentLocation = providers
            .mapNotNull { provider ->
                runCatching { locationManager.getLastKnownLocation(provider) }.getOrNull()
            }
            .filter { location ->
                System.currentTimeMillis() - location.time <= RECENT_LOCATION_MAX_AGE_MS &&
                    location.hasAccuracy() &&
                    location.accuracy <= ACCEPTED_LOCATION_ACCURACY_METERS
            }
            .minByOrNull { location -> location.accuracy }

        if (recentLocation != null) {
            sendLocationProgress(
                "Recent Android location found " +
                    "(${recentLocation.accuracy.toInt()} m accuracy). Using this position.",
                recentLocation
            )
            sendLocationToWeb(recentLocation)
            return
        }

        stopActiveLocationSearch(locationManager)
        sendLocationProgress(
            if (providers.contains(LocationManager.GPS_PROVIDER)) {
                "Requesting a high-accuracy Android location, with offline GPS as fallback."
            } else {
                "Precise GPS access is unavailable. Enable precise location for reliable offline positioning."
            }
        )
        var bestLocation: Location? = null
        val listener = object : LocationListener {
            override fun onLocationChanged(location: Location) {
                if (!location.hasAccuracy()) return
                if (bestLocation == null || location.accuracy < bestLocation!!.accuracy) {
                    bestLocation = location
                }

                val accepted = location.accuracy <= ACCEPTED_LOCATION_ACCURACY_METERS
                sendLocationProgress(
                    "Location signal found (${location.accuracy.toInt()} m accuracy). " +
                        if (accepted) {
                            "Using this position."
                        } else {
                            "Waiting briefly for a more accurate GPS fix."
                        },
                    if (accepted) location else null
                )

                if (accepted) {
                    sendLocationToWeb(location)
                    stopActiveLocationSearch(locationManager, this)
                }
            }

            override fun onProviderDisabled(provider: String) = Unit
            override fun onProviderEnabled(provider: String) = Unit
            override fun onStatusChanged(provider: String?, status: Int, extras: Bundle?) = Unit
        }
        activeLocationListener = listener

        try {
            val fusedCancellation = CancellationTokenSource()
            activeFusedCancellation = fusedCancellation
            val fusedRequest = CurrentLocationRequest.Builder()
                .setPriority(Priority.PRIORITY_HIGH_ACCURACY)
                .setMaxUpdateAgeMillis(RECENT_LOCATION_MAX_AGE_MS)
                .setDurationMillis(FUSED_LOCATION_TIMEOUT_MS)
                .build()
            fusedLocationClient.getCurrentLocation(fusedRequest, fusedCancellation.token)
                .addOnSuccessListener { location ->
                    if (activeFusedCancellation !== fusedCancellation) {
                        return@addOnSuccessListener
                    }
                    if (location == null || !location.hasAccuracy()) {
                        sendLocationProgress(
                            "Android location has no fix yet; offline GPS search continues."
                        )
                        return@addOnSuccessListener
                    }
                    if (bestLocation == null || location.accuracy < bestLocation!!.accuracy) {
                        bestLocation = location
                    }
                    val accepted = location.accuracy <= ACCEPTED_LOCATION_ACCURACY_METERS
                    sendLocationProgress(
                        "Android location found (${location.accuracy.toInt()} m accuracy). " +
                            if (accepted) {
                                "Using this position."
                            } else {
                                "Waiting for a more accurate GPS fix."
                            },
                        if (accepted) location else null
                    )
                    if (accepted) {
                        sendLocationToWeb(location)
                        stopActiveLocationSearch(locationManager)
                    }
                }
                .addOnFailureListener { error ->
                    if (activeFusedCancellation === fusedCancellation) {
                        sendLocationProgress(
                            "Android fused location was unavailable (${error.message ?: "unknown error"}); " +
                                "offline GPS search continues."
                        )
                    }
                }

            if (
                providers.contains(LocationManager.GPS_PROVIDER) &&
                hasFineLocationPermission()
            ) {
                val gnssCallback = object : GnssStatus.Callback() {
                    override fun onStarted() {
                        sendLocationProgress(
                            "GPS receiver started. Waiting for satellite signals…"
                        )
                    }

                    override fun onFirstFix(ttffMillis: Int) {
                        sendLocationProgress(
                            "GPS acquired its first satellite fix in " +
                                "${(ttffMillis / 1_000f).toInt().coerceAtLeast(1)} seconds. " +
                                "Checking accuracy…"
                        )
                    }

                    override fun onSatelliteStatusChanged(status: GnssStatus) {
                        val now = System.currentTimeMillis()
                        if (now - lastGnssProgressAt < GNSS_PROGRESS_INTERVAL_MS) return
                        lastGnssProgressAt = now
                        val usedInFix = (0 until status.satelliteCount).count(status::usedInFix)
                        val guidance = when {
                            status.satelliteCount == 0 ->
                                "No satellites visible yet; move outdoors away from buildings."
                            usedInFix < 4 ->
                                "Keep the phone still with a clear view of the sky."
                            else ->
                                "Calculating an accurate position."
                        }
                        sendLocationProgress(
                            "GPS sees ${status.satelliteCount} satellites; " +
                                "$usedInFix currently used. $guidance"
                        )
                    }

                    override fun onStopped() {
                        if (activeGnssCallback === this) {
                            sendLocationProgress("The phone stopped its GPS receiver.")
                        }
                    }
                }
                if (locationManager.registerGnssStatusCallback(gnssCallback, locationHandler)) {
                    activeGnssCallback = gnssCallback
                }
            }

            providers.forEach { provider ->
                locationManager.requestLocationUpdates(
                    provider,
                    1_000L,
                    0f,
                    listener,
                    Looper.getMainLooper()
                )
            }
            locationHandler.postDelayed({
                if (activeLocationListener === listener) {
                    val fallback = bestLocation
                    if (fallback != null && fallback.accuracy <= FALLBACK_LOCATION_ACCURACY_METERS) {
                        sendLocationProgress(
                            "Best offline GPS location found " +
                                "(${fallback.accuracy.toInt()} m accuracy). Using this position.",
                            fallback
                        )
                        sendLocationToWeb(fallback)
                        stopActiveLocationSearch(locationManager, listener)
                    } else {
                        stopActiveLocationSearch(locationManager, listener)
                        sendLocationError(
                            "GPS could not get an accurate offline fix after five minutes. " +
                                "Go outdoors with a clear view of the sky, keep Location and " +
                                "precise access enabled, then try again."
                        )
                    }
                }
            }, LOCATION_TIMEOUT_MS)
        } catch (_: SecurityException) {
            stopActiveLocationSearch(locationManager, listener)
            sendLocationError("Location permission was denied.")
        } catch (_: IllegalArgumentException) {
            stopActiveLocationSearch(locationManager, listener)
            sendLocationError("The phone's GPS provider is unavailable.")
        }
    }

    @Suppress("DEPRECATION", "MissingPermission")
    private fun stopActiveLocationSearch(
        locationManager: LocationManager = getSystemService(LocationManager::class.java),
        listener: LocationListener? = activeLocationListener
    ) {
        activeFusedCancellation?.cancel()
        activeFusedCancellation = null
        listener?.let { runCatching { locationManager.removeUpdates(it) } }
        activeLocationListener = null
        activeGnssCallback?.let { callback ->
            runCatching { locationManager.unregisterGnssStatusCallback(callback) }
        }
        activeGnssCallback = null
        lastGnssProgressAt = 0L
        locationHandler.removeCallbacksAndMessages(null)
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

    private fun sendLocationProgress(message: String, acceptedLocation: Location? = null) {
        val locationArguments = acceptedLocation?.let { location ->
            ",${location.latitude},${location.longitude},${location.accuracy}"
        } ?: ",null,null,null"
        webView.post {
            webView.evaluateJavascript(
                "window.SMSWeb?.navigation?.receiveNativeLocationProgress(" +
                    "${JSONObject.quote(message)}$locationArguments)",
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
        stopActiveLocationSearch()
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

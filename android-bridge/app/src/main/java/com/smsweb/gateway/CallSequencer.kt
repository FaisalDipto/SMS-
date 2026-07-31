package com.smsweb.gateway

import android.Manifest
import android.content.Context
import android.content.Intent
import android.content.pm.PackageManager
import android.net.Uri
import android.os.Handler
import android.os.Looper
import android.telephony.PhoneStateListener
import android.telephony.TelephonyManager

/**
 * Places a burst of outgoing calls to the gateway number so a User phone can
 * signal a request even with no SMS credit, mirroring the missed-call channel
 * the gateway already understands (see [MissedCallCoordinator]).
 *
 * Android will not let a normal app silently hang up a call it placed
 * (that capability is restricted to the default dialer/InCallService, to
 * prevent premium-rate dialer abuse). Each call is placed automatically, but
 * the person must let it ring out or end it themselves before the next call
 * in the sequence is dialed; this class only automates the counting and the
 * re-dialing, not the hang-up.
 */
class CallSequencer(private val context: Context) {
    private val telephonyManager = context.getSystemService(TelephonyManager::class.java)
    private val handler = Handler(Looper.getMainLooper())

    private var listener: PhoneStateListener? = null
    private var targetNumber = ""
    private var totalCalls = 0
    private var placedCalls = 0
    private var awaitingIdleAfterOffhook = false
    private var onProgress: ((placed: Int, total: Int) -> Unit)? = null
    private var onComplete: (() -> Unit)? = null

    fun hasCallPermission(): Boolean =
        context.checkSelfPermission(Manifest.permission.CALL_PHONE) == PackageManager.PERMISSION_GRANTED

    fun start(
        number: String,
        count: Int,
        onProgress: (placed: Int, total: Int) -> Unit,
        onComplete: () -> Unit
    ): Boolean {
        if (!hasCallPermission() || count <= 0 || number.isBlank()) return false

        stop()
        targetNumber = number
        totalCalls = count
        placedCalls = 0
        this.onProgress = onProgress
        this.onComplete = onComplete
        registerListener()
        placeNextCall()
        return true
    }

    fun stop() {
        listener?.let { current ->
            @Suppress("DEPRECATION")
            telephonyManager?.listen(current, PhoneStateListener.LISTEN_NONE)
        }
        handler.removeCallbacksAndMessages(null)
        listener = null
        awaitingIdleAfterOffhook = false
        onProgress = null
        onComplete = null
    }

    @Suppress("DEPRECATION")
    private fun registerListener() {
        val stateListener = object : PhoneStateListener() {
            override fun onCallStateChanged(state: Int, phoneNumber: String?) {
                handleStateChange(state)
            }
        }
        listener = stateListener
        telephonyManager?.listen(stateListener, PhoneStateListener.LISTEN_CALL_STATE)
    }

    private fun handleStateChange(state: Int) {
        when (state) {
            TelephonyManager.CALL_STATE_OFFHOOK -> awaitingIdleAfterOffhook = true
            TelephonyManager.CALL_STATE_IDLE -> {
                if (!awaitingIdleAfterOffhook) return
                awaitingIdleAfterOffhook = false
                if (placedCalls >= totalCalls) {
                    finish()
                } else {
                    handler.postDelayed({ placeNextCall() }, CALL_GAP_MS)
                }
            }
        }
    }

    private fun placeNextCall() {
        if (!hasCallPermission()) {
            stop()
            return
        }
        if (placedCalls >= totalCalls) {
            finish()
            return
        }

        val intent = Intent(Intent.ACTION_CALL, Uri.parse("tel:$targetNumber")).apply {
            addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
        }
        context.startActivity(intent)
        placedCalls += 1
        onProgress?.invoke(placedCalls, totalCalls)
    }

    private fun finish() {
        val completion = onComplete
        stop()
        completion?.invoke()
    }

    private companion object {
        // Gap between one call ending and the next being dialed. Must stay
        // well inside MissedCallScheduler.DEBOUNCE_WINDOW_MS on the gateway
        // side so the whole burst still counts as one sequence there.
        const val CALL_GAP_MS = 1_500L
    }
}

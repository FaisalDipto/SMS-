package com.smsweb.gateway

import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.telephony.TelephonyManager

/**
 * Detects missed calls (RINGING -> IDLE with no OFFHOOK in between) on the
 * gateway phone and hands them to [MissedCallCoordinator] as an alternate,
 * zero-cost request channel alongside SMS. Only active on the gateway edition;
 * the user edition never registers a service number for callers to reach.
 */
class MissedCallReceiver : BroadcastReceiver() {
    private object State {
        var lastState: String? = null
        var ringingNumber: String? = null
    }

    override fun onReceive(context: Context, intent: Intent) {
        if (intent.action != TelephonyManager.ACTION_PHONE_STATE_CHANGED) return
        val appContext = context.applicationContext
        if (GatewayConfig.appRole(appContext) != GatewayConfig.ROLE_GATEWAY) return

        val state = intent.getStringExtra(TelephonyManager.EXTRA_STATE)
        val incomingNumber = intent.getStringExtra(TelephonyManager.EXTRA_INCOMING_NUMBER)

        when (state) {
            TelephonyManager.EXTRA_STATE_RINGING -> {
                State.lastState = state
                State.ringingNumber = incomingNumber
            }
            TelephonyManager.EXTRA_STATE_OFFHOOK -> {
                // A human answered; this was not an unattended missed call.
                State.lastState = state
            }
            TelephonyManager.EXTRA_STATE_IDLE -> {
                val number = State.ringingNumber
                if (State.lastState == TelephonyManager.EXTRA_STATE_RINGING && !number.isNullOrBlank()) {
                    val pendingResult = goAsync()
                    Thread {
                        try {
                            MissedCallCoordinator(appContext).recordMissedCall(number)
                        } finally {
                            pendingResult.finish()
                        }
                    }.start()
                }
                State.lastState = state
                State.ringingNumber = null
            }
        }
    }
}

package com.smsweb.gateway

import android.content.Context
import android.telephony.SubscriptionManager

/**
 * Turns a burst of missed calls into a synthetic SMS request, reusing the
 * exact same downstream pipeline (Pi forwarding, signature verification,
 * SMS-back) that [GatewayCoordinator.acceptIncomingSms] already provides.
 *
 * A missed call carries no text, so the caller can only choose a COMMAND by
 * how many times they call within [MissedCallScheduler.DEBOUNCE_WINDOW_MS] of
 * each other; the region always comes from gateway config since there is no
 * room to encode it in a call.
 */
class MissedCallCoordinator(private val context: Context) {
    private val preferences = context.getSharedPreferences("smsweb_missed_calls", Context.MODE_PRIVATE)

    companion object {
        // 1 call = shelters, 2 = alerts, 3 = hazards. Counts beyond the
        // highest key clamp to it rather than being dropped.
        val COMMAND_BY_COUNT = mapOf(
            1 to "SHELTER",
            2 to "ALERT",
            3 to "HAZARD"
        )
    }

    fun recordMissedCall(sender: String) {
        val number = normalize(sender)
        if (number.isEmpty()) return

        val now = System.currentTimeMillis()
        val lastCallAt = preferences.getLong(lastCallKey(number), 0L)
        val previousCount = preferences.getInt(countKey(number), 0)
        val withinWindow = lastCallAt > 0 && now - lastCallAt <= MissedCallScheduler.DEBOUNCE_WINDOW_MS
        val count = if (withinWindow) previousCount + 1 else 1

        preferences.edit()
            .putInt(countKey(number), count)
            .putLong(lastCallKey(number), now)
            .apply()

        MissedCallScheduler.schedule(context, number)
    }

    fun finalizeSequence(sender: String) {
        val number = normalize(sender)
        if (number.isEmpty()) return

        val count = preferences.getInt(countKey(number), 0)
        if (count <= 0) return

        preferences.edit()
            .remove(countKey(number))
            .remove(lastCallKey(number))
            .apply()

        val command = COMMAND_BY_COUNT[count] ?: COMMAND_BY_COUNT[COMMAND_BY_COUNT.keys.max()]
        if (command == null) return

        val requestId = "MC" + now36()
        val region = GatewayConfig.missedCallRegion(context)
        val syntheticRequest = "REQ|1|$requestId|$command|$region"

        GatewayCoordinator(context).acceptIncomingSms(
            number,
            syntheticRequest,
            SubscriptionManager.INVALID_SUBSCRIPTION_ID
        )
    }

    private fun countKey(number: String) = "count_$number"
    private fun lastCallKey(number: String) = "last_$number"

    private fun now36(): String = System.currentTimeMillis()
        .toString(36)
        .uppercase()
        .takeLast(8)

    private fun normalize(value: String): String = value.filter { it.isDigit() || it == '+' }
}

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
 *
 * Calls in the same physical sequence are grouped by a canonical last-10-digit
 * key rather than the raw reported caller ID string, because carriers do not
 * consistently report the same caller's number the same way between calls
 * (with/without a country code or leading zero). Without this, two calls from
 * the same person could be tracked as two unrelated single-call sequences,
 * each independently finalizing as its own SHELTER request instead of merging
 * into one ALERT/HAZARD request -- exactly the "N calls produce N shelter
 * messages" bug this was fixed for. The raw, deliverable sender string is
 * still remembered separately so the eventual SMS reply goes to a real
 * address rather than a truncated 10-digit key.
 */
class MissedCallCoordinator(private val context: Context) {
    private val preferences = context.getSharedPreferences("smsweb_missed_calls", Context.MODE_PRIVATE)
    private val database = GatewayDatabase(context)

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
        val key = canonicalKey(sender)
        if (key.isEmpty()) return

        val now = System.currentTimeMillis()
        val lastCallAt = preferences.getLong(lastCallKey(key), 0L)
        val previousCount = preferences.getInt(countKey(key), 0)
        val withinWindow = lastCallAt > 0 && now - lastCallAt <= MissedCallScheduler.DEBOUNCE_WINDOW_MS
        val count = if (withinWindow) previousCount + 1 else 1

        preferences.edit()
            .putInt(countKey(key), count)
            .putLong(lastCallKey(key), now)
            .putString(recipientKey(key), sender)
            .apply()

        database.recordEvent(
            "",
            "MISSED_CALL",
            "Missed call recorded from $sender (call $count of this sequence so far)."
        )

        MissedCallScheduler.schedule(context, key)
    }

    fun finalizeSequence(key: String) {
        if (key.isEmpty()) return

        val count = preferences.getInt(countKey(key), 0)
        if (count <= 0) return

        val recipient = preferences.getString(recipientKey(key), null) ?: key

        preferences.edit()
            .remove(countKey(key))
            .remove(lastCallKey(key))
            .remove(recipientKey(key))
            .apply()

        val command = COMMAND_BY_COUNT[count] ?: COMMAND_BY_COUNT[COMMAND_BY_COUNT.keys.max()]
        if (command == null) return

        val requestId = "MC" + now36()
        val region = GatewayConfig.missedCallRegion(context)
        val syntheticRequest = "REQ|1|$requestId|$command|$region"

        database.recordEvent(
            requestId,
            "MISSED_CALL_SEQUENCE",
            "Missed-call sequence finalized: $count call(s) from $recipient -> $command."
        )

        GatewayCoordinator(context).acceptIncomingSms(
            recipient,
            syntheticRequest,
            SubscriptionManager.INVALID_SUBSCRIPTION_ID
        )
    }

    private fun countKey(key: String) = "count_$key"
    private fun lastCallKey(key: String) = "last_$key"
    private fun recipientKey(key: String) = "recipient_$key"

    private fun now36(): String = System.currentTimeMillis()
        .toString(36)
        .uppercase()
        .takeLast(8)

    private fun canonicalKey(value: String): String {
        val digits = value.filter(Char::isDigit)
        return if (digits.length >= 10) digits.takeLast(10) else digits
    }
}

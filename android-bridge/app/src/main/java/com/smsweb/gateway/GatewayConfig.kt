package com.smsweb.gateway

import android.content.Context

object GatewayConfig {
    private const val PREFERENCES = "smsweb_gateway"
    private const val PI_URL = "pi_url"
    private const val TRUSTED_SENDERS = "trusted_senders"
    const val DEFAULT_PI_URL = "http://192.168.43.1:8080"

    fun piUrl(context: Context): String = context
        .getSharedPreferences(PREFERENCES, Context.MODE_PRIVATE)
        .getString(PI_URL, DEFAULT_PI_URL)
        .orEmpty()
        .trimEnd('/')

    fun savePiUrl(context: Context, value: String) {
        context.getSharedPreferences(PREFERENCES, Context.MODE_PRIVATE)
            .edit()
            .putString(PI_URL, value.trim().trimEnd('/'))
            .apply()
    }

    fun isSenderAllowed(context: Context, sender: String): Boolean {
        val trusted = context.getSharedPreferences(PREFERENCES, Context.MODE_PRIVATE)
            .getStringSet(TRUSTED_SENDERS, emptySet())
            .orEmpty()
        return trusted.isEmpty() || trusted.contains(normalizePhone(sender))
    }

    private fun normalizePhone(value: String): String = value.filter { it.isDigit() || it == '+' }
}

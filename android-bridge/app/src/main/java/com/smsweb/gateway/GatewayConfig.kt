package com.smsweb.gateway

import android.content.Context

object GatewayConfig {
    private const val PREFERENCES = "smsweb_gateway"
    private const val PI_URL = "pi_url"
    private const val SERVICE_NUMBER = "service_number"
    private const val TRUSTED_SENDERS = "trusted_senders"
    private const val AUTHENTICATION_KEY = "authentication_key"
    private const val MISSED_CALL_REGION = "missed_call_region"
    const val DEFAULT_PI_URL = "http://192.168.43.1:8080"
    const val DEFAULT_MISSED_CALL_REGION = "DHK"
    const val ROLE_GATEWAY = "GATEWAY"
    const val ROLE_USER = "USER"

    fun appRole(@Suppress("UNUSED_PARAMETER") context: Context): String = BuildConfig.APP_ROLE

    fun saveAppRole(
        @Suppress("UNUSED_PARAMETER") context: Context,
        @Suppress("UNUSED_PARAMETER") value: String
    ): String = BuildConfig.APP_ROLE

    fun isRoleLocked(): Boolean = BuildConfig.ROLE_LOCKED

    fun isUserEdition(): Boolean = BuildConfig.APP_ROLE == ROLE_USER

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

    fun serviceNumber(context: Context): String = context
        .getSharedPreferences(PREFERENCES, Context.MODE_PRIVATE)
        .getString(SERVICE_NUMBER, BuildConfig.DEFAULT_SERVICE_NUMBER)
        .orEmpty()
        .trim()

    fun saveServiceNumber(context: Context, value: String) {
        if (isUserEdition()) return
        context.getSharedPreferences(PREFERENCES, Context.MODE_PRIVATE)
            .edit()
            .putString(SERVICE_NUMBER, value.trim())
            .apply()
    }

    fun hasAuthenticationKey(context: Context): Boolean =
        authenticationKey(context).toByteArray(Charsets.UTF_8).size >=
            MessageAuthenticator.MINIMUM_KEY_BYTES

    internal fun authenticationKey(context: Context): String = context
        .getSharedPreferences(PREFERENCES, Context.MODE_PRIVATE)
        .getString(AUTHENTICATION_KEY, BuildConfig.DEFAULT_AUTHENTICATION_KEY)
        .orEmpty()

    fun saveAuthenticationKey(context: Context, value: String): Boolean {
        if (isUserEdition()) return false
        val normalized = value.trim()
        if (normalized.toByteArray(Charsets.UTF_8).size < MessageAuthenticator.MINIMUM_KEY_BYTES) {
            return false
        }
        context.getSharedPreferences(PREFERENCES, Context.MODE_PRIVATE)
            .edit()
            .putString(AUTHENTICATION_KEY, normalized)
            .apply()
        return true
    }

    fun missedCallRegion(context: Context): String = context
        .getSharedPreferences(PREFERENCES, Context.MODE_PRIVATE)
        .getString(MISSED_CALL_REGION, DEFAULT_MISSED_CALL_REGION)
        .orEmpty()
        .trim()
        .ifEmpty { DEFAULT_MISSED_CALL_REGION }

    fun saveMissedCallRegion(context: Context, value: String) {
        if (isUserEdition()) return
        context.getSharedPreferences(PREFERENCES, Context.MODE_PRIVATE)
            .edit()
            .putString(MISSED_CALL_REGION, value.trim().uppercase())
            .apply()
    }

    fun isSenderAllowed(context: Context, sender: String): Boolean {
        val trusted = context.getSharedPreferences(PREFERENCES, Context.MODE_PRIVATE)
            .getStringSet(TRUSTED_SENDERS, emptySet())
            .orEmpty()
        return trusted.isEmpty() || trusted.contains(normalizePhone(sender))
    }

    fun isServiceSender(context: Context, sender: String): Boolean {
        val expected = normalizePhone(serviceNumber(context)).filter(Char::isDigit)
        val actual = normalizePhone(sender).filter(Char::isDigit)
        if (expected.isEmpty() || actual.isEmpty()) return false
        return expected == actual ||
            (expected.length >= 10 && actual.length >= 10 && expected.takeLast(10) == actual.takeLast(10))
    }

    private fun normalizePhone(value: String): String = value.filter { it.isDigit() || it == '+' }
}

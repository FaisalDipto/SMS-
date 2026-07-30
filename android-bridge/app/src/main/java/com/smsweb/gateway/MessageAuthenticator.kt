package com.smsweb.gateway

import java.security.MessageDigest
import java.util.Base64
import javax.crypto.Mac
import javax.crypto.spec.SecretKeySpec

enum class AuthenticationStatus {
    AUTHENTICATED,
    MISSING_KEY,
    UNSIGNED,
    INVALID,
    EXPIRED,
    FUTURE
}

data class AuthenticationResult(
    val status: AuthenticationStatus,
    val signature: String? = null,
    val replayExpiresAt: Long = 0,
    val reason: String
)

object MessageAuthenticator {
    const val MINIMUM_KEY_BYTES = 16
    private const val AUTHENTICATION_TAG_BYTES = 16
    private const val CLOCK_SKEW_SECONDS = 300L
    private const val DEFAULT_REPLAY_RETENTION_SECONDS = 24 * 60 * 60L
    private val signaturePattern = Regex("^[A-Za-z0-9_-]{22}$")

    fun verify(
        message: String,
        authenticationKey: String,
        nowSeconds: Long = System.currentTimeMillis() / 1_000
    ): AuthenticationResult {
        if (authenticationKey.toByteArray(Charsets.UTF_8).size < MINIMUM_KEY_BYTES) {
            return rejected(AuthenticationStatus.MISSING_KEY, "No valid authentication key is configured.")
        }

        val separator = message.lastIndexOf('|')
        if (separator <= 0 || separator == message.lastIndex) {
            return rejected(AuthenticationStatus.UNSIGNED, "The response is not signed.")
        }

        val canonicalMessage = message.substring(0, separator)
        val signature = message.substring(separator + 1)
        if (!signaturePattern.matches(signature)) {
            return rejected(AuthenticationStatus.UNSIGNED, "The response has no supported authentication tag.")
        }

        val provided = runCatching { Base64.getUrlDecoder().decode(signature) }.getOrNull()
            ?: return rejected(AuthenticationStatus.INVALID, "The response signature is malformed.")
        val expected = hmac(canonicalMessage, authenticationKey)
        if (provided.size != AUTHENTICATION_TAG_BYTES ||
            !MessageDigest.isEqual(provided, expected)
        ) {
            return rejected(AuthenticationStatus.INVALID, "The response signature does not match its contents.")
        }

        val fields = runCatching { splitFields(canonicalMessage) }.getOrElse {
            return rejected(AuthenticationStatus.INVALID, "The signed response format is invalid.")
        }
        val freshness = validateFreshness(fields, nowSeconds)
        if (freshness.status != AuthenticationStatus.AUTHENTICATED) return freshness

        return AuthenticationResult(
            status = AuthenticationStatus.AUTHENTICATED,
            signature = signature,
            replayExpiresAt = freshness.replayExpiresAt,
            reason = "Response authenticated."
        )
    }

    private fun validateFreshness(fields: List<String>, nowSeconds: Long): AuthenticationResult {
        return when (fields.firstOrNull()) {
            "RES" -> {
                if (fields.size == 7 && fields.getOrNull(3) != "SHELTER") {
                    AuthenticationResult(
                        AuthenticationStatus.AUTHENTICATED,
                        replayExpiresAt = nowSeconds + DEFAULT_REPLAY_RETENTION_SECONDS,
                        reason = "Response authenticated."
                    )
                } else if (fields.size != 11) {
                    rejected(
                        AuthenticationStatus.INVALID,
                        "Signed shelter responses must include source and expiry metadata."
                    )
                } else {
                    val verifiedAt = fields[8].toLongOrNull()
                        ?: return rejected(AuthenticationStatus.INVALID, "Verification time is invalid.")
                    val expiresAt = fields[9].toLongOrNull()
                        ?: return rejected(AuthenticationStatus.INVALID, "Expiry time is invalid.")
                    validateTimes(verifiedAt, expiresAt, nowSeconds)
                }
            }
            "ALT" -> {
                val expiresIndex = when (fields.size) {
                    7 -> 4 // Legacy ALT|VERSION|ALERT_ID|...
                    8 -> 5 // Correlated ALT|VERSION|REQUEST_ID|ALERT_ID|...
                    else -> null
                }
                if (expiresIndex == null) {
                    rejected(AuthenticationStatus.INVALID, "Signed alert format is invalid.")
                } else {
                    val expiresAt = fields[expiresIndex].toLongOrNull()
                        ?: return rejected(AuthenticationStatus.INVALID, "Alert expiry time is invalid.")
                    validateTimes(null, expiresAt, nowSeconds)
                }
            }
            "ERR" -> AuthenticationResult(
                AuthenticationStatus.AUTHENTICATED,
                replayExpiresAt = nowSeconds + DEFAULT_REPLAY_RETENTION_SECONDS,
                reason = "Error response authenticated."
            )
            else -> rejected(AuthenticationStatus.INVALID, "Unsupported signed response type.")
        }
    }

    private fun validateTimes(
        verifiedAt: Long?,
        expiresAt: Long,
        nowSeconds: Long
    ): AuthenticationResult {
        if (verifiedAt != null && verifiedAt > nowSeconds + CLOCK_SKEW_SECONDS) {
            return rejected(AuthenticationStatus.FUTURE, "The response verification time is in the future.")
        }
        if (expiresAt <= nowSeconds) {
            return rejected(AuthenticationStatus.EXPIRED, "The response has expired.")
        }
        if (verifiedAt != null && expiresAt <= verifiedAt) {
            return rejected(AuthenticationStatus.INVALID, "The response expiry precedes its verification time.")
        }
        return AuthenticationResult(
            AuthenticationStatus.AUTHENTICATED,
            replayExpiresAt = expiresAt,
            reason = "Response freshness validated."
        )
    }

    private fun hmac(message: String, authenticationKey: String): ByteArray {
        val mac = Mac.getInstance("HmacSHA256")
        mac.init(SecretKeySpec(authenticationKey.toByteArray(Charsets.UTF_8), "HmacSHA256"))
        return mac.doFinal(message.toByteArray(Charsets.UTF_8)).copyOf(AUTHENTICATION_TAG_BYTES)
    }

    private fun splitFields(text: String): List<String> {
        val fields = mutableListOf<String>()
        val field = StringBuilder()
        var escaped = false
        text.forEach { character ->
            when {
                escaped && (character == '|' || character == '\\') -> {
                    field.append(character)
                    escaped = false
                }
                escaped -> throw IllegalArgumentException("Unsupported escape sequence")
                character == '\\' -> escaped = true
                character == '|' -> {
                    fields += field.toString()
                    field.clear()
                }
                else -> field.append(character)
            }
        }
        if (escaped) throw IllegalArgumentException("Incomplete escape sequence")
        fields += field.toString()
        return fields
    }

    private fun rejected(status: AuthenticationStatus, reason: String) =
        AuthenticationResult(status = status, reason = reason)
}

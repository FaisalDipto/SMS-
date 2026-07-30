package com.smsweb.gateway

import java.util.Base64
import javax.crypto.Mac
import javax.crypto.spec.SecretKeySpec
import org.junit.Assert.assertEquals
import org.junit.Test

class MessageAuthenticatorTest {
    private val key = "smsweb-test-key-2026"
    private val now = 1_785_362_400L

    @Test
    fun acceptsCurrentSignedShelterResponse() {
        val message = signed(
            "RES|1|A17K|SHELTER|1/1|DHK|DEMO|SMSWEB_DEMO|" +
                "${now - 60}|${now + 3_600}|MIRPUR:23.8069:90.3687:120:OPEN"
        )

        val result = MessageAuthenticator.verify(message, key, now)

        assertEquals(AuthenticationStatus.AUTHENTICATED, result.status)
        assertEquals(now + 3_600, result.replayExpiresAt)
    }

    @Test
    fun acceptsSignedNonAuthoritativeHelpResponse() {
        val result = MessageAuthenticator.verify(
            signed("RES|1|A17K|HELP|1/1|-|HOME;SHELTER;ALERT"),
            key,
            now
        )

        assertEquals(AuthenticationStatus.AUTHENTICATED, result.status)
        assertEquals(now + 86_400, result.replayExpiresAt)
    }

    @Test
    fun rejectsTamperingWrongKeyAndUnsignedMessages() {
        val canonical = "ALT|1|F22P|HIGH|${now + 3_600}|DHK|Avoid Mirpur bridge"
        val message = signed(canonical)

        assertEquals(
            AuthenticationStatus.INVALID,
            MessageAuthenticator.verify(message.replace("Mirpur", "Uttara"), key, now).status
        )
        assertEquals(
            AuthenticationStatus.INVALID,
            MessageAuthenticator.verify(message, "different-test-key-2026", now).status
        )
        assertEquals(
            AuthenticationStatus.UNSIGNED,
            MessageAuthenticator.verify(canonical, key, now).status
        )
    }

    @Test
    fun rejectsExpiredAndFutureDatedMessages() {
        val expired = signed("ALT|1|F22P|HIGH|${now - 1}|DHK|Expired")
        val future = signed(
            "RES|1|A17K|SHELTER|1/1|DHK|DEMO|SMSWEB_DEMO|" +
                "${now + 301}|${now + 3_600}|MIRPUR:120:OPEN"
        )

        assertEquals(
            AuthenticationStatus.EXPIRED,
            MessageAuthenticator.verify(expired, key, now).status
        )
        assertEquals(
            AuthenticationStatus.FUTURE,
            MessageAuthenticator.verify(future, key, now).status
        )
    }

    private fun signed(canonical: String): String {
        val mac = Mac.getInstance("HmacSHA256")
        mac.init(SecretKeySpec(key.toByteArray(), "HmacSHA256"))
        val tag = mac.doFinal(canonical.toByteArray()).copyOf(16)
        return "$canonical|${Base64.getUrlEncoder().withoutPadding().encodeToString(tag)}"
    }
}

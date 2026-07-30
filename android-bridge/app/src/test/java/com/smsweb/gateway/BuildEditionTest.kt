package com.smsweb.gateway

import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test

class BuildEditionTest {
    @Test
    fun editionHasACompleteAndLockedConfiguration() {
        assertTrue(BuildConfig.ROLE_LOCKED)
        when (BuildConfig.APP_ROLE) {
            GatewayConfig.ROLE_USER -> {
                assertTrue(BuildConfig.APPLICATION_ID.endsWith(".user"))
                assertTrue(BuildConfig.DEFAULT_SERVICE_NUMBER.startsWith("+"))
                assertTrue(
                    BuildConfig.DEFAULT_AUTHENTICATION_KEY
                        .toByteArray(Charsets.UTF_8)
                        .size >= MessageAuthenticator.MINIMUM_KEY_BYTES
                )
            }
            GatewayConfig.ROLE_GATEWAY -> {
                assertEquals("com.smsweb.gateway", BuildConfig.APPLICATION_ID)
                assertEquals("", BuildConfig.DEFAULT_SERVICE_NUMBER)
                assertEquals("", BuildConfig.DEFAULT_AUTHENTICATION_KEY)
            }
            else -> throw AssertionError("Unexpected Android edition: ${BuildConfig.APP_ROLE}")
        }
    }
}

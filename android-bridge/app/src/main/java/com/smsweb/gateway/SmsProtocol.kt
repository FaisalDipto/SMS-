package com.smsweb.gateway

object SmsProtocol {
    private val requestPattern = Regex("^REQ\\|1\\|([A-Z0-9]{2,16})\\|")
    private val messagePattern = Regex("^(?:REQ|RES|ALT|ERR)\\|1\\|([A-Z0-9]{2,16})\\|")

    fun isRequest(text: String): Boolean = text.trim().startsWith("REQ|")

    fun isResponse(text: String): Boolean = listOf("RES|", "ALT|", "ERR|")
        .any { text.trim().startsWith(it) }

    fun requestId(text: String): String? = requestPattern.find(text.trim())?.groupValues?.get(1)

    fun messageId(text: String): String? = messagePattern.find(text.trim())?.groupValues?.get(1)
}

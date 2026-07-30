package com.smsweb.gateway

import android.telephony.SmsManager

object SmsTransport {
    fun send(manager: SmsManager, recipient: String, text: String) {
        val parts = manager.divideMessage(text)
        if (parts.size > 1) {
            manager.sendMultipartTextMessage(recipient, null, parts, null, null)
        } else {
            manager.sendTextMessage(recipient, null, text, null, null)
        }
    }
}

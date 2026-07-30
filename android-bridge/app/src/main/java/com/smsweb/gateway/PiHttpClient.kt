package com.smsweb.gateway

import android.content.Context
import org.json.JSONObject
import java.io.IOException
import java.net.HttpURLConnection
import java.net.URL

data class PiResponse(val recipient: String, val messages: List<String>)

class PiHttpClient(private val context: Context) {
    fun incoming(sender: String, text: String): PiResponse {
        val result = post("/sms/incoming", JSONObject().apply {
            put("sender", sender)
            put("text", text)
        })
        val messages = if (result.has("messages") && !result.isNull("messages")) {
            val values = result.getJSONArray("messages")
            (0 until values.length()).map { index -> values.getString(index) }
        } else {
            listOf(result.getString("text"))
        }.filter { it.isNotBlank() }
        if (messages.isEmpty()) throw IOException("Pi returned no SMS response messages")
        return PiResponse(result.getString("recipient"), messages)
    }

    fun responseStatus(requestId: String, status: String) {
        post("/sms/response", JSONObject().apply {
            put("requestId", requestId)
            put("status", status)
        })
    }

    fun health(): Boolean {
        val connection = open("/health", "GET")
        return try {
            connection.connect()
            connection.responseCode in 200..299
        } finally {
            connection.disconnect()
        }
    }

    fun administratorUpdate(kind: String, body: JSONObject): JSONObject {
        val path = when (kind.lowercase()) {
            "shelter" -> "/admin/shelters"
            "hazard" -> "/admin/hazards"
            "alert" -> "/admin/alerts"
            else -> throw IllegalArgumentException("Unknown authority update type")
        }
        return post(path, body, GatewayConfig.authenticationKey(context))
    }

    private fun post(path: String, body: JSONObject, administratorKey: String? = null): JSONObject {
        val connection = open(path, "POST")
        return try {
            connection.doOutput = true
            connection.setRequestProperty("Content-Type", "application/json")
            if (!administratorKey.isNullOrBlank()) {
                connection.setRequestProperty("X-SMSWeb-Key", administratorKey)
            }
            connection.outputStream.use { it.write(body.toString().toByteArray()) }
            val status = connection.responseCode
            val stream = if (status in 200..299) connection.inputStream else connection.errorStream
            val responseBody = stream?.bufferedReader()?.use { it.readText() }.orEmpty()
            if (status !in 200..299) throw IOException("Pi returned HTTP $status: $responseBody")
            JSONObject(responseBody)
        } finally {
            connection.disconnect()
        }
    }

    private fun open(path: String, method: String): HttpURLConnection {
        val url = URL(GatewayConfig.piUrl(context) + path)
        return (url.openConnection() as HttpURLConnection).apply {
            requestMethod = method
            connectTimeout = 5_000
            readTimeout = 5_000
        }
    }
}

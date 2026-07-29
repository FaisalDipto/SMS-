package com.smsweb.gateway

import android.content.ContentValues
import android.content.Context
import android.database.sqlite.SQLiteDatabase
import android.database.sqlite.SQLiteOpenHelper
import java.security.MessageDigest

data class QueueItem(
    val id: Long,
    val direction: String,
    val sender: String,
    val recipient: String,
    val text: String,
    val attempts: Int,
    val subscriptionId: Int
)

data class WebResponse(
    val id: Long,
    val text: String
)

class GatewayDatabase(context: Context) : SQLiteOpenHelper(context, "smsweb_gateway.db", null, 3) {
    override fun onCreate(db: SQLiteDatabase) {
        db.execSQL("""
            CREATE TABLE gateway_queue (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                direction TEXT NOT NULL,
                sender TEXT NOT NULL,
                recipient TEXT NOT NULL,
                text TEXT NOT NULL,
                fingerprint TEXT NOT NULL UNIQUE,
                status TEXT NOT NULL,
                attempts INTEGER NOT NULL DEFAULT 0,
                subscription_id INTEGER NOT NULL DEFAULT -1,
                web_delivered INTEGER NOT NULL DEFAULT 0,
                created_at INTEGER NOT NULL
            )
        """.trimIndent())
    }

    override fun onUpgrade(db: SQLiteDatabase, oldVersion: Int, newVersion: Int) {
        if (oldVersion < 2) {
            db.execSQL("ALTER TABLE gateway_queue ADD COLUMN subscription_id INTEGER NOT NULL DEFAULT -1")
        }
        if (oldVersion < 3) {
            db.execSQL("ALTER TABLE gateway_queue ADD COLUMN web_delivered INTEGER NOT NULL DEFAULT 0")
        }
    }

    fun enqueueToPi(sender: String, text: String, subscriptionId: Int): Boolean = insert(
        direction = "TO_PI",
        sender = sender,
        recipient = "",
        text = text,
        fingerprint = fingerprint("TO_PI|$sender|$text"),
        subscriptionId = subscriptionId
    )

    fun enqueueToUser(recipient: String, text: String, subscriptionId: Int): Boolean = insert(
        direction = "TO_USER",
        sender = "",
        recipient = recipient,
        text = text,
        fingerprint = fingerprint("TO_USER|$recipient|$text"),
        subscriptionId = subscriptionId
    )

    fun pending(direction: String): List<QueueItem> {
        val items = mutableListOf<QueueItem>()
        readableDatabase.query(
            "gateway_queue",
            arrayOf("id", "direction", "sender", "recipient", "text", "attempts", "subscription_id"),
            "direction = ? AND status = ?",
            arrayOf(direction, "QUEUED"),
            null,
            null,
            "id ASC"
        ).use { cursor ->
            while (cursor.moveToNext()) {
                items += QueueItem(
                    id = cursor.getLong(0),
                    direction = cursor.getString(1),
                    sender = cursor.getString(2),
                    recipient = cursor.getString(3),
                    text = cursor.getString(4),
                    attempts = cursor.getInt(5),
                    subscriptionId = cursor.getInt(6)
                )
            }
        }
        return items
    }

    fun markForwarded(id: Long) = updateStatus(id, "FORWARDED")
    fun markSent(id: Long) = updateStatus(id, "SENT")

    fun unreadWebResponses(): List<WebResponse> {
        val responses = mutableListOf<WebResponse>()
        readableDatabase.query(
            "gateway_queue",
            arrayOf("id", "text"),
            "direction = ? AND web_delivered = 0",
            arrayOf("TO_USER"),
            null,
            null,
            "id ASC"
        ).use { cursor ->
            while (cursor.moveToNext()) {
                responses += WebResponse(cursor.getLong(0), cursor.getString(1))
            }
        }
        return responses
    }

    fun markWebDeliveredByText(text: String) {
        writableDatabase.update(
            "gateway_queue",
            ContentValues().apply { put("web_delivered", 1) },
            "direction = ? AND text = ?",
            arrayOf("TO_USER", text)
        )
    }

    fun markRetry(id: Long) {
        writableDatabase.execSQL(
            "UPDATE gateway_queue SET status = 'QUEUED', attempts = attempts + 1 WHERE id = ?",
            arrayOf(id)
        )
    }

    private fun insert(
        direction: String,
        sender: String,
        recipient: String,
        text: String,
        fingerprint: String,
        subscriptionId: Int
    ): Boolean {
        val values = ContentValues().apply {
            put("direction", direction)
            put("sender", sender)
            put("recipient", recipient)
            put("text", text)
            put("fingerprint", fingerprint)
            put("status", "QUEUED")
            put("subscription_id", subscriptionId)
            put("created_at", System.currentTimeMillis())
        }
        return writableDatabase.insertWithOnConflict(
            "gateway_queue",
            null,
            values,
            SQLiteDatabase.CONFLICT_IGNORE
        ) != -1L
    }

    private fun updateStatus(id: Long, status: String) {
        writableDatabase.execSQL(
            "UPDATE gateway_queue SET status = ? WHERE id = ?",
            arrayOf(status, id)
        )
    }

    private fun fingerprint(value: String): String = MessageDigest
        .getInstance("SHA-256")
        .digest(value.toByteArray())
        .joinToString("") { "%02x".format(it) }
}

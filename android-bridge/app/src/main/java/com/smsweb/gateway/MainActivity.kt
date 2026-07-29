package com.smsweb.gateway

import android.Manifest
import android.app.Activity
import android.os.Bundle
import android.widget.Button
import android.widget.EditText
import android.widget.TextView

class MainActivity : Activity() {
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        setContentView(R.layout.activity_main)

        val urlInput = findViewById<EditText>(R.id.pi_url)
        val status = findViewById<TextView>(R.id.gateway_status)
        urlInput.setText(GatewayConfig.piUrl(this))

        findViewById<Button>(R.id.save_url).setOnClickListener {
            GatewayConfig.savePiUrl(this, urlInput.text.toString())
            status.text = "Pi URL saved"
        }

        findViewById<Button>(R.id.check_connection).setOnClickListener {
            status.text = "Checking Pi connection..."
            Thread {
                val connected = runCatching { PiHttpClient(this).health() }.getOrDefault(false)
                runOnUiThread {
                    status.text = if (connected) "Pi connected" else "Pi unavailable; queued messages will retry"
                }
            }.start()
        }

        if (android.os.Build.VERSION.SDK_INT >= android.os.Build.VERSION_CODES.M) {
            requestPermissions(
                arrayOf(Manifest.permission.RECEIVE_SMS, Manifest.permission.READ_SMS, Manifest.permission.SEND_SMS),
                100
            )
        }
    }
}

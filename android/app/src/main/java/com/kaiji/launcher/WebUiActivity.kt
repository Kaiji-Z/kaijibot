package com.kaiji.launcher

import android.graphics.Color
import android.net.Uri
import android.os.Bundle
import android.view.Gravity
import android.widget.Button
import android.widget.LinearLayout
import android.widget.TextView
import android.widget.Toast
import androidx.appcompat.app.AppCompatActivity
import androidx.browser.customtabs.CustomTabsIntent

class WebUiActivity : AppCompatActivity() {

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)

        if (!checkGateway()) {
            showError()
            return
        }

        try {
            val intent = CustomTabsIntent.Builder()
                .setToolbarColor(Color.parseColor("#06080F"))
                .setNavigationBarColor(Color.parseColor("#06080F"))
                .setShowTitle(false)
                .setUrlBarHidingEnabled(false)
                .build()

            intent.intent.addFlags(android.content.Intent.FLAG_ACTIVITY_NO_HISTORY)

            try {
                intent.launchUrl(this, Uri.parse("http://127.0.0.1:18789/"))
                finish()
            } catch (_: android.content.ActivityNotFoundException) {
                Toast.makeText(this, "请安装 Chrome 浏览器", Toast.LENGTH_LONG).show()
                finish()
            }
        } catch (e: Exception) {
            Toast.makeText(this, "无法打开控制面板: ${e.message}", Toast.LENGTH_LONG).show()
            finish()
        }
    }

    private fun checkGateway(): Boolean {
        return try {
            val socket = java.net.Socket()
            try {
                socket.connect(java.net.InetSocketAddress("127.0.0.1", 18789), 2000)
                true
            } finally {
                socket.close()
            }
        } catch (_: Exception) {
            false
        }
    }

    private fun showError() {
        val root = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            gravity = Gravity.CENTER
            setBackgroundColor(Color.parseColor("#06080F"))
            setPadding(48, 0, 48, 0)
        }

        val title = TextView(this).apply {
            text = "无法连接到网关"
            setTextColor(Color.parseColor("#E6E4E0"))
            textSize = 16f
            setPadding(0, 0, 0, 12)
        }

        val desc = TextView(this).apply {
            text = "请确认 Termux 中网关已启动：\nkaijibot gateway --port 18789"
            setTextColor(Color.parseColor("#8A8D96"))
            textSize = 13f
            typeface = android.graphics.Typeface.MONOSPACE
        }

        val retry = Button(this).apply {
            text = "重试"
            setBackgroundColor(Color.parseColor("#00D4AA"))
            setTextColor(Color.parseColor("#06080F"))
            setOnClickListener { recreate() }
        }

        root.addView(title)
        root.addView(desc)
        root.addView(retry)
        setContentView(root)
    }
}

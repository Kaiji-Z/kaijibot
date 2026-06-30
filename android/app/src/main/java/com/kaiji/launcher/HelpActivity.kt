package com.kaiji.launcher

import android.content.ClipData
import android.content.ClipboardManager
import android.content.Context
import android.content.Intent
import android.net.Uri
import android.os.Bundle
import android.provider.Settings
import android.view.View
import android.widget.Toast
import androidx.appcompat.app.AppCompatActivity

class HelpActivity : AppCompatActivity() {

    companion object {
        private const val TERMUX_PACKAGE = "com.termux"
    }

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        setContentView(R.layout.activity_help)

        findViewById<View>(R.id.backButton).setOnClickListener {
            finish()
        }

        val commandRows = mapOf(
            R.id.cmdStatus  to "kaijibot gateway status",
            R.id.cmdStart   to ". ~/.kaijibot/start-gateway.sh",
            R.id.cmdRestart to "kaijibot gateway restart",
            R.id.cmdStop    to "kaijibot gateway stop",
            R.id.cmdLog     to "tail -50 ~/.kaijibot/gateway.log",
            R.id.cmdUpdate  to "kaijibot update",
            R.id.cmdOnboard to "kaijibot onboard",
        )

        for ((rowId, command) in commandRows) {
            findViewById<View>(rowId).setOnClickListener {
                copyAndLaunchTermux(command)
            }
        }

        findViewById<View>(R.id.cmdBattery).setOnClickListener {
            openBatteryOptimizationSettings()
        }

        findViewById<View>(R.id.cmdBoot).setOnClickListener {
            openTermuxBootInstall()
        }
    }

    private fun copyAndLaunchTermux(command: String) {
        val clipboard = getSystemService(Context.CLIPBOARD_SERVICE) as ClipboardManager
        clipboard.setPrimaryClip(ClipData.newPlainText("KaijiBot", command))
        Toast.makeText(this, "已复制: $command", Toast.LENGTH_SHORT).show()

        try {
            val intent = packageManager.getLaunchIntentForPackage(TERMUX_PACKAGE)
            if (intent != null) {
                intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
                startActivity(intent)
            }
        } catch (_: Exception) {
        }
    }

    private fun openBatteryOptimizationSettings() {
        try {
            val intent = Intent(Settings.ACTION_IGNORE_BATTERY_OPTIMIZATION_SETTINGS).apply {
                addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
            }
            startActivity(intent)
        } catch (_: Exception) {
            try {
                val intent = Intent(Settings.ACTION_APPLICATION_DETAILS_SETTINGS).apply {
                    data = Uri.parse("package:$packageName")
                    addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
                }
                startActivity(intent)
            } catch (_: Exception) {
                Toast.makeText(this, "无法打开电池设置", Toast.LENGTH_SHORT).show()
            }
        }
    }

    private fun openTermuxBootInstall() {
        copyAndLaunchTermux("mkdir -p ~/.termux/boot && echo '. ~/.kaijibot/start-gateway.sh' > ~/.termux/boot/start-kaijibot.sh")

        try {
            val intent = Intent(Intent.ACTION_VIEW, Uri.parse("https://f-droid.org/packages/com.termux.boot/")).apply {
                addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
            }
            startActivity(intent)
        } catch (_: Exception) {
            Toast.makeText(this, "打开浏览器失败，命令已复制", Toast.LENGTH_LONG).show()
        }
    }
}

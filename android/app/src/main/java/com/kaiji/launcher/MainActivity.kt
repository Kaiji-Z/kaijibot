package com.kaiji.launcher

import android.content.ClipData
import android.content.ClipboardManager
import android.content.Context
import android.content.Intent
import android.content.pm.PackageManager
import android.net.Uri
import android.os.Build
import android.os.Bundle
import android.view.View
import android.widget.Button
import android.widget.TextView
import android.widget.Toast
import android.util.Log
import androidx.appcompat.app.AppCompatActivity
import androidx.core.content.FileProvider
import java.io.File
import java.io.FileOutputStream

class MainActivity : AppCompatActivity() {

    private lateinit var statusText: TextView
    private lateinit var actionButton: Button
    private lateinit var hintButton: Button

    companion object {
        private const val TERMUX_PACKAGE = "com.termux"
        private const val INSTALL_CMD =
            "curl -fsSL https://gitee.com/kaiji1126/kaijibot/raw/main/scripts/install-termux.sh | bash"
        private const val ASCII_ART =
            "██╗  ██╗ █████╗ ██╗     ██╗██╗██████╗  ██████╗ ████████╗\n" +
            "██║ ██╔╝██╔══██╗██║     ██║██║██╔══██╗██╔═══██╗╚══██╔══╝\n" +
            "█████╔╝ ███████║██║     ██║██║██████╔╝██║   ██║   ██║   \n" +
            "██╔═██╗ ██╔══██║██║██   ██║██║██╔══██╗██║   ██║   ██║   \n" +
            "██║  ██╗██║  ██║██║╚█████╔╝██║██████╔╝╚██████╔╝   ██║   \n" +
            "╚═╝  ╚═╝╚═╝  ╚═╝╚═╝ ╚════╝ ╚═╝╚═════╝  ╚═════╝    ╚═╝   "
    }

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        setContentView(R.layout.activity_main)

        findViewById<TextView>(R.id.asciiArt).text = ASCII_ART
        statusText = findViewById(R.id.statusText)
        actionButton = findViewById(R.id.actionButton)
        hintButton = findViewById(R.id.hintButton)
        hintButton.visibility = View.GONE

        findViewById<android.widget.Button>(R.id.helpButton).setOnClickListener {
            startActivity(Intent(this, HelpActivity::class.java))
        }

        updateState()
    }

    override fun onResume() {
        super.onResume()
        updateState()
    }

    private fun updateState() {
        if (isTermuxInstalled()) {
            showTermuxReady()
        } else {
            showInstallTermux()
        }
    }

    private fun isTermuxInstalled(): Boolean {
        return try {
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
                packageManager.getPackageInfo(TERMUX_PACKAGE, PackageManager.PackageInfoFlags.of(0))
            } else {
                @Suppress("DEPRECATION")
                packageManager.getPackageInfo(TERMUX_PACKAGE, 0)
            }
            true
        } catch (_: PackageManager.NameNotFoundException) {
            false
        }
    }

    private fun showInstallTermux() {
        statusText.text = "第一步：安装 Termux 终端环境"
        hintButton.visibility = View.GONE
        actionButton.text = "安装 Termux"
        actionButton.setOnClickListener { installBundledTermux() }
    }

    private fun installBundledTermux() {
        actionButton.isEnabled = false
        actionButton.text = "正在准备..."
        statusText.text = "正在提取 Termux 安装包（约 34MB），请稍候..."

        Thread {
            try {
                val apkFile = File(cacheDir, "termux.apk")
                resources.openRawResource(R.raw.termux).use { input ->
                    FileOutputStream(apkFile).use { output -> input.copyTo(output) }
                }

                runOnUiThread {
                    statusText.text = "请在弹出的窗口中点击「安装」"
                    val uri = FileProvider.getUriForFile(this, "$packageName.fileprovider", apkFile)
                    val intent = Intent(Intent.ACTION_VIEW).apply {
                        setDataAndType(uri, "application/vnd.android.package-archive")
                        addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION)
                        addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
                    }
                    try {
                        startActivity(intent)
                    } catch (e: Exception) {
                        Toast.makeText(this, "无法启动安装器: ${e.message}", Toast.LENGTH_LONG).show()
                        Log.e("KaijiBot", "startActivity failed", e)
                    }
                }
            } catch (e: Exception) {
                runOnUiThread {
                    statusText.text = "安装失败: ${e.message}"
                    Toast.makeText(this, "安装失败: ${e.message}", Toast.LENGTH_LONG).show()
                    Log.e("KaijiBot", "installBundledTermux failed", e)
                }
            } finally {
                runOnUiThread {
                    actionButton.isEnabled = true
                    actionButton.text = "安装 Termux"
                }
            }
        }.start()
    }

    private fun showTermuxReady() {
        statusText.text = "Termux 已安装！\n\n点击下方按钮，命令会自动复制到剪贴板。\n打开 Termux 后长按屏幕粘贴并回车即可。"
        actionButton.text = "复制命令并打开 Termux"
        actionButton.setOnClickListener {
            copyToClipboard()
            launchTermux()
        }

        hintButton.visibility = View.VISIBLE
        hintButton.text = "重新复制命令"
        hintButton.setOnClickListener { copyToClipboard() }
    }

    private fun copyToClipboard() {
        val clipboard = getSystemService(Context.CLIPBOARD_SERVICE) as ClipboardManager
        clipboard.setPrimaryClip(ClipData.newPlainText("KaijiBot", INSTALL_CMD))
    }

    private fun launchTermux() {
        try {
            val intent = packageManager.getLaunchIntentForPackage(TERMUX_PACKAGE)
            if (intent != null) {
                intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
                startActivity(intent)
            }
        } catch (_: Exception) {
        }
    }
}

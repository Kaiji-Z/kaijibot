package com.kaiji.launcher

import android.content.ClipData
import android.content.ClipboardManager
import android.content.Context
import android.content.Intent
import android.content.pm.PackageManager
import android.net.Uri
import android.os.Build
import android.os.Bundle
import android.os.Handler
import android.os.Looper
import android.view.View
import android.widget.Button
import android.widget.ProgressBar
import android.widget.TextView
import androidx.appcompat.app.AppCompatActivity
import androidx.core.content.FileProvider
import java.io.File
import java.io.FileOutputStream
import java.net.HttpURLConnection
import java.net.URL

class MainActivity : AppCompatActivity() {

    private lateinit var statusText: TextView
    private lateinit var progressBar: ProgressBar
    private lateinit var actionButton: Button
    private lateinit var hintButton: Button

    private val handler = Handler(Looper.getMainLooper())
    private var downloadedApk: File? = null

    companion object {
        private const val TERMUX_PACKAGE = "com.termux"
        private const val TERMUX_APK_URL =
            "https://github.com/Kaiji-Z/kaijibot/releases/download/v2026.6.25-1/termux-arm64.apk"
        private const val INSTALL_CMD =
            "curl -fsSL https://gitee.com/kaiji1126/kaijibot/raw/main/scripts/install-termux.sh | bash"
    }

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        setContentView(R.layout.activity_main)

        statusText = findViewById(R.id.statusText)
        progressBar = findViewById(R.id.progressBar)
        actionButton = findViewById(R.id.actionButton)
        hintButton = findViewById(R.id.hintButton)
        hintButton.visibility = View.GONE

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
            showDownloadTermux()
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

    // ─── State: Termux not installed ──────────────────────────

    private fun showDownloadTermux() {
        statusText.text = "需要先安装 Termux 终端环境"
        progressBar.visibility = View.GONE
        hintButton.visibility = View.GONE
        actionButton.text = "下载并安装 Termux"
        actionButton.isEnabled = true
        actionButton.setOnClickListener { downloadAndInstallTermux() }
    }

    private fun downloadAndInstallTermux() {
        statusText.text = "正在下载 Termux（约 34MB）..."
        progressBar.visibility = View.VISIBLE
        progressBar.progress = 0
        actionButton.isEnabled = false
        actionButton.text = "下载中..."

        Thread {
            try {
                val apkFile = File(cacheDir, "termux.apk")
                val conn = URL(TERMUX_APK_URL).openConnection() as HttpURLConnection
                conn.connect()
                val total = conn.contentLength
                var downloaded = 0
                conn.inputStream.use { input ->
                    FileOutputStream(apkFile).use { output ->
                        val buf = ByteArray(8192)
                        var n: Int
                        while (input.read(buf).also { n = it } > 0) {
                            output.write(buf, 0, n)
                            downloaded += n
                            if (total > 0) {
                                val pct = downloaded * 100 / total
                                handler.post { progressBar.progress = pct }
                            }
                        }
                    }
                }
                downloadedApk = apkFile
                handler.post { installTermuxApk() }
            } catch (e: Exception) {
                handler.post {
                    statusText.text = "下载失败: ${e.message}"
                    progressBar.visibility = View.GONE
                    actionButton.isEnabled = true
                    actionButton.text = "重试下载"
                }
            }
        }.start()
    }

    private fun installTermuxApk() {
        val apkFile = downloadedApk ?: return
        statusText.text = "请在弹出的窗口中点击「安装」"
        progressBar.visibility = View.GONE

        val uri = FileProvider.getUriForFile(this, "$packageName.fileprovider", apkFile)
        val intent = Intent(Intent.ACTION_VIEW).apply {
            setDataAndType(uri, "application/vnd.android.package-archive")
            addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION)
            addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
        }
        startActivity(intent)
    }

    // ─── State: Termux installed ──────────────────────────────

    private fun showTermuxReady() {
        statusText.text = "Termux 已安装！\n\n点击下方按钮，命令会自动复制到剪贴板。\n打开 Termux 后长按屏幕粘贴并回车即可。"
        progressBar.visibility = View.GONE
        actionButton.text = "复制命令并打开 Termux"
        actionButton.isEnabled = true
        actionButton.setOnClickListener { copyCommandAndLaunchTermux() }

        hintButton.visibility = View.VISIBLE
        hintButton.text = "重新复制命令"
        hintButton.setOnClickListener { copyToClipboard() }
    }

    private fun copyCommandAndLaunchTermux() {
        copyToClipboard()
        launchTermux()
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

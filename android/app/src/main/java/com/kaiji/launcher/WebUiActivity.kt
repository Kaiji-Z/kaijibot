package com.kaiji.launcher

import android.annotation.SuppressLint
import android.content.Context
import android.graphics.Color
import android.net.http.SslError
import android.os.Bundle
import android.view.View
import android.view.WindowManager
import android.webkit.SslErrorHandler
import android.webkit.WebChromeClient
import android.webkit.WebResourceError
import android.webkit.WebResourceRequest
import android.webkit.WebView
import android.webkit.WebViewClient
import android.widget.FrameLayout
import android.widget.LinearLayout
import android.widget.ProgressBar
import android.widget.TextView
import androidx.appcompat.app.AppCompatActivity
import androidx.swiperefreshlayout.widget.SwipeRefreshLayout

class WebUiActivity : AppCompatActivity() {

    private lateinit var webView: WebView
    private lateinit var loadingView: LinearLayout
    private lateinit var errorView: LinearLayout
    private lateinit var swipeRefresh: SwipeRefreshLayout

    @SuppressLint("SetJavaScriptEnabled")
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)

        val root = SwipeRefreshLayout(this).apply {
            setBackgroundColor(Color.parseColor("#06080F"))
            setOnRefreshListener { reload() }
        }

        val container = FrameLayout(this).apply {
            layoutParams = FrameLayout.LayoutParams(
                FrameLayout.LayoutParams.MATCH_PARENT,
                FrameLayout.LayoutParams.MATCH_PARENT
            )
        }

        webView = WebView(this).apply {
            settings.javaScriptEnabled = true
            settings.domStorageEnabled = true
            settings.databaseEnabled = true
            settings.allowFileAccess = false
            settings.cacheMode = android.webkit.WebSettings.LOAD_DEFAULT
            webViewClient = GatewayWebViewClient()
            webChromeClient = object : WebChromeClient() {
                override fun onProgressChanged(view: WebView?, newProgress: Int) {
                    if (newProgress >= 100) {
                        swipeRefresh.isRefreshing = false
                        loadingView.visibility = View.GONE
                        webView.visibility = View.VISIBLE
                    }
                }
            }
            setLayerType(android.view.View.LAYER_TYPE_HARDWARE, null)
        }
        container.addView(webView)

        loadingView = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            gravity = android.view.Gravity.CENTER
            visibility = View.VISIBLE
            val pb = ProgressBar(this@WebUiActivity).apply {
                indeterminateTintList = android.content.res.ColorStateList.valueOf(Color.parseColor("#00D4AA"))
            }
            val hint = TextView(this@WebUiActivity).apply {
                text = "正在连接网关…"
                setTextColor(Color.parseColor("#8A8D96"))
                textSize = 14f
                setPadding(0, 48, 0, 0)
            }
            addView(pb)
            addView(hint)
        }
        container.addView(loadingView)

        errorView = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            gravity = android.view.Gravity.CENTER
            visibility = View.GONE
            setPadding(48, 0, 48, 0)
            val title = TextView(this@WebUiActivity).apply {
                text = "无法连接到网关"
                setTextColor(Color.parseColor("#E6E4E0"))
                textSize = 16f
                setPadding(0, 0, 0, 12)
            }
            val desc = TextView(this@WebUiActivity).apply {
                text = "请确认 Termux 中网关已启动：\n. ~/.kaijibot/start-gateway.sh"
                setTextColor(Color.parseColor("#8A8D96"))
                textSize = 13f
                fontFamily = android.graphics.Typeface.MONOSPACE
            }
            val retry = android.widget.Button(this@WebUiActivity).apply {
                text = "重试"
                setBackgroundColor(Color.parseColor("#00D4AA"))
                setTextColor(Color.parseColor("#06080F"))
                setOnClickListener { reload() }
                setPadding(48, 24, 48, 24)
                val lp = LinearLayout.LayoutParams(
                    LinearLayout.LayoutParams.WRAP_CONTENT,
                    LinearLayout.LayoutParams.WRAP_CONTENT
                )
                lp.topMargin = 48
                layoutParams = lp
            }
            addView(title)
            addView(desc)
            addView(retry)
        }
        container.addView(errorView)

        root.addView(container)
        setContentView(root)

        loadGateway()
    }

    private fun loadGateway() {
        loadingView.visibility = View.VISIBLE
        errorView.visibility = View.GONE
        webView.visibility = View.GONE

        Thread {
            val reachable = try {
                val socket = java.net.Socket()
                socket.connect(java.net.InetSocketAddress("127.0.0.1", 18789), 2000)
                socket.close()
                true
            } catch (_: Exception) {
                false
            }

            runOnUiThread {
                if (reachable) {
                    webView.loadUrl("http://127.0.0.1:18789/")
                } else {
                    loadingView.visibility = View.GONE
                    errorView.visibility = View.VISIBLE
                }
            }
        }.start()
    }

    private fun reload() {
        swipeRefresh.isRefreshing = true
        loadGateway()
    }

    @Deprecated("Deprecated in Java")
    override fun onBackPressed() {
        if (webView.canGoBack()) {
            webView.goBack()
        } else {
            @Suppress("DEPRECATION")
            super.onBackPressed()
        }
    }

    inner class GatewayWebViewClient : WebViewClient() {
        override fun shouldOverrideUrlLoading(view: WebView?, request: WebResourceRequest?): Boolean {
            return false
        }

        override fun onReceivedError(view: WebView?, request: WebResourceRequest?, error: WebResourceError?) {
            if (request?.isForMainFrame == true) {
                loadingView.visibility = View.GONE
                webView.visibility = View.GONE
                errorView.visibility = View.VISIBLE
                swipeRefresh.isRefreshing = false
            }
        }

        override fun onReceivedSslError(view: WebView?, handler: SslErrorHandler?, error: SslError?) {
            handler?.proceed()
        }
    }
}

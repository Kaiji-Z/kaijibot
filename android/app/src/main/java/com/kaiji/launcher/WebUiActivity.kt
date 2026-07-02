package com.kaiji.launcher

import android.annotation.SuppressLint
import android.content.Intent
import android.graphics.Color
import android.net.Uri
import android.net.http.SslError
import android.os.Bundle
import android.util.Log
import android.view.Gravity
import android.view.View
import android.webkit.RenderProcessGoneDetail
import android.webkit.SslErrorHandler
import android.webkit.WebChromeClient
import android.webkit.WebResourceError
import android.webkit.WebResourceRequest
import android.webkit.WebView
import android.webkit.WebViewClient
import android.widget.Button
import android.widget.FrameLayout
import android.widget.LinearLayout
import android.widget.ProgressBar
import android.widget.TextView
import android.widget.Toast
import androidx.appcompat.app.AppCompatActivity
import androidx.swiperefreshlayout.widget.SwipeRefreshLayout

class WebUiActivity : AppCompatActivity() {

    private lateinit var webView: WebView
    private lateinit var loadingView: LinearLayout
    private lateinit var errorView: LinearLayout
    private lateinit var swipeRefresh: SwipeRefreshLayout

    private var rendererCrashed = false

    @SuppressLint("SetJavaScriptEnabled")
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)

        swipeRefresh = SwipeRefreshLayout(this).apply {
            setBackgroundColor(Color.parseColor("#06080F"))
            setOnRefreshListener { reload() }
        }
        val root = swipeRefresh

        val container = FrameLayout(this).apply {
            layoutParams = FrameLayout.LayoutParams(
                FrameLayout.LayoutParams.MATCH_PARENT,
                FrameLayout.LayoutParams.MATCH_PARENT,
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
        }
        container.addView(webView)

        loadingView = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            gravity = Gravity.CENTER
            visibility = View.VISIBLE
            val pb = ProgressBar(this@WebUiActivity).apply {
                indeterminateTintList =
                    android.content.res.ColorStateList.valueOf(Color.parseColor("#00D4AA"))
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
            gravity = Gravity.CENTER
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
                typeface = android.graphics.Typeface.MONOSPACE
            }
            val retry = Button(this@WebUiActivity).apply {
                text = "重试"
                setBackgroundColor(Color.parseColor("#00D4AA"))
                setTextColor(Color.parseColor("#06080F"))
                setOnClickListener { reload() }
                setPadding(48, 24, 48, 24)
                val lp = LinearLayout.LayoutParams(
                    LinearLayout.LayoutParams.WRAP_CONTENT,
                    LinearLayout.LayoutParams.WRAP_CONTENT,
                )
                lp.topMargin = 48
                layoutParams = lp
            }
            val browserBtn = Button(this@WebUiActivity).apply {
                text = "用浏览器打开"
                setBackgroundColor(Color.parseColor("#1C2030"))
                setTextColor(Color.parseColor("#E6E4E0"))
                setOnClickListener {
                    startActivity(
                        Intent(Intent.ACTION_VIEW, Uri.parse("http://127.0.0.1:18789/")),
                    )
                }
                val lp = LinearLayout.LayoutParams(
                    LinearLayout.LayoutParams.WRAP_CONTENT,
                    LinearLayout.LayoutParams.WRAP_CONTENT,
                )
                lp.topMargin = 16
                layoutParams = lp
            }
            addView(title)
            addView(desc)
            addView(retry)
            addView(browserBtn)
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
                try {
                    socket.connect(java.net.InetSocketAddress("127.0.0.1", 18789), 2000)
                    true
                } finally {
                    socket.close()
                }
            } catch (_: Exception) {
                false
            }

            runOnUiThread {
                if (isFinishing || isDestroyed) {
                    return@runOnUiThread
                }
                if (reachable) {
                    if (rendererCrashed) {
                        recreateWebView()
                    }
                    try {
                        webView.loadUrl("http://127.0.0.1:18789/")
                    } catch (e: Exception) {
                        Log.e("KaijiBot", "loadUrl failed", e)
                        showError()
                    }
                } else {
                    showError()
                }
            }
        }.start()
    }

    private fun showError() {
        loadingView.visibility = View.GONE
        webView.visibility = View.GONE
        errorView.visibility = View.VISIBLE
        swipeRefresh.isRefreshing = false
    }

    @SuppressLint("SetJavaScriptEnabled")
    private fun recreateWebView() {
        val parent = webView.parent as? FrameLayout
        val index = parent?.indexOfChild(webView) ?: 0
        parent?.removeView(webView)
        webView.destroy()
        rendererCrashed = false

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
        }
        parent?.addView(webView, index)
    }

    private fun reload() {
        swipeRefresh.isRefreshing = true
        loadGateway()
    }

    @Deprecated("Deprecated in Java")
    override fun onBackPressed() {
        if (this::webView.isInitialized && webView.canGoBack()) {
            webView.goBack()
        } else {
            @Suppress("DEPRECATION")
            super.onBackPressed()
        }
    }

    inner class GatewayWebViewClient : WebViewClient() {
        override fun shouldOverrideUrlLoading(
            view: WebView?,
            request: WebResourceRequest?,
        ): Boolean = false

        override fun onReceivedError(
            view: WebView?,
            request: WebResourceRequest?,
            error: WebResourceError?,
        ) {
            if (request?.isForMainFrame == true) {
                showError()
            }
        }

        override fun onReceivedSslError(
            view: WebView?,
            handler: SslErrorHandler?,
            error: SslError?,
        ) {
            handler?.proceed()
        }

        override fun onRenderProcessGone(
            view: WebView?,
            detail: RenderProcessGoneDetail?,
        ): Boolean {
            Log.e("KaijiBot", "WebView renderer gone: reason=${detail?.reason}")
            rendererCrashed = true
            runOnUiThread {
                if (isFinishing || isDestroyed) {
                    return@runOnUiThread
                }
                Toast.makeText(
                    this@WebUiActivity,
                    "控制面板渲染失败，建议用浏览器打开",
                    Toast.LENGTH_LONG,
                ).show()
                showError()
            }
            return true
        }
    }
}

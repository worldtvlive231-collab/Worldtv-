package com.worldtv.admin

import android.app.Activity
import android.content.Intent
import android.graphics.Color
import android.graphics.drawable.GradientDrawable
import android.net.Uri
import android.net.http.SslError
import android.os.Bundle
import android.view.Gravity
import android.view.View
import android.webkit.SslErrorHandler
import android.webkit.WebChromeClient
import android.webkit.WebResourceRequest
import android.webkit.WebSettings
import android.webkit.WebView
import android.webkit.WebViewClient
import android.widget.Button
import android.widget.HorizontalScrollView
import android.widget.LinearLayout
import android.widget.TextView
import android.widget.Toast

class MainActivity : Activity() {
    private lateinit var webView: WebView
    private lateinit var navBar: LinearLayout

    private val adminUrl = "https://myworldtvlive.com/admin"
    private val allowedHosts = setOf("myworldtvlive.com", "www.myworldtvlive.com")

    private data class AdminSection(val title: String, val tabId: String?)

    private val sections = listOf(
        AdminSection("Dashboard", null),
        AdminSection("Customers", "customersTab"),
        AdminSection("Orders", "productOrdersTab"),
        AdminSection("Subscription Codes", "codesTab"),
        AdminSection("Sales Recovery", "salesDashboardTab"),
        AdminSection("Analytics", "analyticsTab")
    )

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)

        WebView.setWebContentsDebuggingEnabled(false)
        setContentView(buildAppLayout())
        configureWebView()

        if (savedInstanceState == null) {
            webView.loadUrl(adminUrl)
        } else {
            webView.restoreState(savedInstanceState)
        }
    }

    private fun buildAppLayout(): View {
        val root = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            setBackgroundColor(Color.parseColor("#111827"))
        }

        val topBar = LinearLayout(this).apply {
            orientation = LinearLayout.HORIZONTAL
            gravity = Gravity.CENTER_VERTICAL
            setPadding(dp(16), dp(12), dp(16), dp(10))
            setBackgroundColor(Color.parseColor("#111827"))
        }

        val brand = TextView(this).apply {
            text = "WORLD TV  •  ADMIN"
            textSize = 19f
            setTextColor(Color.parseColor("#E0A200"))
            setTypeface(typeface, android.graphics.Typeface.BOLD)
        }

        topBar.addView(
            brand,
            LinearLayout.LayoutParams(0, LinearLayout.LayoutParams.WRAP_CONTENT, 1f)
        )

        val refresh = Button(this).apply {
            text = "Refresh"
            isAllCaps = false
            textSize = 12f
            setTextColor(Color.WHITE)
            background = roundedBackground("#273244", 12f)
            setPadding(dp(14), 0, dp(14), 0)
            setOnClickListener { webView.reload() }
        }
        topBar.addView(refresh, LinearLayout.LayoutParams(LinearLayout.LayoutParams.WRAP_CONTENT, dp(40)))
        root.addView(topBar)

        navBar = LinearLayout(this).apply {
            orientation = LinearLayout.HORIZONTAL
            gravity = Gravity.CENTER_VERTICAL
            setPadding(dp(10), dp(7), dp(10), dp(9))
            setBackgroundColor(Color.parseColor("#182131"))
        }

        sections.forEachIndexed { index, section ->
            val button = Button(this).apply {
                text = section.title
                isAllCaps = false
                textSize = 12f
                setTextColor(if (index == 0) Color.parseColor("#17130A") else Color.WHITE)
                background = roundedBackground(if (index == 0) "#E0A200" else "#273244", 14f)
                setPadding(dp(14), 0, dp(14), 0)
                tag = section.tabId ?: "dashboard"
                setOnClickListener {
                    selectNavButton(this)
                    if (section.tabId == null) openDashboard() else openAdminTab(section.tabId)
                }
            }
            navBar.addView(button, LinearLayout.LayoutParams(LinearLayout.LayoutParams.WRAP_CONTENT, dp(42)).apply {
                marginEnd = dp(7)
            })
        }

        val scroller = HorizontalScrollView(this).apply {
            isHorizontalScrollBarEnabled = false
            addView(navBar)
        }
        root.addView(scroller, LinearLayout.LayoutParams(LinearLayout.LayoutParams.MATCH_PARENT, LinearLayout.LayoutParams.WRAP_CONTENT))

        webView = WebView(this)
        root.addView(webView, LinearLayout.LayoutParams(LinearLayout.LayoutParams.MATCH_PARENT, 0, 1f))
        return root
    }

    private fun configureWebView() {
        webView.settings.apply {
            javaScriptEnabled = true
            domStorageEnabled = true
            databaseEnabled = true
            mixedContentMode = WebSettings.MIXED_CONTENT_NEVER_ALLOW
            allowFileAccess = false
            allowContentAccess = false
            javaScriptCanOpenWindowsAutomatically = false
            setSupportMultipleWindows(false)
            userAgentString = "$userAgentString WORLD-TV-Admin/1.1"
        }

        webView.webChromeClient = WebChromeClient()
        webView.webViewClient = object : WebViewClient() {
            override fun shouldOverrideUrlLoading(view: WebView, request: WebResourceRequest): Boolean {
                val uri = request.url
                val isAllowed = uri.scheme == "https" && uri.host?.lowercase() in allowedHosts
                if (isAllowed) return false

                try {
                    startActivity(Intent(Intent.ACTION_VIEW, uri))
                } catch (_: Exception) {
                    Toast.makeText(this@MainActivity, "Unable to open this link", Toast.LENGTH_SHORT).show()
                }
                return true
            }

            override fun onReceivedSslError(view: WebView?, handler: SslErrorHandler?, error: SslError?) {
                handler?.cancel()
            }
        }
    }

    private fun openAdminTab(tabId: String) {
        val script = """
            (function(){
              var login=document.getElementById('login');
              if(login && !login.classList.contains('hide')) return 'login';
              var btn=Array.from(document.querySelectorAll('.tab')).find(function(b){
                return (b.getAttribute('onclick')||'').indexOf(\"$tabId\")>=0;
              });
              if(typeof showTab==='function' && btn){
                showTab('$tabId',btn);
                window.scrollTo(0,0);
                return 'ok';
              }
              return 'missing';
            })();
        """.trimIndent()

        webView.evaluateJavascript(script) { result ->
            if (result == "\"login\"") {
                Toast.makeText(this, "Sign in first to open this section", Toast.LENGTH_SHORT).show()
            } else if (result == "\"missing\"") {
                webView.loadUrl(adminUrl)
            }
        }
    }

    private fun openDashboard() {
        val script = """
            (function(){
              var login=document.getElementById('login');
              if(login && !login.classList.contains('hide')) return 'login';
              var dashboard=document.getElementById('dashboard');
              if(dashboard) dashboard.classList.remove('hide');
              window.scrollTo(0,0);
              return 'ok';
            })();
        """.trimIndent()
        webView.evaluateJavascript(script, null)
    }

    private fun selectNavButton(selected: Button) {
        for (i in 0 until navBar.childCount) {
            val child = navBar.getChildAt(i) as? Button ?: continue
            val active = child === selected
            child.setTextColor(if (active) Color.parseColor("#17130A") else Color.WHITE)
            child.background = roundedBackground(if (active) "#E0A200" else "#273244", 14f)
        }
    }

    private fun roundedBackground(color: String, radiusDp: Float): GradientDrawable =
        GradientDrawable().apply {
            shape = GradientDrawable.RECTANGLE
            cornerRadius = dp(radiusDp.toInt()).toFloat()
            setColor(Color.parseColor(color))
        }

    private fun dp(value: Int): Int = (value * resources.displayMetrics.density).toInt()

    override fun onSaveInstanceState(outState: Bundle) {
        webView.saveState(outState)
        super.onSaveInstanceState(outState)
    }

    @Deprecated("Deprecated in Java")
    override fun onBackPressed() {
        if (webView.canGoBack()) webView.goBack() else super.onBackPressed()
    }

    override fun onDestroy() {
        webView.stopLoading()
        webView.webChromeClient = null
        webView.destroy()
        super.onDestroy()
    }
}

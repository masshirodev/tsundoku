package dev.masshiro.tsundoku.tv

import android.annotation.SuppressLint
import android.content.Context
import android.graphics.Color
import android.net.Uri
import android.os.Bundle
import android.os.Handler
import android.os.Looper
import android.view.KeyEvent
import android.view.View
import android.view.ViewGroup
import android.view.WindowManager
import android.webkit.CookieManager
import android.webkit.WebChromeClient
import android.webkit.WebResourceError
import android.webkit.WebResourceRequest
import android.webkit.WebSettings
import android.webkit.WebView
import android.webkit.WebViewClient
import android.widget.FrameLayout
import androidx.activity.ComponentActivity
import androidx.activity.OnBackPressedCallback
import androidx.core.view.WindowCompat
import androidx.core.view.WindowInsetsCompat
import androidx.core.view.WindowInsetsControllerCompat
import org.json.JSONObject
import java.util.concurrent.Executors

/**
 * tsundoku on an Android TV (c236; doc/TV-APP.md). A WebView that holds the
 * same web app a phone or a computer opens, and the four things the page
 * cannot do over plain http: a launcher presence, the remote's keys, the
 * screen kept awake, and a way to be paired with six digits.
 *
 * The app's own screens (9A, 9B, 9D) are in `assets/pair/`; 9C and 9E are the
 * computer's `/pair/tv`, so the code is posted same-origin and the paired
 * cookie is the one `/pair/<code>` sets for a phone.
 */
class MainActivity : ComponentActivity() {
	private lateinit var webView: WebView
	private lateinit var root: FrameLayout
	private lateinit var bridge: PairingBridge
	private var customView: View? = null
	private var customCallback: WebChromeClient.CustomViewCallback? = null
	private val io = Executors.newSingleThreadExecutor()
	private val ui = Handler(Looper.getMainLooper())

	/** BACK is the page's while it can take it; then history; then leaving. */
	private val back =
		object : OnBackPressedCallback(true) {
			override fun handleOnBackPressed() {
				webView.evaluateJavascript(BACK_JS) { value ->
					if (value != "true") {
						if (webView.canGoBack()) webView.goBack() else finish()
					}
				}
			}
		}

	override fun onCreate(savedInstanceState: Bundle?) {
		super.onCreate(savedInstanceState)
		CookieManager.getInstance().setAcceptCookie(true)

		root = FrameLayout(this)
		root.setBackgroundColor(Color.BLACK)
		webView = WebView(this)
		root.addView(webView, frame())
		setContentView(root)

		window.addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON)
		WindowCompat.setDecorFitsSystemWindows(window, false)
		hideSystemUi()

		configure(webView)
		bridge = PairingBridge(this)
		webView.addJavascriptInterface(bridge, PairingBridge.NAME)
		webView.webViewClient = client()
		webView.webChromeClient = chrome()
		onBackPressedDispatcher.addCallback(this, back)

		val remembered = prefs().getString(KEY_ADDRESS, "").orEmpty()
		if (remembered.isEmpty()) {
			// 9A: nothing has been paired yet.
			loadAsset()
		} else {
			// On launch a remembered address that answers opens the library;
			// one that doesn't shows 9D, with what it tried.
			io.execute {
				val ok = Probe.check(remembered)
				ui.post { if (ok) open(remembered) else showLost(remembered) }
			}
		}
	}

	override fun onResume() {
		super.onResume()
		// Over plain http the page cannot ask for a wake lock (doc/WIFI.md), so
		// the activity holds the screen while it is in front.
		window.addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON)
	}

	override fun onPause() {
		super.onPause()
		window.clearFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON)
		// The paired cookie is written by the server; this is what makes it
		// survive the app being killed (doc/TV-APP.md).
		CookieManager.getInstance().flush()
	}

	override fun onDestroy() {
		bridge.shutdown()
		io.shutdownNow()
		webView.destroy()
		super.onDestroy()
	}

	override fun onWindowFocusChanged(hasFocus: Boolean) {
		super.onWindowFocusChanged(hasFocus)
		if (hasFocus) hideSystemUi()
	}

	/**
	 * MENU and the media keys, before the WebView can swallow them: the page
	 * gets a DOM key it understands (Keys.kt), dispatched at the focused thing.
	 * Everything else is the WebView's, including the D-pad and OK.
	 */
	override fun dispatchKeyEvent(event: KeyEvent): Boolean {
		val key = Keys.domKeyFor(event.keyCode)
		if (key != null && (event.action == KeyEvent.ACTION_DOWN || event.action == KeyEvent.ACTION_UP)) {
			webView.evaluateJavascript(Keys.dispatchScript(key, event.action == KeyEvent.ACTION_DOWN), null)
			return true
		}
		return super.dispatchKeyEvent(event)
	}

	/** A probe the page asked for has answered. */
	fun postProbe(origin: String, ok: Boolean) {
		runOnUiThread {
			webView.evaluateJavascript(
				"window.tsundokuProbe && window.tsundokuProbe(${JSONObject.quote(origin)}, $ok)",
				null
			)
		}
	}

	@SuppressLint("SetJavaScriptEnabled")
	private fun configure(w: WebView) {
		w.setBackgroundColor(Color.BLACK)
		val s = w.settings
		s.javaScriptEnabled = true
		s.domStorageEnabled = true
		s.databaseEnabled = true
		// The page is pinned to the handoff's 960 CSS px whatever the panel
		// reports (Scale.kt, doc/TV.md "Claims to check").
		s.useWideViewPort = false
		s.loadWithOverviewMode = false
		val metrics = resources.displayMetrics
		w.setInitialScale(Scale.percentFor(metrics.widthPixels / metrics.density))
		s.textZoom = 100
		s.setSupportZoom(false)
		s.builtInZoomControls = false
		s.displayZoomControls = false
		// The player starts without an OK press: a TV has no "tap to play".
		s.mediaPlaybackRequiresUserGesture = false
		s.cacheMode = WebSettings.LOAD_DEFAULT
		s.allowFileAccess = true
		// What the server's device list reads: "Android TV · Chrome", not a tablet.
		s.userAgentString = s.userAgentString + " TsundokuTV/${BuildConfig.VERSION_NAME}"
		WebView.setWebContentsDebuggingEnabled(BuildConfig.DEBUG)
	}

	private fun client() =
		object : WebViewClient() {
			override fun onReceivedError(
				view: WebView,
				request: WebResourceRequest,
				error: WebResourceError
			) {
				// A remembered address that stopped answering: 9D, not the
				// WebView's own grey page. Subresources are the page's business.
				if (!request.isForMainFrame || request.url.scheme == "file") return
				showLost(originOf(request.url))
			}
		}

	private fun chrome() =
		object : WebChromeClient() {
			/** A video gone fullscreen: the picture, nothing of the app. */
			override fun onShowCustomView(view: View, callback: CustomViewCallback) {
				if (customView != null) {
					callback.onCustomViewHidden()
					return
				}
				customView = view
				customCallback = callback
				root.addView(view, frame())
				webView.visibility = View.GONE
				hideSystemUi()
			}

			override fun onHideCustomView() {
				val view = customView ?: return
				root.removeView(view)
				customView = null
				customCallback?.onCustomViewHidden()
				customCallback = null
				webView.visibility = View.VISIBLE
				hideSystemUi()
			}
		}

	private fun frame() = FrameLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT)

	private fun open(origin: String) {
		webView.loadUrl(origin)
	}

	private fun loadAsset() {
		webView.loadUrl("file:///android_asset/pair/index.html")
	}

	private fun showLost(origin: String) {
		webView.loadUrl("file:///android_asset/pair/index.html#lost=${Uri.encode(origin)}")
	}

	private fun prefs() = getSharedPreferences("pairing", Context.MODE_PRIVATE)

	private fun originOf(url: Uri): String {
		val port = if (url.port > 0) ":${url.port}" else ""
		return "${url.scheme}://${url.host}$port"
	}

	private fun hideSystemUi() {
		WindowInsetsControllerCompat(window, window.decorView).apply {
			hide(WindowInsetsCompat.Type.systemBars())
			systemBarsBehavior = WindowInsetsControllerCompat.BEHAVIOR_SHOW_TRANSIENT_BARS_BY_SWIPE
		}
	}

	companion object {
		private const val KEY_ADDRESS = "address"

		/** c236's contract: true means the page took BACK. */
		private const val BACK_JS =
			"(function(){try{return typeof window.tsundokuBack==='function' ? !!window.tsundokuBack() : false}catch(e){return false}})()"
	}
}

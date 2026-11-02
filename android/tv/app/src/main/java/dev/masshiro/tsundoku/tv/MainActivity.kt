package dev.masshiro.tsundoku.tv

import android.annotation.SuppressLint
import android.content.Context
import android.content.Intent
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
				// A video gone fullscreen is a view over the page, not the
				// page's: BACK takes the picture down first, as on a phone.
				if (customView != null) {
					hideCustomView()
					return
				}
				webView.evaluateJavascript(BACK_JS) { value ->
					if (value != "true") goBackOrLeave()
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
		// A given address belongs to this launch. Android recreating the
		// activity would otherwise hand it to a TV that already paired and
		// send it back to pairing (c260).
		val given = if (savedInstanceState == null) givenAddress(intent) else null
		if (given != null) {
			takeGiven(given)
		} else if (remembered.isEmpty()) {
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

	/**
	 * A singleTask app started again gets the new intent here, not in
	 * `onCreate`: a second `am start` on a running TV must reach the same
	 * door, or the address only works while the app is closed (c260).
	 */
	override fun onNewIntent(intent: Intent) {
		super.onNewIntent(intent)
		setIntent(intent)
		val given = givenAddress(intent) ?: return
		takeGiven(given)
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
		// In physical pixels: setInitialScale is (Scale.kt says why).
		w.setInitialScale(Scale.percentFor(resources.displayMetrics.widthPixels))
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

			override fun onHideCustomView() = hideCustomView()
		}

	/**
	 * The fullscreen picture taken down, by the page (onHideCustomView) or by
	 * BACK. `onCustomViewHidden` tells the page it left fullscreen; it may call
	 * onHideCustomView again, which then finds nothing to do.
	 */
	private fun hideCustomView() {
		val view = customView ?: return
		val callback = customCallback
		root.removeView(view)
		customView = null
		customCallback = null
		webView.visibility = View.VISIBLE
		callback?.onCustomViewHidden()
		hideSystemUi()
	}

	private fun frame() = FrameLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT)

	/** The page took nothing: back to the screen before, or out (Back.kt says which). */
	private fun goBackOrLeave() {
		val list = webView.copyBackForwardList()
		val at = list.currentIndex
		val current = list.currentItem?.url ?: webView.url.orEmpty()
		val history = (0 until at).mapNotNull { list.getItemAtIndex(it)?.url }
		val steps = Back.steps(current, history)
		if (steps != null && webView.canGoBackOrForward(-steps)) webView.goBackOrForward(-steps) else finish()
	}

	private fun open(origin: String) {
		webView.loadUrl(origin)
	}

	private fun loadAsset(hash: String = "") {
		webView.loadUrl("file:///android_asset/pair/index.html$hash")
	}

	private fun showLost(origin: String) {
		loadAsset("#lost=${Uri.encode(origin)}")
	}

	/**
	 * The address this launch was handed, from the extra the documented
	 * command sends or from a `tsundoku://connect?url=` link. The extra wins
	 * when both are there: it is what doc/TV-APP.md tells the owner to type,
	 * and a launcher's link is the second way in.
	 */
	private fun givenAddress(intent: Intent?): String? {
		if (intent == null) return null
		intent.getStringExtra(EXTRA_URL)?.trim()?.takeIf { it.isNotEmpty() }?.let { return it }
		val data = intent.data ?: return null
		if (!data.scheme.equals("tsundoku", true) || !data.host.equals("connect", true)) return null
		return data.getQueryParameter(EXTRA_URL)?.trim()?.takeIf { it.isNotEmpty() }
	}

	/**
	 * The one place a given address is judged, whichever door it came through
	 * (c260). A valid one goes to 9B's own probe path in the page, which is
	 * where an answer is remembered; a refused one shows 9B's band and is
	 * never stored.
	 */
	private fun takeGiven(raw: String) {
		val origin = Address.intentOrigin(raw)
		loadAsset(
			if (origin == null) "#bad=${Uri.encode(raw)}"
			else "#connect=${Uri.encode(origin)}"
		)
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

		/** The launch extra, and the deep link's query parameter (c260). */
		private const val EXTRA_URL = "url"

		/** c236's contract: true means the page took BACK. */
		private const val BACK_JS =
			"(function(){try{return typeof window.tsundokuBack==='function' ? !!window.tsundokuBack() : false}catch(e){return false}})()"
	}
}

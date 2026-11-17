package dev.masshiro.tsundoku.tv

import android.annotation.SuppressLint
import android.content.Intent
import android.content.pm.ActivityInfo
import android.graphics.Color
import android.net.Uri
import android.os.Bundle
import android.os.Handler
import android.os.Looper
import android.os.SystemClock
import android.util.Log
import android.view.KeyEvent
import android.view.View
import android.view.ViewGroup
import android.view.WindowManager
import android.webkit.CookieManager
import android.webkit.WebChromeClient
import android.webkit.WebResourceError
import android.webkit.WebResourceRequest
import android.webkit.WebResourceResponse
import android.webkit.WebSettings
import android.webkit.WebView
import android.webkit.WebViewClient
import android.widget.FrameLayout
import android.widget.Toast
import androidx.activity.ComponentActivity
import androidx.activity.OnBackPressedCallback
import androidx.core.content.pm.ShortcutInfoCompat
import androidx.core.content.pm.ShortcutManagerCompat
import androidx.core.graphics.drawable.IconCompat
import androidx.core.view.ViewCompat
import androidx.core.view.WindowCompat
import androidx.core.view.WindowInsetsCompat
import androidx.core.view.WindowInsetsControllerCompat
import androidx.webkit.WebViewAssetLoader
import org.json.JSONObject
import java.io.ByteArrayInputStream
import java.util.concurrent.Executors
import java.util.concurrent.FutureTask
import java.util.concurrent.TimeUnit

/**
 * tsundoku on an Android TV (doc/TV-APP.md), and on a phone or
 * tablet too (doc/PHONE-APP.md): one activity for both, the differences in
 * [Form]. A WebView that holds the same web app a phone or a computer opens,
 * and the things the page cannot do over plain http: a launcher presence, the
 * remote's keys (a TV's), the screen kept awake, and a way to be paired with
 * six digits. On a phone it also keeps the page out of the camera cutout and
 * above the keyboard (Insets.kt).
 *
 * The app's own screens (the first screen, the address screen, the
 * not-answering screen) are in `assets/pair/`; the code page and the paired
 * page are the computer's `/pair/tv`, so the code is posted same-origin and
 * the paired cookie is the one `/pair/<code>` sets for a phone.
 */
class MainActivity : ComponentActivity(), PairingBridge.Host {
	private lateinit var webView: WebView
	private lateinit var root: FrameLayout
	private lateinit var bridge: PairingBridge
	private lateinit var servers: Servers
	private var customView: View? = null
	private var customCallback: WebChromeClient.CustomViewCallback? = null

	/**
	 * What [requestedOrientation] was before a fullscreen picture turned the
	 * phone ([turnForVideo]), to put it back when the picture goes.
	 */
	private var wasOrientation = ActivityInfo.SCREEN_ORIENTATION_UNSPECIFIED
	private val io = Executors.newSingleThreadExecutor()

	/** The updater's own thread: a download never holds up the launch's probe. */
	private val updateIo = Executors.newSingleThreadExecutor()
	private val ui = Handler(Looper.getMainLooper())

	/**
	 * The app's own page, served at [BridgeGuard.ASSET] instead of
	 * `file:///android_asset/`: an https origin is one a message
	 * listener's origin rule can name, and one this host's every request is
	 * answered from (the client below), so a network answer at it is never
	 * trusted. `/pair/index.html` is `assets/pair/index.html`.
	 *
	 * The handler is mounted at `/`, so it maps the request path straight onto
	 * `assets/` (`/pair/index.html` → `assets/pair/index.html`). Mounting it at
	 * `/pair/` would strip that prefix and ask for `assets/index.html`, which
	 * does not exist, so `/` is the mount and the client, not the loader, is
	 * what limits which requests reach it ([BridgeGuard.refusesAssetRequest]).
	 */
	private val assets by lazy {
		WebViewAssetLoader.Builder()
			.addPathHandler("/", WebViewAssetLoader.AssetsPathHandler(this))
			.build()
	}

	/**
	 * The pair page's capability for this activity's life: a
	 * random `?t=…` that [loadAsset] writes into the URL and
	 * [BridgeGuard.refusesAssetRequest] requires before the loader answers it.
	 * A page can write the asset URL but cannot know this token, so a link, a
	 * redirect or a form that reaches the host is a 404 without depending on
	 * which `shouldOverrideUrlLoading` overload the WebView version calls. It
	 * is a fresh value per activity, never stored, and a reload keeps it
	 * because a reload reloads the document's own URL.
	 */
	private val assetToken = java.util.UUID.randomUUID().toString()

	/** Which app this build is: every TV-or-phone difference asks it. */
	private val form = Form.of(BuildConfig.FORM)

	/** A page asked to be drawn under the camera (the bridge's `edge`); each new document starts padded. */
	private var edge = false

	/** What the page was last told of the edges, so a page that loads later is told too. */
	private var told = Insets.Sides()

	/** The app updating itself; the page draws it through the bridge. */
	private lateinit var updates: Updater

	/** Which launch owns the WebView: a later launch wins over an earlier answer. */
	private val attempts = Attempts()

	/** The press that would leave only says so; the next one leaves (LeaveWindow.kt). */
	private val leave = LeaveWindow()

	/** PRESS BACK AGAIN TO LEAVE, while the window it speaks for is open. */
	private var leaveToast: Toast? = null

	/** BACK's key repeated while it was down: [dispatchKeyEvent] saw it, [back] reads it. */
	private var backHeld = false

	/**
	 * BACK is the page's while it can take it; then history; then leaving, on
	 * the second press. The press's time and whether it was held are read here,
	 * and handed on: the page answers asynchronously, so a key or a page change
	 * can land before the answer does (LeaveWindow says why that matters).
	 */
	private val back =
		object : OnBackPressedCallback(true) {
			override fun handleOnBackPressed() {
				// A video gone fullscreen is a view over the page, not the
				// page's: BACK takes the picture down first, as on a phone.
				if (customView != null) {
					hideCustomView()
					backHeld = false
					return
				}
				val at = SystemClock.uptimeMillis()
				val held = backHeld
				backHeld = false
				webView.evaluateJavascript(BACK_JS) { value ->
					// This answer can land after the activity went, or behind a
					// later press; the press it belongs to is what is decided.
					if (isFinishing || isDestroyed) return@evaluateJavascript
					if (value == "true") closeLeaveWindow(at) else goBackOrLeave(at, held)
				}
			}
		}

	override fun onCreate(savedInstanceState: Bundle?) {
		super.onCreate(savedInstanceState)
		CookieManager.getInstance().setAcceptCookie(true)

		root = FrameLayout(this)
		root.setBackgroundColor(if (form.padsInsets) themeBackground() else Color.BLACK)
		webView = WebView(this)
		root.addView(webView, frame())
		setContentView(root)

		window.addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON)
		WindowCompat.setDecorFitsSystemWindows(window, false)
		// Into the cutout on every Android: without it a fullscreen app on 14
		// and older is kept out of the band whatever a page asks, and the
		// reader could never draw under the camera. The app pads it itself.
		if (form.padsInsets && android.os.Build.VERSION.SDK_INT >= 28) {
			window.attributes =
				window.attributes.apply {
					layoutInDisplayCutoutMode = WindowManager.LayoutParams.LAYOUT_IN_DISPLAY_CUTOUT_MODE_SHORT_EDGES
				}
		}
		hideSystemUi()
		if (form.padsInsets) padForInsets()

		configure(webView)
		servers = Servers(PrefsKeyValue(this))
		bridge = PairingBridge(this, servers, form = form)
		updates =
			Updater(this, form, BuildConfig.VERSION_NAME, BuildConfig.UPDATES_URL, updateIo) { state ->
				runOnUiThread {
					webView.evaluateJavascript(
						"window.tsundokuAppUpdate && window.tsundokuAppUpdate(${state.toJson()})",
						null
					)
				}
			}
		Updater.current = updates
		// At most once a day, and never for a build that is no release (Updater.launched).
		updates.launched()
		webView.addJavascriptInterface(bridge, PairingBridge.NAME)
		webView.webViewClient = client()
		webView.webChromeClient = chrome()
		onBackPressedDispatcher.addCallback(this, back)

		// The last used server: a TV paired before the list existed
		// has its one address migrated into a list of one here (Servers.all).
		val remembered = servers.lastUsed()?.origin.orEmpty()
		serversChanged()
		// A given address belongs to this launch. Android recreating the
		// activity would otherwise hand it to a TV that already paired and
		// send it back to pairing.
		val given = if (savedInstanceState == null) givenAddress(intent) else null
		if (given != null) {
			takeGiven(given)
		} else if (remembered.isEmpty()) {
			// The first screen: nothing has been paired yet.
			loadAsset()
		} else {
			// On launch the last used server that answers opens its library;
			// one that doesn't shows the not-answering screen for it, with the
			// others under it, never silently another. A launch handed an
			// address while this probe is out owns the screen, so a late answer
			// is dropped rather than replacing its address screen.
			val mine = attempts.begin()
			io.execute {
				val ok = Probe.check(remembered)
				ui.post { attempts.answer(mine) { if (ok) open(remembered) else showLost(remembered) } }
			}
		}
	}

	/**
	 * A singleTask app started again gets the new intent here, not in
	 * `onCreate`: a second `am start` on a running TV must be taken the
	 * same way, or the address only works while the app is closed.
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
		// Back from Android's "allow installs from tsundoku" switch: install now.
		if (::updates.isInitialized) updates.resumed()
	}

	override fun onPause() {
		super.onPause()
		window.clearFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON)
		// The paired cookie is written by the server; this is what makes it
		// survive the app being killed (doc/ANDROID.md).
		CookieManager.getInstance().flush()
	}

	override fun onDestroy() {
		if (Updater.current === updates) Updater.current = null
		bridge.shutdown()
		io.shutdownNow()
		updateIo.shutdownNow()
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
		noteKey(event)
		// A phone has no remote: a headset's play key is the WebView's own.
		if (!form.takesRemoteKeys) return super.dispatchKeyEvent(event)
		val key = Keys.domKeyFor(event.keyCode)
		if (key != null && (event.action == KeyEvent.ACTION_DOWN || event.action == KeyEvent.ACTION_UP)) {
			webView.evaluateJavascript(Keys.dispatchScript(key, event.action == KeyEvent.ACTION_DOWN), null)
			return true
		}
		return super.dispatchKeyEvent(event)
	}

	/**
	 * The one place every key is seen before the WebView can have it, and so
	 * where "any other key ends the window" is done. BACK's own events
	 * pass through here too, which is the only way to see it repeat; that is
	 * why the manifest turns the back-invoked path off, which at targetSdk 36
	 * on Android 16 would otherwise take BACK before it reaches this method.
	 */
	private fun noteKey(event: KeyEvent) {
		if (event.action != KeyEvent.ACTION_DOWN) return
		if (event.keyCode == KeyEvent.KEYCODE_BACK) backHeld = event.repeatCount > 0 else closeLeaveWindow(event.eventTime)
	}

	/** The window ended, for whatever reason: its words go too. */
	private fun closeLeaveWindow(at: Long) {
		if (leave.end(at)) leaveToast?.cancel()
	}

	/**
	 * The page in the WebView, for the bridge's guard (BridgeGuard). A
	 * bridge call arrives on the JavaBridge thread, and `WebView.url` must be
	 * read on the UI thread, so the read is posted there and waited for; one
	 * that does not come back in 2 s is no page at all, and the call is refused.
	 */
	override fun topUrl(): String? {
		if (Looper.myLooper() == Looper.getMainLooper()) return webView.url
		val read = FutureTask { webView.url }
		ui.post(read)
		return try {
			read.get(2, TimeUnit.SECONDS)
		} catch (_: Exception) {
			null
		}
	}

	override fun onUi(block: () -> Unit) = runOnUiThread(block)

	/** A probe the page asked for has answered. */
	override fun postProbe(origin: String, ok: Boolean) {
		runOnUiThread {
			webView.evaluateJavascript(
				"window.tsundokuProbe && window.tsundokuProbe(${JSONObject.quote(origin)}, $ok)",
				null
			)
		}
	}

	/**
	 * The page asked (the bridge's `surface`) or was read (onPageFinished) for
	 * its background: the camera band and the strip above the keyboard take it,
	 * so they read as the page's own edge, dark or light (Insets.kt).
	 */
	override fun paintSurface(color: Int) {
		if (!form.padsInsets) return
		root.setBackgroundColor(color)
		webView.setBackgroundColor(color)
	}

	/**
	 * The bridge's `keyboard()`: the WebView takes focus and Android shows the
	 * keyboard for the field the page focused. Posted, so the page's own focus
	 * has landed first.
	 */
	override fun showKeyboard() {
		if (!form.raisesKeyboard) return
		webView.requestFocus()
		webView.post {
			val imm = getSystemService(INPUT_METHOD_SERVICE) as android.view.inputmethod.InputMethodManager
			imm.showSoftInput(webView, android.view.inputmethod.InputMethodManager.SHOW_IMPLICIT)
		}
	}

	override fun updater(): Updater? = if (::updates.isInitialized) updates else null

	/** The bridge's `edge`: padding off or on again, asked of the insets anew. */
	override fun setEdge(on: Boolean) {
		if (!form.padsInsets || edge == on) return
		edge = on
		ViewCompat.requestApplyInsets(root)
	}

	/** The theme's background, dark or light with the phone's setting (src/mobile/res). */
	private fun themeBackground(): Int {
		val a = obtainStyledAttributes(intArrayOf(android.R.attr.colorBackground))
		return try {
			a.getColor(0, Color.BLACK)
		} finally {
			a.recycle()
		}
	}

	/**
	 * The camera cutout, the keyboard and the home gesture, as padding on the
	 * WebView's frame (Insets.kt says which, and why natively). Asked again
	 * whenever any of them changes: the keyboard opening, the phone turning.
	 */
	private fun padForInsets() {
		ViewCompat.setOnApplyWindowInsetsListener(root) { view, insets ->
			fun sides(t: Int) = insets.getInsets(t).let { Insets.Sides(it.left, it.top, it.right, it.bottom) }
			val cutout = sides(WindowInsetsCompat.Type.displayCutout())
			val gestures = sides(WindowInsetsCompat.Type.mandatorySystemGestures())
			val p =
				Insets.padding(
					cutout = cutout,
					ime = sides(WindowInsetsCompat.Type.ime()),
					gestures = gestures,
					edge = edge
				)
			view.setPadding(p.left, p.top, p.right, p.bottom)
			// The page always knows where the band is, padded or not.
			told = Insets.css(cutout, gestures, resources.displayMetrics.density)
			webView.evaluateJavascript(Insets.cssScript(told), null)
			WindowInsetsCompat.CONSUMED
		}
	}

	@SuppressLint("SetJavaScriptEnabled")
	private fun configure(w: WebView) {
		w.setBackgroundColor(if (form.padsInsets) themeBackground() else Color.BLACK)
		val s = w.settings
		s.javaScriptEnabled = true
		s.domStorageEnabled = true
		s.databaseEnabled = true
		if (form.pinsWidth) {
			// The page is pinned to the design's 960 CSS px whatever the panel
			// reports (Scale.kt, doc/TV.md "Claims to check").
			s.useWideViewPort = false
			s.loadWithOverviewMode = false
			// In physical pixels: setInitialScale is (Scale.kt says why).
			w.setInitialScale(Scale.percentFor(resources.displayMetrics.widthPixels))
		} else {
			// A phone lays the page out at its own width (the page's
			// width=device-width), so the web app's phone and tablet layouts
			// are the ones it gets.
			s.useWideViewPort = true
			s.loadWithOverviewMode = false
		}
		// Android's font size on a phone, capped at 130; 100 on a TV (Form.kt).
		s.textZoom = form.textZoom(resources.configuration.fontScale)
		// Zoom is off on both: pinch and double tap do nothing (the reason
		// for the phone app at all; the page adds touch-action too).
		s.setSupportZoom(false)
		s.builtInZoomControls = false
		s.displayZoomControls = false
		// The player starts without an OK press: a TV has no "tap to play".
		s.mediaPlaybackRequiresUserGesture = false
		s.cacheMode = WebSettings.LOAD_DEFAULT
		// The app's own page is served by WebViewAssetLoader, so no
		// file:// URL needs reaching; a page that loads one is a page this app
		// does not have.
		s.allowFileAccess = false
		// What the server's device list reads (catalog.ts, isTsundokuApp): a TV
		// as a TV, a phone or tablet as the app over its screen's kind.
		s.userAgentString = s.userAgentString + " " + form.userAgentToken(BuildConfig.VERSION_NAME)
		WebView.setWebContentsDebuggingEnabled(BuildConfig.DEBUG)
	}

	private val failedLoad = FailedLoad()

	private fun client() =
		object : WebViewClient() {
			/**
			 * The app's own page is served here, never by the network:
			 * [BridgeGuard.ASSET_HOST]'s every request goes through the loader,
			 * and a path it does not hold is 404 rather than a request that
			 * could reach a real host. Only the main frame's GET of this
			 * activity's own token is served ([BridgeGuard.refusesAssetRequest]):
			 * `shouldOverrideUrlLoading` never sees a POST, a WebView without
			 * the redirect feature does not see a 302, and a frame's request
			 * for the host is an embed. All are 404. The rest of the WebView is
			 * untouched.
			 */
			override fun shouldInterceptRequest(
				view: WebView,
				request: WebResourceRequest
			): WebResourceResponse? {
				if (!BridgeGuard.isAssetHost(request.url.toString())) return null
				if (BridgeGuard.refusesAssetRequest(
						request.url.toString(),
						request.isForMainFrame,
						request.method,
						assetToken
					)
				) return notFound()
				return assets.shouldInterceptRequest(request.url) ?: notFound()
			}

			/**
			 * Nothing navigates into the app's own page. At
			 * [BridgeGuard.ASSET] it is an ordinary https URL,
			 * so a server's page — or an external link followed from one — could
			 * set `location` to it with `#connect=` and have the pair page add
			 * an attacker's server. The app's own `loadUrl` never reaches this
			 * callback, and the page's own hash changes are same-document, so
			 * only somebody else's navigation is refused here.
			 *
			 * The deprecated overload below is the half API 23 calls: this one
			 * was added in API 24, and `minSdk` is 23.
			 */
			override fun shouldOverrideUrlLoading(
				view: WebView,
				request: WebResourceRequest
			): Boolean = BridgeGuard.refusesNavigation(request.url.toString())

			/**
			 * API 23 and below call only this overload; the [WebResourceRequest]
			 * one above was added in API 24 and `minSdk` is 23 ("old TV boxes",
			 * `doc/ANDROID.md`). Without this override the navigation guard would
			 * simply not run on an Android 6 television.
			 *
			 * `androidx.webkit.WebViewClientCompat` is not the shortcut it
			 * looks like: it overrides the API-24 method and delegates it to
			 * this one, so on API 23 it is never entered either (its own source;
			 * its features list has no `shouldOverrideUrlLoading` compat entry).
			 * The sub-frame/POST/redirect shapes stay covered by
			 * [BridgeGuard.refusesAssetRequest]'s token, which does not depend
			 * on a callback.
			 */
			@Suppress("DEPRECATION", "OVERRIDE_DEPRECATION")
			@Deprecated("API 23 calls this overload; the WebResourceRequest one is API 24 and up.")
			override fun shouldOverrideUrlLoading(view: WebView, url: String): Boolean =
				BridgeGuard.refusesNavigation(url)

			override fun onReceivedError(
				view: WebView,
				request: WebResourceRequest,
				error: WebResourceError
			) {
				// A remembered address that stopped answering: the
				// not-answering screen, not the WebView's own grey page.
				// Subresources are the page's business, and so is the app's own
				// page: it has no server to lose.
				if (!request.isForMainFrame || !isServerPage(request.url)) return
				failedLoad.failed(originOf(request.url))
				showLost(originOf(request.url))
			}

			/**
			 * A page change ends the leave window. This is the callback that
			 * sees SvelteKit's client navigations, which never reach
			 * `onPageStarted` or `onPageFinished`; it fires for a load too.
			 */
			override fun doUpdateVisitedHistory(view: WebView, url: String?, isReload: Boolean) {
				if (leave.navigated(url ?: return, SystemClock.uptimeMillis())) leaveToast?.cancel()
			}

			override fun onPageStarted(view: WebView, url: String, favicon: android.graphics.Bitmap?) {
				// A new document starts padded: a reader that left by a full
				// load never got to say edge(false).
				if (edge) setEdge(false)
				val uri = Uri.parse(url)
				if (isServerPage(uri)) failedLoad.started(originOf(uri))
			}

			/**
			 * A server's own page has loaded. Its library makes it the
			 * one in use, which is what launch opens next; its paired page says
			 * its name, and after an add, the app's own added page takes over
			 * from it.
			 */
			override fun onPageFinished(view: WebView, url: String) {
				// The camera band takes the page's colour, whichever page it is
				// (the app's own, or an older server's, which never says).
				if (form.padsInsets) {
					view.evaluateJavascript(SURFACE_JS) { value -> readSurface(value) }
					view.evaluateJavascript(Insets.cssScript(told), null)
				}
				val uri = Uri.parse(url)
				// The code page on a phone: once the page has hydrated, its
				// field takes focus and the keyboard comes up. An older server
				// never focuses it on a phone, and its 1 px field can't be
				// tapped, so without this no digit could be typed there at all.
				if (form.raisesKeyboard && uri.path == "/pair/tv") view.evaluateJavascript(CODE_FOCUS_JS, null)
				// The app's own page is no server's: it is neither a
				// visit nor a paired page, and its URL is not an origin.
				if (!isServerPage(uri)) return
				val origin = originOf(uri)
				val known = servers.find(origin)
				// A failed load finishes too: it must not become the last used,
				// and a failed /pair/tv is no paired page to read (FailedLoad.finish).
				when (failedLoad.finish(origin, uri.path, known != null)) {
					FailedLoad.Finish.SKIP -> return
					FailedLoad.Finish.PAIRED_PAGE ->
						known?.let { k -> view.evaluateJavascript(PAIRED_JS) { value -> pairedPage(k, value) } }
					FailedLoad.Finish.VISIT ->
						if (!Back.passedOver(url) && servers.opened(origin)) serversChanged()
				}
			}
		}

	/**
	 * The paired page is on screen when its first line says PAIRED WITH. Its
	 * name is the server's own; and when the TV already had another server and
	 * this one has never been opened, this was an add, so the added page
	 * replaces it.
	 */
	private fun pairedPage(known: Servers.Server, value: String?) {
		val said = runCatching { org.json.JSONArray("[" + (value ?: "null") + "]").optString(0, "") }.getOrDefault("")
		val name = Forget.pairedNameFrom(said) ?: return
		if (servers.named(known.origin, name)) serversChanged()
		val wasAdd = known.opened == 0L && servers.all().size > 1
		if (wasAdd) showAsset("#added=" + Uri.encode(known.origin))
	}

	/** SURFACE_JS's answer: a JSON string, "" when the page has no solid colour. */
	private fun readSurface(value: String?) {
		val css = runCatching { org.json.JSONArray("[" + (value ?: "null") + "]").optString(0, "") }.getOrDefault("")
		Insets.parseColor(css)?.let(::paintSurface)
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
				turnForVideo()
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
		endTurnForVideo()
		hideSystemUi()
	}

	/**
	 * A phone turns for a picture on the whole screen, as a browser's
	 * fullscreen video does (doc/ANIME.md, "Portrait"). The page asks for it
	 * (`screen.orientation.lock('landscape')`), which a WebView refuses with
	 * `NotSupportedError — not available on this device`, so the app turns the
	 * window instead. Never on a TV, which is landscape already (Form.kt).
	 *
	 * SENSOR_LANDSCAPE rather than USER_LANDSCAPE: Chrome's lock turns the
	 * picture whatever the phone's auto-rotate says, and FULL is a deliberate
	 * ask for landscape.
	 */
	private fun turnForVideo() {
		if (!form.turnsForVideo) return
		wasOrientation = requestedOrientation
		requestedOrientation = ActivityInfo.SCREEN_ORIENTATION_SENSOR_LANDSCAPE
	}

	/** The picture is gone: back to however the phone was, so upright is portrait again. */
	private fun endTurnForVideo() {
		if (!form.turnsForVideo) return
		requestedOrientation = wasOrientation
	}

	private fun frame() = FrameLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT)

	/**
	 * The page took nothing: back to the screen before (Back.kt says which), or
	 * toward the way out, which takes a second press. Every way out
	 * is here, the library as home and "no earlier screen" alike.
	 *
	 * `at` is when the key was pressed, read before the page was asked.
	 */
	private fun goBackOrLeave(at: Long, held: Boolean) {
		val list = webView.copyBackForwardList()
		val index = list.currentIndex
		val current = list.currentItem?.url ?: webView.url.orEmpty()
		val history = (0 until index).mapNotNull { list.getItemAtIndex(it)?.url }
		val steps = Back.steps(current, history)
		val canGoBack = steps != null && webView.canGoBackOrForward(-steps)
		if (canGoBack) {
			closeLeaveWindow(at)
			webView.goBackOrForward(-steps)
			return
		}
		val verdict = leave.press(at, held)
		Log.i(BACK_LOG, Back.leaveLine(steps, canGoBack, current, webView.url, index, list.size, held, verdict))
		when (verdict) {
			LeaveWindow.Verdict.TOAST -> {
				leaveToast?.cancel()
				leaveToast = Toast.makeText(this, R.string.press_back_again, Toast.LENGTH_SHORT).also { it.show() }
			}
			LeaveWindow.Verdict.LEAVE -> {
				leaveToast?.cancel()
				finish()
			}
			LeaveWindow.Verdict.NOTHING -> Unit
		}
	}

	private fun open(origin: String) {
		// This load is the app's own attempt: a mark left by an earlier failed
		// load of this server, finished or not, must not swallow its visit.
		failedLoad.attempt(originOf(Uri.parse(origin)))
		webView.loadUrl(origin)
	}

	/** The bridge's open (SERVERS, the not-answering screen's others, the added page's OPEN →): that server's library. */
	override fun openServer(origin: String) {
		attempts.begin()
		open(origin)
	}

	/** One of the app's own screens, from the bridge (RENAME, ADD A SERVER, the first screen). */
	override fun showAsset(hash: String) {
		attempts.begin()
		loadAsset(hash)
	}

	/**
	 * FORGET's cookies (Forget.kt says how): every cookie the jar sends that
	 * origin, expired, and the jar written out, so the pairing is gone even if
	 * the app is killed next.
	 */
	override fun clearCookies(origin: String) {
		val jar = CookieManager.getInstance()
		for (line in Forget.expiring(jar.getCookie(origin), origin)) jar.setCookie(origin, line)
		jar.flush()
	}

	/**
	 * The list changed: the launcher's shortcuts follow it, one per server,
	 * each the `tsundoku://connect?url=` link the manifest's VIEW filter
	 * takes. A launcher that shows no app shortcuts (an Android TV home screen may not)
	 * simply never draws them; nothing else depends on it.
	 */
	override fun serversChanged() {
		runOnUiThread {
			try {
				val plan = Shortcuts.plan(servers.all(), minOf(Shortcuts.MAX, ShortcutManagerCompat.getMaxShortcutCountPerActivity(this).takeIf { it > 0 } ?: Shortcuts.MAX))
				val list =
					plan.map {
						ShortcutInfoCompat.Builder(this, it.id)
							.setShortLabel(it.label)
							.setLongLabel(it.label)
							.setIcon(IconCompat.createWithResource(this, R.mipmap.ic_launcher))
							.setIntent(Intent(Intent.ACTION_VIEW, Uri.parse(it.link)).setPackage(packageName))
							.build()
					}
				ShortcutManagerCompat.setDynamicShortcuts(this, list)
			} catch (_: Exception) {
				// A launcher that refuses shortcuts costs nothing but the shortcut.
			}
		}
	}

	private fun loadAsset(hash: String = "") {
		// The token is this activity's own: the client serves
		// the host only to a URL carrying it, so a page cannot reach the pair
		// page even where the WebView calls no navigation callback.
		webView.loadUrl(BridgeGuard.ASSET + "?t=" + assetToken + hash)
	}

	private fun showLost(origin: String) {
		loadAsset("#lost=${Uri.encode(origin)}")
	}

	/**
	 * The address this launch was handed, from the extra the documented
	 * command sends or from a `tsundoku://connect?url=` link. The extra wins
	 * when both are there: it is what doc/TV-APP.md tells the user to type,
	 * and a launcher's link is the second way in.
	 */
	private fun givenAddress(intent: Intent?): String? {
		if (intent == null) return null
		val data = intent.data
		return Given.address(intent.getStringExtra(EXTRA_URL), data?.scheme, data?.host) {
			data?.getQueryParameter(EXTRA_URL)
		}
	}

	/**
	 * The one place a given address is judged, however it came in.
	 * [Given.door] says which of the pair page's fragments it opens: one
	 * already in the list is checked and opened, one that is not is asked
	 * about and waits for CONNECT, and a refused one shows the address
	 * screen's band. None of
	 * the three stores anything by itself.
	 */
	private fun takeGiven(raw: String) {
		// This launch's page is the one in hand now: an answer still owed to
		// an earlier launch (the remembered address's probe) does not count.
		attempts.begin()
		loadAsset(Given.door(raw) { servers.find(it) != null }.fragment(Uri::encode))
	}

	/**
	 * The origin of a URL WebView reports. Chromium already lower-cases the
	 * scheme and the host; this does too, so it can never disagree with
	 * Address.originOf, which every stored origin goes through.
	 */
	private fun originOf(url: Uri): String {
		val scheme = url.scheme?.lowercase()
		return "$scheme://${url.host?.lowercase()}${Address.portSuffix(scheme, url.port)}"
	}

	/**
	 * An http(s) page that belongs to a server: the app's own page (served
	 * at [BridgeGuard.ASSET_HOST]) is not one, so it is never counted as a
	 * visit and never shows the not-answering screen.
	 */
	private fun isServerPage(url: Uri): Boolean {
		val scheme = url.scheme?.lowercase()
		if (scheme != "http" && scheme != "https") return false
		// The same reading of the host every refusal of it uses, so a
		// spelling the guards take for the app's host is never a server's.
		return !BridgeGuard.isAssetHost(url.toString())
	}

	/** Any path the app's own host does not serve: 404, never a network request. */
	private fun notFound() =
		WebResourceResponse(
			"text/plain",
			"utf-8",
			404,
			"Not Found",
			mapOf("Cache-Control" to "no-store"),
			ByteArrayInputStream(ByteArray(0))
		)

	private fun hideSystemUi() {
		WindowInsetsControllerCompat(window, window.decorView).apply {
			hide(WindowInsetsCompat.Type.systemBars())
			systemBarsBehavior = WindowInsetsControllerCompat.BEHAVIOR_SHOW_TRANSIENT_BARS_BY_SWIPE
		}
	}

	companion object {
		/** `adb logcat -s TsundokuBack`: why BACK reached the way out. */
		private const val BACK_LOG = "TsundokuBack"

		/** The launch extra, and the deep link's query parameter. */
		private const val EXTRA_URL = "url"

		/**
		 * What the paired page says of the server, if the computer's /pair/tv
		 * is on it: `data-paired-name`, a newline, then the first line's text,
		 * which is all an older server says (Forget.pairedNameFrom reads both).
		 * "" on any other page. No double quote, backslash or dollar sign
		 * inside: tests/tv-pair-origins.e2e.ts reads this literal out of this
		 * file and runs it on the real paired page.
		 */
		private const val PAIRED_JS =
			"(function(){var m=document.querySelector('main.paired');if(!m)return '';var l=m.querySelector('.lab');return (m.getAttribute('data-paired-name')||'')+String.fromCharCode(10)+(l?l.textContent:'')})()"

		/**
		 * The page's background as rgb(), read through a 1x1 canvas: a computed
		 * colour may be oklch() (the light theme's paper), which Insets.parseColor
		 * does not take. The body's, else the root's when the body is clear.
		 */
		private const val SURFACE_JS =
			"(function(){try{var t=function(e){return e?getComputedStyle(e).backgroundColor:''};var c=t(document.body);var x=document.createElement('canvas');x.width=x.height=1;var g=x.getContext('2d');var read=function(v){g.clearRect(0,0,1,1);g.fillStyle='rgba(0,0,0,0)';g.fillStyle=v;g.fillRect(0,0,1,1);return g.getImageData(0,0,1,1).data};var d=read(c);if(d[3]<255){d=read(t(document.documentElement))}return d[3]<255?'':'rgb('+d[0]+', '+d[1]+', '+d[2]+')'}catch(e){return ''}})()"

		/**
		 * The code page's field focused, then the bridge asked for the keyboard,
		 * once the page has hydrated (SvelteKit's announcer is there, or 3 s have gone):
		 * a digit typed before hydration is lost when Svelte takes the field.
		 * Nothing on the paired page, which has no field.
		 */
		private const val CODE_FOCUS_JS =
			"(function(){var t=0;var go=function(){var e=document.querySelector('input[name=code]');if(!e)return;if(!document.getElementById('svelte-announcer')&&t<30){t++;setTimeout(go,100);return}e.focus();if(window.TsundokuTV&&window.TsundokuTV.keyboard)window.TsundokuTV.keyboard()};go()})()"

		/** `window.tsundokuBack`'s contract: true means the page took BACK. */
		private const val BACK_JS =
			"(function(){try{return typeof window.tsundokuBack==='function' ? !!window.tsundokuBack() : false}catch(e){return false}})()"
	}
}

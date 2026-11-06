package dev.masshiro.tsundoku.tv

/**
 * Whose page may make the bridge write (c529), and since c549 read the owner's
 * things (the list, the TV's address, its network): the app's own asset page,
 * or a page of a server this TV already knows. `window.TsundokuTV` is injected into
 * every page and frame the WebView loads, and nothing keeps the WebView on
 * those two, so an external link followed from a server's page would
 * otherwise be able to forget every server and its cookies, or `move()` a
 * known entry to its own origin so that launch opens it.
 *
 * The rule is asked about the WebView's top-level URL, read on the UI thread
 * (`PairingBridge.Host.topUrl`). A frame cannot change that URL; a top-level
 * navigation can, and that is what the rule is about. A frame inside a known
 * server's page is not told apart by it (a JavaScript interface does not say
 * which frame called): tsundoku draws no third-party frames, and the way to
 * close that too is `WebViewCompat.addWebMessageListener` with origin rules
 * ([allowsMessage], below, is the rule such a listener would ask; it is
 * pinned by `MessageGuardTest` and not wired to anything yet).
 * `doc/TV-APP.md`, "What it does not do yet", says what that move still
 * needs; wave 26 stopped short of it.
 *
 * Pure, so BridgeGuardTest and PairingBridgeTest pin it.
 */
object BridgeGuard {
	/** The app's own page (9A, 9B, 9D, S5, S7, S8, S9), whatever its fragment. */
	const val ASSET = "file:///android_asset/pair/index.html"

	/**
	 * The origin `WebViewAssetLoader` serves the pair page from once item 1 of
	 * `doc/TV-APP.md`'s order lands (`https://appassets.androidplatform.net/pair/index.html`).
	 * The move has not happened yet: the page still loads from [ASSET], whose
	 * `file://` origin is opaque, so no message from it can pass
	 * [allowsMessage] until the move.
	 */
	const val ASSET_ORIGIN = "https://appassets.androidplatform.net"

	fun allows(url: String?, known: (String) -> Boolean): Boolean {
		val u = url?.trim().orEmpty()
		if (u == ASSET || u.startsWith("$ASSET#") || u.startsWith("$ASSET?")) return true
		if (!u.startsWith("http://") && !u.startsWith("https://")) return false
		val origin = Address.originOf(u) ?: return false
		return known(origin)
	}

	/**
	 * What a message listener asks, one message at a time (c549 part (b); not
	 * wired to anything yet). A JavaScript interface cannot say which frame
	 * called it, so a third-party iframe inside a known server's page reaches
	 * every call today. `WebViewCompat.addWebMessageListener` hands its callback
	 * the message's `sourceOrigin` — the calling frame's **origin** (scheme,
	 * host and port; never a path, query or fragment) — and `isMainFrame`, and
	 * this is the decision to make with them: only a **main** frame may reach
	 * the bridge, and only from the app's own page or a server this TV knows.
	 *
	 * Trust is by origin, not by URL, so this must not delegate to [allows]: a
	 * message never carries the asset URL. A main frame is trusted when its
	 * origin is exactly [ASSET_ORIGIN], or when it is an origin this TV knows.
	 * "An origin" is strict: it parses with an http or https scheme, has a
	 * host, and carries no userinfo, path, query or fragment, so `http://host/`
	 * and `http://host/series/12` are refused as well as `http://host?x=1`.
	 * Everything else is refused: the opaque `"null"` (a `file://` page's
	 * report), an absent origin, `""`, `about:`, `data:`, `javascript:`, and
	 * [ASSET] itself. That is why the asset page has to move to
	 * `WebViewAssetLoader` before this rule can be wired to a listener.
	 *
	 * A known server is compared through [Address.originOf], as the top-level
	 * guard's is, and [Address.originOf] lower-cases the scheme and the host
	 * (c548): a message whose origin kept the host's capitals is the same
	 * server, and so is one whose scheme is capitalised. Its http/https twin or
	 * another port is not.
	 */
	fun allowsMessage(sourceOrigin: String?, isMainFrame: Boolean, known: (String) -> Boolean): Boolean {
		if (!isMainFrame) return false
		val at = sourceOrigin?.trim().orEmpty()
		if (at == ASSET_ORIGIN) return true
		if (!isOrigin(at)) return false
		return known(Address.originOf(at) ?: return false)
	}

	/** True when [at] is exactly an origin: scheme, host and port, nothing else. */
	private fun isOrigin(at: String): Boolean {
		val url = runCatching { java.net.URI(at) }.getOrNull() ?: return false
		val scheme = url.scheme?.lowercase() ?: return false
		if (scheme != "http" && scheme != "https") return false
		if (url.host.isNullOrEmpty()) return false
		if (url.rawUserInfo != null) return false
		if (!url.rawPath.isNullOrEmpty()) return false
		return url.rawQuery == null && url.rawFragment == null
	}
}

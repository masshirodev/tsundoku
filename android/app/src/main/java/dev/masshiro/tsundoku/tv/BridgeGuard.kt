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

	fun allows(url: String?, known: (String) -> Boolean): Boolean {
		val u = url?.trim().orEmpty()
		if (u == ASSET || u.startsWith("$ASSET#") || u.startsWith("$ASSET?")) return true
		if (!u.startsWith("http://") && !u.startsWith("https://")) return false
		val origin = Address.originOf(u) ?: return false
		return known(origin)
	}

	/**
	 * What a message listener would ask, one message at a time (c549 part (b);
	 * not wired to anything yet). A JavaScript interface cannot say which frame
	 * called it, so a third-party iframe inside a known server's page reaches
	 * every call today. `WebViewCompat.addWebMessageListener` hands its callback
	 * the message's `sourceOrigin` and `isMainFrame`, and this is the decision
	 * to make with them: only a **main** frame may reach the bridge, and only
	 * from the app's own page or a server this TV knows.
	 *
	 * The origin a `file:///android_asset` page reports is not defined by the
	 * reference (doc/TV-APP.md, "What it does not do yet"), so [allows] is what
	 * answers it too: a page reporting the asset's URL is trusted, and one
	 * reporting the opaque `"null"` is not. That is why the asset page has to
	 * move to `WebViewAssetLoader` before this rule can be wired to a listener.
	 *
	 * A known server's origin is compared through [Address.originOf], as the
	 * top-level guard's is: a message whose origin kept the host's case is the
	 * same server (c548), and its http/https twin or another port is not.
	 */
	fun allowsMessage(sourceOrigin: String?, isMainFrame: Boolean, known: (String) -> Boolean): Boolean {
		if (!isMainFrame) return false
		return allows(sourceOrigin, known)
	}
}

package dev.masshiro.tsundoku.tv

import java.net.URI

/**
 * Where BACK goes once the page has said it has nothing left to take
 * (`window.tsundokuBack()` false; doc/TV-APP.md, "BACK").
 *
 * Plain `goBack()` was the first answer, and on the first real TV (2026-11-02)
 * it never let the app close: the history still held the sign-in page, which
 * sends a signed-in visitor straight back to the library, and the library's
 * shelf tabs each leave an entry of their own. So:
 *
 * - the library (`/`, any shelf or sort) is the app's home: BACK leaves;
 * - anywhere else BACK goes to the nearest earlier screen that is one, past
 *   the sign-in, pairing and set-up pages and the app's own first screens;
 * - with none, BACK leaves.
 *
 * Pure, so `BackTest` pins it without an Android runtime.
 */
object Back {
	/** How many steps back to go, or null to leave the app. `history` is oldest first, up to the current entry. */
	fun steps(current: String, history: List<String>): Int? {
		if (isHome(current)) return null
		for (i in history.indices.reversed()) {
			if (!passedOver(history[i])) return history.size - i
		}
		return null
	}

	private fun pathOf(url: String): String? =
		try {
			val uri = URI(url)
			if (uri.scheme != "http" && uri.scheme != "https") null else uri.path.orEmpty()
		} catch (_: Exception) {
			null
		}

	fun isHome(url: String): Boolean {
		val path = pathOf(url) ?: return false
		return path == "" || path == "/"
	}

	/** A page nobody goes back to: it signs in, pairs, sets up, or is the app's own. */
	fun passedOver(url: String): Boolean {
		// The app's own page, served from WebViewAssetLoader since c549: its
		// https path would otherwise read as an ordinary page of a computer.
		if (BridgeGuard.isAsset(url)) return true
		val path = pathOf(url) ?: return true
		return path == "/login" ||
			path == "/setup" ||
			path == "/welcome" ||
			path.startsWith("/pair/") ||
			path == "/pair"
	}
}

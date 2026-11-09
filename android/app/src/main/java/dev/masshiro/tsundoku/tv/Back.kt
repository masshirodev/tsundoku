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
 * - the library (`/`, any shelf or sort) is the app's home: BACK leaves, on
 *   the second press (LeaveWindow.kt, c859: the first says so in a toast);
 * - anywhere else BACK goes to the nearest earlier screen that is one, past
 *   the sign-in, pairing and set-up pages and the app's own first screens;
 * - with none, BACK leaves, on the second press too.
 *
 * Pure, so `BackTest` pins it without an Android runtime.
 */
object Back {
	/** How many steps back to go, or null when BACK can only head for the way out. `history` is oldest first, up to the current entry. */
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

	/**
	 * One line for the log saying why BACK headed for the way out (c859, the
	 * half of the card that finds the bug still under it). `current` is the
	 * history's own idea of where we are and `shown` is the WebView's; the two
	 * disagreeing is one of the suspects.
	 */
	fun leaveLine(
		steps: Int?,
		canGoBack: Boolean,
		current: String,
		shown: String?,
		index: Int,
		size: Int,
		held: Boolean,
		verdict: LeaveWindow.Verdict
	): String =
		"leave: $verdict steps=$steps canGoBack=$canGoBack current=${forLog(current)} " +
			"shown=${shown?.let(::forLog)} index=$index size=$size held=$held"

	/**
	 * [url] as it may reach the log: no query and no fragment, because a pair
	 * token, the asset page's `?t=` and `#connect=` live there; no userinfo;
	 * and no `/pair/<code>` path, which is a pairing code in the path instead.
	 */
	fun forLog(url: String): String {
		val cut = url.substringBefore('#').substringBefore('?')
		val head = cut.indexOf("://")
		if (head < 0) return cut
		val after = head + 3
		val slash = cut.indexOf('/', after).let { if (it < 0) cut.length else it }
		val authority = cut.substring(after, slash).substringAfterLast('@')
		val path = cut.substring(slash)
		val shown = if (path == "/pair" || path.startsWith("/pair/")) "/pair/…" else path
		return cut.substring(0, after) + authority + shown
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

package dev.masshiro.tsundoku.tv

/**
 * Which server's main-frame load just failed, so that its `onPageFinished`
 * does not make it the one in use (c261, wave 21's round 2; c532).
 *
 * WebView calls `onPageFinished` for a URL whose load failed too, after
 * `onReceivedError`. Counted as a visit, a server opened from SERVERS that
 * does not answer would become the last used, and the next launch would try
 * the dead one first.
 *
 * The mark is ended by the failed load's own finish, which it consumes, and by
 * nothing else (c532). Wave 21 ended it at the next `onPageStarted` for that
 * origin, which held only if WebView reports started, error, finished in that
 * order: a committed error page reported as error, started, finished lost the
 * mark before the finish read it. Keyed on the finish, every order a failed
 * load can take skips exactly one finish, and a retry's own finish counts.
 *
 * The cost of the other choice: a failed load that never finishes (WebView
 * moved straight on to 9D's asset) leaves its mark, and the next load of that
 * server that does finish is not counted as a visit; the one after it is.
 * Missing one visit is harmless (launch opens the last used one, and that is
 * still the server last counted); counting a dead one sends launch to it.
 *
 * Pure, so FailedLoadTest pins it; which orders WebView takes on a TV is a
 * device claim (doc/TV-APP.md, "What is not verified").
 */
class FailedLoad {
	private var failed: String? = null

	/**
	 * A main-frame load for [origin] started. It ends nothing (c532): WebView
	 * may report a committed error page's start after its error. Kept, and
	 * called, so the order each test drives is the order WebView reports.
	 */
	@Suppress("UNUSED_PARAMETER")
	fun started(origin: String) {}

	fun failed(origin: String) {
		failed = origin
	}

	/**
	 * True when this finish is a page that loaded, and may count as a visit.
	 * The failed load's own finish is false, once: it consumes the mark.
	 */
	fun finished(origin: String): Boolean {
		if (origin != failed) return true
		failed = null
		return false
	}
}

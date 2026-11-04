package dev.masshiro.tsundoku.tv

/**
 * Which server's main-frame load just failed, so that its `onPageFinished`
 * does not make it the one in use (c261, wave 21's round 2).
 *
 * WebView calls `onPageFinished` for a URL whose load failed too, after
 * `onReceivedError`. Counted as a visit, a server opened from SERVERS that
 * does not answer would become the last used, and the next launch would try
 * the dead one first. The order of a failed load is started, error, finished,
 * and a later attempt at the same server starts again, so a start for that
 * origin is what ends the skip. Pure, so FailedLoadTest pins it; that WebView
 * keeps this order on a TV is a device claim (doc/TV-APP.md, "What is not
 * verified").
 */
class FailedLoad {
	private var failed: String? = null

	/** A main-frame load for [origin] started: a new attempt, not the failed one. */
	fun started(origin: String) {
		if (origin == failed) failed = null
	}

	fun failed(origin: String) {
		failed = origin
	}

	/** True when this finish is a page that loaded, and may count as a visit. */
	fun finished(origin: String): Boolean = origin != failed
}

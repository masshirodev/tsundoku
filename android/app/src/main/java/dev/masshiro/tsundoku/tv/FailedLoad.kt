package dev.masshiro.tsundoku.tv

/**
 * Which server's main-frame load just failed, so that its `onPageFinished`
 * does not make it the one in use.
 *
 * WebView calls `onPageFinished` for a URL whose load failed too, after
 * `onReceivedError`. Counted as a visit, a server opened from SERVERS that
 * does not answer would become the last used, and the next launch would try
 * the dead one first.
 *
 * The mark is ended two ways. The failed load's own finish consumes it, so
 * every order WebView can report a failed load in (started, error, finished; or
 * a committed error page's error, started, finished) skips exactly one finish.
 * And the app's next attempt at that origin ends it ([attempt], called by
 * `MainActivity.open` before `loadUrl`: launch, SERVERS and the not-answering
 * screen's TRY AGAIN all go through it), because a failed load need not finish
 * at all: `onReceivedError` shows the not-answering screen at once, and WebView
 * may move straight on to the asset without a finish for the failed URL.
 * Ending the mark at the next `onPageStarted` would end it too early, since a
 * committed error page's start comes before its finish; ending it only at the
 * finish would let a mark with no finish swallow the retry's own visit. An
 * attempt is ordered after the failure by the app itself, so neither happens.
 *
 * What is left: a navigation the app did not start (a link inside a server's
 * page, its own `location` change) is not an attempt. If such a load fails
 * without a finish and the next load of that origin is again one the app did
 * not start, that load's visit is not counted; the next `open` of it is.
 * Missing that one visit leaves the server in use as it was; counting a dead
 * one would send launch to it.
 *
 * Pure, so FailedLoadTest pins it; which orders WebView takes on a TV is a
 * device claim (doc/ANDROID.md, "Device checks").
 */
class FailedLoad {
	private var failed: String? = null

	/**
	 * A main-frame load for [origin] started. It ends nothing: WebView
	 * may report a committed error page's start after its error. Kept, and
	 * called, so the order each test drives is the order WebView reports.
	 */
	@Suppress("UNUSED_PARAMETER")
	fun started(origin: String) {}

	/**
	 * The app is about to load [origin] itself (`MainActivity.open`). Any mark
	 * for it belongs to an earlier load, finished or not, so it ends here.
	 */
	fun attempt(origin: String) {
		if (origin == failed) failed = null
	}

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

	/** What a finished http(s) page of [origin] is to the app. */
	enum class Finish {
		/** Not counted: a failed load's finish, or a server this TV does not know. */
		SKIP,

		/** The computer's /pair/tv, loaded: read what the paired page says (`PAIRED_JS`). */
		PAIRED_PAGE,

		/** A server's page that loaded: it may become the one in use. */
		VISIT,
	}

	/**
	 * `onPageFinished`'s decision, pure so FailedLoadTest drives it. The mark
	 * is read before the path is, so a failed `/pair/tv` load consumes its own
	 * mark like any other page's and the library load after it counts.
	 */
	fun finish(origin: String, path: String?, known: Boolean): Finish {
		val loaded = finished(origin)
		if (!known || !loaded) return Finish.SKIP
		return if (path == "/pair/tv") Finish.PAIRED_PAGE else Finish.VISIT
	}
}

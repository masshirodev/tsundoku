package dev.masshiro.tsundoku.tv

/**
 * The second press BACK has to make before it leaves the app (doc/TV-APP.md,
 * "BACK"). A BACK meant as a step would otherwise leave the app, so the press
 * that would leave only says so; the next one, while the window is open,
 * leaves.
 *
 * The times are arguments, on `SystemClock.uptimeMillis()`'s clock, because
 * they are taken when the thing happened, not when the activity got round to
 * deciding: the page answers `tsundokuBack` asynchronously, so a key or a page
 * change can already have come in behind the press being decided. So an end
 * that happened after a press still counts against it, whichever arrived
 * first.
 *
 * Which Android callback reaches each method is MainActivity's business, and
 * the part a JVM test cannot see: BACK's press through `OnBackPressedCallback`, another
 * key through `dispatchKeyEvent`, a page change through
 * `doUpdateVisitedHistory`, which is the one SvelteKit's client navigation
 * reaches (`onPageFinished` never does).
 *
 * Pure, so `LeaveWindowTest` pins it without an Android runtime.
 */
class LeaveWindow(
	private val lasts: Long = LASTS_MS,
	private val doubled: Long = DOUBLED_MS
) {
	enum class Verdict {
		/** The first press: say a second one leaves, and open the window. */
		TOAST,

		/** A real second press inside the window. */
		LEAVE,

		/** Not a press that counts: doubled, held, or overtaken by something else. */
		NOTHING,
	}

	private var armed: Long? = null

	/** The latest end of the window that has come in: a key, a page change, a step. */
	private var ended = Long.MIN_VALUE

	private var page: String? = null

	/** The press that opened a window still running at [at], if there is one. */
	private fun open(at: Long): Long? = armed?.takeIf { it > ended && at - it < lasts }

	/**
	 * A BACK the page did not take and history cannot step, at [at].
	 *
	 * [held] is a press whose key repeated while it was down: holding BACK
	 * must never be what leaves, so it opens a window but can not close one.
	 */
	fun press(at: Long, held: Boolean = false): Verdict {
		// Something else happened after this press, while the page was
		// answering for it: the user has moved on.
		if (at <= ended) return Verdict.NOTHING
		val since = open(at)
		if (since == null) {
			armed = at
			return Verdict.TOAST
		}
		// One press delivered twice is the accident this window is for, so a
		// BACK this soon after the one that opened the window is that press.
		if (held || at - since <= doubled) return Verdict.NOTHING
		armed = null
		return Verdict.LEAVE
	}

	/**
	 * The window ends here: another key, or a BACK that went elsewhere. True
	 * when this closed one, so the activity can take its toast down. An end
	 * older than the press that opened the window (a page's late answer)
	 * closes nothing, and neither does one past the window's own time: its
	 * toast went by itself.
	 */
	fun end(at: Long): Boolean {
		val window = open(at)
		ended = maxOf(ended, at)
		return window != null && window <= at
	}

	/**
	 * The WebView's URL became [url]. `doUpdateVisitedHistory` also fires for a
	 * page that writes its own URL back unchanged (`replaceState`), which is no
	 * page change, so only a different URL ends the window.
	 */
	fun navigated(url: String, at: Long): Boolean {
		val before = page
		page = url
		if (before == null || before == url) return false
		return end(at)
	}

	companion object {
		/** A Toast's LENGTH_SHORT, so the window closes as its words go. */
		const val LASTS_MS = 2000L

		/**
		 * How soon after the first press a second one is still that first
		 * press (doc/TV-APP.md). An IR remote repeats its
		 * frame about every 108 ms, so a doubled press is under ~220 ms; a
		 * second press made after reading the toast takes far longer than
		 * 400 ms. A deliberate fast double tap inside it costs one more press.
		 */
		const val DOUBLED_MS = 400L
	}
}

package dev.masshiro.tsundoku.tv

/**
 * "Only the current attempt's answer counts" (c306), the activity's half of
 * the rule the pairing page already keeps for its own probes.
 *
 * Two doors put a page in the WebView at launch: `onCreate`'s probe of the
 * remembered address, whose answer arrives up to six seconds later (Probe.kt's
 * connect and read timeouts, longer when a `.ts.net` name stalls), and
 * `onNewIntent` → `takeGiven`, which loads 9B at once. Each door [begin]s an
 * attempt; an answer that arrives for an attempt that is no longer [current]
 * is dropped, so a given address handed in during the probe is not replaced
 * by the library or by 9D naming the remembered one.
 *
 * Main thread only: both doors and every answer run there (the probe's answer
 * is posted back to the UI handler before it is judged).
 */
class Attempts {
	private var latest = 0

	/** A door opened: every answer for an earlier attempt is now stale. */
	fun begin(): Int = ++latest

	/** Whether [attempt] is still the one in hand. */
	fun current(attempt: Int): Boolean = attempt == latest

	/**
	 * An answer for [attempt] arrived: [act] on it only if no door has opened
	 * since. Answers whether it acted, so the caller and the tests can tell.
	 */
	inline fun answer(attempt: Int, act: () -> Unit): Boolean {
		if (!current(attempt)) return false
		act()
		return true
	}
}

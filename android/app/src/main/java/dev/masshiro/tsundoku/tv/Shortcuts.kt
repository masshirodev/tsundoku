package dev.masshiro.tsundoku.tv

import java.net.URLEncoder

/**
 * A launcher shortcut per remembered server (c287; doc/ANDROID.md, "Launcher
 * shortcuts"). Each is the `tsundoku://connect?url=` link c260's `VIEW` filter
 * already takes, so a shortcut opens exactly the door an `am start` does, and
 * the app needs no new way in.
 *
 * Dynamic, not a static `res/xml/shortcuts.xml`: a static shortcut is fixed
 * at build time and cannot carry the address a TV paired with, which is the
 * only thing this one is for. The plan is pure so `ShortcutsTest` pins it; the
 * activity hands it to `ShortcutManagerCompat` (androidx.core, already a
 * dependency).
 */
object Shortcuts {
	data class Shortcut(val id: String, val label: String, val link: String)

	/** Android's own guidance is four; a launcher may show fewer. */
	const val MAX = 4

	/** A short label is what a launcher shows; 25 characters is the guidance for it. */
	const val SHORT_LABEL = 25

	/** The link a shortcut fires: c260's deep link, the origin encoded whole. */
	fun linkFor(origin: String): String = "tsundoku://connect?url=" + URLEncoder.encode(origin, "UTF-8").replace("+", "%20")

	/**
	 * One shortcut per server, the last used first, up to [max]. The id is the
	 * origin, so a renamed server updates its shortcut rather than adding one.
	 */
	fun plan(servers: List<Servers.Server>, max: Int = MAX): List<Shortcut> =
		servers.take(max.coerceAtLeast(0)).map {
			Shortcut(id = it.origin, label = it.shown.take(SHORT_LABEL), link = linkFor(it.origin))
		}
}

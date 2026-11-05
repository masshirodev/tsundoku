package dev.masshiro.tsundoku.tv

/**
 * How far the page sits in from each edge on a phone or tablet (c521;
 * doc/PHONE-APP.md, "The camera band and the keyboard").
 *
 * The app targets SDK 36, so on Android 15 and later it is drawn edge to edge
 * whatever it asks, and the system bars are hidden besides (fullscreen, as the
 * design draws it). Left alone, the page would start under the camera cutout,
 * and the keyboard would cover the button the design pins to its top edge,
 * because edge to edge no longer shrinks the window for the keyboard
 * (`adjustResize` stops doing it once the app draws behind the system bars).
 *
 * So the activity pads the WebView itself, by what this returns, and fills the
 * padding with the page's own background colour. It is done natively rather
 * than with CSS `env(safe-area-inset-*)` because a WebView reports those only
 * on newer versions, and the web app never read the top one at all: an
 * installed PWA had Chrome keep it out of the cutout.
 *
 * - **The cutout**, on whichever side it is: the top in portrait, a side when
 *   a phone or tablet is turned. Always, keyboard or not.
 * - **The keyboard**, at the bottom while it is open: the page ends on its top
 *   edge, so NEXT → rides it (PhoneApp-Board-Phone.dc.html, 9B).
 * - **The home gesture**, at the bottom while the keyboard is closed: the
 *   design's 16 px above the gesture bar, so a pinned button is not in the
 *   strip a swipe up takes. With the bars hidden this is what remains of the
 *   navigation bar; on three-button navigation it is 0, and nothing is lost.
 *
 * Pure, so InsetsTest pins every combination without a device. The numbers are
 * physical pixels, as `WindowInsetsCompat` gives them.
 */
object Insets {
	data class Sides(val left: Int = 0, val top: Int = 0, val right: Int = 0, val bottom: Int = 0)

	/**
	 * The padding for the page: the cutout on every side, and at the bottom
	 * the larger of the cutout and either the open keyboard or, closed, the
	 * home gesture's strip. Negative input (never sent, but a broken OEM build
	 * could) counts as 0.
	 *
	 * `edge` is a page that asked to be drawn edge to edge (the bridge's
	 * `edge(true)`: the reader's manga and manhwa pages, c521): no cutout and
	 * no gesture strip, the picture runs under the camera. The keyboard still
	 * pads, should one open there; the page keeps its bars out of the band
	 * itself, from the sizes `css` hands it.
	 */
	fun padding(cutout: Sides, ime: Sides, gestures: Sides, edge: Boolean = false): Sides {
		val keyboard = ime.bottom.coerceAtLeast(0)
		if (edge) return Sides(bottom = keyboard)
		val under = if (keyboard > 0) keyboard else gestures.bottom.coerceAtLeast(0)
		return Sides(
			left = cutout.left.coerceAtLeast(0),
			top = cutout.top.coerceAtLeast(0),
			right = cutout.right.coerceAtLeast(0),
			bottom = maxOf(cutout.bottom.coerceAtLeast(0), under)
		)
	}

	/**
	 * What the page is told of the edges, in CSS px: the cutout, and at the
	 * bottom the larger of it and the gesture strip, whether or not the app
	 * pads them. A page drawn edge to edge keeps its own bars out of the band
	 * with these (`--app-inset-top` and the rest), since a WebView reports
	 * `env(safe-area-inset-*)` only on newer versions. `density` is the
	 * display's (physical px per CSS px); 0 or less gives all zeros.
	 */
	fun css(cutout: Sides, gestures: Sides, density: Float): Sides {
		if (density <= 0f || density.isNaN()) return Sides()
		fun dp(px: Int) = Math.round(px.coerceAtLeast(0) / density)
		return Sides(
			left = dp(cutout.left),
			top = dp(cutout.top),
			right = dp(cutout.right),
			bottom = dp(maxOf(cutout.bottom, gestures.bottom))
		)
	}

	/** The script that sets the four variables on the page's root. */
	fun cssScript(s: Sides): String =
		"(function(){var r=document.documentElement.style;" +
			"r.setProperty('--app-inset-top','${s.top}px');" +
			"r.setProperty('--app-inset-right','${s.right}px');" +
			"r.setProperty('--app-inset-bottom','${s.bottom}px');" +
			"r.setProperty('--app-inset-left','${s.left}px')})()"

	/**
	 * The page's background as the bridge hands it over: `rgb(14, 15, 16)` or
	 * `rgba(…)` from `getComputedStyle`, or `#0e0f10`. Answers an ARGB int, or
	 * null for anything else, so a page can never paint the band with garbage.
	 * A transparent colour is null too: the band would show the black behind.
	 */
	fun parseColor(css: String?): Int? {
		val s = css?.trim()?.lowercase() ?: return null
		HEX.matchEntire(s)?.let { m ->
			val h = m.groupValues[1]
			val full = if (h.length == 3) h.map { "$it$it" }.joinToString("") else h
			return (0xFF shl 24) or full.toInt(16)
		}
		val m = RGB.matchEntire(s) ?: return null
		val (r, g, b) = m.groupValues.subList(1, 4).map { it.toInt() }
		if (r > 255 || g > 255 || b > 255) return null
		val alpha = m.groupValues[4]
		if (alpha.isNotEmpty() && (alpha.toFloatOrNull() ?: return null) < 1f) return null
		return (0xFF shl 24) or (r shl 16) or (g shl 8) or b
	}

	private val HEX = Regex("^#([0-9a-f]{3}|[0-9a-f]{6})$")
	private val RGB = Regex("^rgba?\\(\\s*(\\d{1,3})\\s*,\\s*(\\d{1,3})\\s*,\\s*(\\d{1,3})\\s*(?:,\\s*([0-9.]+)\\s*)?\\)$")
}

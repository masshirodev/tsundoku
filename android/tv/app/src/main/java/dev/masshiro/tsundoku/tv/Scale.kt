package dev.masshiro.tsundoku.tv

/**
 * The page's scale (c236; doc/TV.md, "Claims to check").
 *
 * The handoff is drawn in a 960x540 CSS-pixel frame. A TV reports 1280x720 at
 * density 1.5 (853 dp) or 1920x1080 at density 2 (960 dp), and the WebView
 * would lay the page out at whatever width it is given, so the 1024px/1280px
 * media queries would fire on one TV and not another. `useWideViewPort=false`
 * plus `setInitialScale` pins the CSS viewport to 960 whatever the panel:
 * a narrower layout is zoomed out (89%), a wider one in (200%).
 *
 * Pure, so the scale is tested without a device.
 */
object Scale {
	/** The handoff's width in CSS px. */
	const val FRAME_WIDTH = 960

	/**
	 * WebView's initial scale, in percent: layout width / 960, rounded. 0 (an
	 * unknown display) means "leave it alone", which is 100.
	 */
	fun percentFor(widthDp: Float): Int {
		if (widthDp <= 0f) return 100
		val percent = Math.round(widthDp * 100f / FRAME_WIDTH)
		// WebView takes 1..10000; a quarter and four times are already absurd.
		return percent.coerceIn(25, 400)
	}
}

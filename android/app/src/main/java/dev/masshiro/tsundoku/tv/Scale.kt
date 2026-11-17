package dev.masshiro.tsundoku.tv

/**
 * The page's scale (doc/TV.md, "Claims to check").
 *
 * The design is drawn in a 960x540 CSS-pixel frame. The WebView lays the page
 * out at whatever width it is given, so the 1024px/1280px media queries would
 * fire on one TV and not another. `useWideViewPort=false` plus
 * `setInitialScale` pins the CSS viewport to 960 whatever the panel.
 *
 * `setInitialScale` counts in **physical pixels**, not dp: Chromium's
 * `AwSettings::UpdateInitialPageScaleLocked` (android_webview/browser/
 * aw_settings.cc) hands Blink `percent / dipScale / 100` as the page scale,
 * so 100 means one CSS px per physical px. The percent is therefore the
 * panel's width in pixels over 960: a 1920-pixel panel takes 200 at any
 * density, and lands on 960 CSS px. (Computing it from dp instead gives 100 on
 * a 1080p TV at density 2, which is a page scale of 0.5: a 1920 CSS px layout.)
 *
 * Pure, so the scale is tested without a device.
 */
object Scale {
	/** The design's width in CSS px. */
	const val FRAME_WIDTH = 960

	/**
	 * WebView's initial scale, in percent: physical width / 960, rounded. An
	 * unknown display (0 or less) means "leave it alone": 0, WebView's default.
	 */
	fun percentFor(widthPx: Int): Int {
		if (widthPx <= 0) return 0
		val percent = Math.round(widthPx * 100f / FRAME_WIDTH)
		// WebView takes 1..10000; a quarter and four times are already absurd.
		return percent.coerceIn(25, 400)
	}

	/** The CSS width a percent gives a panel: what the test checks against 960. */
	fun cssWidth(widthPx: Int, percent: Int): Float = widthPx / (percent / 100f)
}

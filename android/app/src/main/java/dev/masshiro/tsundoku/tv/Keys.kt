package dev.masshiro.tsundoku.tv

/**
 * The remote's keys, as DOM keys the page's focus layer understands
 * (doc/TV.md, "The remote").
 *
 * The D-pad and OK reach the WebView as arrows and Enter by themselves, so
 * they are not here. MENU and the media keys do not: the WebView consumes them
 * (media transport is the framework's, and MENU is the app's menu key), so the
 * activity takes them in `dispatchKeyEvent` and sends a synthetic keydown /
 * keyup pair at `document.activeElement ?? document.body`, bubbling, which is
 * what `src/lib/focus/layer.ts` watches for.
 *
 * The key codes are `android.view.KeyEvent`'s own values, named here so this
 * file (and its test) needs no Android runtime. They are fixed API constants.
 */
object Keys {
	private const val KEYCODE_MENU = 82
	private const val KEYCODE_MEDIA_PLAY_PAUSE = 85
	private const val KEYCODE_MEDIA_PLAY = 126
	private const val KEYCODE_MEDIA_PAUSE = 127
	private const val KEYCODE_MEDIA_FAST_FORWARD = 90
	private const val KEYCODE_MEDIA_REWIND = 89
	private const val KEYCODE_MEDIA_NEXT = 87
	private const val KEYCODE_MEDIA_PREVIOUS = 88

	/** The DOM `key` for an Android key code, or null when the WebView should have it. */
	fun domKeyFor(keyCode: Int): String? =
		when (keyCode) {
			KEYCODE_MENU -> "ContextMenu"
			KEYCODE_MEDIA_PLAY_PAUSE -> "MediaPlayPause"
			KEYCODE_MEDIA_PLAY -> "MediaPlay"
			KEYCODE_MEDIA_PAUSE -> "MediaPause"
			KEYCODE_MEDIA_FAST_FORWARD -> "MediaFastForward"
			KEYCODE_MEDIA_REWIND -> "MediaRewind"
			KEYCODE_MEDIA_NEXT -> "MediaTrackNext"
			KEYCODE_MEDIA_PREVIOUS -> "MediaTrackPrevious"
			else -> null
		}

	/**
	 * The script that delivers one key to the page. Cheap enough for a key
	 * press, and it never throws: an element without a parent still gets the
	 * event, and the page's capture listener is on `window`.
	 */
	fun dispatchScript(key: String, down: Boolean): String {
		val type = if (down) "keydown" else "keyup"
		val quoted = key.replace("\\", "\\\\").replace("'", "\\'")
		return (
			"(function(){var e=document.activeElement||document.body;" +
				"e.dispatchEvent(new KeyboardEvent('$type',{key:'$quoted',bubbles:true}));})();"
			)
	}
}

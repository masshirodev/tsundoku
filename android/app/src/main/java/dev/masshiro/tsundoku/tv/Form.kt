package dev.masshiro.tsundoku.tv

/**
 * Which app this build is: the TV's, or the phone and tablet one (c521;
 * doc/PHONE-APP.md). One Gradle project builds both, as two product flavors
 * sharing every line of pairing (`tv`, `mobile`); what differs between them is
 * decided here, from `BuildConfig.FORM`, so each difference is one tested
 * function rather than a branch buried in the activity.
 *
 * | Decision        | TV                                   | Phone and tablet                         |
 * | --------------- | ------------------------------------ | ---------------------------------------- |
 * | The page width  | pinned to 960 CSS px (Scale.kt)      | the page's own `width=device-width`      |
 * | Text size       | 100%, whatever the TV says           | Android's font size, capped at 130%      |
 * | User agent      | `TsundokuTV/<version>`               | `TsundokuApp/<version>`                  |
 * | Remote keys     | MENU and the media keys (Keys.kt)    | none: a finger and the keyboard          |
 * | The cutout      | none to pad                          | padded natively (Insets.kt)              |
 * | The keyboard    | never raised by a page (c247)        | raised when a page focuses a field       |
 * | A picture full  | never: the TV is landscape           | turned to landscape by the app           |
 * | screen          | already                              | (screen.orientation.lock is refused)     |
 *
 * The bridge keeps the TV's name, `TsundokuTV`, on both: it is the contract
 * the web app already reads (MoreSheet's SERVERS, the layout's name), so the
 * phone gets c261's server list without a second bridge to keep in step.
 */
enum class Form(val id: String) {
	TV("tv"),
	MOBILE("mobile");

	/** The page width is pinned to the handoff's 960 only on a TV. */
	val pinsWidth: Boolean
		get() = this == TV

	/** The remote's MENU and media keys are taken before the WebView only on a TV. */
	val takesRemoteKeys: Boolean
		get() = this == TV

	/**
	 * A page that focuses a field on arrival asks the app to raise the
	 * keyboard (the bridge's `keyboard()`): Android's WebView does not raise it
	 * for focus a script gives without a tap. Never on a TV, whose pad covers
	 * the buttons (c247).
	 */
	val raisesKeyboard: Boolean
		get() = this == MOBILE

	/** A TV has no cutout and no keyboard pushing the page; a phone has both. */
	val padsInsets: Boolean
		get() = this == MOBILE

	/**
	 * A fullscreen picture turns the phone to landscape. A WebView refuses
	 * `screen.orientation.lock` (NotSupportedError, "not available on this
	 * device"), so the activity turns the window itself (MainActivity,
	 * turnForVideo); a TV is landscape already and never turns.
	 */
	val turnsForVideo: Boolean
		get() = this == MOBILE

	/**
	 * The token appended to the WebView's own user agent. The server reads it
	 * (`isTsundokuApp`, src/lib/settings/catalog.ts): `TsundokuTV` names a
	 * device a TV, `TsundokuApp` says the app over a phone's or tablet's screen.
	 */
	fun userAgentToken(version: String): String =
		when (this) {
			TV -> "TsundokuTV/$version"
			MOBILE -> "TsundokuApp/$version"
		}

	/**
	 * WebView's `textZoom`, in percent. A TV is read from the sofa at the
	 * design's own sizes, so it stays 100. A phone follows Android's font size,
	 * since a bigger font is the reader's own choice, but only up to 130%: the
	 * web app's 60 px bars and clamped tile titles are fixed and clip past
	 * that (PhoneApp-Calls.dc.html, question 2). A smaller font is honoured as
	 * it is. An unknown scale (0 or less) is 100.
	 */
	fun textZoom(fontScale: Float): Int {
		if (this == TV) return 100
		if (fontScale <= 0f || fontScale.isNaN()) return 100
		return Math.round(fontScale * 100f).coerceAtMost(MAX_TEXT_ZOOM)
	}

	companion object {
		/** The most a phone's text grows (question 2 of the design). */
		const val MAX_TEXT_ZOOM = 130

		/** The flavor's `BuildConfig.FORM`; anything unknown is the TV, as every build was before c521. */
		fun of(id: String?): Form = entries.firstOrNull { it.id == id } ?: TV
	}
}

package dev.masshiro.tsundoku.tv

/**
 * What the app does with an address handed to it from outside (c260, c683;
 * doc/ANDROID.md, "An address from outside is asked about"): whichever of the
 * pair page's doors it goes through.
 *
 * The activity is exported and its `tsundoku://connect` filter is BROWSABLE,
 * so nothing about an intent says who sent it. A link tapped in a browser, an
 * `intent:` link whose `S.url=` becomes the extra, another app, the documented
 * `am start` and the app's own launcher shortcut can each arrive with the same
 * action, data, extra and package: a shortcut's `setPackage` is one any caller
 * can set too, and Android reports no sender for a plain `startActivity`.
 *
 * So the rule asks the one thing that does differ. An address **already in
 * the list** stores nothing when it opens, so it goes straight through; that
 * is every live shortcut, since a shortcut is only ever made from the list.
 * One that is **not** in the list is asked about: nothing is probed or
 * remembered until the owner presses CONNECT on the pair page. What the owner
 * types on 9B never comes through here at all.
 *
 * Pure, so `GivenTest` pins it: `android.net.Uri` and `Intent` are not there
 * in a JVM test, so the activity reads them and hands over strings.
 */
object Given {
	/** The pair page's fragments (`routeHash` in `assets/pair/index.html`). */
	const val CONNECT = "connect"
	const val ASK = "ask"
	const val BAD = "bad"
	const val LONG = "long"

	/**
	 * The longest address the question will show: 9B's own limit for a whole
	 * address (`last.maxLength`). The question exists to be read, and a host
	 * long enough to run off the screen can hide the part that says whose it
	 * is, so a longer one is refused rather than shown cut. It has its own
	 * door so the band can say so: it breaks none of the rules `#bad=`'s hint
	 * names. The page holds the same limit (`MAX_ASKED` in `ask()`) for the
	 * doors to the question that do not pass through here, and `GivenTest`
	 * pins the two together.
	 */
	const val MAX_ASKED = 80

	/** Which door to take, and the value it carries. */
	data class Door(val name: String, val value: String) {
		/** The fragment `MainActivity.loadAsset` appends; [encode] is `Uri.encode` there. */
		fun fragment(encode: (String) -> String): String = "#$name=${encode(value)}"
	}

	/**
	 * The address an intent carries, or null when it carries none (the plain
	 * launcher entry, or a link that is not `tsundoku://connect`). The extra
	 * wins when both are there: it is what the documented command sends.
	 * [linkUrl] is a function because `Uri.getQueryParameter` throws on an
	 * opaque URI, and it is asked only once the link is known to be ours.
	 */
	fun address(extra: String?, scheme: String?, host: String?, linkUrl: () -> String?): String? {
		extra?.trim()?.takeIf { it.isNotEmpty() }?.let { return it }
		if (!scheme.equals("tsundoku", true) || !host.equals("connect", true)) return null
		return linkUrl()?.trim()?.takeIf { it.isNotEmpty() }
	}

	/**
	 * The door for an address from outside. [known] is asked about the origin
	 * [Address.intentOrigin] kept, never the raw string, so it answers for the
	 * same value `Servers` stores.
	 */
	fun door(raw: String, known: (String) -> Boolean): Door {
		val origin = Address.intentOrigin(raw) ?: return Door(BAD, raw)
		if (known(origin)) return Door(CONNECT, origin)
		if (origin.length > MAX_ASKED) return Door(LONG, raw)
		return Door(ASK, origin)
	}
}

package dev.masshiro.tsundoku.tv

/**
 * What FORGET does to the WebView's cookie jar (c261; S4): the cookies the
 * jar would send to that origin, expired, so adding the server back pairs
 * again with six digits instead of finding the old pairing still there.
 *
 * Android's CookieManager has no "remove this origin's cookies": it has
 * `getCookie(url)` (the `a=1; b=2` header the page would send) and
 * `setCookie(url, line)`. So each name is written back expired, at the path
 * the computer sets its cookies on (`/`, `PAIRED_COOKIE_OPTIONS`), with
 * `Secure` on an https origin so the write is accepted there. Pure, so
 * `ForgetTest` pins the lines; that CookieManager takes them is a device claim
 * (doc/ANDROID.md, "Device checks").
 *
 * The jar scopes cookies by host, not port or scheme, so what `getCookie`
 * hands back for one server also holds every other server's on the same
 * computer. Each server names its pairing for its own origin since c530
 * ([pairedCookie]), and FORGET leaves another origin's pairing alone: it
 * expires this origin's name, the shared name every server used before c530
 * (which a TV paired then may still carry until that server is next opened),
 * and every cookie that is not a pairing.
 */
object Forget {
	/** The name every server gave its pairing before c530. */
	const val OLD_PAIRED = "tsundoku_paired"

	/**
	 * This origin's paired cookie, as the server names it
	 * (`pairedCookie` in src/lib/server/pairing.ts): the port, the scheme's
	 * default when the origin has none, and `s` before it for https. A cookie's
	 * name may not hold `:`, so the origin is not written into it whole, and the
	 * host is not needed: the jar already keeps one per host.
	 */
	fun pairedCookie(origin: String): String? {
		val url = runCatching { java.net.URI(origin.trim()) }.getOrNull() ?: return null
		val https =
			when (url.scheme?.lowercase()) {
				"https" -> true
				"http" -> false
				else -> return null
			}
		val port = if (url.port > 0) url.port else if (https) 443 else 80
		return OLD_PAIRED + "_" + (if (https) "s" else "") + port
	}

	private val PER_ORIGIN = Regex("^" + OLD_PAIRED + "_s?\\d+$")

	fun expiring(header: String?, origin: String): List<String> {
		val secure = origin.startsWith("https://")
		val own = pairedCookie(origin)
		return header.orEmpty()
			.split(';')
			.map { it.substringBefore('=').trim() }
			.filter { it.isNotEmpty() }
			.distinct()
			// Another server's pairing on this computer: not this FORGET's.
			.filter { name -> !PER_ORIGIN.matches(name) || name == own }
			.map { name ->
				"$name=; Max-Age=0; Expires=Thu, 01 Jan 1970 00:00:00 GMT; Path=/" + if (secure) "; Secure" else ""
			}
	}

	/**
	 * The server's name from what MainActivity's `PAIRED_JS` read on 9E: the
	 * `data-paired-name` attribute, a newline, then the first line's text
	 * (c545). The attribute wins, so a change to the label's words cannot lose
	 * the name; a server older than c545 has no attribute, and its line is
	 * parsed as before ([pairedName]). Null when the page is not 9E.
	 */
	fun pairedNameFrom(said: String?): String? {
		if (said.isNullOrEmpty()) return null
		val nl = said.indexOf('\n')
		// No newline is not this script's answer: read it as a line, never as a name.
		if (nl < 0) return pairedName(said)
		val attribute = said.substring(0, nl).trim()
		if (attribute.isNotEmpty()) return attribute
		return pairedName(said.substring(nl + 1))
	}

	/**
	 * 9E's first line, "✓ PAIRED WITH ZEN · 192.168.1.23:42143" (the computer's
	 * `/pair/tv`), as the name the server gives itself; null when the page is
	 * not 9E. Read rather than asked for: `/pair/tv` is the computer's page and
	 * already says it (doc/handoffs/tv-servers, "The name").
	 */
	fun pairedName(line: String?): String? {
		val m = Regex("PAIRED WITH\\s+(.+?)\\s+·").find(line ?: return null) ?: return null
		return m.groupValues[1].trim().takeIf { it.isNotEmpty() }
	}
}

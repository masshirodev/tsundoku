package dev.masshiro.tsundoku.tv

/**
 * What FORGET does to the WebView's cookie jar (c261; S4): every cookie the
 * jar would send to that origin, expired, so adding the server back pairs
 * again with six digits instead of finding the old pairing still there.
 *
 * Android's CookieManager has no "remove this origin's cookies": it has
 * `getCookie(url)` (the `a=1; b=2` header the page would send) and
 * `setCookie(url, line)`. So each name is written back expired, at the path
 * the computer sets its cookies on (`/`, `PAIRED_COOKIE_OPTIONS`), with
 * `Secure` on an https origin so the write is accepted there. Pure, so
 * `ForgetTest` pins the lines; that CookieManager takes them is a device claim
 * (doc/TV-APP.md, "What is not verified").
 */
object Forget {
	fun expiring(header: String?, origin: String): List<String> {
		val secure = origin.startsWith("https://")
		return header.orEmpty()
			.split(';')
			.map { it.substringBefore('=').trim() }
			.filter { it.isNotEmpty() }
			.distinct()
			.map { name ->
				"$name=; Max-Age=0; Expires=Thu, 01 Jan 1970 00:00:00 GMT; Path=/" + if (secure) "; Secure" else ""
			}
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

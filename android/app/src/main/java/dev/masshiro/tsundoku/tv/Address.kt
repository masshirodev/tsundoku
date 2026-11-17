package dev.masshiro.tsundoku.tv

/**
 * The address the TV fills in for itself on the address screen: its own
 * network's first three numbers, so only the last one is typed. Pure, so the
 * parsing is tested without a socket.
 */
object Address {
	/** The three private IPv4 ranges, as `lan.ts` has them. Tailscale's CGNAT is not one. */
	fun isPrivateV4(ip: String): Boolean {
		val p = ip.split('.').mapNotNull { it.toIntOrNull() }
		if (p.size != 4 || p.any { it !in 0..255 }) return false
		return p[0] == 10 ||
			(p[0] == 172 && p[1] in 16..31) ||
			(p[0] == 192 && p[1] == 168)
	}

	/** "192.168.1.40" -> "192.168.1."; anything that is not a dotted IPv4 -> null. */
	fun prefixOf(ip: String?): String? {
		val parts = ip?.trim()?.split('.') ?: return null
		if (parts.size != 4) return null
		if (parts.any { it.isEmpty() || it.length > 3 || it.toIntOrNull() !in 0..255 }) return null
		return parts.take(3).joinToString(".") + "."
	}

	/**
	 * A typed address as the origin the pages load: `192.168.1.23:42143` gets
	 * `http://`, and a trailing slash or path is dropped. The whole-address
	 * field is for Tailscale and another port, so https and a name are kept.
	 *
	 * The scheme and the host come back lower case, as [intentOrigin] has
	 * them, and as WebView's URL and the page's own `location.origin` do:
	 * `http://Zen.local:42143` typed on the address screen is the server whose
	 * pages load at `http://zen.local:42143`, so BridgeGuard, FailedLoad and
	 * Servers.find must see one origin, not two. A scheme typed in capitals
	 * (`HTTP://`) is a scheme, not a host to put `http://` before.
	 */
	fun originOf(input: String?): String? {
		val raw = input?.trim()?.takeIf { it.isNotEmpty() } ?: return null
		val typed = raw.startsWith("http://", ignoreCase = true) || raw.startsWith("https://", ignoreCase = true)
		val withScheme = if (typed) raw else "http://$raw"
		val url = runCatching { java.net.URI(withScheme) }.getOrNull() ?: return null
		val host = url.host?.lowercase()?.takeIf { it.isNotEmpty() } ?: return null
		val scheme = url.scheme?.lowercase() ?: "http"
		return "$scheme://$host${portSuffix(scheme, url.port)}"
	}

	/**
	 * ":port", or "" for no port and for the scheme's own (80, 443): WebView's
	 * URL drops a default port, so an origin that kept it would never equal
	 * the page's (BridgeGuard, FailedLoad, Servers.find). Entries stored with
	 * one before this are read through [originOf] (Servers.decode), so they
	 * come back without it.
	 */
	fun portSuffix(scheme: String?, port: Int): String {
		if (port <= 0) return ""
		val default = when (scheme?.lowercase()) {
			"http" -> 80
			"https" -> 443
			else -> -1
		}
		return if (port == default) "" else ":$port"
	}

	/**
	 * An address handed to the app from outside: a launch extra or a
	 * `tsundoku://connect?url=` link. Nothing was typed on the TV, so unlike
	 * [originOf] a bare `host:port` is not enough: the scheme must be one a
	 * WebView opens, and a host must be there.
	 *
	 * Only the origin comes back — a path, a query and a fragment are dropped
	 * because the app opens the origin. Userinfo is not dropped but refused:
	 * an address with a password in it is not one this app was built to hold.
	 */
	fun intentOrigin(input: String?): String? {
		val raw = input?.trim()?.takeIf { it.isNotEmpty() } ?: return null
		val url = runCatching { java.net.URI(raw) }.getOrNull() ?: return null
		val scheme = url.scheme?.lowercase() ?: return null
		if (scheme != "http" && scheme != "https") return null
		if (url.rawUserInfo != null) return null
		val host = url.host?.lowercase()?.takeIf { it.isNotEmpty() } ?: return null
		// java.net.URI answers -1 for "no port at all", which is the only port
		// this parser leaves out. Every other one has to be a real port: 0 and
		// anything past 65535 are refused rather than rewritten to the default,
		// so a nonsense address is never quietly probed and remembered.
		val port = when (url.port) {
			-1 -> ""
			in 1..65535 -> portSuffix(scheme, url.port)
			else -> return null
		}
		return "$scheme://$host$port"
	}

	/** The last number a remote typed, as an address: 0-255, nothing else. */
	fun withLast(prefix: String?, last: String?, port: Int): String? {
		val n = last?.trim()?.toIntOrNull() ?: return null
		if (n !in 0..255) return null
		val head = prefixOf((prefix?.trim() ?: "") + "0") ?: return null
		return "http://$head$n:$port"
	}
}

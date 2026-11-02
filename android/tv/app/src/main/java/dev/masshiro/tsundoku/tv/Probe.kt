package dev.masshiro.tsundoku.tv

import java.net.HttpURLConnection
import java.net.URL

/**
 * "Does the computer answer?" (c236; TV-Pair.dc.html, 9D). A cheap GET of
 * something only tsundoku serves, with a short timeout: the web app manifest,
 * whose name is tsundoku's. A router's login page, a NAS or a TV's own web
 * server answers nothing at that path, so 9D's three reasons can be true.
 *
 * `accepts` is the pure part; `check` is the two lines of network around it.
 */
object Probe {
	const val PATH = "/manifest.webmanifest"
	private const val TIMEOUT_MS = 3000

	fun urlOf(origin: String): String = origin.trimEnd('/') + PATH

	fun accepts(status: Int, body: String): Boolean =
		status in 200..299 && body.contains("tsundoku", ignoreCase = true)

	/** Hidden proxies: only the home network and Tailscale may be probed. */
	fun check(origin: String): Boolean =
		try {
			val c = URL(urlOf(origin)).openConnection() as HttpURLConnection
			c.connectTimeout = TIMEOUT_MS
			c.readTimeout = TIMEOUT_MS
			c.instanceFollowRedirects = true
			c.requestMethod = "GET"
			// A tsundoku that asks for a password answers the login page with a
			// redirect; the manifest itself is public, so a 200 is the answer.
			val status = c.responseCode
			val body = (if (status in 200..299) c.inputStream else c.errorStream)
				?.bufferedReader()?.use { it.readText() }.orEmpty()
			c.disconnect()
			accepts(status, body)
		} catch (_: Exception) {
			false
		}
}

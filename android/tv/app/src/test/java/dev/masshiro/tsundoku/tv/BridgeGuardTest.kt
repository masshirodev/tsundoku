package dev.masshiro.tsundoku.tv

import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

/** BridgeGuard's rule (c529): the app's own page and known servers' pages, nothing else. */
class BridgeGuardTest {
	private val home = "http://192.168.1.23:42143"
	private val zen = "https://zen.tailnet.ts.net:8443"
	private val known = setOf(home, zen)
	private fun allows(url: String?) = BridgeGuard.allows(url) { it in known }

	@Test
	fun `the app's own page, with or without a fragment`() {
		assertTrue(allows("file:///android_asset/pair/index.html"))
		assertTrue(allows("file:///android_asset/pair/index.html#lost=http%3A%2F%2F192.168.1.23%3A42143"))
		assertTrue(allows("file:///android_asset/pair/index.html#add"))
	}

	@Test
	fun `a known server's pages, at any path`() {
		assertTrue(allows("$home/"))
		assertTrue(allows("$home/series/12?x=1#top"))
		assertTrue(allows("$zen/pair/tv"))
	}

	@Test
	fun `an unknown origin, and the known ones' twins, are refused`() {
		assertFalse(allows("https://example.com/"))
		// A known server's host on another port: another server, not this one.
		assertFalse(allows("http://192.168.1.23:42144/"))
		assertFalse(allows("http://192.168.1.23/"))
		// The http/https twin of a known origin.
		assertFalse(allows("https://192.168.1.23:42143/"))
		assertFalse(allows("http://zen.tailnet.ts.net:8443/"))
		// A host that only starts like a known one.
		assertFalse(allows("http://192.168.1.230:42143/"))
	}

	@Test
	fun `nothing that is not a page of ours`() {
		assertFalse(allows(null))
		assertFalse(allows(""))
		assertFalse(allows("about:blank"))
		assertFalse(allows("data:text/html,<p>x"))
		assertFalse(allows("javascript:alert(1)"))
		// Another file the WebView could reach: allowFileAccess is on for the asset.
		assertFalse(allows("file:///android_asset/pair/other.html"))
		assertFalse(allows("file:///sdcard/Download/index.html"))
		assertFalse(allows("file:///android_asset/pair/index.html.evil"))
	}
}

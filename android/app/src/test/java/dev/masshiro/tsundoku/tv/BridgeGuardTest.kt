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

	@Test
	fun `a server added with its scheme's own port is trusted on its pages (round 2)`() {
		// WebView's URL drops :443 and :80; the stored origin must too, or
		// the pages of an entry typed as https://host:443 are refused.
		val stored = setOf(Address.originOf("https://lib.example.com:443"), Address.originOf("http://zen.local:80"))
		assertTrue(BridgeGuard.allows("https://lib.example.com/") { it in stored })
		assertTrue(BridgeGuard.allows("https://lib.example.com:443/series/3") { it in stored })
		assertTrue(BridgeGuard.allows("http://zen.local/") { it in stored })
		// Only the scheme's own port goes: 443 over http is another server.
		assertFalse(BridgeGuard.allows("http://lib.example.com/") { it in stored })
	}

	@Test
	fun `a server typed with capitals is trusted on its lower-case pages (c548)`() {		// What 9B's TYPE THE WHOLE ADDRESS stored for http://Zen.local:42143,
		// read back through Servers.decode; WebView's URL is lower case.
		val stored = Servers.decode("http://Zen.local:42143\tZEN\t\t5\t5").map { it.origin }.toSet()
		assertTrue(BridgeGuard.allows("http://zen.local:42143/") { it in stored })
		assertTrue(BridgeGuard.allows("http://zen.local:42143/settings") { it in stored })
		// And a page whose URL somehow kept the capitals is the same server.
		assertTrue(BridgeGuard.allows("http://ZEN.local:42143/") { it in stored })
		assertFalse(BridgeGuard.allows("http://zen.local:42144/") { it in stored })
	}

	@Test
	fun `a scheme typed in capitals is the same scheme, and widens nothing else (c646)`() {
		val stored =
			setOf(
				Address.originOf("http://zen.local:42143"),
				Address.originOf("https://zen.tailnet.ts.net:8443")
			)
		// A known server typed with a capitalised scheme is its own page, at
		// any path, exactly as originOf reads it (the card's done line).
		assertTrue(BridgeGuard.allows("HTTP://zen.local:42143/") { it in stored })
		assertTrue(BridgeGuard.allows("HtTpS://ZEN.tailnet.ts.net:8443/series/3") { it in stored })
		// A capitalised scheme does not widen the rule: an unknown host is
		// still refused, and so is the known origin's http/https twin.
		assertFalse(BridgeGuard.allows("HTTP://example.com/") { it in stored })
		assertFalse(BridgeGuard.allows("HTTPS://192.168.1.23:42143/") { it in stored })
		// originOf reads a file URL to no host, so no capitalisation makes it a page.
		assertFalse(BridgeGuard.allows("FILE:///android_asset/pair/index.html") { it in stored })
	}
}

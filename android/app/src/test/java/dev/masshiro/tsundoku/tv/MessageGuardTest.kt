package dev.masshiro.tsundoku.tv

import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * The per-message rule a web message listener would ask (`BridgeGuard.allowsMessage`):
 * a message from a frame may reach the bridge only when the frame is the main
 * one and its origin is the app's own page's origin or a server the TV knows.
 *
 * `WebViewCompat.addWebMessageListener` hands the rule a frame's `sourceOrigin`,
 * which is an **origin** (`scheme://host[:port]`) and never a URL with a path or
 * a fragment (so every input here is origin-shaped: the rule judges the origin
 * and not the URL a page was loaded from). Nothing calls
 * the rule yet (doc/ANDROID.md, "Limits"), so these cases are
 * the whole of it for now.
 */
class MessageGuardTest {
	private val home = "http://192.168.1.23:42143"
	private val zen = "https://zen.tailnet.ts.net:8443"

	/** What `Servers.find` would hold: originOf writes every entry lower case. */
	private val known = setOf(home, zen, "http://zen.local:42143")

	private fun allows(origin: String?, mainFrame: Boolean) =
		BridgeGuard.allowsMessage(origin, mainFrame) { it in known }

	@Test
	fun `a third-party frame inside a known server's page is refused`() {
		// The rule cannot see the page the frame sits in, only the frame's own
		// origin; that is enough. example.com's frame is not a main frame, and
		// example.com is not a server this TV knows, so both halves refuse it.
		assertFalse(allows("https://example.com", false))
		// The same page as the top-level one is refused too: a server's page is
		// the only third-party page that may reach the bridge, and only if the
		// list has it.
		assertFalse(allows("https://example.com", true))
		assertFalse(allows("http://192.168.1.23:42144", false))
		assertFalse(allows("https://192.168.1.23:42143", false))
	}

	@Test
	fun `a known server's origin is trusted as the main frame and refused as a sub-frame`() {
		for (at in listOf(home, zen, "http://zen.local:42143")) {
			assertTrue("$at as the main frame", allows(at, true))
			assertFalse("$at as a sub-frame", allows(at, false))
		}
	}

	@Test
	fun `the asset page's origin is trusted as the main frame and refused as a sub-frame`() {
		assertTrue(allows(BridgeGuard.ASSET_ORIGIN, true))
		assertFalse(allows(BridgeGuard.ASSET_ORIGIN, false))
		// Not the same origin: the wrong scheme, another port, another host.
		for (at in
			listOf(
				"http://appassets.androidplatform.net",
				"https://appassets.androidplatform.net:8443",
				"https://evil.appassets.androidplatform.net"
			)) {
			assertFalse("$at as the main frame", allows(at, true))
			assertFalse("$at as a sub-frame", allows(at, false))
		}
	}

	@Test
	fun `the file asset's old URL is refused, and the asset URL is not an origin`() {
		// The page loads from ASSET_ORIGIN (WebViewAssetLoader),
		// and a message's sourceOrigin is an origin: the URL the page was loaded
		// from, with its path, is never one. No page loads a file:// URL.
		assertFalse(allows(BridgeGuard.ASSET, true))
		assertFalse(allows(BridgeGuard.ASSET + "#lost=x", true))
		// Another file the WebView could reach is nobody's page.
		assertFalse(allows("file:///android_asset/pair/index.html", true))
		assertFalse(allows("file:///android_asset/pair/other.html", true))
		assertFalse(allows("file:///sdcard/Download/index.html", true))
	}

	@Test
	fun `a known server written with a path or a trailing slash is not an origin`() {
		// Refused, a bare trailing slash included. The
		// listener's sourceOrigin is an origin by the API's contract, so a
		// string with any path, query or fragment is not one and is not trusted.
		for (at in listOf("$home/", "$home/series/12", "$zen/pair/tv", "$home?x=1", "$home#top")) {
			assertFalse("$at as the main frame", allows(at, true))
		}
	}

	@Test
	fun `a known host or scheme typed with capitals is the same origin, by Address originOf's rule`() {
		// Address.originOf lower-cases the scheme and the host, so a
		// sourceOrigin that kept a capital is the same server. Allowed as the
		// main frame, refused below one. (The top-level URL rule, BridgeGuard
		// .allows, still tests the scheme case-sensitively.)
		assertTrue(allows("http://ZEN.local:42143", true))
		assertTrue(allows("https://ZEN.tailnet.ts.net:8443", true))
		assertTrue(allows("HTTP://zen.local:42143", true))
		assertFalse(allows("http://ZEN.local:42143", false))
	}

	@Test
	fun `the opaque origins are refused, null, absent, about blank and data`() {
		// Android reports "null" for an opaque origin, and none of these is the
		// asset page's origin, so none is trusted.
		for (at in listOf("null", null, "", "about:blank", "data:text/html,<p>x", "javascript:alert(1)")) {
			assertFalse("$at as the main frame", allows(at, true))
			assertFalse("$at as a sub-frame", allows(at, false))
		}
	}

	@Test
	fun `every origin is refused as a sub-frame, whatever it is`() {
		// The frame half of the rule is not the origin's: no sub-frame is
		// trusted, so a page that embedded the app's own asset could not reach
		// the bridge through it either.
		val origins =
			listOf(
				BridgeGuard.ASSET_ORIGIN,
				BridgeGuard.ASSET,
				home,
				zen,
				"http://ZEN.local:42143",
				"https://example.com",
				"https://192.168.1.23:42143",
				"http://192.168.1.230:42143",
				"null"
			)
		for (at in origins) assertFalse("$at", allows(at, false))
	}
}

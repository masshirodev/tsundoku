package dev.masshiro.tsundoku.tv

import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * The per-message rule c549's part (b) would install (`BridgeGuard.allowsMessage`):
 * a message from a frame may reach the bridge only when the frame is the main
 * one and its origin is the app's own page or a server the TV knows.
 *
 * A `WebViewCompat.addWebMessageListener` callback is what would hand these in;
 * nothing calls the rule yet (doc/TV-APP.md, "What it does not do yet"), so
 * these cases are the whole of it for now. A JavaScript interface's
 * `PairingBridgeTest` cannot reach a frame at all, which is the hole.
 */
class MessageGuardTest {
	private val home = "http://192.168.1.23:42143"
	private val zen = "https://zen.tailnet.ts.net:8443"

	/** What `Servers.find` would hold: c548's originOf writes every entry lower case. */
	private val known = setOf(home, zen, "http://zen.local:42143")

	private fun allows(origin: String?, mainFrame: Boolean) =
		BridgeGuard.allowsMessage(origin, mainFrame) { it in known }

	@Test
	fun `a third-party frame inside a known server's page is refused (the card's done line)`() {
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
		for (at in listOf(home, zen, "$home/", "$home/series/12?x=1#top", "$zen/pair/tv")) {
			assertTrue("$at as the main frame", allows(at, true))
			assertFalse("$at as a sub-frame", allows(at, false))
		}
	}

	@Test
	fun `the app's own page is trusted as the main frame and refused as a sub-frame`() {
		assertTrue(allows(BridgeGuard.ASSET, true))
		assertTrue(allows(BridgeGuard.ASSET + "#lost=x", true))
		assertFalse(allows(BridgeGuard.ASSET, false))
		// Another file the WebView could reach is nobody's page.
		assertFalse(allows("file:///android_asset/pair/other.html", true))
		assertFalse(allows("file:///sdcard/Download/index.html", true))
	}

	@Test
	fun `a known host typed with capitals is the same server, by Address originOf's rule`() {
		// Decided by Address.originOf, which lower-cases the scheme and the host
		// (c548): a message whose sourceOrigin kept the host's capitals is the
		// server whose pages load lower case, exactly as BridgeGuard.allows
		// treats a top-level URL. Allowed as the main frame, refused below one.
		assertTrue(allows("http://ZEN.local:42143", true))
		assertTrue(allows("https://ZEN.tailnet.ts.net:8443", true))
		assertFalse(allows("http://ZEN.local:42143", false))
		// A scheme typed in capitals is refused by the guard's own scheme test
		// (`startsWith("http://")`, case-sensitive), which is fail-closed and is
		// what the top-level guard answers for such a URL too; no page's real
		// sourceOrigin is expected to need it.
		assertFalse(allows("HTTP://zen.local:42143", true))
	}

	@Test
	fun `the opaque origins are refused, null, absent, about blank and data`() {
		// A file:// page's sourceOrigin is the question the asset loader settles;
		// the reference gives no origin for one, and Android reports "null" for
		// an opaque origin. Neither is the asset page's own URL, so neither is
		// trusted (doc/TV-APP.md, "What it does not do yet", item 1).
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

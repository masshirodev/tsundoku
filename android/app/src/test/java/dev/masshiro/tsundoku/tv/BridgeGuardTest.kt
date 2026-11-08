package dev.masshiro.tsundoku.tv

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
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
		assertTrue(allows(BridgeGuard.ASSET))
		assertTrue(allows(BridgeGuard.ASSET + "#lost=http%3A%2F%2F192.168.1.23%3A42143"))
		assertTrue(allows(BridgeGuard.ASSET + "#add"))
		assertTrue(allows(BridgeGuard.ASSET + "?x=1"))
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
		// Another file the WebView could reach: allowFileAccess is off, and no
		// page loads one. The asset page's old file:// URL is nobody's now (c549).
		assertFalse(allows("file:///android_asset/pair/index.html"))
		assertFalse(allows("file:///android_asset/pair/other.html"))
		assertFalse(allows("file:///sdcard/Download/index.html"))
		assertFalse(allows("file:///android_asset/pair/index.html.evil"))
	}

	@Test
	fun `the asset page is recognised by its https URL, and not by its old file one (c549)`() {
		// What WebViewAssetLoader serves (MainActivity.shouldInterceptRequest):
		// another host, another path or another scheme is not the app's page.
		assertTrue(BridgeGuard.allows(BridgeGuard.ASSET) { false })
		assertTrue(BridgeGuard.allows(BridgeGuard.ASSET + "#add") { false })
		// The page loads with this launch's token in its query (round 4), and
		// its own top-level URL must still be the app's page to the bridge.
		assertTrue(BridgeGuard.allows(BridgeGuard.ASSET + "?t=6a1f0c9e#add") { false })
		assertFalse(BridgeGuard.allows("https://${BridgeGuard.ASSET_HOST}/pair/other.html") { false })
		assertFalse(BridgeGuard.allows("https://evil.appassets.androidplatform.net/pair/index.html") { false })
		assertFalse(BridgeGuard.allows("http://${BridgeGuard.ASSET_HOST}/pair/index.html") { false })
		assertFalse(BridgeGuard.allows("file:///android_asset/pair/index.html") { false })
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
	fun `a server typed with capitals is trusted on its lower-case pages (c548)`() {
		// What 9B's TYPE THE WHOLE ADDRESS stored for http://Zen.local:42143,
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

	@Test
	fun `nothing navigates into the app's own page, and only its host is refused (c549, round 2)`() {
		// A page setting `location` to the pair page with a fragment that makes
		// it act: the hole the move to https opened, closed at the navigation.
		assertTrue(
			BridgeGuard.refusesNavigation(BridgeGuard.ASSET + "#connect=http%3A%2F%2Fevil%3A42143")
		)
		assertTrue(BridgeGuard.refusesNavigation(BridgeGuard.ASSET + "#add"))
		assertTrue(BridgeGuard.refusesNavigation(BridgeGuard.ASSET + "#rename=x"))
		// The host is read case-blind, whatever the scheme and path.
		assertTrue(BridgeGuard.refusesNavigation("HTTPS://APPASSETS.androidplatform.net/pair/index.html"))
		assertTrue(BridgeGuard.refusesNavigation("http://${BridgeGuard.ASSET_HOST}/anything?x=1#y"))
		// A frame's request for the host is an embed; the main frame's is the
		// app's own load, which the loader answers (round 3's rule, below).
		// Every other page is somebody's to navigate to, known or not.
		assertFalse(BridgeGuard.refusesNavigation("$home/"))
		assertFalse(BridgeGuard.refusesNavigation("$zen/series/12"))
		assertFalse(BridgeGuard.refusesNavigation("https://example.com/"))
		// The host in a path or a query is not the host of the page.
		assertFalse(
			BridgeGuard.refusesNavigation(
				"https://example.com/?next=https://${BridgeGuard.ASSET_HOST}/pair/index.html"
			)
		)
		assertFalse(BridgeGuard.refusesNavigation(null))
		assertFalse(BridgeGuard.refusesNavigation(""))
	}

	@Test
	fun `the asset host is served only to the main frame's GET (c549, round 3)`() {
		val token = "6a1f0c9e-2b7d-4a55-9d1e-3f8c0b2a7e64"
		val page = BridgeGuard.ASSET + "?t=" + token
		// A form submit keeps the action's fragment, and shouldOverrideUrlLoading
		// is never called for POST (WebViewClient: "This method is not called
		// for POST requests"), so the interception is what refuses it.
		assertTrue(
			BridgeGuard.refusesAssetRequest(
				page + "#connect=http%3A%2F%2Fevil%3A42143",
				true,
				"POST",
				token
			)
		)
		// The method is read without case, and an absent one is not a GET.
		assertTrue(BridgeGuard.refusesAssetRequest(page, true, "post", token))
		assertTrue(BridgeGuard.refusesAssetRequest(page + "#add", true, "Post", token))
		assertTrue(BridgeGuard.refusesAssetRequest(page, true, null, token))
		// A main-frame GET of the app's own URL is its loadAsset, and is served.
		assertFalse(BridgeGuard.refusesAssetRequest(page, true, "GET", token))
		assertFalse(BridgeGuard.refusesAssetRequest(page + "#add", true, "get", token))
		// A frame's GET is an embed, refused as it was in round 2.
		assertTrue(
			BridgeGuard.refusesAssetRequest(
				"HTTPS://${BridgeGuard.ASSET_HOST}/pair/index.html?t=$token",
				false,
				"GET",
				token
			)
		)
		assertTrue(BridgeGuard.refusesAssetRequest(page, false, null, token))
		// Every other host is somebody else's, whatever the method.
		assertFalse(BridgeGuard.refusesAssetRequest("$home/", true, "POST", token))
		assertFalse(BridgeGuard.refusesAssetRequest("$zen/series/12", true, "GET", token))
		assertFalse(BridgeGuard.refusesAssetRequest(null, true, "GET", token))
		assertFalse(BridgeGuard.refusesAssetRequest("", true, "POST", token))
	}

	@Test
	fun `a main-frame GET without this launch's token gets no page, whatever called it (c549, round 4)`() {
		val token = "6a1f0c9e-2b7d-4a55-9d1e-3f8c0b2a7e64"
		val page = BridgeGuard.ASSET + "?t=" + token
		// The app's own load, and a reload of that document, keep the token.
		assertFalse(BridgeGuard.refusesAssetRequest(page, true, "GET", token))
		assertFalse(
			BridgeGuard.refusesAssetRequest(
				page + "#connect=http%3A%2F%2Fexample.com%3A42143",
				true,
				"GET",
				token
			)
		)
		// Every URL a page can write: the token is the app's, and a page
		// cannot know it. A link, `location =`, a meta refresh, a 302 or a GET
		// form carries no token and is refused at the interception even where
		// the WebView version calls no navigation callback at all.
		assertTrue(BridgeGuard.refusesAssetRequest(BridgeGuard.ASSET, true, "GET", token))
		assertTrue(
			BridgeGuard.refusesAssetRequest(
				BridgeGuard.ASSET + "#connect=http%3A%2F%2Fevil%3A42143",
				true,
				"GET",
				token
			)
		)
		assertTrue(BridgeGuard.refusesAssetRequest(BridgeGuard.ASSET + "?t=wrong", true, "GET", token))
		assertTrue(BridgeGuard.refusesAssetRequest(BridgeGuard.ASSET + "?t=$token&x=1", true, "GET", token))
		assertTrue(BridgeGuard.refusesAssetRequest(BridgeGuard.ASSET + "?", true, "GET", token))
		// A token that is absent or blank never makes a URL served.
		assertTrue(BridgeGuard.refusesAssetRequest(page, true, "GET", null))
		assertTrue(BridgeGuard.refusesAssetRequest(page, true, "GET", ""))
		// The token is the query's, not the fragment's or the path's.
		assertTrue(BridgeGuard.refusesAssetRequest(BridgeGuard.ASSET + "#t=$token", true, "GET", token))
		// And it widens nothing: another host carrying the same query is
		// somebody else's and is not refused.
		assertFalse(BridgeGuard.refusesAssetRequest("$home/?t=$token", true, "GET", token))
	}

	@Test
	fun `the token is read from the query exactly, and nowhere else (c549, round 4)`() {
		val token = "6a1f0c9e-2b7d-4a55-9d1e-3f8c0b2a7e64"
		assertTrue(BridgeGuard.carriesAssetToken(BridgeGuard.ASSET + "?t=$token", token))
		assertTrue(BridgeGuard.carriesAssetToken(BridgeGuard.ASSET + "?t=$token#add", token))
		assertFalse(BridgeGuard.carriesAssetToken(BridgeGuard.ASSET + "#t=$token", token))
		assertFalse(BridgeGuard.carriesAssetToken(BridgeGuard.ASSET + "?t=${token}x", token))
		assertFalse(BridgeGuard.carriesAssetToken(BridgeGuard.ASSET + "?x=1&t=$token", token))
		assertFalse(BridgeGuard.carriesAssetToken(null, token))
		assertFalse(BridgeGuard.carriesAssetToken(BridgeGuard.ASSET + "?t=", token))
	}

	@Test
	fun `a URL java_net_URI cannot parse is still read for its host, and refused at ours (c684)`() {
		val token = "6a1f0c9e-2b7d-4a55-9d1e-3f8c0b2a7e64"
		// The card's three, each of which makes java.net.URI throw (measured
		// with jshell): `|` and `{` are left as they are in a query, and `|` in
		// a fragment, by the URL standard's percent-encode sets. Read with
		// java.net.URI they had no host, so the navigation was let through and
		// the interception sent the request to the network instead of a 404.
		for (
			url in
				listOf(
					BridgeGuard.ASSET + "?x=|",
					BridgeGuard.ASSET + "?x={",
					BridgeGuard.ASSET + "#connect=|"
				)
		) {
			assertTrue(url, BridgeGuard.isAssetHost(url))
			assertTrue(url, BridgeGuard.refusesNavigation(url))
			assertTrue(url, BridgeGuard.refusesAssetRequest(url, true, "GET", token))
		}
		// The token's own URL with a character java.net.URI refuses is not
		// served either: the query must be exactly t=<token>.
		assertTrue(
			BridgeGuard.refusesAssetRequest(BridgeGuard.ASSET + "?t=$token|", true, "GET", token)
		)
		// The good URL is still served, with and without a fragment.
		assertFalse(BridgeGuard.refusesAssetRequest(BridgeGuard.ASSET + "?t=$token", true, "GET", token))
		assertFalse(
			BridgeGuard.refusesAssetRequest(BridgeGuard.ASSET + "?t=$token#add", true, "GET", token)
		)
	}

	@Test
	fun `the host is read as a browser reads the authority, every spelling of ours refused (c684)`() {
		val host = BridgeGuard.ASSET_HOST
		val ours =
			listOf(
				"HTTPS://APPASSETS.ANDROIDPLATFORM.NET/pair/index.html",
				// Userinfo is not the host: what follows the last @ is.
				"https://user@$host/pair/index.html",
				"https://a:b@c@$host/pair/index.html?x=|",
				// A port names the same host.
				"https://$host:443/pair/index.html",
				"https://$host:8443/pair/index.html#connect=|",
				// A trailing dot is the same name to DNS.
				"https://$host./pair/index.html",
				// A percent-escaped dot is a dot once a browser reads the host.
				"https://appassets%2eandroidplatform%2Enet/pair/index.html",
				// A browser reads a backslash as a slash in an http(s) URL, and
				// takes the authority with or without the two slashes.
				"https://$host\\pair\\index.html",
				"https:$host/pair/index.html",
				"https:/$host/pair/index.html",
				// A tab or a newline inside the URL is dropped by a browser.
				"https://app\tassets.androidplatform.net/pair/index.html",
				"  https://$host/pair/index.html  ",
				"ws://$host/",
				"ftp://$host/x"
			)
		for (url in ours) {
			assertTrue(url, BridgeGuard.isAssetHost(url))
			assertTrue(url, BridgeGuard.refusesNavigation(url))
			assertTrue(url, BridgeGuard.refusesAssetRequest(url, true, "GET", "t"))
		}
		val theirs =
			listOf(
				// The asset host as userinfo: the host is evil.example's.
				"https://$host@evil.example/pair/index.html",
				"https://$host:x@evil.example/",
				// A longer name, or one that only starts like ours.
				"https://evil.$host/pair/index.html",
				"https://$host.evil.example/pair/index.html",
				"https://appassets.androidplatform.network/",
				// Two trailing dots are not ours; one is.
				"https://$host../",
				// The host in a path, a query or a fragment is not the page's.
				"https://example.com/$host",
				"https://example.com/?u=https://$host/pair/index.html|",
				"https://example.com/#https://$host/",
				// A scheme that is not special takes no authority without `//`.
				"javascript:$host",
				"about:blank",
				"data:text/html,$host",
				"https://[::1]/",
				"https:///",
				"no scheme $host",
				"",
				null
			)
		for (url in theirs) {
			assertFalse(url.toString(), BridgeGuard.isAssetHost(url))
			assertFalse(url.toString(), BridgeGuard.refusesNavigation(url))
			assertFalse(url.toString(), BridgeGuard.refusesAssetRequest(url, true, "GET", "t"))
		}
	}

	@Test
	fun `the authority read gives the host alone, lower-cased, of what it can read (c684)`() {
		assertEquals("zen.local", BridgeGuard.hostOf("http://u:p@ZEN.local:42143/x?y=|#z"))
		assertEquals("zen.local", BridgeGuard.hostOf("http://zen.local./"))
		assertEquals("[::1]", BridgeGuard.hostOf("http://[::1]:42143/"))
		assertEquals("a.b", BridgeGuard.hostOf("https://a%2Eb/"))
		// An escape that is not one is kept as written, never thrown on.
		assertEquals("a%zzb", BridgeGuard.hostOf("https://a%zzb/"))
		assertEquals("a%2", BridgeGuard.hostOf("https://a%2"))
		// As a browser reads it: an http(s) authority starts after any run of
		// slashes (`new URL("https:///x").hostname` is "x" in the URL
		// standard's own parser), and with nothing after them there is none.
		assertEquals("x", BridgeGuard.hostOf("https:///x"))
		assertNull(BridgeGuard.hostOf("https:///"))
		assertNull(BridgeGuard.hostOf("mailto:x@zen.local"))
		// A file URL names no host, so no path of one is read as ours.
		assertNull(BridgeGuard.hostOf("file:///android_asset/pair/index.html"))
		assertFalse(BridgeGuard.isAssetHost("file:///appassets.androidplatform.net/pair/index.html"))
		assertNull(BridgeGuard.hostOf("://zen.local/"))
		assertNull(BridgeGuard.hostOf("1http://zen.local/"))
		assertNull(BridgeGuard.hostOf(null))
	}
}

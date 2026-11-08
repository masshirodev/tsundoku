package dev.masshiro.tsundoku.tv

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test
import java.io.File
import java.net.URLDecoder
import java.net.URLEncoder

/**
 * What the app does with an address from outside (c683): one in the list opens,
 * one that is not is asked about, and one it cannot read is refused.
 */
class GivenTest {
	private val evil = "https://evil.example:8443"
	private val zen = "https://zen.tailnet.ts.net:8443"
	private val inList: (String) -> Boolean = { it == zen }
	private val nothingKnown: (String) -> Boolean = { false }

	/** The address a `tsundoku://connect?url=` link carries, read as the activity reads it. */
	private fun fromLink(link: String): String? {
		val uri = java.net.URI(link)
		return Given.address(null, uri.scheme, uri.host) {
			uri.rawQuery.substringAfter("url=").let { URLDecoder.decode(it, "UTF-8") }
		}
	}

	private fun link(of: String) = "tsundoku://connect?url=" + URLEncoder.encode(of, "UTF-8")

	@Test
	fun `a link to an address not in the list asks`() {
		assertEquals(Given.Door(Given.ASK, evil), Given.door(fromLink(link(evil))!!, inList))
	}

	@Test
	fun `the extra asks as the link does, because a browser's intent link can carry it`() {
		// `intent://connect#Intent;scheme=tsundoku;S.url=https://evil.example;end`
		// reaches the same filter with the address as the `url` extra.
		val raw = Given.address(evil, "tsundoku", "connect") { null }
		assertEquals(Given.Door(Given.ASK, evil), Given.door(raw!!, inList))
	}

	@Test
	fun `the extra wins over the link, and asks about what it names`() {
		val raw = Given.address(evil, "tsundoku", "connect") { zen }
		assertEquals(evil, raw)
		assertEquals(Given.ASK, Given.door(raw!!, inList).name)
	}

	@Test
	fun `the launcher's shortcut, whose address is in the list, does not ask`() {
		val servers = listOf(Servers.Server(origin = zen))
		val shortcut = Shortcuts.plan(servers).single()
		assertEquals(Given.Door(Given.CONNECT, zen), Given.door(fromLink(shortcut.link)!!, inList))
	}

	@Test
	fun `a shortcut left on the launcher after its server was forgotten asks`() {
		val shortcut = Shortcuts.plan(listOf(Servers.Server(origin = zen))).single()
		assertEquals(Given.Door(Given.ASK, zen), Given.door(fromLink(shortcut.link)!!, nothingKnown))
	}

	@Test
	fun `the shape of an intent decides nothing, a shortcut's included`() {
		// A caller outside the app can set the package and the action too, so
		// the only input besides the address is the list.
		val anyone = Given.address(null, "TSUNDOKU", "CONNECT") { evil }
		assertEquals(Given.ASK, Given.door(anyone!!, inList).name)
	}

	@Test
	fun `the app's own entry carries no address, so there is nothing to ask`() {
		assertNull(Given.address(null, null, null) { error("a MAIN intent has no link to read") })
		assertNull(Given.address("", null, null) { null })
		assertNull(Given.address("   ", null, null) { null })
	}

	@Test
	fun `a link that is not tsundoku connect is no address, and its query is not read`() {
		val unread: () -> String? = { error("the query of someone else's link must not be read") }
		assertNull(Given.address(null, "https", "connect", unread))
		assertNull(Given.address(null, "tsundoku", "pair", unread))
		assertNull(Given.address(null, "tsundoku", null, unread))
		assertNull(Given.address(null, "tsundoku", "connect") { null })
		assertNull(Given.address(null, "tsundoku", "connect") { "  " })
	}

	@Test
	fun `every address the parser refuses is refused, never asked about or opened`() {
		val refused =
			listOf(
				"ftp://zen.local",
				"javascript:alert(1)",
				"file:///sdcard/pair.html",
				"content://media/external/file",
				"intent://zen.local#Intent;end",
				"http://",
				"https:///path",
				"http://:42143",
				"zen.local:42143",
				"http://user:pass@zen.local:42143",
				"https://user@zen.local",
				"http://zen.local:0",
				"http://zen.local:65536",
				"http://zen local",
				"not an address"
			)
		for (raw in refused) {
			// A list that claims to know everything is what would let one through.
			assertEquals(raw, Given.Door(Given.BAD, raw), Given.door(raw, { true }))
		}
	}

	@Test
	fun `the list is asked about the origin, not the string the link held`() {
		val seen = mutableListOf<String>()
		val door =
			Given.door("HTTPS://Zen.Tailnet.Ts.Net:8443/library?x=1#y") {
				seen += it
				it == zen
			}
		assertEquals(listOf(zen), seen)
		assertEquals(Given.Door(Given.CONNECT, zen), door)
	}

	@Test
	fun `http and https are two origins, so the other scheme asks`() {
		assertEquals(Given.ASK, Given.door("http://zen.tailnet.ts.net:8443", inList).name)
	}

	@Test
	fun `what the question carries is the origin alone`() {
		assertEquals(evil, Given.door("$evil/phish?next=1#x", inList).value)
	}

	@Test
	fun `an address exactly as long as the question shows is asked about, one past it refused`() {
		val prefix = "https://"
		val at = prefix + "a".repeat(Given.MAX_ASKED - prefix.length)
		assertEquals(Given.MAX_ASKED, at.length)
		assertEquals(Given.Door(Given.ASK, at), Given.door(at, nothingKnown))

		val past = at + "a"
		assertEquals(Given.Door(Given.LONG, past), Given.door(past, nothingKnown))
	}

	@Test
	fun `a long address already in the list still opens, because nothing is asked`() {
		val long = "https://" + "a".repeat(100)
		assertEquals(Given.Door(Given.CONNECT, long), Given.door(long) { it == long })
	}

	@Test
	fun `the fragment is the door's name and its encoded value`() {
		val encode: (String) -> String = { URLEncoder.encode(it, "UTF-8") }
		assertEquals("#ask=https%3A%2F%2Fevil.example%3A8443", Given.door(evil, inList).fragment(encode))
		assertEquals(
			"#connect=https%3A%2F%2Fzen.tailnet.ts.net%3A8443",
			Given.door(zen, inList).fragment(encode)
		)
		assertEquals("#bad=ftp%3A%2F%2Fz", Given.door("ftp://z", inList).fragment(encode))
	}

	/** What a pure rule cannot see: that the app's two ends actually use it. */
	@Test
	fun `the activity asks this rule and writes no door of its own`() {
		val activity = File("src/main/java/dev/masshiro/tsundoku/tv/MainActivity.kt").readText()
		assertTrue(activity.contains("Given.door(raw) { servers.find(it) != null }"))
		assertTrue(activity.contains("Given.address("))
		assertFalse(activity.contains("\"#connect="))
		assertFalse(activity.contains("\"#ask="))
	}

	@Test
	fun `the page takes every door the rule can name`() {
		val page = File("src/main/assets/pair/index.html").readText()
		for (name in listOf(Given.CONNECT, Given.ASK, Given.BAD, Given.LONG)) {
			assertTrue(name, page.contains("hash.startsWith('$name=')"))
		}
	}

	@Test
	fun `the page holds the same limit as the rule`() {
		val page = File("src/main/assets/pair/index.html").readText()
		assertTrue(page.contains("const MAX_ASKED = ${Given.MAX_ASKED};"))
	}
}

package dev.masshiro.tsundoku.tv

import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test
import java.net.URI
import java.net.URLDecoder

/**
 * A launcher shortcut per server. FORGET's pure pieces are in
 * ForgetTest.
 */
class ShortcutsTest {
	private val origins =
		listOf(
			"http://192.168.1.23:42143",
			"https://zen.tailnet.ts.net:8443",
			"https://library.example.com",
			"http://[fd7a:115c:a1e0::1]:42143",
			"http://zen.local"
		)

	/**
	 * The link is read the way MainActivity.givenAddress reads it: scheme
	 * `tsundoku`, host `connect`, the `url` query parameter decoded, then
	 * Address.intentOrigin. Android's Uri does the decoding on a TV; this is
	 * java.net's, which decodes `%XX` the same way for these characters.
	 */
	private fun given(link: String): String? {
		val uri = URI(link)
		assertEquals("tsundoku", uri.scheme)
		assertEquals("connect", uri.host)
		val raw = uri.rawQuery.split('&').first { it.startsWith("url=") }.removePrefix("url=")
		return Address.intentOrigin(URLDecoder.decode(raw, "UTF-8"))
	}

	@Test
	fun `every server's shortcut opens that server through c260's door`() {
		for (o in origins) {
			val link = Shortcuts.linkFor(o)
			assertTrue(link, link.startsWith("tsundoku://connect?url="))
			assertEquals(o, given(link))
		}
	}

	@Test
	fun `the link carries no character the query would split on`() {
		val link = Shortcuts.linkFor("https://zen.tailnet.ts.net:8443")
		assertEquals("tsundoku://connect?url=https%3A%2F%2Fzen.tailnet.ts.net%3A8443", link)
	}

	@Test
	fun `one per server, the last used first, at most four`() {
		val list = origins.mapIndexed { i, o -> Servers.Server(origin = o, opened = (10 - i).toLong()) }
		val plan = Shortcuts.plan(list)
		assertEquals(4, plan.size)
		assertEquals(origins.take(4), plan.map { it.id })
		assertEquals(origins.take(4).map(Shortcuts::linkFor), plan.map { it.link })
		assertEquals(0, Shortcuts.plan(list, 0).size)
		assertEquals(0, Shortcuts.plan(emptyList()).size)
	}

	@Test
	fun `a shortcut is labelled as its row is, cut to a launcher's length`() {
		val s = Servers.Server(origin = origins[1], name = "ZEN", tvName = "A very long name for the living room TV")
		val plan = Shortcuts.plan(listOf(s, Servers.Server(origin = origins[0], name = "ZEN")))
		assertEquals("A very long name for the ", plan[0].label)
		assertEquals(25, plan[0].label.length)
		assertEquals("ZEN", plan[1].label)
	}
}

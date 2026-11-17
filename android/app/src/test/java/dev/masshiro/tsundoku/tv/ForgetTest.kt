package dev.masshiro.tsundoku.tv

import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * FORGET's two pure pieces (S4): the cookie lines it writes into the
 * WebView's jar, and the server's name it reads from 9E's first line.
 */
class ForgetTest {
	@Test
	fun `forget expires every cookie the origin sends, once each`() {
		assertEquals(
			listOf(
				"tsundoku_paired=; Max-Age=0; Expires=Thu, 01 Jan 1970 00:00:00 GMT; Path=/",
				"tsundoku_theme=; Max-Age=0; Expires=Thu, 01 Jan 1970 00:00:00 GMT; Path=/"
			),
			Forget.expiring("tsundoku_paired=abc; tsundoku_theme=dark;tsundoku_paired=abc", "http://192.168.1.23:42143")
		)
		assertEquals(
			listOf("a=; Max-Age=0; Expires=Thu, 01 Jan 1970 00:00:00 GMT; Path=/; Secure"),
			Forget.expiring("a=1", "https://zen.tailnet.ts.net:8443")
		)
		assertEquals(emptyList<String>(), Forget.expiring(null, "http://x"))
		assertEquals(emptyList<String>(), Forget.expiring("", "http://x"))
	}

	@Test
	fun `9E's first line names the server, and any other page names nothing`() {
		assertEquals("ZEN", Forget.pairedName("✓ PAIRED WITH ZEN · 192.168.1.23:42143"))
		assertEquals("DESKTOP-7Q3K", Forget.pairedName("✓ PAIRED WITH DESKTOP-7Q3K · zen.tailnet.ts.net:8443"))
		assertNull(Forget.pairedName(""))
		assertNull(Forget.pairedName(null))
		assertNull(Forget.pairedName("02 — THE SIX DIGITS ON THE COMPUTER"))
	}

	private val gone = "=; Max-Age=0; Expires=Thu, 01 Jan 1970 00:00:00 GMT; Path=/"

	/** The table both sides read (test/resources/paired-cookies.tsv). */
	private fun table(): List<Pair<String, String>> {
		val text = javaClass.classLoader!!.getResource("paired-cookies.tsv")!!.readText()
		return text.lines()
			.filter { it.isNotBlank() && !it.startsWith("#") }
			.map { it.split('\t').let { (o, n) -> o to n } }
	}

	@Test
	fun `each origin's paired cookie is named as the server names it`() {
		val rows = table()
		assertTrue("the table has its rows", rows.size >= 15)
		for ((origin, name) in rows) {
			assertEquals(origin, name, Forget.pairedCookie(origin))
			// A cookie name is an RFC 6265 token: no ':' of a port, no '[' of IPv6.
			assertTrue(name, Regex("^[A-Za-z0-9_]+$").matches(name))
		}
		assertNull(Forget.pairedCookie("file:///android_asset/pair/index.html"))
		assertNull(Forget.pairedCookie("not a url"))
	}

	@Test
	fun `forget expires its own pairing and the old shared name, never another server's`() {
		// Two servers on one computer: 42143 over http, 8443 over https. The
		// jar hands both servers' cookies to either, since it keys on the host.
		val header =
			"tsundoku_paired_42143=a; tsundoku_paired_s8443=b; tsundoku_paired=old; tsundoku_theme=dark"
		assertEquals(
			listOf("tsundoku_paired_42143$gone", "tsundoku_paired$gone", "tsundoku_theme$gone"),
			Forget.expiring(header, "http://192.168.1.23:42143")
		)
		assertEquals(
			listOf("tsundoku_paired_s8443$gone; Secure", "tsundoku_paired$gone; Secure", "tsundoku_theme$gone; Secure"),
			Forget.expiring(header, "https://192.168.1.23:8443")
		)
		// A third server on the same host with no pairing of its own: neither
		// of the others' goes, the old name does.
		assertEquals(
			listOf("tsundoku_paired$gone", "tsundoku_theme$gone"),
			Forget.expiring(header, "http://192.168.1.23:42144")
		)
		// The same port over the other scheme is another origin too.
		assertEquals(
			listOf("tsundoku_paired$gone", "tsundoku_theme$gone"),
			Forget.expiring(header, "http://192.168.1.23:8443")
		)
	}

	@Test
	fun `9E's name comes from its attribute, and from its first line on an older server`() {
		val line = "✓ PAIRED WITH ZEN · 192.168.1.23:42143"
		assertEquals("ZEN", Forget.pairedNameFrom("ZEN\n$line"))
		// The attribute wins over whatever the line says: a copy change loses nothing.
		assertEquals("ZEN", Forget.pairedNameFrom("ZEN\nTHE LIBRARY IS ON THIS TV"))
		assertEquals("DESKTOP-7Q3K", Forget.pairedNameFrom("  DESKTOP-7Q3K \n"))
		// A server older than c545: no attribute, so the line is parsed.
		assertEquals("ZEN", Forget.pairedNameFrom("\n$line"))
		assertNull(Forget.pairedNameFrom("\nTHE LIBRARY IS ON THIS TV"))
		// Not 9E: PAIRED_JS answers "".
		assertNull(Forget.pairedNameFrom(""))
		assertNull(Forget.pairedNameFrom(null))
		assertNull(Forget.pairedNameFrom("\n"))
		// An answer with no newline is read as a line only, never as a name.
		assertEquals("ZEN", Forget.pairedNameFrom(line))
		assertNull(Forget.pairedNameFrom("ZEN"))
	}
}

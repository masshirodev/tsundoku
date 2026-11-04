package dev.masshiro.tsundoku.tv

import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Test

/**
 * FORGET's two pure pieces (c261, S4): the cookie lines it writes into the
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
}

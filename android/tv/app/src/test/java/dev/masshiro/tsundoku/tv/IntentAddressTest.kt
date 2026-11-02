package dev.masshiro.tsundoku.tv

import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Test

/**
 * The address handed to the app from outside (c260): a launch extra or a
 * `tsundoku://connect?url=` link. It is not typed on the TV, so the parser is
 * stricter than [Address.originOf]: http or https, a host, and nothing but the
 * origin.
 */
class IntentAddressTest {
	@Test
	fun `a given address keeps its origin`() {
		assertEquals("https://zen.tailnet.ts.net:8443", Address.intentOrigin("https://zen.tailnet.ts.net:8443"))
		assertEquals("http://192.168.1.23:42143", Address.intentOrigin("http://192.168.1.23:42143"))
		assertEquals("https://library.example.com", Address.intentOrigin("https://library.example.com"))
		assertEquals("http://zen.local:42143", Address.intentOrigin(" http://zen.local:42143 "))
	}

	@Test
	fun `an origin keeps its port and drops its path, query and fragment`() {
		assertEquals(
			"https://zen.tailnet.ts.net:8443",
			Address.intentOrigin("https://zen.tailnet.ts.net:8443/library?q=1#page")
		)
		assertEquals("http://192.168.1.23:42143", Address.intentOrigin("http://192.168.1.23:42143/pair/tv"))
		assertEquals("https://zen.tailnet.ts.net", Address.intentOrigin("https://zen.tailnet.ts.net/"))
	}

	@Test
	fun `the scheme and the host are compared without case`() {
		assertEquals("https://zen.local:8443", Address.intentOrigin("HTTPS://Zen.Local:8443"))
	}

	@Test
	fun `nothing at all is refused`() {
		assertNull(Address.intentOrigin(null))
		assertNull(Address.intentOrigin(""))
		assertNull(Address.intentOrigin("   "))
	}

	@Test
	fun `only a scheme a WebView opens is accepted`() {
		assertNull(Address.intentOrigin("ftp://zen.local"))
		assertNull(Address.intentOrigin("javascript:alert(1)"))
		assertNull(Address.intentOrigin("file:///sdcard/pair.html"))
		assertNull(Address.intentOrigin("content://media/external/file"))
		assertNull(Address.intentOrigin("intent://zen.local#Intent;end"))
	}

	@Test
	fun `an address without a host is refused`() {
		assertNull(Address.intentOrigin("http://"))
		assertNull(Address.intentOrigin("https:///path"))
		assertNull(Address.intentOrigin("http://:42143"))
		assertNull(Address.intentOrigin("zen.local:42143"))
	}

	@Test
	fun `userinfo is refused, not carried into the origin`() {
		assertNull(Address.intentOrigin("http://user:pass@zen.local:42143"))
		assertNull(Address.intentOrigin("https://user@zen.local"))
		assertNull(Address.intentOrigin("http://@zen.local"))
	}
}

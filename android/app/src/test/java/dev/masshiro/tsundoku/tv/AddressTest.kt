package dev.masshiro.tsundoku.tv

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * What the address screen writes for the TV, and the not-answering screen's
 * third reason. Pure: the parsing is the part worth pinning.
 */
class AddressTest {
	@Test
	fun `the prefix is the TV's first three numbers`() {
		assertEquals("192.168.1.", Address.prefixOf("192.168.1.40"))
		assertEquals("10.0.0.", Address.prefixOf("10.0.0.7"))
		assertEquals("172.16.31.", Address.prefixOf("172.16.31.255"))
	}

	@Test
	fun `anything that is not a dotted IPv4 has no prefix`() {
		assertNull(Address.prefixOf(""))
		assertNull(Address.prefixOf(null))
		assertNull(Address.prefixOf("192.168.1"))
		assertNull(Address.prefixOf("192.168.1.999"))
		assertNull(Address.prefixOf("192.168.1.40.1"))
		assertNull(Address.prefixOf("fe80::1"))
	}

	@Test
	fun `a typed last number becomes the address`() {
		assertEquals("http://192.168.1.23:42143", Address.withLast("192.168.1.", "23", 42143))
		assertEquals("http://192.168.1.0:42143", Address.withLast("192.168.1.", "0", 42143))
		assertEquals("http://192.168.1.255:42143", Address.withLast("192.168.1.", "255", 42143))
		assertNull(Address.withLast("192.168.1.", "256", 42143))
		assertNull(Address.withLast("192.168.1.", "", 42143))
		assertNull(Address.withLast("192.168.1.", "abc", 42143))
	}

	@Test
	fun `a whole address is kept, with or without its scheme`() {
		assertEquals("http://192.168.1.23:42143", Address.originOf("192.168.1.23:42143"))
		assertEquals("http://192.168.1.23:42143", Address.originOf("http://192.168.1.23:42143/"))
		assertEquals("https://zen.tailnet.ts.net:8443", Address.originOf("https://zen.tailnet.ts.net:8443/"))
		assertEquals("http://zen.local:42143", Address.originOf("zen.local:42143"))
		assertNull(Address.originOf(""))
		assertNull(Address.originOf(null))
	}

	@Test
	fun `only the home network counts as private, not Tailscale`() {
		assertTrue(Address.isPrivateV4("192.168.1.40"))
		assertTrue(Address.isPrivateV4("10.0.0.7"))
		assertTrue(Address.isPrivateV4("172.16.0.1"))
		assertFalse(Address.isPrivateV4("172.32.0.1"))
		assertFalse(Address.isPrivateV4("100.101.1.2"))
		assertFalse(Address.isPrivateV4("8.8.8.8"))
		assertFalse(Address.isPrivateV4("nope"))
	}

	@Test
	fun `the scheme's own port is dropped, as WebView's URL drops it`() {
		assertEquals("https://lib.example.com", Address.originOf("https://lib.example.com:443/"))
		assertEquals("http://192.168.1.23", Address.originOf("192.168.1.23:80"))
		assertEquals("https://lib.example.com", Address.intentOrigin("https://lib.example.com:443/x"))
		assertEquals("http://zen.local", Address.intentOrigin("http://zen.local:80"))
		// Not the other scheme's: 443 over http and 80 over https are kept.
		assertEquals("http://lib.example.com:443", Address.originOf("http://lib.example.com:443"))
		assertEquals("https://zen.local:80", Address.intentOrigin("https://zen.local:80"))
	}

	@Test
	fun `a host and a scheme typed in capitals come back lower case`() {
		assertEquals("http://zen.local:42143", Address.originOf("http://Zen.local:42143"))
		assertEquals("http://zen.local:42143", Address.originOf("Zen.LOCAL:42143/series/1"))
		assertEquals("https://zen.tailnet.ts.net:8443", Address.originOf("HTTPS://ZEN.tailnet.ts.net:8443/"))
		// A scheme in capitals is a scheme: not a host to put http:// before.
		assertEquals("http://zen.local:42143", Address.originOf("HTTP://Zen.local:42143"))
		assertEquals("http://zen.local", Address.originOf("Http://Zen.local:80"))
		// The same answer intentOrigin gives for the same address.
		assertEquals(Address.intentOrigin("http://Zen.local:42143"), Address.originOf("http://Zen.local:42143"))
	}

	@Test
	fun `originOf holds on its own output`() {
		for (typed in listOf("HTTP://Zen.local:42143", "Zen.local:42143", "https://Lib.Example.com:443/x", "192.168.1.23:42143")) {
			val once = Address.originOf(typed)
			assertEquals(once, Address.originOf(once))
		}
	}
}

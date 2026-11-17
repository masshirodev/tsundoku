package dev.masshiro.tsundoku.tv

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * The device's own home address, and whether a phone is on mobile data
 * (Network.kt). A carrier's 10.x is private and must never become 9B's
 * prefix.
 */
class NetworkTest {
	@Test
	fun `a TV on Wi-Fi or Ethernet has its address, as before`() {
		assertEquals("192.168.1.40", Network.homeV4(listOf("wlan0" to "192.168.1.40")))
		assertEquals("192.168.1.41", Network.homeV4(listOf("eth0" to "192.168.1.41")))
		assertEquals(Network.State.HOME, Network.state(listOf("eth0" to "192.168.1.41")))
	}

	@Test
	fun `Wi-Fi comes before any other home address`() {
		val found = listOf("eth0" to "10.0.0.5", "wlan0" to "192.168.1.40")
		assertEquals("192.168.1.40", Network.homeV4(found))
	}

	@Test
	fun `a carrier's private address is never the home one`() {
		val found = listOf("rmnet_data0" to "10.123.45.67")
		assertNull(Network.homeV4(found))
		assertEquals(Network.State.DATA, Network.state(found))
	}

	@Test
	fun `a phone on Wi-Fi with data on still uses the Wi-Fi`() {
		val found = listOf("rmnet_data0" to "10.123.45.67", "wlan0" to "192.168.1.40")
		assertEquals("192.168.1.40", Network.homeV4(found))
		assertEquals(Network.State.HOME, Network.state(found))
	}

	@Test
	fun `a VPN's tunnel is no home network`() {
		val found = listOf("tun0" to "10.8.0.2", "rmnet0" to "10.1.2.3")
		assertNull(Network.homeV4(found))
		assertEquals(Network.State.DATA, Network.state(found))
	}

	@Test
	fun `MediaTek and other vendors' modems are cellular too`() {
		assertTrue(Network.isCellular("ccmni0"))
		assertTrue(Network.isCellular("rmnet_ipa0"))
		assertTrue(Network.isCellular("v4-rmnet_data0"))
		assertFalse(Network.isCellular("wlan0"))
		assertFalse(Network.isCellular("eth0"))
	}

	@Test
	fun `nothing at all is NONE`() {
		assertNull(Network.homeV4(emptyList()))
		assertEquals(Network.State.NONE, Network.state(emptyList()))
		// A public address on Wi-Fi (plugged into the modem) is no home address.
		assertEquals(Network.State.NONE, Network.state(listOf("wlan0" to "203.0.113.9")))
	}
}

package dev.masshiro.tsundoku.tv

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

/** Where BACK goes once the page has nothing left to take (Back.kt). */
class BackTest {
	private val host = "https://archlinux.example.ts.net:8443"

	@Test
	fun `the library is home, so BACK leaves the app from it`() {
		// The owner's TV, 2026-11-02: the sign-in behind the library sent BACK
		// round to the library again, and the app never closed.
		assertNull(Back.steps("$host/", listOf("$host/login", "$host/?shelf=new")))
		assertNull(Back.steps("$host/?shelf=all&sort=title", listOf("$host/")))
		assertNull(Back.steps(host, emptyList()))
	}

	@Test
	fun `elsewhere BACK goes to the screen before`() {
		assertEquals(1, Back.steps("$host/series/4", listOf("$host/", "$host/?shelf=all")))
		assertEquals(1, Back.steps("$host/read/9", listOf("$host/", "$host/series/4")))
	}

	@Test
	fun `sign-in, pairing and the app's first screens are passed over`() {
		val history =
			listOf(
				BridgeGuard.ASSET + "#lost=x",
				"$host/pair/tv",
				"$host/settings",
				"$host/login",
				"$host/welcome",
			)
		assertEquals(3, Back.steps("$host/series/4", history))
	}

	@Test
	fun `with nothing but those behind it, BACK leaves`() {
		assertNull(Back.steps("$host/series/4", listOf("$host/login", "$host/pair/tv")))
		assertNull(Back.steps("$host/series/4", emptyList()))
	}

	@Test
	fun `what counts as home and what is passed over`() {
		assertTrue(Back.isHome("http://192.168.1.23:42143/"))
		assertFalse(Back.isHome("http://192.168.1.23:42143/series/1"))
		// The app's own page is never home and never a history stop, whatever
		// its URL was before the asset loader (c549).
		assertFalse(Back.isHome(BridgeGuard.ASSET))
		assertTrue(Back.passedOver(BridgeGuard.ASSET))
		assertTrue(Back.passedOver(BridgeGuard.ASSET + "#add"))
		assertFalse(Back.isHome("file:///android_asset/pair/index.html"))
		assertTrue(Back.passedOver("$host/pair/abc123"))
		assertTrue(Back.passedOver("not a url"))
		assertFalse(Back.passedOver("$host/history"))
	}
}

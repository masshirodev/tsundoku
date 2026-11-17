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
		// The sign-in behind the library sent BACK round to the library again,
		// and the app never closed.
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
		// The app's own page is never home and never a history stop, at the
		// asset loader's URL or at its `file://` one.
		assertFalse(Back.isHome(BridgeGuard.ASSET))
		assertTrue(Back.passedOver(BridgeGuard.ASSET))
		assertTrue(Back.passedOver(BridgeGuard.ASSET + "#add"))
		assertFalse(Back.isHome("file:///android_asset/pair/index.html"))
		assertTrue(Back.passedOver("$host/pair/abc123"))
		assertTrue(Back.passedOver("not a url"))
		assertFalse(Back.passedOver("$host/history"))
	}

	@Test
	fun `what reaches the log keeps nothing a stranger could use`() {
		assertEquals("$host/help", Back.forLog("$host/help?from=a#b"))
		assertEquals("$host/", Back.forLog("$host/?shelf=all"))
		assertEquals(host, Back.forLog(host))
		// The asset page's capability and the link it was opened through.
		assertEquals(
			"https://appassets.androidplatform.net/pair/…",
			Back.forLog("https://appassets.androidplatform.net/pair/index.html?t=SECRET#connect=https%3A%2F%2Fx")
		)
		// A pairing code in the path is a token as much as one in the query.
		assertEquals("$host/pair/…", Back.forLog("$host/pair/abc123"))
		assertEquals("$host/pair/…", Back.forLog("$host/pair/tv"))
		assertEquals("$host/pair/…", Back.forLog("$host/pair"))
		assertEquals("https://h/x", Back.forLog("https://u:p@h/x?a#b"))
		// A shape URI can not read still comes out cut, never thrown on.
		assertEquals("not a url", Back.forLog("not a url?x"))
		assertEquals("about:blank", Back.forLog("about:blank"))
	}

	@Test
	fun `the leave line names the reason, and carries no token`() {
		val line =
			Back.leaveLine(
				steps = 1,
				canGoBack = false,
				current = "$host/help?token=SECRET#connect=OTHER",
				shown = "$host/pair/abc123",
				index = 3,
				size = 5,
				held = true,
				verdict = LeaveWindow.Verdict.LEAVE
			)
		assertEquals(
			"leave: LEAVE steps=1 canGoBack=false current=$host/help shown=$host/pair/… index=3 size=5 held=true",
			line
		)
		assertFalse(line.contains("SECRET"))
		assertFalse(line.contains("OTHER"))
		assertFalse(line.contains("abc123"))
		assertTrue(Back.leaveLine(null, false, "$host/", null, 0, 1, false, LeaveWindow.Verdict.TOAST).contains("shown=null"))
	}
}

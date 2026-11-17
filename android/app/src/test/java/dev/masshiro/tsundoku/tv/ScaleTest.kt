package dev.masshiro.tsundoku.tv

import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * The WebView's scale (doc/TV.md, "Claims to check"). `setInitialScale`
 * is in physical pixels (Scale.kt says why), so the percent depends on the
 * panel's pixels alone, never on its density.
 */
class ScaleTest {
	private fun assertLands(widthPx: Int) {
		val css = Scale.cssWidth(widthPx, Scale.percentFor(widthPx))
		assertTrue("a $widthPx px panel lays out $css CSS px, not ~960", css in 955f..965f)
	}

	@Test
	fun `a 1080p panel is zoomed to 200, whatever its density`() {
		assertEquals(200, Scale.percentFor(1920))
		assertLands(1920)
	}

	@Test
	fun `a 720p panel is zoomed to 133`() {
		assertEquals(133, Scale.percentFor(1280))
		assertLands(1280)
	}

	@Test
	fun `a 4K panel is zoomed to 400`() {
		assertEquals(400, Scale.percentFor(3840))
		assertLands(3840)
	}

	@Test
	fun `a 960 px panel is left at one CSS px per pixel`() {
		assertEquals(100, Scale.percentFor(960))
	}

	@Test
	fun `an unknown display leaves the WebView's default`() {
		assertEquals(0, Scale.percentFor(0))
		assertEquals(0, Scale.percentFor(-1))
	}

	@Test
	fun `an absurd report is clamped`() {
		assertEquals(25, Scale.percentFor(10))
		assertEquals(400, Scale.percentFor(100_000))
	}
}

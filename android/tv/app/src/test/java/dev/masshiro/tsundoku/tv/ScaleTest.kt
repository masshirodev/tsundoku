package dev.masshiro.tsundoku.tv

import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * The WebView's scale (c236; doc/TV.md, "Claims to check"): a TV that reports
 * 1280x720 must land on the handoff's 960 CSS px, not on 853 (a tablet) or
 * 1280 (the wide layout's breakpoint would fire).
 */
class ScaleTest {
	@Test
	fun `a 1080p panel at density 2 is already 960`() {
		assertEquals(100, Scale.percentFor(960f))
	}

	@Test
	fun `a 720p panel at density 1_5 is zoomed out to 960`() {
		// 1280 px / 1.5 = 853.33 dp; the scale makes the layout about 960 CSS px.
		val percent = Scale.percentFor(1280f / 1.5f)
		assertEquals(89, percent)
		val css = (1280f / 1.5f) / (percent / 100f)
		assertTrue("the layout is $css CSS px, not ~960", css in 950f..970f)
	}

	@Test
	fun `a panel reporting more than 960 dp is zoomed in`() {
		assertEquals(200, Scale.percentFor(1920f))
		assertEquals(133, Scale.percentFor(1280f))
	}

	@Test
	fun `an unknown display changes nothing`() {
		assertEquals(100, Scale.percentFor(0f))
		assertEquals(100, Scale.percentFor(-1f))
	}

	@Test
	fun `an absurd report is clamped, never a zero scale`() {
		assertEquals(25, Scale.percentFor(10f))
		assertEquals(400, Scale.percentFor(100_000f))
	}
}

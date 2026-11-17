package dev.masshiro.tsundoku.tv

import dev.masshiro.tsundoku.tv.Insets.Sides
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * The camera band and the keyboard on a phone or tablet (Insets.kt).
 * The numbers are physical pixels, as Android hands them over.
 */
class InsetsTest {
	private val none = Sides()

	@Test
	fun `a portrait phone is padded by its cutout at the top`() {
		val cutout = Sides(top = 96)
		assertEquals(Sides(top = 96), Insets.padding(cutout, none, none))
	}

	@Test
	fun `a turned phone is padded on the side the camera is on`() {
		assertEquals(Sides(left = 96), Insets.padding(Sides(left = 96), none, none))
		assertEquals(Sides(right = 96), Insets.padding(Sides(right = 96), none, none))
	}

	@Test
	fun `the open keyboard ends the page on its top edge`() {
		val p = Insets.padding(Sides(top = 96), Sides(bottom = 900), Sides(bottom = 48))
		assertEquals(Sides(top = 96, bottom = 900), p)
	}

	@Test
	fun `with the keyboard closed the page ends above the home gesture`() {
		val p = Insets.padding(Sides(top = 96), none, Sides(bottom = 48))
		assertEquals(Sides(top = 96, bottom = 48), p)
	}

	@Test
	fun `three-button navigation has no gesture strip, so nothing is lost`() {
		assertEquals(Sides(top = 96), Insets.padding(Sides(top = 96), none, none))
	}

	@Test
	fun `a cutout at the bottom still counts under a closed keyboard`() {
		val p = Insets.padding(Sides(bottom = 120), none, Sides(bottom = 48))
		assertEquals(Sides(bottom = 120), p)
	}

	@Test
	fun `a device with no cutout and no keyboard is not padded at all`() {
		assertEquals(none, Insets.padding(none, none, none))
	}

	@Test
	fun `negative numbers from a broken build count as nothing`() {
		val p = Insets.padding(Sides(-1, -2, -3, -4), Sides(bottom = -5), Sides(bottom = -6))
		assertEquals(none, p)
	}

	@Test
	fun `a page drawn edge to edge runs under the camera, the keyboard still pads`() {
		val cutout = Sides(top = 96)
		val gestures = Sides(bottom = 48)
		assertEquals(none, Insets.padding(cutout, none, gestures, edge = true))
		assertEquals(Sides(bottom = 900), Insets.padding(cutout, Sides(bottom = 900), gestures, edge = true))
		// Turned: the side the camera is on is drawn too.
		assertEquals(none, Insets.padding(Sides(left = 96), none, none, edge = true))
	}

	@Test
	fun `the page is told the band and the gesture strip in CSS px`() {
		val s = Insets.css(Sides(top = 96), Sides(bottom = 48), density = 3f)
		assertEquals(Sides(top = 32, bottom = 16), s)
		assertEquals(Sides(left = 32), Insets.css(Sides(left = 96), none, 3f))
		// A cutout at the bottom wins over a smaller gesture strip.
		assertEquals(Sides(bottom = 40), Insets.css(Sides(bottom = 120), Sides(bottom = 48), 3f))
		assertEquals(none, Insets.css(Sides(top = 96), none, 0f))
	}

	@Test
	fun `the variables are set on the root, in px`() {
		val js = Insets.cssScript(Sides(top = 32, bottom = 16))
		assertTrue(js.contains("'--app-inset-top','32px'"))
		assertTrue(js.contains("'--app-inset-bottom','16px'"))
		assertTrue(js.contains("'--app-inset-left','0px'"))
	}

	@Test
	fun `the page's colour is read from getComputedStyle or a hex`() {
		assertEquals(0xFF0E0F10.toInt(), Insets.parseColor("rgb(14, 15, 16)"))
		assertEquals(0xFF0E0F10.toInt(), Insets.parseColor("rgba(14, 15, 16, 1)"))
		assertEquals(0xFF0E0F10.toInt(), Insets.parseColor("#0e0f10"))
		assertEquals(0xFF0E0F10.toInt(), Insets.parseColor(" #0E0F10 "))
		assertEquals(0xFFFFFFFF.toInt(), Insets.parseColor("#fff"))
	}

	@Test
	fun `anything that is not a solid colour leaves the band as it was`() {
		assertNull(Insets.parseColor(null))
		assertNull(Insets.parseColor(""))
		assertNull(Insets.parseColor("rgba(0, 0, 0, 0)"))
		assertNull(Insets.parseColor("rgba(14, 15, 16, 0.5)"))
		assertNull(Insets.parseColor("rgb(300, 0, 0)"))
		assertNull(Insets.parseColor("oklch(0.2 0.01 95)"))
		assertNull(Insets.parseColor("red"))
		assertNull(Insets.parseColor("#12345"))
		assertNull(Insets.parseColor("url(javascript:alert(1))"))
	}
}

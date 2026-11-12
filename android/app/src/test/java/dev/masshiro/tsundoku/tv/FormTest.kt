package dev.masshiro.tsundoku.tv

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * What the TV build and the phone and tablet build do differently (c521;
 * Form.kt's table). Each row of that table is one test here.
 */
class FormTest {
	@Test
	fun `the flavor's id names its form, and anything else is the TV`() {
		assertEquals(Form.TV, Form.of("tv"))
		assertEquals(Form.MOBILE, Form.of("mobile"))
		// Every build before c521 was the TV's, and BuildConfig.FORM may be absent.
		assertEquals(Form.TV, Form.of(null))
		assertEquals(Form.TV, Form.of(""))
		assertEquals(Form.TV, Form.of("MOBILE"))
	}

	@Test
	fun `only the TV pins the page to 960 and takes the remote's keys`() {
		assertTrue(Form.TV.pinsWidth)
		assertTrue(Form.TV.takesRemoteKeys)
		assertFalse(Form.MOBILE.pinsWidth)
		assertFalse(Form.MOBILE.takesRemoteKeys)
	}

	@Test
	fun `only the phone pads the cutout`() {
		assertTrue(Form.MOBILE.padsInsets)
		assertFalse(Form.TV.padsInsets)
	}

	@Test
	fun `only the phone turns for a fullscreen picture`() {
		assertTrue(Form.MOBILE.turnsForVideo)
		assertFalse(Form.TV.turnsForVideo)
	}

	@Test
	fun `only the phone raises the keyboard for a page, never the TV (c247)`() {
		assertTrue(Form.MOBILE.raisesKeyboard)
		assertFalse(Form.TV.raisesKeyboard)
	}

	@Test
	fun `each form says itself in the user agent, with the version`() {
		assertEquals("TsundokuTV/2026.11.05", Form.TV.userAgentToken("2026.11.05"))
		assertEquals("TsundokuApp/2026.11.05", Form.MOBILE.userAgentToken("2026.11.05"))
	}

	@Test
	fun `the TV's text is always 100, whatever the TV's font size`() {
		assertEquals(100, Form.TV.textZoom(1f))
		assertEquals(100, Form.TV.textZoom(1.3f))
		assertEquals(100, Form.TV.textZoom(2f))
	}

	@Test
	fun `a phone follows Android's font size up to 130`() {
		assertEquals(100, Form.MOBILE.textZoom(1f))
		assertEquals(115, Form.MOBILE.textZoom(1.15f))
		assertEquals(130, Form.MOBILE.textZoom(1.3f))
		// Past the cap the web app's fixed bars would clip (the design's question 2).
		assertEquals(130, Form.MOBILE.textZoom(1.5f))
		assertEquals(130, Form.MOBILE.textZoom(2f))
	}

	@Test
	fun `a smaller font is honoured, and an unknown one is 100`() {
		assertEquals(85, Form.MOBILE.textZoom(0.85f))
		assertEquals(100, Form.MOBILE.textZoom(0f))
		assertEquals(100, Form.MOBILE.textZoom(-1f))
		assertEquals(100, Form.MOBILE.textZoom(Float.NaN))
	}
}

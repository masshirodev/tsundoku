package dev.masshiro.tsundoku.tv

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * "Does the computer answer?" (the not-answering screen). The manifest's
 * name is tsundoku's, so it is the cheap GET that only tsundoku answers.
 */
class ProbeTest {
	@Test
	fun `the manifest is what it asks for`() {
		assertEquals("http://192.168.1.23:42143/manifest.webmanifest", Probe.urlOf("http://192.168.1.23:42143"))
		assertEquals("http://192.168.1.23:42143/manifest.webmanifest", Probe.urlOf("http://192.168.1.23:42143/"))
	}

	@Test
	fun `a tsundoku manifest answers`() {
		assertTrue(Probe.accepts(200, """{"name": "tsundoku 積ん読"}"""))
		assertTrue(Probe.accepts(200, "Tsundoku"))
	}

	@Test
	fun `anything else does not`() {
		assertFalse(Probe.accepts(200, """{"name": "My NAS"}"""))
		assertFalse(Probe.accepts(404, """{"name": "tsundoku"}"""))
		assertFalse(Probe.accepts(500, "tsundoku"))
		assertFalse(Probe.accepts(200, ""))
	}
}

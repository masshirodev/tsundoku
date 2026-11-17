package dev.masshiro.tsundoku.tv

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

/** Release versions and Android's versionCode (Versions.kt). */
class VersionsTest {
	@Test
	fun `a later day, and a later N on the same day, are newer`() {
		assertTrue(Versions.newer("2026.11.06", "2026.11.05"))
		assertTrue(Versions.newer("2026.11.05.1", "2026.11.05"))
		assertTrue(Versions.newer("2026.11.05.10", "2026.11.05.9"))
		assertFalse(Versions.newer("2026.11.05", "2026.11.05"))
		assertFalse(Versions.newer("2026.11.04", "2026.11.05"))
	}

	@Test
	fun `a dev build counts by its date, so its own day's release is not newer, the next one is`() {
		assertFalse(Versions.newer("2026.11.05", "2026.11.05-dev2"))
		assertTrue(Versions.newer("2026.11.05.1", "2026.11.05-dev2"))
		assertTrue(Versions.newer("2026.11.06", "2026.11.05-dev2"))
	}

	@Test
	fun `a build with no date version is older than any release`() {
		assertTrue(Versions.newer("2026.11.05", "1.0.0"))
		assertFalse(Versions.newer("1.0.0", "2026.11.05"))
		assertNull(Versions.parts("1.0.0"))
	}

	@Test
	fun `versionCode is YYYYMMDDNN, and 1 for a build with no date version`() {
		assertEquals(2026110500, Versions.code("2026.11.05"))
		assertEquals(2026110502, Versions.code("2026.11.05.2"))
		assertEquals(2026110500, Versions.code("2026.11.05-dev2"))
		assertEquals(1, Versions.code("1.0.0"))
		assertTrue(Versions.code("2026.11.06") > Versions.code("2026.11.05.99"))
		// It stays an Int for as long as anyone reads this.
		assertTrue(Versions.code("2099.12.31.99") < Int.MAX_VALUE)
	}

	@Test
	fun `the build's own versionCode is the rule's, whatever version it was given`() {
		// app/build.gradle.kts computes it at build time; this is that number.
		assertEquals(Versions.code(BuildConfig.VERSION_NAME), BuildConfig.VERSION_CODE)
	}
}

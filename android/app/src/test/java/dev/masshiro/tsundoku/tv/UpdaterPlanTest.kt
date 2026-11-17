package dev.masshiro.tsundoku.tv

import dev.masshiro.tsundoku.tv.ReleaseCheck.Release
import dev.masshiro.tsundoku.tv.ReleaseCheck.ReleaseFile
import dev.masshiro.tsundoku.tv.Updater.Plan
import org.json.JSONObject
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

/** When the app looks for an update, and what it offers (Updater.Plan). */
class UpdaterPlanTest {
	private val apk = ReleaseFile("tsundoku-app.apk", 9_000_000, "a".repeat(64))

	@Test
	fun `it looks on launch once a day, and when it never has`() {
		val now = 10 * Plan.DAY
		assertTrue(Plan.due(0, now))
		assertTrue(Plan.due(now - Plan.DAY, now))
		assertFalse(Plan.due(now - Plan.DAY + 1, now))
		// A clock set back is no reason to wait a day longer.
		assertTrue(Plan.due(now + 1000, now))
	}

	@Test
	fun `only a newer release with this form's APK is offered`() {
		assertTrue(Plan.offer(Release("2026.11.06", "2026-11-06", "", apk), "2026.11.05"))
		assertFalse(Plan.offer(Release("2026.11.05", "2026-11-05", "", apk), "2026.11.05"))
		assertFalse(Plan.offer(Release("2026.11.04", "2026-11-04", "", apk), "2026.11.05"))
		// A release published before the apps were, with nothing for this one.
		assertFalse(Plan.offer(Release("2026.11.06", "2026-11-06", "", null), "2026.11.05"))
		// A dev build is offered the next release.
		assertTrue(Plan.offer(Release("2026.11.06", "2026-11-06", "", apk), "2026.11.05-dev2"))
	}

	@Test
	fun `a release is kept in the cache under its own version`() {
		assertEquals("tsundoku-2026.11.06.apk", Plan.cacheName(Release("2026.11.06", "", "", apk)))
	}

	@Test
	fun `the page is told the running version, the phase and the release`() {
		val s = Updater.State("2026.11.05", Updater.Phase.DOWNLOADING, Release("2026.11.06", "2026-11-06", "Faster.", apk), got = 4_500_000, checkedAt = 42)
		val o = JSONObject(s.toJson())
		assertEquals("2026.11.05", o.getString("running"))
		assertEquals("downloading", o.getString("phase"))
		assertEquals("2026.11.06", o.getString("version"))
		assertEquals("Faster.", o.getString("notes"))
		assertEquals(9_000_000, o.getLong("size"))
		assertEquals(4_500_000, o.getLong("got"))
		assertEquals(42, o.getLong("checkedAt"))
		// No release yet: just what is running.
		val idle = JSONObject(Updater.State("2026.11.05").toJson())
		assertFalse(idle.has("version"))
		assertFalse(idle.has("got"))
	}
}

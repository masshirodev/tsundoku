package dev.masshiro.tsundoku.tv

import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * FailedLoad in every order WebView can report a failed main-frame load
 * (c532): the failed load's own finish never counts, whatever came between,
 * and the next finish of that server does.
 */
class FailedLoadTest {
	private val home = "http://192.168.1.23:42143"
	private val zen = "https://zen.tailnet.ts.net:8443"

	@Test
	fun `started, error, finished - the failed load does not count`() {
		val f = FailedLoad()
		f.started(home)
		f.failed(home)
		assertFalse(f.finished(home))
	}

	@Test
	fun `error, started, finished - a committed error page does not count either (c532)`() {
		// The order wave 21's FailedLoad lost: its start cleared the mark the
		// finish was about to read, and the dead server became the last used.
		val f = FailedLoad()
		f.failed(home)
		f.started(home)
		assertFalse(f.finished(home))
	}

	@Test
	fun `error, finished, then a retry's start and finish counts as a visit`() {
		val f = FailedLoad()
		f.started(home)
		f.failed(home)
		assertFalse(f.finished(home))
		// TRY AGAIN: a new start, and this time the page loads.
		f.started(home)
		assertTrue(f.finished(home))
	}

	@Test
	fun `a retry that fails again does not count, and the one after it does`() {
		val f = FailedLoad()
		f.started(home)
		f.failed(home)
		assertFalse(f.finished(home))
		f.started(home)
		f.failed(home)
		assertFalse(f.finished(home))
		f.started(home)
		assertTrue(f.finished(home))
	}

	@Test
	fun `9D's asset starting in between does not end the mark`() {
		val f = FailedLoad()
		f.started(home)
		f.failed(home)
		f.started("file:///android_asset")
		assertFalse(f.finished(home))
	}

	@Test
	fun `another server's failure does not stop one that loads`() {
		val f = FailedLoad()
		f.failed(zen)
		f.started(home)
		assertTrue(f.finished(home))
		assertFalse(f.finished(zen))
	}

	@Test
	fun `with nothing failed every finish counts`() {
		val f = FailedLoad()
		f.started(home)
		assertTrue(f.finished(home))
		assertTrue(f.finished(home))
	}
}

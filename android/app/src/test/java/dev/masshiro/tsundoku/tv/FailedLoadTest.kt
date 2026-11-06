package dev.masshiro.tsundoku.tv

import org.junit.Assert.assertEquals
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
		f.started(BridgeGuard.ASSET)
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

	private val b = "http://192.168.1.40:42143"

	@Test
	fun `a failed load with no finish does not swallow the retry's visit (round 2)`() {
		// SERVERS -> B, B is down: onReceivedError shows 9D at once and the
		// failed URL never finishes. B comes back, 9D's probe opens it again.
		val f = FailedLoad()
		f.attempt(b)
		f.failed(b)
		f.attempt(b)
		f.started(b)
		assertTrue(f.finished(b))
	}

	@Test
	fun `attempt, error, started, finished - the card's order still skips once`() {
		val f = FailedLoad()
		f.attempt(b)
		f.failed(b)
		f.started(b)
		assertFalse(f.finished(b))
		assertTrue(f.finished(b))
	}

	@Test
	fun `attempt, error, finished skips, and the next attempt's finish counts`() {
		val f = FailedLoad()
		f.attempt(b)
		f.failed(b)
		assertFalse(f.finished(b))
		f.attempt(b)
		f.started(b)
		assertTrue(f.finished(b))
	}

	@Test
	fun `an attempt at another server leaves the mark alone`() {
		val f = FailedLoad()
		f.failed(b)
		f.attempt(home)
		assertFalse(f.finished(b))
	}

	@Test
	fun `a failed pair-tv load consumes its mark, so the library load after it is a visit`() {
		// No attempt between: 9E's own navigation to /pair/tv is not the
		// app's open, and its committed error page does finish.
		val f = FailedLoad()
		f.failed(b)
		f.started(b)
		assertEquals(FailedLoad.Finish.SKIP, f.finish(b, "/pair/tv", known = true))
		f.started(b)
		assertEquals(FailedLoad.Finish.VISIT, f.finish(b, "/", known = true))
	}

	@Test
	fun `a pair-tv page that loaded is read for 9E's name, not counted`() {
		val f = FailedLoad()
		f.started(b)
		assertEquals(FailedLoad.Finish.PAIRED_PAGE, f.finish(b, "/pair/tv", known = true))
	}

	@Test
	fun `a server this TV does not know is never a visit`() {
		val f = FailedLoad()
		assertEquals(FailedLoad.Finish.SKIP, f.finish(b, "/", known = false))
		assertEquals(FailedLoad.Finish.SKIP, f.finish(b, "/pair/tv", known = false))
	}
}

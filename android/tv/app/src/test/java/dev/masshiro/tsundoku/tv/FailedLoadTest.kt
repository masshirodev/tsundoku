package dev.masshiro.tsundoku.tv

import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class FailedLoadTest {
	private val home = "http://192.168.1.23:42143"
	private val zen = "https://zen.tailnet.ts.net:8443"

	@Test
	fun `a load that failed does not count as opening its server`() {
		val f = FailedLoad()
		f.started(home)
		f.failed(home)
		// 9D's asset loads in between; it is not a server.
		f.started("file:///android_asset")
		assertFalse(f.finished(home))
	}

	@Test
	fun `a later attempt at the same server that loads counts again`() {
		val f = FailedLoad()
		f.started(home)
		f.failed(home)
		assertFalse(f.finished(home))
		f.started(home)
		assertTrue(f.finished(home))
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
	}
}

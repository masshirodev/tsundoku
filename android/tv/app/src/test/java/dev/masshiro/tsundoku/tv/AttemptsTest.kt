package dev.masshiro.tsundoku.tv

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * c306: a launch that lands inside the remembered address's probe owns the
 * WebView. Each case is the activity's sequence of doors and answers, with
 * the pages the WebView would be told to load written down in order.
 */
class AttemptsTest {
	private val loaded = mutableListOf<String>()
	private val attempts = Attempts()

	/** onCreate with a remembered address: the probe starts, its answer comes later. */
	private fun rememberedProbe(): Int = attempts.begin()

	private fun probeAnswered(attempt: Int, ok: Boolean, remembered: String) =
		attempts.answer(attempt) { loaded += if (ok) remembered else "#lost=$remembered" }

	/** onNewIntent → takeGiven: 9B is loaded at once. */
	private fun given(origin: String) {
		attempts.begin()
		loaded += "#connect=$origin"
	}

	@Test
	fun `a probe nobody interrupted opens what it found`() {
		val mine = rememberedProbe()
		assertTrue(probeAnswered(mine, true, "http://zen.local:42143"))
		assertEquals(listOf("http://zen.local:42143"), loaded)
	}

	@Test
	fun `a probe nobody interrupted shows 9D when nothing answers`() {
		val mine = rememberedProbe()
		assertTrue(probeAnswered(mine, false, "http://zen.local:42143"))
		assertEquals(listOf("#lost=http://zen.local:42143"), loaded)
	}

	@Test
	fun `a given address during the probe is not replaced by the library`() {
		val mine = rememberedProbe()
		given("http://192.168.1.23:42143")
		assertFalse(probeAnswered(mine, true, "http://zen.local:42143"))
		assertEquals(listOf("#connect=http://192.168.1.23:42143"), loaded)
	}

	@Test
	fun `a given address during the probe is not replaced by 9D naming the remembered one`() {
		val mine = rememberedProbe()
		given("http://192.168.1.23:42143")
		assertFalse(probeAnswered(mine, false, "http://zen.local:42143"))
		assertEquals(listOf("#connect=http://192.168.1.23:42143"), loaded)
	}

	@Test
	fun `two given addresses during the probe leave the last one in hand`() {
		val mine = rememberedProbe()
		given("http://a.local:42143")
		given("http://b.local:42143")
		assertFalse(probeAnswered(mine, true, "http://zen.local:42143"))
		assertEquals(listOf("#connect=http://a.local:42143", "#connect=http://b.local:42143"), loaded)
	}

	@Test
	fun `each door's attempt is current until the next door opens`() {
		val first = attempts.begin()
		assertTrue(attempts.current(first))
		val second = attempts.begin()
		assertFalse(attempts.current(first))
		assertTrue(attempts.current(second))
	}
}

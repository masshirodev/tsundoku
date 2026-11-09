package dev.masshiro.tsundoku.tv

import dev.masshiro.tsundoku.tv.LeaveWindow.Verdict.LEAVE
import dev.masshiro.tsundoku.tv.LeaveWindow.Verdict.NOTHING
import dev.masshiro.tsundoku.tv.LeaveWindow.Verdict.TOAST
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test
import java.io.File

/** The second press BACK has to make to leave the app (LeaveWindow.kt, c859). */
class LeaveWindowTest {
	private val t = 10_000L

	@Test
	fun `the first press only says so, and a second inside the window leaves`() {
		val w = LeaveWindow()
		assertEquals(TOAST, w.press(t))
		assertEquals(LEAVE, w.press(t + 1000))
	}

	@Test
	fun `the window is two seconds, with the edge on the outside`() {
		assertEquals(2000L, LeaveWindow.LASTS_MS)
		LeaveWindow().let {
			it.press(t)
			assertEquals(LEAVE, it.press(t + 1999))
		}
		LeaveWindow().let {
			it.press(t)
			// Past it, this is a new first press, not the second.
			assertEquals(TOAST, it.press(t + 2000))
			assertEquals(LEAVE, it.press(t + 3000))
		}
	}

	@Test
	fun `one press delivered as two does not leave, whenever the double lands`() {
		assertEquals(400L, LeaveWindow.DOUBLED_MS)
		for (gap in listOf(0L, 1L, 30L, 108L, 220L, 399L, 400L)) {
			val w = LeaveWindow()
			assertEquals(TOAST, w.press(t))
			assertEquals("$gap ms after the first", NOTHING, w.press(t + gap))
		}
		val w = LeaveWindow()
		w.press(t)
		assertEquals("just past it, a real second press", LEAVE, w.press(t + 401))
	}

	@Test
	fun `a doubled press neither leaves nor moves the window`() {
		val w = LeaveWindow()
		w.press(t)
		w.press(t + 50)
		// The window still runs from the first press.
		assertEquals(LEAVE, w.press(t + 1999))
		val x = LeaveWindow()
		x.press(t)
		x.press(t + 50)
		assertEquals(TOAST, x.press(t + 2000))
	}

	@Test
	fun `a press held down can open the window but never closes it`() {
		val w = LeaveWindow()
		assertEquals(TOAST, w.press(t, held = true))
		assertEquals(NOTHING, w.press(t + 1000, held = true))
		assertEquals(LEAVE, w.press(t + 1500))
	}

	@Test
	fun `a held second press stays held, however late inside the window`() {
		val w = LeaveWindow()
		w.press(t)
		assertEquals(NOTHING, w.press(t + 1900, held = true))
		// It did not use the second press up.
		assertEquals(LEAVE, w.press(t + 1950))
	}

	@Test
	fun `any other key ends the window, and the next BACK starts over`() {
		val w = LeaveWindow()
		w.press(t)
		assertTrue(w.end(t + 500))
		assertEquals(TOAST, w.press(t + 900))
		assertEquals(LEAVE, w.press(t + 1500))
	}

	@Test
	fun `end says whether there was a window to end`() {
		val w = LeaveWindow()
		assertFalse(w.end(t))
		w.press(t + 10)
		assertTrue(w.end(t + 20))
		assertFalse(w.end(t + 30))
	}

	@Test
	fun `an end older than the press leaves its window open`() {
		// The page took an earlier press, and that answer lands late.
		val w = LeaveWindow()
		w.press(t + 10)
		assertFalse(w.end(t + 5))
		assertEquals(LEAVE, w.press(t + 1000))
	}

	@Test
	fun `a page change ends the window`() {
		val w = LeaveWindow()
		w.navigated("https://h/", t)
		w.press(t + 100)
		assertTrue(w.navigated("https://h/series/4", t + 500))
		assertEquals(TOAST, w.press(t + 900))
	}

	@Test
	fun `a page writing its own URL back unchanged is no page change`() {
		val w = LeaveWindow()
		w.navigated("https://h/", t)
		w.press(t + 100)
		assertFalse(w.navigated("https://h/", t + 500))
		assertEquals(LEAVE, w.press(t + 900))
	}

	@Test
	fun `a key that came in after the press still ends a window the late answer opens`() {
		// The press at t, the key at t + 5, then the page's answer: the
		// activity decides the press last, with the press's own time.
		val w = LeaveWindow()
		w.end(t + 5)
		assertEquals(NOTHING, w.press(t))
		// And no window was left open by it.
		assertEquals(TOAST, w.press(t + 500))
	}

	@Test
	fun `a page change after the press is the same`() {
		val w = LeaveWindow()
		w.navigated("https://h/help", t - 1000)
		w.navigated("https://h/", t + 30)
		assertEquals(NOTHING, w.press(t))
	}

	@Test
	fun `the answer for an earlier press landing after a later one changes nothing`() {
		val w = LeaveWindow()
		w.press(t + 500)
		assertEquals(NOTHING, w.press(t))
		assertEquals(LEAVE, w.press(t + 1500))
	}

	@Test
	fun `the same key or the same page twice ends only what is open`() {
		val w = LeaveWindow()
		w.press(t)
		assertTrue(w.end(t + 10))
		assertFalse(w.end(t + 20))
		assertEquals(TOAST, w.press(t + 30))
	}

	@Test
	fun `a window that expired is no window for a key to end`() {
		// The toast is already gone: nothing is left to take down.
		val w = LeaveWindow()
		w.press(t)
		assertEquals(TOAST, w.press(t + 2500))
		assertEquals(LEAVE, w.press(t + 4000))
		assertFalse(w.end(t + 5000))
	}

	/**
	 * The doors a JVM test cannot run, as far as the source can say: the one
	 * call to `finish()`, and the three things that feed the window.
	 */
	@Test
	fun `every way out goes through the window, and the doors are wired`() {
		val activity = File("src/main/java/dev/masshiro/tsundoku/tv/MainActivity.kt").readText()
		assertEquals(1, Regex("""\bfinish\(\)""").findAll(activity).count())
		assertTrue(activity.contains("LeaveWindow.Verdict.LEAVE ->"))
		assertTrue(activity.contains("override fun doUpdateVisitedHistory"))
		assertTrue(activity.contains("leave.navigated("))
		assertTrue(activity.contains("event.repeatCount > 0"))
		assertTrue(activity.contains("override fun dispatchKeyEvent"))
		// A held key is only visible where BACK passes through dispatchKeyEvent,
		// which targetSdk 36 stops on Android 16 unless this says otherwise.
		val manifest = File("src/main/AndroidManifest.xml").readText()
		assertTrue(manifest.contains("android:enableOnBackInvokedCallback=\"false\""))
	}
}

package dev.masshiro.tsundoku.tv

import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * The remote's keys the WebView may not deliver (doc/TV.md, "The
 * remote"). The DOM names are what `src/lib/focus/keys.ts` and the player
 * listen for, so these tests pin the mapping and the event's shape.
 */
class KeysTest {
	@Test
	fun `MENU is the page's ContextMenu`() {
		assertEquals("ContextMenu", Keys.domKeyFor(82))
	}

	@Test
	fun `the media keys are the DOM's names for them`() {
		assertEquals("MediaPlayPause", Keys.domKeyFor(85))
		assertEquals("MediaPlay", Keys.domKeyFor(126))
		assertEquals("MediaPause", Keys.domKeyFor(127))
		assertEquals("MediaFastForward", Keys.domKeyFor(90))
		assertEquals("MediaRewind", Keys.domKeyFor(89))
		assertEquals("MediaTrackNext", Keys.domKeyFor(87))
		assertEquals("MediaTrackPrevious", Keys.domKeyFor(88))
	}

	@Test
	fun `the D-pad, OK and BACK are the WebView's own`() {
		// KEYCODE_DPAD_UP, KEYCODE_ENTER, KEYCODE_BACK.
		assertNull(Keys.domKeyFor(19))
		assertNull(Keys.domKeyFor(66))
		assertNull(Keys.domKeyFor(4))
	}

	@Test
	fun `a key press becomes a bubbling pair at the focused thing`() {
		val down = Keys.dispatchScript("MediaPlayPause", true)
		val up = Keys.dispatchScript("MediaPlayPause", false)
		for (js in listOf(down, up)) {
			assertTrue(js.contains("document.activeElement||document.body"))
			assertTrue(js.contains("bubbles:true"))
			assertTrue(js.contains("new KeyboardEvent("))
		}
		assertTrue(down.contains("keydown"))
		assertTrue(up.contains("keyup"))
		assertTrue(down.contains("MediaPlayPause"))
	}
}

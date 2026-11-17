package dev.masshiro.tsundoku.tv

import org.junit.Assert.assertArrayEquals
import org.junit.Assert.assertNull
import org.junit.Test

/** The small base64 decoder the signature check uses on Android 6 (B64.kt). */
class B64Test {
	private fun check(bytes: ByteArray) {
		val text = java.util.Base64.getEncoder().encodeToString(bytes)
		assertArrayEquals(bytes, B64.decode(text))
		assertArrayEquals(bytes, B64.decode(text.trimEnd('=')))
	}

	@Test
	fun `decodes what the JDK encodes, padded or not, every length`() {
		for (n in 0..70) check(ByteArray(n) { (it * 37 + n).toByte() })
	}

	@Test
	fun `anything that is not base64 is null`() {
		assertNull(B64.decode("abc!"))
		assertNull(B64.decode("a"))
		assertNull(B64.decode("ab-_"))
	}
}

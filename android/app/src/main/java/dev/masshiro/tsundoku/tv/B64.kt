package dev.masshiro.tsundoku.tv

/**
 * Standard base64 decoding, padded or not (c614: the release key and the
 * signature in `latest.json`). `java.util.Base64` is Android 8 and later, and
 * this app runs from 6; `android.util.Base64` has no body in JVM tests. Pure,
 * so B64Test pins it. Anything that isn't base64 is null.
 */
object B64 {
	private const val ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/"

	fun decode(text: String): ByteArray? {
		val s = text.trim().trimEnd('=')
		if (s.length % 4 == 1) return null
		val out = java.io.ByteArrayOutputStream(s.length * 3 / 4)
		var buffer = 0
		var bits = 0
		for (c in s) {
			val v = ALPHABET.indexOf(c)
			if (v < 0) return null
			buffer = (buffer shl 6) or v
			bits += 6
			if (bits >= 8) {
				bits -= 8
				out.write((buffer shr bits) and 0xFF)
			}
		}
		return out.toByteArray()
	}
}

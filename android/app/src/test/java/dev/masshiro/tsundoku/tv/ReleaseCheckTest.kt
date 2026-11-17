package dev.masshiro.tsundoku.tv

import dev.masshiro.tsundoku.tv.ReleaseCheck.Opened
import org.json.JSONObject
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test
import java.io.File
import java.security.KeyPairGenerator
import java.security.Signature
import java.util.Base64

/**
 * latest.json as the app opens it (ReleaseCheck.kt), against
 * tests/update-manifest.spec.ts's cases for the computer's `openManifest`.
 * The JDK signs with a key of the test's own; the release key's private half
 * never leaves the workstation.
 */
class ReleaseCheckTest {
	private val pair = KeyPairGenerator.getInstance("Ed25519").generateKeyPair()
	private val other = KeyPairGenerator.getInstance("Ed25519").generateKeyPair()

	/** The raw 32 bytes, as update-manifest.ts keeps RELEASE_KEY. */
	private val raw = Base64.getEncoder().encodeToString(pair.public.encoded.takeLast(32).toByteArray())

	private fun file(name: String) = JSONObject().put("name", name).put("size", 1234).put("sha256", "a".repeat(64))

	private fun manifest(android: JSONObject? = defaultAndroid()) =
		JSONObject()
			.put("version", "2026.11.06")
			.put("date", "2026-11-06")
			.put("notes", "The apps update themselves.")
			.put("files", JSONObject().put("linux-x64", JSONObject().put("archive", file("tsundoku-linux-x64.tar.xz"))).also { if (android != null) it.put("android", android) })

	private fun defaultAndroid() = JSONObject().put("app", file("tsundoku-app.apk")).put("tv", file("tsundoku-tv.apk"))

	private fun signed(text: String, key: java.security.PrivateKey = pair.private): String {
		val s = Signature.getInstance("Ed25519")
		s.initSign(key)
		s.update(text.toByteArray(Charsets.UTF_8))
		return JSONObject().put("manifest", text).put("signature", Base64.getEncoder().encodeToString(s.sign())).toString()
	}

	@Test
	fun `opens when the release key signed it, with this form's APK`() {
		val text = manifest().toString()
		val phone = ReleaseCheck.open(signed(text), Form.MOBILE, raw) as Opened.Ok
		assertEquals("2026.11.06", phone.release.version)
		assertEquals("tsundoku-app.apk", phone.release.apk?.name)
		val tv = ReleaseCheck.open(signed(text), Form.TV, raw) as Opened.Ok
		assertEquals("tsundoku-tv.apk", tv.release.apk?.name)
	}

	@Test
	fun `refuses another key's signature, and a manifest changed after signing`() {
		val text = manifest().toString()
		assertTrue(ReleaseCheck.open(signed(text, other.private), Form.MOBILE, raw) is Opened.Refused)
		val tampered = JSONObject(signed(text)).put("manifest", text.replace("1234", "1235")).toString()
		val r = ReleaseCheck.open(tampered, Form.MOBILE, raw) as Opened.Refused
		assertTrue(r.reason.contains("signature"))
		// And the real release key never verifies a test key's signature.
		assertTrue(ReleaseCheck.open(signed(text), Form.MOBILE) is Opened.Refused)
	}

	@Test
	fun `refuses what is not a well-formed, signed manifest`() {
		assertEquals(Opened.Refused("not JSON"), ReleaseCheck.open("nope", Form.MOBILE, raw))
		assertTrue(ReleaseCheck.open("{}", Form.MOBILE, raw) is Opened.Refused)
		assertTrue(ReleaseCheck.open(signed("not json"), Form.MOBILE, raw) is Opened.Refused)
		val noVersion = manifest().put("version", "v2").toString()
		assertEquals(Opened.Refused("no version"), ReleaseCheck.open(signed(noVersion), Form.MOBILE, raw))
		// A name that could climb out of the version's folder.
		val climb = manifest(JSONObject().put("app", file("../x.apk"))).toString()
		assertEquals(Opened.Refused("a file entry is malformed"), ReleaseCheck.open(signed(climb), Form.MOBILE, raw))
	}

	@Test
	fun `a release from before the apps were published opens, with no APK to offer`() {
		val r = ReleaseCheck.open(signed(manifest(android = null).toString()), Form.MOBILE, raw) as Opened.Ok
		assertNull(r.release.apk)
	}

	@Test
	fun `an APK comes from its version's own folder, and matches only its size and hash`() {
		val f = ReleaseCheck.ReleaseFile("tsundoku-app.apk", 1234, "a".repeat(64))
		assertEquals("https://dl.example/2026.11.06/tsundoku-app.apk", ReleaseCheck.fileUrl("https://dl.example/", "2026.11.06", f))
		assertTrue(ReleaseCheck.matches(f, 1234, "A".repeat(64)))
		assertTrue(!ReleaseCheck.matches(f, 1233, "a".repeat(64)))
		assertTrue(!ReleaseCheck.matches(f, 1234, "b".repeat(64)))
	}

	@Test
	fun `the app's release key is the computer's`() {
		// app/ is the test's working directory; the repo's root is two up.
		val ts = File("../../src/lib/server/update-manifest.ts").readText()
		val key = Regex("RELEASE_KEY = '([^']+)'").find(ts)!!.groupValues[1]
		assertEquals(key, ReleaseCheck.RELEASE_KEY)
	}
}

package dev.masshiro.tsundoku.tv

import net.i2p.crypto.eddsa.EdDSAEngine
import net.i2p.crypto.eddsa.EdDSAPublicKey
import net.i2p.crypto.eddsa.spec.EdDSANamedCurveTable
import net.i2p.crypto.eddsa.spec.EdDSAPublicKeySpec
import org.json.JSONObject
import java.security.MessageDigest

/**
 * A release's `latest.json`, opened as the computer opens it
 * (doc/UPDATES.md, "The Android apps"; `openManifest` in
 * src/lib/server/update-manifest.ts). The manifest is a string and an ed25519
 * signature over exactly its bytes; the app refuses any it can't verify with
 * the release key's public half, and any APK whose size and SHA-256 aren't the
 * manifest's. The download host only serves files and is never trusted to
 * choose them: someone who took over the VPS could withhold an update, never
 * push one.
 *
 * Android 6 has no ed25519 of its own, so the check is `net.i2p.crypto:eddsa`
 * (pure Java, no native code).
 */
object ReleaseCheck {
	/**
	 * The release key's public half, raw: the same as `RELEASE_KEY` in
	 * update-manifest.ts, which ReleaseCheckTest reads and compares, so the two
	 * can never drift apart.
	 */
	const val RELEASE_KEY = "Hlve1oAMzIIHVslirdojPxPNwaqQwwNcWLQmUijh8q0="

	data class ReleaseFile(val name: String, val size: Long, val sha256: String)

	data class Release(
		val version: String,
		val date: String,
		val notes: String,
		/** This form's APK: the phone app's for `mobile`, the TV's for `tv`; null in a release without one. */
		val apk: ReleaseFile?
	)

	sealed class Opened {
		data class Ok(val release: Release) : Opened()

		data class Refused(val reason: String) : Opened()
	}

	private val VERSION = Regex("^\\d{4}\\.\\d{2}\\.\\d{2}(\\.\\d+)?$")
	private val NAME = Regex("^[\\w.-]+$")
	private val SHA = Regex("^[0-9a-f]{64}$")

	/** The release in `text` for `form`'s app, if the release key signed it and it is well formed. */
	fun open(text: String, form: Form, key: String = RELEASE_KEY): Opened {
		val signed =
			try {
				JSONObject(text)
			} catch (_: Exception) {
				return Opened.Refused("not JSON")
			}
		val manifest = signed.opt("manifest") as? String
		val signature = signed.opt("signature") as? String
		if (manifest == null || signature == null) return Opened.Refused("not a signed manifest")
		if (!verify(manifest, signature, key)) return Opened.Refused("the signature is not the release key's")
		val m =
			try {
				JSONObject(manifest)
			} catch (_: Exception) {
				return Opened.Refused("the manifest is not JSON")
			}
		val version = m.optString("version")
		if (!VERSION.matches(version)) return Opened.Refused("no version")
		if (!m.has("notes") || !m.has("date")) return Opened.Refused("no notes or date")
		val android = m.optJSONObject("files")?.optJSONObject("android")
		val entry = android?.optJSONObject(if (form == Form.TV) "tv" else "app")
		val apk =
			if (entry == null) {
				null
			} else {
				fileOf(entry) ?: return Opened.Refused("a file entry is malformed")
			}
		return Opened.Ok(Release(version, m.optString("date"), m.optString("notes"), apk))
	}

	private fun fileOf(o: JSONObject): ReleaseFile? {
		val name = o.optString("name")
		val size = o.optLong("size", -1)
		val sha = o.optString("sha256")
		if (!NAME.matches(name) || size <= 0 || !SHA.matches(sha)) return null
		return ReleaseFile(name, size, sha)
	}

	/** ed25519 over exactly the manifest's UTF-8 bytes. Anything malformed is false, never a throw. */
	fun verify(manifest: String, signature: String, key: String): Boolean =
		try {
			val raw = B64.decode(key) ?: return false
			val sig = B64.decode(signature) ?: return false
			val spec = EdDSANamedCurveTable.getByName(EdDSANamedCurveTable.ED_25519)
			val engine = EdDSAEngine(MessageDigest.getInstance(spec.hashAlgorithm))
			engine.initVerify(EdDSAPublicKey(EdDSAPublicKeySpec(raw, spec)))
			engine.update(manifest.toByteArray(Charsets.UTF_8))
			engine.verify(sig)
		} catch (_: Exception) {
			false
		}

	/** Where an APK is: its version's own folder, never `latest/`, so the hash is that version's. */
	fun fileUrl(base: String, version: String, file: ReleaseFile): String = "${base.trimEnd('/')}/$version/${file.name}"

	/** Whether downloaded bytes are the manifest's: their size, then their SHA-256. */
	fun matches(file: ReleaseFile, size: Long, sha256: String): Boolean = size == file.size && sha256.lowercase() == file.sha256
}

package dev.masshiro.tsundoku.tv

/**
 * Release versions, as the app reads them (doc/UPDATES.md): the date
 * versions every release has, `YYYY.MM.DD[.N]`, the same rule as
 * `newer` in src/lib/server/update-manifest.ts.
 *
 * A build's own `versionName` may carry a suffix (`2026.11.05-dev2`, a build
 * handed over before a release): its date and N are what count, so a dev
 * build is offered the release of its own day or later. A name that is no
 * date version at all (`1.0.0`, an unversioned local build) is the oldest
 * there is: any release is newer.
 */
object Versions {
	private val DATE = Regex("^(\\d{4})\\.(\\d{2})\\.(\\d{2})(?:\\.(\\d+))?")

	/** [year, month, day, n], or null for a name that is no date version. */
	fun parts(name: String?): List<Int>? {
		val m = DATE.find(name?.trim().orEmpty()) ?: return null
		val (y, mo, d, n) = m.destructured
		return listOf(y.toInt(), mo.toInt(), d.toInt(), n.ifEmpty { "0" }.toInt())
	}

	/** a > b. A name that is no date version is older than any that is. */
	fun newer(a: String?, b: String?): Boolean {
		val pa = parts(a) ?: return false
		val pb = parts(b) ?: return true
		for (i in pa.indices) if (pa[i] != pb[i]) return pa[i] > pb[i]
		return false
	}

	/**
	 * Android's `versionCode` for a version: YYYYMMDDNN, so every release is
	 * newer to the installer than the one before (2026.11.05.2 is 2026110502).
	 * N is two digits; a day's 100th release would collide, and none comes
	 * near. A name that is no date version is 1.
	 * app/build.gradle.kts computes the same, and VersionsTest pins both.
	 */
	fun code(name: String?): Int {
		val p = parts(name) ?: return 1
		return p[0] * 1_000_000 + p[1] * 10_000 + p[2] * 100 + p[3].coerceAtMost(99)
	}
}

package dev.masshiro.tsundoku.tv

import android.content.Context
import android.webkit.JavascriptInterface
import java.net.Inet4Address
import java.net.NetworkInterface
import java.util.concurrent.Executors
import java.util.concurrent.ExecutorService

/**
 * What the app's own pages cannot do themselves (c236; doc/TV.md, "Pairing"):
 * the TV's own address (for the prefix, and 9D's third reason), a probe of a
 * candidate address, and remembering the one that answered.
 *
 * @JavascriptInterface methods are called from the page's JavaScript thread,
 * so the probe runs on its own thread and comes back through the activity's
 * `window.tsundokuProbe(origin, ok)`.
 */
class PairingBridge(private val activity: MainActivity) {
	companion object {
		const val NAME = "TsundokuTV"

		/**
		 * tsundoku's own port (`scripts/serve.ts`, and the launcher's default):
		 * the address is written out with it, so only the last number is typed.
		 * A friend who changed PORT uses TYPE THE WHOLE ADDRESS.
		 */
		const val DEFAULT_PORT = 42143

		private const val PREFS = "pairing"
		private const val KEY_ADDRESS = "address"
	}

	private val io: ExecutorService = Executors.newSingleThreadExecutor()

	private fun prefs() = activity.getSharedPreferences(PREFS, Context.MODE_PRIVATE)

	/** The TV's own IPv4 on its network, or "" when it has none. */
	@JavascriptInterface
	fun tvAddress(): String = ownIpv4() ?: ""

	/** "192.168.1." — what 9B writes for the TV, or "" when there is no address. */
	@JavascriptInterface
	fun prefix(): String = Address.prefixOf(ownIpv4()) ?: ""

	@JavascriptInterface
	fun defaultPort(): Int = DEFAULT_PORT

	/** The address that last answered, or "". Read on launch, before any page loads. */
	@JavascriptInterface
	fun remembered(): String = prefs().getString(KEY_ADDRESS, "").orEmpty()

	/** A candidate answered: open the library here next time. */
	@JavascriptInterface
	fun remember(origin: String) {
		val clean = Address.originOf(origin) ?: return
		prefs().edit().putString(KEY_ADDRESS, clean).apply()
	}

	@JavascriptInterface
	fun forget() {
		prefs().edit().remove(KEY_ADDRESS).apply()
	}

	/** Probe `origin` off the page's thread; the answer comes to `window.tsundokuProbe`. */
	@JavascriptInterface
	fun probe(origin: String) {
		val clean = Address.originOf(origin) ?: return
		io.execute { activity.postProbe(clean, Probe.check(clean)) }
	}

	fun shutdown() = io.shutdownNow()

	/** The Wi-Fi address before anything virtual: what 9B's prefix must be. */
	private fun ownIpv4(): String? =
		try {
			val found =
				NetworkInterface.getNetworkInterfaces()
					?.toList()
					.orEmpty()
					.filter { it.isUp && !it.isLoopback }
					.flatMap { n -> n.inetAddresses.toList().map { n.name to it } }
					.filter { (_, a) -> a is Inet4Address }
					.map { (name, a) -> name to (a.hostAddress ?: "") }
					.filter { (_, ip) -> Address.isPrivateV4(ip) }
			found.firstOrNull { (name, _) -> name.startsWith("wlan") }?.second
				?: found.firstOrNull()?.second
		} catch (_: Exception) {
			null
		}
}

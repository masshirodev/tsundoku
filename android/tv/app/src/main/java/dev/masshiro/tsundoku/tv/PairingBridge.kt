package dev.masshiro.tsundoku.tv

import android.content.Context
import android.webkit.JavascriptInterface
import java.net.Inet4Address
import java.net.NetworkInterface
import java.util.concurrent.ExecutorService
import java.util.concurrent.Executors

/**
 * What the app's own pages cannot do themselves (c236; doc/TV.md, "Pairing"):
 * the TV's own address (for the prefix, and 9D's third reason), a probe of a
 * candidate address, and the servers this TV has paired with (c261;
 * doc/TV-APP.md, "Servers").
 *
 * The same object is on every page the WebView loads, the computer's library
 * included: that is how MORE › SERVERS, drawn by the web app, reads the list
 * and switches. A page that is not the app's own asks nothing it could not
 * already do by navigating, and the list lives here, never in the page.
 *
 * @JavascriptInterface methods are called from the page's JavaScript thread,
 * so probes run on their own threads and come back through the activity's
 * `window.tsundokuProbe(origin, ok)`, and whatever loads a page is posted to
 * the activity's UI thread.
 */
class PairingBridge(private val activity: MainActivity, private val servers: Servers) {
	companion object {
		const val NAME = "TsundokuTV"

		/**
		 * tsundoku's own port (`scripts/serve.ts`, and the launcher's default):
		 * the address is written out with it, so only the last number is typed.
		 * A friend who changed PORT uses TYPE THE WHOLE ADDRESS.
		 */
		const val DEFAULT_PORT = 42143

		/**
		 * SERVERS probes every row as it opens, and each probe can take its
		 * whole six seconds: one thread per row a panel can show at once, so
		 * the answers come back as they land rather than one after another.
		 */
		private const val PROBES = 4
	}

	private val io: ExecutorService = Executors.newFixedThreadPool(PROBES)

	/** The TV's own IPv4 on its network, or "" when it has none. */
	@JavascriptInterface
	fun tvAddress(): String = ownIpv4() ?: ""

	/** "192.168.1." — what 9B writes for the TV, or "" when there is no address. */
	@JavascriptInterface
	fun prefix(): String = Address.prefixOf(ownIpv4()) ?: ""

	@JavascriptInterface
	fun defaultPort(): Int = DEFAULT_PORT

	/** The server in use (the last used), or "". */
	@JavascriptInterface
	fun remembered(): String = servers.lastUsed()?.origin.orEmpty()

	/**
	 * A candidate answered: keep it. Adds to the list rather than replacing the
	 * one in use (c261): the library the TV was in still opens on launch until
	 * the new one's library has been opened.
	 */
	@JavascriptInterface
	fun remember(origin: String) {
		val clean = Address.originOf(origin) ?: return
		if (servers.add(clean)) activity.serversChanged()
	}

	/** Forgets every server: what this bridge's `forget()` has always meant. */
	@JavascriptInterface
	fun forget() {
		for (s in servers.all()) forgetServer(s.origin)
	}

	/** The list, the one in use first (Servers.toJson). */
	@JavascriptInterface
	fun servers(): String = servers.toJson()

	/**
	 * Open that server's library. It becomes the one in use once its page has
	 * loaded (MainActivity marks it), so a server that does not answer gets 9D
	 * for it, never another (S9).
	 */
	@JavascriptInterface
	fun open(origin: String) {
		val clean = servers.find(origin)?.origin ?: return
		activity.runOnUiThread { activity.openServer(clean) }
	}

	/** The TV's own name for it; empty gives back the server's name (S5). */
	@JavascriptInterface
	fun rename(origin: String, name: String) {
		if (servers.rename(origin, name)) activity.serversChanged()
	}

	/** What the server calls itself, said by its own page (the library's layout). */
	@JavascriptInterface
	fun named(origin: String, name: String) {
		val s = servers.find(origin) ?: return
		if (name.isBlank() || s.name == name.trim().uppercase()) return
		if (servers.named(origin, name)) activity.serversChanged()
	}

	/**
	 * FORGET (S4): the entry, and that origin's cookies, so adding it back
	 * pairs again. Answers the list as it is now, for the page to decide where
	 * to go (the next that answers, or 9A).
	 */
	@JavascriptInterface
	fun forgetServer(origin: String): String {
		val clean = Address.originOf(origin) ?: return servers.toJson()
		if (servers.forget(clean)) {
			activity.runOnUiThread { activity.clearCookies(clean) }
			activity.serversChanged()
		}
		return servers.toJson()
	}

	/** A server that moved: the new address takes that entry's place (9D's CHANGE THE ADDRESS). */
	@JavascriptInterface
	fun move(from: String, to: String) {
		if (servers.move(from, to)) activity.serversChanged()
	}

	/** + ADD A SERVER: 9B as ADD A SERVER · 1 OF 2 (S7), the app's own page. */
	@JavascriptInterface
	fun addServer() {
		activity.runOnUiThread { activity.showAsset("#add") }
	}

	/** RENAME (S5), the app's own page: the field above Android's keyboard. */
	@JavascriptInterface
	fun renameServer(origin: String) {
		val clean = servers.find(origin)?.origin ?: return
		activity.runOnUiThread { activity.showAsset("#rename=" + android.net.Uri.encode(clean)) }
	}

	/** 9A again: the last server was forgotten. */
	@JavascriptInterface
	fun welcome() {
		activity.runOnUiThread { activity.showAsset("") }
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

/** The `pairing` SharedPreferences as the store's key-value (Servers.KeyValue). */
class PrefsKeyValue(context: Context) : Servers.KeyValue {
	private val prefs = context.getSharedPreferences("pairing", Context.MODE_PRIVATE)

	override fun get(key: String): String? = prefs.getString(key, null)

	// commit, not apply: the activity reads the list again at once (launch,
	// the shortcuts), and a bridge call returns only after the write.
	override fun put(key: String, value: String) {
		prefs.edit().putString(key, value).commit()
	}

	override fun remove(key: String) {
		prefs.edit().remove(key).commit()
	}
}

package dev.masshiro.tsundoku.tv

import android.content.Context
import android.webkit.JavascriptInterface
import java.net.Inet4Address
import java.net.NetworkInterface
import java.util.concurrent.ExecutorService
import java.util.concurrent.Executors

/**
 * What the app's own pages cannot do themselves (doc/TV.md, "Pairing"):
 * the TV's own address (for the prefix, and the not-answering screen's third
 * reason), a probe of a candidate address, and the servers this TV has paired
 * with (doc/TV-APP.md, "Servers").
 *
 * The same object is on every page the WebView loads, the computer's library
 * included: that is how MORE › SERVERS, drawn by the web app, reads the list
 * and switches. So every call that writes, probes, or opens one of the app's
 * screens that writes first asks [BridgeGuard] whether the page in the
 * WebView is the app's own or a known server's, and does nothing otherwise.
 * The reads that say anything of the user's ask it too: the list of servers
 * is the user's, and so are the TV's address and its network. A refused read
 * answers what a TV that knows nothing would ("[]", ""), never an exception, so a page of
 * ours that is refused (none should be) draws as an unpaired TV. Every
 * method, and whether it is guarded:
 *
 * | Method           | Does                                   | Guarded |
 * | ---------------- | -------------------------------------- | ------- |
 * | `tvAddress`      | reads the TV's IPv4                    | yes: "" |
 * | `prefix`         | reads it, as the address prefix        | yes: "" |
 * | `defaultPort`    | reads a constant                       | no      |
 * | `remembered`     | reads the server in use                | yes: "" |
 * | `servers`        | reads the list                         | yes: [] |
 * | `remember`       | writes: adds a server                  | yes     |
 * | `forget`         | writes: forgets every server, cookies  | yes     |
 * | `forgetServer`   | writes: forgets one, and its cookies   | yes: "" |
 * | `move`           | writes: an entry takes a new origin    | yes     |
 * | `rename`         | writes: the TV's name for a server     | yes     |
 * | `named`          | writes: the server's own name          | yes     |
 * | `probe`          | asks any address on the network        | yes     |
 * | `addServer`      | opens ADD A SERVER, which writes       | yes     |
 * | `renameServer`   | opens RENAME, which writes             | yes     |
 * | `open`           | opens a known server's library         | no      |
 * | `welcome`        | opens the first screen                 | no      |
 * | `form`           | reads which app this is         | no      |
 * | `network`        | reads home / data / none        | yes: "" |
 * | `surface`        | paints the camera band          | no      |
 * | `keyboard`       | raises the phone's keyboard     | no      |
 * | `edge`           | draws the page under the camera | no      |
 * | `appUpdate`      | reads the app's update state    | no      |
 * | `appCheck`       | asks the release host           | no      |
 * | `appDownload`    | downloads and installs a release| yes     |
 * | `appInstall`     | installs the downloaded release | yes     |
 *
 * `open` and `welcome` stay open on purpose: FORGET of the server in use calls
 * one of them from the page of the server it has just forgotten (MoreSheet's
 * `forget`), which is no longer known. Neither writes, and neither goes
 * anywhere but a server the TV knows or the app's own first screen. `surface`
 * stays open too: it writes nothing but a colour into the camera band, and
 * a colour that is not a solid one is refused (Insets.parseColor). `form`
 * and `defaultPort` stay open as well: the user agent already says which
 * app this is (`TsundokuTV/` or `TsundokuApp/`), and the port is a constant
 * in the source.
 *
 * The bridge is `TsundokuTV` on the phone and tablet app as well: the
 * name is the contract the web app reads, not a claim about the screen.
 *
 * @JavascriptInterface methods are called from the page's JavaScript thread,
 * so probes run on their own threads and come back through the activity's
 * `window.tsundokuProbe(origin, ok)`, and whatever loads a page is posted to
 * the activity's UI thread.
 */
class PairingBridge(
	private val host: Host,
	private val servers: Servers,
	private val io: ExecutorService = Executors.newFixedThreadPool(PROBES),
	private val form: Form = Form.TV,
	/** Every up interface's IPv4, by name; PairingBridgeTest hands its own. */
	private val interfaces: () -> List<Pair<String, String>> = ::upInterfaces
) {
	/** What the bridge needs of the activity: an interface, so PairingBridgeTest can stand in. */
	interface Host {
		/** The WebView's top-level URL, read on the UI thread; null when it cannot be read. */
		fun topUrl(): String?

		fun onUi(block: () -> Unit)

		fun serversChanged()

		fun clearCookies(origin: String)

		fun openServer(origin: String)

		fun showAsset(hash: String)

		fun postProbe(origin: String, ok: Boolean)

		/** The camera band takes the page's colour; a TV has none to paint. */
		fun paintSurface(color: Int) {}

		/** The phone's keyboard, for the field the page has focused; a TV never. */
		fun showKeyboard() {}

		/** The page drawn edge to edge, under the camera, or padded again. */
		fun setEdge(on: Boolean) {}

		/** The app's own updater; none in a test, or before the activity made one. */
		fun updater(): Updater? = null
	}

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

		/** A refused read: what a TV that knows nothing would say. */
		const val NOTHING = ""

		/** A refused list: Servers.toJson of no servers. */
		const val NO_SERVERS = "[]"
	}

	/** Whether the page asking is the app's own or a known server's. */
	private fun trusted(): Boolean = BridgeGuard.allows(host.topUrl()) { servers.find(it) != null }

	/**
	 * "tv" or "mobile": the pairing page lays itself out by it, since a
	 * width alone can't tell a TV pinned at 960 from a tablet.
	 */
	@JavascriptInterface
	fun form(): String = form.id

	/** "home", "data" (a phone on mobile data) or "none": the not-answering screen's third reason. */
	@JavascriptInterface
	fun network(): String = if (trusted()) Network.state(found()).id else NOTHING

	/** The page's own background, as rgb() or a hex: the camera band's colour. */
	@JavascriptInterface
	fun surface(css: String) {
		val color = Insets.parseColor(css) ?: return
		host.onUi { host.paintSurface(color) }
	}

	/**
	 * Raise the keyboard for the field the page has just focused:
	 * the WebView does not, for focus given by a script on arrival (the address
	 * screen, the code page).
	 * Nothing on a TV (Form.raisesKeyboard). Unguarded: it shows a keyboard and
	 * writes nothing.
	 */
	@JavascriptInterface
	fun keyboard() {
		if (!form.raisesKeyboard) return
		host.onUi { host.showKeyboard() }
	}

	/**
	 * The page drawn edge to edge, under the camera, or padded again:
	 * the reader's manga and manhwa pages ask for it while they are open. The
	 * page keeps its own bars out of the band from `--app-inset-*`. Nothing on
	 * a TV. Unguarded: it moves padding and writes nothing.
	 */
	@JavascriptInterface
	fun edge(on: Boolean) {
		if (!form.padsInsets) return
		host.onUi { host.setEdge(on) }
	}

	/**
	 * The app's update, as the page draws it (Updater.State.toJson):
	 * the version running, the phase, and the release on offer. "" with no
	 * updater. Changes after this arrive as `window.tsundokuAppUpdate(state)`.
	 */
	@JavascriptInterface
	fun appUpdate(): String = host.updater()?.state?.toJson().orEmpty()

	/** CHECK: ask the release host now. Reads a signed file; writes nothing. */
	@JavascriptInterface
	fun appCheck() {
		host.updater()?.check()
	}

	/**
	 * UPDATE: download the release on offer, checked against its signed size
	 * and SHA-256, then install it. Guarded as every write is: only the app's
	 * own pages and known servers may start an install.
	 */
	@JavascriptInterface
	fun appDownload() {
		if (!trusted()) return
		host.updater()?.download()
	}

	/** Install the release already downloaded (after Android's permission, or a cancelled prompt). */
	@JavascriptInterface
	fun appInstall() {
		if (!trusted()) return
		host.onUi { host.updater()?.install() }
	}

	/** The TV's own IPv4 on its network, or "" when it has none. */
	@JavascriptInterface
	fun tvAddress(): String = if (trusted()) ownIpv4() ?: NOTHING else NOTHING

	/** "192.168.1." — what the address screen writes for the TV, or "" when there is no address. */
	@JavascriptInterface
	fun prefix(): String = if (trusted()) Address.prefixOf(ownIpv4()) ?: NOTHING else NOTHING

	@JavascriptInterface
	fun defaultPort(): Int = DEFAULT_PORT

	/** The server in use (the last used), or "". */
	@JavascriptInterface
	fun remembered(): String = if (trusted()) servers.lastUsed()?.origin.orEmpty() else NOTHING

	/**
	 * A candidate answered: keep it. Adds to the list rather than replacing the
	 * one in use: the library the TV was in still opens on launch until
	 * the new one's library has been opened.
	 */
	@JavascriptInterface
	fun remember(origin: String) {
		if (!trusted()) return
		val clean = Address.originOf(origin) ?: return
		if (servers.add(clean)) host.serversChanged()
	}

	/** Forgets every server: what this bridge's `forget()` has always meant. */
	@JavascriptInterface
	fun forget() {
		// Asked once: the page's own server is forgotten along the way, and a
		// second ask from its page would refuse every server after it.
		if (!trusted()) return
		for (s in servers.all()) forgetOne(s.origin)
	}

	/** The list, the one in use first (Servers.toJson). */
	@JavascriptInterface
	fun servers(): String = if (trusted()) servers.toJson() else NO_SERVERS

	/**
	 * Open that server's library. It becomes the one in use once its page has
	 * loaded (MainActivity marks it), so a server that does not answer gets the
	 * not-answering screen for it, never another.
	 */
	@JavascriptInterface
	fun open(origin: String) {
		val clean = servers.find(origin)?.origin ?: return
		host.onUi { host.openServer(clean) }
	}

	/** The TV's own name for it; empty gives back the server's name. */
	@JavascriptInterface
	fun rename(origin: String, name: String) {
		if (!trusted()) return
		if (servers.rename(origin, name)) host.serversChanged()
	}

	/** What the server calls itself, said by its own page (the library's layout). */
	@JavascriptInterface
	fun named(origin: String, name: String) {
		if (!trusted()) return
		val s = servers.find(origin) ?: return
		if (name.isBlank() || s.name == name.trim().uppercase()) return
		if (servers.named(origin, name)) host.serversChanged()
	}

	/**
	 * FORGET: the entry, and that origin's cookies, so adding it back
	 * pairs again. Answers the list as it is now, for the page to decide where
	 * to go (the next that answers, or the first screen); refused, it answers "", which the
	 * page reads as "nothing happened".
	 */
	@JavascriptInterface
	fun forgetServer(origin: String): String {
		// Refused, it answers no list at all: not "[]", which the page
		// would read as "that was the last one" and send the TV to the first screen while
		// every server is still stored. "" leaks nothing and is not a list.
		if (!trusted()) return NOTHING
		forgetOne(origin)
		return servers.toJson()
	}

	/** One server and its cookies, with the guard already asked by the caller. */
	private fun forgetOne(origin: String) {
		val clean = Address.originOf(origin) ?: return
		if (servers.forget(clean)) {
			host.onUi { host.clearCookies(clean) }
			host.serversChanged()
		}
	}

	/** A server that moved: the new address takes that entry's place (the not-answering screen's CHANGE THE ADDRESS). */
	@JavascriptInterface
	fun move(from: String, to: String) {
		if (!trusted()) return
		if (servers.move(from, to)) host.serversChanged()
	}

	/** + ADD A SERVER: the address screen as ADD A SERVER · 1 OF 2, the app's own page. */
	@JavascriptInterface
	fun addServer() {
		if (!trusted()) return
		host.onUi { host.showAsset("#add") }
	}

	/** RENAME, the app's own page: the field above Android's keyboard. */
	@JavascriptInterface
	fun renameServer(origin: String) {
		if (!trusted()) return
		val clean = servers.find(origin)?.origin ?: return
		host.onUi { host.showAsset("#rename=" + android.net.Uri.encode(clean)) }
	}

	/** The first screen again: the last server was forgotten. */
	@JavascriptInterface
	fun welcome() {
		host.onUi { host.showAsset("") }
	}

	/** Probe `origin` off the page's thread; the answer comes to `window.tsundokuProbe`. */
	@JavascriptInterface
	fun probe(origin: String) {
		if (!trusted()) return
		val clean = Address.originOf(origin) ?: return
		io.execute { host.postProbe(clean, Probe.check(clean)) }
	}

	fun shutdown() = io.shutdownNow()

	/**
	 * The home address, Wi-Fi first and never a carrier's or a tunnel's: what
	 * the address screen's prefix must be (Network.homeV4 says why a phone needs the skip).
	 */
	private fun ownIpv4(): String? = Network.homeV4(found())

	private fun found(): List<Pair<String, String>> = interfaces()
}

/** Every up interface's IPv4, by name: what the bridge reads the TV's own address from. */
private fun upInterfaces(): List<Pair<String, String>> =
	try {
		NetworkInterface.getNetworkInterfaces()
			?.toList()
			.orEmpty()
			.filter { it.isUp && !it.isLoopback }
			.flatMap { n -> n.inetAddresses.toList().map { n.name to it } }
			.filter { (_, a) -> a is Inet4Address }
			.map { (name, a) -> name to (a.hostAddress ?: "") }
	} catch (_: Exception) {
		emptyList()
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

package dev.masshiro.tsundoku.tv

/**
 * Which of the device's own addresses is its home network's, and whether it
 * has one at all (the TV's prefix; a phone on mobile data).
 *
 * A TV has an Ethernet or a Wi-Fi address and nothing else. A phone also has
 * a cellular interface, whose IPv4 is often a 10.x carrier address: private,
 * so `Address.isPrivateV4` alone would offer it as the address screen's
 * prefix and send the phone looking for the computer on the carrier's
 * network. A VPN's tunnel (Tailscale's tun0, among others) is no home
 * network either. So both are
 * skipped by name, before the private-address test.
 *
 * Pure over (interface name, IPv4) pairs, so NetworkTest pins it without a
 * socket; PairingBridge reads the pairs from `NetworkInterface`.
 */
object Network {
	/** What the not-answering screen's third reason says about the device's network. */
	enum class State(val id: String) {
		/** A home address: the prefix, and "this phone is on another Wi-Fi". */
		HOME("home"),

		/** No home address, but a cellular one: the phone is on mobile data. */
		DATA("data"),

		/** Nothing at all: no Wi-Fi to be on. */
		NONE("none")
	}

	/** Cellular modems, as Android names them across vendors. */
	private val CELLULAR = listOf("rmnet", "ccmni", "pdp", "v4-rmnet", "clat", "seth_lte", "wwan", "usb_rmnet")

	/** Tunnels: a VPN's, Tailscale's, IPsec's. */
	private val TUNNEL = listOf("tun", "tap", "ppp", "ipsec", "wg")

	fun isCellular(name: String): Boolean = CELLULAR.any { name.startsWith(it) }

	fun isTunnel(name: String): Boolean = TUNNEL.any { name.startsWith(it) }

	/**
	 * The home address: Wi-Fi first, then any other private address on an
	 * interface that is neither cellular nor a tunnel (a TV's eth0), or null.
	 */
	fun homeV4(found: List<Pair<String, String>>): String? {
		val home = found.filter { (name, ip) -> !isCellular(name) && !isTunnel(name) && Address.isPrivateV4(ip) }
		return home.firstOrNull { (name, _) -> name.startsWith("wlan") }?.second ?: home.firstOrNull()?.second
	}

	/** HOME with a home address, DATA with only a cellular one, else NONE. */
	fun state(found: List<Pair<String, String>>): State =
		when {
			homeV4(found) != null -> State.HOME
			found.any { (name, ip) -> isCellular(name) && ip.isNotEmpty() } -> State.DATA
			else -> State.NONE
		}
}

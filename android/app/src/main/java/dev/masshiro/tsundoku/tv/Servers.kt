package dev.masshiro.tsundoku.tv

/**
 * The servers this TV has paired with (c261; doc/ANDROID.md, "Servers";
 * doc/handoffs/tv-servers/, "05 — what this asks of the app").
 *
 * One entry per origin: the origin, the name the server gives itself (its
 * hostname, as `/pair/tv` says it), the TV's own name for it (empty unless
 * renamed), and when its library was last opened. The one in use is the one
 * opened last: there is no default to mark, as the design decided.
 *
 * Pure apart from [KeyValue], so `ServersTest` pins the store, the migration
 * from the single `address` this app kept before c261, and the launch choice
 * without an Android runtime. The activity and the bridge share one instance
 * over the `pairing` SharedPreferences.
 */
class Servers(private val kv: KeyValue, private val clock: () -> Long = System::currentTimeMillis) {
	/** The storage the list lives in: SharedPreferences on the TV, a map in the tests. */
	interface KeyValue {
		fun get(key: String): String?

		fun put(key: String, value: String)

		fun remove(key: String)
	}

	data class Server(
		val origin: String,
		/** What the server calls itself, upper case; "" until it has said. */
		val name: String = "",
		/** What this TV calls it; "" unless renamed. Never sent to the server. */
		val tvName: String = "",
		/** When its library last opened, in ms; 0 for never (added, not yet paired). */
		val opened: Long = 0,
		/** When it was added, in ms: the tie-break between two never opened. */
		val added: Long = 0
	) {
		/** The name a row shows: the TV's, else the server's, else its host. */
		val shown: String
			get() = tvName.ifBlank { name.ifBlank { hostOf(origin) } }
	}

	companion object {
		/** The list, one line per server. */
		const val KEY_SERVERS = "servers"

		/**
		 * The one address this app remembered before c261, and still the last
		 * used one's origin, kept in step on every write: an older APK installed
		 * over this one then opens the same library rather than 9A.
		 */
		const val KEY_ADDRESS = "address"

		/** A rename longer than a row can show is still kept whole up to this. */
		const val MAX_NAME = 60

		/** "http://192.168.1.23:42143" -> "192.168.1.23:42143": the host a nameless row shows. */
		fun hostOf(origin: String): String = origin.substringAfter("://")

		private fun escape(s: String): String =
			s.replace("\\", "\\\\").replace("\t", "\\t").replace("\n", "\\n").replace("\r", "")

		private fun unescape(s: String): String {
			val out = StringBuilder(s.length)
			var i = 0
			while (i < s.length) {
				val c = s[i]
				if (c == '\\' && i + 1 < s.length) {
					when (s[i + 1]) {
						't' -> out.append('\t')
						'n' -> out.append('\n')
						else -> out.append(s[i + 1])
					}
					i += 2
				} else {
					out.append(c)
					i += 1
				}
			}
			return out.toString()
		}

		/** Splits on tabs that are not escaped. */
		private fun fields(line: String): List<String> {
			val parts = mutableListOf<String>()
			val cur = StringBuilder()
			var i = 0
			while (i < line.length) {
				val c = line[i]
				if (c == '\\' && i + 1 < line.length) {
					cur.append(c).append(line[i + 1])
					i += 2
					continue
				}
				if (c == '\t') {
					parts += cur.toString()
					cur.clear()
				} else {
					cur.append(c)
				}
				i += 1
			}
			parts += cur.toString()
			return parts.map(::unescape)
		}

		fun encode(list: List<Server>): String =
			list.joinToString("\n") {
				listOf(it.origin, it.name, it.tvName, it.opened.toString(), it.added.toString())
					.joinToString("\t", transform = ::escape)
			}

		/**
		 * A line that cannot be read is dropped, not guessed at: the rest still open.
		 *
		 * Every origin is read through [Address.originOf], so an entry stored
		 * before a normalisation comes back normalised: one with its scheme's
		 * own port (round 2 of c261), or one typed with capitals (c548). Two
		 * lines that then name one origin are one server, and are folded by
		 * [fold] rather than kept twice.
		 */
		fun decode(text: String): List<Server> =
			text.split('\n').mapNotNull { line ->
				if (line.isBlank()) return@mapNotNull null
				val f = fields(line)
				val origin = Address.originOf(f.getOrNull(0)) ?: return@mapNotNull null
				Server(
					origin = origin,
					name = f.getOrNull(1).orEmpty(),
					tvName = f.getOrNull(2).orEmpty(),
					opened = f.getOrNull(3)?.toLongOrNull() ?: 0,
					added = f.getOrNull(4)?.toLongOrNull() ?: 0
				)
			}.groupBy { it.origin }.values.map(::fold)

		/**
		 * Entries that turned out to be one server (c548: `http://Zen.local`
		 * stored beside `http://zen.local`). The one opened last wins, as the
		 * list is ordered, then the one added last; a name the winner lacks
		 * is taken from the others, as [move] carries the TV's name across
		 * only when the entry it lands on has none. Nothing a single entry
		 * held is changed.
		 */
		private fun fold(same: List<Server>): Server {
			val order = same.sortedWith(compareByDescending<Server> { it.opened }.thenByDescending { it.added })
			val win = order.first()
			return win.copy(
				name = win.name.ifBlank { order.firstOrNull { it.name.isNotBlank() }?.name.orEmpty() },
				tvName = win.tvName.ifBlank { order.firstOrNull { it.tvName.isNotBlank() }?.tvName.orEmpty() }
			)
		}

		private fun cleanName(s: String?): String =
			s.orEmpty().replace(Regex("\\s+"), " ").trim().take(MAX_NAME)
	}

	/**
	 * Every server, the one in use first, then by when each was last opened.
	 * Two never opened (added, not paired yet) go newest added first.
	 *
	 * The first read after c261 finds no list and the old single address:
	 * that address becomes a list of one, opened now, so a TV paired before
	 * the update opens exactly as it did and is never asked to pair again
	 * (its cookie is the WebView's, and nothing here touches it). The jar
	 * scopes cookies by host, not origin: two servers on one host share the
	 * one paired cookie (doc/ANDROID.md, "Limits").
	 */
	@Synchronized
	fun all(): List<Server> {
		val stored = kv.get(KEY_SERVERS)
		val list =
			if (stored != null) {
				decode(stored)
			} else {
				val old = Address.originOf(kv.get(KEY_ADDRESS))
				if (old == null) {
					emptyList()
				} else {
					val now = clock()
					val migrated = listOf(Server(origin = old, opened = now, added = now))
					save(migrated)
					migrated
				}
			}
		return list.sortedWith(compareByDescending<Server> { it.opened }.thenByDescending { it.added })
	}

	/** The server launch opens: the last used. Null: nothing is paired (9A). */
	@Synchronized
	fun lastUsed(): Server? = all().firstOrNull()

	@Synchronized
	fun find(origin: String): Server? {
		val clean = Address.originOf(origin) ?: return null
		return all().firstOrNull { it.origin == clean }
	}

	/** Everyone but [origin], in the list's order: 9D's OR OPEN ANOTHER (S9). */
	@Synchronized
	fun others(origin: String): List<Server> {
		val clean = Address.originOf(origin)
		return all().filter { it.origin != clean }
	}

	/**
	 * A server answered: keep it. Adds rather than replaces (the design's
	 * "`remember()` adds"), and never marks it in use: an add that is left at
	 * 9C must not take launch away from the library the TV was in.
	 * Returns true when it was new.
	 */
	@Synchronized
	fun add(origin: String): Boolean {
		val clean = Address.originOf(origin) ?: return false
		val list = all()
		if (list.any { it.origin == clean }) return false
		save(list + Server(origin = clean, added = clock()))
		return true
	}

	/** Its library opened: it is the one in use now, and on the next launch. */
	@Synchronized
	fun opened(origin: String) = update(origin) { it.copy(opened = clock()) }

	/** What the server calls itself (9E, or the library's own page saying it). */
	@Synchronized
	fun named(origin: String, name: String) = update(origin) { it.copy(name = cleanName(name).uppercase()) }

	/** The TV's name for it; empty gives the server's own name back. Kept on the TV only. */
	@Synchronized
	fun rename(origin: String, tvName: String) = update(origin) { it.copy(tvName = cleanName(tvName)) }

	/** Removes it. The caller clears its cookies (the WebView's, not this store's). */
	@Synchronized
	fun forget(origin: String): Boolean {
		val clean = Address.originOf(origin) ?: return false
		val list = all()
		if (list.none { it.origin == clean }) return false
		save(list.filter { it.origin != clean })
		return true
	}

	/**
	 * A server that moved (9D's CHANGE THE ADDRESS for that entry): the new
	 * address takes the entry's place and keeps the TV's name for it. The
	 * server's own name is asked again, since it may not be the same computer.
	 * If the new address is already another entry, that entry stays and the
	 * old one goes, taking the TV's name across only if the other had none.
	 */
	@Synchronized
	fun move(from: String, to: String): Boolean {
		val old = Address.originOf(from) ?: return false
		val new = Address.originOf(to) ?: return false
		if (old == new) return false
		val list = all()
		val was = list.firstOrNull { it.origin == old } ?: return false
		val there = list.firstOrNull { it.origin == new }
		val next =
			if (there != null) {
				list.filter { it.origin != old }.map {
					if (it.origin == new && it.tvName.isBlank()) it.copy(tvName = was.tvName) else it
				}
			} else {
				list.map { if (it.origin == old) it.copy(origin = new, name = "", opened = it.opened) else it }
			}
		save(next)
		return true
	}

	/** The list as the pages read it (`window.TsundokuTV.servers()`), the one in use first. */
	@Synchronized
	fun toJson(): String {
		val list = all()
		val inUse = list.firstOrNull()?.origin
		return list.joinToString(",", "[", "]") {
			"{" +
				"\"origin\":${json(it.origin)}," +
				"\"name\":${json(it.name)}," +
				"\"tvName\":${json(it.tvName)}," +
				"\"shown\":${json(it.shown)}," +
				"\"opened\":${it.opened}," +
				"\"inUse\":${it.origin == inUse}" +
				"}"
		}
	}

	private fun update(origin: String, change: (Server) -> Server): Boolean {
		val clean = Address.originOf(origin) ?: return false
		val list = all()
		if (list.none { it.origin == clean }) return false
		save(list.map { if (it.origin == clean) change(it) else it })
		return true
	}

	private fun save(list: List<Server>) {
		kv.put(KEY_SERVERS, encode(list))
		val last = list.sortedWith(compareByDescending<Server> { it.opened }.thenByDescending { it.added }).firstOrNull()
		if (last == null) kv.remove(KEY_ADDRESS) else kv.put(KEY_ADDRESS, last.origin)
	}
}

/** A JSON string literal, for the little JSON the bridge hands the pages. */
internal fun json(s: String): String {
	val out = StringBuilder("\"")
	for (c in s) {
		when {
			c == '"' -> out.append("\\\"")
			c == '\\' -> out.append("\\\\")
			c == '\n' -> out.append("\\n")
			c == '\r' -> out.append("\\r")
			c == '\t' -> out.append("\\t")
			c < ' ' || c == '\u2028' || c == '\u2029' -> out.append(String.format("\\u%04x", c.code))
			else -> out.append(c)
		}
	}
	return out.append('"').toString()
}

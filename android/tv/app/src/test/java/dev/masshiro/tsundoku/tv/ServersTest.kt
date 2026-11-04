package dev.masshiro.tsundoku.tv

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * The TV's servers (c261): the list, the launch choice, and the migration
 * from the one `address` an app paired before c261 kept.
 */
class ServersTest {
	private class Map : Servers.KeyValue {
		val m = mutableMapOf<String, String>()

		override fun get(key: String) = m[key]

		override fun put(key: String, value: String) {
			m[key] = value
		}

		override fun remove(key: String) {
			m.remove(key)
		}
	}

	private var now = 1_000L
	private val kv = Map()
	private val servers = Servers(kv) { now }

	private val home = "http://192.168.1.23:42143"
	private val zen = "https://zen.tailnet.ts.net:8443"
	private val studio = "http://192.168.1.61:42143"

	@Test
	fun `a TV paired before the update opens the same server, with one in the list`() {
		// Exactly what PairingBridge.remember wrote before c261, and nothing else.
		kv.m["address"] = home
		val list = servers.all()
		assertEquals(listOf(home), list.map { it.origin })
		assertEquals(home, servers.lastUsed()?.origin)
		// Nothing about it asks for pairing again: it counts as opened, so a
		// second server added later does not take launch away from it.
		assertEquals(now, list[0].opened)
		assertEquals("192.168.1.23:42143", list[0].shown)
		// The migration is written once and the old key kept in step.
		assertTrue(kv.m.containsKey("servers"))
		assertEquals(home, kv.m["address"])
		now = 5_000
		assertEquals(1_000L, servers.all()[0].opened)
	}

	@Test
	fun `a TV that never paired has no list and launches 9A`() {
		assertTrue(servers.all().isEmpty())
		assertNull(servers.lastUsed())
		assertFalse(kv.m.containsKey("servers"))
	}

	@Test
	fun `an unreadable old address migrates to nothing rather than a guess`() {
		kv.m["address"] = "   "
		assertNull(servers.lastUsed())
	}

	@Test
	fun `an answer adds, never replaces, and does not take launch`() {
		kv.m["address"] = home
		now = 2_000
		assertTrue(servers.add(zen))
		assertEquals(setOf(home, zen), servers.all().map { it.origin }.toSet())
		// An add left at 9C: the library the TV was in still opens on launch.
		assertEquals(home, servers.lastUsed()?.origin)
		assertEquals(home, kv.m["address"])
		// The same origin again is the same server, whatever its spelling.
		assertFalse(servers.add("https://zen.tailnet.ts.net:8443/library"))
		assertEquals(2, servers.all().size)
	}

	@Test
	fun `the first server added on a new TV is the one launch opens`() {
		assertTrue(servers.add(home))
		assertEquals(home, servers.lastUsed()?.origin)
		assertEquals(home, kv.m["address"])
	}

	@Test
	fun `launch opens the last used, and opening one makes it the last used`() {
		servers.add(home)
		servers.add(zen)
		servers.add(studio)
		now = 2_000
		servers.opened(home)
		now = 3_000
		servers.opened(zen)
		assertEquals(zen, servers.lastUsed()?.origin)
		assertEquals(listOf(zen, home, studio), servers.all().map { it.origin })
		now = 4_000
		servers.opened(home)
		assertEquals(listOf(home, zen, studio), servers.all().map { it.origin })
		assertEquals(home, kv.m["address"])
	}

	@Test
	fun `9D offers everyone but the one that did not answer, never silently another`() {
		servers.add(home)
		now = 1_100
		servers.add(zen)
		now = 1_200
		servers.add(studio)
		now = 2_000
		servers.opened(zen)
		// Launch's choice is the last used, answering or not: the activity
		// probes it and shows 9D for it on a failure (MainActivity.onCreate).
		assertEquals(zen, servers.lastUsed()?.origin)
		assertEquals(listOf(studio, home), servers.others(zen).map { it.origin })
	}

	@Test
	fun `two never opened go newest added first`() {
		servers.add(home)
		now = 2_000
		servers.add(zen)
		assertEquals(listOf(zen, home), servers.all().map { it.origin })
	}

	@Test
	fun `a name is the TV's, else the server's, else the host`() {
		servers.add(zen)
		assertEquals("zen.tailnet.ts.net:8443", servers.find(zen)?.shown)
		servers.named(zen, " zen ")
		assertEquals("ZEN", servers.find(zen)?.shown)
		servers.rename(zen, "  Masshiro's  ")
		assertEquals("Masshiro's", servers.find(zen)?.shown)
		assertEquals("ZEN", servers.find(zen)?.name)
		// Emptied, the server's own name comes back.
		servers.rename(zen, "   ")
		assertEquals("ZEN", servers.find(zen)?.shown)
		assertEquals("", servers.find(zen)?.tvName)
	}

	@Test
	fun `a name that would break a line or a field is kept whole`() {
		servers.add(zen)
		servers.rename(zen, "a\tb\\c\nd")
		assertEquals("a b\\c d", servers.find(zen)?.tvName)
		servers.rename(zen, "x\\ty")
		val again = Servers(kv) { now }
		assertEquals("x\\ty", again.find(zen)?.tvName)
	}

	@Test
	fun `encode and decode are each other's inverse`() {
		val list =
			listOf(
				Servers.Server(home, "ZEN", "Living\\room", 5, 1),
				Servers.Server(zen, "", "", 0, 2)
			)
		assertEquals(list, Servers.decode(Servers.encode(list)))
		assertEquals(Servers.encode(list), Servers.encode(Servers.decode(Servers.encode(list))))
	}

	@Test
	fun `a line that cannot be read is dropped, and the rest still open`() {
		kv.m["servers"] = "not an origin at all\t\t\t\t\n$home\tZEN\t\t7\t1\n\n"
		assertEquals(listOf(home), servers.all().map { it.origin })
	}

	@Test
	fun `forget removes it, and forgetting the last leaves 9A`() {
		servers.add(home)
		servers.add(zen)
		now = 2_000
		servers.opened(zen)
		assertTrue(servers.forget(zen))
		assertEquals(listOf(home), servers.all().map { it.origin })
		assertEquals(home, kv.m["address"])
		assertFalse(servers.forget(zen))
		assertTrue(servers.forget(home))
		assertNull(servers.lastUsed())
		// An older APK installed over this one finds nothing either.
		assertFalse(kv.m.containsKey("address"))
		// And the empty list stays empty: the old key is gone, so nothing migrates back.
		assertTrue(servers.all().isEmpty())
	}

	@Test
	fun `a server that moved keeps the TV's name and its place`() {
		servers.add(home)
		servers.named(home, "ZEN")
		servers.rename(home, "Living room")
		now = 2_000
		servers.opened(home)
		val moved = "http://192.168.1.99:42143"
		assertTrue(servers.move(home, moved))
		val s = servers.find(moved)!!
		assertEquals("Living room", s.tvName)
		assertEquals("", s.name)
		assertEquals(2_000L, s.opened)
		assertNull(servers.find(home))
		assertEquals(moved, kv.m["address"])
	}

	@Test
	fun `moving onto an address already in the list keeps that entry`() {
		servers.add(home)
		servers.rename(home, "Living room")
		servers.add(zen)
		assertTrue(servers.move(home, zen))
		assertEquals(listOf(zen), servers.all().map { it.origin })
		assertEquals("Living room", servers.find(zen)?.tvName)
		assertFalse(servers.move(zen, zen))
	}

	@Test
	fun `every change to an origin not in the list is refused`() {
		servers.add(home)
		assertFalse(servers.opened(zen))
		assertFalse(servers.rename(zen, "x"))
		assertFalse(servers.named(zen, "x"))
		assertFalse(servers.move(zen, studio))
		assertEquals(1, servers.all().size)
	}

	@Test
	fun `the pages read the list as JSON, the one in use first`() {
		servers.add(home)
		servers.add(zen)
		now = 2_000
		servers.opened(zen)
		servers.rename(zen, "Masshiro's \"own\"")
		assertEquals(
			"[{\"origin\":\"https://zen.tailnet.ts.net:8443\",\"name\":\"\",\"tvName\":\"Masshiro's \\\"own\\\"\"," +
				"\"shown\":\"Masshiro's \\\"own\\\"\",\"opened\":2000,\"inUse\":true}," +
				"{\"origin\":\"http://192.168.1.23:42143\",\"name\":\"\",\"tvName\":\"\"," +
				"\"shown\":\"192.168.1.23:42143\",\"opened\":0,\"inUse\":false}]",
			servers.toJson()
		)
		assertEquals("[]", Servers(Map()).toJson())
	}

	@Test
	fun `json escapes what would end the string or the script`() {
		assertEquals("\"a\\\"b\\\\c\\n\\u2028\"", json("a\"b\\c\n "))
	}
}

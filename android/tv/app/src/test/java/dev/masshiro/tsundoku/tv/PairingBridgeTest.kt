package dev.masshiro.tsundoku.tv

import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test
import java.util.concurrent.AbstractExecutorService
import java.util.concurrent.TimeUnit

/**
 * Every bridge call that writes, probes or opens a screen that writes, asked
 * from an unknown page, from the app's own and from a known server's (c529).
 * The Host stands in for the activity and records what the bridge asked of it.
 */
class PairingBridgeTest {
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

	private class FakeHost(var top: String?) : PairingBridge.Host {
		val calls = mutableListOf<String>()

		override fun topUrl() = top

		override fun onUi(block: () -> Unit) = block()

		override fun serversChanged() {
			calls += "serversChanged"
		}

		override fun clearCookies(origin: String) {
			calls += "clearCookies $origin"
		}

		override fun openServer(origin: String) {
			calls += "openServer $origin"
		}

		override fun showAsset(hash: String) {
			calls += "showAsset $hash"
		}

		override fun postProbe(origin: String, ok: Boolean) {
			calls += "postProbe $origin"
		}
	}

	/** Keeps the probes it is handed instead of running them: no network in a unit test. */
	private class Held : AbstractExecutorService() {
		val tasks = mutableListOf<Runnable>()

		override fun execute(command: Runnable) {
			tasks += command
		}

		override fun shutdown() {}

		override fun shutdownNow(): MutableList<Runnable> = mutableListOf()

		override fun isShutdown() = false

		override fun isTerminated() = false

		override fun awaitTermination(timeout: Long, unit: TimeUnit) = true
	}

	private val home = "http://192.168.1.23:42143"
	private val zen = "https://zen.tailnet.ts.net:8443"
	private val asset = "file:///android_asset/pair/index.html#lost=x"

	private class World(top: String?) {
		val kv = Map()
		val servers = Servers(kv) { 1_000L }
		val host = FakeHost(top)
		val io = Held()
		val bridge = PairingBridge(host, servers, io)

		/** The store and every call the host saw: what a refused call must leave as it was. */
		fun snapshot() = Triple(kv.m.toMap(), host.calls.toList(), io.tasks.size)
	}

	private fun world(top: String?): World {
		val w = World(top)
		w.servers.add("http://192.168.1.23:42143")
		w.servers.add("https://zen.tailnet.ts.net:8443")
		w.servers.named("http://192.168.1.23:42143", "HOME")
		w.host.calls.clear()
		return w
	}

	/** Each guarded call, by name, as a page would make it. */
	private val guarded: List<Pair<String, (PairingBridge) -> Unit>> =
		listOf(
			"remember" to { b -> b.remember("http://192.168.1.99:42143") },
			"forget" to { b -> b.forget() },
			"forgetServer" to { b -> b.forgetServer(home) },
			"move" to { b -> b.move(home, "http://192.168.1.99:42143") },
			"rename" to { b -> b.rename(home, "Living room") },
			"named" to { b -> b.named(home, "EVIL") },
			"probe" to { b -> b.probe("http://192.168.1.1:80") },
			"addServer" to { b -> b.addServer() },
			"renameServer" to { b -> b.renameServer(home) }
		)

	@Test
	fun `an unknown page changes nothing through any guarded call`() {
		val unknown =
			listOf(
				"https://example.com/",
				"http://192.168.1.23:42144/",
				"https://192.168.1.23:42143/",
				"about:blank",
				null
			)
		for (top in unknown) {
			for ((name, call) in guarded) {
				val w = world(top)
				val before = w.snapshot()
				call(w.bridge)
				assertEquals("$name from $top", before, w.snapshot())
			}
		}
	}

	@Test
	fun `forgetServer from an unknown page answers the list as it is`() {
		val w = world("https://example.com/")
		assertEquals(w.servers.toJson(), w.bridge.forgetServer(home))
		assertEquals(2, w.servers.all().size)
	}

	@Test
	fun `the app's own page and a known server's page reach every guarded call`() {
		for (top in listOf(asset, "$home/series/3", "$zen/")) {
			for ((name, call) in guarded) {
				val w = world(top)
				val before = w.snapshot()
				call(w.bridge)
				assertTrue("$name from $top did something", before != w.snapshot())
			}
		}
	}

	@Test
	fun `open and welcome stay open, for the page FORGET has just made unknown`() {
		// FORGET of the server in use, from its own library: the list no longer
		// has it, and the page then opens the next one, or 9A for the last.
		val w = world("$home/")
		w.bridge.forgetServer(home)
		w.host.calls.clear()
		w.bridge.open(zen)
		w.bridge.welcome()
		assertEquals(listOf("openServer $zen", "showAsset "), w.host.calls)
		// open still reaches only a server the TV knows.
		w.host.calls.clear()
		w.bridge.open("https://example.com")
		assertEquals(emptyList<String>(), w.host.calls)
	}

	@Test
	fun `forget from a known server's page forgets every server, its own first or not (round 2)`() {
		// The guard is asked once: once home is gone its page is unknown, and
		// asking again for each server stopped the loop after home.
		val w = world("$home/")
		w.bridge.forget()
		assertEquals(emptyList<Servers.Server>(), w.servers.all())
		assertTrue(w.host.calls.contains("clearCookies $zen"))
	}
}

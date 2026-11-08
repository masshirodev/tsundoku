package dev.masshiro.tsundoku.tv

/**
 * Whose page may make the bridge write (c529), and since c549 read the owner's
 * things (the list, the TV's address, its network): the app's own asset page,
 * or a page of a server this TV already knows. `window.TsundokuTV` is injected into
 * every page and frame the WebView loads, and nothing keeps the WebView on
 * those two, so an external link followed from a server's page would
 * otherwise be able to forget every server and its cookies, or `move()` a
 * known entry to its own origin so that launch opens it.
 *
 * The rule is asked about the WebView's top-level URL, read on the UI thread
 * (`PairingBridge.Host.topUrl`). A frame cannot change that URL; a top-level
 * navigation can, and that is what the rule is about. The scheme test is
 * case-blind, as [Address.originOf]'s is (c646): `HTTP://zen.local:42143` is
 * the same page as `http://zen.local:42143`, not a scheme of its own, and a
 * capitalised scheme on an unknown host is still refused by the origin
 * comparison. A frame inside a known
 * server's page is not told apart by it (a JavaScript interface does not say
 * which frame called): tsundoku draws no third-party frames, and the way to
 * close that too is `WebViewCompat.addWebMessageListener` with origin rules
 * ([allowsMessage], below, is the rule such a listener would ask; it is
 * pinned by `MessageGuardTest` and not wired to anything yet).
 * `doc/TV-APP.md`, "What it does not do yet", says what that move still
 * needs; wave 29 moved the app's own page to `WebViewAssetLoader` (step 1),
 * and the listener itself is step 3.
 *
 * Pure, so BridgeGuardTest and PairingBridgeTest pin it.
 */
object BridgeGuard {
	/** The host `WebViewAssetLoader` serves the app's own page from (c549). */
	const val ASSET_HOST = "appassets.androidplatform.net"

	/** The app's own page (9A, 9B, 9D, S5, S7, S8, S9), whatever its launch token and fragment. */
	const val ASSET = "https://$ASSET_HOST/pair/index.html"

	/**
	 * The origin the pair page loads from since c549: `WebViewAssetLoader`
	 * serves [ASSET] there in `MainActivity.shouldInterceptRequest`, and a real
	 * network answer at that host is never trusted. The loader is mounted at
	 * `/`, so any file under `assets/` is served there to a main-frame GET that
	 * carries the launch's token (round 4); a path the loader does not hold is
	 * 404, and every other request for the host is 404 before the loader is
	 * asked. A message from the page carries this as its `sourceOrigin`, which
	 * is what [allowsMessage] trusts.
	 */
	const val ASSET_ORIGIN = "https://$ASSET_HOST"

	/** The app's own page, and nothing else: [ASSET] with a query (its launch token) or a fragment. */
	fun isAsset(url: String?): Boolean {
		val u = url?.trim().orEmpty()
		return u == ASSET || u.startsWith("$ASSET#") || u.startsWith("$ASSET?")
	}

	/**
	 * True for a navigation the WebView must not carry out: anything addressed
	 * to [ASSET_HOST], case-blind, whatever its scheme, path, query or
	 * fragment (c549, round 2).
	 *
	 * [ASSET] is an ordinary https URL since wave 29, so any page the WebView
	 * shows — a server's page, an external link followed from one, a frame in
	 * either — can set `location` to it with a `#connect=` fragment and make
	 * the pair page probe and `remember` an attacker's server. A `file://`
	 * page could not be reached that way, which is what made the old URL safe.
	 * `shouldOverrideUrlLoading` asks this of every navigation (the app's own
	 * `loadUrl` never reaches that callback, and the page's own hash changes
	 * are same-document).
	 */
	fun refusesNavigation(url: String?): Boolean = isAssetHost(url)

	/**
	 * True for a request the asset loader must not answer (c549, rounds 3 and
	 * 4): anything addressed to [ASSET_HOST] that is not the main frame's GET of
	 * the launch's own [ASSET] URL.
	 *
	 * [refusesNavigation] cannot close this by itself: `shouldOverrideUrlLoading`
	 * is not called for POST requests, and on a WebView that does not report a
	 * redirect (androidx's `SHOULD_OVERRIDE_WITH_REDIRECTS` is a WebView-APK
	 * feature, not an API level) it does not see a 302 either. A form submission
	 * keeps its action URL's fragment, so a page could `submit()` a form to
	 * `ASSET#connect=http://evil:42143` and the loader would serve the pair
	 * page as the main document. The method is compared without case, and an
	 * absent one is not a GET. A sub-frame's request for the host is refused
	 * here too (round 2's embed), and every other host is somebody else's and
	 * is not refused.
	 *
	 * The last test is a **per-launch capability** rather than a navigation
	 * callback: `MainActivity.loadAsset` writes a random `?t=…` into the URL it
	 * loads (round 4), and a request is served only when its query is exactly
	 * that token. Only the app knows it, so a URL a page can write — a link,
	 * `location =`, a meta refresh, a 302, a form submit, `window.open` —
	 * arrives without it and is 404 whatever the WebView version calls. It
	 * does not depend on `shouldOverrideUrlLoading`, and it costs no reload:
	 * a reload reloads the same document, token included. The navigation rule
	 * stays as well, so a page-initiated navigation is stopped before it
	 * becomes a 404 page.
	 *
	 * `MainActivity.shouldInterceptRequest` asks this before the loader.
	 */
	fun refusesAssetRequest(
		url: String?,
		isMainFrame: Boolean,
		method: String?,
		token: String?
	): Boolean {
		if (!isAssetHost(url)) return false
		if (!isMainFrame) return true
		if (!"GET".equals(method, ignoreCase = true)) return true
		return !carriesAssetToken(url, token)
	}

	/** True when [url]'s query is exactly the launch's own `t=<token>` (round 4). */
	fun carriesAssetToken(url: String?, token: String?): Boolean {
		val t = token?.trim().orEmpty()
		if (t.isEmpty()) return false
		val query = runCatching { java.net.URI(url.orEmpty()) }.getOrNull()?.rawQuery ?: return false
		return query == "t=$t"
	}

	/**
	 * True when [url] names [ASSET_HOST], read case-blind, whatever its scheme,
	 * path, query or fragment, and whether or not the rest of it parses
	 * (c684). Every refusal of the host asks this, so it must fail closed: a
	 * URL that names the host is the host's, even when it is not a URL
	 * `java.net.URI` accepts.
	 */
	fun isAssetHost(url: String?): Boolean = hostOf(url) == ASSET_HOST

	/**
	 * The schemes whose authority a browser reads without `//`, and whose `\`
	 * is a `/`: the URL standard's "special" schemes, less `file`, whose
	 * `file:///path` names no host and is read here as any other scheme is.
	 */
	private val SPECIAL = setOf("http", "https", "ws", "wss", "ftp")

	/**
	 * The host [url] names, lower-cased, read the way a browser reads an
	 * authority, or null when it names none (c684).
	 *
	 * `java.net.URI` was the reader until c684, and it throws on characters a
	 * WebView leaves as they are: the URL standard's query percent-encode set
	 * does not hold `|`, `{`, `}` or `^`, and its fragment set does not hold
	 * `|` either, so `ASSET?x=|` or `ASSET#connect=|` had no host to it and
	 * every guard that asks [isAssetHost] let it through to the network.
	 * Whether a real WebView hands `shouldInterceptRequest` such a URL
	 * unescaped is read from the standard, not run on a TV (`doc/TV-APP.md`,
	 * "What is not verified").
	 *
	 * This reads only the authority, and never throws: tabs and newlines are
	 * dropped and the ends trimmed (as a browser does before parsing); the
	 * scheme is the letters before the first `:`; a special scheme takes its
	 * authority after any run of `/` or `\`, any other only after `//`; the
	 * authority ends at the first `/`, `?` or `#` (or `\` for a special
	 * scheme); the host is what follows its last `@` and comes before its
	 * port; `%XX` escapes are decoded (a browser decodes them in a host, so
	 * `appassets%2eandroidplatform.net` is the host), and one trailing dot,
	 * which names the same host to DNS, is dropped. Pure, so BridgeGuardTest
	 * pins it: `android.net.Uri` is not there in a JVM test.
	 */
	fun hostOf(url: String?): String? {
		val u = url.orEmpty().filterNot { it == '\t' || it == '\n' || it == '\r' }.trim()
		val colon = u.indexOf(':')
		if (colon <= 0) return null
		val scheme = u.substring(0, colon)
		if (!scheme[0].isAsciiLetter()) return null
		if (!scheme.all { it.isAsciiLetter() || it in '0'..'9' || it == '+' || it == '-' || it == '.' }) return null
		val special = scheme.lowercase() in SPECIAL
		var at = colon + 1
		if (special) {
			while (at < u.length && (u[at] == '/' || u[at] == '\\')) at++
		} else {
			if (!u.startsWith("//", at)) return null
			at += 2
		}
		var end = at
		while (end < u.length && u[end] != '/' && u[end] != '?' && u[end] != '#' && !(special && u[end] == '\\')) end++
		val hostPort = u.substring(at, end).substringAfterLast('@')
		val host =
			if (hostPort.startsWith('[')) {
				val close = hostPort.indexOf(']')
				if (close < 0) hostPort else hostPort.substring(0, close + 1)
			} else {
				hostPort.substringBefore(':')
			}
		val read = percentDecoded(host).lowercase()
		val name = if (read.endsWith('.') && !read.endsWith("..")) read.dropLast(1) else read
		return name.ifEmpty { null }
	}

	private fun Char.isAsciiLetter() = this in 'a'..'z' || this in 'A'..'Z'

	/** `%XX` runs decoded as UTF-8 bytes; anything that is not an escape is kept as written. */
	private fun percentDecoded(s: String): String {
		if ('%' !in s) return s
		val out = StringBuilder()
		val bytes = java.io.ByteArrayOutputStream()
		var i = 0
		while (i < s.length) {
			if (s[i] == '%' && i + 2 < s.length && hex(s[i + 1]) >= 0 && hex(s[i + 2]) >= 0) {
				bytes.write(hex(s[i + 1]) * 16 + hex(s[i + 2]))
				i += 3
				continue
			}
			if (bytes.size() > 0) {
				out.append(bytes.toString("UTF-8"))
				bytes.reset()
			}
			out.append(s[i])
			i++
		}
		if (bytes.size() > 0) out.append(bytes.toString("UTF-8"))
		return out.toString()
	}

	private fun hex(c: Char): Int =
		when (c) {
			in '0'..'9' -> c - '0'
			in 'a'..'f' -> c - 'a' + 10
			in 'A'..'F' -> c - 'A' + 10
			else -> -1
		}

	fun allows(url: String?, known: (String) -> Boolean): Boolean {
		val u = url?.trim().orEmpty()
		if (isAsset(u)) return true
		if (!u.startsWith("http://", ignoreCase = true) && !u.startsWith("https://", ignoreCase = true)) return false
		val origin = Address.originOf(u) ?: return false
		return known(origin)
	}

	/**
	 * What a message listener asks, one message at a time (c549 part (b); not
	 * wired to anything yet). A JavaScript interface cannot say which frame
	 * called it, so a third-party iframe inside a known server's page reaches
	 * every call today. `WebViewCompat.addWebMessageListener` hands its callback
	 * the message's `sourceOrigin` — the calling frame's **origin** (scheme,
	 * host and port; never a path, query or fragment) — and `isMainFrame`, and
	 * this is the decision to make with them: only a **main** frame may reach
	 * the bridge, and only from the app's own page or a server this TV knows.
	 *
	 * Trust is by origin, not by URL, so this must not delegate to [allows]: a
	 * message never carries the asset URL. A main frame is trusted when its
	 * origin is exactly [ASSET_ORIGIN], or when it is an origin this TV knows.
	 * "An origin" is strict: it parses with an http or https scheme, has a
	 * host, and carries no userinfo, path, query or fragment, so `http://host/`
	 * and `http://host/series/12` are refused as well as `http://host?x=1`.
	 * Everything else is refused: the opaque `"null"` (a `file://` page's
	 * report), an absent origin, `""`, `about:`, `data:`, `javascript:`, and
	 * [ASSET] itself (a URL with a path is not an origin). The asset page now
	 * loads from [ASSET_ORIGIN] through `WebViewAssetLoader` (c549, item 1 of
	 * `doc/TV-APP.md`'s order), which is what makes this rule's asset branch
	 * reachable; the listener itself is still item 3 and not built.
	 *
	 * A known server is compared through [Address.originOf], as the top-level
	 * guard's is, and [Address.originOf] lower-cases the scheme and the host
	 * (c548): a message whose origin kept the host's capitals is the same
	 * server, and so is one whose scheme is capitalised. Its http/https twin or
	 * another port is not.
	 */
	fun allowsMessage(sourceOrigin: String?, isMainFrame: Boolean, known: (String) -> Boolean): Boolean {
		if (!isMainFrame) return false
		val at = sourceOrigin?.trim().orEmpty()
		if (at == ASSET_ORIGIN) return true
		if (!isOrigin(at)) return false
		return known(Address.originOf(at) ?: return false)
	}

	/** True when [at] is exactly an origin: scheme, host and port, nothing else. */
	private fun isOrigin(at: String): Boolean {
		val url = runCatching { java.net.URI(at) }.getOrNull() ?: return false
		val scheme = url.scheme?.lowercase() ?: return false
		if (scheme != "http" && scheme != "https") return false
		if (url.host.isNullOrEmpty()) return false
		if (url.rawUserInfo != null) return false
		if (!url.rawPath.isNullOrEmpty()) return false
		return url.rawQuery == null && url.rawFragment == null
	}
}

/**
 * The engine's wire format, without the wire: what doc/EXTENSION-ENGINE.md's
 * "API reference" says, as pure functions the client and the tests share.
 */

/** 1.6 sources hang a memo off a URL; the engine writes it as `<url>|mangayomi-memo|<base64url JSON>`. */
const MEMO = '|mangayomi-memo|';

/** The Mihon URL a key is made of, and the memo to send back with it (doc/DOWNLOADER.md, "Keys"). */
export function splitMemo(url: string): { url: string; memo: string | null } {
	const at = url.indexOf(MEMO);
	return at < 0
		? { url, memo: null }
		: { url: url.slice(0, at), memo: url.slice(at + MEMO.length) };
}

export const joinMemo = (url: string, memo: string | null) => (memo ? url + MEMO + memo : url);

/**
 * A browser's User-Agent. The engine copies the caller's into every source,
 * process-wide (only one starting "Dart/" is left alone), and with Node's
 * own eight of the nine library sources answered 403 in the spike.
 */
export const USER_AGENT = 'Mozilla/5.0 (X11; Linux x86_64; rv:139.0) Gecko/20100101 Firefox/139.0';

/** The bridge entry that makes the engine take tsundoku's values over its own. */
export const BRIDGE_CONTEXT = '__mangayomi_bridge_context__';

/**
 * A source's preference as the engine describes it (`preferencesManga`) and
 * takes it back: the key, and one entry named by its type holding the value
 * (`value`, `valueIndex` with its `entryValues`, or `values`) beside the rest
 * of the description, which the engine needs too.
 */
export type Preference = { key: string } & Record<string, unknown>;

/**
 * What every call carries: the source's values, kept by tsundoku since the
 * engine keeps none across a restart, and the context saying they replace
 * whatever the engine's own copy holds ("replace-present"). Without it the
 * engine writes a value only when the key is new, so a change made in
 * tsundoku would never reach a source that had run before.
 */
export function preferenceSnapshot(
	prefs: Preference[],
	changedKey?: string
): Record<string, unknown>[] {
	return [
		...prefs,
		{
			key: BRIDGE_CONTEXT,
			preferenceApplyMode: 'replace-present',
			...(changedKey ? { changedPreferenceKey: changedKey } : {})
		}
	];
}

export type EngineFailure =
	/** The engine itself isn't answering: stopped, restarting, the disk not mounted. */
	| 'down'
	/** tsundoku's token isn't the engine's. */
	| 'unauthorized'
	/** The handle isn't loaded: send the APK. */
	| 'not-loaded'
	/** The site asked to slow down. */
	| 'rate-limited'
	/** The site refused (403) or doesn't have it (404). */
	| 'refused'
	| 'not-found'
	/** The source no longer lists the chapter: retrying won't bring it back. */
	| 'not-at-source'
	/**
	 * A WebView extension whose browser wasn't there: still downloading or
	 * starting, failed, or turned off on this install (doc/EXTENSION-ENGINE.md,
	 * "WebView support"). The message says which, in place of the extension's
	 * own "timed out".
	 */
	| 'webview'
	/** Anything else the source threw. */
	| 'source';

/**
 * What a failed call means. The status alone can't say: the engine answers
 * 500 for a 429, but its body's `code` carries the site's real status.
 */
export function failureOf(status: number, body: unknown): EngineFailure {
	const code = typeof body === 'object' && body && 'code' in body ? Number(body.code) : status;
	if (status === 401) return 'unauthorized';
	if (status === 409 || code === 409) return 'not-loaded';
	if (code === 429) return 'rate-limited';
	// An extension that meets a rate limit often throws it as plain text, which
	// the engine answers as a 500 ("You have been rate limited. Wait a few
	// seconds and refresh": AnimePahe, 2026-10-29).
	const said = typeof body === 'object' && body && 'error' in body ? String(body.error) : '';
	if (/rate.?limit|too many requests/i.test(said)) return 'rate-limited';
	if (code === 403) return 'refused';
	if (code === 404) return 'not-found';
	return 'source';
}

/**
 * The engine's proxy URLs name its own port inside its container
 * (`http://127.0.0.1:8080/image/<token>`); tsundoku reaches it at ENGINE_URL.
 * Only a loopback address is one: a site's own `/image/` path (KickAssAnime's
 * `https://kaa.lt/image/poster/…`) is the site's, and must not be sent to the
 * engine as if it were a token.
 */
export function proxyUrl(url: string, engineUrl: string): string {
	const m = /^https?:\/\/(?:127\.0\.0\.1|localhost|\[::1\])(?::\d+)?(\/(?:image|video)\/.*)$/i.exec(
		url
	);
	return m ? engineUrl.replace(/\/$/, '') + m[1] : url;
}

const startsWith = (b: Uint8Array, bytes: number[], at = 0) =>
	bytes.every((x, i) => b[at + i] === x);

/**
 * What an image really is, from its first bytes: content types lie (Weeb
 * Central serves JPEG as image/png). Null when it isn't an image a CBZ can
 * hold, which is how a site's error page passed off as a picture is caught.
 */
export function imageType(b: Uint8Array): 'jpg' | 'png' | 'gif' | 'webp' | 'avif' | 'jxl' | null {
	if (startsWith(b, [0xff, 0xd8, 0xff])) return 'jpg';
	if (startsWith(b, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) return 'png';
	if (startsWith(b, [0x47, 0x49, 0x46, 0x38])) return 'gif';
	if (startsWith(b, [0x52, 0x49, 0x46, 0x46]) && startsWith(b, [0x57, 0x45, 0x42, 0x50], 8))
		return 'webp';
	if (
		startsWith(b, [0x66, 0x74, 0x79, 0x70], 4) &&
		/^avi[fs]$/.test(String.fromCharCode(...b.slice(8, 12)))
	)
		return 'avif';
	if (startsWith(b, [0xff, 0x0a]) || startsWith(b, [0, 0, 0, 0x0c, 0x4a, 0x58, 0x4c, 0x20]))
		return 'jxl';
	return null;
}

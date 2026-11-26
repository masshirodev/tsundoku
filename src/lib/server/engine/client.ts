import { createHash } from 'node:crypto';
import {
	USER_AGENT,
	failureOf,
	preferenceSnapshot,
	proxyUrl,
	type EngineFailure,
	type Preference
} from './protocol.ts';
import { parseWebViewStatus, webviewFailure, type WebViewStatus } from '../../webview.ts';
import { engineAuth } from './auth.ts';
import { publicFetch, readCapped } from '../net-guard.ts';

/**
 * tsundoku calling the extension engine (doc/EXTENSION-ENGINE.md, "Running
 * it"; doc/DOWNLOADS.md): the only thing that does. Off unless ENGINE_URL
 * and ENGINE_TOKEN are both set.
 */

export const engineConfigured = () => !!process.env.ENGINE_URL && !!process.env.ENGINE_TOKEN;
const engineUrl = () => (process.env.ENGINE_URL ?? '').replace(/\/$/, '');
/** FlareSolverr as the engine reaches it, inside its own network (ops/engine/compose.yml). */
const solverUrl = () => process.env.ENGINE_SOLVER_URL ?? 'http://flaresolverr:8191/v1';

/** When the engine stopped answering, for NOT ANSWERING · SINCE 14:02. Null while it answers. */
let downSince: number | null = null;
export const engineDownSince = () => downSince;

// Plain fields, not constructor parameter properties: the timer scripts run
// under Node's type stripping, which can't load those.
export class EngineError extends Error {
	readonly failure: EngineFailure;
	readonly status: number;
	/** A WebView extension's error carries the WebView's status (doc/EXTENSION-ENGINE.md). */
	readonly webview: WebViewStatus | null;
	constructor(
		message: string,
		failure: EngineFailure,
		status = 0,
		webview: WebViewStatus | null = null
	) {
		super(message);
		this.failure = failure;
		this.status = status;
		this.webview = webview;
	}
}

/**
 * An installed extension as the client needs it: the handle the engine knows
 * it by (its APK's SHA-256) and a way to read the APK, sent when the engine
 * answers that it doesn't have it.
 */
export type Extension = { handle: string; apk: () => Promise<Uint8Array> };

export const handleOf = (apk: Uint8Array) => createHash('sha256').update(apk).digest('hex');

// One call at a time into each extension. The engine serialises them anyway
// (sources keep cursors on the instance), so sending more only makes them wait
// in its threads instead of here, where the order is ours.
const lanes = new Map<string, Promise<unknown>>();

function inLane<T>(handle: string, run: () => Promise<T>): Promise<T> {
	const before = lanes.get(handle) ?? Promise.resolve();
	const next = before.then(run, run);
	const settled = next.catch(() => {});
	lanes.set(handle, settled);
	void settled.then(() => {
		if (lanes.get(handle) === settled) lanes.delete(handle);
	});
	return next;
}

const authorization = () => ({ authorization: `Bearer ${process.env.ENGINE_TOKEN ?? ''}` });

/**
 * A request to the engine that got no answer. A timeout is a slow source (a
 * site's browser check, a rate limit the solver waited out), not a missing
 * engine: only a refused or reset connection says the engine is down, or
 * BROWSE says the engine has stopped while a source is rate-limiting.
 */
function unreachable(e: unknown, timeoutMs: number): EngineError {
	if ((e as Error).name === 'TimeoutError')
		return new EngineError(
			`The source took longer than ${Math.round(timeoutMs / 1000)} s to answer`,
			'source'
		);
	downSince ??= Date.now();
	return new EngineError(`The engine is not answering (${(e as Error).message})`, 'down');
}

async function post(body: Record<string, unknown>, timeoutMs: number): Promise<Response> {
	try {
		const res = await fetch(`${engineUrl()}/dalvik`, {
			method: 'POST',
			headers: {
				'content-type': 'application/json',
				'user-agent': USER_AGENT,
				'cf-proxy-url': solverUrl(),
				...authorization()
			},
			body: JSON.stringify(body),
			signal: AbortSignal.timeout(timeoutMs)
		});
		downSince = null;
		return res;
	} catch (e) {
		throw unreachable(e, timeoutMs);
	}
}

/**
 * A failed call, in tsundoku's terms. A WebView extension's error carries
 * the WebView's status (`webview`), since its own message is only its
 * timeout: while Chromium is still coming, failed, or off on this install,
 * that is what the call failed of, and what it says (`webviewFailure`).
 */
export function failureFrom(status: number, body: unknown): EngineError {
	const b = (body && typeof body === 'object' ? body : null) as {
		error?: string;
		code?: number;
		webview?: unknown;
	} | null;
	const webview = parseWebViewStatus(b?.webview);
	const instead = webviewFailure(webview);
	if (instead) return new EngineError(instead.line, 'webview', status, webview);
	return new EngineError(
		b?.error ?? `The engine answered ${status}`,
		failureOf(status, b),
		status,
		webview
	);
}

async function failure(res: Response): Promise<EngineError> {
	return failureFrom(res.status, await res.json().catch(() => null));
}

export type CallOptions = {
	/** Which source of the extension: required for multi-source ones (MangaDex). */
	sourceId: string;
	/** The source's values, owned by tsundoku and sent every time. */
	preferences?: Preference[];
	/** For setPreference: the key the call changes. */
	changedKey?: string;
	/** A first call through a Cloudflare challenge took 42 s in the spike. */
	timeoutMs?: number;
};

/**
 * Calls [method] of [ext]'s source, sending the APK only when the engine
 * says it doesn't have it (a handle never sent: the engine keeps APKs across
 * restarts).
 */
export function call<T>(
	ext: Extension,
	method: string,
	args: Record<string, unknown>,
	opts: CallOptions
): Promise<T> {
	return inLane(ext.handle, async () => {
		const body: Record<string, unknown> = {
			...args,
			method,
			sourceId: opts.sourceId,
			extensionId: ext.handle,
			preferences: preferenceSnapshot(opts.preferences ?? [], opts.changedKey)
		};
		const timeoutMs = opts.timeoutMs ?? 60_000;
		let res = await post(body, timeoutMs);
		if (res.status === 409) {
			const apk = await ext.apk();
			if (handleOf(apk) !== ext.handle)
				throw new EngineError(`The APK for ${ext.handle} no longer matches it`, 'not-loaded', 409);
			res = await post({ ...body, data: Buffer.from(apk).toString('base64') }, timeoutMs);
		}
		if (!res.ok) throw await failure(res);
		return (await res.json()) as T;
	});
}

/**
 * Loads [apk] into the engine and returns what it is (`extensionInfo`): the
 * first call of a newly installed extension.
 */
export async function load<T>(
	apk: Uint8Array,
	timeoutMs = 60_000
): Promise<{ handle: string; info: T }> {
	const handle = handleOf(apk);
	return inLane(handle, async () => {
		const res = await post(
			{
				method: 'extensionInfo',
				data: Buffer.from(apk).toString('base64'),
				preferences: preferenceSnapshot([])
			},
			timeoutMs
		);
		if (!res.ok) throw await failure(res);
		const given = res.headers.get('x-mangayomi-extension-id');
		if (given && given !== handle)
			throw new EngineError(`The engine named ${handle} ${given}`, 'source');
		return { handle, info: (await res.json()) as T };
	});
}

export type Challenges = {
	/** Hosts whose browser check is being solved now, since when (ms). */
	solving: Record<string, number>;
	/** Hosts whose check was last solved, when. */
	solved: Record<string, number>;
};

/** The fork's `/challenges` (doc/EXTENSION-ENGINE.md): quick, so a waiting page can ask every second. */
export async function challenges(timeoutMs = 2_000): Promise<Challenges> {
	const res = await fetch(`${engineUrl()}/challenges`, {
		headers: authorization(),
		signal: AbortSignal.timeout(timeoutMs)
	});
	if (!res.ok) throw new EngineError(`The engine answered ${res.status}`, 'source', res.status);
	const j = (await res.json()) as Partial<Challenges>;
	return { solving: j.solving ?? {}, solved: j.solved ?? {} };
}

/**
 * The engine's `/capabilities`, or null when it doesn't answer. Its `webview`
 * says whether this engine runs WebView extensions (an older one has no such
 * key at all: `webviewSupport`, src/lib/webview.ts).
 */
export async function capabilities(timeoutMs = 1_500): Promise<Record<string, unknown> | null> {
	try {
		const res = await fetch(`${engineUrl()}/capabilities`, {
			headers: authorization(),
			signal: AbortSignal.timeout(timeoutMs)
		});
		if (!res.ok) return null;
		const j = (await res.json()) as unknown;
		return j && typeof j === 'object' ? (j as Record<string, unknown>) : null;
	} catch {
		return null;
	}
}

/**
 * The engine's `GET /webview`: how its headless Chromium is (off, idle,
 * starting with the phase and percent, ready, failed and why). Null when the
 * engine doesn't answer, or is older than it (404). Never starts anything.
 */
export async function webviewStatus(timeoutMs = 1_500): Promise<WebViewStatus | null> {
	try {
		const res = await fetch(`${engineUrl()}/webview`, {
			headers: authorization(),
			signal: AbortSignal.timeout(timeoutMs)
		});
		return res.ok ? parseWebViewStatus(await res.json()) : null;
	} catch {
		return null;
	}
}

/**
 * One of the engine's own /video/ or /image/ addresses as it hands them out
 * (`http://127.0.0.1:<its port>/video/<token>`, inside its container): the
 * same path on ENGINE_URL. Only a loopback address is the engine's; a site's
 * own /video/ path is the site's.
 */
export function engineMediaPath(url: string): string | null {
	const m =
		/^https?:\/\/(?:127\.0\.0\.1|localhost|\[::1\])(?::\d+)?(\/(?:video|image)\/[^\s]*)$/i.exec(
			url
		);
	if (m) return m[1];
	// Or the engine's own address, when it names that instead of loopback: the
	// web edition's engine has no listener, and hands out ENGINE_URL's origin
	// (http://engine.tsundoku.invalid, doc/WEB-EDITION.md, "The engine"). Read
	// as loopback only, every browse cover there had no route (2026-11-26).
	const own = engineUrl().toLowerCase();
	if (!own || !url.toLowerCase().startsWith(`${own}/`)) return null;
	const path = url.slice(own.length);
	return /^\/(?:video|image)\/\S*$/i.test(path) ? path : null;
}

/**
 * The token of one of the engine's /image/ addresses, or null. A site's own
 * `/image/` path isn't one: KickAssAnime's posters live at
 * `https://kaa.lt/image/poster/…`, which read as the engine's token "poster".
 */
export function engineImageToken(url: string | null | undefined): string | null {
	const path = url ? engineMediaPath(url) : null;
	return path ? (/^\/image\/([^/?#]+)/i.exec(path)?.[1] ?? null) : null;
}

/** A stream through the engine, unbuffered: an episode's segments are megabytes each. */
export async function engineMedia(
	path: string,
	init: { range?: string | null; timeoutMs?: number } = {}
): Promise<Response> {
	try {
		return await fetch(`${engineUrl()}${path}`, {
			headers: {
				'user-agent': USER_AGENT,
				...authorization(),
				...(init.range ? { range: init.range } : {})
			},
			signal: AbortSignal.timeout(init.timeoutMs ?? 60_000)
		});
	} catch (e) {
		throw unreachable(e, init.timeoutMs ?? 60_000);
	}
}

/** A page is a picture: past this it is something else, and is not read to the end. */
export const MAX_PAGE_BYTES = 64 * 1024 * 1024;

/**
 * Where [url] is on the engine, when it is the engine's: one of the proxy
 * addresses it hands out (`engineMediaPath`, its own port inside its
 * container), or an address on ENGINE_URL itself. Null for anything else,
 * which is a site's.
 */
function onEngine(url: string): string | null {
	const path = engineMediaPath(url);
	if (path) return proxyUrl(url, engineUrl());
	return engineAuth(url).authorization ? url : null;
}

/**
 * The bytes behind a page's address. One of the engine's /image/ or /video/
 * URLs is fetched from the engine, with its token, through the source's own
 * client, interceptors and cookies included (the spike: MANGA Plus's pages
 * are XOR-encrypted without them). Any other address is the site's, named by
 * the source: it gets no token, since the token must never leave for a host
 * that isn't the engine, and it is fetched as any address a source names is,
 * on the internet only (net-guard.ts). Not in a lane: the engine doesn't lock
 * an extension for these, and a chapter's pages are fetched several at a
 * time.
 */
export async function fetchProxied(
	url: string,
	timeoutMs = 60_000
): Promise<{ bytes: Uint8Array; type: string }> {
	const engine = onEngine(url);
	let res: Response;
	if (engine) {
		try {
			res = await fetch(engine, {
				headers: { 'user-agent': USER_AGENT, ...authorization() },
				signal: AbortSignal.timeout(timeoutMs)
			});
		} catch (e) {
			throw unreachable(e, timeoutMs);
		}
	} else {
		try {
			res = await publicFetch(url, {
				headers: { 'user-agent': USER_AGENT },
				signal: AbortSignal.timeout(timeoutMs)
			});
		} catch (e) {
			throw new EngineError(`The page could not be fetched (${(e as Error).message})`, 'source');
		}
	}
	if (!res.ok) {
		const text = await res.text().catch(() => '');
		// 404 is a token the engine forgot (a restart): ask for the page list again.
		throw new EngineError(
			(engine && text) || `The ${engine ? 'engine' : 'site'} answered ${res.status}`,
			res.status === 404 ? 'not-found' : 'source',
			res.status
		);
	}
	let bytes: Buffer;
	try {
		bytes = await readCapped(res, MAX_PAGE_BYTES);
	} catch (e) {
		throw new EngineError(`The page is too large (${(e as Error).message})`, 'source');
	}
	return { bytes: new Uint8Array(bytes), type: res.headers.get('content-type') ?? '' };
}

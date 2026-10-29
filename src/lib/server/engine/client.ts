import { createHash } from 'node:crypto';
import {
	USER_AGENT,
	failureOf,
	preferenceSnapshot,
	proxyUrl,
	type EngineFailure,
	type Preference
} from './protocol.ts';

/**
 * tsundoku calling the extension engine (doc/EXTENSION-ENGINE.md, "Running
 * it"; doc/DOWNLOADER.md): the only thing that does. Off unless ENGINE_URL
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
	constructor(message: string, failure: EngineFailure, status = 0) {
		super(message);
		this.failure = failure;
		this.status = status;
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
		// A timeout is a slow source, not a missing engine: only a refused or
		// reset connection says the engine is down.
		if ((e as Error).name !== 'TimeoutError') downSince ??= Date.now();
		throw new EngineError(`The engine is not answering (${(e as Error).message})`, 'down');
	}
}

async function failure(res: Response): Promise<EngineError> {
	const body = (await res.json().catch(() => null)) as { error?: string; code?: number } | null;
	return new EngineError(
		body?.error ?? `The engine answered ${res.status}`,
		failureOf(res.status, body),
		res.status
	);
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
 * says it doesn't have it (a handle never sent: since c131 the engine keeps
 * APKs across restarts).
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
	return m ? m[1] : null;
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
		if ((e as Error).name !== 'TimeoutError') downSince ??= Date.now();
		throw new EngineError(`The engine is not answering (${(e as Error).message})`, 'down');
	}
}

/**
 * The bytes behind one of the engine's /image/ or /video/ URLs, fetched
 * through the source's own client, interceptors and cookies included (the
 * spike: MANGA Plus's pages are XOR-encrypted without them). Not in a lane:
 * the engine doesn't lock an extension for these, and a chapter's pages are
 * fetched several at a time.
 */
export async function fetchProxied(
	url: string,
	timeoutMs = 60_000
): Promise<{ bytes: Uint8Array; type: string }> {
	let res: Response;
	try {
		res = await fetch(proxyUrl(url, engineUrl()), {
			headers: { 'user-agent': USER_AGENT, ...authorization() },
			signal: AbortSignal.timeout(timeoutMs)
		});
	} catch (e) {
		if ((e as Error).name !== 'TimeoutError') downSince ??= Date.now();
		throw new EngineError(`The engine is not answering (${(e as Error).message})`, 'down');
	}
	if (!res.ok) {
		const text = await res.text().catch(() => '');
		// 404 is a token the engine forgot (a restart): ask for the page list again.
		throw new EngineError(
			text || `The engine answered ${res.status}`,
			res.status === 404 ? 'not-found' : 'source',
			res.status
		);
	}
	return {
		bytes: new Uint8Array(await res.arrayBuffer()),
		type: res.headers.get('content-type') ?? ''
	};
}

// The engine, as the server code sees it (doc/WEB-EDITION.md, "The engine").
// tsundoku's engine client (src/lib/server/engine/client.ts) talks to the
// extension engine over HTTP at ENGINE_URL. In the web edition the engine runs
// in a worker of the leading tab, so ENGINE_URL names an origin that exists
// nowhere (ENGINE_ORIGIN), and this replaces the server worker's fetch for
// that origin with a message to the engine's worker, over a MessagePort the
// tab hands over. Every other fetch is the browser's own.
//
// The engine is `off` (no fetcher, or no engine in this build), `starting`
// (about 7 to 20 s on a visit), `ready`, or `failed`. Off and failed fail a
// call at once, as an engine that is down does for the self-hosted app, so its
// screens say what they already say; starting holds the call until it is
// ready, so a source's page fills in instead of failing in the first seconds.
import { decodeAnswer, encodeHead, toBase64 } from './engine-frame.js';

export const ENGINE_ORIGIN = 'http://engine.tsundoku.invalid';

/** How long a call waits for an engine that is starting. */
export const STARTING_WAIT_MS = 120_000;

/**
 * The most of a video one call asks for. The engine answers a call whole, in
 * one frame, held in memory on both sides, so an open range ("bytes=0-", or
 * none) would hold the whole video; a player asks again for the rest.
 */
export const VIDEO_SLICE = 8 * 1024 * 1024;

/**
 * The headers a call takes to the engine in a tab. `cf-proxy-url` names
 * FlareSolverr, which a tab has not got (a site's check is passed by the
 * visitor in a tab of their own, doc/WEB-EDITION.md); a video asks for a
 * bounded range.
 * @param {string} path
 * @param {[string, string][]} headers
 * @returns {[string, string][]}
 */
export function engineHeaders(path, headers) {
	const out = headers.filter(([k]) => k.toLowerCase() !== 'cf-proxy-url');
	if (!path.startsWith('/video/')) return out;
	const i = out.findIndex(([k]) => k.toLowerCase() === 'range');
	const m = /^bytes=(\d*)-(\d*)$/.exec(i < 0 ? '' : out[i][1]);
	// A suffix range ("bytes=-500") is bounded already; anything else that is
	// not "start-end" is asked from its start.
	if (m && m[1] === '' && m[2] !== '') return out;
	const start = m && m[1] !== '' ? Number(m[1]) : 0;
	const end =
		m && m[2] !== '' ? Math.min(Number(m[2]), start + VIDEO_SLICE - 1) : start + VIDEO_SLICE - 1;
	const range = /** @type {[string, string]} */ (['range', `bytes=${start}-${end}`]);
	if (i < 0) out.push(range);
	else out[i] = range;
	return out;
}

/** @typedef {'off' | 'starting' | 'ready' | 'failed'} EngineState */

/**
 * @param {typeof fetch} browserFetch the fetch to keep for every other origin
 * @param {{ waitMs?: number }} [options]
 */
export function enginePort(browserFetch, { waitMs = STARTING_WAIT_MS } = {}) {
	/** @type {MessagePort | null} */
	let port = null;
	/** @type {EngineState} */
	let state = 'off';
	let why = 'the engine has not been started';
	/** @type {Set<() => void>} */
	const waiting = new Set();
	/** @type {Map<number, (answer: string) => void>} */
	const pending = new Map();
	let next = 1;

	/**
	 * The tab's word on the engine: a new port when it starts one, then each
	 * change of state.
	 * @param {{ state: EngineState, why?: string }} update
	 * @param {MessagePort} [newPort]
	 */
	function set(update, newPort) {
		if (newPort) {
			port?.close();
			port = newPort;
			port.onmessage = ({ data }) => {
				const settle = pending.get(data?.id);
				pending.delete(data?.id);
				settle?.(String(data?.answer ?? 'ERR the engine answered nothing'));
			};
		}
		state = update.state;
		why = update.why ?? why;
		if (state !== 'starting') {
			for (const wake of waiting) wake();
			waiting.clear();
		}
		if (state === 'off' || state === 'failed') {
			// Calls in flight die with the engine they were sent to.
			for (const settle of pending.values()) settle(`ERR the engine stopped: ${why}`);
			pending.clear();
		}
	}

	async function untilSettled() {
		if (state !== 'starting') return;
		await new Promise((resolve) => {
			const wake = () => {
				clearTimeout(timer);
				resolve(undefined);
			};
			const timer = setTimeout(() => {
				waiting.delete(wake);
				resolve(undefined);
			}, waitMs);
			waiting.add(wake);
		});
	}

	/** @param {Request} request */
	async function call(request) {
		await untilSettled();
		if (state !== 'ready' || !port)
			// What fetch throws when nothing listens: the client's "engine down".
			throw new TypeError(`fetch failed: the engine is ${state} (${why})`);
		const body =
			request.method === 'GET' || request.method === 'HEAD'
				? ''
				: toBase64(new Uint8Array(await request.arrayBuffer()));
		const url = new URL(request.url);
		const head = encodeHead(
			request.method,
			url.pathname + url.search,
			engineHeaders(url.pathname, [...request.headers])
		);
		const id = next++;
		const live = port;
		const answer = await new Promise((resolve) => {
			pending.set(id, resolve);
			live.postMessage({ id, head, body });
		});
		const r = decodeAnswer(answer);
		if ('error' in r) throw new TypeError(`fetch failed: ${r.error}`);
		const empty = r.status === 204 || r.status === 205 || r.status === 304;
		return new Response(empty ? null : r.body, { status: r.status, headers: r.headers });
	}

	/** @type {typeof fetch} */
	const fetchWithEngine = (input, init) => {
		const request = new Request(input, init);
		if (new URL(request.url).origin !== ENGINE_ORIGIN) return browserFetch(request);
		return call(request);
	};

	return {
		fetch: fetchWithEngine,
		set,
		get state() {
			return state;
		}
	};
}

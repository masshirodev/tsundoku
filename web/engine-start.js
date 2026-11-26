// Starting the extension engine from the leading tab (doc/WEB-EDITION.md,
// "The engine"), once its server is ready. The engine starts only when a
// fetcher answers (the owner's choice, 2026-11-25): without one it could reach
// no site, so the minutes of CPU would buy nothing. A tab that finds no fetcher
// tries again when it is focused, so installing it is noticed with no reload.
//
// Everything the browser provides comes in as an argument, so the spec can
// stand in for the server worker, the fetcher and the engine's worker.
import { decodeHead, encodeAnswer, fromBase64 } from './engine-frame.js';

/** The answer header that tells the engine a fetch's URL after its redirects. */
export const FINAL_URL = 'X-Tsundoku-Final-Url';

/** Where the build puts the slim engine jar (web/adapter.js). */
export const ENGINE_JAR = '/engine/engine-browser.jar';

/**
 * @typedef {{ postMessage(message: unknown, transfer?: Transferable[]): void }} Poster
 * @typedef {{ url: string, method?: string, headers?: [string, string][], body?: Uint8Array | null }} WebRequest
 * @typedef {{ status: number, headers: [string, string][], body: Uint8Array, url?: string }} WebResponse
 * @typedef {{ fetch(request: WebRequest): Promise<WebResponse> }} FetcherLike
 * @typedef {{ state: 'ready', fetcher: FetcherLike } | { state: string }} Connection
 * @typedef {Poster & { onmessage: ((event: { data: any }) => void) | null, terminate(): void }} WorkerLike
 * @typedef {{ state: string, why?: string, step?: string, steps?: Record<string, number> }} EngineNews
 */

/**
 * @param {{
 *   server: Poster,
 *   connect: () => Promise<Connection>,
 *   makeWorker: () => WorkerLike,
 *   hasJar: () => Promise<boolean>,
 *   origin: string,
 *   onNews?: (news: EngineNews) => void,
 *   channel?: () => { port1: MessagePort, port2: MessagePort }
 * }} deps
 */
export function engineStarter({
	server,
	connect,
	makeWorker,
	hasJar,
	origin,
	onNews = () => {},
	channel = () => new MessageChannel()
}) {
	/** @type {WorkerLike | null} */
	let worker = null;
	let trying = false;

	/** @param {EngineNews} news @param {MessagePort} [port] */
	const tell = (news, port) => {
		server.postMessage({ type: 'tsundoku-engine', ...news }, port ? [port] : []);
		onNews(news);
	};

	/** Starts the engine if it can, and is not started or starting already. */
	async function attempt() {
		if (worker || trying) return;
		trying = true;
		try {
			if (!(await hasJar())) return tell({ state: 'off', why: 'no engine in this build' });
			const connection = await connect();
			if (connection.state !== 'ready' || !('fetcher' in connection))
				return tell({ state: 'off', why: `the fetcher is ${connection.state}` });
			const fetcher = connection.fetcher;
			const { port1, port2 } = channel();
			tell({ state: 'starting', step: 'runtime' }, port1);
			const w = (worker = makeWorker());
			w.onmessage = ({ data }) => {
				if (data?.type === 'engine-state') {
					const news = { ...data };
					delete news.type;
					tell(news);
					if (news.state === 'failed') {
						w.terminate();
						worker = null;
					}
				} else if (data?.type === 'engine-fetch')
					void relay(fetcher, data.head, data.body).then((answer) =>
						w.postMessage({ type: 'engine-fetched', id: data.id, answer })
					);
			};
			w.postMessage({ type: 'engine-start', jar: ENGINE_JAR, origin }, [port2]);
		} finally {
			trying = false;
		}
	}

	return {
		attempt,
		get started() {
			return worker !== null;
		}
	};
}

/**
 * One request of the engine's to a website, through the fetcher, answered in
 * the frame. A failure is an answer too ("ERR …"), which Java turns into the
 * IOException OkHttp expects of a network that failed.
 * @param {FetcherLike} fetcher
 * @param {string} head
 * @param {string} body
 */
export async function relay(fetcher, head, body) {
	try {
		const { method, url, headers } = decodeHead(head);
		const r = await fetcher.fetch({ url, method, headers, body: body ? fromBase64(body) : null });
		// Where the fetch ended after redirects: the engine shows OkHttp the
		// redirect it would have followed itself (tsundoku-engine, "The browser target").
		const final =
			r.url && r.url !== url ? [/** @type {[string, string]} */ ([FINAL_URL, r.url])] : [];
		return encodeAnswer(r.status, [...r.headers, ...final], r.body);
	} catch (e) {
		return `ERR ${e instanceof Error ? e.message : String(e)}`;
	}
}

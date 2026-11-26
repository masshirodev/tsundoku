// The extension engine in the web edition (doc/WEB-EDITION.md, "The engine"):
// tsundoku-engine's classes in CheerpJ, a JVM compiled to WebAssembly, in a
// dedicated worker of the leading tab, so its start-up and its calls never
// hold the page's main thread. Built as a classic worker (web/adapter.js),
// since CheerpJ's loader is a classic script.
//
//   the tab (web/boot.js)  --start, a port-->  here
//   the server worker      --port: {id, head, body}-->  here --> BrowserEngine.handle
//   BrowserTransport.fetchNative --> {engine-fetch}--> the tab --> the fetcher extension
//
// The frame on both crossings is web/engine-frame.js's.

import { scriptSandbox } from './script-sandbox.js';

/** CheerpJ's runtime, from its CDN: the free licence requires both that and a credit. */
export const CHEERPJ_LOADER = 'https://cjrtnc.leaningtech.com/5.0/loader.js';

/** @typedef {{ handle(head: string, body: string): Promise<string>, start(dir: string, origin: string): Promise<string> }} BrowserEngine */

/** @type {Map<number, (answer: string) => void>} */
const fetching = new Map();
let nextFetch = 1;

/**
 * Java's way out to the web: the engine's OkHttp ends every request here
 * (tsundoku-engine's browser transport). The tab sends it through the fetcher.
 * @param {unknown} _lib
 * @param {string} head
 * @param {string} body
 */
async function Java_tsundoku_browser_BrowserTransport_fetchNative(_lib, head, body) {
	const id = nextFetch++;
	return new Promise((resolve) => {
		fetching.set(id, resolve);
		self.postMessage({ type: 'engine-fetch', id, head, body });
	});
}

const sandbox = scriptSandbox();

/**
 * Java's way to an extension's JavaScript (tsundoku-engine's BrowserScripts):
 * run by the browser, in a sandbox with an opaque origin (web/script-sandbox.js).
 * @param {unknown} _lib
 * @param {string} script
 */
function Java_tsundoku_browser_BrowserScripts_evaluateNative(_lib, script) {
	return sandbox.evaluate(String(script));
}

/** @param {'starting' | 'ready' | 'failed'} state @param {Record<string, unknown>} [more] */
const say = (state, more = {}) => self.postMessage({ type: 'engine-state', state, ...more });

/**
 * @param {string} jar the slim engine jar's path on this origin
 * @param {string} origin the origin the server worker reaches the engine by
 * @param {MessagePort} port the server worker's line to the engine
 */
async function start(jar, origin, port) {
	const t0 = performance.now();
	const ms = () => Math.round(performance.now() - t0);
	/** @type {Record<string, number>} */
	const steps = {};
	try {
		say('starting', { step: 'runtime' });
		// @ts-expect-error -- importScripts exists in a classic worker
		importScripts(CHEERPJ_LOADER);
		// @ts-expect-error -- set by CheerpJ's loader
		await cheerpjInit({
			version: 21,
			natives: {
				Java_tsundoku_browser_BrowserTransport_fetchNative,
				Java_tsundoku_browser_BrowserScripts_evaluateNative
			}
		});
		steps.runtime = ms();
		say('starting', { step: 'engine' });
		// /app/ is CheerpJ's name for this origin's files.
		// @ts-expect-error -- set by CheerpJ's loader
		const lib = await cheerpjRunLibrary(`/app${jar}`);
		/** @type {BrowserEngine} */
		const engine = await lib.tsundoku.browser.BrowserEngine;
		steps.library = ms();
		// /files/ is CheerpJ's persistent storage: converted extensions stay.
		const started = JSON.parse(await engine.start('/files/engine', origin));
		if (started.error) throw new Error(started.error);
		steps.started = ms();
		port.onmessage = async ({ data }) => {
			const answer = await engine.handle(String(data.head), String(data.body ?? ''));
			port.postMessage({ id: data.id, answer });
		};
		say('ready', { steps });
	} catch (e) {
		// A Java exception is not a JavaScript one: String() on it can throw.
		let why = 'the engine failed to start';
		try {
			why = e instanceof Error ? e.message : String(e);
		} catch {
			/* keep the plain words */
		}
		say('failed', { why, steps });
	}
}

self.onmessage = ({ data, ports }) => {
	if (data?.type === 'engine-start') void start(data.jar, data.origin, ports[0]);
	else if (data?.type === 'engine-fetched') {
		const settle = fetching.get(data.id);
		fetching.delete(data.id);
		settle?.(String(data.answer));
	}
};

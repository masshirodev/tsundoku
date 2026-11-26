// Where the web edition's time goes (doc/WEB-EDITION.md, "Measuring"): an
// opt-in log, off unless this browser's localStorage has `tsundoku-timing` set
// to "1". Kept in the leading tab as `window.__tsundokuTimings`, an array a
// test (or a console) reads; nothing is sent anywhere.
//
// Three kinds of record, each with `at`, ms since the page started:
//   request  an app request, the service worker to the server and back: path, ms, status
//   call     a call into the engine: path, waited (in the queue), ran (in Java)
//   site     one of the engine's fetches through the fetcher: host, path, ms, status, bytes

/** @typedef {{ kind: string, [k: string]: unknown }} Timing */

export const TIMING_KEY = 'tsundoku-timing';

/** Whether this browser asked for the log. Never throws: storage can be refused. */
export function timingOn() {
	try {
		return globalThis.localStorage?.getItem(TIMING_KEY) === '1';
	} catch {
		return false;
	}
}

/**
 * A recorder: `record(t)` keeps `t` with its time when on, and does nothing
 * when off.
 * @param {{ on: boolean, into?: Timing[], now?: () => number }} options
 */
export function timings({ on, into, now = () => performance.now() }) {
	/** @type {Timing[]} */
	const log = into ?? [];
	return {
		log,
		on,
		/** @param {Timing} t */
		record(t) {
			if (on) log.push({ ...t, at: Math.round(now()) });
		}
	};
}

/** A URL's path, without its query (a token or a search can be private). @param {string} url */
export function pathOf(url) {
	try {
		return new URL(url, 'http://x').pathname;
	} catch {
		return '';
	}
}

/** A request frame's host and path (web/engine-frame.js: METHOD, then the URL). @param {string} head */
export function siteOf(head) {
	try {
		const u = new URL(head.split('\n', 2)[1] ?? '');
		return { host: u.host, path: u.pathname };
	} catch {
		return { host: '', path: '' };
	}
}

/** An answer frame's status and body size (web/engine-frame.js). @param {string} answer */
export function answerSize(answer) {
	if (answer.startsWith('ERR ')) return { status: 0, bytes: 0 };
	const status = Number(answer.slice(0, answer.indexOf('\n'))) || 0;
	const at = answer.indexOf('\n\n');
	const b64 = at < 0 ? '' : answer.slice(at + 2);
	return { status, bytes: Math.floor((b64.length * 3) / 4) };
}

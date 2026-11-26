// The calls into the engine, one at a time (doc/WEB-EDITION.md, "The engine").
//
// CheerpJ runs one call from JavaScript into Java at a time: a second one made
// while the first is still running fails with "Java code still running, check
// for a missing 'await'". The server worker sends calls as they come (a browse
// grid asks for its 32 covers at once), so web/engine-worker.js puts them
// through this queue instead of straight into Java. Found in Firefox on
// 2026-11-26: covers crashed, and opening a series stalled or failed with them.
//
// A page's call (a list, a series, a chapter) goes before a waiting cover or
// video slice, so opening a series never waits behind a grid of covers. Within
// each kind, first come, first served.

/** Whether a request frame (web/engine-frame.js: METHOD, then the URL) is media. @param {string} head */
export function isMedia(head) {
	const url = head.split('\n', 2)[1] ?? '';
	let path = url;
	try {
		path = new URL(url).pathname;
	} catch {
		// Not a whole URL: the path as given.
	}
	return /^\/(?:image|video)\//i.test(path);
}

/**
 * Words for a failure that never throws: a Java exception is not a
 * JavaScript one, and String() on it can throw.
 * @param {unknown} e
 */
function why(e) {
	try {
		return e instanceof Error ? e.message : String(e);
	} catch {
		return 'the engine failed';
	}
}

/**
 * @param {(head: string, body: string) => Promise<string>} handle the call into Java
 * @returns {(head: string, body: string) => Promise<string>} the same call, queued;
 *   a call that throws answers `ERR <why>` (web/engine-frame.js) instead
 */
export function engineQueue(handle) {
	/** @typedef {{ head: string, body: string, done: (answer: string) => void }} Call */
	/** @type {Call[]} */
	const pages = [];
	/** @type {Call[]} */
	const media = [];
	let running = false;

	async function drain() {
		if (running) return;
		running = true;
		try {
			for (let call = pages.shift() ?? media.shift(); call; call = pages.shift() ?? media.shift()) {
				let answer;
				try {
					answer = await handle(call.head, call.body);
				} catch (e) {
					answer = `ERR ${why(e)}`;
				}
				call.done(answer);
			}
		} finally {
			running = false;
		}
	}

	return (head, body) =>
		new Promise((done) => {
			(isMedia(head) ? media : pages).push({ head, body, done });
			void drain();
		});
}

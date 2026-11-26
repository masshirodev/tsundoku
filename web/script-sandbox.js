// An extension's own JavaScript, run by the browser (doc/WEB-EDITION.md, "The
// engine"). Some extensions run a site's scripts (to unpack a page list, say)
// through QuickJS; in CheerpJ, QuickJS is far too slow (about 20 s to create,
// and one page script did not finish in ten minutes), so tsundoku-engine's
// browser target sends each script here instead
// (`tsundoku.browser.BrowserScripts.evaluateNative`).
//
// The script is the site's code, so it runs where it can reach nothing of the
// app's: a worker made from a data: URL has an opaque origin, with none of
// tsundoku.lt's storage, cookies or fetcher. One script at a time, each
// limited; a script past the limit has its worker thrown away.
//
// It answers `{"value": <JSON>}`, `{}` for undefined, or `{"error": "…"}`.

export const SCRIPT_LIMIT_MS = 30_000;

/** What runs inside the sandbox: an indirect eval, so the script sees only the global scope. */
export const SANDBOX_SOURCE = `onmessage = ({ data }) => {
	let answer;
	try {
		const value = (0, eval)(data);
		answer = JSON.stringify(value === undefined ? {} : { value });
	} catch (e) {
		answer = JSON.stringify({ error: String((e && e.message) || e) });
	}
	postMessage(answer);
};`;

/**
 * @typedef {{
 *   onmessage: ((e: { data: string }) => void) | null,
 *   onerror: ((e: { message?: string, preventDefault?: () => void }) => void) | null,
 *   postMessage(script: string): void,
 *   terminate(): void
 * }} SandboxWorker
 */

/**
 * @param {{ makeWorker?: () => SandboxWorker, limitMs?: number }} [options]
 */
export function scriptSandbox({
	makeWorker = () =>
		/** @type {SandboxWorker} */ (
			/** @type {unknown} */ (
				new Worker('data:text/javascript,' + encodeURIComponent(SANDBOX_SOURCE))
			)
		),
	limitMs = SCRIPT_LIMIT_MS
} = {}) {
	/** @type {SandboxWorker | null} */
	let worker = null;
	/** @type {{ script: string, resolve: (answer: string) => void }[]} */
	const queue = [];

	function runNext() {
		const job = queue[0];
		if (!job) return;
		const w = (worker ??= makeWorker());
		/** @param {string} answer */
		const done = (answer) => {
			clearTimeout(timer);
			w.onmessage = w.onerror = null;
			queue.shift();
			job.resolve(answer);
			runNext();
		};
		const timer = setTimeout(() => {
			w.terminate();
			worker = null;
			done(JSON.stringify({ error: `the script ran longer than ${limitMs / 1000} s` }));
		}, limitMs);
		w.onmessage = ({ data }) => done(String(data));
		w.onerror = (e) => {
			e.preventDefault?.();
			done(JSON.stringify({ error: e.message || 'the script failed' }));
		};
		w.postMessage(job.script);
	}

	/** @param {string} script @returns {Promise<string>} */
	function evaluate(script) {
		return new Promise((resolve) => {
			queue.push({ script, resolve });
			if (queue.length === 1) runNext();
		});
	}

	return { evaluate };
}

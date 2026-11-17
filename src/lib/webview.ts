/**
 * The engine's headless WebView, in tsundoku's words (doc/EXTENSION-ENGINE.md,
 * "Cloudflare and WebView extensions"; tsundoku-engine's doc/FORK.md, "Headless WebView"). The
 * engine runs extensions that use `android.webkit.WebView` in a Chromium
 * nobody sees, downloaded the first time one needs it, when the launcher starts
 * it with `ENGINE_WEBVIEW=on`. Off by default: it runs sites' scripts in
 * Chromium 111, unsandboxed, so an install turns it on in SETTINGS.
 *
 * Pure, so the server, the pages and the tests share one reading of the
 * engine's answers and one set of words for them.
 */

/** `GET /webview`'s `state`. */
export type WebViewState = 'off' | 'idle' | 'starting' | 'ready' | 'failed';

/** `GET /webview`, and the `webview` object on a WebView extension's error. */
export type WebViewStatus = {
	state: WebViewState;
	/** While starting: locating, downloading, extracting, installing, initializing, starting. */
	phase: string | null;
	/** While downloading. */
	percent: number | null;
	/** When failed: why, written by the engine for a person to act on. */
	error: string | null;
	openPages: number;
	waitingPages: number;
	/** Where Chromium lives, as the engine says (only while on). */
	dir: string | null;
};

const STATES: readonly WebViewState[] = ['off', 'idle', 'starting', 'ready', 'failed'];

const num = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) ? v : null);
const str = (v: unknown) => (typeof v === 'string' && v.trim() ? v : null);

/** The engine's status object, or null when `v` isn't one (an older engine answers 404). */
export function parseWebViewStatus(v: unknown): WebViewStatus | null {
	if (!v || typeof v !== 'object') return null;
	const o = v as Record<string, unknown>;
	const state = STATES.find((s) => s === o.state);
	if (!state) return null;
	const percent = num(o.percent);
	return {
		state,
		phase: str(o.phase),
		percent: percent === null ? null : Math.max(0, Math.min(100, Math.round(percent))),
		error: str(o.error),
		openPages: num(o.openPages) ?? 0,
		waitingPages: num(o.waitingPages) ?? 0,
		dir: str(o.dir)
	};
}

/**
 * Whether this install's engine runs WebView extensions:
 *
 * - `on`: it does (`/capabilities` says `webview: true`);
 * - `off`: it could, and this install has it turned off (`webview: false`);
 * - `unsupported`: an engine older than the support (no `webview` at all);
 * - `unknown`: the engine isn't answering, and nothing else says.
 *
 * `switchOn` is SETTINGS' switch where the launcher reads it (null where the
 * engine is started some other way): while the engine is down, or restarting
 * to take a change, the switch is what the install has asked for.
 */
export type WebViewSupport = 'on' | 'off' | 'unsupported' | 'unknown';

export function webviewSupport(caps: unknown, switchOn: boolean | null): WebViewSupport {
	if (!caps || typeof caps !== 'object')
		return switchOn === null ? 'unknown' : switchOn ? 'on' : 'off';
	const c = caps as Record<string, unknown>;
	if (!('webview' in c)) return 'unsupported';
	return c.webview === true ? 'on' : 'off';
}

/** What Chromium costs to download, rounded (169-186 MB per platform; FORK.md). */
export const CHROMIUM_MB = 180;

/** "NEEDS A WEBVIEW", the quiet mark on an extension and its sources that use one. */
export const NEEDS = 'NEEDS A WEBVIEW';

/** The mark, said in words when this install can't give it one. */
export function webviewMark(support: WebViewSupport): string {
	if (support === 'off') return `${NEEDS}, WHICH THIS INSTALL HAS TURNED OFF`;
	if (support === 'unsupported') return `${NEEDS}, WHICH THIS ENGINE CAN'T RUN`;
	return NEEDS;
}

/** A starting phase in a word: "UNPACKING". */
function phaseWord(phase: string | null): string {
	switch (phase) {
		case 'locating':
			return 'LOOKING FOR IT';
		case 'downloading':
			return 'DOWNLOADING';
		case 'extracting':
			return 'UNPACKING';
		case 'installing':
			return 'INSTALLING';
		default:
			return 'STARTING';
	}
}

const plural = (n: number, w: string) => `${n} ${w}${n === 1 ? '' : 'S'}`;

/**
 * SETTINGS' state line: "NOT NEEDED YET", "DOWNLOADING 40 %", "READY · 1 PAGE
 * OPEN", or "FAILED: <the engine's words>". `status` is null when the engine
 * didn't answer `/webview`.
 */
export function stateLine(status: WebViewStatus | null, support: WebViewSupport): string {
	if (support === 'unsupported') return "THIS ENGINE CAN'T RUN ONE · A NEWER TSUNDOKU BRINGS ONE";
	if (!status) return support === 'off' ? 'OFF' : "THE ENGINE ISN'T ANSWERING";
	switch (status.state) {
		case 'off':
			return 'OFF';
		case 'idle':
			return 'NOT NEEDED YET';
		case 'starting':
			return status.phase === 'downloading' && status.percent !== null
				? `DOWNLOADING ${status.percent} %`
				: phaseWord(status.phase);
		case 'ready':
			return [
				'READY',
				`${plural(status.openPages, 'PAGE')} OPEN`,
				status.waitingPages ? `${status.waitingPages} WAITING` : ''
			]
				.filter(Boolean)
				.join(' · ');
		case 'failed':
			return `FAILED: ${status.error ?? 'the engine gave no reason'}`;
	}
}

/**
 * The line where a WebView extension was installed or first opened, while
 * Chromium comes: "GETTING THE BROWSER THIS SOURCE NEEDS · 40 % OF ABOUT 180
 * MB". When it failed, the engine's own words, which are written for people.
 * Null when there's nothing to say (ready, idle, off).
 */
export function firstUseLine(status: WebViewStatus | null): string | null {
	if (!status) return null;
	const lead = 'GETTING THE BROWSER THIS SOURCE NEEDS';
	if (status.state === 'failed') return status.error ?? 'The browser this source needs failed.';
	if (status.state !== 'starting') return null;
	if (status.phase === 'downloading' && status.percent !== null)
		return `${lead} · ${status.percent} % OF ABOUT ${CHROMIUM_MB} MB`;
	if (status.phase === null || status.phase === 'locating' || status.phase === 'downloading')
		return `${lead} · ABOUT ${CHROMIUM_MB} MB`;
	return `${lead} · ${phaseWord(status.phase)}`;
}

/**
 * A call to a WebView extension that failed while its browser wasn't there:
 * what to say instead of the extension's own "timed out", and whether asking
 * again can help yet. Starting: wait, no RETRY (the page asks how it goes and
 * offers RETRY once it's ready). Failed: the engine's reason. Off: this
 * install turned it off. Null for a status in which the extension's own words
 * stand (ready, idle): its WebView was there, so the failure is the site's.
 */
export function webviewFailure(
	status: WebViewStatus | null
): { line: string; state: 'starting' | 'failed' | 'off' } | null {
	if (!status) return null;
	if (status.state === 'starting')
		return {
			line: firstUseLine(status) ?? 'GETTING THE BROWSER THIS SOURCE NEEDS',
			state: 'starting'
		};
	if (status.state === 'failed') return { line: firstUseLine(status)!, state: 'failed' };
	if (status.state === 'off') return { line: webviewMark('off'), state: 'off' };
	return null;
}

/**
 * A failed call's reason as a page's settled answer carries it (a string):
 * `webview:<state>:<line>`, so the page can draw the WebView's band instead
 * of the extension's own "timed out". `parseWebViewError` reads it back.
 */
export const webviewError = (state: 'starting' | 'failed' | 'off', line: string) =>
	`webview:${state}:${line}`;

export function parseWebViewError(
	error: string
): { state: 'starting' | 'failed' | 'off'; line: string } | null {
	const m = /^webview:(starting|failed|off):([\s\S]*)$/.exec(error);
	return m ? { state: m[1] as 'starting' | 'failed' | 'off', line: m[2] } : null;
}

/** "359 MB", for Chromium's folder. */
export function sizeWords(bytes: number): string {
	if (bytes >= 1024 ** 3) return `${(bytes / 1024 ** 3).toFixed(1)} GB`;
	return `${Math.max(1, Math.round(bytes / 1024 ** 2))} MB`;
}

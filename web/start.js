// The web edition's starting screen and its could-not-start screens
// (doc/WEB-EDITION.md, "Starting, and when it cannot"; handoff
// `web-edition-start`). The shell paints it from the first byte, before any
// of the app's code has loaded, so it is plain HTML and CSS reading the app's
// own tokens (the shell links the app's stylesheets). web/boot.js moves it on
// as each step really finishes, and the app then opens in place over it.
//
// Three kinds of code live here, each for its own runtime:
// - the markup and its CSS, put into index.html by the adapter at build time;
// - `prepaint` and `drawStart`, self-contained so the adapter can inline them
//   as the shell's own scripts, which run before the first paint;
// - the pure rules (what a failure was, what a browser is missing, whether a
//   window is private), imported by boot.js and by the unit spec.
// Nothing here may import anything: boot.js loads this file as it is.

/** sessionStorage: how far this tab's start got, so the first visit's reload
 * carries the same picture on (`{ first, done, since }`). */
export const START_KEY = 'tsundoku.web.start';
/** localStorage: the library has opened in this browser before. Kept beside
 * the library's own storage, so clearing the site's data clears both, and the
 * next visit is a first visit again. */
export const OPENED_KEY = 'tsundoku.web.opened';
/** A first visit says what this is after this long, not at once: a later
 * visit is over before then and never shows it. */
export const REVEAL_MS = 1500;

/** The four steps, in order. `done` counts the steps finished. */
export const STEPS = [
	{ id: 'ready', label: 'GETTING READY' },
	{ id: 'server', label: 'STARTING' },
	{ id: 'library', label: 'OPENING THE LIBRARY' },
	{ id: 'setup', label: 'SETTING IT UP', note: 'FIRST VISIT ONLY' }
];

/**
 * @typedef {{ first: boolean, done: number, since: number, revealed: boolean }} StartView
 *   `first`: a first visit; `done`: steps finished, 0 to 4; `since`: when this
 *   start began (ms since the epoch), carried over the reload; `revealed`:
 *   the first visit's line and steps are showing.
 */

/**
 * Draws the starting screen for `view`. Self-contained (no outside names) so
 * the shell can inline it and draw before the first paint; boot.js calls the
 * same function as each step finishes.
 *
 * @param {Document} doc
 * @param {StartView} view
 */
export function drawStart(doc, view) {
	const labels = ['GETTING READY', 'STARTING', 'OPENING THE LIBRARY', 'SETTING IT UP'];
	const root = doc.getElementById('web-start');
	// A start that failed keeps saying why: a late step or the reveal's timer
	// must not draw the starting line back over it.
	if (!root || root.dataset.failed) return;
	const done = Math.max(0, Math.min(labels.length, view.done));
	// The step under way; once all four are done, the last one stays named
	// until the app replaces the screen.
	const now = Math.min(done, labels.length - 1);
	root.dataset.step = String(done);
	root.toggleAttribute('data-first', view.first);
	root.toggleAttribute('data-revealed', view.first && view.revealed);
	const set = (/** @type {string} */ sel, /** @type {string} */ text) => {
		const el = root.querySelector(sel);
		if (el) el.textContent = text;
	};
	set('.ws-label-left', view.first ? '00 — FIRST VISIT' : '00 — STARTING');
	set(
		'.ws-label-right',
		!view.first
			? 'OPENING THE LIBRARY'
			: view.revealed
				? `${now + 1} OF ${labels.length} · ${labels[now]}`
				: labels[now]
	);
	const fill = /** @type {HTMLElement | null} */ (root.querySelector('.ws-fill'));
	if (fill) fill.style.width = `${(done / labels.length) * 100}%`;
	root.querySelectorAll('.ws-step').forEach((row, i) => {
		const state = i < done ? 'done' : i === now ? 'now' : 'todo';
		/** @type {HTMLElement} */ (row).dataset.state = state;
		const status = row.querySelector('.ws-status');
		if (status) status.textContent = state === 'done' ? 'DONE' : state === 'now' ? 'NOW' : '';
	});
}

/**
 * The shell's first script, run in <head> before anything is drawn: the
 * reader's theme on <html>, so the starting screen is already in it. The
 * theme is the app's own record of it, kept in localStorage by the layout
 * (`tsundoku.theme`, JSON), else the cookie the self-hosted server reads.
 *
 * @param {Document} doc
 * @param {Pick<Window, 'localStorage'>} win
 */
export function themeBeforePaint(doc, win) {
	/** @type {unknown} */
	let theme = null;
	try {
		theme = JSON.parse(win.localStorage.getItem('tsundoku.theme') ?? 'null');
	} catch {
		// Storage refused or unreadable: the cookie, else the default.
	}
	if (theme !== 'light' && theme !== 'dark')
		theme = /(?:^|;\s*)tsundoku_theme=(light|dark)/.exec(doc.cookie)?.[1] ?? null;
	if (theme === 'light' || theme === 'dark') doc.documentElement.dataset.theme = theme;
}

/**
 * Where this start is: carried over from before the first visit's reload,
 * else a new start, a first visit if the library never opened here.
 *
 * @param {Pick<Window, 'localStorage' | 'sessionStorage'>} win
 * @param {number} now
 * @returns {StartView}
 */
export function startView(win, now) {
	/**
	 * Storage refused (a blocked site) or unreadable is nothing kept.
	 * @template T
	 * @param {() => T} read
	 * @returns {T | null}
	 */
	const get = (read) => {
		try {
			return read();
		} catch {
			return null;
		}
	};
	/** @type {{ first?: unknown, done?: unknown, since?: unknown } | null} */
	const kept = get(() => JSON.parse(win.sessionStorage.getItem('tsundoku.web.start') ?? 'null'));
	const first =
		kept && typeof kept.first === 'boolean'
			? kept.first
			: get(() => win.localStorage.getItem('tsundoku.web.opened')) === null;
	const done = kept && typeof kept.done === 'number' ? kept.done : 0;
	const since = kept && typeof kept.since === 'number' ? kept.since : now;
	return { first, done, since, revealed: first && now - since >= 1500 };
}

/** What the could-not-start screens tell apart (handoff `Fail-*`). */
/** @typedef {'private' | 'storage' | 'old' | 'unknown'} FailKind */

/**
 * @typedef {object} Probe What the browser offers, looked at before starting.
 * @property {boolean} serviceWorker `navigator.serviceWorker` exists (Firefox's private windows have none)
 * @property {boolean} moduleWorkers `new Worker(url, { type: 'module' })` is understood
 * @property {boolean} locks Web Locks (`navigator.locks`)
 * @property {boolean} storageDirectory OPFS (`navigator.storage.getDirectory`)
 */

/**
 * The parts a browser lacks, as the screen names them. Service workers are
 * among them only outside Firefox, whose missing service worker is a private
 * window (`classify`).
 *
 * @param {Probe} probe
 * @returns {string[]}
 */
export function missingFeatures(probe) {
	/** @type {string[]} */
	const missing = [];
	if (!probe.serviceWorker) missing.push('SERVICE WORKERS');
	if (!probe.moduleWorkers) missing.push('MODULE WORKERS');
	if (!probe.locks) missing.push('WEB LOCKS');
	if (!probe.storageDirectory) missing.push('PRIVATE FILE STORAGE');
	return missing;
}

/** The browser's name as these screens say it. Edge first: it names Chrome too. */
/** @param {string} ua */
function browserOf(ua) {
	if (/\bEdg\//.test(ua)) return 'Edge';
	if (/\bFirefox\//.test(ua)) return 'Firefox';
	if (/\bChrome\//.test(ua)) return 'Chrome';
	if (/\bSafari\//.test(ua)) return 'Safari';
	return null;
}

/**
 * "Firefox 133 · Linux", for the unknown failure's report.
 * @param {string} ua
 */
export function describeBrowser(ua) {
	const name = browserOf(ua);
	const version =
		name === 'Edge'
			? /\bEdg\/(\d+)/.exec(ua)?.[1]
			: name === 'Firefox'
				? /\bFirefox\/(\d+)/.exec(ua)?.[1]
				: name === 'Chrome'
					? /\bChrome\/(\d+)/.exec(ua)?.[1]
					: name === 'Safari'
						? /\bVersion\/(\d+)/.exec(ua)?.[1]
						: undefined;
	const os = /Android/.test(ua)
		? 'Android'
		: /iPhone|iPad|iPod/.test(ua)
			? 'iOS'
			: /Windows/.test(ua)
				? 'Windows'
				: /Mac OS X|Macintosh/.test(ua)
					? 'macOS'
					: /CrOS/.test(ua)
						? 'ChromeOS'
						: /Linux/.test(ua)
							? 'Linux'
							: null;
	return [name ? `${name}${version ? ` ${version}` : ''}` : 'An unknown browser', os]
		.filter(Boolean)
		.join(' · ');
}

/**
 * @typedef {object} Failure What went wrong, as the screens tell it apart.
 * @property {FailKind} kind
 * @property {string[]} missing what a browser too old lacks, named
 * @property {string} at where the start was (`data-web-boot`), for the report
 * @property {string} text the error as the browser gave it, for the report
 */

/**
 * Tells the failures apart (handoff `Fail-*`):
 *
 * - **private**: Firefox without service workers. Firefox turns them off in
 *   a private window; nothing else turns them off there.
 * - **old**: a part the web edition needs is missing, from the probe before
 *   starting or as the server worker found it (synchronous file access).
 * - **storage**: the browser refused this site storage: OPFS or the service
 *   worker's registration refused with a SecurityError (site data blocked,
 *   for this site or for all), or the server worker's SQLite pool refused
 *   the same way.
 * - **unknown**: anything else, with its text.
 *
 * @param {{ error: unknown, at: string, probe: Probe, userAgent: string }} what
 * @returns {Failure}
 */
export function classify({ error, at, probe, userAgent }) {
	const e = /** @type {{ name?: unknown, message?: unknown, missing?: unknown } | null} */ (
		error && typeof error === 'object' ? error : null
	);
	const name = typeof e?.name === 'string' ? e.name : '';
	const message = String(e?.message ?? error ?? '');
	// As the browser would print it, its name first: "SecurityError: …". A
	// server worker's error arrives as its stack, which already starts so.
	const text = name && message && !message.startsWith(name) ? `${name}: ${message}` : message;
	const base = { missing: /** @type {string[]} */ ([]), at, text };
	if (!probe.serviceWorker && browserOf(userAgent) === 'Firefox')
		return { ...base, kind: 'private' };
	const missing = [
		...missingFeatures(probe),
		...(Array.isArray(e?.missing) ? e.missing.map(String) : [])
	];
	if (missing.length > 0) return { ...base, kind: 'old', missing };
	if (
		name === 'SecurityError' ||
		name === 'NotAllowedError' ||
		/\b(SecurityError|NotAllowedError)\b/.test(text)
	)
		return { ...base, kind: 'storage' };
	return { ...base, kind: 'unknown' };
}

/**
 * @typedef {object} FailScreen The words and acts of one could-not-start screen.
 * @property {string} right the section label's right side
 * @property {string} title
 * @property {string} body
 * @property {{ label: string, act: 'copy-address' | 'reload' }} primary
 * @property {{ label: string, href: string }} more
 * @property {string} foot the reason, in mono at the foot
 * @property {string | null} report the unknown failure's text, to read and copy
 */

/** Where each screen's "read more" leads: this document, in the public repository. */
const DOC = 'https://github.com/masshirodev/tsundoku/blob/main/doc/WEB-EDITION.md';

/**
 * @param {Failure} f
 * @param {{ host: string, userAgent: string, build: string }} ctx
 * @returns {FailScreen}
 */
export function failScreen(f, { host, userAgent, build }) {
	if (f.kind === 'private')
		return {
			right: 'PRIVATE WINDOW',
			title: 'A private window can’t keep a library.',
			body: `Firefox turns off what tsundoku needs in a private window, and would throw the library away when the window closes. Open ${host} in a normal window.`,
			primary: { label: 'Copy the address', act: 'copy-address' },
			more: { label: 'How it works →', href: `${DOC}#a-private-window` },
			foot: 'FIREFOX · PRIVATE WINDOW · NO SERVICE WORKERS',
			report: null
		};
	if (f.kind === 'storage')
		return {
			right: 'STORAGE TURNED OFF',
			title: `This browser isn’t letting ${host} keep anything.`,
			body: `Site storage is turned off, for this site or for every site, so there is nowhere to put the library. Allow ${host} to store data in the browser’s settings, then try again.`,
			primary: { label: 'Try again', act: 'reload' },
			more: { label: 'Show me where →', href: `${DOC}#storage-turned-off` },
			foot: 'SITE DATA BLOCKED',
			report: null
		};
	if (f.kind === 'old')
		return {
			right: 'BROWSER TOO OLD',
			title: 'This browser is too old for tsundoku.',
			body: `tsundoku runs inside the browser, and this version is missing a part it needs. Update it, or open ${host} in a current Chrome or Firefox.`,
			primary: { label: 'Copy the address', act: 'copy-address' },
			more: { label: 'What it needs →', href: `${DOC}#a-browser-too-old` },
			foot: `MISSING · ${f.missing.join(' · ')}`,
			report: null
		};
	return {
		right: 'UNKNOWN',
		title: 'tsundoku couldn’t start.',
		body: 'Something went wrong while it was starting. Trying again usually works. If it keeps happening, the text below is what to send with a report.',
		primary: { label: 'Try again', act: 'reload' },
		more: { label: 'How to report it →', href: `${DOC}#something-else` },
		foot: 'NOTHING IN THE LIBRARY WAS CHANGED',
		report: `At: ${f.at}\n${f.text || 'Error: no message'}\n${describeBrowser(userAgent)} · tsundoku ${build}`
	};
}

/**
 * Draws a could-not-start screen in place of the starting line, under the
 * same bar (handoff `Fail-*`). Built with text nodes: the report holds the
 * browser's own error text.
 *
 * @param {Document} doc
 * @param {FailKind} kind
 * @param {FailScreen} screen
 * @param {{ primary: () => void, copy: (text: string) => Promise<void> }} acts
 */
export function drawFailure(doc, kind, screen, acts) {
	const root = doc.getElementById('web-start');
	const at = /** @type {HTMLElement | null | undefined} */ (root?.querySelector('.ws-fail'));
	if (!root || !at) return;
	root.dataset.failed = kind;
	const right = root.querySelector('.ws-label-right');
	const left = root.querySelector('.ws-label-left');
	if (left) left.textContent = '00 — COULD NOT START';
	if (right) right.textContent = screen.right;
	/**
	 * @param {string} tag
	 * @param {string} [cls]
	 * @param {string} [text]
	 */
	const el = (tag, cls, text) => {
		const e = doc.createElement(tag);
		if (cls) e.className = cls;
		if (text != null) e.textContent = text;
		return e;
	};
	/** A button that says it did what it was pressed for, then goes back to its word. */
	const copier = (/** @type {HTMLElement} */ b, /** @type {string} */ text) => {
		const word = b.textContent;
		b.addEventListener('click', () =>
			acts.copy(text).then(
				() => {
					b.textContent = 'COPIED';
					setTimeout(() => (b.textContent = word), 2000);
				},
				() => {}
			)
		);
	};
	const prose = el('div', 'ws-prose-in');
	prose.append(el('h1', undefined, screen.title), el('p', undefined, screen.body));
	const parts = [prose];
	if (screen.report) {
		const report = el('div', 'ws-report');
		const head = el('div', 'ws-report-head');
		const copy = el('button', 'ws-copy', 'COPY');
		copy.setAttribute('type', 'button');
		copier(copy, screen.report);
		head.append(el('div', 'ws-report-label', 'WHAT IT SAID'), copy);
		report.append(head, el('pre', undefined, screen.report));
		parts.push(report);
	}
	const actions = el('div', 'ws-actions');
	const primary = el('button', 'ws-btn primary', screen.primary.label);
	primary.setAttribute('type', 'button');
	if (screen.primary.act === 'reload') primary.addEventListener('click', acts.primary);
	else copier(primary, doc.location?.origin ?? '');
	const more = /** @type {HTMLAnchorElement} */ (el('a', 'ws-btn', screen.more.label));
	more.href = screen.more.href;
	more.target = '_blank';
	more.rel = 'noopener';
	actions.append(primary, more);
	parts.push(actions, el('div', 'ws-foot', screen.foot));
	at.replaceChildren(...parts);
	at.hidden = false;
}

/** Below this, a Chrome or Edge window's storage quota is an incognito
 * window's (doc/WEB-EDITION.md, "A private window in Chrome"). */
export const PRIVATE_QUOTA = 1024 ** 3;

/**
 * Whether this is a Chrome or Edge window whose library goes when it closes,
 * judged by the storage quota, the one signal there is: an incognito window's
 * storage is a fraction of the memory, a normal window's a fraction of the
 * disk. Chrome 153 reports the same 10 GiB in both (measured; the document
 * says how), so there it is never true; older Chromes reported 100–300 MB.
 * Never Firefox: its private windows cannot start at all (`classify`), and
 * its normal quota on a full disk can be small.
 *
 * @param {{ quota?: number } | null} estimate `navigator.storage.estimate()`
 * @param {string} userAgent
 */
export function isPrivateByQuota(estimate, userAgent) {
	const name = browserOf(userAgent);
	if (name !== 'Chrome' && name !== 'Edge') return false;
	const quota = estimate?.quota;
	return typeof quota === 'number' && quota > 0 && quota < PRIVATE_QUOTA;
}

/** The private-window band's words, the same as the app's (`web_private_*`). */
export const PRIVATE_BAND = {
	title: 'PRIVATE WINDOW',
	detail: 'THIS LIBRARY DISAPPEARS WHEN IT CLOSES'
};

const wordmark = (/** @type {string} */ cls) =>
	`<span class="ws-wordmark ${cls}"><span class="ws-latin">TSUNDOKU</span><span class="ws-jp" lang="ja">積ん読</span></span>`;

/** The screen as the shell first paints it: a later visit's picture, which
 * `drawStart` turns into a first visit's before anything is drawn. */
export const START_MARKUP = `<div id="web-start" class="ws" data-step="0">
<aside class="ws-side">${wordmark('ws-side-mark')}</aside>
<div class="ws-main">
<div class="ws-band" role="status" hidden><div class="ws-band-title">${PRIVATE_BAND.title}</div><div class="ws-band-detail">${PRIVATE_BAND.detail}</div></div>
<header class="ws-bar"><div class="ws-left">${wordmark('ws-bar-mark')}</div><div class="ws-middle"></div><div class="ws-rule" aria-hidden="true"><div class="ws-fill"></div></div></header>
<div class="ws-label"><div class="ws-label-left">00 — STARTING</div><div class="ws-label-right">OPENING THE LIBRARY</div></div>
<div class="ws-body">
<div class="ws-prose"><div class="ws-prose-in"><h1>A library that lives in this browser.</h1><p>Nothing is uploaded. What you add is kept here, on this device, in the browser’s own storage. A first visit takes a few seconds to set up.</p></div></div>
<div class="ws-steps-at"><ol class="ws-steps">${STEPS.map(
	(s, i) =>
		`<li class="ws-step" data-state="${i === 0 ? 'now' : 'todo'}"><div class="ws-num"><div class="ws-box">${String(i + 1).padStart(2, '0')}</div></div><div class="ws-text"><div class="ws-step-label">${s.label}</div>${s.note ? `<div class="ws-step-note">${s.note}</div>` : ''}</div><div class="ws-status">${i === 0 ? 'NOW' : ''}</div></li>`
).join('')}</ol></div>
</div>
<div class="ws-fail" hidden></div>
</div>
</div>`;

/**
 * The screen's CSS. The app's tokens (the shell links the app's stylesheets,
 * so they are there before the first paint), and the frame the app's own
 * library has, so the app opens over it without anything moving: the top
 * bar's cells and height (`TopBar`), the wordmark (`Wordmark`, 17px in the
 * desktop's sidebar), the section label (`SectionLabel`), the header's rule
 * (`NavLine`), the band (`Band`). The interior is the handoff's, transcribed
 * (doc/WEB-EDITION.md, "Where it departs from the handoff").
 */
export const START_STYLE = `
.ws{position:fixed;inset:0;z-index:100;display:flex;overflow-y:auto;background:var(--surface-page);color:var(--text-1);font-family:var(--font-sans)}
.ws-side{display:none}
.ws-main{flex:1;min-width:0;display:flex;flex-direction:column}
.ws-wordmark{display:inline-flex;align-items:center;gap:12px;white-space:nowrap}
.ws-latin{font:var(--type-wordmark);letter-spacing:.02em;font-size:18px}
.ws-jp{font:400 13px var(--font-mono);color:var(--text-2)}
.ws-band{flex-shrink:0;display:flex;flex-direction:column;justify-content:center;gap:3px;height:60px;padding-left:var(--pad);border-bottom:var(--hairline);background:var(--surface-panel);font:var(--type-control)}
.ws-band[hidden]{display:none}
.ws-band-title,.ws-band-detail{white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.ws-band-detail{font:var(--type-meta);color:var(--text-2)}
.ws-bar{position:relative;flex-shrink:0;display:flex;align-items:stretch;height:var(--header-h);border-bottom:var(--hairline)}
.ws-left{display:flex;align-items:center;padding:0 var(--pad);border-right:var(--hairline)}
.ws-middle{flex:1;min-width:0}
.ws-rule{position:absolute;left:0;right:0;bottom:-1px;height:2px;background:var(--text-1)}
.ws-fill{width:0;height:2px;background:var(--accent)}
.ws[data-failed] .ws-rule{display:none}
.ws-label{flex-shrink:0;display:flex;align-items:center;justify-content:space-between;gap:12px;padding:24px var(--pad) 12px;font:var(--type-label);letter-spacing:var(--tracking-label);color:var(--text-2)}
.ws-label-right{white-space:nowrap}
.ws-body{display:none;flex-direction:column;gap:28px;padding:12px var(--pad) 0}
.ws[data-revealed]:not([data-failed]) .ws-body{display:flex}
.ws-prose-in{display:flex;flex-direction:column;gap:12px;max-width:560px}
.ws h1{margin:0;font:500 22px/1.25 var(--font-sans)}
.ws p{margin:0;font:400 17px/1.5 var(--font-sans);color:var(--text-prose)}
.ws-steps{margin:0;padding:0;list-style:none;border:1px solid var(--line-1)}
.ws-step{display:flex;align-items:stretch;min-height:60px}
.ws-step+.ws-step{border-top:1px solid var(--line-1)}
.ws-num{width:64px;flex-shrink:0;display:flex;align-items:center;justify-content:center}
.ws-box{width:32px;height:32px;display:flex;align-items:center;justify-content:center;font:500 13px var(--font-mono);border:1px solid var(--line-2);color:var(--text-2)}
.ws-text{flex:1;min-width:0;display:flex;flex-direction:column;justify-content:center;gap:4px;padding:10px 0}
.ws-step-label{font:500 14px/1.2 var(--font-mono);letter-spacing:.04em;color:var(--text-2)}
.ws-step-note{font:400 13px/1.3 var(--font-mono);color:var(--text-2)}
.ws-status{display:flex;align-items:center;padding:0 18px;font:500 12px var(--font-mono);letter-spacing:.06em;color:var(--text-2)}
.ws-step[data-state=done] .ws-box{background:var(--accent);border-color:var(--accent);color:var(--on-accent)}
.ws-step[data-state=now] .ws-box{border-color:var(--text-1);color:var(--text-1)}
.ws-step:is([data-state=done],[data-state=now]) .ws-step-label,.ws-step[data-state=now] .ws-status{color:var(--text-1)}
.ws-fail{display:flex;flex-direction:column;gap:28px;padding:12px var(--pad) 0}
.ws-fail[hidden]{display:none}
.ws-fail h1{font-size:28px}
.ws-actions{display:flex;gap:12px}
.ws-btn{height:56px;padding:0 28px;display:inline-flex;align-items:center;justify-content:center;gap:8px;border-radius:0;font:500 16px var(--font-mono);text-transform:uppercase;text-decoration:none;cursor:pointer;background:transparent;color:var(--text-1);border:1px solid var(--line-2)}
.ws-btn.primary{background:var(--accent);color:var(--on-accent);border-color:var(--accent)}
.ws-report{border:1px solid var(--line-1)}
.ws-report-head{display:flex;align-items:stretch;border-bottom:1px solid var(--line-1)}
.ws-report-label{flex:1;min-width:0;display:flex;align-items:center;min-height:48px;padding:0 16px;font:500 12px var(--font-mono);letter-spacing:.06em;color:var(--text-2)}
.ws-copy{padding:0 24px;border:0;border-left:1px solid var(--line-1);border-radius:0;background:transparent;color:var(--text-1);font:500 14px/1.2 var(--font-mono);letter-spacing:.04em;cursor:pointer}
.ws-report pre{margin:0;padding:14px 16px;font:400 13px/1.5 var(--font-mono);color:var(--text-2);white-space:pre-wrap;overflow-wrap:anywhere;user-select:text;-webkit-user-select:text}
.ws-foot{font:400 13px/1.3 var(--font-mono);color:var(--text-2)}
@media (max-width:599px){
.ws-jp{display:none}
.ws-fail h1{font-size:24px}
.ws-actions{flex-direction:column}
}
@media (min-width:1024px){
.ws-body{flex-direction:row;align-items:flex-start;gap:48px}
.ws-prose{flex:1 1 0;min-width:0}
.ws-steps-at{flex:0 0 460px}
}
@media (min-width:1024px) and (pointer:fine){
.ws-side{display:flex;flex-direction:column;width:var(--sidebar-w);flex-shrink:0;border-right:var(--hairline)}
.ws-side-mark{height:64px;padding:0 24px;border-bottom:var(--hairline)}
.ws-side-mark .ws-latin{font-size:17px}
.ws-left{display:none}
.ws-body{gap:56px}
.ws-prose{flex:0 1 560px}
.ws-steps-at{flex:0 0 440px}
}
`;

/**
 * Puts the starting screen into the shell (adapter, at build time): its CSS
 * and the theme in <head>, the screen first in <body> with the script that
 * draws where this start is, both run before the first paint.
 *
 * @param {string} html the shell, after `holdTheStart`
 * @param {{ build: string }} options the build's version, for the unknown failure's report
 */
export function paintTheStart(html, { build }) {
	if (!html.includes('</head>') || !/<body[^>]*>/.test(html))
		throw new Error('tsundoku-web: the shell has no <head> or <body> to paint the start in');
	const head = `<style id="web-start-style">${START_STYLE.trim()}</style><script>(${themeBeforePaint})(document, window);</script>`;
	const body = `${START_MARKUP}<script>document.getElementById('web-start').dataset.build = ${JSON.stringify(build)};(${drawStart})(document, (${startView})(window, Date.now()));</script>`;
	return html
		.replace('</head>', `${head}</head>`)
		.replace(/<body[^>]*>/, (open) => `${open}${body}`);
}

/**
 * The web edition's starting screen, its rules (web/start.js;
 * doc/WEB-EDITION.md, "Starting, and when it cannot"): where a start is, what
 * the screen says at each step, and what a failure was. The screens themselves are drawn in a real browser by
 * web/tests/start.e2e.ts.
 */
import { describe, expect, it } from 'vitest';
import {
	OPENED_KEY,
	REVEAL_MS,
	START_KEY,
	START_MARKUP,
	STEPS,
	classify,
	describeBrowser,
	drawStart,
	failScreen,
	missingFeatures,
	paintTheStart,
	startView,
	themeBeforePaint,
	type Probe,
	type StartView
} from '../../web/start.js';

const UA = {
	chrome:
		'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/153.0.0.0 Safari/537.36',
	edge: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/150.0.0.0 Safari/537.36 Edg/150.0.0.0',
	firefox: 'Mozilla/5.0 (X11; Linux x86_64; rv:133.0) Gecko/20100101 Firefox/133.0',
	androidChrome:
		'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/150.0.0.0 Mobile Safari/537.36',
	safari:
		'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1',
	mac: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 14_0; rv:133.0) Gecko/20100101 Firefox/133.0'
};

/** A Storage over a plain object; `refuse` makes every call throw, as a blocked one does. */
function storage(items: Record<string, string> = {}, refuse = false): Storage {
	const no = () => {
		throw new DOMException('The operation is insecure.', 'SecurityError');
	};
	return {
		getItem: (k: string) => (refuse ? no() : (items[k] ?? null)),
		setItem: (k: string, v: string) => (refuse ? no() : void (items[k] = v)),
		removeItem: (k: string) => (refuse ? no() : void delete items[k]),
		clear: () => {},
		key: () => null,
		length: 0
	} as Storage;
}
const win = (local: Storage = storage(), session: Storage = storage()) => ({
	localStorage: local,
	sessionStorage: session
});

describe('where a start is', () => {
	const now = 1_000_000;

	it('is a first visit when the library never opened in this browser', () => {
		expect(startView(win(), now)).toEqual({ first: true, done: 0, since: now, revealed: false });
	});

	it('is a later visit once it has', () => {
		const v = startView(win(storage({ [OPENED_KEY]: '1' })), now);
		expect(v).toEqual({ first: false, done: 0, since: now, revealed: false });
	});

	it('carries the first visit on over its reload: the step reached and when it began', () => {
		const kept = JSON.stringify({ first: true, done: 1, since: now - 400 });
		expect(
			startView(win(storage({ [OPENED_KEY]: '1' }), storage({ [START_KEY]: kept })), now)
		).toEqual({ first: true, done: 1, since: now - 400, revealed: false });
	});

	it('says what this is once the first visit has taken REVEAL_MS, reload or not', () => {
		const at = (ago: number) =>
			startView(
				win(
					storage(),
					storage({ [START_KEY]: JSON.stringify({ first: true, done: 1, since: now - ago }) })
				),
				now
			).revealed;
		expect(REVEAL_MS).toBe(1500);
		expect(at(REVEAL_MS - 1)).toBe(false);
		expect(at(REVEAL_MS)).toBe(true);
		// A later visit never does, however long it takes.
		const later = JSON.stringify({ first: false, done: 1, since: now - 10_000 });
		expect(startView(win(storage(), storage({ [START_KEY]: later })), now).revealed).toBe(false);
	});

	it('starts afresh from a kept place it cannot read, and when storage is refused', () => {
		expect(startView(win(storage(), storage({ [START_KEY]: '{not json' })), now)).toMatchObject({
			first: true,
			done: 0,
			since: now
		});
		expect(startView(win(storage({}, true), storage({}, true)), now)).toMatchObject({
			first: true,
			done: 0
		});
	});
});

describe('the reader’s theme, before the first paint', () => {
	const run = (local: Storage, cookie = '') => {
		const doc = { cookie, documentElement: { dataset: {} as Record<string, string> } };
		// The shell inlines the function's own text: run that, so a name from
		// outside it would fail here as it would in the page.
		new Function('document', 'window', `(${themeBeforePaint})(document, window);`)(doc, {
			localStorage: local
		});
		return doc.documentElement.dataset.theme;
	};

	it('is the app’s own record of it, then the cookie, else left as the shell has it', () => {
		expect(run(storage({ 'tsundoku.theme': '"light"' }))).toBe('light');
		expect(run(storage({ 'tsundoku.theme': '"dark"' }), 'tsundoku_theme=light')).toBe('dark');
		expect(run(storage(), 'a=1; tsundoku_theme=light')).toBe('light');
		expect(run(storage({ 'tsundoku.theme': '"sepia"' }))).toBeUndefined();
		expect(run(storage({}, true), 'tsundoku_theme=light')).toBe('light');
		expect(run(storage({ 'tsundoku.theme': '{oops' }))).toBeUndefined();
	});
});

/** The starting screen's parts drawStart reads and writes, as plain objects. */
function screen() {
	const text = (t = '') => ({ textContent: t });
	const attrs = new Set<string>();
	const rows = STEPS.map(() => ({
		dataset: {} as Record<string, string>,
		status: text(),
		querySelector() {
			return this.status;
		}
	}));
	const parts: Record<string, unknown> = {
		'.ws-label-left': text(),
		'.ws-label-right': text(),
		'.ws-fill': { style: { width: '' } }
	};
	const root = {
		dataset: {} as Record<string, string>,
		toggleAttribute: (name: string, on: boolean) =>
			void (on ? attrs.add(name) : attrs.delete(name)),
		querySelector: (sel: string) => parts[sel] ?? null,
		querySelectorAll: () => rows
	};
	const doc = { getElementById: (id: string) => (id === 'web-start' ? root : null) };
	const draw = (v: StartView) =>
		new Function('document', 'view', `(${drawStart})(document, view);`)(doc, v);
	const read = () => ({
		left: (parts['.ws-label-left'] as { textContent: string }).textContent,
		right: (parts['.ws-label-right'] as { textContent: string }).textContent,
		fill: (parts['.ws-fill'] as { style: { width: string } }).style.width,
		step: root.dataset.step,
		first: attrs.has('data-first'),
		revealed: attrs.has('data-revealed'),
		rows: rows.map((r) => `${r.dataset.state}:${r.status.textContent}`)
	});
	return { draw, read, root };
}

describe('the starting screen at each step', () => {
	it('fills the header’s rule a quarter for each step finished', () => {
		const s = screen();
		for (const done of [0, 1, 2, 3, 4]) {
			s.draw({ first: false, done, since: 0, revealed: false });
			expect(s.read().fill).toBe(`${done * 25}%`);
			expect(s.read().step).toBe(String(done));
		}
	});

	it('says only STARTING · OPENING THE LIBRARY on a later visit', () => {
		const s = screen();
		s.draw({ first: false, done: 2, since: 0, revealed: true });
		expect(s.read()).toMatchObject({
			left: '00 — STARTING',
			right: 'OPENING THE LIBRARY',
			first: false,
			revealed: false
		});
	});

	it('says FIRST VISIT at once, and the step under way', () => {
		const s = screen();
		s.draw({ first: true, done: 0, since: 0, revealed: false });
		expect(s.read()).toMatchObject({
			left: '00 — FIRST VISIT',
			right: 'GETTING READY',
			first: true
		});
		expect(s.read().revealed).toBe(false);
	});

	it('counts the steps once it says what this is, marking each DONE, NOW or not yet', () => {
		const s = screen();
		s.draw({ first: true, done: 1, since: 0, revealed: true });
		expect(s.read()).toMatchObject({ right: '2 OF 4 · STARTING', revealed: true });
		expect(s.read().rows).toEqual(['done:DONE', 'now:NOW', 'todo:', 'todo:']);
		s.draw({ first: true, done: 3, since: 0, revealed: true });
		expect(s.read().right).toBe('4 OF 4 · SETTING IT UP');
		expect(s.read().rows).toEqual(['done:DONE', 'done:DONE', 'done:DONE', 'now:NOW']);
		// All four done: the last stays named until the app replaces the screen.
		s.draw({ first: true, done: 4, since: 0, revealed: true });
		expect(s.read().right).toBe('4 OF 4 · SETTING IT UP');
		expect(s.read().rows).toEqual(['done:DONE', 'done:DONE', 'done:DONE', 'done:DONE']);
	});

	it('leaves a failed start saying why', () => {
		const s = screen();
		s.root.dataset.failed = 'unknown';
		s.draw({ first: true, done: 3, since: 0, revealed: true });
		expect(s.read().left).toBe('');
	});

	it('names the steps as the handoff does, the last one a first visit’s only', () => {
		expect(STEPS.map((st) => st.label)).toEqual([
			'GETTING READY',
			'STARTING',
			'OPENING THE LIBRARY',
			'SETTING IT UP'
		]);
		expect(START_MARKUP).toContain('FIRST VISIT ONLY');
	});
});

const probe = (over: Partial<Probe> = {}): Probe => ({
	serviceWorker: true,
	moduleWorkers: true,
	locks: true,
	storageDirectory: true,
	...over
});

describe('what a failure to start was', () => {
	const at = 'registering';

	it('is a private window when Firefox has no service workers', () => {
		const f = classify({
			error: new Error('x'),
			at,
			probe: probe({ serviceWorker: false }),
			userAgent: UA.firefox
		});
		expect(f.kind).toBe('private');
	});

	it('is a browser too old elsewhere without them, naming each part missing', () => {
		const f = classify({
			error: null,
			at,
			probe: probe({ serviceWorker: false, locks: false }),
			userAgent: UA.chrome
		});
		expect(f).toMatchObject({ kind: 'old', missing: ['SERVICE WORKERS', 'WEB LOCKS'] });
		expect(missingFeatures(probe({ moduleWorkers: false, storageDirectory: false }))).toEqual([
			'MODULE WORKERS',
			'PRIVATE FILE STORAGE'
		]);
		expect(missingFeatures(probe())).toEqual([]);
	});

	it('is a browser too old when the server worker finds a part missing', () => {
		const error = Object.assign(new Error('missing'), { missing: ['SYNCHRONOUS FILE ACCESS'] });
		expect(classify({ error, at, probe: probe(), userAgent: UA.firefox })).toMatchObject({
			kind: 'old',
			missing: ['SYNCHRONOUS FILE ACCESS']
		});
	});

	it('is storage turned off when the browser refuses the site storage', () => {
		const refused = (name: string, message = 'refused') =>
			classify({ error: new DOMException(message, name), at, probe: probe(), userAgent: UA.chrome })
				.kind;
		// OPFS, and Chrome's registration with site data blocked.
		expect(refused('SecurityError')).toBe('storage');
		expect(refused('NotAllowedError', 'The user denied permission to use Service Worker.')).toBe(
			'storage'
		);
		// The server worker's SQLite pool, whose error arrives as text with its name.
		const pool = Object.assign(
			new Error('SecurityError: Security error when calling GetDirectory'),
			{
				name: 'Error'
			}
		);
		expect(classify({ error: pool, at, probe: probe(), userAgent: UA.chrome }).kind).toBe(
			'storage'
		);
	});

	it('is unknown otherwise, keeping where it was and what it said', () => {
		const f = classify({
			error: new TypeError('an invented failure'),
			at: 'starting the server',
			probe: probe(),
			userAgent: UA.chrome
		});
		expect(f).toEqual({
			kind: 'unknown',
			missing: [],
			at: 'starting the server',
			text: 'TypeError: an invented failure'
		});
		expect(classify({ error: 'plain text', at, probe: probe(), userAgent: UA.chrome }).text).toBe(
			'plain text'
		);
		expect(classify({ error: undefined, at, probe: probe(), userAgent: UA.chrome }).text).toBe('');
	});
});

describe('the could-not-start screens', () => {
	const ctx = { host: 'library.example', userAgent: UA.firefox, build: '2026.11.25' };
	const of = (kind: 'private' | 'storage' | 'old' | 'unknown', extra = {}) =>
		failScreen(
			{ kind, missing: [], at: 'starting the server', text: 'Error: boom', ...extra },
			ctx
		);

	it('say what happened, what to do, and the reason, each in its own words', () => {
		expect(of('private')).toMatchObject({
			right: 'PRIVATE WINDOW',
			title: 'A private window can’t keep a library.',
			primary: { label: 'Copy the address', act: 'copy-address' },
			foot: 'FIREFOX · PRIVATE WINDOW · NO SERVICE WORKERS',
			report: null
		});
		expect(of('storage')).toMatchObject({
			right: 'STORAGE TURNED OFF',
			title: 'This browser isn’t letting library.example keep anything.',
			primary: { label: 'Try again', act: 'reload' },
			foot: 'SITE DATA BLOCKED'
		});
		expect(of('old', { missing: ['MODULE WORKERS', 'WEB LOCKS'] })).toMatchObject({
			right: 'BROWSER TOO OLD',
			foot: 'MISSING · MODULE WORKERS · WEB LOCKS',
			primary: { act: 'copy-address' }
		});
		expect(of('private').body).toContain('Open library.example in a normal window.');
	});

	it('carry the unknown failure’s text, where it was, the browser and the build', () => {
		const s = of('unknown');
		expect(s).toMatchObject({ right: 'UNKNOWN', foot: 'NOTHING IN THE LIBRARY WAS CHANGED' });
		expect(s.report).toBe(
			'At: starting the server\nError: boom\nFirefox 133 · Linux · tsundoku 2026.11.25'
		);
		expect(of('unknown', { text: '' }).report).toContain('\nError: no message\n');
	});

	it('lead each to its part of the web edition’s document', () => {
		for (const kind of ['private', 'storage', 'old', 'unknown'] as const)
			expect(of(kind).more.href).toMatch(
				/^https:\/\/github\.com\/masshirodev\/tsundoku\/blob\/main\/doc\/WEB-EDITION\.md#/
			);
	});
});

describe('the browser, as the report names it', () => {
	it('names the browser, its version and the system', () => {
		expect(describeBrowser(UA.firefox)).toBe('Firefox 133 · Linux');
		expect(describeBrowser(UA.chrome)).toBe('Chrome 153 · Linux');
		expect(describeBrowser(UA.edge)).toBe('Edge 150 · Windows');
		expect(describeBrowser(UA.androidChrome)).toBe('Chrome 150 · Android');
		expect(describeBrowser(UA.safari)).toBe('Safari 18 · iOS');
		expect(describeBrowser(UA.mac)).toBe('Firefox 133 · macOS');
		expect(describeBrowser('Mozilla/5.0 (X11; CrOS x86_64) Chrome/150.0 Safari/537.36')).toBe(
			'Chrome 150 · ChromeOS'
		);
		expect(describeBrowser('curl/8')).toBe('An unknown browser');
	});
});

describe('the shell', () => {
	const shell =
		'<!doctype html><html data-theme="dark"><head><title>t</title></head><body data-x="1"><div style="display: contents"></div></body></html>';

	it('paints the starting screen first in the body, its style and theme in the head', () => {
		const html = paintTheStart(shell, { build: '2026.11.25' });
		const head = html.slice(0, html.indexOf('</head>'));
		expect(head).toContain('<style id="web-start-style">');
		expect(head).toContain('(document, window);</script>');
		expect(html).toMatch(/<body data-x="1"><div id="web-start"/);
		expect(html).toContain('dataset.build = "2026.11.25"');
		// The screen comes before the element the app mounts in.
		expect(html.indexOf('id="web-start"')).toBeLessThan(html.indexOf('display: contents'));
	});

	it('refuses a shell it cannot paint in', () => {
		expect(() => paintTheStart('<html></html>', { build: 'x' })).toThrow('no <head> or <body>');
	});
});

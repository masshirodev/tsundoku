/**
 * The fetcher answers tsundoku's own origins and nothing else
 * (doc/WEB-EDITION.md, "The fetcher"): the origin list, the sender check the
 * background makes, and the manifest's content-script matches agreeing with
 * both.
 */
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
	DEVELOPMENT_HOSTS,
	FETCHER_CHANNEL,
	PRODUCTION_ORIGINS,
	isAllowedOrigin,
	isFetcherMessage,
	contentScriptMatches,
	isPageMessage,
	FIREFOX_PERMISSIONS,
	manifestFor,
	mayAnswer,
	senderOrigin,
	siteAccessFrom
} from '../src/lib/fetcher/protocol.ts';

describe('isAllowedOrigin', () => {
	it.each(['store', 'development'] as const)('answers production in the %s build', (edition) => {
		expect(isAllowedOrigin('https://tsundoku.lt', edition)).toBe(true);
	});

	it.each([
		'http://127.0.0.1:42160',
		'http://127.0.0.1',
		'http://localhost:5173',
		'http://localhost'
	])('answers %s in the development build only', (origin) => {
		expect(isAllowedOrigin(origin, 'development')).toBe(true);
		expect(isAllowedOrigin(origin, 'store')).toBe(false);
	});

	it.each([
		['another site', 'https://example.com'],
		['a subdomain of production', 'https://evil.tsundoku.lt'],
		['production over http', 'http://tsundoku.lt'],
		['production on another port', 'https://tsundoku.lt:8443'],
		['a lookalike host', 'https://tsundoku.lt.example.com'],
		['loopback over https', 'https://localhost:5173'],
		['another loopback address', 'http://127.0.0.2:42160'],
		['IPv6 loopback', 'http://[::1]:42160'],
		['a subdomain of localhost', 'http://app.localhost:5173'],
		['a URL, not an origin', 'https://tsundoku.lt/library'],
		['credentials in the origin', 'http://user@localhost:5173'],
		['an opaque origin', 'null'],
		['an extension page', 'chrome-extension://abcdefghijklmnop'],
		['nothing', ''],
		['not a URL', 'tsundoku']
	])('refuses %s in either build', (_, origin) => {
		expect(isAllowedOrigin(origin, 'development')).toBe(false);
		expect(isAllowedOrigin(origin, 'store')).toBe(false);
	});

	it('refuses a missing origin', () => {
		expect(isAllowedOrigin(undefined, 'development')).toBe(false);
		expect(isAllowedOrigin(null, 'development')).toBe(false);
	});
});

describe('senderOrigin', () => {
	it('takes Chromium’s sender.origin', () => {
		expect(senderOrigin({ origin: 'http://localhost:1', url: 'https://other.example/x' })).toBe(
			'http://localhost:1'
		);
	});

	it('derives it from Firefox’s sender.url', () => {
		expect(senderOrigin({ url: 'https://tsundoku.lt/library?x=1#y' })).toBe('https://tsundoku.lt');
	});

	it('has none for a sender without either, or with a broken URL', () => {
		expect(senderOrigin({})).toBeNull();
		expect(senderOrigin({ url: 'not a url' })).toBeNull();
	});
});

describe('mayAnswer', () => {
	const own = { id: 'ext', tab: {}, frameId: 0, url: 'https://tsundoku.lt/' };

	it('answers its own content script in a top frame on an allowed origin', () => {
		expect(mayAnswer(own, 'ext', 'store')).toBe(true);
		const local = { ...own, url: 'http://localhost:5173/' };
		expect(mayAnswer(local, 'ext', 'development')).toBe(true);
		expect(mayAnswer(local, 'ext', 'store')).toBe(false);
	});

	it.each([
		['another extension', { ...own, id: 'other' }],
		['an extension page, in no tab', { ...own, tab: undefined }],
		['a frame inside the page', { ...own, frameId: 3 }],
		['another origin', { ...own, url: 'https://example.com/' }],
		['no origin at all', { id: 'ext', tab: {}, frameId: 0 }]
	])('ignores %s', (_, sender) => {
		expect(mayAnswer(sender, 'ext', 'development')).toBe(false);
	});
});

describe('message guards', () => {
	it('tells the page’s messages from the fetcher’s, and both from strangers', () => {
		const ping = { channel: FETCHER_CHANNEL, from: 'page', kind: 'ping' };
		const hello = { channel: FETCHER_CHANNEL, from: 'fetcher', kind: 'hello' };
		expect(isPageMessage(ping)).toBe(true);
		expect(isFetcherMessage(ping)).toBe(false);
		expect(isFetcherMessage(hello)).toBe(true);
		expect(isPageMessage(hello)).toBe(false);
		for (const other of [null, 'text', 3, {}, { channel: 'something-else', from: 'page' }]) {
			expect(isPageMessage(other)).toBe(false);
			expect(isFetcherMessage(other)).toBe(false);
		}
	});
});

describe('the manifest', () => {
	const template = JSON.parse(
		readFileSync(new URL('../fetcher/manifest.json', import.meta.url), 'utf8')
	);
	const loopback = /127\.0\.0\.1|localhost|\[::1\]/;

	it('leaves the matches to the build, so the template cannot ship loopback', () => {
		expect(template.content_scripts).toHaveLength(1);
		expect(template.content_scripts[0].matches).toBeUndefined();
	});

	it('gives the store build production only: no loopback host anywhere in it', () => {
		const store = manifestFor(template, 'store');
		expect(store.content_scripts[0].matches).toEqual(['https://tsundoku.lt/*']);
		expect(JSON.stringify(store)).not.toMatch(loopback);
		expect(store.name).toBe(template.name);
		expect(contentScriptMatches('store')).toEqual(['https://tsundoku.lt/*']);
		for (const host of DEVELOPMENT_HOSTS) {
			expect(isAllowedOrigin(`http://${host}:42160`, 'store')).toBe(false);
		}
	});

	it('gives the development build the loopback hosts too, with no port, and names it', () => {
		const development = manifestFor(template, 'development');
		const expected = [
			...PRODUCTION_ORIGINS.map((o) => `${o}/*`),
			...DEVELOPMENT_HOSTS.map((h) => `http://${h}/*`)
		];
		const [script] = development.content_scripts;
		expect([...script.matches].sort()).toEqual(expected.sort());
		// Firefox ignores a match pattern with a port; one without matches every port.
		for (const pattern of script.matches) expect(pattern).not.toMatch(/:\d+\//);
		expect(development.name).toBe(`${template.name} (development)`);
		// The template is left as it was.
		expect(template.content_scripts[0].matches).toBeUndefined();
	});

	it('asks Firefox alone for the lookup before sending, and both for watching requests', () => {
		const chromium = manifestFor(template, 'store');
		const firefox = manifestFor(template, 'store', 'firefox');
		for (const m of [chromium, firefox]) {
			expect(m.permissions).toEqual(expect.arrayContaining(['webRequest', 'storage', 'cookies']));
		}
		for (const p of FIREFOX_PERMISSIONS) {
			expect(chromium.permissions).not.toContain(p);
			expect(firefox.permissions).toContain(p);
		}
		expect(firefox.content_scripts).toEqual(chromium.content_scripts);
		// Each browser's background, and not the other's, which it ignores with a warning.
		expect(chromium.background).toEqual({ service_worker: 'background.js' });
		expect(firefox.background).toEqual({ scripts: ['background.js'] });
		expect(template.permissions).not.toContain('dns');
	});

	it('runs the content script in top frames at document start', () => {
		const [script] = template.content_scripts;
		expect(script.all_frames ?? false).toBe(false);
		expect(script.run_at).toBe('document_start');
	});

	it('asks for what fetching needs and nothing more', () => {
		expect(template.manifest_version).toBe(3);
		// webRequest watches the fetcher's own requests, and storage keeps the
		// hosts the reader allowed (src/lib/fetcher/reach.ts, c1140).
		expect([...template.permissions].sort()).toEqual([
			'cookies',
			'declarativeNetRequestWithHostAccess',
			'storage',
			'webRequest'
		]);
		expect(template.host_permissions).toEqual(['<all_urls>']);
		expect(template.externally_connectable).toBeUndefined();
		expect(template.web_accessible_resources).toBeUndefined();
	});
});

describe('siteAccessFrom', () => {
	it('is all with <all_urls>', () => {
		expect(siteAccessFrom(true, [], 'store')).toBe('all');
	});

	it('is some when only some sites were granted', () => {
		expect(siteAccessFrom(false, ['https://source.example/*'], 'store')).toBe('some');
	});

	it('is none when nothing beyond tsundoku’s own pages is granted', () => {
		expect(siteAccessFrom(false, [], 'store')).toBe('none');
		expect(siteAccessFrom(false, ['https://tsundoku.lt/*'], 'store')).toBe('none');
		expect(
			siteAccessFrom(false, ['https://tsundoku.lt/*', 'http://localhost/*'], 'development')
		).toBe('none');
		// The store build does not answer localhost, so access there is a site's.
		expect(siteAccessFrom(false, ['http://localhost/*'], 'store')).toBe('some');
	});
});

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
	isPageMessage,
	mayAnswer,
	senderOrigin
} from '../src/lib/fetcher/protocol.ts';

describe('isAllowedOrigin', () => {
	it.each([
		'https://tsundoku.lt',
		'http://127.0.0.1:42160',
		'http://127.0.0.1',
		'http://localhost:5173',
		'http://localhost'
	])('answers %s', (origin) => {
		expect(isAllowedOrigin(origin)).toBe(true);
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
	])('refuses %s', (_, origin) => {
		expect(isAllowedOrigin(origin)).toBe(false);
	});

	it('refuses a missing origin', () => {
		expect(isAllowedOrigin(undefined)).toBe(false);
		expect(isAllowedOrigin(null)).toBe(false);
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
		expect(mayAnswer(own, 'ext')).toBe(true);
	});

	it.each([
		['another extension', { ...own, id: 'other' }],
		['an extension page, in no tab', { ...own, tab: undefined }],
		['a frame inside the page', { ...own, frameId: 3 }],
		['another origin', { ...own, url: 'https://example.com/' }],
		['no origin at all', { id: 'ext', tab: {}, frameId: 0 }]
	])('ignores %s', (_, sender) => {
		expect(mayAnswer(sender, 'ext')).toBe(false);
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
	const manifest = JSON.parse(
		readFileSync(new URL('../fetcher/manifest.json', import.meta.url), 'utf8')
	);

	it('injects the content script on exactly the allowed origins, with no port in a pattern', () => {
		// Firefox ignores a match pattern with a port; one without matches every port.
		const expected = [
			...PRODUCTION_ORIGINS.map((o) => `${o}/*`),
			...DEVELOPMENT_HOSTS.map((h) => `http://${h}/*`)
		];
		const [script] = manifest.content_scripts;
		expect(manifest.content_scripts).toHaveLength(1);
		expect([...script.matches].sort()).toEqual(expected.sort());
		for (const pattern of script.matches) expect(pattern).not.toMatch(/:\d+\//);
		expect(script.all_frames ?? false).toBe(false);
		expect(script.run_at).toBe('document_start');
	});

	it('asks for what fetching needs and nothing more', () => {
		expect(manifest.manifest_version).toBe(3);
		expect([...manifest.permissions].sort()).toEqual([
			'cookies',
			'declarativeNetRequestWithHostAccess'
		]);
		expect(manifest.host_permissions).toEqual(['<all_urls>']);
		expect(manifest.externally_connectable).toBeUndefined();
		expect(manifest.web_accessible_resources).toBeUndefined();
	});
});

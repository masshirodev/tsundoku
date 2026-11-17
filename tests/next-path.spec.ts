import { describe, expect, it } from 'vitest';
import { sameOriginPath } from '$lib/server/next-path';

const ORIGIN = 'http://tsundoku.test:4183';

describe('sameOriginPath: where sign-in sends the browser', () => {
	it('keeps a path in this app, with its query and hash', () => {
		expect(sameOriginPath('/series/12?tab=files#top', ORIGIN)).toBe('/series/12?tab=files#top');
		expect(sameOriginPath('/', ORIGIN)).toBe('/');
	});

	it('answers / for nothing at all', () => {
		expect(sameOriginPath(null, ORIGIN)).toBe('/');
		expect(sameOriginPath(undefined, ORIGIN)).toBe('/');
		expect(sameOriginPath('', ORIGIN)).toBe('/');
	});

	// Each of these is a path to a prefix check, and another site to a browser.
	it.each([
		'//evil.example',
		'/\\evil.example',
		'\\\\evil.example',
		'/\t/evil.example',
		'/\n/evil.example',
		'/\r\n/evil.example',
		'\t//evil.example',
		'https://evil.example/',
		'javascript:alert(1)',
		'data:text/html,hi',
		`${ORIGIN}.evil.example/`
	])('refuses %j', (next) => {
		expect(sameOriginPath(next, ORIGIN)).toBe('/');
	});

	it('never hands back a value a browser could read as another host', () => {
		for (const next of [
			'/\t/evil.example',
			'/\\evil.example',
			'//evil.example/path',
			// Same scheme as the origin: WHATWG reads it as a relative path here.
			'http:evil.example'
		])
			expect(new URL(sameOriginPath(next, ORIGIN), ORIGIN).origin).toBe(ORIGIN);
	});

	it('keeps a full URL of this very origin, as its path', () => {
		expect(sameOriginPath(`${ORIGIN}/history`, ORIGIN)).toBe('/history');
	});
});

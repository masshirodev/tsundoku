/**
 * The Cookie header the fetcher builds from the browser's jars
 * (src/lib/fetcher/cookies.ts): both jars, each cookie once, the browser's
 * order, and the clearance that decides the User-Agent.
 */
import { describe, expect, it } from 'vitest';
import {
	cookieHeader,
	cookieUrls,
	hasClearance,
	type CookieLike
} from '../src/lib/fetcher/cookies.ts';

const cookie = (name: string, value: string, extra: Partial<CookieLike> = {}): CookieLike => ({
	name,
	value,
	domain: 'source.example',
	path: '/',
	...extra
});
const partition = { topLevelSite: 'https://source.example' };

describe('cookieHeader', () => {
	it('joins the unpartitioned jar and the site’s own partition', () => {
		expect(
			cookieHeader(
				[cookie('session', 's1')],
				[cookie('cf_clearance', 'c1', { partitionKey: partition })]
			)
		).toBe('session=s1; cf_clearance=c1');
	});

	it('sends a cookie both reads returned once', () => {
		const session = cookie('session', 's1');
		const clearance = cookie('cf_clearance', 'c1', { partitionKey: partition });
		expect(cookieHeader([session], [session, clearance])).toBe('session=s1; cf_clearance=c1');
	});

	it('keeps same-named cookies that are different cookies', () => {
		expect(
			cookieHeader(
				[cookie('id', 'host'), cookie('id', 'parent', { domain: '.example' })],
				[cookie('id', 'partitioned', { partitionKey: partition })]
			)
		).toBe('id=host; id=parent; id=partitioned');
	});

	it('puts longer paths first, and keeps the browser’s order otherwise', () => {
		expect(
			cookieHeader(
				[cookie('a', '1'), cookie('deep', '2', { path: '/reader/chapter' }), cookie('b', '3')],
				[cookie('mid', '4', { path: '/reader', partitionKey: partition })]
			)
		).toBe('deep=2; mid=4; a=1; b=3');
	});

	it('is empty with no cookies', () => {
		expect(cookieHeader([], [])).toBe('');
	});
});

describe('hasClearance', () => {
	it('finds Cloudflare’s clearance in either jar, by name only', () => {
		expect(hasClearance([cookie('session', 's')])).toBe(false);
		expect(hasClearance([cookie('cf_clearance', 'x', { partitionKey: partition })])).toBe(true);
		expect(hasClearance([cookie('CF_CLEARANCE', 'x')])).toBe(false);
	});
});

describe('cookieUrls', () => {
	it('asks about a URL as it is', () => {
		expect(cookieUrls('https://source.example/a?b')).toEqual(['https://source.example/a?b']);
		expect(cookieUrls('http://source.example/a')).toEqual(['http://source.example/a']);
	});

	it.each([
		'http://localhost:42160/x',
		'http://app.localhost/x',
		'http://127.0.0.1:8080/x',
		'http://127.1.2.3/x',
		'http://[::1]:42160/x'
	])('asks about loopback over http in its https form too: %s', (url) => {
		const https = new URL(url);
		https.protocol = 'https:';
		expect(cookieUrls(url)).toEqual([url, https.href]);
	});

	it('leaves loopback over https alone', () => {
		expect(cookieUrls('https://localhost:42160/x')).toEqual(['https://localhost:42160/x']);
	});
});

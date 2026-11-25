/**
 * The fetcher names a cookie partition by the Public Suffix List
 * (src/lib/fetcher/psl.ts): the format's rules on a small list, and the
 * vendored list itself on hosts whose answer is known.
 */
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { parseSuffixList, registrableDomain, siteOf } from '../src/lib/fetcher/psl.ts';

const vendored = parseSuffixList(
	readFileSync(new URL('../src/lib/fetcher/public_suffix_list.dat', import.meta.url), 'utf8')
);

describe('the format', () => {
	const rules = parseSuffixList(
		[
			'// a comment, then rules',
			'com',
			'uk',
			'co.uk',
			'*.ck',
			'!www.ck',
			'jp',
			'*.kawasaki.jp',
			'!city.kawasaki.jp',
			'  ex.ample  trailing words are ignored',
			'',
			'公司.cn',
			'CN'
		].join('\n')
	);

	it.each([
		['plain suffix', 'www.example.com', 'example.com'],
		['the domain itself', 'example.com', 'example.com'],
		['the longer rule wins', 'a.b.example.co.uk', 'example.co.uk'],
		['a wildcard makes every label below a suffix', 'a.b.foo.ck', 'b.foo.ck'],
		['an exception beats the wildcard', 'a.www.ck', 'www.ck'],
		['an exception, nested', 'x.city.kawasaki.jp', 'city.kawasaki.jp'],
		['a wildcard, nested', 'x.y.other.kawasaki.jp', 'y.other.kawasaki.jp'],
		['the default rule for an unlisted top level', 'a.b.unlisted', 'b.unlisted'],
		['a rule with words after it', 'a.b.ex.ample', 'b.ex.ample'],
		['an IDN rule, matched in punycode', 'a.b.xn--55qx5d.cn', 'b.xn--55qx5d.cn'],
		['case and a trailing dot', 'WWW.Example.COM.', 'example.com']
	])('%s: %s → %s', (_, host, expected) => {
		expect(registrableDomain(host, rules)).toBe(expected);
	});

	it.each([
		['a public suffix itself', 'co.uk'],
		['a wildcard suffix itself', 'foo.ck'],
		['an unlisted single label', 'localhost'],
		['an IPv4 address', '127.0.0.1'],
		['an IPv6 address', '[::1]'],
		['nothing', '']
	])('%s has no registrable domain: %s', (_, host) => {
		expect(registrableDomain(host, rules)).toBeNull();
	});
});

describe('the vendored list', () => {
	it('has both sections’ rules', () => {
		expect(vendored.exact.has('com')).toBe(true);
		expect(vendored.exact.has('co.uk')).toBe(true);
		// The private section: browsers name sites with it included.
		expect(vendored.exact.has('github.io')).toBe(true);
		expect(vendored.exact.size).toBeGreaterThan(5000);
	});

	it.each([
		['https://a.b.example.co.uk/x?y', 'https://example.co.uk'],
		['https://www.example.com/', 'https://example.com'],
		['https://someone.github.io/page', 'https://someone.github.io'],
		['http://localhost:42160/echo', 'http://localhost'],
		['http://127.0.0.1:42160/', 'http://127.0.0.1'],
		['http://[::1]:42160/', 'http://[::1]'],
		['https://例え.jp/', 'https://xn--r8jz45g.jp']
	])('siteOf(%s) is %s', (url, site) => {
		expect(siteOf(url, vendored)).toBe(site);
	});
});

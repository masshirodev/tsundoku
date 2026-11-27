/**
 * How a page's request becomes a network request (src/lib/fetcher/plan.ts):
 * which headers fetch() sends, which the session rule applies, which are
 * never sent, whose User-Agent goes out, and the rule itself.
 */
import { describe, expect, it } from 'vitest';
import {
	FetcherError,
	NO_TAB,
	buildRule,
	chooseUserAgent,
	normaliseTarget,
	planRequest,
	responseHeaders
} from '../src/lib/fetcher/plan.ts';

const noCookies = { header: '', clearance: false };

describe('normaliseTarget', () => {
	it('drops the fragment and upper-cases the method', () => {
		expect(normaliseTarget({ url: 'https://source.example/a?b=1#c', method: 'post' })).toEqual({
			url: 'https://source.example/a?b=1',
			method: 'POST'
		});
	});

	it('defaults to GET', () => {
		expect(normaliseTarget({ url: 'https://source.example/' }).method).toBe('GET');
	});

	it.each([
		['not a URL', { url: 'nowhere' }, 'not a URL: nowhere'],
		['a file', { url: 'file:///etc/hostname' }, 'only http and https are fetched, not file:'],
		['an extension page', { url: 'chrome-extension://x/y' }, 'only http and https'],
		['a data URL', { url: 'data:text/plain,hi' }, 'only http and https'],
		['CONNECT', { url: 'https://source.example/', method: 'CONNECT' }, 'method CONNECT'],
		['a custom method', { url: 'https://source.example/', method: 'PROPFIND' }, 'method PROPFIND'],
		[
			'a GET with a body',
			{ url: 'https://source.example/', body: new Uint8Array([1]) },
			'a GET request has no body'
		],
		[
			'a HEAD with a body',
			{ url: 'https://source.example/', method: 'HEAD', body: new Uint8Array([1]) },
			'a HEAD request has no body'
		]
	])('refuses %s', (_, request, message) => {
		expect(() => normaliseTarget(request)).toThrow(FetcherError);
		expect(() => normaliseTarget(request)).toThrow(message);
	});

	it('allows a GET with an empty body', () => {
		expect(
			normaliseTarget({ url: 'https://source.example/', body: new Uint8Array(0) }).method
		).toBe('GET');
	});
});

describe('chooseUserAgent', () => {
	it('sends the engine’s where there is no clearance', () => {
		expect(chooseUserAgent('Engine/1', false)).toBe('requested');
	});

	it('sends the browser’s for a host with a clearance, whatever the page asked', () => {
		expect(chooseUserAgent('Engine/1', true)).toBe('browser');
	});

	it('sends the browser’s when the page asked for none', () => {
		expect(chooseUserAgent(undefined, false)).toBe('browser');
		expect(chooseUserAgent('', false)).toBe('browser');
	});
});

describe('planRequest', () => {
	const request = {
		url: 'https://source.example/list?page=2',
		method: 'POST',
		headers: [
			['User-Agent', 'Engine/1'],
			['Referer', 'https://source.example/'],
			['Origin', 'https://source.example'],
			['Cookie', 'page=evil'],
			['Accept-Encoding', 'gzip'],
			['Content-Length', '3'],
			['Host', 'elsewhere.example'],
			['Connection', 'close'],
			['Sec-Fetch-Site', 'none'],
			['Proxy-Authorization', 'x'],
			['DNT', '1'],
			['Accept', 'text/html'],
			['Accept', 'application/json'],
			['X-Requested-With', 'XMLHttpRequest'],
			['Content-Type', 'application/x-www-form-urlencoded'],
			['', 'nameless']
		] as [string, string][],
		body: new TextEncoder().encode('a=1')
	};

	it('sorts every header into fetch(), the rule, or nowhere', () => {
		const plan = planRequest(request, { header: 'session=s1', clearance: false });
		expect(plan.url).toBe('https://source.example/list?page=2');
		expect(plan.method).toBe('POST');
		expect(plan.headers).toEqual([
			['Accept', 'text/html'],
			['Accept', 'application/json'],
			['X-Requested-With', 'XMLHttpRequest'],
			['Content-Type', 'application/x-www-form-urlencoded']
		]);
		expect(plan.ruleHeaders).toEqual([
			{ header: 'user-agent', operation: 'set', value: 'Engine/1' },
			{ header: 'referer', operation: 'set', value: 'https://source.example/' },
			{ header: 'dnt', operation: 'set', value: '1' },
			{ header: 'origin', operation: 'set', value: 'https://source.example' },
			{ header: 'cookie', operation: 'set', value: 'session=s1' }
		]);
		expect(plan.userAgent).toBe('requested');
	});

	it('never sends the page’s Cookie, only the browser’s', () => {
		const plan = planRequest(request, { header: 'session=s1', clearance: false });
		const all = JSON.stringify(plan);
		expect(all).not.toContain('page=evil');
	});

	it('leaves the User-Agent to the browser for a host with a clearance', () => {
		const plan = planRequest(request, { header: 'cf_clearance=c', clearance: true });
		expect(plan.userAgent).toBe('browser');
		expect(plan.ruleHeaders.find((h) => h.header === 'user-agent')).toBeUndefined();
	});

	it('removes the extension’s own Origin, and any Cookie, when there is none to send', () => {
		const plan = planRequest({ url: 'https://source.example/' }, noCookies);
		expect(plan.headers).toEqual([]);
		expect(plan.ruleHeaders).toEqual([
			{ header: 'origin', operation: 'remove' },
			{ header: 'cookie', operation: 'remove' }
		]);
		expect(plan.userAgent).toBe('browser');
	});

	it('joins a header the rule sets more than once', () => {
		const plan = planRequest(
			{
				url: 'https://source.example/',
				headers: [
					['Via', '1.1 a'],
					['via', '1.1 b']
				]
			},
			noCookies
		);
		expect(plan.ruleHeaders[0]).toEqual({ header: 'via', operation: 'set', value: '1.1 a, 1.1 b' });
	});
});

describe('buildRule', () => {
	const plan = planRequest(
		{ url: 'https://source.example/a?b=1', headers: [['Referer', 'https://source.example/']] },
		{ header: 'session=s1', clearance: false }
	);

	it('scopes the rule to this URL, this method, and requests outside every tab', () => {
		expect(buildRule(7, plan)).toEqual({
			id: 7,
			priority: 4,
			action: { type: 'modifyHeaders', requestHeaders: plan.ruleHeaders },
			condition: {
				urlFilter: '|https://source.example/a?b=1|',
				isUrlFilterCaseSensitive: true,
				tabIds: [NO_TAB],
				requestMethods: ['get'],
				resourceTypes: ['xmlhttprequest', 'other']
			}
		});
	});

	it('matches a URL with wildcard characters by an exact regular expression', () => {
		const odd = planRequest({ url: 'https://source.example/a*b^c?q=(1)+[2]|$' }, noCookies);
		const { condition } = buildRule(1, odd) as { condition: { regexFilter?: string } };
		expect(condition).not.toHaveProperty('urlFilter');
		const pattern = new RegExp(condition.regexFilter!);
		expect(pattern.test(odd.url)).toBe(true);
		expect(pattern.test('https://source.example/aXXb^c?q=(1)+[2]|$')).toBe(false);
		expect(pattern.test(`${odd.url}more`)).toBe(false);
	});
});

describe('responseHeaders', () => {
	it('drops the encoding’s headers from a body the browser decoded', () => {
		expect(
			responseHeaders([
				['content-type', 'text/html'],
				['Content-Encoding', 'br'],
				['content-length', '120']
			])
		).toEqual([['content-type', 'text/html']]);
	});

	it('keeps Content-Length when the body was never encoded', () => {
		const plain: [string, string][] = [
			['content-type', 'image/jpeg'],
			['content-length', '5000']
		];
		expect(responseHeaders(plain)).toEqual(plain);
	});
});

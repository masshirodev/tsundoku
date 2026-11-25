/**
 * The fetcher's background (src/lib/fetcher/service.ts) against a fake
 * browser: who it answers, the rule it adds for each request and removes
 * after, the cookies it reads, and its rule ids under concurrency.
 */
import { describe, expect, it } from 'vitest';
import type { CookieLike } from '../src/lib/fetcher/cookies.ts';
import { toBase64 } from '../src/lib/fetcher/bytes.ts';
import { parseSuffixList } from '../src/lib/fetcher/psl.ts';
import {
	createFetcherService,
	type CookieQuery,
	type FetcherDeps,
	type RuntimeReply,
	type WireRequest
} from '../src/lib/fetcher/service.ts';

const SENDER = { id: 'ext', tab: {}, frameId: 0, origin: 'https://tsundoku.lt' };
const suffixes = parseSuffixList('uk\nco.uk\nexample');

interface Rule {
	id: number;
	action: { requestHeaders: { header: string; operation: string; value?: string }[] };
	condition: { urlFilter?: string };
}

/** A browser with cookie jars, session rules and a network, all in memory. */
function fakeBrowser(
	network: (url: string, init: RequestInit, rules: Rule[]) => Promise<Response> = async () =>
		new Response('ok')
) {
	const rules = new Map<number, Rule>();
	const jar: CookieLike[] = [];
	const partitions = new Map<string, CookieLike[]>();
	const queries: CookieQuery[] = [];
	const sent: { url: string; init: RequestInit; rules: Rule[] }[] = [];
	const deps: FetcherDeps = {
		extensionId: 'ext',
		edition: 'store',
		siteAccess: async () => 'all',
		suffixes: () => suffixes,
		async getCookies(query) {
			queries.push(query);
			if (!query.partitionKey) return [...jar];
			return [...(partitions.get(query.partitionKey.topLevelSite) ?? [])];
		},
		async addRule(rule) {
			if (rules.has(rule.id)) throw new Error(`rule ${rule.id} already exists`);
			rules.set(rule.id, rule as unknown as Rule);
		},
		async removeRule(id) {
			rules.delete(id);
		},
		async clearRules() {
			rules.clear();
		},
		async fetch(url, init) {
			const live = [...rules.values()];
			sent.push({ url, init, rules: live });
			return network(url, init, live);
		}
	};
	return { deps, rules, jar, partitions, queries, sent };
}

function ask(
	service: ReturnType<typeof createFetcherService>,
	request: WireRequest,
	transport = 'base64'
) {
	const reply = service.answer({ kind: 'fetch', transport, request }, SENDER);
	if (!reply) throw new Error('not answered');
	return reply as Promise<RuntimeReply & { kind: 'fetched' }>;
}

const header = (rule: Rule, name: string) =>
	rule.action.requestHeaders.find((h) => h.header === name);

describe('who is answered', () => {
	it('ignores a sender that is not its content script on an allowed origin', () => {
		const { deps } = fakeBrowser();
		const service = createFetcherService(deps);
		const message = { kind: 'probe', bytes: new Uint8Array([1]) };
		expect(service.answer(message, { ...SENDER, origin: 'https://example.com' })).toBeNull();
		expect(service.answer(message, { ...SENDER, id: 'another-extension' })).toBeNull();
	});

	it('ignores what is not one of its messages', () => {
		const service = createFetcherService(fakeBrowser().deps);
		expect(service.answer({ kind: 'something' }, SENDER)).toBeNull();
		expect(service.answer({ kind: 'fetch' }, SENDER)).toBeNull();
		expect(service.answer(null, SENDER)).toBeNull();
	});

	it('echoes the probe, so the content script sees how bytes cross', async () => {
		const service = createFetcherService(fakeBrowser().deps);
		const bytes = new Uint8Array([0, 255]);
		expect(await service.answer({ kind: 'probe', bytes }, SENDER)).toEqual({
			kind: 'probe',
			bytes,
			access: 'all'
		});
	});

	it('asks for site access afresh on every probe', async () => {
		const browser = fakeBrowser();
		let granted = false;
		browser.deps.siteAccess = async () => (granted ? 'all' : 'none');
		const service = createFetcherService(browser.deps);
		const probe = () => service.answer({ kind: 'probe', bytes: new Uint8Array(0) }, SENDER);
		expect(await probe()).toMatchObject({ access: 'none' });
		granted = true;
		expect(await probe()).toMatchObject({ access: 'all' });
	});

	it('reports no access when the browser cannot say', async () => {
		const browser = fakeBrowser();
		browser.deps.siteAccess = () => Promise.reject(new Error('no permissions API'));
		const service = createFetcherService(browser.deps);
		expect(await service.answer({ kind: 'probe', bytes: new Uint8Array(0) }, SENDER)).toMatchObject(
			{ access: 'none' }
		);
	});

	it('answers loopback pages in the development build only', () => {
		const local = { ...SENDER, origin: 'http://localhost:5173' };
		const message = { kind: 'probe', bytes: new Uint8Array(0) };
		const store = fakeBrowser();
		expect(createFetcherService(store.deps).answer(message, local)).toBeNull();
		const development = fakeBrowser();
		development.deps.edition = 'development';
		expect(createFetcherService(development.deps).answer(message, local)).not.toBeNull();
	});
});

describe('one request', () => {
	it('sends it under its own rule, with both jars’ cookies, and removes the rule after', async () => {
		const browser = fakeBrowser(
			async () =>
				new Response(new Uint8Array([1, 2, 3]), {
					status: 201,
					statusText: 'Created',
					headers: { 'content-type': 'image/png', 'x-source': 'yes' }
				})
		);
		browser.jar.push({ name: 'session', value: 's1', domain: 'a.source.co.uk', path: '/' });
		browser.partitions.set('https://source.co.uk', [
			{
				name: 'cf_clearance',
				value: 'c1',
				domain: 'a.source.co.uk',
				path: '/',
				partitionKey: { topLevelSite: 'https://source.co.uk' }
			}
		]);
		const service = createFetcherService(browser.deps);
		const reply = await ask(service, {
			url: 'https://a.source.co.uk/page#top',
			method: 'POST',
			headers: [
				['User-Agent', 'Engine/1'],
				['Content-Type', 'text/plain']
			],
			body: { base64: toBase64(new TextEncoder().encode('hi')) }
		});

		// The partition is named by the suffix list: co.uk is one suffix.
		expect(browser.queries).toEqual([
			{ url: 'https://a.source.co.uk/page' },
			{ url: 'https://a.source.co.uk/page', partitionKey: { topLevelSite: 'https://source.co.uk' } }
		]);
		const [{ url, init, rules }] = browser.sent;
		expect(url).toBe('https://a.source.co.uk/page');
		expect(init).toMatchObject({
			method: 'POST',
			headers: [['Content-Type', 'text/plain']],
			credentials: 'include',
			referrerPolicy: 'no-referrer',
			cache: 'no-store',
			redirect: 'follow'
		});
		expect(new TextDecoder().decode(init.body as Uint8Array)).toBe('hi');
		expect(rules).toHaveLength(1);
		expect(rules[0].condition.urlFilter).toBe('|https://a.source.co.uk/page|');
		expect(header(rules[0], 'cookie')?.value).toBe('session=s1; cf_clearance=c1');
		// The clearance means the browser's own User-Agent.
		expect(header(rules[0], 'user-agent')).toBeUndefined();

		expect(reply).toEqual({
			kind: 'fetched',
			ok: true,
			response: {
				status: 201,
				statusText: 'Created',
				url: '',
				redirected: false,
				headers: [
					['content-type', 'image/png'],
					['x-source', 'yes']
				],
				body: { base64: toBase64(new Uint8Array([1, 2, 3])) }
			}
		});
		expect(browser.rules.size).toBe(0);
		expect(service.rulesInUse).toBe(0);
	});

	it('answers with bytes where the browser clones them', async () => {
		const service = createFetcherService(fakeBrowser().deps);
		const reply = await ask(service, { url: 'https://source.example/' }, 'binary');
		expect(reply.ok && reply.response.body).toEqual({ binary: new TextEncoder().encode('ok') });
	});

	it('sends the page’s User-Agent to a host without a clearance', async () => {
		const browser = fakeBrowser();
		await ask(createFetcherService(browser.deps), {
			url: 'https://source.example/',
			headers: [['User-Agent', 'Engine/1']]
		});
		expect(header(browser.sent[0].rules[0], 'user-agent')?.value).toBe('Engine/1');
		expect(header(browser.sent[0].rules[0], 'cookie')?.operation).toBe('remove');
	});

	it('reads loopback cookies under both schemes', async () => {
		const browser = fakeBrowser();
		await ask(createFetcherService(browser.deps), { url: 'http://localhost:4000/x' });
		expect(browser.queries.map((q) => q.url)).toEqual([
			'http://localhost:4000/x',
			'http://localhost:4000/x',
			'https://localhost:4000/x',
			'https://localhost:4000/x'
		]);
		expect(browser.queries[1].partitionKey).toEqual({ topLevelSite: 'http://localhost' });
	});

	it('does without partitions in a browser that has none', async () => {
		const browser = fakeBrowser();
		browser.jar.push({ name: 'session', value: 's1', domain: 'source.example', path: '/' });
		const getCookies = browser.deps.getCookies;
		browser.deps.getCookies = async (query) => {
			if (query.partitionKey) throw new Error('Unexpected property "partitionKey"');
			return getCookies(query);
		};
		const reply = await ask(createFetcherService(browser.deps), { url: 'https://source.example/' });
		expect(reply.ok).toBe(true);
		expect(header(browser.sent[0].rules[0], 'cookie')?.value).toBe('session=s1');
	});
});

describe('failures', () => {
	it('refuses a request it will not make, without a rule', async () => {
		const browser = fakeBrowser();
		const reply = await ask(createFetcherService(browser.deps), { url: 'file:///etc/hostname' });
		expect(reply).toEqual({
			kind: 'fetched',
			ok: false,
			message: 'only http and https are fetched, not file:'
		});
		expect(browser.sent).toHaveLength(0);
	});

	it('names a network failure, and still removes the rule', async () => {
		const browser = fakeBrowser(async () => {
			throw new TypeError('Failed to fetch');
		});
		const service = createFetcherService(browser.deps);
		const reply = await ask(service, { url: 'https://source.example/' });
		expect(reply).toEqual({
			kind: 'fetched',
			ok: false,
			message: 'network error: Failed to fetch'
		});
		expect(browser.rules.size).toBe(0);
		expect(service.rulesInUse).toBe(0);
	});

	it('names a network failure that is not an Error', async () => {
		const browser = fakeBrowser(() => Promise.reject('offline'));
		expect(
			await ask(createFetcherService(browser.deps), { url: 'https://source.example/' })
		).toMatchObject({ ok: false, message: 'network error: offline' });
	});

	it('gives the id back when the rule could not be added', async () => {
		const browser = fakeBrowser();
		browser.deps.addRule = async () => {
			throw new Error('too many rules');
		};
		const service = createFetcherService(browser.deps);
		expect(await ask(service, { url: 'https://source.example/' })).toMatchObject({
			ok: false,
			message: 'too many rules'
		});
		expect(service.rulesInUse).toBe(0);
		expect(browser.sent).toHaveLength(0);
	});

	it('never hands out again the id of a rule it could not remove', async () => {
		const browser = fakeBrowser();
		browser.deps.removeRule = async () => {
			throw new Error('could not remove');
		};
		const service = createFetcherService(browser.deps);
		expect(await ask(service, { url: 'https://source.example/a' })).toMatchObject({
			ok: false,
			message: 'could not remove'
		});
		expect(service.rulesInUse).toBe(1);
		// The next request gets a new id, and adding it succeeds.
		expect(await ask(service, { url: 'https://source.example/b' })).toMatchObject({ ok: false });
		expect([...browser.rules.keys()]).toEqual([1, 2]);
	});

	it('describes a failure that is not an Error', async () => {
		const browser = fakeBrowser();
		browser.deps.addRule = () => Promise.reject('quota');
		expect(
			await ask(createFetcherService(browser.deps), { url: 'https://source.example/' })
		).toMatchObject({ ok: false, message: 'quota' });
	});
});

describe('rules under concurrency', () => {
	it('clears rules left by an earlier background before adding its first', async () => {
		const browser = fakeBrowser();
		browser.rules.set(1, { id: 1, action: { requestHeaders: [] }, condition: {} });
		const reply = await ask(createFetcherService(browser.deps), { url: 'https://source.example/' });
		expect(reply.ok).toBe(true);
		expect(browser.sent[0].rules.map((r) => r.id)).toEqual([1]);
	});

	it('starts even when clearing fails', async () => {
		const browser = fakeBrowser();
		browser.deps.clearRules = () => Promise.reject(new Error('no rules API'));
		expect(
			(await ask(createFetcherService(browser.deps), { url: 'https://source.example/' })).ok
		).toBe(true);
	});

	it('runs requests to one URL in turn, each under its own rule, with the cookies of the one before', async () => {
		let inFlight = 0;
		let most = 0;
		const browser = fakeBrowser(async () => {
			inFlight++;
			most = Math.max(most, inFlight);
			await new Promise((r) => setTimeout(r, 5));
			inFlight--;
			// The site answers each request with a cookie the next must carry.
			browser.jar.push({
				name: `turn${browser.sent.length}`,
				value: 'x',
				domain: 'source.example',
				path: '/'
			});
			return new Response('ok');
		});
		const service = createFetcherService(browser.deps);
		const replies = await Promise.all(
			Array.from({ length: 5 }, (_, i) =>
				ask(service, { url: 'https://source.example/same', headers: [['Referer', `r${i}`]] })
			)
		);
		expect(replies.every((r) => r.ok)).toBe(true);
		expect(most).toBe(1);
		for (const [i, { rules }] of browser.sent.entries()) {
			expect(rules).toHaveLength(1);
			expect(header(rules[0], 'referer')?.value).toBe(`r${i}`);
			if (i > 0) expect(header(rules[0], 'cookie')?.value).toContain(`turn${i}=x`);
		}
		expect(service.rulesInUse).toBe(0);
	});

	it('runs requests to different URLs at once, under distinct ids', async () => {
		let inFlight = 0;
		let most = 0;
		const browser = fakeBrowser(async () => {
			inFlight++;
			most = Math.max(most, inFlight);
			await new Promise((r) => setTimeout(r, 5));
			inFlight--;
			return new Response('ok');
		});
		const service = createFetcherService(browser.deps);
		await Promise.all(
			Array.from({ length: 5 }, (_, i) => ask(service, { url: `https://source.example/${i}` }))
		);
		expect(most).toBe(5);
		const idsSeen = new Set(browser.sent.at(-1)!.rules.map((r) => r.id));
		expect(idsSeen.size).toBe(browser.sent.at(-1)!.rules.length);
		expect(Math.max(...browser.sent.flatMap((s) => s.rules.map((r) => r.id)))).toBe(5);
		expect(browser.rules.size).toBe(0);
	});
});

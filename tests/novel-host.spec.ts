import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { mkdtempSync, rmSync, writeFileSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { NovelHost, NovelHostError } from '$lib/server/novels/host';

// The LNReader plugin host (doc/NOVELS.md, "The plugin host"; card c147): a
// plugin answers through it, and a plugin that tries to leave its box can't.

let site: Server;
let other: Server;
/** A site that answers with a browser check until its clearance is sent (card c152). */
let challenged: Server;
let port = 0;
let otherPort = 0;
let checkPort = 0;
const store = mkdtempSync(join(tmpdir(), 'tsundoku-novel-host-'));
let host: NovelHost;

/** The URLs the app was asked to solve, and what the checked site was sent. */
let solved: string[] = [];
let seen: { cookie: string; agent: string }[] = [];
let solveAs: (
	url: string
) => Promise<{ cookies: string; userAgent: string; httpsOnly?: boolean } | null> = async () => null;

/** How many requests the challenged site has answered: `seen` has one entry each. */
const siteRequests = () => seen.length;

/** The fixtures, with their site's address written in (the vm context has no env to read). */
function plugin(
	name: 'good' | 'evil' | 'checked',
	globals: Record<string, string>,
	as: string = name
): string {
	const src = readFileSync(new URL(`./fixtures/lnreader/${name}.js`, import.meta.url), 'utf8');
	const prelude = Object.entries(globals)
		.map(([k, v]) => `globalThis.${k} = ${JSON.stringify(v)};`)
		.join('\n');
	const file = join(store, `${as}.js`);
	writeFileSync(file, `${prelude}\n${src}`);
	return file;
}

let good = '';
let evil = '';
let shut = '';
let missing = '';
let checked = '';
let cleared = '';

beforeAll(async () => {
	site = createServer((req, res) => {
		const u = new URL(req.url ?? '/', 'http://x');
		if (u.pathname === '/list')
			return res.end(
				`<a class="novel" href="/n/one">One ${u.searchParams.get('sort')} ${u.searchParams.get('latest') ?? ''}</a><a class="novel" href="/n/two">Two</a>`
			);
		if (u.pathname === '/search')
			return res
				.writeHead(200, { 'content-type': 'application/json' })
				.end(JSON.stringify([`${u.searchParams.get('q')}-a`, `${u.searchParams.get('q')}-b`]));
		// A redirect to another loopback port, which the host wasn't opened to.
		if (u.pathname === '/away')
			return res.writeHead(302, { location: `http://127.0.0.1:${otherPort}/` }).end();
		res.writeHead(404).end();
	});
	other = createServer((req, res) => res.end(`cookie=${req.headers.cookie ?? 'none'}`));
	challenged = createServer((req, res) => {
		const u = new URL(req.url ?? '/', 'http://x');
		seen.push({ cookie: req.headers.cookie ?? '', agent: req.headers['user-agent'] ?? '' });
		if (u.pathname === '/list') {
			// A Cloudflare challenge, and the same request once its clearance is sent.
			if (!/cf_clearance=ok/.test(req.headers.cookie ?? ''))
				return res
					.writeHead(403, { 'cf-mitigated': 'challenge', server: 'cloudflare' })
					.end('<html>Just a moment…</html>');
			return res
				.writeHead(200, { 'content-type': 'text/html' })
				.end('<a class="novel" href="/n/one">Cleared</a>');
		}
		// A check that is never passed, marked as Cloudflare marks one; the
		// headers every proxied response carries ride along for realism.
		if (u.pathname === '/always')
			return res
				.writeHead(403, {
					'cf-mitigated': 'challenge',
					'cf-ray': '8d0',
					server: 'cloudflare'
				})
				.end('<html>Just a moment…</html>');
		if (u.pathname === '/bodyonly') return res.writeHead(403).end('<b>__cf_chl</b>');
		// A site's own 403: no marker, so it is not the app's to solve.
		if (u.pathname === '/plain') return res.writeHead(403).end('go away');
		// A Cloudflare-fronted site's own 403: both of its headers, no challenge.
		if (u.pathname === '/plain-cf')
			return res
				.writeHead(403, { 'cf-ray': '9a1b2c3d4e5f-SJC', server: 'cloudflare' })
				.end('members only');
		// A hop to another host, which must not be sent the first host's clearance.
		if (u.pathname === '/away')
			return res.writeHead(302, { location: `http://localhost:${otherPort}/leak` }).end();
		res.writeHead(404).end();
	});
	await new Promise<void>((ok) => site.listen(0, '127.0.0.1', ok));
	await new Promise<void>((ok) => other.listen(0, '127.0.0.1', ok));
	await new Promise<void>((ok) => challenged.listen(0, '127.0.0.1', ok));
	port = (site.address() as AddressInfo).port;
	otherPort = (other.address() as AddressInfo).port;
	checkPort = (challenged.address() as AddressInfo).port;
	good = plugin('good', { SITE: `http://127.0.0.1:${port}/` });
	evil = plugin('evil', {
		LOOPBACK: `http://127.0.0.1:${otherPort}/`,
		REDIRECT: `http://127.0.0.1:${port}/away`
	});
	// The same plugin, its site on a port the host wasn't opened to, and on a path that 404s.
	shut = plugin('good', { SITE: `http://127.0.0.1:${otherPort}/` }, 'shut');
	missing = plugin('good', { SITE: `http://127.0.0.1:${port}/gone/` }, 'missing');
	checked = plugin('checked', { SITE: `http://127.0.0.1:${checkPort}/` });
	cleared = plugin('good', { SITE: `http://127.0.0.1:${checkPort}/` }, 'cleared');
	host = new NovelHost({
		store,
		allow: [`127.0.0.1:${port}`, `127.0.0.1:${checkPort}`, `localhost:${otherPort}`],
		timeoutMs: 15_000,
		solve: (url) => {
			solved.push(url);
			return solveAs(url);
		}
	});
});

afterAll(async () => {
	host.stop();
	site.closeAllConnections();
	other.closeAllConnections();
	challenged.closeAllConnections();
	await new Promise((ok) => site.close(ok));
	await new Promise((ok) => other.close(ok));
	await new Promise((ok) => challenged.close(ok));
	rmSync(store, { recursive: true, force: true });
});

describe('a plugin, through the host', () => {
	it('says what it is', async () => {
		expect(await host.info(good)).toMatchObject({
			id: 'good',
			name: 'Good Novels',
			version: '1.0.0',
			paged: false,
			filters: { sort: { type: 'Picker', value: 'new' } }
		});
	});

	it('lists, with its filters’ starting values, or the ones it is given', async () => {
		expect(await host.call(good, 'popularNovels', [1, {}])).toEqual([
			{ name: 'One new ', path: '/n/one', cover: '' },
			{ name: 'Two', path: '/n/two', cover: '' }
		]);
		const latest = await host.call<{ name: string }[]>(good, 'popularNovels', [
			2,
			{ showLatestNovels: true, filters: { sort: { type: 'Picker', value: 'top' } } }
		]);
		expect(latest[0].name).toBe('One top 1');
	});

	it('searches, parses a novel, and gives a chapter’s HTML', async () => {
		expect(await host.call(good, 'searchNovels', ['frieren', 1])).toEqual([
			{ name: 'frieren-a', path: '/n/frieren-a' },
			{ name: 'frieren-b', path: '/n/frieren-b' }
		]);
		expect(await host.call(good, 'parseNovel', ['/n/one'])).toMatchObject({
			status: 'Ongoing',
			chapters: [{ name: 'Chapter 1', path: '/n/one/1', releaseTime: '2026-10-28' }]
		});
		expect(await host.call(good, 'parseChapter', ['/n/one/1'])).toBe('<p>/n/one/1</p>');
	});
});

describe('a plugin whose site failed it', () => {
	// fetchText answers '' on failure, as LNReader's does, so the plugin answers
	// nothing: the host says why instead of an empty list.
	it('answers why, not an empty list', async () => {
		await expect(host.call(shut, 'popularNovels', [1, {}])).rejects.toThrow(
			/127\.0\.0\.1 is not on the internet/
		);
		await expect(host.call(missing, 'popularNovels', [1, {}])).rejects.toThrow(
			/127\.0\.0\.1 answered 404/
		);
	});

	it('keeps an answer that has something in it', async () => {
		expect(await host.call(missing, 'parseNovel', ['/n/one'])).toMatchObject({ name: 'A Novel' });
	});
});

describe('a site’s browser check', () => {
	// The host can't reach a solver (it refuses local addresses on purpose), so
	// it asks the app, which is the only thing that may (doc/NOVELS.md, c152).
	// The jar lives in the host process, so each test starts a fresh one: a
	// test that needs a clearance makes one with its own first challenged call.
	beforeEach(() => {
		host.stop();
		solved = [];
		seen = [];
		solveAs = async () => ({ cookies: 'cf_clearance=ok', userAgent: 'StubBrowser/1.0' });
	});

	it('reports a check the app wouldn’t solve, and stays alive', async () => {
		solveAs = async () => null;
		await expect(host.call(checked, 'parseChapter', ['/list'])).rejects.toThrow(
			/answered 403 \(its check could not be passed\)/
		);
		expect(solved).toEqual([`http://127.0.0.1:${checkPort}/list`]);
		expect(await host.call(good, 'parseChapter', ['/still'])).toBe('<p>/still</p>');
	});

	it('is solved by the app, named only by its URL, and the host retries with the clearance', async () => {
		expect(await host.call(cleared, 'popularNovels', [1, {}])).toEqual([
			{ name: 'Cleared', path: '/n/one', cover: '' }
		]);
		expect(solved).toEqual([`http://127.0.0.1:${checkPort}/list?page=1&sort=new`]);
		const last = seen[seen.length - 1];
		expect(last.cookie).toBe('cf_clearance=ok');
		expect(last.agent).toBe('StubBrowser/1.0');
	});

	it('keeps the jar per host: the next call asks for nothing', async () => {
		// The jar is this test's own: the first call is challenged and solved,
		// the second must then ask for nothing.
		await host.call(cleared, 'popularNovels', [1, {}]);
		expect(solved).toHaveLength(1);
		solved = [];
		await host.call(cleared, 'popularNovels', [1, {}]);
		expect(solved).toHaveLength(0);
	});

	it('sends the cookies to that host and to no other', async () => {
		// Make this host's jar with a first challenged-and-solved call; a
		// redirect to localhost — another host — must then arrive without it.
		expect(await host.call(cleared, 'popularNovels', [1, {}])).toHaveLength(1);
		expect(solved).toHaveLength(1);
		const n = await host.call<{ name: string }>(checked, 'parseNovel', ['/away']);
		expect(n.name).toBe('cookie=none');
		// And the jar was there: the request it redirected came with it.
		expect(seen[seen.length - 1].cookie).toBe('cf_clearance=ok');
		expect(solved).toHaveLength(1);
	});

	it('retries once, and reports a check it still can’t pass', async () => {
		// No jar exists before this call: the first request is challenged, the
		// solve sets one, and the one retry carries it.
		await expect(host.call(checked, 'parseChapter', ['/always'])).rejects.toThrow(
			/answered 403 \(its check could not be passed\)/
		);
		expect(solved).toHaveLength(1);
		expect(seen.map((s) => s.cookie)).toEqual(['', 'cf_clearance=ok']);
	});

	it('remembers a clearance its site refused: the next call is one request and no solve', async () => {
		// A hopeless host, as NovelFull and Scribble Hub measured: the solve
		// works and the site refuses the clearance anyway. The retry taught the
		// host that; a second chapter must not pay the solve and retry again.
		await expect(host.call(checked, 'parseChapter', ['/always'])).rejects.toThrow(
			/answered 403 \(its check could not be passed\)/
		);
		expect(solved).toHaveLength(1);
		expect(siteRequests()).toBe(2); // the request, then the retry with the clearance
		await expect(host.call(checked, 'parseChapter', ['/always'])).rejects.toThrow(
			/answered 403 \(its check could not be passed\)/
		);
		expect(solved).toHaveLength(1); // no second solve
		expect(siteRequests()).toBe(3); // one request: it was already a check, so no retry
	});

	it('forgets a refused clearance when TRY AGAIN asks, and only that site’s (c294)', async () => {
		// The memo's ten minutes are for a download's next chapter, not for
		// someone who just fixed the solver and pressed TRY AGAIN: forgetting
		// the site makes the next call pay one solve and one retry again.
		await expect(host.call(checked, 'parseChapter', ['/always'])).rejects.toThrow(
			/answered 403 \(its check could not be passed\)/
		);
		expect(solved).toHaveLength(1);
		expect(siteRequests()).toBe(2);
		// Another site's name forgets nothing.
		expect(await host.forgetRefused('elsewhere.example')).toBe(0);
		await expect(host.call(checked, 'parseChapter', ['/always'])).rejects.toThrow(
			/answered 403 \(its check could not be passed\)/
		);
		expect(solved).toHaveLength(1);
		expect(siteRequests()).toBe(3);
		expect(await host.forgetRefused('127.0.0.1')).toBe(1);
		await expect(host.call(checked, 'parseChapter', ['/always'])).rejects.toThrow(
			/answered 403 \(its check could not be passed\)/
		);
		expect(solved).toHaveLength(2); // solved afresh
		expect(siteRequests()).toBe(5); // the request and the retry, as the first time
		// And the site refusing again is remembered again.
		await expect(host.call(checked, 'parseChapter', ['/always'])).rejects.toThrow(
			/answered 403 \(its check could not be passed\)/
		);
		expect(solved).toHaveLength(2);
		expect(siteRequests()).toBe(6);
	});

	it('does not start a host only to forget what it never remembered (c294)', async () => {
		expect(await host.forgetRefused('127.0.0.1')).toBe(0);
		expect(solved).toEqual([]);
		expect(siteRequests()).toBe(0);
	});

	it('keeps a secure clearance off http, where it was never meant to go', async () => {
		// This site is http; FlareSolverr's clearance cookies are secure, so the
		// jar must not be sent in clear text. http stays reachable: it just gets
		// no clearance, and the check is reported as one that couldn't be passed.
		solveAs = async () => ({
			cookies: 'cf_clearance=ok',
			userAgent: 'StubBrowser/1.0',
			httpsOnly: true
		});
		await expect(host.call(checked, 'parseChapter', ['/list'])).rejects.toThrow(
			/answered 403 \(its check could not be passed\)/
		);
		expect(solved).toHaveLength(1);
		expect(seen.map((s) => s.cookie)).toEqual(['', '']);
	});

	it('names a check that is only in the body, and a plain 403 stays the site’s own answer', async () => {
		await expect(host.call(checked, 'parseChapter', ['/bodyonly'])).rejects.toThrow(
			/answered 403 \(its check could not be passed\)/
		);
		expect(solved).toHaveLength(1);
		await expect(host.call(checked, 'parseChapter', ['/plain'])).rejects.toThrow(/answered 403$/);
		expect(solved).toHaveLength(1);
	});

	it('leaves a Cloudflare site’s own 403 alone: its headers are not a marker', async () => {
		// Cloudflare adds cf-ray and server to every response it proxies, so a
		// members-only chapter or a maintenance page carries them too. Solving
		// one would spend 20–45 s on a check that was never there, and the
		// refused memo would then call the site's own 403 a check it failed.
		await expect(host.call(checked, 'parseChapter', ['/plain-cf'])).rejects.toThrow(
			/answered 403$/
		);
		expect(solved).toEqual([]);
		expect(siteRequests()).toBe(1);
	});
});

describe('a plugin trying to leave its box', () => {
	const refused = (what: string) => host.call(evil, 'parseChapter', [what]);

	it('can’t require what it isn’t given', async () => {
		await expect(refused('require-fs')).rejects.toThrow(/can't require fs/);
	});

	it('finds no environment, even out of the vm context', async () => {
		expect(await refused('env')).toBe('{}');
	});

	it('can’t read a file or start a process, even out of the vm context', async () => {
		await expect(refused('read')).rejects.toThrow(
			/Access to this API has been restricted|ERR_ACCESS_DENIED/
		);
		await expect(refused('spawn')).rejects.toThrow(/restricted|ERR_ACCESS_DENIED/);
	});

	it('can’t fetch a loopback address, directly or by redirect', async () => {
		await expect(refused('loopback')).rejects.toThrow(/not on the internet/);
		await expect(refused('redirect')).rejects.toThrow(/not on the internet/);
	});

	it('is an error the app catches, not a crash', async () => {
		await expect(refused('nonsense')).rejects.toBeInstanceOf(NovelHostError);
		// The host still answers after all of it.
		expect(await host.call(good, 'parseChapter', ['/still'])).toBe('<p>/still</p>');
	});
});

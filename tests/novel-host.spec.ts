import { isRefusedCheck } from '../src/routes/browse/[source]/refused-check';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { mkdtempSync, rmSync, writeFileSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { NovelHost, NovelHostError } from '$lib/server/novels/host';
import type { PageAnswer, PageRequest } from '$lib/server/novels/solver';

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

/**
 * Cloudflare's challenge page, as a browser and a Node fetch both receive it:
 * it loads the challenge platform's script, the marker a page carries when its
 * headers don't come with it (a page through the solver arrives without them).
 */
const CHALLENGE_PAGE =
	'<html><head><title>Just a moment…</title></head><body><script src="/cdn-cgi/challenge-platform/h/g/orchestrate/chl_page/v1"></script></body></html>';

/** The pages the app was asked for in page mode (c335), as the host asked them. */
let paged: PageRequest[] = [];
/** The agent the stub solver's browser sends: its requests are the browser's, not the host's. */
const BROWSER = 'SolverBrowser/1.0';

/**
 * The app's page through the solver, played by a browser: it carries the
 * cookie only a browser that solved the check has, follows redirects itself,
 * and answers with where it ended. `fetchPage` in solver.ts is the real one,
 * and tests/novel-solver.spec.ts its stubbed FlareSolverr.
 */
const browser = async (req: PageRequest): Promise<PageAnswer> => {
	const res = await fetch(req.url, {
		method: req.method,
		headers: {
			cookie: 'bound=browser',
			'user-agent': BROWSER,
			...(req.method === 'POST' ? { 'content-type': 'application/x-www-form-urlencoded' } : {})
		},
		body: req.method === 'POST' ? (req.postData ?? '') : undefined
	});
	return {
		page: {
			url: res.url,
			status: res.status,
			contentType: res.headers.get('content-type') ?? 'text/html',
			body: await res.text()
		}
	};
};
let pageAs: (req: PageRequest) => Promise<PageAnswer> = browser;

/** How many requests the challenged site has answered from the host itself: the browser's are not counted. */
const siteRequests = () => seen.filter((s) => s.agent !== BROWSER).length;
/** What the host itself sent, cookie by cookie. */
const hostCookies = () => seen.filter((s) => s.agent !== BROWSER).map((s) => s.cookie);

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
let bound = '';
let leaver = '';

/**
 * A plugin that asks for the workstation, directly and through a redirect:
 * evil.js's own requests sit behind its escape, which the sandbox now shuts.
 */
const LEAVER = `
var fetch = require('@libs/fetch');
exports.default = {
	id: 'leaver',
	name: 'Leaver',
	site: 'https://example.org/',
	version: '1.0.0',
	parseChapter: async function (what) {
		return (await fetch.fetchApi(what === 'loopback' ? globalThis.LOOPBACK : globalThis.REDIRECT)).status;
	}
};
`;

/**
 * A plugin for a site whose check is bound to the browser that solved it
 * (NovelFull's and Scribble Hub's shape), written inline: what it asks is what
 * page mode has to answer. A list whose links resolve against the page it came
 * from, a JSON search, a FormData POST built as Scribble Hub's chapter list
 * builds it (plugins/english/scribblehub.ts), which goes as a url-encoded form,
 * and the bodies the solver's browser can't send, a FormData holding a file
 * among them.
 */
const BOUND = `
var fetch = require('@libs/fetch');
var cheerio = require('cheerio');
function Bound() {
	this.id = 'bound';
	this.name = 'Bound Novels';
	this.site = globalThis.SITE;
	this.version = '1.0.0';
	this.filters = {};
}
Bound.prototype.popularNovels = async function (page) {
	var res = await fetch.fetchApi(this.site + 'bound/moved?page=' + page);
	var $ = cheerio.load(await res.text());
	return $('a.novel').map(function (_, a) {
		return { name: $(a).text(), path: new URL($(a).attr('href'), res.url).pathname, cover: res.url };
	}).get();
};
Bound.prototype.searchNovels = async function (term) {
	var res = await fetch.fetchApi(this.site + 'bound/api.json?q=' + encodeURIComponent(term));
	return (await res.json()).map(function (n) { return { name: n, path: '/n/' + n }; });
};
Bound.prototype.parseNovel = async function (path) {
	var formData = new FormData();
	formData.append('action', 'list');
	formData.append('id', path);
	var html = await fetch.fetchText(this.site + 'bound/form', { method: 'POST', body: formData });
	return { name: html, path: path, chapters: [] };
};
Bound.prototype.parseChapter = async function (path) {
	if (path === 'json-post')
		return fetch.fetchText(this.site + 'bound/form', {
			method: 'POST',
			headers: { 'content-type': 'application/json' },
			body: JSON.stringify({ id: 1 })
		});
	if (path === 'put') return fetch.fetchText(this.site + 'bound/form', { method: 'PUT', body: 'x=1' });
	// A chapter that is not the page it was asked about: some plugins read one
	// through an API, and there is no page address to resolve pictures against.
	if (path === 'api') return fetch.fetchText(this.site + 'plainapi.json?q=chapter');
	if (path === 'file') return fetch.fetchFile(this.site + 'bound/cover.jpg');
	if (path === 'form-file') {
		// The sandbox has no Blob of its own; a response's body is one a plugin can reach.
		var cover = await (await fetch.fetchApi(this.site + 'bound/chapter/cover')).blob();
		var withFile = new FormData();
		withFile.append('action', 'upload');
		withFile.append('cover', cover, 'cover.jpg');
		return fetch.fetchText(this.site + 'bound/form', { method: 'POST', body: withFile });
	}
	return fetch.fetchText(path.indexOf('http') === 0 ? path : this.site + path.slice(1));
};
exports.default = new Bound();
`;

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
	other = createServer((req, res) => {
		const u = new URL(req.url ?? '/', 'http://x');
		// The page a chapter moved to when another host kept its path (c631).
		if (u.pathname === '/moved/host/chapter/1')
			return res.writeHead(200, { 'content-type': 'text/html' }).end('<p>other host</p>');
		res.end(`cookie=${req.headers.cookie ?? 'none'}`);
	});
	challenged = createServer((req, res) => {
		const u = new URL(req.url ?? '/', 'http://x');
		seen.push({ cookie: req.headers.cookie ?? '', agent: req.headers['user-agent'] ?? '' });
		if (u.pathname === '/list') {
			// A Cloudflare challenge, and the same request once its clearance is sent.
			if (!/cf_clearance=ok/.test(req.headers.cookie ?? ''))
				return res
					.writeHead(403, { 'cf-mitigated': 'challenge', server: 'cloudflare' })
					.end(CHALLENGE_PAGE);
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
				.end(CHALLENGE_PAGE);
		if (u.pathname === '/bodyonly') return res.writeHead(403).end('<b>__cf_chl</b>');
		// A site's own 403: no marker, so it is not the app's to solve.
		if (u.pathname === '/plain') return res.writeHead(403).end('go away');
		// A Cloudflare-fronted site's own 403: both of its headers, no challenge.
		if (u.pathname === '/plain-cf')
			return res
				.writeHead(403, { 'cf-ray': '9a1b2c3d4e5f-SJC', server: 'cloudflare' })
				.end('members only');
		// A check bound to the browser that solved it (c335): the clearance the
		// host is handed is refused, and only the browser's own cookie passes.
		if (u.pathname.startsWith('/bound/')) {
			if (!/bound=browser/.test(req.headers.cookie ?? ''))
				return res
					.writeHead(403, { 'cf-mitigated': 'challenge', server: 'cloudflare' })
					.end(CHALLENGE_PAGE);
			if (u.pathname === '/bound/moved')
				return res.writeHead(302, { location: `/bound/deep/list${u.search}` }).end();
			if (u.pathname === '/bound/deep/list')
				return res
					.writeHead(200, { 'content-type': 'text/html' })
					.end(`<a class="novel" href="../n/one">Bound ${u.searchParams.get('page')}</a>`);
			if (u.pathname === '/bound/api.json')
				return res
					.writeHead(200, { 'content-type': 'application/json' })
					.end(JSON.stringify([`${u.searchParams.get('q')}-a`]));
			if (u.pathname === '/bound/form') {
				let raw = '';
				req.on('data', (c) => (raw += c));
				req.on('end', () =>
					res.writeHead(200, { 'content-type': 'text/html' }).end(`${req.method} ${raw}`)
				);
				return;
			}
			if (u.pathname === '/bound/always')
				return res.writeHead(403, { 'cf-mitigated': 'challenge' }).end(CHALLENGE_PAGE);
			// A chapter whose page moved: the solver's browser follows it and
			// answers the address it ended on (c631).
			if (u.pathname === '/bound/old/chapter/1')
				return res.writeHead(302, { location: '/bound/new/chapter/1' }).end();
			if (u.pathname === '/bound/new/chapter/1')
				return res.writeHead(200, { 'content-type': 'text/html' }).end('<p>moved chapter</p>');
			return res.writeHead(200, { 'content-type': 'text/html' }).end(`<p>${u.pathname}</p>`);
		}
		// A chapter this host itself follows a redirect for: the shape is a real
		// host's, measured on 2026-11-06 — wuxiaworld.com's apex answers
		// `301 location: https://www.wuxiaworld.com/novel/martial-god-asura/chapter-1`
		// for the same path on www (c631). One keeps the path on another host,
		// as that does; the other also moves the path, so the address and a
		// chapter's relative pictures differ.
		if (u.pathname === '/moved/host/chapter/1')
			return res
				.writeHead(301, { location: `http://localhost:${otherPort}/moved/host/chapter/1` })
				.end();
		if (u.pathname === '/moved/chapter/1')
			return res.writeHead(301, { location: '/moved/deep/chapter-1' }).end();
		if (u.pathname === '/moved/deep/chapter-1')
			return res.writeHead(200, { 'content-type': 'text/html' }).end('<p>moved, no check</p>');
		// A chapter asked with a space in its path: the URL names it encoded, and
		// the downloader's own spelling of the chapter is the encoded one (c631).
		if (u.pathname === '/moved/space/chapter%201')
			return res.writeHead(200, { 'content-type': 'text/html' }).end('<p>spaced chapter</p>');
		// A chapter a plugin reads through an API instead: no page address at all.
		if (u.pathname === '/plainapi.json')
			return res
				.writeHead(200, { 'content-type': 'application/json' })
				.end(JSON.stringify(['chapter-a']));
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
	bound = join(store, 'bound.js');
	writeFileSync(
		bound,
		`globalThis.SITE = ${JSON.stringify(`http://127.0.0.1:${checkPort}/`)};\n${BOUND}`
	);
	leaver = join(store, 'leaver.js');
	writeFileSync(
		leaver,
		`globalThis.LOOPBACK = ${JSON.stringify(`http://127.0.0.1:${otherPort}/`)};\n` +
			`globalThis.REDIRECT = ${JSON.stringify(`http://127.0.0.1:${port}/away`)};\n${LEAVER}`
	);
	host = new NovelHost(hostOpts());
});

/** The spec's host: its test ports, and the app's solve and page played by the stubs above. */
const hostOpts = (refusedMs?: number) => ({
	store,
	allow: [`127.0.0.1:${port}`, `127.0.0.1:${checkPort}`, `localhost:${otherPort}`],
	timeoutMs: 15_000,
	solve: (url: string) => {
		solved.push(url);
		return solveAs(url);
	},
	page: (req: PageRequest) => {
		paged.push(req);
		return pageAs(req);
	},
	...(refusedMs !== undefined ? { refusedMs } : {})
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

	it('gives a chapter and the address its request ended at, after a Node fetch’s redirect (c631)', async () => {
		// A Node fetch follows a host's redirect by hand, hop by hop, and this is
		// the last hop: the page a chapter's relative pictures belong to.
		expect(await host.chapter(bound, '/moved/chapter/1')).toEqual({
			html: '<p>moved, no check</p>',
			url: `http://127.0.0.1:${checkPort}/moved/deep/chapter-1`
		});
		// A request that ended where it asked is that address (which is what the
		// downloader computed itself before c631), and a plugin that asked the
		// site for something else answers null, so the caller falls back as it
		// always did.
		expect(await host.chapter(bound, '/moved/deep/chapter-1')).toEqual({
			html: '<p>moved, no check</p>',
			url: `http://127.0.0.1:${checkPort}/moved/deep/chapter-1`
		});
		expect(await host.chapter(bound, 'api')).toEqual({
			html: JSON.stringify(['chapter-a']),
			url: null
		});
	});

	it('gives the other host’s address when a redirect keeps the path and changes the host (c631)', async () => {
		// Wuxia World's apex → www `301` is the shape: the same path on another
		// host, so a root-relative picture belongs to that host, not this one.
		expect(await host.chapter(bound, '/moved/host/chapter/1')).toEqual({
			html: '<p>other host</p>',
			url: `http://localhost:${otherPort}/moved/host/chapter/1`
		});
	});

	it('matches a chapter the plugin spelled differently from its URL (c631)', async () => {
		// The plugin asks for `…/chapter 1`; the URL names the same page
		// `…/chapter%201`, which is how the downloader computes the chapter.
		expect(await host.chapter(bound, '/moved/space/chapter 1')).toEqual({
			html: '<p>spaced chapter</p>',
			url: `http://127.0.0.1:${checkPort}/moved/space/chapter%201`
		});
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
		paged = [];
		pageAs = browser;
		solveAs = async () => ({ cookies: 'cf_clearance=ok', userAgent: 'StubBrowser/1.0' });
	});

	it('reports a check the app wouldn’t solve, and stays alive', async () => {
		solveAs = async () => null;
		await expect(host.call(checked, 'parseChapter', ['/list'])).rejects.toThrow(
			/answered 403 \(its check could not be passed\)/
		);
		expect(solved).toEqual([`http://127.0.0.1:${checkPort}/list`]);
		// No clearance was refused, so nothing says the check is bound to a browser.
		expect(paged).toEqual([]);
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
		// solve sets one, and the one retry carries it. The retry still being a
		// check puts the host in page mode (c335), and this site refuses the
		// solver's browser too, so the call still reports the check.
		await expect(host.call(checked, 'parseChapter', ['/always'])).rejects.toThrow(
			/answered 403 \(its check could not be passed\)/
		);
		expect(solved).toHaveLength(1);
		expect(hostCookies()).toEqual(['', 'cf_clearance=ok']);
		expect(paged).toHaveLength(1);
	});

	it('remembers a clearance its site refused: the next call is no solve and no request of its own', async () => {
		// A hopeless host, as NovelFull and Scribble Hub measured: the solve
		// works and the site refuses the clearance anyway. The retry taught the
		// host that; a second chapter must not pay the solve and retry again.
		// Since c335 it goes as a page through the solver instead.
		await expect(host.call(checked, 'parseChapter', ['/always'])).rejects.toThrow(
			/answered 403 \(its check could not be passed\)/
		);
		expect(solved).toHaveLength(1);
		expect(siteRequests()).toBe(2); // the request, then the retry with the clearance
		expect(paged).toHaveLength(1);
		await expect(host.call(checked, 'parseChapter', ['/always'])).rejects.toThrow(
			/answered 403 \(its check could not be passed\)/
		);
		expect(solved).toHaveLength(1); // no second solve
		expect(siteRequests()).toBe(2); // and no request of its own: it would be a check
		expect(paged).toHaveLength(2); // one page
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
		expect(paged).toHaveLength(1);
		// Another site's name forgets nothing.
		expect(await host.forgetRefused('elsewhere.example')).toBe(0);
		await expect(host.call(checked, 'parseChapter', ['/always'])).rejects.toThrow(
			/answered 403 \(its check could not be passed\)/
		);
		expect(solved).toHaveLength(1);
		expect(siteRequests()).toBe(2);
		expect(paged).toHaveLength(2);
		expect(await host.forgetRefused('127.0.0.1')).toBe(1);
		await expect(host.call(checked, 'parseChapter', ['/always'])).rejects.toThrow(
			/answered 403 \(its check could not be passed\)/
		);
		expect(solved).toHaveLength(2); // solved afresh
		expect(siteRequests()).toBe(4); // the request and the retry, as the first time
		expect(paged).toHaveLength(3); // and the page, as the first time
		// And the site refusing again is remembered again.
		await expect(host.call(checked, 'parseChapter', ['/always'])).rejects.toThrow(
			/answered 403 \(its check could not be passed\)/
		);
		expect(solved).toHaveLength(2);
		expect(siteRequests()).toBe(4);
		expect(paged).toHaveLength(4);
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
		expect(hostCookies()).toEqual(['', '']);
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

describe('a check bound to the browser that solved it: page mode (c335)', () => {
	// NovelFull and Scribble Hub refuse the clearance they just issued to any
	// client but the solver's own browser (doc/NOVELS.md, measured 2026-11-02).
	// The `/bound/` paths here are that site: the host's retry with the
	// clearance is still a check, and only the browser stub's cookie passes.
	const SITE = () => `http://127.0.0.1:${checkPort}/`;
	const HOST = '127.0.0.1';
	const bounce = /page did not come through the solver \(its check could not be passed\)/;

	beforeEach(() => {
		host.stop();
		solved = [];
		seen = [];
		paged = [];
		pageAs = browser;
		solveAs = async () => ({ cookies: 'cf_clearance=ok', userAgent: 'StubBrowser/1.0' });
	});

	it('enters when the retry with a fresh clearance is still a check, and answers that same call through the solver', async () => {
		const list = await host.call<{ name: string; path: string; cover: string }[]>(
			bound,
			'popularNovels',
			[1, {}]
		);
		// The solve, the retry it refused, then the page: the call that taught the host is answered.
		expect(solved).toEqual([`${SITE()}bound/moved?page=1`]);
		expect(hostCookies()).toEqual(['', 'cf_clearance=ok']);
		expect(paged).toEqual([{ url: `${SITE()}bound/moved?page=1`, method: 'GET' }]);
		// The browser was redirected: the plugin's links resolve against where it
		// ended (/bound/deep/list), not the URL it asked (/bound/moved).
		expect(list).toEqual([
			{ name: 'Bound 1', path: '/bound/n/one', cover: `${SITE()}bound/deep/list?page=1` }
		]);
		expect(Object.keys(await host.pageHosts())).toEqual([HOST]);
	});

	it('stays out for every other check: one its clearance passes, one the app would not solve, and a plain 403', async () => {
		expect(await host.call(cleared, 'popularNovels', [1, {}])).toHaveLength(1);
		await expect(host.call(checked, 'parseChapter', ['/plain'])).rejects.toThrow(/answered 403$/);
		await expect(host.call(checked, 'parseChapter', ['/plain-cf'])).rejects.toThrow(
			/answered 403$/
		);
		host.stop();
		solveAs = async () => null;
		await expect(host.call(bound, 'parseChapter', ['/bound/chapter/1'])).rejects.toThrow(
			/answered 403 \(its check could not be passed\)$/
		);
		expect(paged).toEqual([]);
		expect(await host.pageHosts()).toEqual({});
	});

	it('then makes no request of its own and no solve: each chapter is one page', async () => {
		await host.call(bound, 'popularNovels', [1, {}]);
		expect(solved).toHaveLength(1);
		expect(siteRequests()).toBe(2);
		expect(await host.call(bound, 'parseChapter', ['/bound/chapter/1'])).toBe(
			'<p>/bound/chapter/1</p>'
		);
		expect(await host.call(bound, 'parseChapter', ['/bound/chapter/2'])).toBe(
			'<p>/bound/chapter/2</p>'
		);
		expect(solved).toHaveLength(1);
		expect(siteRequests()).toBe(2);
		expect(paged.map((r) => r.url)).toEqual([
			`${SITE()}bound/moved?page=1`,
			`${SITE()}bound/chapter/1`,
			`${SITE()}bound/chapter/2`
		]);
	});

	it('enters once for two calls challenged together, and answers both', async () => {
		const [a, b] = await Promise.all([
			host.call(bound, 'parseChapter', ['/bound/chapter/1']),
			host.call(bound, 'parseChapter', ['/bound/chapter/2'])
		]);
		expect([a, b]).toEqual(['<p>/bound/chapter/1</p>', '<p>/bound/chapter/2</p>']);
		expect(solved).toHaveLength(1);
		expect(paged).toHaveLength(2);
	});

	it('gives a page-mode chapter the address the browser ended on, after its redirect (c631)', async () => {
		await host.call(bound, 'popularNovels', [1, {}]);
		expect(await host.chapter(bound, '/bound/old/chapter/1')).toEqual({
			html: '<p>moved chapter</p>',
			url: `${SITE()}bound/new/chapter/1`
		});
	});

	it('asks the chapter’s page once, and gives the same address a Node fetch would (c631)', async () => {
		await host.call(bound, 'popularNovels', [1, {}]);
		const before = paged.length;
		expect(await host.chapter(bound, '/bound/chapter/1')).toEqual({
			html: '<p>/bound/chapter/1</p>',
			url: `${SITE()}bound/chapter/1`
		});
		expect(paged).toHaveLength(before + 1);
	});

	it('hands a JSON answer over as JSON, and posts a FormData of strings as a url-encoded form', async () => {
		await host.call(bound, 'popularNovels', [1, {}]);
		expect(await host.call(bound, 'searchNovels', ['frieren', 1])).toEqual([
			{ name: 'frieren-a', path: '/n/frieren-a' }
		]);
		expect(await host.call(bound, 'parseNovel', ['/n/one'])).toMatchObject({
			name: 'POST action=list&id=%2Fn%2Fone'
		});
		expect(paged.slice(1)).toEqual([
			{ url: `${SITE()}bound/api.json?q=frieren`, method: 'GET' },
			{ url: `${SITE()}bound/form`, method: 'POST', postData: 'action=list&id=%2Fn%2Fone' }
		]);
	});

	it('refuses with a sentence what the solver’s browser can’t send or hand back, and asks nothing for it', async () => {
		await host.call(bound, 'popularNovels', [1, {}]);
		await expect(host.call(bound, 'parseChapter', ['json-post'])).rejects.toThrow(
			/posts a url-encoded form only, not application\/json/
		);
		await expect(host.call(bound, 'parseChapter', ['put'])).rejects.toThrow(
			/sends GET and POST only, not PUT/
		);
		await expect(host.call(bound, 'parseChapter', ['file'])).rejects.toThrow(
			/a file is not a page, and the solver's browser hands back pages only/
		);
		expect(paged).toHaveLength(1);
		expect(siteRequests()).toBe(2);
	});

	it('refuses a FormData holding a file with its own sentence, and asks no page for it', async () => {
		await host.call(bound, 'popularNovels', [1, {}]);
		await expect(host.call(bound, 'parseChapter', ['form-file'])).rejects.toThrow(
			/posts a url-encoded form only, and a file can't go in one/
		);
		// The page the plugin took its file from, and no POST after it.
		expect(paged.map((r) => r.method)).toEqual(['GET', 'GET']);
		expect(siteRequests()).toBe(2);
	});

	it('words a shape refusal without a failed check, so TRY AGAIN keeps the memos', async () => {
		await host.call(bound, 'popularNovels', [1, {}]);
		for (const path of ['put', 'json-post', 'file', 'form-file']) {
			const call = host.call(bound, 'parseChapter', [path]);
			await expect(call).rejects.toThrow(/127\.0\.0\.1's page can't come through the solver: /);
			await expect(call).rejects.not.toThrow(/its check could not be passed/);
		}
		for (const error of [
			'the solver answered 500 (Error solving the challenge. Timeout after 50.0 seconds.)',
			"the solver's browser closed twice (Error: invalid session id: session deleted as the browser has closed the connection)"
		]) {
			pageAs = async () => ({ error });
			await expect(host.call(bound, 'parseChapter', ['/bound/chapter/1'])).rejects.toThrow(
				/its check could not be passed/
			);
		}
		expect(paged.filter((r) => r.method === 'POST')).toEqual([]);
	});

	it('does not claim a failed check for a page the app refused for good (c630)', async () => {
		await host.call(bound, 'popularNovels', [1, {}]);
		// The app's own `fetchPage` marks a refusal no new solve can change: a
		// picture where a page was asked for, an address off the internet. Its
		// words reach the host here; the browse page reads the phrase below.
		pageAs = async (req) => ({
			error: `${new URL(req.url).hostname} sent a picture, not a page: the solver's browser hands back pages only`,
			fixed: true
		});
		const call = host.call(bound, 'parseChapter', ['/bound/chapter/1']);
		await expect(call).rejects.toThrow(
			/127\.0\.0\.1's page can't come through the solver, and no solve changes that: /
		);
		// Wave 26's lesson: this phrase is what the browse page's TRY AGAIN
		// reads to forget both memos. A picture is not a check that failed.
		await expect(call).rejects.not.toThrow(/its check could not be passed/);
		// Still in page mode, and nothing solved: the next chapter is one page.
		expect(Object.keys(await host.pageHosts())).toEqual([HOST]);
		expect(solved).toHaveLength(1);
		pageAs = browser;
		expect(await host.call(bound, 'parseChapter', ['/bound/chapter/2'])).toBe(
			'<p>/bound/chapter/2</p>'
		);
		expect(solved).toHaveLength(1);
		expect(siteRequests()).toBe(2);
	});

	it('words a failed final lookup without the check phrase, and TRY AGAIN pays no solve (c688)', async () => {
		await host.call(bound, 'popularNovels', [1, {}]);
		const why =
			"the solver's browser ended at lost.example, and its address could not be checked (getaddrinfo ENOTFOUND lost.example)";
		// `fetchPage`'s own answer for this state (tests/novel-solver.spec.ts).
		pageAs = async () => ({ error: why, unchecked: true });
		const sentence = () =>
			host.call(bound, 'parseChapter', ['/bound/chapter/1']).then(
				() => {
					throw new Error('the page was answered');
				},
				(e: Error) => e.message
			);
		const first = await sentence();
		expect(first).toContain(`127.0.0.1's page was fetched and not used: ${why}`);
		// The band's own reader (src/routes/browse/[source]/+page.svelte): no
		// TRY AGAIN SOLVES THE CHECK AFRESH, and no `again=1` to forget the memos.
		expect(first).not.toMatch(/its check could not be passed/);
		expect(isRefusedCheck(first)).toBe(false);
		// The same refusal again says the same.
		expect(await sentence()).toBe(first);
		// A TRY AGAIN is one more page, once the lookup answers: still in page
		// mode, and no solve paid for what was this app's own DNS.
		pageAs = browser;
		expect(await host.call(bound, 'parseChapter', ['/bound/chapter/2'])).toBe(
			'<p>/bound/chapter/2</p>'
		);
		expect(solved).toHaveLength(1);
		// The reader still answers for the sentences that are a refused check.
		pageAs = async () => ({ error: 'the solver did not answer in 60 s' });
		expect(isRefusedCheck(await sentence())).toBe(true);
		pageAs = browser;
	});

	it('says an address it could not look up as unsent, not as a failed check (c630)', async () => {
		await host.call(bound, 'popularNovels', [1, {}]);
		// `fetchPage`'s own lookup failed (EAI_AGAIN): the browser was never
		// asked, so this is the unsent family. TRY AGAIN asks the lookup again
		// instead of forgetting the memos for a solve that cannot help a name
		// that did not resolve.
		pageAs = async () => ({
			error: 'the address could not be checked (getaddrinfo EAI_AGAIN 127.0.0.1)',
			unsent: true
		});
		const call = host.call(bound, 'parseChapter', ['/bound/chapter/1']);
		await expect(call).rejects.toThrow(
			/127\.0\.0\.1's page can't come through the solver: the address could not be checked \(getaddrinfo EAI_AGAIN 127\.0\.0\.1\)/
		);
		await expect(call).rejects.not.toThrow(/its check could not be passed/);
		await expect(call).rejects.not.toThrow(/no solve changes that/);
		expect(solved).toHaveLength(1);
		pageAs = browser;
		expect(await host.call(bound, 'parseChapter', ['/bound/chapter/2'])).toBe(
			'<p>/bound/chapter/2</p>'
		);
		expect(solved).toHaveLength(1);
	});

	it('says why a page didn’t come — the solver’s 500, its browser dying, a timeout — and stays in page mode', async () => {
		await host.call(bound, 'popularNovels', [1, {}]);
		for (const error of [
			'the solver answered 500 (Error solving the challenge. Timeout after 50.0 seconds.)',
			"the solver's browser closed twice (Error: invalid session id: session deleted as the browser has closed the connection)",
			'the solver did not answer in 60 s'
		]) {
			pageAs = async () => ({ error });
			const call = host.call(bound, 'parseChapter', ['/bound/chapter/1']);
			await expect(call).rejects.toThrow(bounce);
			await expect(call).rejects.toThrow(error);
		}
		// Still in page mode: the next chapter is a page again, not a solve.
		pageAs = browser;
		expect(await host.call(bound, 'parseChapter', ['/bound/chapter/2'])).toBe(
			'<p>/bound/chapter/2</p>'
		);
		expect(solved).toHaveLength(1);
		expect(siteRequests()).toBe(2);
		expect(paged).toHaveLength(5);
	});

	it('reports a page that is still a check as one, and a site’s own error as its own', async () => {
		await host.call(bound, 'popularNovels', [1, {}]);
		await expect(host.call(bound, 'parseChapter', ['/bound/always'])).rejects.toThrow(
			/answered 403 \(its check could not be passed\)$/
		);
		pageAs = async (req) => ({
			page: { url: req.url, status: 404, contentType: 'text/html', body: 'gone' }
		});
		await expect(host.call(bound, 'parseChapter', ['/bound/gone'])).rejects.toThrow(
			/127\.0\.0\.1 answered 404$/
		);
	});

	it('doesn’t widen the host’s own rule: a port it wasn’t opened to is refused before any page is asked', async () => {
		await host.call(bound, 'popularNovels', [1, {}]);
		expect(Object.keys(await host.pageHosts())).toEqual([HOST]);
		// Same host name, in page mode, but a port the spec never opened.
		await expect(
			host.call(bound, 'parseChapter', [`http://127.0.0.1:${otherPort}/x`])
		).rejects.toThrow(/127\.0\.0\.1 is not on the internet/);
		expect(paged).toHaveLength(1);
		// And a page the browser ended on a local address it wasn't opened to is not read.
		pageAs = async () => ({
			page: {
				url: `http://127.0.0.1:${otherPort}/inside`,
				status: 200,
				contentType: 'text/html',
				body: 'secret'
			}
		});
		await expect(host.call(bound, 'parseChapter', ['/bound/chapter/1'])).rejects.toThrow(
			/127\.0\.0\.1 is not on the internet/
		);
	});

	it('is ten minutes from the refusal', async () => {
		const before = Date.now();
		await host.call(bound, 'popularNovels', [1, {}]);
		const until = (await host.pageHosts())[HOST];
		expect(until).toBeGreaterThanOrEqual(before + 10 * 60_000);
		expect(until).toBeLessThanOrEqual(Date.now() + 10 * 60_000);
	});

	it('leaves when TRY AGAIN forgets the site, or the host restarts: the next call is its own again', async () => {
		await host.call(bound, 'popularNovels', [1, {}]);
		expect(await host.forgetRefused('127.0.0.1')).toBe(1);
		expect(await host.pageHosts()).toEqual({});
		await host.call(bound, 'parseChapter', ['/bound/chapter/1']);
		// A request, the solve, the refused retry, and the page: as the first time.
		expect(solved).toHaveLength(2);
		expect(siteRequests()).toBe(4);
		expect(paged).toHaveLength(2);
		host.stop();
		expect(await host.pageHosts()).toEqual({});
		await host.call(bound, 'parseChapter', ['/bound/chapter/2']);
		expect(solved).toHaveLength(3);
		expect(siteRequests()).toBe(6);
		expect(paged).toHaveLength(3);
	});

	it('leaves when its time is up, not extended by use, and the next call pays a solve and a retry again', async () => {
		const quick = new NovelHost(hostOpts(1_500));
		try {
			await quick.call(bound, 'popularNovels', [1, {}]);
			const until = (await quick.pageHosts())[HOST];
			expect(until).toEqual(expect.any(Number));
			// Used inside the window, which doesn't move it.
			await quick.call(bound, 'parseChapter', ['/bound/chapter/1']);
			expect((await quick.pageHosts())[HOST]).toBe(until);
			expect(siteRequests()).toBe(2);
			await expect.poll(() => quick.pageHosts(), { timeout: 5_000 }).toEqual({});
			await quick.call(bound, 'parseChapter', ['/bound/chapter/2']);
			expect(solved).toHaveLength(2);
			expect(siteRequests()).toBe(4);
			expect(paged).toHaveLength(3);
			expect(Object.keys(await quick.pageHosts())).toEqual([HOST]);
		} finally {
			quick.stop();
		}
	});

	it('answers a page the app has no solver for with a sentence, not a silence', async () => {
		const bare = new NovelHost({ ...hostOpts(), page: undefined });
		try {
			await expect(bare.call(bound, 'parseChapter', ['/bound/chapter/1'])).rejects.toThrow(
				/this app has no solver to fetch a page through/
			);
		} finally {
			bare.stop();
		}
	});
});

describe('a plugin trying to leave its box', () => {
	const refused = (what: string) => host.call(evil, 'parseChapter', [what]);

	it('can’t require what it isn’t given', async () => {
		await expect(refused('require-fs')).rejects.toThrow(/can't require fs/);
	});

	it('can’t get out of the vm context through a host function’s constructor', async () => {
		// What the process would still refuse it, had it got out, is
		// tests/novel-sandbox.spec.ts's, which runs code under the host's flags.
		for (const what of ['env', 'read', 'spawn'])
			await expect(refused(what)).rejects.toThrow(/can't compile code outside its sandbox/);
	});

	it('can’t fetch a loopback address, directly or by redirect', async () => {
		await expect(host.call(leaver, 'parseChapter', ['loopback'])).rejects.toThrow(
			/not on the internet/
		);
		await expect(host.call(leaver, 'parseChapter', ['redirect'])).rejects.toThrow(
			/not on the internet/
		);
	});

	it('is an error the app catches, not a crash', async () => {
		await expect(refused('nonsense')).rejects.toBeInstanceOf(NovelHostError);
		// The host still answers after all of it.
		expect(await host.call(good, 'parseChapter', ['/still'])).toBe('<p>/still</p>');
	});
});

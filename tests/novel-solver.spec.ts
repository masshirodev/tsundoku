import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';

// The app's half of a site's browser check (doc/NOVELS.md, "Past a site's bot
// check"; card c152): the host names a URL, the app checks it is on the
// internet, asks a solver, and answers with that host's clearance only.
process.env.DATABASE_PATH = ':memory:';

// Names resolve as the stub says, so a checked address's fate is the test's.
const ADDRESSES: Record<string, string[]> = {
	'www.novel.example': ['93.184.215.14'],
	'novel.example': ['93.184.215.14'],
	'other.example': ['93.184.215.15'],
	'inside.example': ['10.0.0.5'],
	'mixed.example': ['93.184.215.14', '127.0.0.1']
};
vi.mock('node:dns/promises', () => ({
	lookup: async (host: string) => {
		// Names whose lookup fails as a transient DNS error does, before
		// the browser is asked and after it answers.
		if (host === 'flaky.example' || host === 'lost.example') {
			const code = host === 'flaky.example' ? 'EAI_AGAIN' : 'ENOTFOUND';
			throw Object.assign(new Error(`getaddrinfo ${code} ${host}`), { code });
		}
		return (ADDRESSES[host] ?? []).map((address) => ({
			address,
			family: address.includes(':') ? 6 : 4
		}));
	}
}));

const { getDb } = await import('$lib/server/db');
const {
	fetchPage,
	forgetFailedSolve,
	forgetFailedSolves,
	novelSolverUrl,
	solveChallenge,
	solvingSince,
	unwrapText
} = await import('$lib/server/novels/solver');

type Asked = { cmd?: string; url?: string; maxTimeout?: number; postData?: string };
let asked: Asked[] = [];
let reply: (a: Asked) => { status: number; body: string } = () => ({ status: 200, body: ok() });
let delay = 0;
/** Requests the stub is answering right now, and the most at once: one browser per host. */
let open = 0;
let most = 0;
let server: Server;
let port = 0;

const ok = (solution: Record<string, unknown> = {}) =>
	JSON.stringify({
		status: 'ok',
		message: 'ok',
		solution: {
			url: 'https://www.novel.example/',
			status: 200,
			userAgent: 'StubBrowser/2.0',
			cookies: [
				{ name: 'cf_clearance', value: 'yes', domain: '.novel.example', secure: true },
				{ name: 'session', value: 'abc', domain: 'www.novel.example' },
				{ name: 'theirs', value: 'no', domain: '.other.example' },
				{ name: 'nowhere', value: 'no' }
			],
			...solution
		}
	});

beforeAll(async () => {
	server = createServer((req, res) => {
		let raw = '';
		req.on('data', (c) => (raw += c));
		req.on('end', () => {
			const one = JSON.parse(raw) as Asked;
			asked.push(one);
			open++;
			most = Math.max(most, open);
			const send = () => {
				open--;
				const r = reply(one);
				res.writeHead(r.status, { 'content-type': 'application/json' }).end(r.body);
			};
			if (delay) setTimeout(send, delay);
			else send();
		});
	});
	await new Promise<void>((ok) => server.listen(0, '127.0.0.1', ok));
	port = (server.address() as AddressInfo).port;
	process.env.NOVEL_SOLVER_URL = `http://127.0.0.1:${port}/v1`;
});

afterAll(async () => {
	server.closeAllConnections();
	await new Promise((ok) => server.close(ok));
});

beforeEach(() => {
	asked = [];
	delay = 0;
	open = 0;
	most = 0;
	reply = () => ({ status: 200, body: ok() });
	forgetFailedSolves();
	getDb().prepare(`DELETE FROM site_checks`).run();
});

const checked = () =>
	getDb().prepare(`SELECT host, seen_at FROM site_checks ORDER BY host`).all() as {
		host: string;
		seen_at: number;
	}[];

describe('the app’s solve for a site’s check', () => {
	it('asks the solver and answers with that host’s cookies and user agent, and nothing else', async () => {
		const c = await solveChallenge('https://www.novel.example/a/chapter');
		expect(c).toEqual({
			cookies: 'cf_clearance=yes; session=abc',
			userAgent: 'StubBrowser/2.0',
			httpsOnly: true
		});
		expect(asked).toEqual([
			{ cmd: 'request.get', url: 'https://www.novel.example/a/chapter', maxTimeout: 50_000 }
		]);
		// The host is BROWSE's past-tense line once it has passed the check.
		expect(checked()).toEqual([{ host: 'www.novel.example', seen_at: expect.any(Number) }]);
	});

	it('is https-only when one of its own cookies is secure, and only then', async () => {
		// A Cookie header can't carry one cookie over http and another over https,
		// so one secure cookie makes the whole jar https-only (novels/host.ts).
		reply = () => ({
			status: 200,
			body: ok({
				cookies: [{ name: 'cf_clearance', value: 'yes', domain: '.novel.example', secure: true }]
			})
		});
		expect(await solveChallenge('https://www.novel.example/')).toMatchObject({ httpsOnly: true });
		// Another host's secure cookie was dropped above, so it doesn't count here.
		reply = () => ({
			status: 200,
			body: ok({
				cookies: [
					{ name: 'theirs', value: 'no', domain: '.other.example', secure: true },
					{ name: 'plain', value: 'yes', domain: '.novel.example' }
				]
			})
		});
		expect(await solveChallenge('https://www.novel.example/again')).toMatchObject({
			cookies: 'plain=yes',
			httpsOnly: false
		});
	});

	it('refuses a loopback or private address before the solver hears of it', async () => {
		for (const url of [
			'http://127.0.0.1:8191/v1',
			'http://[::1]/',
			'https://inside.example/',
			'https://mixed.example/',
			'https://unknown.example/',
			'file:///etc/passwd',
			'not a url'
		])
			expect(await solveChallenge(url), url).toBeNull();
		expect(asked).toEqual([]);
	});

	it('is one solve per host: a second ask while it runs waits on the first', async () => {
		delay = 30;
		const [a, b] = await Promise.all([
			solveChallenge('https://www.novel.example/one'),
			solveChallenge('https://www.novel.example/two')
		]);
		expect(a).toEqual(b);
		expect(asked).toHaveLength(1);
	});

	it('says a solve is underway, matching subdomains, until it answers', async () => {
		delay = 40;
		const pending = solveChallenge('https://www.novel.example/slow');
		await new Promise((ok) => setTimeout(ok, 10));
		expect(solvingSince('novel.example')).toEqual(expect.any(Number));
		expect(solvingSince('www.novel.example')).toEqual(expect.any(Number));
		expect(solvingSince('elsewhere.example')).toBeNull();
		await pending;
		expect(solvingSince('novel.example')).toBeNull();
	});

	it('answers nothing when the solver fails, does not remember it, and writes no check', async () => {
		// A 200 carrying `status: 'error'` is a shape FlareSolverr does not send
		// (it sends that body as an HTTP 500, below), but Byparr speaks the same
		// protocol, and a proxy or a wrong NOVEL_SOLVER_URL answers 200 with HTML.
		// None of them is the shape the memo exists for: each next call asks
		// again, with no `forgetFailedSolves()` between them.
		reply = () => ({ status: 200, body: JSON.stringify({ status: 'error', message: 'nope' }) });
		expect(await solveChallenge('https://www.novel.example/')).toBeNull();
		expect(asked).toHaveLength(1);
		expect(await solveChallenge('https://www.novel.example/')).toBeNull();
		expect(asked).toHaveLength(2);
		reply = () => ({ status: 500, body: '{}' });
		expect(await solveChallenge('https://www.novel.example/')).toBeNull();
		expect(asked).toHaveLength(3);
		reply = () => ({ status: 200, body: 'not json' });
		expect(await solveChallenge('https://www.novel.example/')).toBeNull();
		expect(asked).toHaveLength(4);
		reply = () => ({ status: 200, body: JSON.stringify({ status: 'ok' }) });
		expect(await solveChallenge('https://www.novel.example/')).toBeNull();
		expect(await solveChallenge('https://www.novel.example/')).toBeNull();
		expect(asked).toHaveLength(6);
		expect(checked()).toEqual([]);
	});

	it('answers nothing when the page it fetched was refused, and writes no check', async () => {
		// FlareSolverr's browser reached the site and the site still said 403:
		// an answer that can carry cookies and a user agent, but no clearance.
		reply = () => ({ status: 200, body: ok({ status: 403 }) });
		expect(await solveChallenge('https://www.novel.example/')).toBeNull();
		expect(checked()).toEqual([]);
	});

	it('remembers a host the solve answered for and the site still refused, so one session solves it once', async () => {
		// The shape the memo exists for: the solver's browser fetched the page
		// and the site answered 403, so `ask` returns null and `solveOne`
		// remembers the host.
		reply = () => ({ status: 200, body: ok({ status: 403 }) });
		expect(await solveChallenge('https://www.novel.example/one')).toBeNull();
		expect(asked).toHaveLength(1);
		// A download asks chapter by chapter; the second must not wait 20-45 s
		// on a solve that just failed.
		expect(await solveChallenge('https://www.novel.example/two')).toBeNull();
		expect(asked).toHaveLength(1);
	});

	it('does not remember a solver’s own failure, which FlareSolverr sends as an HTTP 500', async () => {
		// Measured 2026-11-02: FlareSolverr 3.4.6 answers a solve it could not
		// produce as `{"status":"error",...}` **with HTTP 500** (the capture is
		// temp/fs-rrs.json, a 60.59 s round trip). `ask` throws on `!res.ok`, so
		// no memo is written: a solver's trouble says nothing about the host, and
		// the next call asks again rather than being ignored for ten minutes.
		reply = () => ({
			status: 500,
			body: JSON.stringify({ status: 'error', message: 'Error solving the challenge' })
		});
		expect(await solveChallenge('https://www.novel.example/one')).toBeNull();
		expect(asked).toHaveLength(1);
		expect(await solveChallenge('https://www.novel.example/two')).toBeNull();
		expect(asked).toHaveLength(2);
		// A solver it could not reach is the same kind of failure: not remembered.
		forgetFailedSolves();
		process.env.NOVEL_SOLVER_URL = 'http://127.0.0.1:1/v1';
		try {
			expect(await solveChallenge('https://www.novel.example/three')).toBeNull();
		} finally {
			process.env.NOVEL_SOLVER_URL = `http://127.0.0.1:${port}/v1`;
		}
		expect(asked).toHaveLength(2);
		reply = () => ({ status: 200, body: ok() });
		expect(await solveChallenge('https://www.novel.example/four')).not.toBeNull();
		expect(asked).toHaveLength(3);
	});

	it('remembers a solve that carried no clearance at all, the memo’s other shape', async () => {
		reply = () => ({ status: 200, body: ok({ cookies: [], userAgent: '' }) });
		expect(await solveChallenge('https://www.novel.example/one')).toBeNull();
		expect(await solveChallenge('https://www.novel.example/two')).toBeNull();
		expect(asked).toHaveLength(1);
	});

	it('forgets one site’s memo when TRY AGAIN asks, and no other’s', async () => {
		reply = () => ({ status: 200, body: ok({ status: 403 }) });
		expect(await solveChallenge('https://www.novel.example/one')).toBeNull();
		expect(await solveChallenge('https://other.example/one')).toBeNull();
		expect(asked).toHaveLength(2);
		forgetFailedSolve('novel.example');
		expect(await solveChallenge('https://other.example/two')).toBeNull();
		expect(asked).toHaveLength(2);
		reply = () => ({ status: 200, body: ok() });
		expect(await solveChallenge('https://www.novel.example/two')).not.toBeNull();
		expect(asked).toHaveLength(3);
	});

	it('answers nothing when the solver can’t be reached', async () => {
		process.env.NOVEL_SOLVER_URL = 'http://127.0.0.1:1/v1';
		try {
			expect(await solveChallenge('https://www.novel.example/')).toBeNull();
		} finally {
			process.env.NOVEL_SOLVER_URL = `http://127.0.0.1:${port}/v1`;
		}
	});
});

/** FlareSolverr's answer to a request.get or request.post: the page its browser ended on. */
const page = (response: string, solution: Record<string, unknown> = {}) =>
	JSON.stringify({
		status: 'ok',
		message: '',
		solution: {
			url: 'https://www.novel.example/',
			status: 200,
			headers: {},
			response,
			cookies: [],
			userAgent: 'StubBrowser/2.0',
			...solution
		}
	});

/** How Chromium shows a document that isn't HTML, which is what FlareSolverr hands back. */
const wrapped = (text: string, json = false) =>
	`<html><head><meta name="color-scheme" content="light dark">${json ? '<meta charset="utf-8">' : ''}</head><body><pre${json ? '' : ' style="word-wrap: break-word; white-space: pre-wrap;"'}>${text}</pre>${json ? '<div class="json-formatter-container"></div>' : ''}</body></html>`;

describe('a page through the solver’s browser', () => {
	// For a host whose check is bound to the browser that solved it, the host
	// asks for the page, not a clearance. The stub answers as FlareSolverr 3.4.6
	// does: the browser's DOM, its status, the URL it ended on after redirects,
	// a JSON or text document wrapped in Chromium's <pre>, a picture as
	// Chromium's image page, its own failure as an HTTP 500, and Chromium dying
	// under load as "invalid session id".
	const BODY = '<html><head></head><body><a href="next">Next</a></body></html>';

	it('is the page the browser ended on, after its redirects, with that URL to resolve against', async () => {
		reply = () => ({
			status: 200,
			body: page(BODY, { url: 'https://www.novel.example/moved/chapter-1' })
		});
		const got = await fetchPage({ url: 'https://www.novel.example/c/1' });
		expect(got).toEqual({
			page: {
				url: 'https://www.novel.example/moved/chapter-1',
				status: 200,
				contentType: 'text/html; charset=utf-8',
				body: BODY
			}
		});
		expect(asked).toEqual([
			{ cmd: 'request.get', url: 'https://www.novel.example/c/1', maxTimeout: 50_000 }
		]);
		// A relative link on it is the moved page's, not the asked one's.
		expect(new URL('next', (got as { page: { url: string } }).page.url).href).toBe(
			'https://www.novel.example/moved/next'
		);
		// The browser passed the host's check: BROWSE's past-tense line.
		expect(checked()).toEqual([{ host: 'www.novel.example', seen_at: expect.any(Number) }]);
	});

	it('unwraps a JSON or text document from Chromium’s <pre>, and keeps a page that only looks like one', async () => {
		reply = () => ({ status: 200, body: page(wrapped('{"a":"&lt;b&gt; &amp; c"}', true)) });
		expect(await fetchPage({ url: 'https://www.novel.example/api.json' })).toMatchObject({
			page: { contentType: 'application/json', body: '{"a":"<b> & c"}' }
		});
		reply = () => ({ status: 200, body: page(wrapped('plain &amp; simple&#33;')) });
		expect(await fetchPage({ url: 'https://www.novel.example/robots.txt' })).toMatchObject({
			page: { contentType: 'text/plain', body: 'plain & simple!' }
		});
		// A real page with a <pre> among other things is HTML, untouched.
		const html = '<html><head></head><body><h1>x</h1><pre>&lt;code&gt;</pre></body></html>';
		reply = () => ({ status: 200, body: page(html) });
		expect(await fetchPage({ url: 'https://www.novel.example/code' })).toMatchObject({
			page: { contentType: 'text/html; charset=utf-8', body: html }
		});
		// A normaliser holds on its own output: unwrapping what it unwrapped changes nothing.
		expect(unwrapText('{"a":"<b> & c"}')).toBeNull();
	});

	it('posts only a url-encoded form, which is all request.post sends, and refuses other methods unasked', async () => {
		reply = () => ({ status: 200, body: page('<html><head></head><body>ok</body></html>') });
		expect(
			await fetchPage({
				url: 'https://www.novel.example/wp-admin/admin-ajax.php',
				method: 'post',
				postData: 'action=list&id=7'
			})
		).toMatchObject({ page: { status: 200 } });
		expect(asked).toEqual([
			{
				cmd: 'request.post',
				url: 'https://www.novel.example/wp-admin/admin-ajax.php',
				maxTimeout: 50_000,
				postData: 'action=list&id=7'
			}
		]);
		expect(await fetchPage({ url: 'https://www.novel.example/x', method: 'PUT' })).toEqual({
			error: "the solver's browser sends GET and POST only, not PUT",
			fixed: true
		});
		expect(asked).toHaveLength(1);
	});

	it('refuses a picture: what the browser hands back for one is its image page, not the bytes', async () => {
		reply = () => ({
			status: 200,
			body: page(
				'<html><head><meta name="viewport" content="width=device-width, minimum-scale=0.1"><title>cover.jpg (300×450)</title></head><body style="margin: 0px; height: 100%; background-color: rgb(14, 14, 14);"><img style="display: block;" src="https://www.novel.example/cover.jpg"></body></html>',
				{ url: 'https://www.novel.example/cover.jpg' }
			)
		});
		// Marked fixed: another solve ends at the same image page, so the
		// host must not word this as a check that could not be passed.
		expect(await fetchPage({ url: 'https://www.novel.example/cover.jpg' })).toEqual({
			error:
				"www.novel.example sent a picture, not a page: the solver's browser hands back pages only",
			fixed: true
		});
		expect(checked()).toEqual([]);
	});

	it('keeps the site’s own refusal as the page’s status, and writes no check for it', async () => {
		reply = () => ({
			status: 200,
			body: page('<html><body>members only</body></html>', { status: 403 })
		});
		expect(await fetchPage({ url: 'https://www.novel.example/locked' })).toMatchObject({
			page: { status: 403 }
		});
		expect(checked()).toEqual([]);
	});

	it('says the solver’s own failure, an HTTP 500, and asks it once', async () => {
		reply = () => ({
			status: 500,
			body: JSON.stringify({
				status: 'error',
				message: 'Error solving the challenge. Timeout after 50.0 seconds.'
			})
		});
		expect(await fetchPage({ url: 'https://www.novel.example/c/1' })).toEqual({
			error: 'the solver answered 500 (Error solving the challenge. Timeout after 50.0 seconds.)'
		});
		expect(asked).toHaveLength(1);
		reply = () => ({ status: 200, body: JSON.stringify({ status: 'ok' }) });
		expect(await fetchPage({ url: 'https://www.novel.example/c/1' })).toEqual({
			error: 'the solver gave no page'
		});
		reply = () => ({ status: 200, body: page('<html></html>', { status: 0 }) });
		expect(await fetchPage({ url: 'https://www.novel.example/c/1' })).toEqual({
			error: "the solver's browser reported status 0"
		});
	});

	it('asks once more when the solver’s browser died under it, and says so when it dies twice', async () => {
		const died = () => ({
			status: 500,
			body: JSON.stringify({
				status: 'error',
				message:
					'Error: Error solving the challenge. Message: invalid session id: session deleted as the browser has closed the connection\nfrom disconnected: not connected to DevTools'
			})
		});
		let n = 0;
		reply = () => (n++ === 0 ? died() : { status: 200, body: page(BODY) });
		expect(await fetchPage({ url: 'https://www.novel.example/c/1' })).toMatchObject({
			page: { body: BODY }
		});
		expect(asked).toHaveLength(2);
		reply = died;
		const twice = await fetchPage({ url: 'https://www.novel.example/c/2' });
		expect(twice).toMatchObject({
			error: expect.stringMatching(/^the solver's browser closed twice \(.*invalid session id/)
		});
		expect(asked).toHaveLength(4);
	});

	it('says a solver that did not answer in time, or could not be reached', async () => {
		delay = 300;
		expect(await fetchPage({ url: 'https://www.novel.example/slow' }, { timeoutMs: 60 })).toEqual({
			error: 'the solver did not answer in 0.06 s'
		});
		// The stub still answers, late: wait for it here, or its count lands in the next test.
		await vi.waitFor(
			() => {
				if (open !== 0) throw new Error('the stub is still answering');
			},
			{ timeout: 3_000 }
		);
		delay = 0;
		process.env.NOVEL_SOLVER_URL = 'http://127.0.0.1:1/v1';
		try {
			expect(await fetchPage({ url: 'https://www.novel.example/x' })).toMatchObject({
				error: expect.stringMatching(/^the solver could not be reached/)
			});
		} finally {
			process.env.NOVEL_SOLVER_URL = `http://127.0.0.1:${port}/v1`;
		}
	});

	it('refuses a loopback or private address before the solver hears of it, every time', async () => {
		for (const url of [
			'http://127.0.0.1:8193/v1',
			'http://[::1]/',
			'https://inside.example/',
			'https://mixed.example/',
			'https://unknown.example/',
			'file:///etc/passwd'
		])
			// Fixed: a new solve is refused here again, before it starts.
			expect(await fetchPage({ url }), url).toMatchObject({
				error: expect.stringMatching(/^refused: /),
				fixed: true
			});
		expect(await fetchPage({ url: 'not a url' })).toEqual({
			error: 'not an address',
			fixed: true
		});
		expect(asked).toEqual([]);
		// Checked every time, not once per host: a name that moves inside is refused at once.
		reply = () => ({ status: 200, body: page(BODY) });
		expect(await fetchPage({ url: 'https://novel.example/a' })).toHaveProperty('page');
		ADDRESSES['novel.example'] = ['192.168.1.20'];
		try {
			expect(await fetchPage({ url: 'https://novel.example/b' })).toEqual({
				error: 'refused: novel.example is not on the internet',
				fixed: true
			});
		} finally {
			ADDRESSES['novel.example'] = ['93.184.215.14'];
		}
		expect(asked).toHaveLength(1);
	});

	it('does not read back a page the browser was redirected to on a local address', async () => {
		reply = () => ({
			status: 200,
			body: page('<html>the router</html>', { url: 'https://inside.example/admin' })
		});
		expect(await fetchPage({ url: 'https://www.novel.example/away' })).toEqual({
			error: "the solver's browser ended at inside.example, which is not on the internet",
			fixed: true
		});
		expect(checked()).toEqual([]);
	});

	it('calls a failed lookup the network’s, not a refusal and not a check', async () => {
		// EAI_AGAIN comes out of `checkPublic`'s own lookup, in the same catch a
		// local address lands in. It is neither: a retry can succeed, and the
		// browser was never asked, so it is unsent rather than fixed.
		const answer = await fetchPage({ url: 'https://flaky.example/chapter' });
		expect(answer).toEqual({
			error: 'the address could not be checked (getaddrinfo EAI_AGAIN flaky.example)',
			unsent: true
		});
		expect(answer).not.toHaveProperty('fixed');
		// The solver was never asked, and no check was recorded for a host that
		// was never reached.
		expect(asked).toEqual([]);
		expect(checked()).toEqual([]);
	});

	it('calls a failed lookup of the address the browser ended on the network’s, not a refusal', async () => {
		// This is the second `checkPublic`: the browser was asked and answered,
		// and the lookup of the URL it ended on failed. A new solve is not the
		// cure, but neither is the address permanently off the internet, so the
		// answer is neither fixed nor unsent.
		for (const [name, code] of [
			['flaky.example', 'EAI_AGAIN'],
			['lost.example', 'ENOTFOUND']
		]) {
			reply = () => ({ status: 200, body: page(BODY, { url: `https://${name}/moved` }) });
			const answer = await fetchPage({ url: 'https://www.novel.example/c/1' });
			expect(answer, name).toEqual({
				error: `the solver's browser ended at ${name}, and its address could not be checked (getaddrinfo ${code} ${name})`,
				unchecked: true
			});
			expect(answer).not.toHaveProperty('fixed');
			expect(answer).not.toHaveProperty('unsent');
		}
		// The page came, but its address was never checked, so the host was not
		// recorded as checked.
		expect(checked()).toEqual([]);
	});

	it('fetches one page per host at a time, answers the same request once, and lets two hosts run together', async () => {
		delay = 40;
		reply = (a) => ({ status: 200, body: page(`<html>${a.url}</html>`, { url: a.url }) });
		const [a, b, c] = await Promise.all([
			fetchPage({ url: 'https://www.novel.example/one' }),
			fetchPage({ url: 'https://www.novel.example/two' }),
			fetchPage({ url: 'https://www.novel.example/one' })
		]);
		expect(asked.map((x) => x.url)).toEqual([
			'https://www.novel.example/one',
			'https://www.novel.example/two'
		]);
		expect(most).toBe(1);
		expect(a).toEqual(c);
		expect(b).toMatchObject({ page: { url: 'https://www.novel.example/two' } });
		// A failure in the first doesn't hold the host's turn: the next is asked.
		asked = [];
		most = 0;
		let n = 0;
		reply = (x) =>
			n++ === 0
				? { status: 500, body: JSON.stringify({ status: 'error', message: 'nope' }) }
				: { status: 200, body: page('<html>ok</html>', { url: x.url }) };
		const [bad, good] = await Promise.all([
			fetchPage({ url: 'https://www.novel.example/bad' }),
			fetchPage({ url: 'https://www.novel.example/good' })
		]);
		expect(bad).toEqual({ error: 'the solver answered 500 (nope)' });
		expect(good).toHaveProperty('page');
		expect(most).toBe(1);
		// Two hosts are two browsers' worth, at once.
		asked = [];
		most = 0;
		reply = (x) => ({ status: 200, body: page('<html>ok</html>', { url: x.url }) });
		await Promise.all([
			fetchPage({ url: 'https://www.novel.example/three' }),
			fetchPage({ url: 'https://other.example/three' })
		]);
		expect(most).toBe(2);
	});
});

describe('where the app reaches its solver', () => {
	const env = (own: string | undefined, engine: string | undefined) => {
		if (own === undefined) delete process.env.NOVEL_SOLVER_URL;
		else process.env.NOVEL_SOLVER_URL = own;
		if (engine === undefined) delete process.env.ENGINE_SOLVER_URL;
		else process.env.ENGINE_SOLVER_URL = engine;
	};

	it('is the app’s own value first, the engine’s only when the app can reach it, else 8193', () => {
		env('http://127.0.0.1:8193/v1', 'http://flaresolverr:8191/v1');
		expect(novelSolverUrl()).toBe('http://127.0.0.1:8193/v1');
		// Development's engine address is a name only its own compose network resolves.
		env(undefined, 'http://flaresolverr:8191/v1');
		expect(novelSolverUrl()).toBe('http://127.0.0.1:8193/v1');
		env(undefined, undefined);
		expect(novelSolverUrl()).toBe('http://127.0.0.1:8193/v1');
		// A release puts the solver on 127.0.0.1, and one value serves both.
		env(undefined, 'http://127.0.0.1:8191/v1');
		expect(novelSolverUrl()).toBe('http://127.0.0.1:8191/v1');
		env(`http://127.0.0.1:${port}/v1`, undefined);
		expect(novelSolverUrl()).toBe(`http://127.0.0.1:${port}/v1`);
	});
});

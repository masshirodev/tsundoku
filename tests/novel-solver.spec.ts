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
	'inside.example': ['10.0.0.5'],
	'mixed.example': ['93.184.215.14', '127.0.0.1']
};
vi.mock('node:dns/promises', () => ({
	lookup: async (host: string) =>
		(ADDRESSES[host] ?? []).map((address) => ({ address, family: address.includes(':') ? 6 : 4 }))
}));

const { getDb } = await import('$lib/server/db');
const { novelSolverUrl, solveChallenge, solvingSince } = await import('$lib/server/novels/solver');

type Asked = { cmd?: string; url?: string; maxTimeout?: number };
let asked: Asked[] = [];
let reply: () => { status: number; body: string } = () => ({ status: 200, body: ok() });
let delay = 0;
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
				{ name: 'cf_clearance', value: 'yes', domain: '.novel.example' },
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
			asked.push(JSON.parse(raw) as Asked);
			const send = () => {
				const r = reply();
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
	reply = () => ({ status: 200, body: ok() });
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
		expect(c).toEqual({ cookies: 'cf_clearance=yes; session=abc', userAgent: 'StubBrowser/2.0' });
		expect(asked).toEqual([
			{ cmd: 'request.get', url: 'https://www.novel.example/a/chapter', maxTimeout: 50_000 }
		]);
		// The host is BROWSE's past-tense line once it has passed the check.
		expect(checked()).toEqual([{ host: 'www.novel.example', seen_at: expect.any(Number) }]);
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

	it('answers nothing when the solver fails, and writes no check', async () => {
		reply = () => ({ status: 200, body: JSON.stringify({ status: 'error', message: 'nope' }) });
		expect(await solveChallenge('https://www.novel.example/')).toBeNull();
		reply = () => ({ status: 500, body: '{}' });
		expect(await solveChallenge('https://www.novel.example/')).toBeNull();
		reply = () => ({ status: 200, body: 'not json' });
		expect(await solveChallenge('https://www.novel.example/')).toBeNull();
		expect(checked()).toEqual([]);
	});

	it('answers nothing when a solution carries no clearance at all', async () => {
		reply = () => ({ status: 200, body: ok({ cookies: [], userAgent: '' }) });
		expect(await solveChallenge('https://www.novel.example/')).toBeNull();
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

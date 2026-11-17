import { afterEach, describe, expect, it, vi } from 'vitest';

// Before anything imports db.ts: getDb() reads this once and memoises.
process.env.DATABASE_PATH = ':memory:';

// Every body the server reads from an address someone else named is read to a
// limit, by counting (net-guard.ts, readCapped): a site that answers without a
// length, or with a false one, must not fill the server's memory.

vi.mock('node:dns/promises', async (importOriginal) => {
	const real = await importOriginal<typeof import('node:dns/promises')>();
	return {
		...real,
		lookup: (async (host: string, opts?: unknown) =>
			host.endsWith('.example')
				? [{ address: '93.184.215.14', family: 4 }]
				: real.lookup(host, opts as never)) as typeof real.lookup
	};
});

/** A body with no length that never ends, and how much of it was pulled. */
function endless(type = 'image/jpeg') {
	let pulled = 0;
	const body = new ReadableStream<Uint8Array>({
		pull(c) {
			pulled += 1024 * 1024;
			c.enqueue(new Uint8Array(1024 * 1024).fill(0xff));
		}
	});
	return {
		res: () => new Response(body, { headers: { 'content-type': type } }),
		pulled: () => pulled
	};
}

/** The site, played by a stubbed fetch that answers every request with [answer]. */
function site(answer: () => Response) {
	const asked: string[] = [];
	vi.stubGlobal(
		'fetch',
		vi.fn(async (url: string) => {
			asked.push(String(url));
			return answer();
		})
	);
	return asked;
}

afterEach(() => vi.unstubAllGlobals());

const MB = 1024 * 1024;
/** A limit of [mb] megabytes, and the few chunks a stream pulls ahead of its reader. */
const past = (mb: number) => (mb + 4) * MB;

describe('a body read to a limit, wherever the server reads one', () => {
	it('a novel chapter’s picture', async () => {
		const { fetchImage } = await import('$lib/server/novels/downloader');
		const big = endless();
		site(big.res);
		expect(await fetchImage('https://pics.example/1.jpg', 'https://site.example/')).toBeNull();
		expect(big.pulled()).toBeLessThanOrEqual(past(10));
	});

	it('a novel’s cover in BROWSE', async () => {
		const source = await import('$lib/server/novels/source');
		const route = await import('../src/routes/api/browse/novel-cover/[token]/+server');
		const token = source.coverRoute('https://covers.example/c.jpg').split('/').pop()!;
		const big = endless();
		site(big.res);
		await expect(
			route.GET({ params: { token } } as unknown as Parameters<typeof route.GET>[0])
		).rejects.toMatchObject({ status: 404 });
		expect(big.pulled()).toBeLessThanOrEqual(past(10));
	});

	it('a stream’s playlist, which has no length when it is sent in chunks', async () => {
		const streams = await import('$lib/server/anime/streams');
		const big = endless('application/vnd.apple.mpegurl');
		site(big.res);
		const token = streams.register({
			url: 'https://cdn.example/master.m3u8',
			headers: {},
			engine: false
		});
		await expect(streams.serveMedia(token, null)).rejects.toMatchObject({ status: 502 });
		expect(big.pulled()).toBeLessThanOrEqual(past(5));
	});

	it('a stream probed for its length, which may be a whole video rather than a playlist', async () => {
		const streams = await import('$lib/server/anime/streams');
		const big = endless('video/mp4');
		site(big.res);
		const token = streams.register({
			url: 'https://cdn.example/ep.mp4',
			headers: {},
			engine: false
		});
		expect(await streams.probe(streams.mediaRoute(token))).toEqual({
			seconds: null,
			bandwidth: null
		});
		expect(big.pulled()).toBeLessThanOrEqual(past(5));
	});

	it('a novel repository’s index', async () => {
		const { previewNovelRepo } = await import('$lib/server/novels/plugins');
		const big = endless('application/json');
		site(big.res);
		await expect(previewNovelRepo('https://repo.example/plugins.min.json')).rejects.toThrow();
		expect(big.pulled()).toBeLessThanOrEqual(past(32));
	});

	it('an extension repository’s index', async () => {
		const { previewRepo } = await import('$lib/server/engine/extensions');
		const big = endless('application/json');
		site(big.res);
		await expect(previewRepo('https://repo.example/index.min.json')).rejects.toThrow();
		expect(big.pulled()).toBeLessThanOrEqual(past(32));
	});
});

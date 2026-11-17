import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * Hiding takes a series off the device (src/lib/cache/sweep.ts; doc/OFFLINE.md):
 * against a stand-in for the browser's Cache Storage, holding what the reader,
 * ↓ CACHE, the player and the service worker write.
 */

class FakeCache {
	readonly urls = new Map<string, Response>();
	async keys() {
		return [...this.urls.keys()].map((u) => new Request(u));
	}
	async put(url: string, res: Response) {
		this.urls.set(new URL(url, 'http://localhost').href, res);
	}
	async delete(req: Request | string) {
		return this.urls.delete(
			typeof req === 'string' ? new URL(req, 'http://localhost').href : req.url
		);
	}
	async match(req: Request | string) {
		return this.urls.get(typeof req === 'string' ? new URL(req, 'http://localhost').href : req.url);
	}
	paths() {
		return [...this.urls.keys()].map((u) => new URL(u).pathname).sort();
	}
}

const store = new Map<string, FakeCache>();
vi.stubGlobal('caches', {
	has: async (n: string) => store.has(n),
	open: async (n: string) => {
		if (!store.has(n)) store.set(n, new FakeCache());
		return store.get(n)!;
	},
	delete: async (n: string) => store.delete(n)
});

const { forget, heldOnDevice, idsInPath, sweepHidden, SCREENS_CACHE } =
	await import('$lib/cache/sweep');

const ENTRIES = 'tsundoku-entries';
const EPISODES = 'tsundoku-episodes';

async function fill(name: string, paths: string[]) {
	const c = await caches.open(name);
	for (const p of paths) await c.put(p, new Response('x'));
}
const paths = (name: string) => store.get(name)?.paths() ?? [];

beforeEach(async () => {
	store.clear();
	// Series 7: two chapters kept whole, entry 72 half-kept (no marker yet).
	// Series 8: a novel kept whole, by its EPUB and markers. Series 9: one episode.
	// Series 5: a chapter of a series that stays visible.
	await fill(ENTRIES, [
		'/__cache/series/7/entries/70',
		'/api/entries/70/pages',
		'/api/entries/70/pages/0?v=a',
		'/api/entries/70/text',
		'/read/70',
		'/read/70/__data.json',
		'/__cache/series/7/entries/71',
		'/api/entries/71/pages/0?v=a',
		'/api/entries/72/pages/0?v=a',
		'/__cache/series/8/entries/80',
		'/api/series/8/epub?v=3',
		'/read/80',
		'/__cache/series/5/entries/50',
		'/api/entries/50/pages/0?v=a',
		'/read/50'
	]);
	await fill(EPISODES, [
		'/__cache/episodes/9/90',
		'/api/anime/file/90',
		'/api/anime/file/90/subtitle/0',
		'/api/anime/episode/90/videos',
		'/read/90'
	]);
	await fill(SCREENS_CACHE, [
		'/',
		'/__data.json',
		'/series/7',
		'/series/7/__data.json',
		'/history'
	]);
});

describe('idsInPath', () => {
	it.each([
		['/__cache/series/7/entries/70', { series: 7, entry: 70 }],
		['/__cache/episodes/9/90', { series: 9, entry: 90 }],
		['/api/entries/70/pages/3', { entry: 70 }],
		['/api/entries/70/text', { entry: 70 }],
		['/read/70', { entry: 70 }],
		['/read/70/__data.json', { entry: 70 }],
		['/api/anime/file/90/subtitle/1', { entry: 90 }],
		['/api/anime/episode/90/videos', { entry: 90 }],
		['/api/series/8/epub', { series: 8 }],
		['/series/7/__data.json', { series: 7 }],
		['/series/volume-cover/3', {}],
		['/', {}],
		['/history', {}]
	])('%s', (path, ids) => {
		expect(idsInPath(path)).toEqual(ids);
	});
});

describe('the sweep', () => {
	it('names every series and entry the device holds anything of', async () => {
		const held = await heldOnDevice();
		expect(held.series.sort()).toEqual([5, 7, 8, 9]);
		expect(held.entries.sort()).toEqual([50, 70, 71, 72, 80, 90]);
	});

	it('drops a gone series whole, its half-kept entry named by id, and every screen copy', async () => {
		await forget({ series: [7], entries: [72] });
		expect(paths(ENTRIES)).toEqual(
			[
				'/__cache/series/8/entries/80',
				'/api/series/8/epub',
				'/read/80',
				'/__cache/series/5/entries/50',
				'/api/entries/50/pages/0',
				'/read/50'
			].sort()
		);
		expect(store.has(SCREENS_CACHE)).toBe(false);
		expect(paths(EPISODES)).toHaveLength(5);
	});

	it('drops a novel by its EPUB and an anime by its file and subtitles', async () => {
		await forget({ series: [8, 9], entries: [] });
		expect(paths(ENTRIES).some((p) => /\/(8|80)\b/.test(p))).toBe(false);
		expect(paths(EPISODES)).toEqual([]);
	});

	it('asks the workstation with what it holds and drops only what it answers', async () => {
		const fetcher = vi.fn(async (_url: string, init: RequestInit) => {
			const held = JSON.parse(String(init.body)) as { series: number[]; entries: number[] };
			expect(held.series.sort()).toEqual([5, 7, 8, 9]);
			return Response.json({ series: [7], entries: [72] });
		});
		expect(await sweepHidden(fetcher as never)).toBe(2);
		expect(fetcher).toHaveBeenCalledWith(
			'/api/cache/gone',
			expect.objectContaining({ method: 'POST' })
		);
		expect(paths(ENTRIES).some((p) => p.includes('/7/') || /\/7[012]\b/.test(p))).toBe(false);
		expect(paths(ENTRIES)).toContain('/read/50');
	});

	it('keeps everything when nothing is gone, and keeps the screen copies', async () => {
		const fetcher = vi.fn(async () => Response.json({ series: [], entries: [] }));
		expect(await sweepHidden(fetcher as never)).toBe(0);
		expect(paths(SCREENS_CACHE)).toHaveLength(5);
		expect(paths(ENTRIES)).toHaveLength(15);
	});

	it('keeps everything when the workstation does not answer, or refuses', async () => {
		expect(await sweepHidden((async () => Promise.reject(new TypeError('offline'))) as never)).toBe(
			0
		);
		expect(await sweepHidden((async () => new Response(null, { status: 503 })) as never)).toBe(0);
		expect(paths(ENTRIES)).toHaveLength(15);
		expect(paths(SCREENS_CACHE)).toHaveLength(5);
	});

	it('asks nothing when the device holds nothing', async () => {
		store.clear();
		const fetcher = vi.fn();
		expect(await sweepHidden(fetcher as never)).toBe(0);
		expect(fetcher).not.toHaveBeenCalled();
	});
});

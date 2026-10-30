import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

// Before anything imports db.ts: getDb() reads this once and memoises.
process.env.DATABASE_PATH = ':memory:';
const work = mkdtempSync(join(tmpdir(), 'tsundoku-novel-source-'));
process.env.NOVEL_STORE = join(work, 'store');
process.env.LIBRARY_ROOT = join(work, 'library');
process.env.COVER_DIR = join(work, 'covers');
afterAll(() => rmSync(work, { recursive: true, force: true }));

// A novel plugin as a source (doc/NOVELS.md; card c149), on a fake host: the
// real one is tests/novel-host.spec.ts's. Its answers are LNReader's shapes.
type Call = { method: string; args: unknown[] };
let calls: Call[] = [];
const DEFAULT_COVER =
	'https://github.com/LNReader/lnreader-plugins/blob/main/icons/src/coverNotAvailable.jpg?raw=true';
const item = (page: number, i: number) => ({
	name: `Novel ${page}-${i}`,
	path: `/novel/p${page}-${i}`,
	cover: i === 0 ? DEFAULT_COVER : `https://covers.example/p${page}-${i}.jpg`
});
const fakeHost = {
	info: async () => ({
		id: 'good',
		name: 'Good Novels',
		site: 'https://good.example/',
		version: '1.0.0',
		paged: true,
		filters: {
			sort: {
				type: 'Picker',
				label: 'Sort',
				value: 'new',
				options: [
					{ label: 'New', value: 'new' },
					{ label: 'Top', value: 'top' }
				]
			}
		}
	}),
	call: async (_file: string, method: string, args: unknown[]) => {
		calls.push({ method, args });
		switch (method) {
			case 'popularNovels': {
				const page = args[0] as number;
				// Two pages, then an empty one: LNReader's only "end".
				return page <= 2 ? [item(page, 0), item(page, 1)] : [];
			}
			case 'searchNovels':
				return [{ name: `Found ${args[0]}`, path: '/novel/found' }];
			case 'parseNovel':
				return {
					name: 'The Long One',
					path: args[0],
					cover: 'https://covers.example/long.jpg',
					author: 'Guiltythree',
					status: 'On Hiatus',
					genres: 'Fantasy, Action',
					summary: ' A long one. ',
					totalPages: 3,
					chapters: [
						{ name: 'Chapter 1 - Start', path: '/c/1', releaseTime: '2026-01-01' },
						{ name: 'Chapter 2', path: '/c/2', releaseTime: 'yesterday' }
					]
				};
			case 'parsePage':
				return {
					chapters:
						args[1] === '2'
							? [
									{ name: 'Chapter 3', path: '/c/3' },
									{ name: 'Chapter 2', path: '/c/2' }
								]
							: [{ name: 'Side story', path: '/c/side' }]
				};
			case 'resolveUrl':
				return null;
		}
		throw new Error(`no ${method}`);
	}
};
vi.mock('$lib/server/novels/plugins', async (original) => ({
	...(await original<typeof import('$lib/server/novels/plugins')>()),
	novelHost: () => fakeHost
}));
// The covers' site is on the internet; nothing is fetched from it here.
vi.mock('node:dns/promises', () => ({
	lookup: async () => [{ address: '93.184.215.14', family: 4 }]
}));
vi.stubGlobal(
	'fetch',
	vi.fn(async () => new Response('no', { status: 404 }))
);

const { getDb } = await import('$lib/server/db');
const { forgetSourceUse } = await import('$lib/server/library-sources');
const browse = await import('$lib/server/engine/browse');
const source = await import('$lib/server/novels/source');
const downloads = await import('$lib/server/downloads');
const { lnSchema } = await import('$lib/library/lnreader-filters');

const db = getDb();
const SOURCE = 'ln:good';

beforeEach(() => {
	calls = [];
	browse.forgetAll();
	db.exec(`DELETE FROM series; DELETE FROM novel_plugins; DELETE FROM tombstones;`);
	db.prepare(
		`INSERT INTO novel_plugins (id, name, site, lang, version, hash, installed_at, updated_at, failed)
		VALUES ('good', 'Good Novels', 'https://good.example/', 'en', '1.0.0', 'h1', 0, 0, ''),
			('broken', 'Broken Novels', 'https://broken.example/', 'en', '1.0.0', 'h2', 0, 0, 'SyntaxError')`
	).run();
	forgetSourceUse();
});

describe('a plugin in BROWSE', () => {
	it('is a NOVELS source, and one that failed to load says so', () => {
		const list = browse.browseList(false);
		expect(list.novels.map((r) => [r.id, r.kind, r.label, r.failed])).toEqual([
			['ln:broken', 'novel', 'Broken Novels', 'SyntaxError'],
			['ln:good', 'novel', 'Good Novels', '']
		]);
		expect(list.manga).toEqual([]);
		expect(browse.browseSource(SOURCE, false)?.name).toBe('Good Novels');
	});

	it('pages its list until an empty page, its covers through tsundoku and LNReader’s blank as none', async () => {
		const got = await browse.shelf(SOURCE, 'popular', { pages: 9, reveal: false });
		expect(got.pages).toBe(3);
		expect(got.more).toBe(false);
		expect(got.hits.map((h) => h.title)).toEqual([
			'Novel 1-0',
			'Novel 1-1',
			'Novel 2-0',
			'Novel 2-1'
		]);
		expect(got.hits[0].cover).toBe('');
		expect(got.hits[1].cover).toMatch(/^\/api\/browse\/novel-cover\/[A-Za-z0-9_-]{32}$/);
		const token = got.hits[1].cover.split('/').pop()!;
		expect(source.coverAddress(token)).toBe('https://covers.example/p1-1.jpg');
		expect(source.parseNovelMangaId(got.hits[1].mangaId)).toEqual({
			sourceId: SOURCE,
			plugin: 'good',
			path: '/novel/p1-1'
		});
		// The plugin's own filters at rest: the host's defaults.
		expect(calls[0]).toEqual({
			method: 'popularNovels',
			args: [1, { showLatestNovels: false, filters: undefined }]
		});
	});

	it('asks for LATEST, the panel’s filters and a search as LNReader does', async () => {
		expect(await browse.supportsLatest(SOURCE)).toBe(true);
		const schema = await browse.filterSchema(SOURCE);
		expect(schema).toEqual(lnSchema((await fakeHost.info()).filters).schema);
		await browse.shelf(SOURCE, 'latest', { pages: 1, reveal: false });
		const top = [{ ...schema[0], state: 1 }];
		await browse.shelf(SOURCE, 'filtered', { pages: 1, applied: top, reveal: false });
		await browse.shelf(SOURCE, 'filtered', {
			pages: 1,
			query: 'dragon',
			applied: top,
			reveal: false
		});
		expect(calls.map((c) => [c.method, c.args])).toEqual([
			['popularNovels', [1, { showLatestNovels: true, filters: undefined }]],
			[
				'popularNovels',
				[1, { showLatestNovels: false, filters: { sort: { type: 'Picker', value: 'top' } } }]
			],
			['searchNovels', ['dragon', 1]]
		]);
	});

	it('refuses a plugin that failed to load, and one not installed', async () => {
		await expect(browse.shelf('ln:broken', 'popular', { pages: 1, reveal: false })).rejects.toThrow(
			/No installed plugin/
		);
		expect(browse.browseSource('ln:gone', true)).toBeNull();
		expect(source.parseNovelMangaId('ln:../x~Lw')).toBeNull();
		expect(source.parseNovelMangaId('123~Lw')).toBeNull();
	});
});

describe('a novel', () => {
	const id = () => source.novelMangaId(SOURCE, '/novel/long');

	// An unnumbered chapter is read as Mihon's are: after the one before it.
	it('previews with every page of its chapters, newest first', async () => {
		const m = (await downloads.sourceManga(id()))!;
		expect(m.title).toBe('The Long One');
		expect(m.status).toBe('ON_HIATUS');
		expect(m.genres).toEqual(['Fantasy', 'Action']);
		expect(m.source).toBe('Good Novels');
		expect(m.lang).toBe('EN');
		expect(m.realUrl).toBe('https://good.example/novel/long');
		expect(m.chapters.map((c) => [c.url, c.number])).toEqual([
			['/c/side', 3.5],
			['/c/3', 3],
			['/c/2', 2],
			['/c/1', 1]
		]);
		expect(m.chapters.at(-1)!.uploadDate).toBe(Date.parse('2026-01-01'));
		// parseNovel's chapters are page 1; pages 2 and 3 are asked for.
		expect(calls.filter((c) => c.method === 'parsePage').map((c) => c.args)).toEqual([
			['/novel/long', '2'],
			['/novel/long', '3']
		]);
	});

	it('is added as a novel series, every chapter NOT DOWNLOADED, once', async () => {
		const seriesId = await source.addNovel(id(), 5000);
		const s = db
			.prepare(
				`SELECT s.title, s.kind, s.source, s.origin_key, s.description, s.status, s.cover_url, s.arrived_at, r.name AS root
				FROM series s JOIN roots r ON r.id = s.root_id WHERE s.id = ?`
			)
			.get(seriesId);
		expect(s).toEqual({
			title: 'The Long One',
			kind: 'novel',
			source: 'lnreader',
			origin_key: 'lnreader:good:/novel/long',
			description: 'A long one.',
			status: 'on-hiatus',
			cover_url: 'https://covers.example/long.jpg',
			arrived_at: 5000,
			root: 'Library'
		});
		const entries = db
			.prepare(
				`SELECT label, title, source_url, available FROM entries WHERE series_id = ? ORDER BY position`
			)
			.all(seriesId);
		expect(entries).toEqual([
			{ label: 'Ch. 1', title: 'Start', source_url: '/c/1', available: 0 },
			{ label: 'Ch. 2', title: '', source_url: '/c/2', available: 0 },
			{ label: 'Ch. 3', title: '', source_url: '/c/3', available: 0 },
			{ label: 'Ch. 3.5', title: 'Side story', source_url: '/c/side', available: 0 }
		]);
		const tags = db
			.prepare(
				`SELECT t.namespace, t.value FROM series_tags st JOIN tags t ON t.id = st.tag_id WHERE st.series_id = ? ORDER BY t.namespace, t.value`
			)
			.all(seriesId);
		expect(tags).toEqual([
			{ namespace: 'author', value: 'Guiltythree' },
			{ namespace: 'genre', value: 'action' },
			{ namespace: 'genre', value: 'fantasy' },
			{ namespace: 'source', value: 'Good Novels' }
		]);
		expect(await downloads.addToLibrary(id())).toBe(seriesId);
		expect(await downloads.mangaKey(id())).toBe('lnreader:good:/novel/long');
	});

	it('is IN LIBRARY in its source’s list after, and not there at all while hidden', async () => {
		const seriesId = await source.addNovel(source.novelMangaId(SOURCE, '/novel/p1-1'), 1);
		forgetSourceUse();
		const hit = async (reveal: boolean) => {
			browse.forgetAll();
			return (await browse.shelf(SOURCE, 'popular', { pages: 1, reveal })).hits.find(
				(h) => h.title === 'Novel 1-1'
			);
		};
		expect((await hit(false))?.match).toMatchObject({ kind: 'in-library', seriesId });
		expect(browse.browseSource(SOURCE, false)?.series).toBe(1);
		db.prepare(`UPDATE series SET hidden = 1 WHERE id = ?`).run(seriesId);
		forgetSourceUse();
		expect(await hit(false)).toBeUndefined();
		expect((await hit(true))?.match).toMatchObject({ kind: 'in-library', hidden: true });
		// Its only series hidden: the plugin itself isn't listed with reveal off.
		expect(browse.browseSource(SOURCE, false)).toBeNull();
		expect(browse.browseSource(SOURCE, true)?.hidden).toBe(1);
	});

	it('is searched for in the plugins BROWSE lists, before the library reads from any', async () => {
		// A new library reads from nothing; the plugin is listed, so it's asked (2026-10-30).
		expect((await downloads.searchSources(false)).map((s) => s.id)).toEqual([SOURCE]);
		await source.addNovel(source.novelMangaId(SOURCE, '/novel/p1-1'), 1);
		forgetSourceUse();
		expect((await downloads.searchSources(false)).map((s) => s.id)).toEqual([SOURCE]);
		const hits = await downloads.searchSource(SOURCE, 'dragon', false);
		expect(hits.map((h) => [h.title, h.parts.mid])).toEqual([['Found dragon', 'dragon']]);
		expect(downloads.sourceOfMangaId(hits[0].mangaId)).toBe(SOURCE);
	});
});

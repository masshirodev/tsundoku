import { beforeEach, describe, expect, it, vi } from 'vitest';

// Before anything imports db.ts: getDb() reads this once and memoises.
process.env.DATABASE_PATH = ':memory:';

/**
 * REFRESH over a selection: what `refreshMany` orchestrates. The
 * three kinds' own asks are `refreshSeries`' and are tested against real test
 * sources (engine-backend-db, anime-source-db, novel-download-db); the source
 * here is a stub for each, so a throwing, silent or hanging one can be asked
 * for on purpose without a network.
 */
const checks = vi.hoisted(() => ({
	addNewChapters: vi.fn(),
	checkAnime: vi.fn(),
	checkNovel: vi.fn()
}));
vi.mock('$lib/server/engine/backend', () => ({ addNewChapters: checks.addNewChapters }));
vi.mock('$lib/server/anime/follow', () => ({ checkAnime: checks.checkAnime }));
vi.mock('$lib/server/novels/follow', () => ({ checkNovel: checks.checkNovel }));

const { getDb } = await import('$lib/server/db');
const { refreshMany, REFRESH_BATCH } = await import('$lib/server/refresh');

const db = getDb();
db.prepare(`INSERT INTO roots (id, name, path, hidden) VALUES (1, 'Library', '/library', 0)`).run();
db.prepare(`INSERT INTO roots (id, name, path, hidden) VALUES (2, 'Hentoid', '/hentoid', 1)`).run();

let next = 0;
/** A series as the scanner writes one: a title, and the key of its source, if it has one. */
function series(title: string, key: string | null, o: { root?: number; hidden?: number } = {}) {
	next += 1;
	return Number(
		db
			.prepare(
				`INSERT INTO series (root_id, title, kind, added_at, indexed_at, origin_key, hidden)
				 VALUES (?, ?, 'manga', ?, ?, ?, ?)`
			)
			.run(o.root ?? 1, title, next, next, key, o.hidden ?? 0).lastInsertRowid
	);
}

/** A chapter or episode found: what the three checks answer with. */
const arrived = (n: number) => ({
	arrived: Array.from({ length: n }, () => ({})),
	read: new Set()
});
const found = (n: number) => ({ added: n, queued: 0 });

beforeEach(() => {
	checks.addNewChapters.mockReset();
	checks.checkAnime.mockReset();
	checks.checkNovel.mockReset();
	checks.addNewChapters.mockResolvedValue(arrived(0));
	checks.checkAnime.mockResolvedValue(found(0));
	checks.checkNovel.mockResolvedValue(found(0));
});

describe('REFRESH over a selection', () => {
	it('asks every selected series that has a source, and skips the ones that have none', async () => {
		const manga = series('Manga One', 'mihon:111:/manga/one');
		const anime = series('Anime One', 'aniyomi:222:/anime/one');
		const novel = series('Novel One', 'lnreader:ranobe:/novel/one');
		// A Henga book, an EPUB: nothing to ask, and skipped rather than refused.
		const book = series('Book One', null);

		checks.addNewChapters.mockResolvedValue(arrived(2));
		checks.checkAnime.mockResolvedValue(found(1));

		const r = await refreshMany([manga, anime, novel, book], { reveal: false });

		expect(r).toEqual({ asked: 3, found: 2, skipped: 1, failed: [], remaining: [] });
		expect(checks.addNewChapters.mock.calls.map((c) => c[0])).toEqual([manga]);
		expect(checks.checkAnime.mock.calls.map((c) => c[0])).toEqual([anime]);
		expect(checks.checkNovel.mock.calls.map((c) => c[0])).toEqual([novel]);
		// Asked once each, whatever the selection repeats.
		expect(await refreshMany([manga, manga], { reveal: false })).toMatchObject({ asked: 1 });
		expect(checks.addNewChapters).toHaveBeenCalledTimes(2);
	});

	it('counts nothing as found when a source lists nothing new', async () => {
		const manga = series('Manga Two', 'mihon:111:/manga/two');
		const r = await refreshMany([manga], { reveal: false });
		expect(r).toEqual({ asked: 1, found: 0, skipped: 0, failed: [], remaining: [] });
	});

	it('carries on past a source that throws, and past one that never answers', async () => {
		const throws = series('Throws', 'mihon:111:/manga/throws');
		const hangs = series('Hangs', 'aniyomi:222:/anime/hangs');
		const works = series('Works', 'lnreader:ranobe:/novel/works');
		checks.addNewChapters.mockImplementation(async (id: number) => {
			if (id === throws) throw new Error('the source refused');
			return arrived(1);
		});
		// A timeout is the ask's own deadline, not a rejection the source makes.
		checks.checkAnime.mockImplementation(() => new Promise(() => {}));
		checks.checkNovel.mockResolvedValue(found(1));

		const r = await refreshMany([throws, hangs, works], { reveal: false, timeoutMs: 20 });

		expect(r).toEqual({
			asked: 3,
			found: 1,
			skipped: 0,
			// Sorted, so two finishes racing cannot reorder the band.
			failed: ['Hangs', 'Throws'],
			remaining: []
		});
		expect(checks.checkNovel).toHaveBeenCalledTimes(1);
	});

	it('never asks a hidden series while reveal is off, and asks it with reveal on', async () => {
		const hidden = series('Behind The Curtain', 'mihon:111:/manga/hidden', { hidden: 1 });
		const inHiddenRoot = series('Rooted Away', 'mihon:111:/manga/rooted', { root: 2 });

		const off = await refreshMany([hidden, inHiddenRoot], { reveal: false });
		expect(off).toEqual({ asked: 0, found: 0, skipped: 0, failed: [], remaining: [] });
		expect(checks.addNewChapters).not.toHaveBeenCalled();

		const on = await refreshMany([hidden, inHiddenRoot], { reveal: true });
		expect(on.asked).toBe(2);
		expect(checks.addNewChapters.mock.calls.map((c) => c[0])).toEqual([hidden, inHiddenRoot]);
	});

	it('asks a run’s worth, in the selection’s order, and offers the rest', async () => {
		const many = Array.from({ length: REFRESH_BATCH + 3 }, (_, i) =>
			series(`Series ${i}`, `mihon:111:/manga/${i}`)
		);
		const r = await refreshMany(many, { reveal: false });
		expect(r.asked).toBe(REFRESH_BATCH);
		expect(r.remaining).toEqual(many.slice(REFRESH_BATCH));
		// The first run asked the first ones, not an arbitrary slice.
		expect(checks.addNewChapters.mock.calls.map((c) => c[0])).toEqual(many.slice(0, REFRESH_BATCH));
	});

	it('does nothing at all with nothing selected', async () => {
		expect(await refreshMany([], { reveal: false })).toEqual({
			asked: 0,
			found: 0,
			skipped: 0,
			failed: [],
			remaining: []
		});
	});
});

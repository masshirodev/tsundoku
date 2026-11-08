import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { chmodSync, existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

// Before anything imports db.ts: getDb() reads this once and memoises.
process.env.DATABASE_PATH = ':memory:';
const work = mkdtempSync(join(tmpdir(), 'tsundoku-season-facts-'));
const library = join(work, 'library');
process.env.LIBRARY_ROOT = library;
process.env.COVER_DIR = join(work, 'covers');
// Muxing is ffmpeg's and is run for real by anime-download-db; here only the
// place an episode lands matters, so these two write and read an empty file.
process.env.FFMPEG = join(work, 'ffmpeg');
process.env.FFPROBE = join(work, 'ffprobe');
writeFileSync(process.env.FFMPEG, '#!/bin/sh\nfor a; do last="$a"; done\n: > "$last"\n');
writeFileSync(
	process.env.FFPROBE,
	'#!/bin/sh\nprintf \'{"format":{"duration":"1"},"streams":[{"codec_type":"video"}]}\'\n'
);
chmodSync(process.env.FFMPEG, 0o755);
chmodSync(process.env.FFPROBE, 0o755);
afterAll(() => rmSync(work, { recursive: true, force: true }));

/**
 * A series that holds a source and a folder per season (c282; doc/WORKS.md,
 * "Per-season sources"). Each reader of the origin is run with a two-season
 * series and with a series without rows: the promise of the card is the
 * second, that a series with no rows reads exactly as it did.
 */
const source = vi.hoisted(() => ({
	/** Each source entry's episodes, by the id FOLLOW asks for: what the source lists now. */
	lists: new Map<string, { url: string; name: string; episode_number: number }[]>(),
	asked: [] as string[]
}));
vi.mock('$lib/server/engine/anime-source', async (original) => ({
	...(await original<typeof import('$lib/server/engine/anime-source')>()),
	fetchAnime: async (id: string) => {
		source.asked.push(id);
		const episodes = source.lists.get(id);
		if (!episodes) return null;
		return {
			sourceId: '7',
			details: { url: `/${id}`, title: 'A show', description: '', status: 1 },
			episodes
		};
	}
}));

vi.mock('$lib/server/anime/streams', async (original) => ({
	...(await original<typeof import('$lib/server/anime/streams')>()),
	episodeStreams: async () => ({
		entryId: 0,
		intro: null,
		ending: null,
		resolvedAt: 0,
		servers: [
			{
				name: 'One',
				qualities: [{ height: 360, kind: 'hls', src: '/fake', audio: [], subtitles: [] }]
			}
		]
	}),
	probe: async () => ({ seconds: 1 })
}));

const { getDb } = await import('$lib/server/db');
const facts = await import('$lib/server/season-facts');
const { sourceMangaId } = await import('$lib/server/engine/backend');
const { checkAnime, followAnime } = await import('$lib/server/anime/follow');
const { refreshMany, refreshSeries } = await import('$lib/server/refresh');
const { downloadEpisode, episodePlace, seriesFolder, isAnimeSeries } =
	await import('$lib/server/anime/download');
const { episodeRow } = await import('$lib/server/anime/streams');
const browseIndex = await import('$lib/server/library-sources');
const { recordView } = await import('$lib/server/browsing');
const { addAnime, browseAnime } = await import('$lib/server/engine/anime-source');

const db = getDb();
db.prepare(`INSERT INTO roots (id, name, path, hidden) VALUES (1, 'Anime', '/lib/Anime', 0)`).run();

let next = 0;
function show(title: string, key: string | null): number {
	next += 1;
	return Number(
		db
			.prepare(
				`INSERT INTO series (root_id, title, kind, added_at, indexed_at, origin_key)
				VALUES (1, ?, 'anime', ?, ?, ?)`
			)
			.run(title, next, next, key).lastInsertRowid
	);
}
function episode(seriesId: number, season: number | null, number: number): number {
	next += 1;
	return Number(
		db
			.prepare(
				`INSERT INTO entries (series_id, position, label, title, added_at, source_url, season, episode_number)
				VALUES (?, ?, ?, '', 1, ?, ?, ?)`
			)
			.run(seriesId, next, `Ep. ${number}`, `/ep/${next}`, season, number).lastInsertRowid
	);
}

beforeEach(() => {
	db.exec(`DELETE FROM series_season_facts; DELETE FROM entries; DELETE FROM series;
		DELETE FROM anime_checks; DELETE FROM anime_series;`);
	source.lists.clear();
	source.asked = [];
});

const idOf = (url: string) => sourceMangaId('7', url);
const listing = (url: string, numbers: number[]) =>
	source.lists.set(
		idOf(url),
		numbers.map((n) => ({
			url: `${url}/ep-${n}`,
			name: `Episode ${n}`,
			episode_number: n
		}))
	);
const rows = (id: number) =>
	db
		.prepare(
			`SELECT source_url AS url, season, episode_number AS n, position FROM entries
			WHERE series_id = ? ORDER BY position`
		)
		.all(id) as { url: string; season: number | null; n: number; position: number }[];

describe('the resolver', () => {
	it('answers the series’ own key for a series with no rows, whichever season is asked', () => {
		const id = show('Plain', 'aniyomi:1:/plain');
		for (const season of [null, 0, 1, 7])
			expect(facts.seasonOrigin(id, season, db)).toBe('aniyomi:1:/plain');
		expect(facts.seasonFacts(id, db)).toEqual([]);
		expect(facts.followOrigin(id, db)).toEqual({ key: 'aniyomi:1:/plain', season: null });
	});

	it('answers a season’s own key, and the series’ for a season with no row', () => {
		const id = show('Merged', 'aniyomi:1:/s1');
		facts.putSeasonFact({ seriesId: id, season: 2, originKey: 'aniyomi:2:/s2' }, db);
		expect(facts.seasonOrigin(id, 2, db)).toBe('aniyomi:2:/s2');
		expect(facts.seasonOrigin(id, 1, db)).toBe('aniyomi:1:/s1');
		expect(facts.seasonOrigin(id, 3, db)).toBe('aniyomi:1:/s1');
	});

	it('reads a row with no key as no row at all', () => {
		const id = show('Folder only', 'aniyomi:1:/s1');
		facts.putSeasonFact({ seriesId: id, season: 2, originKey: null, folder: 'Anime/F' }, db);
		expect(facts.seasonOrigin(id, 2, db)).toBe('aniyomi:1:/s1');
		expect(facts.followOrigin(id, db)).toEqual({ key: 'aniyomi:1:/s1', season: null });
	});

	it('reads an entry with no season as season 0, the flat list’s row, as c240 does', () => {
		const id = show('Flat', 'aniyomi:1:/series');
		const flat = episode(id, null, 1);
		const one = episode(id, 1, 1);
		expect(facts.entryOrigin(flat, db)).toBe('aniyomi:1:/series');
		facts.putSeasonFact({ seriesId: id, season: 1, originKey: 'aniyomi:2:/one' }, db);
		expect(facts.entryOrigin(flat, db)).toBe('aniyomi:1:/series');
		expect(facts.entryOrigin(one, db)).toBe('aniyomi:2:/one');
		facts.putSeasonFact({ seriesId: id, season: 0, originKey: 'aniyomi:2:/flat' }, db);
		expect(facts.entryOrigin(flat, db)).toBe('aniyomi:2:/flat');
	});

	it('the SQL expression says what the function says, for every shape of row', () => {
		const id = show('Every shape', 'aniyomi:1:/series');
		const eps = [null, 0, 1, 2, 3].map((s, i) => episode(id, s, i + 1));
		facts.putSeasonFact({ seriesId: id, season: 0, originKey: 'aniyomi:2:/zero' }, db);
		facts.putSeasonFact({ seriesId: id, season: 1, originKey: null, folder: 'Anime/x' }, db);
		facts.putSeasonFact({ seriesId: id, season: 2, originKey: 'aniyomi:2:/two' }, db);
		for (const e of eps) {
			const { k } = db
				.prepare(
					`SELECT ${facts.entryOriginSql('e', 's')} AS k FROM entries e
					JOIN series s ON s.id = e.series_id WHERE e.id = ?`
				)
				.get(e) as { k: string };
			const { season } = db.prepare(`SELECT season FROM entries WHERE id = ?`).get(e) as {
				season: number | null;
			};
			expect(k).toBe(facts.seasonOrigin(id, season, db));
		}
	});

	it('a deleted series takes its rows with it', () => {
		const id = show('Gone', 'aniyomi:1:/gone');
		facts.putSeasonFact({ seriesId: id, season: 1, originKey: 'aniyomi:2:/gone' }, db);
		db.prepare(`DELETE FROM series WHERE id = ?`).run(id);
		expect(facts.seasonFacts(id, db)).toEqual([]);
		expect(facts.seriesHolding('aniyomi:2:/gone', db)).toBeNull();
	});
});

describe('which season FOLLOW asks', () => {
	it('asks the last season’s own key, and says that season owns what it lists', () => {
		const id = show('Airing', 'aniyomi:1:/s1');
		episode(id, 1, 1);
		episode(id, 2, 1);
		facts.putSeasonFact({ seriesId: id, season: 1, originKey: 'aniyomi:1:/s1' }, db);
		facts.putSeasonFact({ seriesId: id, season: 2, originKey: 'aniyomi:2:/s2' }, db);
		expect(facts.followOrigin(id, db)).toEqual({ key: 'aniyomi:2:/s2', season: 2 });
	});

	it('asks the series’ key when the last season has no row, even with rows before it', () => {
		const id = show('Partial', 'aniyomi:1:/series');
		episode(id, 3, 1);
		facts.putSeasonFact({ seriesId: id, season: 1, originKey: 'aniyomi:2:/s1' }, db);
		facts.putSeasonFact({ seriesId: id, season: 2, originKey: 'aniyomi:2:/s2' }, db);
		expect(facts.lastSeason(id, db)).toBe(3);
		expect(facts.followOrigin(id, db)).toEqual({ key: 'aniyomi:1:/series', season: null });
	});

	it('counts a season with a row and no episodes yet as the last', () => {
		const id = show('Just merged', 'aniyomi:1:/s1');
		episode(id, 1, 1);
		facts.putSeasonFact({ seriesId: id, season: 2, originKey: 'aniyomi:2:/s2' }, db);
		expect(facts.followOrigin(id, db)).toEqual({ key: 'aniyomi:2:/s2', season: 2 });
	});

	it('claims no season for a key two seasons share, nor for the series’ own key', () => {
		const id = show('Shared', 'aniyomi:1:/series');
		episode(id, 2, 1);
		facts.putSeasonFact({ seriesId: id, season: 1, originKey: 'aniyomi:2:/both' }, db);
		facts.putSeasonFact({ seriesId: id, season: 2, originKey: 'aniyomi:2:/both' }, db);
		expect(facts.followOrigin(id, db)).toEqual({ key: 'aniyomi:2:/both', season: null });
		facts.putSeasonFact({ seriesId: id, season: 1, originKey: null }, db);
		facts.putSeasonFact({ seriesId: id, season: 2, originKey: 'aniyomi:1:/series' }, db);
		expect(facts.followOrigin(id, db)).toEqual({ key: 'aniyomi:1:/series', season: null });
	});
});

describe('who holds a key', () => {
	it('finds a season’s key, and prefers the series whose own key it is', () => {
		const a = show('A', 'aniyomi:1:/a');
		const b = show('B', 'aniyomi:1:/b');
		facts.putSeasonFact({ seriesId: b, season: 2, originKey: 'aniyomi:1:/b2' }, db);
		expect(facts.seriesHolding('aniyomi:1:/b2', db)?.id).toBe(b);
		expect(facts.seriesHolding('aniyomi:1:/a', db)?.id).toBe(a);
		expect(facts.seriesHolding('aniyomi:1:/nobody', db)).toBeNull();
	});

	it('refuses a key another series holds, as its own or a season’s, and allows its own', () => {
		const a = show('A', 'aniyomi:1:/a');
		const b = show('B', 'aniyomi:1:/b');
		facts.putSeasonFact({ seriesId: b, season: 2, originKey: 'aniyomi:1:/b2' }, db);
		const put =
			(key: string, seriesId = a) =>
			() =>
				facts.putSeasonFact({ seriesId, season: 9, originKey: key }, db);
		expect(put('aniyomi:1:/b')).toThrow(facts.SeasonFactError);
		expect(put('aniyomi:1:/b2')).toThrow(facts.SeasonFactError);
		expect(put('aniyomi:1:/a')).not.toThrow();
		expect(facts.heldByOther('aniyomi:1:/b2', b, db)).toBeNull();
		expect(facts.heldByOther('aniyomi:1:/b2', a, db)?.id).toBe(b);
	});

	it('names a folder taken by a season and by a series alike', () => {
		const a = show('A', 'aniyomi:1:/a');
		db.prepare(`INSERT INTO anime_series (series_id, folder) VALUES (?, 'Anime/Own')`).run(a);
		facts.putSeasonFact({ seriesId: a, season: 2, folder: 'Anime/Season' }, db);
		expect(facts.folderTaken('Anime/Own', db)).toBe(true);
		expect(facts.folderTaken('Anime/Season', db)).toBe(true);
		expect(facts.folderTaken('Anime/Free', db)).toBe(false);
	});
});

describe('FOLLOW and REFRESH ask the last season', () => {
	it('adds what the last season’s source lists, stamped with that season, after the seasons before it', async () => {
		const id = show('Airing', 'aniyomi:7:/s1');
		episode(id, 1, 1);
		episode(id, 1, 2);
		episode(id, 2, 1);
		facts.putSeasonFact({ seriesId: id, season: 2, originKey: 'aniyomi:7:/s2' }, db);
		db.prepare(`UPDATE entries SET position = 1 WHERE season = 2`).run();
		listing('/s2', [1, 2]);
		const got = await checkAnime(id, 1000, db, { queue: false });
		expect(got).toEqual({ added: 2, queued: 0 });
		expect(source.asked).toEqual([idOf('/s2')]);
		expect(rows(id).map((r) => [r.season, r.n])).toEqual([
			[1, 1],
			[1, 2],
			[2, 1],
			[2, 1],
			[2, 2]
		]);
		expect(rows(id).map((r) => r.position)).toEqual([1, 2, 3, 4, 5]);
	});

	it('asks the series’ source when the last season has no row', async () => {
		const id = show('Partial', 'aniyomi:7:/series');
		episode(id, 3, 1);
		facts.putSeasonFact({ seriesId: id, season: 1, originKey: 'aniyomi:7:/s1' }, db);
		listing('/series', [2]);
		await checkAnime(id, 1000, db, { queue: false });
		expect(source.asked).toEqual([idOf('/series')]);
		// The source's own stamps stand: nothing here says it is one season's.
		expect(rows(id).find((r) => r.url === '/series/ep-2')?.season).toBeNull();
	});

	it('trusts the source’s own stamps for a key two seasons share', async () => {
		const id = show('Shared', 'aniyomi:7:/series');
		episode(id, 2, 1);
		facts.putSeasonFact({ seriesId: id, season: 1, originKey: 'aniyomi:7:/both' }, db);
		facts.putSeasonFact({ seriesId: id, season: 2, originKey: 'aniyomi:7:/both' }, db);
		source.lists.set(idOf('/both'), [
			{ url: '/both/ep-1', name: 'Season 1 - Episode 1', episode_number: 1 },
			{ url: '/both/ep-9', name: 'Season 2 - Episode 9', episode_number: 9 }
		]);
		await checkAnime(id, 1000, db, { queue: false });
		expect(source.asked).toEqual([idOf('/both')]);
		expect(rows(id).find((r) => r.url === '/both/ep-1')?.season).toBe(1);
		expect(rows(id).find((r) => r.url === '/both/ep-9')?.season).toBe(2);
	});

	it('finds a series whose only anime key is a season’s, and REFRESH goes the same way', async () => {
		const id = show('No key of its own', null);
		facts.putSeasonFact({ seriesId: id, season: 1, originKey: 'aniyomi:7:/s1' }, db);
		listing('/s1', [1]);
		expect(await refreshSeries(id, 1000)).toEqual({ kind: 'anime', added: 1 });
		expect(source.asked).toEqual([idOf('/s1')]);
	});

	it('FOLLOW’s step takes a series on a season’s key, and REFRESH counts it sourced', async () => {
		const id = show('Followed', null);
		db.prepare(`UPDATE series SET followed_at = 1 WHERE id = ?`).run(id);
		facts.putSeasonFact({ seriesId: id, season: 1, originKey: 'aniyomi:7:/s1' }, db);
		listing('/s1', [1]);
		const step = await followAnime(100_000_000, db);
		expect(step.series).toBe(1);
		const batch = await refreshMany([id], { reveal: true, now: 200_000_000 });
		expect(batch).toMatchObject({ asked: 1, skipped: 0 });
	});

	it('moves nothing for a series with no rows beyond what it always did', async () => {
		const id = show('Plain', 'aniyomi:7:/plain');
		listing('/plain', [1, 2]);
		await checkAnime(id, 1000, db, { queue: false });
		// The plan's own positions and no stamp: the base's answer (see the notes' differential).
		expect(rows(id).map((r) => [r.url, r.season, r.position])).toEqual([
			['/plain/ep-1', null, 1],
			['/plain/ep-2', null, 2]
		]);
	});
});

describe('each season keeps its own folder', () => {
	const row = (id: number) =>
		db
			.prepare(
				`SELECT id, title, hidden, description, status, source, origin_key FROM series WHERE id = ?`
			)
			.get(id) as Parameters<typeof seriesFolder>[1];
	const deps = { db, library, now: () => 1000 };

	it('a season with a folder keeps it, and a series with no rows keeps its one', () => {
		const a = show('Merged', 'aniyomi:7:/s1');
		facts.putSeasonFact(
			{ seriesId: a, season: 2, originKey: 'aniyomi:7:/s2', folder: 'Anime/Merged II' },
			db
		);
		expect(episodePlace(db, row(a), 2).folder).toBe('Anime/Merged II');
		expect(episodePlace(db, row(a), 1).folder).toBe('Anime/Merged');
		const plain = show('Plain', 'aniyomi:7:/plain');
		expect(episodePlace(db, row(plain), 3)).toMatchObject({
			folder: 'Anime/Plain',
			key: 'aniyomi:7:/plain',
			season: null
		});
		// Fixed at the first ask (rung 48), whichever door asks.
		expect(db.prepare(`SELECT folder FROM anime_series WHERE series_id = ?`).get(plain)).toEqual({
			folder: 'Anime/Plain'
		});
	});

	it('a season with its own source gets a folder at its first download, under the source’s name', () => {
		const a = show('Merged', 'aniyomi:7:/s1');
		facts.putSeasonFact(
			{ seriesId: a, season: 2, originKey: 'aniyomi:7:/s2', sourceTitle: 'Merged Second' },
			db
		);
		expect(episodePlace(db, row(a), 2).folder).toBe('Anime/Merged Second');
		expect(facts.seasonFact(a, 2, db)?.folder).toBe('Anime/Merged Second');
		// Asking again answers the same folder, not the next free one.
		expect(episodePlace(db, row(a), 2).folder).toBe('Anime/Merged Second');
	});

	it('a season’s name already taken by another series walks on, as a series’ does', () => {
		const other = show('Merged Second', 'aniyomi:7:/other');
		seriesFolder(db, row(other));
		const a = show('Merged', 'aniyomi:7:/s1');
		facts.putSeasonFact(
			{ seriesId: a, season: 2, originKey: 'aniyomi:7:/s2', sourceTitle: 'Merged Second' },
			db
		);
		expect(episodePlace(db, row(a), 2).folder).toBe('Anime/Merged Second (2)');
	});

	it('a series never takes a folder a season holds', () => {
		const a = show('Merged', 'aniyomi:7:/s1');
		facts.putSeasonFact({ seriesId: a, season: 2, folder: 'Anime/Late Arrival' }, db);
		const b = show('Late Arrival', 'aniyomi:7:/late');
		expect(seriesFolder(db, row(b))).toBe('Anime/Late Arrival (2)');
	});

	it('two seasons sharing a source share a folder, with one row holding it', () => {
		const a = show('Merged', 'aniyomi:7:/series');
		facts.putSeasonFact(
			{ seriesId: a, season: 2, originKey: 'aniyomi:7:/both', sourceTitle: 'Both' },
			db
		);
		facts.putSeasonFact(
			{ seriesId: a, season: 3, originKey: 'aniyomi:7:/both', sourceTitle: 'Both' },
			db
		);
		expect(episodePlace(db, row(a), 2).folder).toBe('Anime/Both');
		expect(episodePlace(db, row(a), 3).folder).toBe('Anime/Both');
		expect(facts.seasonFact(a, 3, db)?.folder).toBeNull();
	});

	it('a row saying nothing of its files is the series’ folder: title only, or its key the series’', () => {
		const a = show('Merged', 'aniyomi:7:/s1');
		facts.putSeasonFact({ seriesId: a, season: 2, sourceTitle: 'Called something' }, db);
		facts.putSeasonFact({ seriesId: a, season: 3, originKey: 'aniyomi:7:/s1' }, db);
		expect(episodePlace(db, row(a), 2).folder).toBe('Anime/Merged');
		expect(episodePlace(db, row(a), 3).folder).toBe('Anime/Merged');
	});

	it('downloads into the season’s folder, with that season’s key in its tvshow.nfo', async () => {
		const a = show('Merged', 'aniyomi:7:/s1');
		facts.putSeasonFact(
			{ seriesId: a, season: 2, originKey: 'aniyomi:7:/s2', sourceTitle: 'Merged Second' },
			db
		);
		const ep = episode(a, 2, 3);
		const path = await downloadEpisode(ep, deps);
		expect(path).toBe(
			join(library, 'Anime', 'Merged Second', 'Season 02', 'Merged Second S02E03.mkv')
		);
		expect(existsSync(path)).toBe(true);
		const nfo = readFileSync(join(library, 'Anime', 'Merged Second', 'tvshow.nfo'), 'utf8');
		expect(nfo).toContain('aniyomi:7:/s2');
		expect(nfo).toContain('<title>Merged Second</title>');
		// And no season row: the series' own folder, its own key and title, as before.
		const b = show('Plain', 'aniyomi:7:/plain');
		await downloadEpisode(episode(b, 1, 1), deps);
		const own = readFileSync(join(library, 'Anime', 'Plain', 'tvshow.nfo'), 'utf8');
		expect(own).toContain('aniyomi:7:/plain');
		expect(own).toContain('<title>Plain</title>');
	});

	it('a hidden series’ season folder stays with the hidden ones', () => {
		const a = show('Quiet', 'aniyomi:7:/s1');
		db.prepare(`UPDATE series SET hidden = 1 WHERE id = ?`).run(a);
		facts.putSeasonFact({ seriesId: a, season: 2, originKey: 'aniyomi:7:/s2' }, db);
		expect(episodePlace(db, row(a), 2).folder).toBe('Anime (hidden)/Quiet');
	});
});

describe('a stream and the series screen ask the entry’s season', () => {
	it('resolves an episode to its season’s key, and a season without a row to the series’', () => {
		const a = show('Merged', 'aniyomi:7:/s1');
		facts.putSeasonFact({ seriesId: a, season: 2, originKey: 'aniyomi:9:/s2' }, db);
		expect(episodeRow(episode(a, 2, 1), true)?.origin_key).toBe('aniyomi:9:/s2');
		expect(episodeRow(episode(a, 1, 1), true)?.origin_key).toBe('aniyomi:7:/s1');
		expect(episodeRow(episode(a, 3, 1), true)?.origin_key).toBe('aniyomi:7:/s1');
	});

	it('counts a series as an anime by the key it would follow', () => {
		const a = show('No key of its own', null);
		expect(isAnimeSeries(a, db)).toBe(false);
		facts.putSeasonFact({ seriesId: a, season: 1, originKey: 'aniyomi:7:/s1' }, db);
		expect(isAnimeSeries(a, db)).toBe(true);
	});
});

describe('IN LIBRARY and SAME TITLE, by each season’s source', () => {
	beforeEach(() => browseIndex.forgetSourceUse());

	it('finds a season’s key, counting that season’s episodes, and the series’ key the rest', () => {
		const a = show('Merged', 'aniyomi:7:/s1');
		episode(a, 1, 1);
		episode(a, 1, 2);
		episode(a, 2, 1);
		facts.putSeasonFact({ seriesId: a, season: 2, originKey: 'aniyomi:9:/s2' }, db);
		const { byKey } = browseIndex.libraryIndex(true);
		expect(byKey.get('aniyomi:9:/s2')).toMatchObject({ id: a, total: 1 });
		expect(byKey.get('aniyomi:7:/s1')).toMatchObject({ id: a, total: 2 });
	});

	it('counts two seasons sharing a key as one key with both seasons’ episodes', () => {
		const a = show('Merged', 'aniyomi:7:/series');
		episode(a, 1, 1);
		episode(a, 2, 1);
		episode(a, 2, 2);
		facts.putSeasonFact({ seriesId: a, season: 1, originKey: 'aniyomi:9:/both' }, db);
		facts.putSeasonFact({ seriesId: a, season: 2, originKey: 'aniyomi:9:/both' }, db);
		expect(browseIndex.libraryIndex(true).byKey.get('aniyomi:9:/both')?.total).toBe(3);
	});

	it('offers SAME TITLE by the name the season’s source gave it, under that source', () => {
		const a = show('Merged', 'aniyomi:7:/s1');
		facts.putSeasonFact(
			{ seriesId: a, season: 2, originKey: 'aniyomi:9:/s2', sourceTitle: 'Merged Second' },
			db
		);
		const { sameTitle } = browseIndex.libraryIndex(true);
		expect(sameTitle('aniyomi:7:/x', 'Merged Second')).toBe('9');
		expect(sameTitle('aniyomi:7:/x', 'Merged')).toBe('7');
	});

	it('keeps a hidden series’ seasons out of SAME TITLE, unless revealing', () => {
		const a = show('Quiet', 'aniyomi:7:/s1');
		db.prepare(`UPDATE series SET hidden = 1 WHERE id = ?`).run(a);
		facts.putSeasonFact(
			{ seriesId: a, season: 2, originKey: 'aniyomi:9:/s2', sourceTitle: 'Quiet Second' },
			db
		);
		expect(
			browseIndex.libraryIndex(false).sameTitle('aniyomi:7:/x', 'Quiet Second')
		).toBeUndefined();
		expect(browseIndex.libraryIndex(true).sameTitle('aniyomi:7:/x', 'Quiet Second')).toBe('9');
	});

	it('counts a series once at a source however many of its seasons are there', () => {
		const a = show('Merged', 'aniyomi:7:/s1');
		facts.putSeasonFact({ seriesId: a, season: 2, originKey: 'aniyomi:7:/s2' }, db);
		facts.putSeasonFact({ seriesId: a, season: 3, originKey: 'aniyomi:9:/s3' }, db);
		const use = browseIndex.sourceUse();
		expect(use.get('7')).toEqual({ series: 1, hidden: 0 });
		expect(use.get('9')).toEqual({ series: 1, hidden: 0 });
	});

	it('finds a queued key’s series by a season’s key, and a series with none by its own', () => {
		const a = show('Merged', 'aniyomi:7:/s1');
		facts.putSeasonFact({ seriesId: a, season: 2, originKey: 'aniyomi:9:/s2' }, db);
		const b = show('Plain', 'aniyomi:7:/plain');
		expect(browseIndex.seriesForKey('aniyomi:9:/s2')?.id).toBe(a);
		expect(browseIndex.seriesForKey('aniyomi:7:/plain')?.id).toBe(b);
		expect(browseIndex.seriesForKey('aniyomi:7:/nobody')).toBeNull();
	});

	it('ADD and an open of a source entry that is a season find the series, and ask nothing', async () => {
		const a = show('Merged', 'aniyomi:7:/s1');
		facts.putSeasonFact({ seriesId: a, season: 2, originKey: 'aniyomi:7:/s2' }, db);
		const id = sourceMangaId('7', '/s2');
		expect(await addAnime(id)).toBe(a);
		expect(await browseAnime(id)).toBe(a);
		expect(source.asked).toEqual([]);
	});

	it('a browsing record is found by a season’s key too', () => {
		const a = show('Browsed', 'aniyomi:7:/s1');
		db.prepare(`UPDATE series SET in_library = 0, browsed_at = 5 WHERE id = ?`).run(a);
		facts.putSeasonFact({ seriesId: a, season: 2, originKey: 'aniyomi:7:/s2' }, db);
		expect(recordView('aniyomi:7:/s2', db)?.seriesId).toBe(a);
		expect(recordView('aniyomi:7:/s1', db)?.seriesId).toBe(a);
	});
});

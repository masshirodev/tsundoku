import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
	chmodSync,
	existsSync,
	mkdirSync,
	mkdtempSync,
	readFileSync,
	rmSync,
	writeFileSync
} from 'node:fs';
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
	asked: [] as string[],
	/** Episodes the fingerprint read streams for; `refuseStreams` ends it there, before ffmpeg. */
	streamed: [] as number[],
	refuseStreams: false
}));
vi.mock('$lib/server/engine/anime-source', async (original) => ({
	...(await original<typeof import('$lib/server/engine/anime-source')>()),
	fetchAnime: async (id: string) => {
		source.asked.push(id);
		const episodes = source.lists.get(id);
		if (!episodes) return null;
		return {
			sourceId: '7',
			details: {
				url: Buffer.from(id.split('~')[1], 'base64url').toString(),
				title: 'A show',
				description: '',
				status: 1
			},
			episodes
		};
	}
}));

vi.mock('$lib/server/anime/streams', async (original) => ({
	...(await original<typeof import('$lib/server/anime/streams')>()),
	episodeStreams: async (entryId: number) => {
		source.streamed.push(entryId);
		if (source.refuseStreams) return null;
		return {
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
		};
	},
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
const { episodeNfo, tvshowNfo } = await import('$lib/library/anime-files');
const browseIndex = await import('$lib/server/library-sources');
const { recordView } = await import('$lib/server/browsing');
const { addAnime, browseAnime } = await import('$lib/server/engine/anime-source');
const move = await import('$lib/server/move');
const { lookupAniSkip } = await import('$lib/server/anime/aniskip');
const { fingerprintSeason } = await import('$lib/server/anime/skip-marks');
const { writeSeries } = await import('$lib/server/import/write');
const { planAnimeFolders, planAnimeSeries } = await import('$lib/server/import/anime');

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
	source.streamed = [];
	source.refuseStreams = false;
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

describe('the anime importer folds a season’s folder onto its series', () => {
	const NOW = 2_000_000;
	// A folder as the downloader leaves it (episodeNfo and tvshowNfo, in anime-download-db's real files).
	function folderOnDisk(name: string, key: string, title: string, episodes: [number, number][]) {
		const dir = join(library, 'Anime', name);
		for (const [season, number] of episodes) {
			const rel = `Season ${String(season).padStart(2, '0')}`;
			mkdirSync(join(dir, rel), { recursive: true });
			const base = `${name} S${String(season).padStart(2, '0')}E${String(number).padStart(2, '0')}`;
			writeFileSync(join(dir, rel, `${base}.mkv`), 'x');
			writeFileSync(
				join(dir, rel, `${base}.nfo`),
				episodeNfo({
					sourceUrl: `${key}/ep-${season}-${number}`,
					title: '',
					season,
					number,
					position: number,
					durationS: 60,
					note: ''
				})
			);
		}
		writeFileSync(
			join(dir, 'tvshow.nfo'),
			tvshowNfo({ key, title, plot: '', status: '', genres: [], source: 'S' })
		);
		return dir;
	}
	const scan = () => {
		for (const plan of planAnimeFolders(library, () => {}, NOW))
			writeSeries(plan, { rootId: 1, jobId: null, now: NOW, markMissing: true }, db);
	};
	const clearDisk = () => rmSync(join(library, 'Anime'), { recursive: true, force: true });
	beforeEach(clearDisk);
	afterAll(clearDisk);
	const entriesOf = (id: number) =>
		db
			.prepare(
				`SELECT source_url, file, available, season FROM entries WHERE series_id = ? ORDER BY source_url`
			)
			.all(id) as { source_url: string; file: string; available: number; season: number | null }[];

	it('a season’s folder lands on the series, named from the series’ own folder', () => {
		const dirA = folderOnDisk('Merged', 'aniyomi:7:/s1', 'Merged', [[1, 1]]);
		const dirB = folderOnDisk('Merged II', 'aniyomi:7:/s2', 'Merged II', [[2, 1]]);
		scan();
		const id = (
			db.prepare(`SELECT id FROM series WHERE origin_key = 'aniyomi:7:/s1'`).get() as { id: number }
		).id;
		expect(db.prepare(`SELECT path FROM series WHERE id = ?`).get(id)).toEqual({ path: dirA });
		// As they stood on the first scan: two series, until a later slice merges them.
		db.prepare(`DELETE FROM series WHERE origin_key = 'aniyomi:7:/s2'`).run();
		facts.putSeasonFact(
			{ seriesId: id, season: 2, originKey: 'aniyomi:7:/s2', folder: 'Anime/Merged II' },
			db
		);
		scan();
		const count = db
			.prepare(`SELECT COUNT(*) AS n FROM series WHERE origin_key = 'aniyomi:7:/s2'`)
			.get() as { n: number };
		expect(count.n).toBe(0);
		expect(db.prepare(`SELECT path FROM series WHERE id = ?`).get(id)).toEqual({ path: dirA });
		const eps = entriesOf(id);
		expect(eps).toHaveLength(2);
		const two = eps.find((e) => e.season === 2)!;
		expect(two.file).toBe('../Merged II/Season 02/Merged II S02E01.mkv');
		expect(two.available).toBe(1);
		// The relative name resolves to the season's real file.
		expect(existsSync(join(dirA, two.file))).toBe(true);
		expect(existsSync(join(dirB, 'Season 02/Merged II S02E01.mkv'))).toBe(true);
	});

	it('a later scan of the series’ folder does not call the season’s files missing, nor the reverse', () => {
		folderOnDisk('Merged', 'aniyomi:7:/s1', 'Merged', [[1, 1]]);
		folderOnDisk('Merged II', 'aniyomi:7:/s2', 'Merged II', [[2, 1]]);
		scan();
		const id = (
			db.prepare(`SELECT id FROM series WHERE origin_key = 'aniyomi:7:/s1'`).get() as { id: number }
		).id;
		db.prepare(`DELETE FROM series WHERE origin_key = 'aniyomi:7:/s2'`).run();
		facts.putSeasonFact(
			{ seriesId: id, season: 2, originKey: 'aniyomi:7:/s2', folder: 'Anime/Merged II' },
			db
		);
		scan();
		scan();
		expect(entriesOf(id).map((e) => e.available)).toEqual([1, 1]);
	});

	it('planAnimeSeries, the downloader’s own door, finds the same series', () => {
		const a = show('Merged', 'aniyomi:7:/s1');
		db.prepare(`UPDATE series SET path = ? WHERE id = ?`).run(join(library, 'Anime', 'Merged'), a);
		facts.putSeasonFact(
			{ seriesId: a, season: 2, originKey: 'aniyomi:7:/s2', folder: 'Anime/Late' },
			db
		);
		const dir = folderOnDisk('Late', 'aniyomi:7:/s2', 'Late', [[2, 4]]);
		const [plan] = planAnimeSeries(library, join(dir, 'Season 02', 'Late S02E04.mkv'), NOW);
		const r = writeSeries(plan, { rootId: 1, jobId: null, now: NOW, markMissing: false }, db);
		expect(r).toMatchObject({ created: false, entriesAdded: 1 });
		expect(entriesOf(a)[0].file).toBe('../Late/Season 02/Late S02E04.mkv');
	});

	describe('whichever folder is imported first', () => {
		const KEY = 'aniyomi:7:/merged';
		const LATE = 'aniyomi:7:/late';
		const FIRST = `${KEY}/ep-1-1`;
		const SECOND = `${LATE}/ep-2-1`;
		// A series the owner added from a source: no folder yet, and two episodes waiting.
		function waiting(): number {
			const a = show('Merged', KEY);
			for (const [url, season] of [
				[FIRST, 1],
				[SECOND, 2]
			] as const)
				db.prepare(
					`INSERT INTO entries (series_id, position, label, title, added_at, source_url, season, episode_number, available)
					VALUES (?, ?, 'Ep. 1', '', 1, ?, ?, 1, 0)`
				).run(a, season, url, season);
			facts.putSeasonFact({ seriesId: a, season: 2, originKey: LATE, folder: 'Anime/Late' }, db);
			folderOnDisk('Late', LATE, 'Late', [[2, 1]]);
			folderOnDisk('Merged', KEY, 'Merged', [[1, 1]]);
			return a;
		}
		const pathOf = (id: number) =>
			(db.prepare(`SELECT path FROM series WHERE id = ?`).get(id) as { path: string }).path;
		const arrivedOf = (url: string) =>
			(
				db.prepare(`SELECT arrived_at AS at FROM entries WHERE source_url = ?`).get(url) as {
					at: number | null;
				}
			).at;
		const importFolder = (name: string, now: number) => {
			const dir = join(library, 'Anime', name);
			for (const plan of planAnimeSeries(library, join(dir, 'tvshow.nfo'), now))
				writeSeries(plan, { rootId: 1, jobId: null, now, markMissing: true }, db);
		};
		function expectBothHere(id: number) {
			const eps = entriesOf(id);
			expect(eps.map((e) => e.available)).toEqual([1, 1]);
			for (const e of eps) expect(existsSync(join(pathOf(id), e.file))).toBe(true);
			expect(pathOf(id)).toBe(join(library, 'Anime', 'Merged'));
			expect(eps.find((e) => e.season === 2)!.file).toBe('../Late/Season 02/Late S02E01.mkv');
		}

		it('the season’s folder first, one at a time: both keep their files, and the season did not arrive twice', () => {
			const a = waiting();
			importFolder('Late', NOW);
			expect(arrivedOf(SECOND)).toBe(NOW);
			importFolder('Merged', NOW + 5);
			expectBothHere(a);
			expect(arrivedOf(SECOND)).toBe(NOW);
			expect(arrivedOf(FIRST)).toBe(NOW + 5);
		});

		it('the season’s folder first, by a full scan, and every scan after it finds the same', () => {
			const a = waiting();
			// The order the review named: `Late` sorts before `Merged`.
			const order = planAnimeFolders(library, () => {}, NOW).map((p) => p.path);
			expect(order).toEqual([join(library, 'Anime', 'Late'), join(library, 'Anime', 'Merged')]);
			scan();
			expectBothHere(a);
			expect(arrivedOf(SECOND)).toBe(NOW);
			for (const plan of planAnimeFolders(library, () => {}, NOW + 9))
				writeSeries(plan, { rootId: 1, jobId: null, now: NOW + 9, markMissing: true }, db);
			expectBothHere(a);
			expect(arrivedOf(SECOND)).toBe(NOW);
			expect(arrivedOf(FIRST)).toBe(NOW);
		});

		it('the series’ folder first ends in the same place', () => {
			const a = waiting();
			importFolder('Merged', NOW);
			importFolder('Late', NOW + 5);
			expectBothHere(a);
			expect(arrivedOf(SECOND)).toBe(NOW + 5);
			expect(arrivedOf(FIRST)).toBe(NOW);
		});

		it('two season folders before the series’ own: each file is still found from the series’ folder', () => {
			const a = waiting();
			const NEXT = 'aniyomi:7:/next';
			db.prepare(
				`INSERT INTO entries (series_id, position, label, title, added_at, source_url, season, episode_number, available)
				VALUES (?, 3, 'Ep. 1', '', 1, ?, 3, 1, 0)`
			).run(a, `${NEXT}/ep-3-1`);
			facts.putSeasonFact({ seriesId: a, season: 3, originKey: NEXT, folder: 'Anime/Later' }, db);
			folderOnDisk('Later', NEXT, 'Later', [[3, 1]]);
			importFolder('Late', NOW);
			importFolder('Later', NOW + 1);
			importFolder('Merged', NOW + 2);
			const eps = entriesOf(a);
			expect(eps.map((e) => e.available)).toEqual([1, 1, 1]);
			for (const e of eps) expect(existsSync(join(pathOf(a), e.file))).toBe(true);
			expect(arrivedOf(SECOND)).toBe(NOW);
			expect(arrivedOf(`${NEXT}/ep-3-1`)).toBe(NOW + 1);
		});

		it('an episode not downloaded stays with no file, and a season’s folder alone stays the series’ path', () => {
			const a = waiting();
			importFolder('Late', NOW);
			expect(pathOf(a)).toBe(join(library, 'Anime', 'Late'));
			expect(entriesOf(a).find((e) => e.season === 1)).toMatchObject({ file: '', available: 0 });
			importFolder('Merged', NOW + 1);
			rmSync(join(library, 'Anime', 'Merged', 'Season 01'), { recursive: true });
			importFolder('Merged', NOW + 2);
			// The series' folder answers for its own file, and only that.
			expect(entriesOf(a).find((e) => e.season === 1)).toMatchObject({ available: 0 });
			expect(entriesOf(a).find((e) => e.season === 2)).toMatchObject({ available: 1 });
		});
	});

	it('a series with no rows imports exactly as it did', () => {
		const dir = folderOnDisk('Plain', 'aniyomi:7:/plain', 'Plain', [
			[1, 1],
			[1, 2]
		]);
		scan();
		const r = db
			.prepare(`SELECT id, path FROM series WHERE origin_key = 'aniyomi:7:/plain'`)
			.get() as {
			id: number;
			path: string;
		};
		expect(r.path).toBe(dir);
		expect(entriesOf(r.id).map((e) => e.file)).toEqual([
			'Season 01/Plain S01E01.mkv',
			'Season 01/Plain S01E02.mkv'
		]);
	});
});

describe('MOVE, by the season each entry is from', () => {
	const target = (key: string) => ({ key, source: 'Elsewhere', sourceId: '9', url: key });
	const list = (numbers: number[], season: number | null = null, at = '/new') =>
		numbers.map((n, order) => ({
			number: n,
			season,
			title: '',
			url: `${at}/ep-${n}`,
			name: `Ep. ${n}`,
			uploaded: 1,
			order
		}));
	const seriesOf = (id: number) =>
		db.prepare(`SELECT origin_key, former_key, former_at FROM series WHERE id = ?`).get(id) as {
			origin_key: string;
			former_key: string | null;
			former_at: number | null;
		};
	const urls = (id: number) =>
		(
			db.prepare(`SELECT source_url AS u FROM entries WHERE series_id = ? ORDER BY id`).all(id) as {
				u: string;
			}[]
		).map((r) => r.u);

	it('a series’ MOVE takes only what its own key supplies, and a season with a source of its own stays', () => {
		const a = show('Merged', 'aniyomi:7:/s1');
		const one = episode(a, 1, 1);
		const two = episode(a, 2, 1);
		facts.putSeasonFact({ seriesId: a, season: 2, originKey: 'aniyomi:7:/s2' }, db);
		const twoUrl = (
			db.prepare(`SELECT source_url AS u FROM entries WHERE id = ?`).get(two) as { u: string }
		).u;
		const r = move.applyMove(a, target('aniyomi:9:/new'), list([1], 1), { now: 500, db });
		expect(r).toMatchObject({ matched: 1 });
		expect(seriesOf(a)).toMatchObject({
			origin_key: 'aniyomi:9:/new',
			former_key: 'aniyomi:7:/s1',
			former_at: 500
		});
		expect(facts.seasonOrigin(a, 2, db)).toBe('aniyomi:7:/s2');
		expect(urls(a)).toContain(twoUrl);
		// Not even a kept chapter: the MOVE was never about it.
		expect(db.prepare(`SELECT origin_source AS o FROM entries WHERE id = ?`).get(two)).toEqual({
			o: ''
		});
		expect(
			(db.prepare(`SELECT source_url AS u FROM entries WHERE id = ?`).get(one) as { u: string }).u
		).toBe('/new/ep-1');
	});

	it('a season’s row that named the series’ key follows the series there, and back', () => {
		const a = show('Merged', 'aniyomi:7:/s1');
		episode(a, 1, 1);
		facts.putSeasonFact({ seriesId: a, season: 1, originKey: 'aniyomi:7:/s1' }, db);
		move.applyMove(a, target('aniyomi:9:/new'), list([1], 1), { now: 500, db });
		expect(facts.seasonFact(a, 1, db)?.originKey).toBe('aniyomi:9:/new');
		move.applyMoveBack(a, list([1], 1, '/s1'), { now: 600, db });
		expect(facts.seasonFact(a, 1, db)?.originKey).toBe('aniyomi:7:/s1');
		expect(seriesOf(a).origin_key).toBe('aniyomi:7:/s1');
	});

	it('MOVE of one season leaves the series-level way back exactly as it was', () => {
		const a = show('Merged', 'aniyomi:7:/s1');
		episode(a, 1, 1);
		episode(a, 2, 1);
		facts.putSeasonFact({ seriesId: a, season: 2, originKey: 'aniyomi:7:/s2' }, db);
		move.applyMove(a, target('aniyomi:9:/first'), list([1], 1, '/first'), { now: 500, db });
		const before = seriesOf(a);
		const r = move.applyMove(a, target('aniyomi:9:/second'), list([1], null, '/second'), {
			now: 900,
			db,
			season: 2
		});
		expect(r).toMatchObject({ matched: 1, kept: 0 });
		expect(seriesOf(a)).toEqual(before);
		expect(facts.seasonOrigin(a, 2, db)).toBe('aniyomi:9:/second');
		expect(urls(a)).toContain('/second/ep-1');
		// And MOVE BACK of the series still goes where the series came from.
		expect(move.moveBackTarget(a)?.key).toBe('aniyomi:7:/s1');
		// The season's left key is remembered, for a backup to find the series by.
		expect(
			db
				.prepare(`SELECT 1 AS y FROM series_former_keys WHERE series_id = ? AND origin_key = ?`)
				.get(a, 'aniyomi:7:/s2')
		).toEqual({ y: 1 });
	});

	it('a season’s MOVE with no row writes one, and season 1’s series key is not “left”', () => {
		const a = show('Merged', 'aniyomi:7:/series');
		episode(a, 1, 1);
		episode(a, 2, 1);
		move.applyMove(a, target('aniyomi:9:/second'), list([1], null, '/second'), {
			now: 900,
			db,
			season: 2
		});
		expect(facts.seasonFact(a, 2, db)?.originKey).toBe('aniyomi:9:/second');
		expect(seriesOf(a).origin_key).toBe('aniyomi:7:/series');
		expect(
			db
				.prepare(`SELECT 1 FROM series_former_keys WHERE series_id = ? AND origin_key = ?`)
				.get(a, 'aniyomi:7:/series')
		).toBeUndefined();
	});

	it('of two seasons sharing a key, moving one leaves the other, and the key is not “left”', () => {
		const a = show('Shared', 'aniyomi:7:/series');
		episode(a, 1, 1);
		episode(a, 2, 1);
		facts.putSeasonFact({ seriesId: a, season: 1, originKey: 'aniyomi:7:/both' }, db);
		facts.putSeasonFact({ seriesId: a, season: 2, originKey: 'aniyomi:7:/both' }, db);
		move.applyMove(a, target('aniyomi:9:/second'), list([1], null, '/second'), {
			now: 900,
			db,
			season: 2
		});
		expect(facts.seasonFact(a, 1, db)?.originKey).toBe('aniyomi:7:/both');
		expect(facts.seasonFact(a, 2, db)?.originKey).toBe('aniyomi:9:/second');
		expect(
			db
				.prepare(`SELECT 1 FROM series_former_keys WHERE series_id = ? AND origin_key = ?`)
				.get(a, 'aniyomi:7:/both')
		).toBeUndefined();
	});

	it('refuses a target another series holds as a season, and accepts this series’ own season', () => {
		const a = show('A', 'aniyomi:7:/a');
		episode(a, 1, 1);
		facts.putSeasonFact({ seriesId: a, season: 2, originKey: 'aniyomi:7:/a2' }, db);
		const b = show('B', 'aniyomi:7:/b');
		facts.putSeasonFact({ seriesId: b, season: 2, originKey: 'aniyomi:7:/b2' }, db);
		expect(() => move.applyMove(a, target('aniyomi:7:/b2'), list([1], 1), { db })).toThrow(
			/already another series/
		);
		expect(() => move.applyMove(a, target('aniyomi:7:/b'), list([1], 1), { db })).toThrow(
			/already another series/
		);
		expect(() => move.applyMove(a, target('aniyomi:7:/a2'), list([1], 1), { db })).not.toThrow();
	});

	it('the comparison says the same: a season’s key held elsewhere is a conflict', async () => {
		const a = show('A', 'aniyomi:7:/a');
		episode(a, 1, 1);
		const b = show('B', 'aniyomi:7:/b');
		facts.putSeasonFact({ seriesId: b, season: 2, originKey: 'aniyomi:7:/b2' }, db);
		listing('/b2', [1]);
		const compared = await move.moveComparison(a, sourceMangaId('7', '/b2'), true, null, 1000);
		expect(compared?.conflict).toEqual({ seriesId: b, title: 'B' });
	});

	it('refuses a series MOVE when every season has its own source, and MOVE BACK likewise', () => {
		const a = show('All seasons elsewhere', 'aniyomi:7:/series');
		episode(a, 1, 1);
		facts.putSeasonFact({ seriesId: a, season: 1, originKey: 'aniyomi:7:/own' }, db);
		expect(() => move.applyMove(a, target('aniyomi:9:/new'), list([1], 1), { db })).toThrow(
			/own source/
		);
		db.prepare(
			`UPDATE series SET former_key = 'aniyomi:7:/old', former_at = 1, former_source = 'Old' WHERE id = ?`
		).run(a);
		expect(() => move.applyMoveBack(a, list([1], 1), { db })).toThrow(/own source/);
	});

	describe('a MOVE clears the failures of what moved', () => {
		const fail = (seriesId: number, entryId: number) =>
			db
				.prepare(
					`INSERT INTO episode_failures (entry_id, series_id, first_at, last_at) VALUES (?, ?, 1, 1)`
				)
				.run(entryId, seriesId);
		const failing = (seriesId: number) =>
			(
				db
					.prepare(
						`SELECT entry_id AS id FROM episode_failures WHERE series_id = ? ORDER BY entry_id`
					)
					.all(seriesId) as { id: number }[]
			).map((r) => r.id);

		it('a MOVE of one season clears that season’s and leaves another’s', () => {
			const a = show('Show', 'aniyomi:7:/show');
			const one = episode(a, 1, 1);
			const two = episode(a, 2, 1);
			fail(a, one);
			fail(a, two);
			move.applyMove(a, target('aniyomi:9:/second'), list([1], null, '/second'), {
				now: 900,
				db,
				season: 2
			});
			expect(failing(a)).toEqual([one]);
		});

		it('a MOVE of the series leaves a season with a source of its own', () => {
			const a = show('Show', 'aniyomi:7:/show');
			const one = episode(a, 1, 1);
			const two = episode(a, 2, 1);
			facts.putSeasonFact({ seriesId: a, season: 2, originKey: 'aniyomi:7:/own' }, db);
			fail(a, one);
			fail(a, two);
			move.applyMove(a, target('aniyomi:9:/new'), list([1], 1), { now: 900, db });
			expect(failing(a)).toEqual([two]);
		});

		it('a series with no rows clears all of them, as it did', () => {
			const a = show('Plain', 'aniyomi:7:/plain');
			fail(a, episode(a, 1, 1));
			fail(a, episode(a, 2, 1));
			move.applyMove(a, target('aniyomi:9:/new'), [...list([1], 1), ...list([1], 2, '/n2')], {
				now: 900,
				db
			});
			expect(failing(a)).toEqual([]);
		});
	});

	describe('MOVE BACK counts a season’s key as held', () => {
		const K = 'aniyomi:7:/k';
		const T = 'aniyomi:9:/t';
		const NOW = 4_000_000;
		// A has moved from K to T, and K is free for anyone to come to hold.
		function moved(): number {
			const a = show('A', K);
			episode(a, 1, 1);
			move.applyMove(a, target(T), list([1], 1, '/t'), { now: NOW, db });
			return a;
		}
		const wayBack = list([1], 1, '/k');
		const entries = (id: number) =>
			db
				.prepare(`SELECT source_url, former_url, origin_source FROM entries WHERE series_id = ?`)
				.all(id);
		async function offered(a: number) {
			listing('/k', [1]);
			return {
				screen: move.moveState(a, NOW + 1).former !== null,
				comparison: (await move.moveComparison(a, idOf('/k'), true, null, NOW + 1))?.former !== null
			};
		}

		it('refuses a key another series has come to hold as a season, and changes nothing', async () => {
			const a = moved();
			const b = show('B', 'aniyomi:7:/b');
			facts.putSeasonFact({ seriesId: b, season: 2, originKey: K }, db);
			const series = seriesOf(a);
			const before = entries(a);
			expect(() => move.applyMoveBack(a, wayBack, { now: NOW + 1, db })).toThrow(move.MoveError);
			expect(() => move.applyMoveBack(a, wayBack, { now: NOW + 1, db })).toThrow(
				/already another series/
			);
			expect(seriesOf(a)).toEqual(series);
			expect(series).toMatchObject({ origin_key: T, former_key: K });
			expect(entries(a)).toEqual(before);
			expect(facts.heldByOther(K, b, db)).toBeNull();
			// And neither door offers what the action refuses.
			expect(await offered(a)).toEqual({ screen: false, comparison: false });
		});

		it('refuses a key another series has come to hold as its own, as a refusal and not a crash', async () => {
			const a = moved();
			show('B', K);
			expect(() => move.applyMoveBack(a, wayBack, { now: NOW + 1, db })).toThrow(move.MoveError);
			expect(seriesOf(a).origin_key).toBe(T);
			expect(await offered(a)).toEqual({ screen: false, comparison: false });
		});

		it('with no other holder it still goes back, and is offered', async () => {
			const a = moved();
			expect(await offered(a)).toEqual({ screen: true, comparison: true });
			move.applyMoveBack(a, wayBack, { now: NOW + 1, db });
			expect(seriesOf(a)).toMatchObject({ origin_key: K, former_key: T });
		});

		it('a key this series’ own season holds is not another’s', async () => {
			const a = moved();
			facts.putSeasonFact({ seriesId: a, season: 2, originKey: K }, db);
			expect(await offered(a)).toEqual({ screen: true, comparison: true });
			expect(() => move.applyMoveBack(a, wayBack, { now: NOW + 1, db })).not.toThrow();
			expect(seriesOf(a).origin_key).toBe(K);
		});

		it('opens again once the other series lets the key go', async () => {
			const a = moved();
			const b = show('B', 'aniyomi:7:/b');
			facts.putSeasonFact({ seriesId: b, season: 2, originKey: K }, db);
			expect(await offered(a)).toEqual({ screen: false, comparison: false });
			facts.putSeasonFact({ seriesId: b, season: 2, originKey: 'aniyomi:7:/elsewhere' }, db);
			expect(await offered(a)).toEqual({ screen: true, comparison: true });
			expect(() => move.applyMoveBack(a, wayBack, { now: NOW + 1, db })).not.toThrow();
		});

		it('a closed window stays closed, held or not', () => {
			const a = moved();
			expect(move.moveState(a, NOW + 31 * 86_400_000).former).toBeNull();
		});
	});

	describe('a MOVE does not change where a season downloads', () => {
		const NOW = 3_000_000;
		const deps = { db, library, now: () => NOW };
		const row = (id: number) =>
			db
				.prepare(
					`SELECT id, title, hidden, description, status, source, origin_key FROM series WHERE id = ?`
				)
				.get(id) as Parameters<typeof seriesFolder>[1];
		beforeEach(() => rmSync(join(library, 'Anime'), { recursive: true, force: true }));
		afterAll(() => rmSync(join(library, 'Anime'), { recursive: true, force: true }));
		// Downloaded and attached, through the doors a download goes through.
		async function downloaded(ep: number): Promise<string> {
			const path = await downloadEpisode(ep, deps);
			for (const plan of planAnimeSeries(library, path, NOW))
				writeSeries(plan, { rootId: 1, jobId: null, now: NOW, markMissing: false }, db);
			return path;
		}
		const nfo = (name: string) => readFileSync(join(library, 'Anime', name, 'tvshow.nfo'), 'utf8');
		const moveSeason = (a: number, season: number, key: string) =>
			move.applyMove(a, target(key), list([1, 2], null, key.slice(-8)), { now: NOW, db, season });
		const SHOW = 'aniyomi:7:/show';
		const stays = { folder: 'Anime/Show', key: SHOW, title: 'Show', season: null };

		it('a season with a downloaded episode in the series’ folder stays, and its next episode lands beside it', async () => {
			const a = show('Show', SHOW);
			episode(a, 1, 1);
			const first = episode(a, 2, 1);
			const second = episode(a, 2, 2);
			await downloaded(first);
			expect(episodePlace(db, row(a), 2)).toEqual(stays);
			moveSeason(a, 2, 'aniyomi:9:/elsewhere');
			expect(facts.seasonOrigin(a, 2, db)).toBe('aniyomi:9:/elsewhere');
			expect(episodePlace(db, row(a), 2)).toEqual(stays);
			expect(await downloaded(second)).toBe(
				join(library, 'Anime', 'Show', 'Season 02', 'Show S02E02.mkv')
			);
			expect(existsSync(join(library, 'Anime', 'Show (2)'))).toBe(false);
			// The folder is still the series' to the importer and to Jellyfin.
			expect(nfo('Show')).toContain(SHOW);
			expect(nfo('Show')).not.toContain('aniyomi:9:/elsewhere');
			expect(facts.seasonFact(a, 2, db)?.folder).toBeNull();
			const seasons = db
				.prepare(`SELECT available, file FROM entries WHERE series_id = ? AND season = 2`)
				.all(a) as { available: number; file: string }[];
			expect(seasons.map((r) => r.available)).toEqual([1, 1]);
		});

		it('two seasons moved away from one folder both stay, with nothing written to the unique index', async () => {
			const a = show('Show', SHOW);
			const two = episode(a, 2, 1);
			const three = episode(a, 3, 1);
			await downloaded(two);
			await downloaded(three);
			moveSeason(a, 2, 'aniyomi:9:/second');
			moveSeason(a, 3, 'aniyomi:9:/thirdly');
			expect(episodePlace(db, row(a), 2).folder).toBe('Anime/Show');
			expect(episodePlace(db, row(a), 3).folder).toBe('Anime/Show');
			expect(facts.seasonFolders(a, db)).toEqual([]);
		});

		it('a season with no files and its own key still gets its own folder', () => {
			const a = show('Show', SHOW);
			episode(a, 2, 1);
			moveSeason(a, 2, 'aniyomi:9:/elsewhere');
			seriesFolder(db, row(a));
			expect(episodePlace(db, row(a), 2)).toEqual({
				folder: 'Anime/Show (2)',
				key: 'aniyomi:9:/elsewhere',
				title: 'Show',
				season: 2
			});
			expect(facts.seasonFact(a, 2, db)?.folder).toBe('Anime/Show (2)');
		});

		it('an episode whose file is gone holds no folder', () => {
			const a = show('Show', SHOW);
			const ep = episode(a, 2, 1);
			db.prepare(`UPDATE series SET path = '/lib/Anime/Show' WHERE id = ?`).run(a);
			db.prepare(
				`UPDATE entries SET file = 'Season 02/Show S02E01.mkv', available = 0 WHERE id = ?`
			).run(ep);
			moveSeason(a, 2, 'aniyomi:9:/elsewhere');
			seriesFolder(db, row(a));
			expect(episodePlace(db, row(a), 2).folder).toBe('Anime/Show (2)');
		});

		it('a season whose files sit in the folder it shared stays there, under that folder’s own key', async () => {
			const a = show('Show', SHOW);
			const SHARED = 'aniyomi:7:/shared';
			facts.putSeasonFact({ seriesId: a, season: 2, originKey: SHARED, sourceTitle: 'Late' }, db);
			facts.putSeasonFact({ seriesId: a, season: 3, originKey: SHARED, sourceTitle: 'Late' }, db);
			expect(episodePlace(db, row(a), 2).folder).toBe('Anime/Late');
			const three = episode(a, 3, 1);
			const four = episode(a, 3, 2);
			await downloaded(three);
			moveSeason(a, 3, 'aniyomi:9:/elsewhere');
			expect(episodePlace(db, row(a), 3)).toEqual({
				folder: 'Anime/Late',
				key: SHARED,
				title: 'Late',
				season: 2
			});
			expect(await downloaded(four)).toBe(
				join(library, 'Anime', 'Late', 'Season 03', 'Late S03E02.mkv')
			);
			expect(nfo('Late')).toContain(SHARED);
			expect(nfo('Late')).not.toContain('aniyomi:9:/elsewhere');
		});

		it('a season in the series’ folder moved onto a key another season has a folder for stays too', async () => {
			const a = show('Show', SHOW);
			const OTHER = 'aniyomi:9:/other-season';
			facts.putSeasonFact(
				{ seriesId: a, season: 3, originKey: OTHER, folder: 'Anime/Third', sourceTitle: 'Third' },
				db
			);
			const two = episode(a, 2, 1);
			await downloaded(two);
			moveSeason(a, 2, OTHER);
			expect(episodePlace(db, row(a), 2)).toEqual(stays);
		});

		it('a flat list’s episodes, season 0 to their row, stay in the series’ folder too', () => {
			const a = show('Show', SHOW);
			const ep = episode(a, null, 1);
			db.prepare(`UPDATE series SET path = '/lib/Anime/Show' WHERE id = ?`).run(a);
			db.prepare(`UPDATE entries SET file = 'Show E01.mkv', available = 1 WHERE id = ?`).run(ep);
			moveSeason(a, 0, 'aniyomi:9:/elsewhere');
			expect(episodePlace(db, row(a), null)).toEqual(stays);
		});

		it('another season’s files don’t count for this one', async () => {
			const a = show('Show', SHOW);
			const one = episode(a, 1, 1);
			episode(a, 2, 1);
			await downloaded(one);
			moveSeason(a, 2, 'aniyomi:9:/elsewhere');
			expect(episodePlace(db, row(a), 2).folder).toBe('Anime/Show (2)');
		});

		it('a series with no rows answers its own folder, files or none', async () => {
			const a = show('Show', SHOW);
			expect(episodePlace(db, row(a), 2)).toEqual(stays);
			await downloaded(episode(a, 2, 1));
			expect(episodePlace(db, row(a), 2)).toEqual(stays);
		});
	});

	it('a series with no rows moves whole, as it did', () => {
		const a = show('Plain', 'aniyomi:7:/plain');
		episode(a, 1, 1);
		episode(a, 2, 1);
		const r = move.applyMove(
			a,
			target('aniyomi:9:/new'),
			[...list([1], 1), ...list([1], 2, '/n2')],
			{
				now: 500,
				db
			}
		);
		expect(r.matched).toBe(2);
		expect(seriesOf(a).former_key).toBe('aniyomi:7:/plain');
	});
});

describe('fingerprinting leaves alone the source a download is using', () => {
	const SERIES = 'aniyomi:7:/series';
	const SEASON = 'aniyomi:9:/season';
	const downloading = (seriesId: number, entryId: number) =>
		db
			.prepare(
				`INSERT INTO download_queue (entry_id, series_id, position, state, queued_at)
				VALUES (?, ?, 1, 'downloading', 0)`
			)
			.run(entryId, seriesId);
	// Whether it went on to the streams: a blocked one never asks for any.
	async function reads(seriesId: number, playing: number): Promise<boolean> {
		source.streamed = [];
		await fingerprintSeason(seriesId, playing, { allowStreams: true, pauseMs: 0, db });
		return source.streamed.length > 0;
	}
	beforeEach(() => {
		db.exec(`DELETE FROM download_queue; DELETE FROM episode_marks;`);
		source.refuseStreams = true;
	});
	function merged() {
		const a = show('Merged', SERIES);
		facts.putSeasonFact({ seriesId: a, season: 2, originKey: SEASON }, db);
		return { a, one: episode(a, 1, 1), two: episode(a, 2, 1), twoNext: episode(a, 2, 2) };
	}

	it('an episode of a season with its own source is held by a download from that source', async () => {
		const { a, two, twoNext } = merged();
		downloading(a, twoNext);
		expect(await reads(a, two)).toBe(false);
	});

	it('and not by a download from the series’ other source', async () => {
		const { a, one, two } = merged();
		downloading(a, one);
		expect(await reads(a, two)).toBe(true);
	});

	it('the series’ own season is held by its own source and not by the season’s', async () => {
		const { a, one, two } = merged();
		downloading(a, two);
		expect(await reads(a, one)).toBe(true);
		db.exec(`DELETE FROM download_queue`);
		const other = show('Other', 'aniyomi:7:/other');
		downloading(other, episode(other, 1, 1));
		expect(await reads(a, one)).toBe(false);
	});

	it('another series’ season counts by that season’s source, not by the series’', async () => {
		const { a, two } = merged();
		// Series key at source 7, its season 2 at source 9: the download is from 9.
		const b = show('B', 'aniyomi:7:/b');
		facts.putSeasonFact({ seriesId: b, season: 2, originKey: 'aniyomi:9:/b2' }, db);
		downloading(b, episode(b, 2, 1));
		expect(await reads(a, two)).toBe(false);
	});

	it('a series with no rows is held by its own source, as it was', async () => {
		const a = show('Plain', SERIES);
		const first = episode(a, 1, 1);
		const next = episode(a, 1, 2);
		expect(await reads(a, first)).toBe(true);
		downloading(a, next);
		expect(await reads(a, first)).toBe(false);
	});
});

describe('AniSkip asks the season’s own MAL entry, with the number within the season', () => {
	// c349 built this: the rows here only prove a season's source sits beside
	// its link without changing the question (premise in the notes).
	const link = (series: number, season: number, mal: number) =>
		db
			.prepare(
				`INSERT INTO series_season_links (series_id, season, part, anilist_id, mal_id, via, title, linked_at, format, episodes)
				VALUES (?, ?, 1, ?, ?, 'review', 'T', 1, 'TV', 12)`
			)
			.run(series, season, mal + 1000, mal);
	const urls: string[] = [];
	afterEach(() => vi.unstubAllGlobals());
	beforeEach(() => {
		urls.length = 0;
		db.exec(`DELETE FROM series_season_links; DELETE FROM episode_marks;`);
		vi.stubGlobal('fetch', async (u: string) => {
			urls.push(u);
			return new Response('{}', { status: 404 });
		});
	});

	it('season 2’s EP. 3 asks season 2’s entry, whichever source supplies the season', async () => {
		const a = show('Merged', 'aniyomi:7:/s1');
		link(a, 1, 111);
		link(a, 2, 222);
		facts.putSeasonFact({ seriesId: a, season: 2, originKey: 'aniyomi:9:/s2' }, db);
		const ep = episode(a, 2, 3);
		db.prepare(`UPDATE entries SET duration_s = 1400 WHERE id = ?`).run(ep);
		await lookupAniSkip(ep, { db, now: 1 });
		expect(urls).toHaveLength(1);
		expect(urls[0]).toContain('/skip-times/222/3?');
	});

	it('a season without a link is left alone, with or without a source of its own', async () => {
		const a = show('Half linked', 'aniyomi:7:/s1');
		link(a, 1, 111);
		facts.putSeasonFact({ seriesId: a, season: 2, originKey: 'aniyomi:9:/s2' }, db);
		const ep = episode(a, 2, 1);
		db.prepare(`UPDATE entries SET duration_s = 1400 WHERE id = ?`).run(ep);
		expect(await lookupAniSkip(ep, { db, now: 1 })).toBe(false);
		expect(urls).toHaveLength(0);
	});
});

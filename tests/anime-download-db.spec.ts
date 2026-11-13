import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { existsSync, mkdtempSync, readFileSync, rmSync, statSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

// Before anything imports db.ts: getDb() reads this once and memoises.
process.env.DATABASE_PATH = ':memory:';
process.env.ENGINE_TOKEN = 'engine-secret';
const work = mkdtempSync(join(tmpdir(), 'tsundoku-anime-download-'));
const library = join(work, 'library');
process.env.LIBRARY_ROOT = library;
process.env.COVER_DIR = join(work, 'covers');
afterAll(() => rmSync(work, { recursive: true, force: true }));

// Downloading episodes (doc/ANIME.md, "Downloading"; card c157), with the real
// ffmpeg, from a fake engine whose first server is broken and whose second
// is the fixture clip (tests/fixtures/video), through its /video/ proxy.
const CLIP = readFileSync('tests/fixtures/video/clip.webm');
const SUBS = readFileSync('tests/fixtures/video/en.vtt');
const SELF = 'http://127.0.0.1:34567';
let server: Server;
const seen: string[] = [];
let empty = 0;
beforeAll(async () => {
	server = createServer((req, res) => {
		seen.push(req.url ?? '');
		if (req.url === '/video/clip.webm')
			return res.writeHead(200, { 'content-type': 'video/webm' }).end(CLIP);
		if (req.url === '/video/en.vtt')
			return res.writeHead(200, { 'content-type': 'text/vtt' }).end(SUBS);
		if (req.url?.startsWith('/video/')) return res.writeHead(404).end('gone');
		let raw = '';
		req.on('data', (c) => (raw += c));
		req.on('end', () => {
			const b = JSON.parse(raw || '{}') as { method: string };
			if (b.method !== 'getVideoList') return res.writeHead(404).end('{}');
			// A source asked too soon (AnimePahe's, live): no videos, for a while.
			if (empty > 0) {
				empty--;
				return res.writeHead(200, { 'content-type': 'application/json' }).end('[]');
			}
			res.writeHead(200, { 'content-type': 'application/json' }).end(
				JSON.stringify([
					{ quality: 'Broken - 720p', videoUrl: `${SELF}/video/broken.webm` },
					{
						quality: 'Kwik - 360p',
						videoUrl: `${SELF}/video/clip.webm`,
						// Two the mux's own 19 languages left untagged (c419).
						subtitleTracks: [
							{ url: `${SELF}/video/en.vtt`, lang: 'English' },
							{ url: `${SELF}/video/en.vtt`, lang: 'Hungarian' },
							{ url: `${SELF}/video/en.vtt`, lang: 'Norwegian Bokmål' }
						]
					}
				])
			);
		});
	});
	await new Promise<void>((ok) => server.listen(0, '127.0.0.1', ok));
	process.env.ENGINE_URL = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});
afterAll(async () => {
	server.closeAllConnections();
	await new Promise((ok) => server.close(ok));
});

const { getDb } = await import('$lib/server/db');
const { ensureNamedRoot } = await import('$lib/server/import/write');
const { attachWritten, runImport } = await import('$lib/server/import/index');
const queue = await import('$lib/server/engine/queue');
const downloads = await import('$lib/server/downloads');
const anime = await import('$lib/server/anime/download');
const seasons = await import('$lib/server/season-links');
const streams = await import('$lib/server/anime/streams');

const db = getDb();
db.prepare(
	`INSERT INTO engine_extensions (pkg, name, kind, version_code, version_name, lib, handle, installed_at, updated_at, failed)
	VALUES ('e2e.anime', 'AnimePahe', 'anime', 1, '1.0', '16', ?, 0, 0, '')`
).run('e2e.anime'.padEnd(64, '0'));
db.prepare(
	`INSERT INTO engine_sources (id, pkg, name, lang, base_url) VALUES ('7000', 'e2e.anime', 'AnimePahe', 'en', 'https://site.example')`
).run();
const root = ensureNamedRoot(db, 'Anime', join(library, 'Anime'), false);
const series = (title: string, hidden: number) =>
	Number(
		db
			.prepare(
				`INSERT INTO series (root_id, title, kind, added_at, origin_key, hidden, source, description) VALUES (?, ?, 'anime', 0, ?, ?, 'AnimePahe', 'A plot.')`
			)
			.run(root, title, `aniyomi:7000:/show/${hidden}`, hidden).lastInsertRowid
	);
const episode = (s: number, n: number, title: string) =>
	Number(
		db
			.prepare(
				`INSERT INTO entries (series_id, position, label, title, added_at, source_url, season, episode_number, available) VALUES (?, ?, ?, ?, 0, ?, 1, ?, 0)`
			)
			.run(s, n, `Ep. ${n}`, title, `/ep/${s}/${n}`, n).lastInsertRowid
	);
const shown = series('Moonlit: Travellers', 0);
const ep1 = episode(shown, 1, 'The First Snow');
const ep2 = episode(shown, 2, '');
const secret = series('A Hidden One', 1);
const hidden1 = episode(secret, 1, 'Quiet');
const deps = { db, library, now: () => 1_800_000_000_000 };
const show = join(library, 'Anime', 'Moonlit_ Travellers');
const file1 = join(show, 'Season 01', 'Moonlit_ Travellers S01E01 The First Snow.mkv');
const entry = (id: number) =>
	db.prepare(`SELECT available, file, bytes, duration_s FROM entries WHERE id = ?`).get(id) as {
		available: number;
		file: string;
		bytes: number;
		duration_s: number | null;
	};

describe('downloading an episode', () => {
	it('queues in its own lane, at the quality ALL chose', async () => {
		await downloads.enqueue(shown, [ep1, ep2], 720);
		expect(queue.queueRows(db).map((r) => r.kind)).toEqual(['anime', 'anime']);
		expect(queue.nextUp(3, Date.now(), db, 'manga')).toEqual([]);
		expect(db.prepare(`SELECT quality FROM anime_episodes WHERE entry_id = ?`).get(ep1)).toEqual({
			quality: 720
		});
	});

	it('muxes the next server that answers into one MKV, in Jellyfin’s layout, beside its NFOs', async () => {
		expect(await anime.runAnimeOnce(deps)).toBe(1);
		expect(existsSync(file1)).toBe(true);
		expect(existsSync(`${file1}.partial`)).toBe(false);
		const probe = JSON.parse(
			execFileSync('ffprobe', ['-v', 'error', '-show_streams', '-of', 'json', file1]).toString()
		) as { streams: { codec_type: string; codec_name: string; tags?: { language?: string } }[] };
		expect(probe.streams.map((s) => [s.codec_type, s.codec_name])).toEqual([
			['video', 'vp9'],
			['audio', 'opus'],
			['subtitle', 'subrip'],
			['subtitle', 'subrip'],
			['subtitle', 'subrip']
		]);
		expect(probe.streams.slice(2).map((s) => s.tags?.language)).toEqual(['eng', 'hun', 'nob']);
		const nfo = readFileSync(file1.replace(/\.mkv$/, '.nfo'), 'utf8');
		expect(nfo).toContain(`<uniqueid type="tsundoku" default="true">/ep/${shown}/1</uniqueid>`);
		expect(nfo).toContain('<episode>1</episode>');
		const tv = readFileSync(join(show, 'tvshow.nfo'), 'utf8');
		expect(tv).toContain(
			'<uniqueid type="tsundoku" default="true">aniyomi:7000:/show/0</uniqueid>'
		);
		expect(tv).toContain('<plot>A plot.</plot>');
		// ffmpeg fetched nothing itself: the engine was asked only for what the proxy passed it.
		expect(seen.filter((u) => u.startsWith('/video/'))).toEqual(
			expect.arrayContaining(['/video/broken.webm', '/video/clip.webm', '/video/en.vtt'])
		);
		expect(queue.queueRows(db).map((r) => r.entryId)).toEqual([ep2]);
		const d = await downloads.seriesDownloads(shown, [
			{ id: ep1, available: false },
			{ id: ep2, available: false }
		]);
		expect(d.kind === 'ok' && d.states[ep1]).toEqual({ kind: 'importing' });
	});

	it('attaches onto its episode as it is written, and plays from the file from then on', async () => {
		const before = (db.prepare(`SELECT COUNT(*) AS n FROM series`).get() as { n: number }).n;
		expect(await attachWritten(library, [file1], deps.now())).toEqual([]);
		expect((db.prepare(`SELECT COUNT(*) AS n FROM series`).get() as { n: number }).n).toBe(before);
		expect(entry(ep1)).toMatchObject({
			available: 1,
			file: 'Season 01/Moonlit_ Travellers S01E01 The First Snow.mkv',
			bytes: statSync(file1).size
		});
		expect(entry(ep1).duration_s).toBeCloseTo(8, 0);
		expect(db.prepare(`SELECT path FROM series WHERE id = ?`).get(shown)).toEqual({ path: show });
		const s = (await streams.episodeStreams(ep1, false))!;
		expect(s.servers).toHaveLength(1);
		expect(s.servers[0]).toMatchObject({
			name: 'DOWNLOADED',
			qualities: [{ kind: 'file', src: `/api/anime/file/${ep1}` }]
		});
		expect(s.servers[0].qualities[0].subtitles).toEqual([
			{ lang: 'EN', src: `/api/anime/file/${ep1}/subtitle/0` },
			{ lang: 'HU', src: `/api/anime/file/${ep1}/subtitle/1` },
			{ lang: 'NB', src: `/api/anime/file/${ep1}/subtitle/2` }
		]);
	});

	// The scan stays the cross-check (c170): it reads the same files and agrees.
	it('is left exactly as it was by the scan that follows', async () => {
		const before = snapshot(shown);
		await runImport(library, { now: deps.now() });
		expect(snapshot(shown)).toEqual(before);
	});

	it('goes under Anime (hidden) for a hidden series, never where Jellyfin reads', async () => {
		await downloads.enqueue(secret, [hidden1]);
		db.prepare(`DELETE FROM download_queue WHERE entry_id = ?`).run(ep2);
		expect(await anime.runAnimeOnce(deps)).toBe(1);
		expect(
			existsSync(
				join(
					library,
					'Anime (hidden)',
					'A Hidden One',
					'Season 01',
					'A Hidden One S01E01 Quiet.mkv'
				)
			)
		).toBe(true);
		expect(existsSync(join(library, 'Anime', 'A Hidden One'))).toBe(false);
		await runImport(library, { now: deps.now() + 1 });
		expect(entry(hidden1).available).toBe(1);
	});

	it('is NOT DOWNLOADED again when its file is deleted, and streams', async () => {
		rmSync(file1);
		await runImport(library, { now: deps.now() + 2 });
		expect(entry(ep1).available).toBe(0);
		const s = (await streams.episodeStreams(ep1, false))!;
		expect(s.servers.map((x) => x.name)).toEqual(['Broken', 'Kwik']);
	});

	it('asks a source that answered with no videos again, before the queue counts a try', async () => {
		db.prepare(`DELETE FROM download_queue`).run();
		const ep3 = episode(shown, 3, 'Asked Again');
		await downloads.enqueue(shown, [ep3], 720);
		empty = 2;
		const waits: number[] = [];
		const waiting = { ...deps, wait: async (ms: number) => void waits.push(ms) };
		expect(await anime.runAnimeOnce(waiting)).toBe(1);
		expect(waits).toEqual(anime.REASK_MS);
		const ep4 = episode(shown, 4, '');
		await downloads.enqueue(shown, [ep4], 720);
		empty = 1 + anime.REASK_MS.length;
		expect(await anime.runAnimeOnce(waiting)).toBe(0);
		expect(
			db.prepare(`SELECT state, tries, error FROM download_queue WHERE entry_id = ?`).get(ep4)
		).toEqual({ state: 'queued', tries: 1, error: 'No server answered' });
	});

	it('names its catalogue entry to Jellyfin only when the link is an anime’s (c395)', async () => {
		// A link to the manga (a wrong-kind link from before c298): its ids are
		// another work's, so tvshow.nfo carries only tsundoku's own key.
		db.prepare(`DELETE FROM download_queue`).run();
		db.prepare(
			`INSERT INTO series_links (series_id, anilist_id, mal_id, via, linked_at, format)
			VALUES (?, 30023, 23, 'exact', 0, 'MANGA')`
		).run(shown);
		const tv = () => readFileSync(join(show, 'tvshow.nfo'), 'utf8');
		const ep5 = episode(shown, 5, 'The Manga’s');
		await downloads.enqueue(shown, [ep5], 720);
		expect(await anime.runAnimeOnce(deps)).toBe(1);
		expect(tv()).toContain('<uniqueid type="tsundoku" default="true">');
		expect(tv()).not.toContain('type="anilist"');
		expect(tv()).not.toContain('type="mal"');
		// Relinked to the anime, the next download names it.
		db.prepare(
			`UPDATE series_links SET anilist_id = 178533, mal_id = 58616, format = 'TV' WHERE series_id = ?`
		).run(shown);
		const ep6 = episode(shown, 6, 'The Anime’s');
		await downloads.enqueue(shown, [ep6], 720);
		expect(await anime.runAnimeOnce(deps)).toBe(1);
		expect(tv()).toContain('<uniqueid type="anilist">178533</uniqueid>');
		expect(tv()).toContain('<uniqueid type="mal">58616</uniqueid>');
		db.prepare(`DELETE FROM series_links WHERE series_id = ?`).run(shown);
	});

	it('names the show by its season links, so one with only season 2 linked has ids (c381)', async () => {
		// An anime's ids are its season rows': with season 2 linked alone there
		// is still something for tvshow.nfo to name.
		db.prepare(`DELETE FROM download_queue`).run();
		const tv = () => readFileSync(join(show, 'tvshow.nfo'), 'utf8');
		const fetchIt = async (n: number) => {
			const id = Number(
				db
					.prepare(
						`INSERT INTO entries (series_id, position, label, title, added_at, source_url, season, episode_number, available) VALUES (?, ?, ?, '', 0, ?, 2, ?, 0)`
					)
					.run(shown, 100 + n, `Ep. ${n}`, `/ep/${shown}/s2/${n}`, n).lastInsertRowid
			);
			await downloads.enqueue(shown, [id], 720);
			expect(await anime.runAnimeOnce(deps)).toBe(1);
		};
		const entryOf = (anilistId: number, malId: number, format: string) => ({
			anilistId,
			malId,
			title: `Entry ${anilistId}`,
			alts: [],
			format,
			country: 'JP',
			year: 2024,
			chapters: null,
			volumes: null,
			episodes: 12,
			season: null,
			seasonYear: 2024,
			status: 'FINISHED',
			coverUrl: ''
		});
		try {
			expect(seasons.linkSeason(shown, 2, 1, entryOf(20002, 30002, 'TV'), 'review')).toBe(true);
			expect(db.prepare(`SELECT 1 FROM series_links WHERE series_id = ?`).get(shown)).toBe(
				undefined
			);
			await fetchIt(1);
			expect(tv()).toContain('<uniqueid type="anilist">20002</uniqueid>');
			expect(tv()).toContain('<uniqueid type="mal">30002</uniqueid>');
			// Season 1 linked to the manga: not the show's own kind of entry (c395),
			// so season 2's ids still name it.
			expect(seasons.linkSeason(shown, 1, 1, entryOf(30023, 23, 'MANGA'), 'review')).toBe(true);
			await fetchIt(2);
			expect(tv()).toContain('<uniqueid type="anilist">20002</uniqueid>');
			expect(tv()).not.toContain('type="mal">23<');
			// Season 1 linked to its anime: season 1's ids are the show's.
			expect(seasons.linkSeason(shown, 1, 1, entryOf(40001, 50001, 'TV'), 'review')).toBe(true);
			await fetchIt(3);
			expect(tv()).toContain('<uniqueid type="anilist">40001</uniqueid>');
			expect(tv()).toContain('<uniqueid type="mal">50001</uniqueid>');
			// A series row that says otherwise is not read: the season rows are.
			db.prepare(
				`INSERT INTO series_links (series_id, anilist_id, mal_id, via, linked_at) VALUES (?, 1, 2, 'review', 0)`
			).run(shown);
			await fetchIt(4);
			expect(tv()).toContain('<uniqueid type="anilist">40001</uniqueid>');
		} finally {
			db.prepare(`DELETE FROM series_season_links WHERE series_id = ?`).run(shown);
			db.prepare(`DELETE FROM series_links WHERE series_id = ?`).run(shown);
		}
	});
});

describe('a film (c991)', () => {
	const filmRoot = ensureNamedRoot(db, 'Movies', join(library, 'Movies'), false);
	const film = Number(
		db
			.prepare(
				`INSERT INTO series (root_id, title, kind, added_at, origin_key, hidden, source, description)
				VALUES (?, 'Lupin [Hindi-English] 1080p', 'movie', 0, 'aniyomi:7000:/film/lupin', 0, 'AnimePahe', '')`
			)
			.run(filmRoot).lastInsertRowid
	);
	const play = Number(
		db
			.prepare(
				`INSERT INTO entries (series_id, position, label, title, added_at, source_url, available)
				VALUES (?, 1, 'Lupin', '', 0, '/film/lupin/play', 0)`
			)
			.run(film).lastInsertRowid
	);
	// Linked to TMDB before it downloads: its folder is TMDB's title and year.
	db.prepare(
		`INSERT INTO series_tmdb_links (series_id, tmdb_id, media, via, title, year, linked_at)
		VALUES (?, 96677, 'movie', 'review', 'Lupin', 2021, 0)`
	).run(film);
	const dir = join(library, 'Movies', 'Lupin (2021)');
	const file = join(dir, 'Lupin (2021).mkv');
	const nfo = () => readFileSync(join(dir, 'Lupin (2021).nfo'), 'utf8');

	it('downloads flat into Movies/<Title (Year)>, beside its <movie> NFO and no tvshow.nfo', async () => {
		db.prepare(`DELETE FROM download_queue`).run();
		await downloads.enqueue(film, [play]);
		// The cases above leave the fake engine as they found it; the waits are
		// stubbed so a slow answer fails here rather than timing out.
		empty = 0;
		const d = { ...deps, wait: async () => {} };
		const got = await anime.runAnimeOnce(d);
		const why = db.prepare(`SELECT state, error FROM download_queue WHERE entry_id = ?`).get(play);
		expect([got, why]).toEqual([1, undefined]);
		expect(existsSync(file)).toBe(true);
		expect(existsSync(join(dir, 'tvshow.nfo'))).toBe(false);
		expect(nfo()).toContain('<movie>');
		expect(nfo()).toContain('<uniqueid type="tmdb">96677</uniqueid>');
		expect(nfo()).toContain('<tsundokuepisode>/film/lupin/play</tsundokuepisode>');
	});

	it('attaches by the Movies root, and the scan after it changes nothing', async () => {
		expect(await attachWritten(library, [file], deps.now())).toEqual([]);
		expect(entry(play)).toMatchObject({ available: 1, file: 'Lupin (2021).mkv' });
		expect(db.prepare(`SELECT kind, path FROM series WHERE id = ?`).get(film)).toEqual({
			kind: 'movie',
			path: dir
		});
		const before = snapshot(film);
		await runImport(library, { now: deps.now() + 3 });
		expect(snapshot(film)).toEqual(before);
	});

	it('writes its NFO again when the TMDB link goes, and never a file that is not there', async () => {
		db.prepare(`DELETE FROM series_tmdb_links WHERE series_id = ?`).run(film);
		expect(await anime.rewriteVideoNfos(film, library)).toBe(1);
		expect(nfo()).not.toContain('type="tmdb"');
		expect(await anime.rewriteVideoNfos(shown, join(work, 'nowhere'))).toBe(0);
	});

	it('switched to a show, moves its file into a show’s place, and UNDO puts it back', async () => {
		const ks = await import('$lib/server/kind-switch');
		const plan = ks.planKindSwitch(film, 'show', library, db)!;
		expect(plan.refused).toBeNull();
		expect(plan.folder).toEqual({
			from: 'Movies/Lupin (2021)',
			to: 'Shows/Lupin (2021)'
		});
		expect(plan.changes).toEqual(['THE FILM BECOMES EPISODE 1 OF A LIST']);
		expect(plan.busy).toBeNull();
		const shows = join(library, 'Shows', 'Lupin (2021)');
		const ep = join(shows, 'Season 01', 'Lupin (2021) S01E01.mkv');
		expect(await ks.switchKind(film, 'show', library, db)).toEqual({
			done: 'NOW A SHOW · 1 FILE MOVED',
			where: 'TO SHOWS/LUPIN (2021)/SEASON 01/',
			moved: 1
		});
		expect(existsSync(ep)).toBe(true);
		expect(existsSync(dir)).toBe(false);
		expect(readFileSync(ep.replace(/\.mkv$/, '.nfo'), 'utf8')).toContain('<episodedetails>');
		expect(readFileSync(join(shows, 'tvshow.nfo'), 'utf8')).toContain(
			'<tsundokukind>show</tsundokukind>'
		);
		expect(db.prepare(`SELECT kind, path FROM series WHERE id = ?`).get(film)).toEqual({
			kind: 'show',
			path: shows
		});
		expect(entry(play)).toMatchObject({
			available: 1,
			file: 'Season 01/Lupin (2021) S01E01.mkv'
		});
		// The scan reads the moved folder as the show it now is, and changes nothing.
		const before = snapshot(film);
		await runImport(library, { now: deps.now() + 4 });
		expect(snapshot(film)).toEqual(before);

		expect(await ks.undoKindSwitch(film, library, db)).toBe(true);
		expect(existsSync(file)).toBe(true);
		expect(existsSync(shows)).toBe(false);
		expect(nfo()).toContain('<movie>');
		expect(db.prepare(`SELECT kind, path FROM series WHERE id = ?`).get(film)).toEqual({
			kind: 'movie',
			path: dir
		});
		expect(entry(play).file).toBe('Lupin (2021).mkv');
		expect(await ks.undoKindSwitch(film, library, db)).toBe(false);
	});

	it('refuses a show of several episodes as a film, saying why, and offers no anime', async () => {
		const ks = await import('$lib/server/kind-switch');
		const many = Number(
			db
				.prepare(
					`INSERT INTO series (root_id, title, kind, added_at, origin_key, hidden, source)
					VALUES (?, 'Eight Nights', 'show', 0, 'aniyomi:7000:/show/eight', 0, 'AnimePahe')`
				)
				.run(filmRoot).lastInsertRowid
		);
		for (let n = 1; n <= 8; n++)
			db.prepare(
				`INSERT INTO entries (series_id, position, label, added_at, source_url) VALUES (?, ?, ?, 0, ?)`
			).run(many, n, `Ep. ${n}`, `/eight/${n}`);
		expect(ks.planKindSwitch(many, 'movie', library, db)?.refused).toBe('ONE ENTRY · THIS HAS 8');
		await expect(ks.switchKind(many, 'movie', library, db)).rejects.toThrow(/ONE ENTRY/);
		expect(ks.kindSwitchTargets('show')).toEqual(['movie']);
		expect(ks.kindSwitchTargets('anime')).toEqual([]);
	});
});

/** A series and its entries as rows, for a scan to leave alone. */
function snapshot(id: number) {
	return {
		series: db.prepare(`SELECT * FROM series WHERE id = ?`).get(id),
		entries: db.prepare(`SELECT * FROM entries WHERE series_id = ? ORDER BY id`).all(id)
	};
}

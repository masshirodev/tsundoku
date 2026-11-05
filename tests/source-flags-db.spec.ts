import { beforeEach, describe, expect, it } from 'vitest';
import type { PlannedEntry, PlannedSeries } from '$lib/import/plan';

// Before anything imports db.ts: getDb() reads this once and memoises.
process.env.DATABASE_PATH = ':memory:';
process.env.ENGINE_TOKEN = 't';

const { getDb } = await import('$lib/server/db');
const { ensureRoot, writeSeries } = await import('$lib/server/import/write');
const { forgetSourceUse, libraryIndex } = await import('$lib/server/library-sources');
const flags = await import('$lib/server/engine/source-flags');
const browse = await import('$lib/server/engine/browse');
const { searchSources, addToLibrary, sourceMangaId, undoAdd } =
	await import('$lib/server/engine/backend');
const { installedView, novelsAvailable, pluginsShown } = await import('$lib/server/engine/manage');
const { pluginView } = await import('$lib/server/novels/plugins');
const { novelSearchSources } = await import('$lib/server/novels/source');
const { historyDays, historyTotals } = await import('$lib/server/history');
const { readingTotals, seriesReadingTime } = await import('$lib/server/reading-time');
const { recordReading } = await import('$lib/server/series');
const { sourceOfKey, keyOf, animeKeyOf, novelKeyOf } = await import('$lib/library/downloads');
const { NO_EXT_FILTERS } = await import('$lib/library/ext-filters');

/**
 * A source's own switches (card c435; doc/BROWSE.md, "A source's own
 * switches"): where they are kept, and every door each one closes. The
 * library is written through the importers' writer and read through the
 * reading log's own door (`recordReading`, what /api/reading calls), so each
 * state is reached the way the app reaches it.
 */

const db = getDb();
const NOW = Date.UTC(2026, 10, 3, 12);
const MANGA = '300';
const ANIME = '400';
const PLUGIN = 'good';
const NOVEL = `ln:${PLUGIN}`;

const mihonRoot = ensureRoot(db, 'Mihon', '/nowhere/Mihon', false);
const entry = (n: number, url: string): PlannedEntry => ({
	position: n,
	label: `Ch. ${n}`,
	title: '',
	sourceUrl: url,
	scanlator: '',
	available: true,
	file: `c${n}.cbz`,
	bytes: 0,
	pageCount: 10,
	addedAt: NOW,
	readAt: null,
	lastPosition: null,
	lastOpenedAt: null,
	history: null
});
const plan = (originKey: string, title: string, kind: PlannedSeries['kind']): PlannedSeries => ({
	originKey,
	source: originKey.slice(0, originKey.indexOf(':')) as PlannedSeries['source'],
	title,
	kind,
	rating: 0,
	favourite: false,
	hidden: false,
	shelves: [],
	tags: [],
	description: '',
	status: '',
	direction: null,
	addedAt: NOW,
	sourceUrl: '',
	path: '',
	entries: [entry(1, `${originKey}/c1`), entry(2, `${originKey}/c2`)]
});
const seriesOf = (key: string) =>
	(db.prepare(`SELECT id FROM series WHERE origin_key = ?`).get(key) as { id: number }).id;
const write = (key: string, title: string, kind: PlannedSeries['kind']) => {
	writeSeries(plan(key, title, kind), { rootId: mihonRoot, jobId: null, now: NOW }, db);
	return seriesOf(key);
};

const mangaSeries = write(keyOf(MANGA, '/manga/a'), 'From The Manga Source', 'manga');
const animeSeries = write(animeKeyOf(ANIME, '/anime/b'), 'From The Anime Source', 'anime');
const novelSeries = write(novelKeyOf(PLUGIN, '/novel/c'), 'From The Plugin', 'novel');
const hentoidSeries = write('hentoid-dir:nhentai/A Book', 'From No Source', 'doujin');

for (const [pkg, name, kind, id] of [
	['en.manga', 'Manga Source', 'manga', MANGA],
	['en.anime', 'Anime Source', 'anime', ANIME]
]) {
	db.prepare(
		`INSERT INTO engine_extensions (pkg, name, kind, version_code, version_name, lib, handle, installed_at, updated_at)
		VALUES (?, ?, ?, 1, '1.0', '1.4', ?, 0, 0)`
	).run(pkg, name, kind, pkg.padEnd(64, 'x'));
	db.prepare(
		`INSERT INTO engine_sources (id, pkg, name, lang, base_url) VALUES (?, ?, ?, 'en', 'https://example.org')`
	).run(id, pkg, name);
}
db.prepare(
	`INSERT INTO novel_plugins (id, name, site, lang, version, hash, installed_at, updated_at)
	VALUES (?, 'Good Novels', 'https://good.example', 'en', '1.0.0', ?, 0, 0)`
).run(PLUGIN, 'h'.repeat(64));

/** One read of a series' first entry, through the reading log's door, on a day of its own. */
function read(seriesId: number, day: number) {
	const e = db
		.prepare(`SELECT id FROM entries WHERE series_id = ? ORDER BY position LIMIT 1`)
		.get(seriesId) as { id: number };
	const at = NOW - day * 86_400_000;
	recordReading({ seriesId, entryId: e.id, kind: 'open', page: 1, total: 10, now: at });
	recordReading({
		seriesId,
		entryId: e.id,
		kind: 'page',
		page: 5,
		total: 10,
		durationMs: 60_000 * (day + 1),
		now: at + 60_000
	});
}
read(mangaSeries, 1);
read(animeSeries, 2);
read(novelSeries, 3);
read(hentoidSeries, 4);

const ALL = [MANGA, ANIME, NOVEL] as const;
beforeEach(() => {
	for (const id of ALL) for (const f of flags.SOURCE_FLAGS) flags.setSourceFlag(id, f, false);
	forgetSourceUse();
});

describe('where the switches are kept', () => {
	it('is one settings row per switch on, and none for a switch off', () => {
		expect(flags.sourceFlags(MANGA)).toEqual({
			hidden: false,
			addedHidden: false,
			offHistory: false
		});
		flags.setSourceFlag(MANGA, 'offHistory', true);
		flags.setSourceFlag(NOVEL, 'hidden', true);
		expect(flags.sourceFlags(MANGA)).toEqual({
			hidden: false,
			addedHidden: false,
			offHistory: true
		});
		expect(flags.sourceFlags(NOVEL).hidden).toBe(true);
		expect(
			db.prepare(`SELECT key, value FROM settings WHERE key LIKE 'source.%' ORDER BY key`).all()
		).toEqual([
			{ key: 'source.hidden:ln:good', value: '1' },
			{ key: 'source.off-history:300', value: '1' }
		]);
		// Turned on twice is one row; off leaves none behind.
		flags.setSourceFlag(MANGA, 'offHistory', true);
		flags.setSourceFlag(MANGA, 'offHistory', false);
		flags.setSourceFlag(NOVEL, 'hidden', false);
		expect(
			db.prepare(`SELECT COUNT(*) AS n FROM settings WHERE key LIKE 'source.%'`).get()
		).toEqual({ n: 0 });
	});

	it('lists the sources with a switch on, by BROWSE’s id', () => {
		flags.setSourceFlag(NOVEL, 'hidden', true);
		flags.setSourceFlag(ANIME, 'hidden', true);
		flags.setSourceFlag(MANGA, 'addedHidden', true);
		expect(flags.sourcesWith('hidden')).toEqual(new Set([NOVEL, ANIME]));
		expect(flags.sourcesWith('addedHidden')).toEqual(new Set([MANGA]));
		expect(flags.sourcesWith('offHistory')).toEqual(new Set());
	});

	it('knows its three switches and nothing else', () => {
		expect(flags.SOURCE_FLAGS).toEqual(['hidden', 'addedHidden', 'offHistory']);
		for (const f of flags.SOURCE_FLAGS) expect(flags.isSourceFlag(f)).toBe(true);
		for (const f of ['', 'Hidden', 'added-hidden', 'tracked'])
			expect(flags.isSourceFlag(f)).toBe(false);
	});
});

describe('a series’ source, in SQL', () => {
	it('is what sourceOfKey answers, for every key a writer stores and the edges', () => {
		const keys = [
			keyOf(MANGA, '/manga/a'),
			keyOf('2131019126180322627', '/series/x:y'),
			animeKeyOf(ANIME, '/anime/b'),
			novelKeyOf(PLUGIN, '/novel/c'),
			novelKeyOf('my.plugin-2', '/a:b:c'),
			'hentoid-dir:nhentai/A Book',
			'hentoid:NHENTAI:/g/1/',
			'mihon-dir:Asura Scans (EN)/A Series',
			'epub:a/b.epub',
			'mihon:abc:/x',
			'aniyomi::/x',
			'lnreader:bad plugin:/x',
			'ln:rr',
			'mihon:',
			'mihon:12:',
			'MIHON:12:/x',
			'aniyomi:7:/a\u0000b',
			'lnreader:p:',
			''
		];
		const sql = db.prepare(`SELECT ${flags.sourceIdSql('@k')} AS id`);
		for (const k of keys)
			expect((sql.get({ k }) as { id: string | null }).id, k).toBe(sourceOfKey(k));
		expect((sql.get({ k: null }) as { id: string | null }).id).toBeNull();
	});
});

describe('HIDDEN SOURCE', () => {
	const names = (reveal: boolean) => browse.browseSources(reveal).map((s) => s.id);

	it('lists the source in BROWSE only inside reveal, marked there, whatever its series are', () => {
		expect(names(false)).toEqual([ANIME, MANGA, NOVEL]);
		for (const id of ALL) {
			flags.setSourceFlag(id, 'hidden', true);
			expect(names(false), id).not.toContain(id);
			const inReveal = browse.browseSources(true).find((s) => s.id === id)!;
			expect([inReveal.hiddenSource, inReveal.mostlyHidden], id).toEqual([true, true]);
			// Its own page and its settings are found by this one question.
			expect(browse.browseSource(id, false), id).toBeNull();
			expect(browse.browseSource(id, true)?.id, id).toBe(id);
			flags.setSourceFlag(id, 'hidden', false);
		}
		// Its series were not hidden by it: they keep their own state.
		expect(db.prepare(`SELECT COUNT(*) AS n FROM series WHERE hidden = 1`).get()).toEqual({ n: 0 });
		// Off again, it is listed again, and nothing is left marked.
		expect(browse.browseSources(true).every((s) => !s.hiddenSource && !s.mostlyHidden)).toBe(true);
	});

	it('leaves BROWSE’s sections and RECENT without it outside reveal', () => {
		browse.noteBrowsed(MANGA, 1_000);
		flags.setSourceFlag(MANGA, 'hidden', true);
		const out = browse.browseList(false);
		expect([...out.manga, ...out.anime, ...out.novels].map((r) => r.id)).toEqual([ANIME, NOVEL]);
		expect(out.recent.map((r) => r.id)).toEqual([]);
		expect(browse.browseList(true).recent.map((r) => r.id)).toEqual([MANGA]);
	});

	it('lists its extension in EXTENSIONS only inside reveal', () => {
		const pkgs = (reveal: boolean) => {
			const v = installedView(reveal, NOW);
			return [...v.needsHand, ...v.updates, ...v.current].map((r) => r.pkg).sort();
		};
		expect(pkgs(false)).toContain('en.manga');
		flags.setSourceFlag(MANGA, 'hidden', true);
		expect(pkgs(false)).not.toContain('en.manga');
		expect(pkgs(true)).toContain('en.manga');
	});

	it('lists its LNReader plugin in EXTENSIONS, and updates it, only inside reveal', () => {
		// A repository listing a newer version, so the plugin waits in UPDATES.
		const repo = Number(
			db
				.prepare(`INSERT INTO novel_repos (url, name, added_at) VALUES (?, 'Novels', 0)`)
				.run('https://novels.example/plugins.min.json').lastInsertRowid
		);
		db.prepare(`INSERT INTO novel_listings (repo_id, plugin, listing) VALUES (?, ?, ?)`).run(
			repo,
			PLUGIN,
			JSON.stringify({
				id: PLUGIN,
				name: 'Good Novels',
				site: 'https://good.example',
				lang: 'en',
				version: '2.0.0',
				url: 'https://novels.example/good.js',
				iconUrl: null
			})
		);
		try {
			// What the route draws and counts (INSTALLED) and what UPDATE ALL reaches (`updates`).
			const installed = (reveal: boolean) => {
				const v = pluginsShown(pluginView(reveal, NOW), reveal);
				return [...v.needsHand, ...v.updates, ...v.current].map((r) => r.id);
			};
			const updating = (reveal: boolean) =>
				pluginsShown(pluginView(reveal, NOW), reveal).updates.map((r) => r.id);
			const available = (reveal: boolean, langs: string[] | null = null) =>
				novelsAvailable({
					languages: ['en'],
					reveal,
					filters: { ...NO_EXT_FILTERS, langs }
				});
			expect(installed(false)).toEqual([PLUGIN]);
			expect(updating(false)).toEqual([PLUGIN]);
			expect(available(false).rows.map((r) => r.id)).toEqual([PLUGIN]);
			expect(available(false).total).toBe(1);

			flags.setSourceFlag(NOVEL, 'hidden', true);
			expect(installed(false)).toEqual([]);
			expect(updating(false)).toEqual([]);
			expect(available(false).rows).toEqual([]);
			expect(available(false).total).toBe(0);
			// Not a match in another language either.
			expect(available(false, ['ja']).otherLanguages).toBe(0);
			expect(available(true, ['ja']).otherLanguages).toBe(1);

			expect(installed(true)).toEqual([PLUGIN]);
			expect(updating(true)).toEqual([PLUGIN]);
			expect(available(true).rows.map((r) => r.id)).toEqual([PLUGIN]);
			expect(available(true).total).toBe(1);
		} finally {
			db.prepare(`DELETE FROM novel_repos WHERE id = ?`).run(repo);
		}
	});

	it('counts a shown plugin’s series as reveal lets them be seen, as a Mihon package’s (c506)', () => {
		// Beside each family's one visible series, a second one hidden for its
		// own reasons: one of two is not "mostly hidden", so both stay shown.
		const extra = [
			write(keyOf(MANGA, '/manga/hidden'), 'Hidden From The Manga Source', 'manga'),
			write(novelKeyOf(PLUGIN, '/novel/hidden'), 'Hidden From The Plugin', 'novel')
		];
		db.prepare(`UPDATE series SET hidden = 1 WHERE id IN (?, ?)`).run(...extra);
		forgetSourceUse();
		try {
			const plugin = (reveal: boolean) => {
				const v = pluginsShown(pluginView(reveal, NOW), reveal);
				return [...v.needsHand, ...v.updates, ...v.current].find((r) => r.id === PLUGIN);
			};
			const pkg = (reveal: boolean) => {
				const v = installedView(reveal, NOW);
				return [...v.needsHand, ...v.updates, ...v.current].find((r) => r.pkg === 'en.manga');
			};
			const counts = (r: { series: number; hidden: number } | undefined) =>
				r && { series: r.series, hidden: r.hidden };
			expect(counts(plugin(false))).toEqual({ series: 1, hidden: 0 });
			expect(counts(plugin(true))).toEqual({ series: 2, hidden: 1 });
			// The oracle: EXTENSIONS' Mihon side, and BROWSE's own count of the plugin.
			for (const reveal of [false, true]) {
				expect(counts(plugin(reveal))).toEqual(counts(pkg(reveal)));
				expect(counts(plugin(reveal))).toEqual(
					counts(browse.browseSources(reveal).find((s) => s.id === NOVEL))
				);
			}

			// A HIDDEN SOURCE plugin keeps today's answer: listed, and counted, only in reveal.
			flags.setSourceFlag(NOVEL, 'hidden', true);
			flags.setSourceFlag(MANGA, 'hidden', true);
			expect(plugin(false)).toBeUndefined();
			expect(pkg(false)).toBeUndefined();
			expect(counts(plugin(true))).toEqual({ series: 2, hidden: 1 });
			expect(counts(plugin(true))).toEqual(counts(pkg(true)));
			flags.setSourceFlag(NOVEL, 'hidden', false);
			flags.setSourceFlag(MANGA, 'hidden', false);

			// Mostly hidden (both of its two): the same, without the switch.
			db.prepare(`UPDATE series SET hidden = 1 WHERE id IN (?, ?)`).run(mangaSeries, novelSeries);
			forgetSourceUse();
			expect(plugin(false)).toBeUndefined();
			expect(pkg(false)).toBeUndefined();
			expect(counts(plugin(true))).toEqual({ series: 2, hidden: 2 });
			expect(counts(plugin(true))).toEqual(counts(pkg(true)));
		} finally {
			db.prepare(`UPDATE series SET hidden = 0 WHERE id IN (?, ?)`).run(mangaSeries, novelSeries);
			db.prepare(`DELETE FROM series WHERE id IN (?, ?)`).run(...extra);
			forgetSourceUse();
		}
	});

	it('is searched only inside reveal, by the sources’ search and the plugins’', () => {
		const engine = (reveal: boolean) =>
			searchSources(reveal)
				.map((s) => s.id)
				.sort();
		const plugins = (reveal: boolean) => novelSearchSources(reveal).map((s) => s.id);
		expect(engine(false)).toEqual([MANGA, ANIME]);
		expect(plugins(false)).toEqual([NOVEL]);
		flags.setSourceFlag(MANGA, 'hidden', true);
		flags.setSourceFlag(NOVEL, 'hidden', true);
		expect(engine(false)).toEqual([ANIME]);
		expect(plugins(false)).toEqual([]);
		expect(engine(true)).toEqual([MANGA, ANIME]);
		expect(plugins(true)).toEqual([NOVEL]);
	});

	it('is never named as SAME TITLE’s other source outside reveal', () => {
		expect(libraryIndex(false).nameable(MANGA)).toBe(true);
		flags.setSourceFlag(MANGA, 'hidden', true);
		expect(libraryIndex(false).nameable(MANGA)).toBe(false);
		expect(libraryIndex(true).nameable(MANGA)).toBe(true);
		expect(libraryIndex(false).nameable(ANIME)).toBe(true);
	});
});

describe('OFF HISTORY', () => {
	const rows = (reveal: boolean) => historyDays(reveal).rows.map((r) => r.seriesId);

	it('leaves its series out of HISTORY, inside reveal too, and only its own', () => {
		expect(rows(false)).toEqual([mangaSeries, animeSeries, novelSeries, hentoidSeries]);
		for (const [id, series] of [
			[MANGA, mangaSeries],
			[ANIME, animeSeries],
			[NOVEL, novelSeries]
		] as const) {
			flags.setSourceFlag(id, 'offHistory', true);
			for (const reveal of [false, true]) {
				expect(rows(reveal), `${id} ${reveal}`).not.toContain(series);
				expect(rows(reveal), `${id} ${reveal}`).toHaveLength(3);
			}
			flags.setSourceFlag(id, 'offHistory', false);
		}
		expect(rows(true)).toEqual([mangaSeries, animeSeries, novelSeries, hentoidSeries]);
	});

	it('takes its time out of HISTORY’s total, and is the one summary’s total without it', () => {
		for (const reveal of [false, true])
			expect(historyTotals(reveal)).toEqual(readingTotals(reveal));
		const before = historyTotals(false);
		flags.setSourceFlag(ANIME, 'offHistory', true);
		const after = historyTotals(false);
		const anime = seriesReadingTime(animeSeries, false);
		expect(anime).toBe(3 * 60_000);
		expect(after.ms).toBe(before.ms - anime);
		expect(after.kinds.map((k) => k.kind)).toEqual(['doujin', 'manga', 'novel']);
		// SINCE is the first day of what is left, not the hidden read's.
		const left = historyDays(false).rows;
		expect(after.since).toBe(left.map((r) => r.day).sort()[0]);
	});

	it('still logs the read: progress and the series’ own time are what they were', () => {
		flags.setSourceFlag(MANGA, 'offHistory', true);
		const events = () =>
			(
				db
					.prepare(`SELECT COUNT(*) AS n FROM reading_events WHERE series_id = ?`)
					.get(mangaSeries) as { n: number }
			).n;
		const n = events();
		read(mangaSeries, 0);
		expect(events()).toBe(n + 2);
		expect(
			db
				.prepare(`SELECT last_position FROM entries WHERE series_id = ? ORDER BY position LIMIT 1`)
				.get(mangaSeries)
		).toEqual({ last_position: 5 });
		expect(seriesReadingTime(mangaSeries, false)).toBe(2 * 60_000 + 60_000);
		expect(rows(true)).not.toContain(mangaSeries);
	});
});

describe('ADDED HIDDEN, and the ADD that hid it (c505)', () => {
	// ADD on a series the library already knows answers without the engine
	// (`addToLibrary`'s `keepOrPromote`), so each state is reached by the door
	// the preview's ADD AND DOWNLOAD calls.
	const at = (path: string) => ({ id: sourceMangaId(MANGA, path), key: keyOf(MANGA, path) });
	const hiddenOf = (id: number) =>
		(db.prepare(`SELECT hidden FROM series WHERE id = ?`).get(id) as { hidden: number }).hidden;
	const added: number[] = [];
	const writeAs = (path: string, title: string, o: { browsing?: boolean; hidden?: boolean }) => {
		const { key } = at(path);
		writeSeries(
			{ ...plan(key, title, 'manga'), hidden: o.hidden ?? false },
			{ rootId: mihonRoot, jobId: null, now: NOW, browsing: o.browsing ?? false },
			db
		);
		const id = seriesOf(key);
		added.push(id);
		return id;
	};
	const afterEachCase = () => {
		for (const id of added.splice(0)) db.prepare(`DELETE FROM series WHERE id = ?`).run(id);
		forgetSourceUse();
	};

	it('says a browsing record ADD promoted and hid was hidden by this ADD', async () => {
		try {
			const record = writeAs('/manga/record', 'A Record Of The Manga Source', { browsing: true });
			flags.setSourceFlag(MANGA, 'addedHidden', true);
			const { id, key } = at('/manga/record');
			const r = await flags.addWatchingHidden(key, () => addToLibrary(id, NOW));
			expect(r).toEqual({ seriesId: record, hidByThisAdd: true });
			expect(hiddenOf(record)).toBe(1);
		} finally {
			afterEachCase();
		}
	});

	it('says a series already here and hidden for its own reasons was not', async () => {
		try {
			const own = writeAs('/manga/own', 'Hidden For Its Own Reasons', { hidden: true });
			flags.setSourceFlag(MANGA, 'addedHidden', true);
			const { id, key } = at('/manga/own');
			const r = await flags.addWatchingHidden(key, () => addToLibrary(id, NOW));
			// ADD answered with it (keepOrPromote) and left it as it was: not this ADD's.
			expect(r).toEqual({ seriesId: own, hidByThisAdd: false });
			expect(hiddenOf(own)).toBe(1);
			// The switch off, the same.
			flags.setSourceFlag(MANGA, 'addedHidden', false);
			expect(await flags.addWatchingHidden(key, () => addToLibrary(id, NOW))).toEqual({
				seriesId: own,
				hidByThisAdd: false
			});
		} finally {
			afterEachCase();
		}
	});

	it('says a visible series ADD answered with, and a record with the switch off, were not', async () => {
		try {
			flags.setSourceFlag(MANGA, 'addedHidden', true);
			const shown = at('/manga/a');
			expect(await flags.addWatchingHidden(shown.key, () => addToLibrary(shown.id, NOW))).toEqual({
				seriesId: mangaSeries,
				hidByThisAdd: false
			});
			expect(hiddenOf(mangaSeries)).toBe(0);

			flags.setSourceFlag(MANGA, 'addedHidden', false);
			const record = writeAs('/manga/record-off', 'A Record, Switch Off', { browsing: true });
			const { id, key } = at('/manga/record-off');
			expect(await flags.addWatchingHidden(key, () => addToLibrary(id, NOW))).toEqual({
				seriesId: record,
				hidByThisAdd: false
			});
			expect(hiddenOf(record)).toBe(0);
		} finally {
			afterEachCase();
		}
	});

	it('reads nothing without a key: inside reveal the question is not asked', async () => {
		try {
			const record = writeAs('/manga/record-reveal', 'A Record, Reveal On', { browsing: true });
			flags.setSourceFlag(MANGA, 'addedHidden', true);
			const { id } = at('/manga/record-reveal');
			expect(await flags.addWatchingHidden(null, () => addToLibrary(id, NOW))).toEqual({
				seriesId: record,
				hidByThisAdd: false
			});
			// It was still added hidden: reveal changes only what is asked.
			expect(hiddenOf(record)).toBe(1);
		} finally {
			afterEachCase();
		}
	});

	it('names the band’s series by its id and its key, and not after UNDO or under another key', async () => {
		try {
			const record = writeAs('/manga/band', 'The Band’s Series', { browsing: true });
			// As ADD writes one: every chapter NOT DOWNLOADED.
			db.prepare(`UPDATE entries SET available = 0 WHERE series_id = ?`).run(record);
			flags.setSourceFlag(MANGA, 'addedHidden', true);
			const { id, key } = at('/manga/band');
			await addToLibrary(id, NOW);
			expect(flags.addedHere(record, key)).toEqual({ entries: 2, touched: false, kind: 'manga' });
			// Another key with the same id: not the band's series.
			expect(flags.addedHere(record, keyOf(MANGA, '/manga/a'))).toBeNull();
			// Read: UNDO would be refused, and the band says so.
			db.prepare(
				`UPDATE entries SET read_at = ? WHERE id = (SELECT id FROM entries WHERE series_id = ? LIMIT 1)`
			).run(NOW, record);
			expect(flags.addedHere(record, key)?.touched).toBe(true);
			expect(undoAdd(record)).toBe(false);
			db.prepare(`UPDATE entries SET read_at = NULL WHERE series_id = ?`).run(record);
			// UNDO, then the same id given to a series added later: never the band's.
			expect(undoAdd(record)).toBe(true);
			added.splice(added.indexOf(record), 1);
			expect(flags.addedHere(record, key)).toBeNull();
			const later = writeAs('/manga/later', 'Added Later', {});
			expect(flags.addedHere(later, key)).toBeNull();
		} finally {
			afterEachCase();
		}
	});
});

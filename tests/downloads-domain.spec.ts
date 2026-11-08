import { describe, expect, it } from 'vitest';
import {
	KIND_TAB,
	kindAsked,
	kindsServed,
	sourcesOfKind
} from '../src/routes/downloads/search/source-kinds';
import { KINDS, SOURCE_FAMILIES, SOURCE_KINDS, type SourceFamily } from '$lib/library/kinds';
import {
	addedDetail,
	allToDownload,
	chapterStates,
	confirmLines,
	downloadCounts,
	downloadRow,
	downloadStatus,
	fileQueueMeta,
	followQueue,
	highlight,
	mostlyHidden,
	nextToDownload,
	normTitle,
	parseKey,
	previewConfirm,
	previewDownload,
	queueView,
	rowAction,
	sourcesToSearch,
	type QueueItem,
	type QueueSeries
} from '$lib/library/downloads';

// The one block below calls the real downloader (c613): the smallest database
// the other downloads specs use, in memory, before `db.ts` is first imported.
process.env.DATABASE_PATH = ':memory:';
const { getDb } = await import('$lib/server/db');
const downloads = await import('$lib/server/downloads');

/** Chapters 1–30: 1–10 on disk at 40 MB each, 1–5 read. */
const entries = Array.from({ length: 30 }, (_, i) => ({
	id: i + 1,
	number: i + 1,
	readAt: i < 5 ? 1 : null,
	available: i < 10,
	bytes: i < 10 ? 40_000_000 : 0,
	matter: '' as const
}));
const urls = new Map(entries.map((e) => [e.id, `/c/${e.number}`]));
const chapters = entries.map((e) => ({
	id: 1000 + e.number,
	url: `/c/${e.number}`,
	downloaded: false
}));
const item = (n: number, state: QueueItem['state'], extra: Partial<QueueItem> = {}): QueueItem => ({
	chapterId: 1000 + n,
	state,
	progress: 0,
	tries: 0,
	pageCount: 20,
	number: n,
	name: `Chapter ${n}`,
	key: 'mihon:1:/m',
	mangaId: 7,
	mangaTitle: 'The source’s title',
	...extra
});

describe('a chapter’s place in downloading', () => {
	const done = chapters.map((c) => (c.id === 1011 ? { ...c, downloaded: true } : c));
	const states = chapterStates(entries, urls, done, [
		item(12, 'QUEUED'),
		item(13, 'DOWNLOADING', { progress: 0.5 }),
		item(14, 'ERROR', { tries: 3 }),
		item(15, 'FINISHED')
	]);

	it('follows the file, then the source, then the queue', () => {
		expect(states.get(1)).toEqual({ kind: 'have' });
		expect(states.get(11)).toEqual({ kind: 'importing' });
		expect(states.get(12)).toEqual({ kind: 'queued', chapterId: 1012 });
		expect(states.get(13)).toMatchObject({ kind: 'downloading', page: 10, pages: 20 });
		expect(states.get(14)).toEqual({ kind: 'failed', chapterId: 1014, tries: 3 });
		expect(states.get(15)).toEqual({ kind: 'importing' });
		expect(states.get(16)).toEqual({ kind: 'none', chapterId: 1016 });
	});

	it('is nothing to ask for when the source doesn’t list the chapter', () => {
		const s = chapterStates(entries, urls, chapters.slice(0, 20), []);
		expect(s.get(25)).toEqual({ kind: 'none', chapterId: null });
		expect(rowAction(s.get(25))).toBeNull();
	});

	it('says FAILED with its tries, never a reason the queue doesn’t give', () => {
		expect(downloadStatus(states.get(14))).toBe('FAILED · 3 TRIES');
		expect(downloadStatus(states.get(14), true)).toBe('FAILED');
		expect(downloadStatus(states.get(13))).toBe('DOWNLOADING · 10 / 20');
		expect(downloadStatus(states.get(13), true)).toBe('10 / 20');
		expect(downloadStatus(states.get(12))).toBe('QUEUED');
		expect(downloadStatus(states.get(11))).toBe('IMPORTING');
		// No file and nothing under way: the row's own NOT DOWNLOADED stays.
		expect(downloadStatus(states.get(16))).toBeNull();
		expect(downloadStatus(states.get(1))).toBeNull();
	});

	it('a page count not fetched yet reads as a percentage', () => {
		const s = chapterStates(entries, urls, chapters, [
			item(13, 'DOWNLOADING', { progress: 0.25, pageCount: -1 })
		]);
		expect(downloadStatus(s.get(13))).toBe('DOWNLOADING · 25%');
	});

	it('a tap queues a row with no file and retries a failed one', () => {
		expect(rowAction(states.get(16))).toBe('queue');
		expect(rowAction(states.get(14))).toBe('retry');
		expect(rowAction(states.get(12))).toBeNull();
		expect(rowAction(states.get(1))).toBeNull();
	});
});

describe('NEXT 10 and ALL', () => {
	const states = chapterStates(entries, urls, chapters, [item(12, 'QUEUED'), item(14, 'ERROR')]);

	it('NEXT takes the next unread chapters with no file, skipping what’s under way', () => {
		expect(nextToDownload(entries, states)).toEqual([11, 13, 15, 16, 17, 18, 19, 20, 21, 22]);
	});

	it('ALL takes every one, and never a read chapter', () => {
		const read = entries.map((e) => (e.id === 20 ? { ...e, readAt: 1 } : e));
		expect(allToDownload(read, states)).not.toContain(20);
		expect(allToDownload(entries, states)).toHaveLength(18);
	});

	it('ALL asks with the span, the size at the series’ own average, and the queue', () => {
		const ids = allToDownload(entries, states);
		const c = confirmLines(entries, ids, 2316);
		expect(c.title).toBe('DOWNLOAD 18 CHAPTERS?');
		expect(c.lines).toEqual([
			'CH. 11 – 30 · EVERY UNREAD CHAPTER WITH NO FILE',
			'ABOUT 720 MB ON /MNT/HDD2 · 40.0 MB A CHAPTER IN THIS SERIES',
			'QUEUED BEHIND 2,316 CHAPTERS OF OTHER SERIES'
		]);
	});

	it('says when read chapters with no file are left out', () => {
		const read = entries.map((e) => (e.id === 20 ? { ...e, readAt: 1 } : e));
		expect(confirmLines(read, allToDownload(read, states), 0).lines).toContain(
			'READ CHAPTERS WITH NO FILE ARE LEFT OUT'
		);
	});
});

describe('the DOWNLOAD row', () => {
	const clock = () => '14:02';

	it('counts what’s missing and what’s under way, NEXT 10 in accent', () => {
		const states = chapterStates(entries, urls, chapters, [item(12, 'QUEUED'), item(14, 'ERROR')]);
		expect(downloadRow(entries, { kind: 'ok', states }, true, clock)).toEqual({
			a: '20 unread chapters not downloaded',
			b: '1 QUEUED · 1 FAILED · CH. 14 FAILED',
			cells: [
				{ label: 'NEXT 10', which: 'next', acc: true, dim: false },
				{ label: 'ALL 18', which: 'all', acc: false, dim: false }
			]
		});
	});

	it('is FIRST when nothing of the series is on disk, and one cell for ten or fewer', () => {
		const none = entries.slice(20).map((e) => ({ ...e, available: false, readAt: null }));
		const states = chapterStates(none, urls, chapters, []);
		expect(downloadRow(none, { kind: 'ok', states }, true, clock).cells).toEqual([
			{ label: 'FIRST 10', which: 'next', acc: true, dim: false }
		]);
	});

	it('keeps its cells, dimmed, when the engine isn’t answering or the device is offline', () => {
		const down = downloadRow(entries, { kind: 'down', since: 0 }, true, clock);
		expect(down.b).toBe('○ NOT ANSWERING · THE EXTENSION ENGINE ON THE WORKSTATION · SINCE 14:02');
		expect(down.cells.every((c) => c.dim)).toBe(true);
		const states = chapterStates(entries, urls, chapters, []);
		const off = downloadRow(entries, { kind: 'ok', states }, false, clock);
		expect(off.b).toBe('○ OFFLINE · DOWNLOADING NEEDS THE WORKSTATION');
		expect(off.cells.map((c) => c.label)).toEqual(['NEXT 10', 'ALL 20']);
	});

	it('offers REFRESH where the series has a source, dimmed when it cannot be asked (c220)', () => {
		const states = chapterStates(entries, urls, chapters, []);
		expect(
			downloadRow(entries, { kind: 'ok', states }, true, clock, null, clock, undefined, true).cells
		).toEqual([
			{ label: 'NEXT 10', which: 'next', acc: true, dim: false },
			{ label: 'ALL 20', which: 'all', acc: false, dim: false },
			{ label: 'REFRESH', which: 'refresh', acc: false, dim: false }
		]);
		// A folder-scanned series has nothing to ask.
		expect(
			downloadRow(entries, { kind: 'ok', states }, true, clock).cells.map((c) => c.label)
		).toEqual(['NEXT 10', 'ALL 20']);
		const off = downloadRow(
			entries,
			{ kind: 'ok', states },
			false,
			clock,
			null,
			clock,
			undefined,
			true
		);
		expect(off.cells.map((c) => [c.label, c.dim])).toContainEqual(['REFRESH', true]);
	});

	it('puts the queue on the FILE line', () => {
		const states = chapterStates(entries, urls, chapters, [
			item(12, 'QUEUED'),
			item(13, 'DOWNLOADING'),
			item(14, 'ERROR')
		]);
		expect(fileQueueMeta(downloadCounts(entries, states))).toEqual(['2 QUEUED', '1 FAILED']);
	});
});

describe('DOWNLOAD on a preview (c205)', () => {
	it('offers FIRST and ALL as the library row does, and says it adds first', () => {
		const r = previewDownload(143);
		expect(r.a).toBe('143 unread chapters not downloaded');
		expect(r.b).toBe('ADDS IT TO YOUR LIBRARY FIRST · IT ASKS');
		expect(r.cells.map((c) => c.label)).toEqual(['FIRST 10', 'ALL 143']);
		expect(previewDownload(4).cells.map((c) => c.label)).toEqual(['FIRST 4']);
		expect(previewDownload(1, true).a).toBe('1 unwatched episode not downloaded');
	});
	it('has nothing to offer once a record has read it all, and says offline', () => {
		expect(previewDownload(0)).toMatchObject({ a: 'Nothing unread to download', cells: [] });
		expect(previewDownload(5, false, false).b).toBe(
			'○ OFFLINE · DOWNLOADING NEEDS THE WORKSTATION'
		);
	});
	it('asks in its own words, with what it will download', () => {
		const c = previewConfirm('Solo Leveling', 143, 'next');
		expect(c.title).toBe('DOWNLOADING ADDS IT TO YOUR LIBRARY');
		expect(c.lines).toEqual([
			'SOLO LEVELING GOES INTO YOUR LIBRARY, WHERE DOWNLOADS ARE KEPT.',
			'THEN ITS FIRST 10 UNREAD CHAPTERS DOWNLOAD.',
			'UNDO ON ITS PAGE TAKES IT OUT AGAIN, UNTIL ONE HAS DOWNLOADED.'
		]);
		expect(c.confirm).toBe('ADD AND DOWNLOAD');
		expect(previewConfirm('x', 1200, 'all', true).lines[1]).toBe(
			'THEN ALL 1,200 UNWATCHED EPISODES DOWNLOAD.'
		);
	});
	it('the ADDED band says what was queued, or that the queue did not answer', () => {
		expect(addedDetail(12, null)).toBe('12 CHAPTERS · NONE DOWNLOADED');
		expect(addedDetail(12, '10')).toBe('12 CHAPTERS · 10 DOWNLOADING');
		expect(addedDetail(12, '0')).toBe('12 CHAPTERS · NONE DOWNLOADED');
		expect(addedDetail(1, 'down', true)).toBe(
			'1 EPISODE · NOT QUEUED · DOWNLOADING ISN’T ANSWERING'
		);
	});
});

describe('the queue', () => {
	const series: Record<string, QueueSeries> = {
		'mihon:1:/m': { id: 1, title: 'Kingdom', hidden: false, cover: null, hue: 20 },
		'mihon:1:/h': { id: 2, title: 'Natsu no Owari ni', hidden: true, cover: null, hue: 330 }
	};
	const of = (k: string) => series[k] ?? null;
	const items = [
		item(1, 'DOWNLOADING', { progress: 0.5 }),
		item(2, 'QUEUED'),
		item(3, 'ERROR', { tries: 3 }),
		item(9, 'QUEUED', { key: 'mihon:1:/h', mangaId: 8 }),
		item(10, 'ERROR', { key: 'mihon:1:/h', mangaId: 8 }),
		item(4, 'QUEUED', { key: 'mihon:1:/new', mangaId: 9, mangaTitle: 'Not imported yet' }),
		item(5, 'FINISHED')
	];

	it('groups by series in the queue’s order, failures apart', () => {
		const v = queueView(items, of, true);
		expect(v.groups.map((g) => [g.title, g.count, g.span, g.active])).toEqual([
			['Kingdom', 2, 'CH. 1 – 2', true],
			['Natsu no Owari ni', 1, 'CH. 9', false],
			['Not imported yet', 1, 'CH. 4', false]
		]);
		expect(v.failures.map((f) => f.chapterId)).toEqual([1003, 1010]);
		expect(v.downloading?.chapterId).toBe(1001);
		expect(v.queued).toBe(4);
	});

	it('with reveal off, neither names nor counts a hidden series, nor one not imported yet', () => {
		const v = queueView(items, of, false);
		expect(v.groups.map((g) => g.title)).toEqual(['Kingdom']);
		expect(v.failures.map((f) => f.chapterId)).toEqual([1003]);
		expect(v.queued).toBe(2);
	});

	it('a queue of hidden series alone reads as empty', () => {
		const v = queueView([item(9, 'QUEUED', { key: 'mihon:1:/h', mangaId: 8 })], of, false);
		expect(v).toEqual({
			downloading: null,
			downloadingEpisode: null,
			failures: [],
			groups: [],
			queued: 0
		});
	});
});

describe('keys', () => {
	it('only a Mihon series keyed by its URL is one its source can be asked about', () => {
		expect(parseKey('mihon:6247824327199706550:/series/x')).toEqual({
			sourceId: '6247824327199706550',
			url: '/series/x'
		});
		expect(parseKey('mihon-dir:Asura/X')).toBeNull();
		expect(parseKey('hentoid:12')).toBeNull();
		expect(parseKey(null)).toBeNull();
	});
});

describe('FOLLOW on the DOWNLOAD row', () => {
	const clock = () => '14:02';
	const ago = () => '2 H AGO';

	it('ends the row as FOLLOW, and as FOLLOWING ✓ in accent once on', () => {
		const states = chapterStates(entries, urls, chapters, []);
		const off = downloadRow(entries, { kind: 'ok', states }, true, clock, {
			on: false,
			checked: null
		});
		expect(off.cells.map((c) => [c.label, c.acc])).toEqual([
			['NEXT 10', true],
			['ALL 20', false],
			['FOLLOW', false]
		]);
		const on = downloadRow(
			entries,
			{ kind: 'ok', states },
			true,
			clock,
			{ on: true, checked: 1 },
			ago
		);
		expect(on.cells.at(-1)).toEqual({
			label: 'FOLLOWING ✓',
			which: 'unfollow',
			acc: true,
			dim: false
		});
	});

	it('caught up and followed, FOLLOWING is the only cell and says when it last looked', () => {
		const all = entries.map((e) => ({ ...e, available: true }));
		const states = chapterStates(all, urls, chapters, []);
		expect(
			downloadRow(all, { kind: 'ok', states }, true, clock, { on: true, checked: 1 }, ago)
		).toEqual({
			a: 'Every unread chapter downloaded or on its way',
			b: 'FOLLOWING · NEW CHAPTERS DOWNLOAD AS THEY APPEAR · CHECKED 2 H AGO',
			cells: [{ label: 'FOLLOWING ✓', which: 'unfollow', acc: true, dim: false }]
		});
	});

	it('is dimmed with the rest when the engine isn’t answering', () => {
		const r = downloadRow(entries, { kind: 'down', since: 0 }, true, clock, {
			on: false,
			checked: null
		});
		expect(r.cells.at(-1)).toMatchObject({ label: 'FOLLOW', dim: true });
	});
});

describe('which chapters FOLLOW queues', () => {
	const at = 1_000;
	const ch = (id: number, fetchedAt: number, downloaded = false) => ({
		id,
		url: `/c/${id}`,
		fetchedAt,
		downloaded
	});

	it('only what Suwayomi fetched after following, not downloaded, queued or read', () => {
		const list = [ch(1, 500), ch(2, 1500), ch(3, 1500, true), ch(4, 1500), ch(5, 1500)];
		expect(followQueue(list, at, new Set([4]), new Set(['/c/5']))).toEqual([2]);
	});

	it('never more than the cap in one run', () => {
		const many = Array.from({ length: 80 }, (_, i) => ch(i + 1, 2000));
		expect(followQueue(many, at, new Set(), new Set())).toHaveLength(50);
	});
});

describe('searching the sources', () => {
	const installed = [
		{ id: '1', name: 'Asura Scans' },
		{ id: '2', name: 'Toonily' },
		{ id: '3', name: 'MangaDex (DE)' },
		{ id: '4', name: 'Webtoons' }
	];
	const use = new Map([
		['1', { series: 130, hidden: 0 }],
		['2', { series: 124, hidden: 110 }],
		['4', { series: 2, hidden: 1 }]
	]);

	it('asks the sources the library reads from, a mostly hidden one only with reveal on', () => {
		expect(sourcesToSearch(installed, use, false).map((s) => s.id)).toEqual(['1', '4']);
		expect(sourcesToSearch(installed, use, true).map((s) => s.id)).toEqual(['1', '2', '4']);
	});

	it('asks what BROWSE lists too, so a new library’s search asks someone', () => {
		// Nothing read yet: MangaDex (DE) is listed (an extension in no chosen language).
		expect(sourcesToSearch(installed, new Map(), false, new Set(['3'])).map((s) => s.id)).toEqual([
			'3'
		]);
		// Listed, but mostly hidden here: still only with reveal on.
		expect(sourcesToSearch(installed, use, false, new Set(['2'])).map((s) => s.id)).toEqual([
			'1',
			'4'
		]);
	});

	it('mostly hidden is more than half', () => {
		expect(mostlyHidden({ series: 2, hidden: 1 })).toBe(false);
		expect(mostlyHidden({ series: 17, hidden: 14 })).toBe(true);
	});

	it('highlights the query where it is, and compares titles loosely', () => {
		expect(highlight('The Lindenborough Heir Returns', 'lindenborough')).toEqual({
			pre: 'The ',
			mid: 'Lindenborough',
			post: ' Heir Returns'
		});
		expect(highlight('Kingdom', 'linden')).toEqual({ pre: 'Kingdom', mid: '', post: '' });
		expect(normTitle('The Spark in Your Eyes!')).toBe(normTitle('the spark in your  eyes'));
		expect(normTitle('Pokémon')).toBe('pokemon');
	});
});

describe('DOWNLOAD FIRST 10 on a series (c613)', () => {
	const db = getDb();
	const root = Number(
		db.prepare(`INSERT INTO roots (name, path, hidden) VALUES ('Manga', '/nowhere', 0)`).run()
			.lastInsertRowid
	);
	let n = 0;
	/** An Aniyomi series of [count] unread episodes with no file, and nothing queued. */
	const show = (count: number) => {
		const id = Number(
			db
				.prepare(
					`INSERT INTO series (root_id, title, kind, added_at, origin_key, source, in_library)
					VALUES (?, ?, 'anime', 0, ?, 'AnimePahe', 1)`
				)
				.run(root, `First Ten ${++n}`, `aniyomi:1:/first-ten-${n}`).lastInsertRowid
		);
		const put = db.prepare(
			`INSERT INTO entries (series_id, position, label, added_at, source_url, season, episode_number, available)
			VALUES (?, ?, ?, 0, ?, 1, ?, 0)`
		);
		for (let e = 1; e <= count; e++) put.run(id, e, `Episode ${e}`, `/ep/${e}`, e);
		return {
			id,
			entries: (
				db
					.prepare(
						`SELECT id, position AS number, read_at AS readAt, available, 0 AS bytes, '' AS matter
						FROM entries WHERE series_id = ? ORDER BY position`
					)
					.all(id) as {
					id: number;
					number: number;
					readAt: number | null;
					available: number;
					bytes: number;
					matter: '';
				}[]
			).map((e) => ({ ...e, available: e.available === 1 }))
		};
	};
	const queued = (id: number) =>
		db
			.prepare(`SELECT q.entry_id FROM download_queue q WHERE q.series_id = ? ORDER BY q.entry_id`)
			.all(id) as { entry_id: number }[];

	it('queues the first ten once, and counts them as already under way on the next press', async () => {
		// A part with more than ten unread, file-less entries: the count is tested
		// past its own size, which is what FIRST 10 gets wrong when it means NEXT.
		const { id, entries } = show(12);
		expect(await downloads.queueSeries(id, entries, 'first')).toEqual({
			queued: 10,
			missing: 0,
			already: 0
		});
		expect(queued(id).map((q) => q.entry_id)).toEqual(entries.slice(0, 10).map((e) => e.id));
		// The second press: the same ten, already under way, and entry 11 untouched.
		expect(await downloads.queueSeries(id, entries, 'first')).toEqual({
			queued: 0,
			missing: 0,
			already: 10
		});
		expect(queued(id).map((q) => q.entry_id)).not.toContain(entries[10].id);
	});

	it('does the same at exactly ten', async () => {
		const { id, entries } = show(10);
		expect(await downloads.queueSeries(id, entries, 'first')).toEqual({
			queued: 10,
			missing: 0,
			already: 0
		});
		expect(await downloads.queueSeries(id, entries, 'first')).toEqual({
			queued: 0,
			missing: 0,
			already: 10
		});
	});
});

describe('SEARCH THE SOURCES’ KIND band (c699)', () => {
	const src = (id: string, kind: (typeof KINDS)[number] | null) => ({
		id,
		name: id,
		lang: 'en',
		kind
	});
	// Every family's own kind, as `kindOfSource` gives it: a Mihon source, an
	// LNReader plugin, an Aniyomi extension; and one the engine has no row for.
	const sources = [
		src('a', SOURCE_KINDS.aniyomi),
		src('m1', SOURCE_KINDS.mihon),
		src('n', SOURCE_KINDS.lnreader),
		src('m2', SOURCE_KINDS.mihon),
		src('x', null)
	];

	it('offers the kinds a source serves, in the registry’s order, and no other', () => {
		const served = kindsServed(sources);
		expect(served).toEqual(KINDS.filter((k) => served.includes(k)));
		expect(new Set(served)).toEqual(new Set(Object.values(SOURCE_KINDS)));
		expect(kindsServed([src('m', SOURCE_KINDS.mihon)])).toEqual([SOURCE_KINDS.mihon]);
		expect(kindsServed([src('x', null)])).toEqual([]);
	});

	// The whole domain, written out rather than derived from the registry the
	// code reads: every library kind against each source family alone, and
	// against all of them (c736).
	const ASKS: Record<SourceFamily | 'every', Record<(typeof KINDS)[number], string | null>> = {
		mihon: { manga: 'manga', manhwa: 'manga', doujin: 'manga', novel: null, anime: null },
		lnreader: { manga: null, manhwa: null, doujin: null, novel: 'novel', anime: null },
		aniyomi: { manga: null, manhwa: null, doujin: null, novel: null, anime: 'anime' },
		every: { manga: 'manga', manhwa: 'manga', doujin: 'manga', novel: 'novel', anime: 'anime' }
	};

	it('a library kind asks the source kind serving its medium, for every kind and family (c736)', () => {
		for (const family of SOURCE_FAMILIES) {
			const served = kindsServed([src('s', SOURCE_KINDS[family])]);
			for (const k of KINDS)
				expect([family, k, kindAsked(k, served)]).toEqual([family, k, ASKS[family][k]]);
		}
		const served = kindsServed(sources);
		for (const k of KINDS) expect([k, kindAsked(k, served)]).toEqual([k, ASKS.every[k]]);
		// No source at all asks nothing, whatever the library is filtered to.
		for (const k of KINDS) expect(kindAsked(k, [])).toBeNull();
	});

	it('what a `?kind=` resolved to asks the same kind again', () => {
		const served = kindsServed(sources);
		for (const k of KINDS) {
			const once = kindAsked(k, served);
			expect(kindAsked(once, served)).toBe(once);
		}
	});

	it('a word that is no kind is ALL, on a box that serves every kind', () => {
		const served = kindsServed(sources);
		for (const word of [null, '', 'ANIME', 'MANHWA', 'mihon', 'manhwas', 'constructor'])
			expect([word, kindAsked(word, served)]).toEqual([word, null]);
	});

	it('asks a kind’s own sources, in their order, and every source under ALL', () => {
		expect(sourcesOfKind(sources, SOURCE_KINDS.mihon).map((s) => s.id)).toEqual(['m1', 'm2']);
		expect(sourcesOfKind(sources, SOURCE_KINDS.aniyomi).map((s) => s.id)).toEqual(['a']);
		expect(sourcesOfKind(sources, null).map((s) => s.id)).toEqual(['a', 'm1', 'n', 'm2', 'x']);
		// A source with no kind is asked under ALL only.
		for (const k of KINDS) expect(sourcesOfKind(sources, k).some((s) => s.id === 'x')).toBe(false);
	});

	it('names every kind, so a kind added to the registry needs its word here', () => {
		for (const k of KINDS) expect(KIND_TAB[k]).toMatch(/^[A-Z]+$/);
	});
});

import { beforeAll, describe, expect, it } from 'vitest';

// Before anything imports db.ts: getDb() reads this once and memoises.
process.env.DATABASE_PATH = ':memory:';

const { getDb } = await import('$lib/server/db');
const { seedSample } = await import('$lib/server/fixtures');
const lib = await import('$lib/server/library');
const series = await import('$lib/server/series');
const { sampleEpub } = await import('$lib/server/pages/sample-epub');
const { kindFacts } = await import('$lib/library/kinds');
const { Zip } = await import('$lib/epub/unzip');

beforeAll(() => {
	seedSample(getDb(), Date.UTC(2026, 8, 22));
});

const idOf = (title: string) => lib.listSeries({ reveal: true }).find((s) => s.title === title)!.id;

describe('the series page', () => {
	it('reads metadata, tags and every entry in order', () => {
		const s = series.seriesPage(idOf('Tower of God'), false)!;
		expect(s.altTitles).toEqual(['신의 탑', 'Sin-ui Tap']);
		expect(s.source).toBe('mihon');
		expect(s.entries).toHaveLength(600);
		expect(s.entries.map((e) => e.number).slice(0, 3)).toEqual([1, 2, 3]);
		expect(s.entries[593]).toMatchObject({
			number: 594,
			readAt: null,
			pageCount: 54,
			lastPosition: 11
		});
	});

	it('is unreachable while hidden and reveal is off, like a series that does not exist', () => {
		const hidden = idOf('Kōhai no Himitsu Nikki');
		expect(series.seriesPage(hidden, false)).toBeNull();
		expect(series.seriesPage(hidden, true)).not.toBeNull();
		expect(series.seriesPage(999_999, true)).toBeNull();
	});
});

describe('the seed’s places (c653)', () => {
	// Every in-progress entry of every seeded series: a list a person picked
	// would prove only what was picked.
	const inProgress = () =>
		lib.listSeries({ reveal: true }).flatMap((card) => {
			const s = series.seriesPage(card.id, true)!;
			return s.entries
				.filter((e) => e.readAt === null && e.lastPosition !== null)
				.map((e) => ({ title: s.title, kind: s.kind, number: e.number, place: e.lastPosition! }));
		});

	it('a novel in progress is at a block inside its generated chapter', async () => {
		const novels = inProgress().filter((e) => kindFacts(e.kind).medium === 'text');
		expect(novels.map((e) => e.title).sort()).toEqual(
			expect.arrayContaining(['Mushoku Tensei', 'Villainess Level 99'])
		);
		const book = new Zip(
			new Uint8Array(
				sampleEpub({
					title: 'blocks',
					hue: 0,
					chapters: Array.from({ length: 30 }, (_, i) => `Vol. ${i + 1}`)
				})
			)
		);
		for (const e of novels) {
			const xhtml = new TextDecoder().decode(await book.bytesOf(`OEBPS/ch${e.number}.xhtml`));
			expect(e.place).toBe(7);
			expect((xhtml.match(/<(h1|p|pre|table)\b/g) ?? []).length).toBeGreaterThan(e.place);
		}
	});

	it('an image entry keeps its page, the image readers’ meaning', () => {
		const images = inProgress().filter((e) => kindFacts(e.kind).medium === 'pages');
		expect(images.length).toBeGreaterThan(0);
		// A manga's 24 pages at 22%, a webtoon's 54, each 0-based.
		expect(images.find((e) => e.title === 'Tower of God')?.place).toBe(11);
		expect(images.filter((e) => e.kind === 'manga').every((e) => e.place === 4)).toBe(true);
	});
});

describe('marking entries', () => {
	it('changes exactly the entries that were not already in that state', () => {
		const id = idOf('Kusuriya no Hitorigoto');
		const s = series.seriesPage(id, false)!;
		const read = s.entries[0].id; // already read
		const unread = s.entries[40].id;
		expect(series.markEntries(id, [read, unread], true)).toBe(1);
		expect(series.markEntries(id, [read, unread], false)).toBe(2);
		expect(series.markEntries(id, [read], true)).toBe(1);
	});

	it('cannot reach into another series', () => {
		const a = idOf('Kusuriya no Hitorigoto');
		const other = series.seriesPage(idOf('Dungeon Meshi'), false)!.entries[0].id;
		expect(series.markEntries(a, [other], false)).toBe(0);
	});
});

describe('markReadThrough', () => {
	it('reads a chapter and everything before it, and returns only what changed', () => {
		const id = idOf('Dungeon Meshi');
		const s = series.seriesPage(id, false)!;
		const through = s.entries[5];
		const already = s.entries
			.slice(0, 6)
			.filter((e) => e.readAt !== null)
			.map((e) => e.id);
		const facts = series.markReadThrough(id, through.id);
		const changed = facts.places.map((p) => p.id);
		expect([...changed].sort()).toEqual(
			s.entries
				.slice(0, 6)
				.map((e) => e.id)
				.filter((x) => !already.includes(x))
				.sort()
		);
		const after = series.seriesPage(id, false)!.entries;
		expect(after.slice(0, 6).every((e) => e.readAt !== null)).toBe(true);
		expect(after[6].readAt).toBe(s.entries[6].readAt);
		// UNDO puts back exactly those.
		series.markEntries(id, changed, false);
		expect(series.seriesPage(id, false)!.entries.map((e) => e.readAt !== null)).toEqual(
			s.entries.map((e) => e.readAt !== null)
		);
	});

	it('cannot reach into another series', () => {
		const other = series.seriesPage(idOf('Tower of God'), false)!.entries[3].id;
		expect(series.markReadThrough(idOf('Dungeon Meshi'), other).places).toEqual([]);
	});
});

describe('MARK UNREAD starts a read chapter from the top (c652, c666)', () => {
	const place = (id: number) =>
		getDb()
			.prepare(
				`SELECT read_at AS readAt, last_position AS place, last_offset AS offset FROM entries WHERE id = ?`
			)
			.get(id) as { readAt: number | null; place: number | null; offset: number | null };
	const leftAt = (id: number, block: number, offset: number | null) =>
		getDb()
			.prepare(`UPDATE entries SET last_position = ?, last_offset = ? WHERE id = ?`)
			.run(block, offset, id);

	it('clears the place and the offset of every entry it changes, and only those', () => {
		const id = idOf('Isekai Yakkyoku');
		const entries = series.seriesPage(id, false)!.entries;
		const read = entries[0];
		const unread = entries.find((e) => e.id !== read.id && e.readAt === null)!;
		series.markEntries(id, [read.id], true);
		leftAt(read.id, 5, 12);
		leftAt(unread.id, 9, 3);
		expect(series.markEntries(id, [read.id, unread.id], false)).toBe(1);
		expect(place(read.id)).toEqual({ readAt: null, place: null, offset: null });
		// Never read: not one the mark changed, so its place is its own.
		expect(place(unread.id)).toEqual({ readAt: null, place: 9, offset: 3 });
	});

	it('leaves the place alone when it marks read', () => {
		const id = idOf('Isekai Yakkyoku');
		const e = series.seriesPage(id, false)!.entries[2];
		leftAt(e.id, 4, 8);
		series.markEntries(id, [e.id], true);
		expect(place(e.id)).toMatchObject({ place: 4, offset: 8 });
	});

	it('clears a copy a representative stands for, so a reconcile brings no place back', () => {
		const id = idOf('Natsu no Owari ni Kimi to');
		const e = series.seriesPage(id, false)!.entries[0];
		const db = getDb();
		const copy = Number(
			db
				.prepare(
					`INSERT INTO entries (series_id, position, label, title, added_at, file, bytes, page_count, available, source_url, shadowed, last_position, last_offset, read_at, last_opened_at)
					SELECT series_id, position, label, title, added_at, 'copy.cbz', bytes, page_count, available, 'copy:1', 1, 6, 2, read_at, 1 FROM entries WHERE id = ?`
				)
				.run(e.id).lastInsertRowid
		);
		series.markEntries(id, [e.id], true);
		leftAt(e.id, 5, 1);
		series.markEntries(id, [e.id], false);
		expect(place(e.id)).toMatchObject({ place: null, offset: null });
		expect(place(copy)).toMatchObject({ readAt: null, place: null, offset: null });
	});

	it('writes no reading_events inference: a mark_unread is logged once for what changed', () => {
		const id = idOf('Isekai Yakkyoku');
		const e = series.seriesPage(id, false)!.entries[3];
		series.markEntries(id, [e.id], true, 1000);
		series.markEntries(id, [e.id], false, 2000);
		expect(
			getDb()
				.prepare(`SELECT kind, at FROM reading_events WHERE entry_id = ? AND kind LIKE 'mark%'`)
				.all(e.id)
		).toEqual([
			{ kind: 'mark_read', at: 1000 },
			{ kind: 'mark_unread', at: 2000 }
		]);
	});
});

describe('UNDO of MARK READ THROUGH puts the place back (c666)', () => {
	const place = (id: number) =>
		getDb()
			.prepare(
				`SELECT read_at AS readAt, last_position AS place, last_offset AS offset, unread_at AS unreadAt FROM entries WHERE id = ?`
			)
			.get(id) as { readAt: number | null; place: number | null; offset: number | null };
	const leftAt = (id: number, block: number | null, offset: number | null) =>
		getDb()
			.prepare(`UPDATE entries SET last_position = ?, last_offset = ? WHERE id = ?`)
			.run(block, offset, id);
	const seriesOf = (title: string) => {
		const id = idOf(title);
		return { id, entries: series.seriesPage(id, false)!.entries };
	};

	it('answers each changed chapter with its place at the press', () => {
		const { id, entries } = seriesOf('Hikaru ga Shinda Natsu');
		const chapter = entries.find((e) => e.readAt === null)!;
		leftAt(chapter.id, 6, 40);
		const answer = series.markReadThrough(id, chapter.id, 777);
		expect(answer.at).toBe(777);
		expect(answer.places).toContainEqual({ id: chapter.id, place: 6, offset: 40 });
	});

	it('restores unread and leaves each chapter at the place it was left, offset included', () => {
		const { id, entries } = seriesOf('Lookism');
		const a = entries.find((e) => e.readAt === null)!;
		leftAt(a.id, 7, 33);
		const facts = series.markReadThrough(id, a.id, 5_000);
		expect(place(a.id).readAt).toBe(5_000);
		expect(series.undoMarkReadThrough(id, facts, 6_000)).toEqual({
			undone: facts.places.length,
			kept: 0
		});
		expect(place(a.id)).toMatchObject({ readAt: null, place: 7, offset: 33, unreadAt: 6_000 });
	});

	it('leaves a chapter read on or re-marked since the press, and counts it kept', () => {
		const { id, entries } = seriesOf('Isekai Yakkyoku');
		const [a, b] = entries.filter((e) => e.readAt === null);
		leftAt(a.id, 3, 0);
		leftAt(b.id, 4, 0);
		const facts = series.markReadThrough(id, b.id, 9_000);
		// Read on in another tab: the reader's own write.
		leftAt(a.id, 11, 0);
		const answer = series.undoMarkReadThrough(id, facts, 9_500);
		expect(answer.kept).toBeGreaterThanOrEqual(1);
		expect(place(a.id)).toMatchObject({ readAt: 9_000, place: 11 });
		expect(place(b.id)).toMatchObject({ readAt: null, place: 4 });
	});

	it('a second UNDO of the same press changes nothing', () => {
		const { id, entries } = seriesOf('Lookism');
		const a = entries.find((e) => e.readAt === null)!;
		const facts = series.markReadThrough(id, a.id, 12_000);
		series.undoMarkReadThrough(id, facts, 13_000);
		const again = series.undoMarkReadThrough(id, facts, 14_000);
		expect(again).toEqual({ undone: 0, kept: facts.places.length });
		expect(place(a.id)).toMatchObject({ readAt: null, unreadAt: 13_000 });
	});

	it('a press stamp handed for another press, or a place that was never there, changes nothing', () => {
		const { id, entries } = seriesOf('Isekai Yakkyoku');
		const a = entries.find((e) => e.readAt === null)!;
		leftAt(a.id, 2, 0);
		const facts = series.markReadThrough(id, a.id, 20_000);
		expect(series.undoMarkReadThrough(id, { ...facts, at: 19_999 }, 21_000).undone).toBe(0);
		expect(
			series.undoMarkReadThrough(
				id,
				{ ...facts, places: facts.places.map((p) => ({ ...p, place: 99 })) },
				21_000
			).undone
		).toBe(0);
		expect(place(a.id)).toMatchObject({ readAt: 20_000, place: 2 });
	});

	it('cannot reach into another series', () => {
		const { id, entries } = seriesOf('Hikaru ga Shinda Natsu');
		const a = entries.find((e) => e.readAt === null)!;
		const facts = series.markReadThrough(id, a.id, 30_000);
		const other = idOf('Sousou no Frieren');
		expect(series.undoMarkReadThrough(other, facts, 31_000).undone).toBe(0);
		expect(place(a.id).readAt).toBe(30_000);
	});
});

describe('direction', () => {
	it('stores the owner’s choice and clears back to the default', () => {
		const id = idOf('Sousou no Frieren');
		series.setDirection(id, 'ltr');
		expect(series.seriesPage(id, false)!.direction).toBe('ltr');
		series.setDirection(id, null);
		expect(series.seriesPage(id, false)!.direction).toBeNull();
	});
});

describe('tags', () => {
	it('adds a tag once, reusing an existing spelling, and removes it', () => {
		const id = idOf('Dungeon Meshi');
		series.addTag(id, { namespace: 'genre', value: 'isekai' });
		series.addTag(id, { namespace: 'genre', value: 'isekai' });
		const tags = series.seriesPage(id, false)!.tags.filter((t) => t.value === 'isekai');
		expect(tags).toEqual([{ namespace: 'genre', value: 'isekai' }]);
		const { n } = getDb()
			.prepare(`SELECT COUNT(*) AS n FROM tags WHERE value = 'isekai'`)
			.get() as { n: number };
		expect(n).toBe(1);
		expect(series.removeTag(id, { namespace: 'genre', value: 'isekai' })).toBe(1);
	});

	it('suggests existing tags by prefix, marking the ones already on this series', () => {
		const id = idOf('Drawing: Saikyou Mangaka wa Oekaki Skill de Isekai Musou Suru');
		const sugg = series.suggestTags(id, { namespace: 'genre', value: 'is' }, false);
		expect(sugg[0]).toMatchObject({ namespace: 'genre', value: 'isekai', onThis: true });
		expect(sugg[0].count).toBeGreaterThan(1);
	});

	it('does not count hidden series in suggestions while reveal is off', () => {
		const hidden = idOf('Kōhai no Himitsu Nikki');
		series.addTag(hidden, { namespace: 'circle', value: 'secret-circle' });
		const other = idOf('Dungeon Meshi');
		expect(series.suggestTags(other, { namespace: 'circle', value: 'secret' }, false)).toEqual([]);
		expect(
			series.suggestTags(other, { namespace: 'circle', value: 'secret' }, true)[0]?.count
		).toBe(1);
	});
});

describe('the reading log', () => {
	const events = (seriesId: number) =>
		getDb()
			.prepare(
				`SELECT kind, entry_id, page, duration_ms FROM reading_events WHERE series_id = ? ORDER BY id`
			)
			.all(seriesId) as {
			kind: string;
			entry_id: number;
			page: number | null;
			duration_ms: number;
		}[];

	// After the seed's own reading, which ends on 2026-09-22.
	const T = Date.UTC(2026, 8, 23);

	it('moves progress and appends the event together', () => {
		const id = idOf('Chainsaw Man');
		const entry = series.seriesPage(id, false)!.entries[198];
		const before = events(id).length; // the seed's own past reading
		series.recordReading({ seriesId: id, entryId: entry.id, kind: 'open', page: 0, now: T + 1000 });
		series.recordReading({
			seriesId: id,
			entryId: entry.id,
			kind: 'page',
			page: 5,
			durationMs: 42_000,
			now: T + 2000
		});
		series.recordReading({
			seriesId: id,
			entryId: entry.id,
			kind: 'finish',
			page: 23,
			durationMs: 90_000,
			now: T + 3000
		});
		const after = series.seriesPage(id, false)!.entries[198];
		expect(after).toMatchObject({ lastPosition: 23, lastOpenedAt: T + 3000, readAt: T + 3000 });
		expect(events(id).slice(before)).toEqual([
			{ kind: 'open', entry_id: entry.id, page: 0, duration_ms: 0 },
			{ kind: 'page', entry_id: entry.id, page: 5, duration_ms: 42_000 },
			{ kind: 'finish', entry_id: entry.id, page: 23, duration_ms: 90_000 }
		]);
	});

	it('logs an event read offline at its own time, without moving progress back', () => {
		const id = idOf('Chainsaw Man');
		const entry = series.seriesPage(id, false)!.entries[198];
		// Already opened later than the replayed event.
		series.recordReading({
			seriesId: id,
			entryId: entry.id,
			kind: 'page',
			page: 20,
			now: T + 9000
		});
		series.recordReading({ seriesId: id, entryId: entry.id, kind: 'page', page: 7, now: T + 8000 });
		const after = series.seriesPage(id, false)!.entries[198];
		expect(after).toMatchObject({ lastPosition: 20, lastOpenedAt: T + 9000 });
		expect(events(id).at(-1)).toMatchObject({ kind: 'page', page: 7 });
	});

	it('refuses an entry that belongs to another series, writing nothing', () => {
		const a = idOf('Chainsaw Man');
		const other = series.seriesPage(idOf('Dungeon Meshi'), false)!.entries[0].id;
		const before = events(a).length;
		expect(() => series.recordReading({ seriesId: a, entryId: other, kind: 'open' })).toThrow();
		expect(events(a)).toHaveLength(before);
	});

	it('logs manual marks as marks, one per entry that actually changed', () => {
		const id = idOf('Boku no Kokoro no Yabai Yatsu');
		const s = series.seriesPage(id, false)!;
		const read = s.entries[0].id;
		const unread = s.entries[159].id;
		const before = events(id).length;
		series.markEntries(id, [read, unread], true);
		expect(events(id).slice(before)).toEqual([
			{ kind: 'mark_read', entry_id: unread, page: null, duration_ms: 0 }
		]);
	});
});

describe('the source a series’ tags search (c313)', () => {
	/**
	 * `tagSourceOf` (series/[id]/tag-source.server.ts) decides each door by
	 * what can be asked -- does the key name a source, does BROWSE list it with
	 * this reveal, did it load, is the engine there -- never by kind. Every
	 * family's key, and each way to have no source, with the series really
	 * keyed so.
	 */
	it('names the source for each family BROWSE can open, and none for every other door', async () => {
		const { tagSourceOf } = await import('../src/routes/series/[id]/tag-source.server');
		const { forgetSourceUse } = await import('$lib/server/library-sources');
		const db = getDb();
		const root = (
			db.prepare(`SELECT id FROM roots WHERE hidden = 0 LIMIT 1`).get() as { id: number }
		).id;
		const ext = db.prepare(
			`INSERT INTO engine_extensions (pkg, name, kind, version_code, version_name, lib, handle, installed_at, updated_at, failed)
			VALUES (?, ?, ?, 1, '1', '1', ?, 0, 0, ?)`
		);
		const src = db.prepare(
			`INSERT INTO engine_sources (id, pkg, name, lang, base_url) VALUES (?, ?, ?, 'en', '')`
		);
		ext.run('t.manga', 'Comics', 'manga', 't.manga'.padEnd(64, '0'), '');
		src.run('7100', 't.manga', 'Comics Here');
		ext.run('t.anime', 'Shows', 'anime', 't.anime'.padEnd(64, '0'), '');
		src.run('7200', 't.anime', 'Shows Here');
		ext.run('t.broken', 'Broken', 'manga', 't.broken'.padEnd(64, '0'), 'protobuf');
		src.run('7300', 't.broken', 'Broken Here');
		ext.run('t.hidden', 'Hidden', 'manga', 't.hidden'.padEnd(64, '0'), '');
		src.run('7400', 't.hidden', 'Hidden Here');
		db.prepare(
			`INSERT INTO novel_plugins (id, name, site, lang, version, hash, installed_at, updated_at, failed)
			VALUES ('tagshelf', 'Tag Shelf', 'https://shelf.example/', 'en', '1.0.0', ?, 0, 0, '')`
		).run('f'.repeat(64));
		const add = (title: string, kind: string, key: string | null, hidden = 0) =>
			Number(
				db
					.prepare(
						`INSERT INTO series (root_id, title, kind, source, hue, added_at, indexed_at, origin_key, in_library, hidden)
						VALUES (?, ?, ?, 'mihon', 0, 0, 0, ?, 1, ?)`
					)
					.run(root, title, kind, key, hidden).lastInsertRowid
			);
		const ids = {
			manga: add('T Manga', 'manga', 'mihon:7100:/a'),
			gallery: add('T Gallery', 'doujin', 'mihon:7100:/g'),
			anime: add('T Anime', 'anime', 'aniyomi:7200:/s'),
			novel: add('T Novel', 'novel', 'lnreader:tagshelf:/n'),
			none: add('T None', 'manga', null),
			missing: add('T Missing', 'manga', 'mihon:7999:/x'),
			broken: add('T Broken', 'manga', 'mihon:7300:/b'),
			hentoid: add('T Hentoid', 'doujin', 'hentoid:nhentai:/g/9'),
			folder: add('T Folder', 'manga', 'mihon-dir:/somewhere'),
			epub: add('T Epub', 'novel', 'epub:/books/a.epub'),
			// Two of its three series hidden: the source is mostly hidden.
			hidden: add('T Hidden', 'manga', 'mihon:7400:/h1', 1),
			// Hidden itself, on a source that is not: the series is the door
			// (its `tag-search` route asks this and nothing else for access).
			hiddenSeries: add('T Hidden Series', 'manga', 'mihon:7100:/z', 1)
		};
		add('T Hidden 2', 'manga', 'mihon:7400:/h2', 1);
		add('T Hidden 3', 'manga', 'mihon:7400:/h3');
		forgetSourceUse();

		const before = { url: process.env.ENGINE_URL, token: process.env.ENGINE_TOKEN };
		process.env.ENGINE_URL = 'http://127.0.0.1:1';
		process.env.ENGINE_TOKEN = 'spec';
		try {
			const name = (id: number, reveal = false) => tagSourceOf(id, reveal)?.name ?? null;
			expect(name(ids.manga)).toBe('Comics Here');
			expect(name(ids.gallery)).toBe('Comics Here');
			expect(name(ids.anime)).toBe('Shows Here');
			expect(name(ids.novel)).toBe('Tag Shelf');
			expect(tagSourceOf(ids.novel, false)?.id).toBe('ln:tagshelf');
			for (const door of ['none', 'missing', 'broken', 'hentoid', 'folder', 'epub'] as const)
				expect(name(ids[door], true), door).toBeNull();
			// A mostly-hidden source is BROWSE's only with reveal on.
			expect(name(ids.hidden, false)).toBeNull();
			expect(name(ids.hidden, true)).toBe('Hidden Here');
			expect(name(ids.hiddenSeries, false)).toBeNull();
			expect(name(ids.hiddenSeries, true)).toBe('Comics Here');
			// A series that is not there names nothing.
			expect(name(999_999, true)).toBeNull();
			// No engine, no BROWSE: no sheet anywhere.
			delete process.env.ENGINE_URL;
			expect(name(ids.manga, true)).toBeNull();
			expect(name(ids.novel, true)).toBeNull();
		} finally {
			if (before.url === undefined) delete process.env.ENGINE_URL;
			else process.env.ENGINE_URL = before.url;
			if (before.token === undefined) delete process.env.ENGINE_TOKEN;
			else process.env.ENGINE_TOKEN = before.token;
		}
	});
});

describe('PUT ON A SHELF under ADDED TO THE LIBRARY, and its UNDO (c724)', () => {
	/**
	 * The series screen's band writes through the screen's own `?/shelf` (the
	 * SHELVES sheet's write) and takes back through `?/undoSourceAdd`, whose
	 * `undoAdd` deletes the series row: the shelf rows go by the schema's
	 * cascade (`collection_series.series_id … ON DELETE CASCADE`). Read here
	 * from the database, through the actions themselves, not from the schema.
	 */
	type Act = (e: unknown) => Promise<unknown>;
	const act = async (name: string, id: number, fields: Record<string, string>) => {
		const screen = await import('../src/routes/series/[id]/+page.server');
		const body = new FormData();
		for (const [k, v] of Object.entries(fields)) body.append(k, v);
		return (screen.actions[name] as unknown as Act)({
			request: new Request(`http://localhost/series/${id}?/${name}`, { method: 'POST', body }),
			params: { id: String(id) },
			url: new URL(`http://localhost/series/${id}?added=x`),
			cookies: { get: () => undefined }
		});
	};
	const shelvesOf = (id: number) =>
		getDb()
			.prepare(
				`SELECT collection_id FROM collection_series WHERE series_id = ? ORDER BY collection_id`
			)
			.pluck()
			.all(id) as number[];
	/** A series just added from a preview: in the library, nothing of it downloaded or read. */
	const justAdded = (title: string) => {
		const db = getDb();
		const root = (
			db.prepare(`SELECT id FROM roots WHERE hidden = 0 LIMIT 1`).get() as { id: number }
		).id;
		const id = Number(
			db
				.prepare(
					`INSERT INTO series (root_id, title, kind, source, hue, added_at, indexed_at, origin_key, in_library)
					VALUES (?, ?, 'manga', 'mihon', 0, 0, 0, NULL, 1)`
				)
				.run(root, title).lastInsertRowid
		);
		db.prepare(
			`INSERT INTO entries (series_id, position, label, added_at, source_url, available)
			VALUES (?, 1, 'Ch. 1', 0, ?, 0)`
		).run(id, `/nowhere/${id}`);
		return id;
	};

	it('puts it on two shelves, takes one off, and UNDO takes the series and both shelves back', async () => {
		const id = justAdded('Added From A Preview');
		const a = lib.createCollection('Band Shelf A');
		const b = lib.createCollection('Band Shelf B');
		expect(await act('shelf', id, { collection: String(a), on: '1' })).toEqual({ ok: true });
		expect(await act('shelf', id, { collection: String(b), on: '1' })).toEqual({ ok: true });
		// The same tap twice changes nothing more.
		expect(await act('shelf', id, { collection: String(b), on: '1' })).toEqual({ ok: true });
		expect(shelvesOf(id)).toEqual([a, b]);
		// A second tap takes it off.
		expect(await act('shelf', id, { collection: String(b), on: '0' })).toEqual({ ok: true });
		expect(shelvesOf(id)).toEqual([a]);
		expect(await act('shelf', id, { collection: String(b), on: '1' })).toEqual({ ok: true });
		// A shelf that is not there: the 400 the band draws as NOT SHELVED, nothing written.
		const gone = await act('shelf', id, { collection: '999999', on: '1' });
		expect(gone).toMatchObject({ status: 400, data: { message: 'no such shelf' } });
		expect(shelvesOf(id)).toEqual([a, b]);

		// UNDO: a redirect back to the preview, the series gone, its shelf rows with it.
		await expect(act('undoSourceAdd', id, { from: 'src~cHJldmlldw' })).rejects.toMatchObject({
			status: 303,
			location: '/downloads/source/src~cHJldmlldw'
		});
		expect(getDb().prepare(`SELECT 1 FROM series WHERE id = ?`).get(id)).toBeUndefined();
		expect(shelvesOf(id)).toEqual([]);
		// The shelves themselves stay: only the series left them.
		expect(lib.collectionExists(a) && lib.collectionExists(b)).toBe(true);
		// A chip tapped after it (a second tab still showing the band): the screen's 404, nothing written.
		await expect(act('shelf', id, { collection: String(a), on: '1' })).rejects.toMatchObject({
			status: 404
		});
		expect(shelvesOf(id)).toEqual([]);
	});

	it('an UNDO refused (something read now) keeps the series on its shelves', async () => {
		const id = justAdded('Added And Read');
		const a = lib.createCollection('Band Shelf Read');
		await act('shelf', id, { collection: String(a), on: '1' });
		getDb().prepare(`UPDATE entries SET read_at = 1 WHERE series_id = ?`).run(id);
		expect(await act('undoSourceAdd', id, { from: 'src~cHJldmlldw' })).toMatchObject({
			status: 409,
			data: { message: 'something of it is downloaded or read now' }
		});
		expect(shelvesOf(id)).toEqual([a]);
	});
});

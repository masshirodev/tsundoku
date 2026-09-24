import { describe, expect, it } from 'vitest';

// Before anything imports db.ts: getDb() reads this once and memoises.
process.env.DATABASE_PATH = ':memory:';

const { getDb } = await import('$lib/server/db');
const { seedSample } = await import('$lib/server/fixtures');
const lib = await import('$lib/server/library');
const books = await import('$lib/server/books');
const { bookEditions, setBookLanguage } = await import('$lib/server/editions');
const { setSetting } = await import('$lib/server/settings');
const { reconcileDuplicates } = await import('$lib/server/duplicates');
const { baseToEdition } = await import('$lib/library/editions');
const { recordReading } = await import('$lib/server/series');
const { ocrQueue } = await import('$lib/server/japanese/ocr');

const db = getDb();
seedSample(db, Date.UTC(2026, 8, 24));
const idOf = (t: string) =>
	(db.prepare(`SELECT id FROM series WHERE title = ?`).get(t) as { id: number } | undefined)?.id;
const entryOf = (seriesId: number) =>
	(
		db
			.prepare(`SELECT id FROM entries WHERE series_id = ? AND edition_of IS NULL`)
			.get(seriesId) as {
			id: number;
		}
	).id;
const tag = (seriesId: number, language: string) => {
	const t = db
		.prepare(
			`INSERT INTO tags (namespace, value) VALUES ('language', ?) ON CONFLICT DO UPDATE SET value = value RETURNING id`
		)
		.get(language) as { id: number };
	db.prepare(`INSERT OR IGNORE INTO series_tags (series_id, tag_id) VALUES (?, ?)`).run(
		seriesId,
		t.id
	);
};

const EN = 'Kōhai no Himitsu Nikki';
const JA = 'Onsen Ryokan no Yoru';
const en = idOf(EN)!;
const ja = idOf(JA)!;
tag(en, 'english');
tag(ja, 'japanese');
const enEntry = entryOf(en);
const jaEntry = entryOf(ja);
const pages = (
	db.prepare(`SELECT page_count FROM entries WHERE id = ?`).get(enEntry) as { page_count: number }
).page_count;
const identity = Array.from({ length: pages }, (_, i) => ({ a: i + 1, b: i + 1 }));
db.prepare(`UPDATE series SET rating = 4 WHERE id = ?`).run(ja);
db.prepare(`UPDATE entries SET last_position = 9 WHERE id = ?`).run(enEntry);

describe('folding two books into one', () => {
	it('one tile, the edition inside it, and nothing on disk moved', () => {
		const before = lib.listSeries({ reveal: true }).length;
		books.foldEditions(en, [ja], () => identity);
		expect(idOf(JA)).toBeUndefined();
		expect(lib.listSeries({ reveal: true }).length).toBe(before - 1);
		const e = db
			.prepare(`SELECT series_id, shadowed, edition_of, language FROM entries WHERE id = ?`)
			.get(jaEntry);
		expect(e).toEqual({ series_id: en, shadowed: 1, edition_of: enEntry, language: 'japanese' });
		// Still a single book, and the rating the other had came with it.
		expect(books.isSingleton(en)).toBe(true);
		expect(
			(db.prepare(`SELECT rating FROM series WHERE id = ?`).get(en) as { rating: number }).rating
		).toBe(4);
	});

	it('stays folded through the duplicates pass', () => {
		reconcileDuplicates();
		expect(
			(db.prepare(`SELECT shadowed FROM entries WHERE id = ?`).get(jaEntry) as { shadowed: number })
				.shadowed
		).toBe(1);
	});

	it('opens in the preferred language, or the book’s own', () => {
		expect(bookEditions(en)!.opens).toBe(enEntry);
		setSetting('edition_language', 'japanese');
		expect(bookEditions(en)!.opens).toBe(jaEntry);
		setBookLanguage(en, 'english');
		expect(bookEditions(en)!.opens).toBe(enEntry);
		setBookLanguage(en, null);
		setSetting('edition_language', 'english');
		const v = bookEditions(en)!;
		expect(v.editions.map((x) => x.code)).toEqual(['EN', 'JA']);
		expect(v.editions[1].title).toBe(JA);
	});

	it('refuses a second copy of a language, and a series of books', () => {
		const other = idOf('Rakugaki Collection Vol. 3')!;
		tag(other, 'japanese');
		expect(() => books.foldEditions(en, [other], () => identity)).toThrow(
			/japanese edition already/
		);
		const series = db
			.prepare(
				`SELECT s.id FROM series s WHERE (SELECT COUNT(*) FROM entries e WHERE e.series_id = s.id AND e.edition_of IS NULL) > 1 AND s.kind = 'doujin' LIMIT 1`
			)
			.get() as { id: number };
		expect(() => books.foldEditions(series.id, [other], () => identity)).toThrow(/single book/);
	});
});

describe('reading a folded book', () => {
	it('keeps one place: an edition’s page lands on the book’s matched page', () => {
		// The Japanese edition has a credits page first: its page n+1 is the book's page n.
		const shifted = [
			{ a: null, b: 1 },
			...Array.from({ length: pages - 1 }, (_, i) => ({ a: i + 1, b: i + 2 }))
		];
		db.prepare(`UPDATE entries SET edition_rows = ? WHERE id = ?`).run(
			JSON.stringify(shifted),
			jaEntry
		);
		recordReading({ seriesId: en, entryId: jaEntry, kind: 'page', page: 5, now: 2_000 });
		const base = db
			.prepare(`SELECT last_position, page_count FROM entries WHERE id = ?`)
			.get(enEntry) as { last_position: number; page_count: number };
		expect(base).toEqual({ last_position: 4, page_count: pages });
		// Logged on the book, so History and the counts see one book.
		expect(
			db.prepare(`SELECT entry_id FROM reading_events ORDER BY id DESC LIMIT 1`).get()
		).toEqual({ entry_id: enEntry });
		expect(bookEditions(en)!.lastRead).toBe('japanese');
		expect(bookEditions(en)!.at).toBe(4);
		// And the grid, opened in Japanese, shows the same page there.
		expect(baseToEdition(shifted, 4).page).toBe(5);
	});

	it('is one tile, titled and labelled by the language it opens in', () => {
		const card = () => lib.listSeries({ reveal: true }).find((c) => c.id === en)!;
		expect(card().languages).toEqual(['EN', 'JA']);
		expect(card().title).toBe(EN);
		setSetting('edition_language', 'japanese');
		expect(card().languages).toEqual(['JA', 'EN']);
		expect(card().title).toBe(JA);
		setSetting('edition_language', 'english');
	});

	it('is read by OCR in its Japanese edition only', () => {
		const queued = new Set(ocrQueue(1_000_000).map((j) => j.entryId));
		expect(queued.has(jaEntry)).toBe(true);
		expect(queued.has(enEntry)).toBe(false);
	});
});

describe('unfolding', () => {
	it('each edition a book again, with the book’s progress on its own pages', () => {
		const [single] = books.unfoldEditions(en, (rows, p) => baseToEdition(rows, p).page);
		expect(single).toBeGreaterThan(0);
		expect(
			db
				.prepare(`SELECT series_id, shadowed, edition_of, last_position FROM entries WHERE id = ?`)
				.get(jaEntry)
			// The book was at its page 4 (0-based), which the credits page makes the edition's 5.
		).toEqual({ series_id: single, shadowed: 0, edition_of: null, last_position: 5 });
		const langs = (id: number) =>
			(
				db
					.prepare(
						`SELECT t.value FROM series_tags st JOIN tags t ON t.id = st.tag_id WHERE st.series_id = ? AND t.namespace = 'language'`
					)
					.all(id) as { value: string }[]
			).map((r) => r.value);
		expect(langs(single)).toEqual(['japanese']);
		expect(langs(en)).toEqual(['english']);
		expect(bookEditions(en)).toBeNull();
		// The review won't offer them again.
		const key = enEntry < jaEntry ? `${enEntry},${jaEntry}` : `${jaEntry},${enEntry}`;
		expect(db.prepare(`SELECT decision FROM dupe_decisions WHERE pair = ?`).get(key)).toEqual({
			decision: 'apart'
		});
	});
});

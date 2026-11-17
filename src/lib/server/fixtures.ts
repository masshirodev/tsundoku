import type Database from 'better-sqlite3';
import { hueFor } from '../library/cover.ts';
import { SAMPLE_PREFIX } from './pages/sample.ts';
import { foldEditions, groupIntoSeries } from './books.ts';
import type { Kind, Rating } from '../library/types.ts';
import { kindFacts } from '../library/kinds.ts';

/**
 * A development library, built from invented sample rows: nothing here is
 * read from a real file, and `yarn run seed` refuses to write into a database
 * that already holds series.
 *
 * Specs use it too, so the numbers they assert are the numbers a person sees
 * in `yarn run dev`.
 */
type Row = {
	title: string;
	kind: Kind;
	rating: Rating;
	favourite: boolean;
	/** Entries total, and entries read. */
	entries: number;
	read: number;
	/** The newest entries that arrived after the last open: the tile's "+N". */
	fresh?: number;
	/** Minutes ago the last entry was opened; null when never opened. */
	openedAgo: number | null;
	shelves?: string[];
	tags?: string[];
	/** Series-screen metadata. Anything left out gets a plain default. */
	alts?: string[];
	source?: string;
	status?: string;
	/** 1-based page the open entry is on. Defaults to about a fifth of the way. */
	lastPage?: number;
};

/**
 * The description every sample series gets: plainly a fixture, and long
 * enough to exercise the ABOUT row's two-line clamp and MORE.
 */
const SAMPLE_ABOUT =
	'Development sample. The Mihon importer fills this from ComicInfo.xml (Summary), ' +
	'Hentoid has none, and an EPUB supplies its own dc:description. Real descriptions ' +
	'are often long and scraped with odd formatting, which is why this row clamps to two ' +
	'lines and opens on MORE.';

// An episode has no pages; its size is a 24-minute 1080p episode's (doc/ANIME.md).
const PAGES: Record<Kind, number> = {
	manga: 24,
	manhwa: 54,
	doujin: 30,
	novel: 100,
	anime: 0,
	movie: 0,
	show: 0
};
/**
 * Where a novel's in-progress entry was left: a block, which is what a novel's
 * `last_position` counts (a page is the image readers'). Every chapter of
 * the generated EPUB holds 15 blocks (`pages/sample-epub.ts`), so 7 is inside
 * each and is no chapter's first.
 */
const NOVEL_PLACE = 7;
const BYTES: Record<Kind, number> = {
	manga: 14_000_000,
	manhwa: 16_000_000,
	doujin: 84_000_000,
	novel: 0,
	anime: 410_000_000,
	movie: 1_190_000_000,
	show: 410_000_000
};

export const SAMPLE_ROWS: Row[] = [
	{
		title: 'Drawing: Saikyou Mangaka wa Oekaki Skill de Isekai Musou Suru',
		alts: ['ドローイング 最強漫画家はお絵かきスキルで異世界無双する'],
		source: 'weeb central',
		status: 'ongoing',
		kind: 'manga',
		rating: 8,
		favourite: true,
		entries: 58,
		read: 40,
		fresh: 3,
		openedAgo: 5,
		shelves: ['To finish', 'Isekai pile'],
		tags: ['genre:isekai', 'artist:Aoi Hanamura']
	},
	{
		title: "Omniscient Reader's Viewpoint",
		alts: ['전지적 독자 시점', 'Jeonjijeok Dokja Sijeom'],
		source: 'asura',
		status: 'completed',
		kind: 'manhwa',
		rating: 10,
		favourite: true,
		entries: 243,
		read: 213,
		openedAgo: 60,
		tags: ['genre:action']
	},
	{
		title: 'Kusuriya no Hitorigoto',
		alts: ['薬屋のひとりごと'],
		source: 'mihon',
		status: 'ongoing',
		kind: 'manga',
		rating: 0,
		favourite: false,
		entries: 71,
		read: 21,
		fresh: 2,
		openedAgo: 600,
		shelves: ['To finish'],
		tags: ['genre:mystery']
	},
	{
		title: 'Mushoku Tensei',
		alts: ['無職転生 ～異世界行ったら本気だす～'],
		source: 'epub',
		status: 'completed',
		kind: 'novel',
		rating: 8,
		favourite: false,
		entries: 26,
		read: 12,
		openedAgo: 1440,
		tags: ['genre:isekai']
	},
	{
		title: 'Sousou no Frieren',
		kind: 'manga',
		rating: 10,
		favourite: true,
		entries: 140,
		read: 139,
		fresh: 1,
		openedAgo: 3000
	},
	{
		title: 'Hoshi no Umi no Tabibito',
		alts: ['星の海の旅人'],
		source: 'hentoid',
		lastPage: 18,
		kind: 'doujin',
		rating: 0,
		favourite: false,
		entries: 1,
		read: 0,
		openedAgo: 200
	},
	{
		title: 'The Greatest Estate Developer',
		kind: 'manhwa',
		rating: 6,
		favourite: false,
		entries: 156,
		read: 144,
		fresh: 12,
		openedAgo: 5000,
		shelves: ['Isekai pile'],
		tags: ['genre:isekai']
	},
	{
		title: 'Yofukashi no Uta',
		kind: 'manga',
		rating: 0,
		favourite: false,
		entries: 200,
		read: 200,
		openedAgo: 8000
	},
	{
		title: 'Natsu no Owari ni Kimi to',
		kind: 'doujin',
		rating: 8,
		favourite: true,
		entries: 1,
		read: 1,
		openedAgo: 9000
	},
	{
		title: 'Return of the Mount Hua Sect',
		kind: 'manhwa',
		rating: 0,
		favourite: false,
		entries: 120,
		read: 86,
		fresh: 34,
		openedAgo: 12000,
		shelves: ['To finish']
	},
	{
		title: 'Honzuki no Gekokujou',
		kind: 'novel',
		rating: 10,
		favourite: true,
		entries: 33,
		read: 33,
		openedAgo: 15000,
		tags: ['genre:isekai']
	},
	{
		title: 'Dungeon Meshi',
		kind: 'manga',
		rating: 10,
		favourite: false,
		entries: 97,
		read: 97,
		openedAgo: 20000
	},
	{
		title: 'Ame no Hi no Toshokan',
		kind: 'doujin',
		rating: 4,
		favourite: false,
		entries: 1,
		read: 1,
		openedAgo: 21000
	},
	{
		title: 'Tower of God',
		alts: ['신의 탑', 'Sin-ui Tap'],
		source: 'mihon',
		status: 'ongoing',
		kind: 'manhwa',
		rating: 0,
		favourite: false,
		entries: 600,
		read: 593,
		fresh: 7,
		openedAgo: 30000,
		shelves: ['To finish']
	},
	{
		title: 'Hikaru ga Shinda Natsu',
		kind: 'manga',
		rating: 8,
		favourite: true,
		entries: 30,
		read: 28,
		fresh: 2,
		openedAgo: 40000
	},
	{
		title: 'Villainess Level 99',
		kind: 'novel',
		rating: 0,
		favourite: false,
		entries: 20,
		read: 1,
		openedAgo: 50000,
		tags: ['genre:isekai'],
		shelves: ['Isekai pile']
	},
	{
		title: 'Sekai no Owari no Kissaten',
		kind: 'doujin',
		rating: 6,
		favourite: false,
		entries: 1,
		read: 1,
		openedAgo: 60000
	},
	{
		title: 'Boku no Kokoro no Yabai Yatsu',
		kind: 'manga',
		rating: 8,
		favourite: false,
		entries: 160,
		read: 159,
		fresh: 1,
		openedAgo: 70000
	},
	{
		title: 'Lookism',
		kind: 'manhwa',
		rating: 2,
		favourite: false,
		entries: 500,
		read: 480,
		fresh: 20,
		openedAgo: 80000
	},
	{
		title: 'Tensei Shitara Ken Deshita',
		kind: 'novel',
		rating: 0,
		favourite: false,
		entries: 15,
		read: 0,
		openedAgo: null,
		tags: ['genre:isekai'],
		shelves: ['Isekai pile']
	},
	{
		title: 'Chainsaw Man',
		kind: 'manga',
		rating: 8,
		favourite: false,
		entries: 200,
		read: 198,
		fresh: 2,
		openedAgo: 90000
	},
	{
		title: 'Isekai Yakkyoku',
		kind: 'manga',
		rating: 0,
		favourite: false,
		entries: 50,
		read: 0,
		openedAgo: null,
		tags: ['genre:isekai']
	},
	{
		title: 'Isekai Ojisan',
		kind: 'manga',
		rating: 6,
		favourite: false,
		entries: 55,
		read: 55,
		openedAgo: 100000,
		tags: ['genre:isekai']
	}
];

/** Doujinshi in the hidden root. */
export const HIDDEN_ROWS: Row[] = [
	{
		title: 'Kōhai no Himitsu Nikki',
		kind: 'doujin',
		rating: 0,
		favourite: false,
		entries: 1,
		read: 0,
		openedAgo: null
	},
	{
		title: 'Onsen Ryokan no Yoru',
		kind: 'doujin',
		rating: 0,
		favourite: false,
		entries: 1,
		read: 0,
		openedAgo: null
	},
	{
		title: 'Rakugaki Collection Vol. 3',
		kind: 'doujin',
		rating: 0,
		favourite: false,
		entries: 1,
		read: 0,
		openedAgo: null
	},
	// Rakugaki's twin, downloaded again from another site: the duplicate the
	// review offers (doc/DUPLICATE-BOOKS.md). Rated and read, so KEEP carries over.
	{
		title: 'Rakugaki Collection Vol. 3 [Digital]',
		kind: 'doujin',
		rating: 8,
		favourite: true,
		entries: 1,
		read: 1,
		openedAgo: 3000
	}
];

/**
 * A circle's books, for the books screens (doc/BOOKS.md), in the hidden
 * Hentoid root like every Hentoid import. The first four are grouped into the
 * series "Kaori Mama" after seeding; the last two stay singletons that share
 * its title stem, so a suggestion appears on either.
 */
const BOOK_TAGS = ['circle:Hakka Kousha', 'artist:Aoi Rin', 'genre:comedy', 'language:japanese'];
export const BOOK_ROWS: Row[] = [
	{
		title: 'Kaori Mama on Bath Duty',
		kind: 'doujin',
		rating: 8,
		favourite: false,
		entries: 1,
		read: 1,
		openedAgo: 4000,
		tags: BOOK_TAGS
	},
	{
		title: 'Kaori Mama on Laundry Duty',
		kind: 'doujin',
		rating: 6,
		favourite: false,
		entries: 1,
		read: 1,
		openedAgo: 3000,
		tags: BOOK_TAGS
	},
	{
		title: 'Kaori Mama on Night Duty',
		kind: 'doujin',
		rating: 0,
		favourite: true,
		entries: 1,
		read: 0,
		openedAgo: 90,
		lastPage: 12,
		tags: BOOK_TAGS
	},
	{
		title: 'Kaori Mama on Festival Duty',
		kind: 'doujin',
		rating: 8,
		favourite: false,
		entries: 1,
		read: 0,
		openedAgo: null,
		tags: BOOK_TAGS
	},
	{
		title: 'Kaori Mama on Holiday Duty',
		kind: 'doujin',
		rating: 0,
		favourite: false,
		entries: 1,
		read: 0,
		openedAgo: null,
		tags: BOOK_TAGS
	},
	{
		title: 'Kaori Mama Illustrations 2024',
		kind: 'doujin',
		rating: 0,
		favourite: false,
		entries: 1,
		read: 0,
		openedAgo: null,
		tags: ['circle:Hakka Kousha', 'artist:Aoi Rin']
	}
];
export const BOOK_SERIES_TITLE = 'Kaori Mama';
/**
 * One book in two languages (doc/EDITIONS.md): downloaded twice, in English
 * and in Japanese, and folded after seeding into the English one. The
 * Japanese series is gone once folded; its entry is the book's edition.
 */
export const EDITION_ROWS: Row[] = [
	{
		title: 'Harbour Lights',
		kind: 'doujin',
		rating: 6,
		favourite: false,
		entries: 1,
		read: 0,
		openedAgo: 600,
		lastPage: 13,
		tags: ['circle:Minato Koubou', 'language:english']
	},
	{
		title: '港の灯',
		kind: 'doujin',
		rating: 0,
		favourite: false,
		entries: 1,
		read: 0,
		openedAgo: null,
		tags: ['circle:Minato Koubou', 'language:japanese']
	}
];
/** Series in the hidden root once seeding has grouped the books. */
export const HIDDEN_TITLES = [
	...HIDDEN_ROWS.map((r) => r.title),
	BOOK_SERIES_TITLE,
	BOOK_ROWS[4].title,
	BOOK_ROWS[5].title,
	EDITION_ROWS[0].title
];

export function seedSample(db: Database.Database, now = Date.now()): void {
	const minutes = 60_000;
	db.transaction(() => {
		const root = (name: string, path: string, hidden: boolean) =>
			Number(
				db
					.prepare(`INSERT INTO roots (name, path, hidden) VALUES (?, ?, ?)`)
					.run(name, path, hidden ? 1 : 0).lastInsertRowid
			);
		const main = root('Library', `${SAMPLE_PREFIX}library`, false);
		const hentoid = root('Hentoid', `${SAMPLE_PREFIX}hentoid`, true);

		const shelves = new Map<string, number>();
		const shelf = (name: string) => {
			if (!shelves.has(name)) {
				shelves.set(
					name,
					Number(
						db
							.prepare(`INSERT INTO collections (name, position) VALUES (?, ?)`)
							.run(name, shelves.size).lastInsertRowid
					)
				);
			}
			return shelves.get(name)!;
		};
		for (const name of ['To finish', 'Isekai pile', 'Raws (JP)']) shelf(name);

		const insertSeries = db.prepare(
			`INSERT INTO series (root_id, title, kind, rating, favourite, hue, added_at, indexed_at,
				alt_titles, source, status, description, path)
			VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
		);
		const insertEntry = db.prepare(
			`INSERT INTO entries (series_id, position, label, added_at, read_at, last_opened_at,
				last_position, page_count, file, bytes, locator)
			VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
		);
		const tag = db.prepare(
			`INSERT INTO tags (namespace, value) VALUES (?, ?) ON CONFLICT DO UPDATE SET value = value RETURNING id`
		);
		const tagSeries = db.prepare(
			`INSERT OR IGNORE INTO series_tags (series_id, tag_id) VALUES (?, ?)`
		);
		const inShelf = db.prepare(
			`INSERT INTO collection_series (collection_id, series_id) VALUES (?, ?)`
		);

		const add = (rootId: number, row: Row, i: number) => {
			const added = now - (i + 1) * 1000 * minutes;
			const id = Number(
				insertSeries.run(
					rootId,
					row.title,
					row.kind,
					row.rating,
					row.favourite ? 1 : 0,
					hueFor(row.title),
					added,
					added,
					JSON.stringify(row.alts ?? []),
					row.source ?? (rootId === hentoid ? 'hentoid' : 'mihon'),
					row.status ?? '',
					SAMPLE_ABOUT,
					// No files behind the samples: the reader draws their pages
					// (src/lib/server/pages/sample.ts), which the prefix says.
					`${SAMPLE_PREFIX}${rootId === hentoid ? 'hentoid' : 'library'}/${row.title}`
				).lastInsertRowid
			);
			const unit = row.kind === 'novel' ? 'Vol.' : row.kind === 'doujin' ? 'Book' : 'Ch.';
			for (let n = 1; n <= row.entries; n++) {
				const read = n <= row.read;
				// The entry after the last one read is the one in progress.
				const opened =
					row.openedAgo !== null &&
					(n === row.read + 1 || (row.read === row.entries && n === row.entries));
				// The last `fresh` entries arrived after the series was last opened.
				const arrived =
					row.fresh && row.openedAgo !== null && n > row.entries - row.fresh
						? now - Math.floor(row.openedAgo / 2) * minutes
						: added;
				const pages = PAGES[row.kind];
				const inProgress = opened && !read;
				// A novel is one EPUB for every chapter; a doujin is a folder of
				// loose images (Hentoid's layout); everything else is a CBZ each.
				const file =
					row.kind === 'novel' ? 'book.epub' : row.kind === 'doujin' ? '' : `Chapter ${n}.cbz`;
				insertEntry.run(
					id,
					n,
					row.entries === 1 && row.kind === 'doujin' ? 'Book' : `${unit} ${n}`,
					arrived,
					read ? added : null,
					opened ? now - row.openedAgo! * minutes : read ? added : null,
					inProgress
						? kindFacts(row.kind).medium === 'text'
							? NOVEL_PLACE
							: (row.lastPage ?? Math.max(1, Math.round(pages * 0.22))) - 1
						: null,
					pages,
					file,
					row.kind === 'novel' ? (n === 1 ? 3_100_000 : 0) : BYTES[row.kind],
					// The generated EPUB's chapter n (pages/sample-epub.ts).
					row.kind === 'novel' ? `OEBPS/ch${n}.xhtml` : ''
				);
			}
			for (const t of row.tags ?? []) {
				const [namespace, value] = t.includes(':') ? t.split(':', 2) : ['', t];
				const tagId = (tag.get(namespace, value) as { id: number }).id;
				tagSeries.run(id, tagId);
			}
			for (const s of row.shelves ?? []) inShelf.run(shelf(s), id);
		};
		SAMPLE_ROWS.forEach((row, i) => add(main, row, i));
		HIDDEN_ROWS.forEach((row, i) => add(hentoid, row, i + SAMPLE_ROWS.length));
		BOOK_ROWS.forEach((row, i) => add(hentoid, row, i + SAMPLE_ROWS.length + HIDDEN_ROWS.length));
		EDITION_ROWS.forEach((row, i) =>
			add(hentoid, row, i + SAMPLE_ROWS.length + HIDDEN_ROWS.length + BOOK_ROWS.length)
		);
	}).immediate();

	// Group the first four books, the way a reader would by hand.
	const idOf = (title: string) =>
		(db.prepare(`SELECT id FROM series WHERE title = ?`).get(title) as { id: number }).id;
	groupIntoSeries({
		seriesIds: BOOK_ROWS.slice(0, 4).map((r) => idOf(r.title)),
		name: BOOK_SERIES_TITLE,
		now
	});

	// Fold the Japanese download into the English one: every page matched.
	foldEditions(idOf(EDITION_ROWS[0].title), [idOf(EDITION_ROWS[1].title)], () =>
		Array.from({ length: PAGES.doujin }, (_, i) => ({ a: i + 1, b: i + 1 }))
	);

	// Duplicate books (doc/DUPLICATE-BOOKS.md): Rakugaki and its [Digital]
	// twin share a cover hash and every page's, and the pair is found already,
	// as `findDuplicates` would after an import.
	db.transaction(() => {
		const twins = ['Rakugaki Collection Vol. 3', 'Rakugaki Collection Vol. 3 [Digital]'].map(
			(t) =>
				db
					.prepare(
						`SELECT e.id, e.page_count FROM entries e JOIN series s ON s.id = e.series_id WHERE s.title = ?`
					)
					.get(t) as { id: number; page_count: number }
		);
		const pages = Array.from({ length: twins[0].page_count }, (_, i) =>
			(0x9e3779b97f4a7c15n * BigInt(i + 7)).toString(16).slice(-16).padStart(16, '1')
		);
		for (const t of twins) {
			db.prepare(`UPDATE entries SET cover_phash = ? WHERE id = ?`).run('5a3c96e1c3a50f78', t.id);
			const put = db.prepare(`INSERT INTO page_hashes (entry_id, page, hash) VALUES (?, ?, ?)`);
			pages.forEach((h, i) => put.run(t.id, i, h));
		}
		const [a, b] = twins.map((t) => t.id).sort((x, y) => x - y);
		db.prepare(`INSERT INTO dupe_pairs (a, b, bits, rows, found_at) VALUES (?, ?, 0, ?, ?)`).run(
			a,
			b,
			JSON.stringify({
				rows: pages.map((_, i) => ({ a: i + 1, b: i + 1 })),
				sizes: { [a]: [1280, 1810], [b]: [1600, 2263] }
			}),
			now
		);
	}).immediate();

	// Japanese (doc/JAPANESE.md): Drawing is read with OCR, and its chapters up
	// to the one in progress have text -- three bubbles on every page, clear of mid-height so a tap there still shows the controls.
	const drawing = idOf(SAMPLE_ROWS[0].title);
	const bubbles = JSON.stringify([
		{
			box: [0.68, 0.06, 0.2, 0.1],
			vertical: true,
			lines: ['この絵、', '本当に君が', '描いたのか？']
		},
		{ box: [0.12, 0.28, 0.2, 0.12], vertical: true, lines: ['等身大で'] },
		{ box: [0.58, 0.72, 0.22, 0.11], vertical: true, lines: ['明後日の十時に、', '東門へ。'] }
	]);
	db.transaction(() => {
		db.prepare(`UPDATE series SET ocr = 1 WHERE id = ?`).run(drawing);
		const read = db
			.prepare(
				`SELECT id, page_count FROM entries WHERE series_id = ? AND position <= ? ORDER BY position`
			)
			.all(drawing, SAMPLE_ROWS[0].read + 1) as { id: number; page_count: number }[];
		const put = db.prepare(`INSERT INTO page_text (entry_id, page, blocks) VALUES (?, ?, ?)`);
		for (const e of read) {
			for (let p = 0; p < e.page_count; p++) put.run(e.id, p, bubbles);
			db.prepare(`UPDATE entries SET ocr_at = ? WHERE id = ?`).run(now, e.id);
		}
	}).immediate();

	// Catalogue links (doc/LINKS.md), as a cover pass would leave them, with
	// made-up AniList and MAL ids: The Greatest Estate Developer linked from
	// Mihon's MAL tracker; Mount Hua with three candidates to review, one
	// under another English title; Yofukashi no Uta searched and nothing found.
	db.transaction(() => {
		const cand = (o: {
			id: number;
			mal: number | null;
			title: string;
			alts: string[];
			format?: string;
			chapters: number | null;
			volumes?: number | null;
			year: number;
			status: string;
		}) => ({
			anilistId: o.id,
			malId: o.mal,
			title: o.title,
			alts: o.alts,
			format: o.format ?? 'MANGA',
			country: 'KR',
			year: o.year,
			chapters: o.chapters,
			volumes: o.volumes ?? null,
			status: o.status,
			coverUrl: ''
		});
		db.prepare(
			`INSERT INTO series_links (series_id, anilist_id, mal_id, via, title, linked_at, resolved_at)
			VALUES (?, 900001, 800001, 'mihon', 'The Greatest Estate Developer', ?, ?)`
		).run(idOf('The Greatest Estate Developer'), now, now);
		const hua = idOf('Return of the Mount Hua Sect');
		const search = db.prepare(
			`INSERT INTO link_searches (series_id, query, searched_at, found) VALUES (?, ?, ?, ?)`
		);
		search.run(hua, 'Return of the Mount Hua Sect', now, 3);
		const offer = db.prepare(
			`INSERT INTO link_candidates (series_id, anilist_id, rank, data) VALUES (?, ?, ?, ?)`
		);
		[
			cand({
				id: 900101,
				mal: 800101,
				title: 'Return of the Blossoming Blade',
				alts: ['Hwasan Gwihwan', '화산귀환'],
				chapters: 150,
				year: 2021,
				status: 'RELEASING'
			}),
			cand({
				id: 900102,
				mal: 800102,
				title: 'Mount Hua Sect Chronicles',
				alts: ['Hwasanpa Yeondaegi'],
				chapters: 42,
				year: 2023,
				status: 'RELEASING'
			}),
			cand({
				id: 900103,
				mal: null,
				title: 'Return of the Mount Hua Sect',
				alts: [],
				format: 'NOVEL',
				chapters: null,
				volumes: 12,
				year: 2019,
				status: 'FINISHED'
			})
		].forEach((c, rank) => offer.run(hua, c.anilistId, rank, JSON.stringify(c)));
		search.run(idOf('Yofukashi no Uta'), 'Yofukashi no Uta', now, 0);
	}).immediate();

	// A few days of past reading, so history has something to show before the
	// reader exists to write it. Written straight to the log, as the reader's
	// recordReading() would have.
	db.transaction(() => {
		const log = db.prepare(
			`INSERT INTO reading_events (at, series_id, entry_id, kind, page, duration_ms) VALUES (?, ?, ?, ?, ?, ?)`
		);
		const day = 24 * 60 * minutes;
		const opened = db
			.prepare(
				`SELECT e.id, e.series_id, e.last_opened_at, e.last_position, e.position FROM entries e
				WHERE e.last_opened_at IS NOT NULL AND e.read_at IS NULL`
			)
			.all() as {
			id: number;
			series_id: number;
			last_opened_at: number;
			last_position: number | null;
			position: number;
		}[];
		for (const e of opened) {
			log.run(e.last_opened_at - 20 * minutes, e.series_id, e.id, 'open', 0, 0);
			log.run(e.last_opened_at, e.series_id, e.id, 'page', e.last_position ?? 0, 20 * minutes);
			// The chapters before it were finished over the previous days.
			const earlier = db
				.prepare(
					`SELECT id FROM entries WHERE series_id = ? AND position < ? ORDER BY position DESC LIMIT 3`
				)
				.all(e.series_id, e.position) as { id: number }[];
			earlier.forEach((prev, i) =>
				log.run(e.last_opened_at - (i + 1) * day, e.series_id, prev.id, 'finish', 0, 15 * minutes)
			);
		}
		// And one binge: the most recently read series had eight chapters in the
		// same sitting, so history has a range to show ("CH. 33 → 41").
		const latest = [...opened].sort((a, b) => b.last_opened_at - a.last_opened_at)[0];
		if (latest) {
			const binge = db
				.prepare(
					`SELECT id FROM entries WHERE series_id = ? AND position < ? ORDER BY position DESC LIMIT 8`
				)
				.all(latest.series_id, latest.position) as { id: number }[];
			binge.forEach((prev, i) =>
				log.run(
					latest.last_opened_at - (i + 2) * 12 * minutes,
					latest.series_id,
					prev.id,
					'finish',
					0,
					12 * minutes
				)
			);
		}
	}).immediate();
}

import type Database from 'better-sqlite3';
import { hueFor } from '../library/cover.ts';
import type { Kind, Rating } from '$lib/library/types';

/**
 * A development library, built from the sample rows the design handoff drew
 * with (doc/design/handoff/Index Library.dc.html). It exists because the
 * importers do not yet: nothing here is read from a real file, and `yarn run
 * seed` refuses to write into a database that already holds series.
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
};

export const SAMPLE_ROWS: Row[] = [
	{
		title: 'Drawing: Saikyou Mangaka wa Oekaki Skill de Isekai Musou Suru',
		kind: 'manga',
		rating: 4,
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
		kind: 'manhwa',
		rating: 5,
		favourite: true,
		entries: 243,
		read: 213,
		openedAgo: 60,
		tags: ['genre:action']
	},
	{
		title: 'Kusuriya no Hitorigoto',
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
		kind: 'novel',
		rating: 4,
		favourite: false,
		entries: 26,
		read: 12,
		openedAgo: 1440,
		tags: ['genre:isekai']
	},
	{
		title: 'Sousou no Frieren',
		kind: 'manga',
		rating: 5,
		favourite: true,
		entries: 140,
		read: 139,
		fresh: 1,
		openedAgo: 3000
	},
	{
		title: 'Hoshi no Umi no Tabibito',
		kind: 'doujin',
		rating: 0,
		favourite: false,
		entries: 1,
		read: 0,
		openedAgo: null
	},
	{
		title: 'The Greatest Estate Developer',
		kind: 'manhwa',
		rating: 3,
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
		rating: 4,
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
		rating: 5,
		favourite: true,
		entries: 33,
		read: 33,
		openedAgo: 15000,
		tags: ['genre:isekai']
	},
	{
		title: 'Dungeon Meshi',
		kind: 'manga',
		rating: 5,
		favourite: false,
		entries: 97,
		read: 97,
		openedAgo: 20000
	},
	{
		title: 'Ame no Hi no Toshokan',
		kind: 'doujin',
		rating: 2,
		favourite: false,
		entries: 1,
		read: 1,
		openedAgo: 21000
	},
	{
		title: 'Tower of God',
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
		rating: 4,
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
		rating: 3,
		favourite: false,
		entries: 1,
		read: 1,
		openedAgo: 60000
	},
	{
		title: 'Boku no Kokoro no Yabai Yatsu',
		kind: 'manga',
		rating: 4,
		favourite: false,
		entries: 160,
		read: 159,
		fresh: 1,
		openedAgo: 70000
	},
	{
		title: 'Lookism',
		kind: 'manhwa',
		rating: 1,
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
		rating: 4,
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
		rating: 3,
		favourite: false,
		entries: 55,
		read: 55,
		openedAgo: 100000,
		tags: ['genre:isekai']
	}
];

/** Doujinshi in the hidden root. Titles from the handoff's reveal state. */
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
	}
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
		const main = root('Library', '/mnt/hdd2/tsundoku/library', false);
		const hentoid = root('Hentoid', '/mnt/hdd2/tsundoku/library/hentoid', true);

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
			`INSERT INTO series (root_id, title, kind, rating, favourite, hue, added_at, indexed_at)
			VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
		);
		const insertEntry = db.prepare(
			`INSERT INTO entries (series_id, position, label, added_at, read_at, last_opened_at)
			VALUES (?, ?, ?, ?, ?, ?)`
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
					added
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
				insertEntry.run(
					id,
					n,
					row.entries === 1 && row.kind === 'doujin' ? 'Book' : `${unit} ${n}`,
					arrived,
					read ? added : null,
					opened ? now - row.openedAgo! * minutes : read ? added : null
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
	}).immediate();
}

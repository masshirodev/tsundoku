import { getDb } from './db.ts';
import { HIDDEN_SQL, libraryWhere } from './visibility.ts';
import { isPersonNamespace, type TagItem, type TagPage } from '../library/books.ts';
import type { Kind, Rating } from '../library/types.ts';
import { kindFacts } from '../library/kinds.ts';
import { langCode } from '../library/editions.ts';

/**
 * Person and tag pages (doc/BOOKS.md): every book or series carrying a tag,
 * as the library's grid with a richer header.
 *
 * A book inside a series of books appears on its own, matched by its own tags
 * and marked with its series. Everything else -- singles, manga, novels --
 * appears as its series. Every read takes `reveal`, and a page whose tag has
 * nothing visible answers null, which the route turns into the same 404 as a
 * tag that doesn't exist: a person made only of hidden books has no page
 * while reveal is off.
 */

export function parseTagKey(key: string): { namespace: string; value: string } {
	const at = key.indexOf(':');
	return at < 0
		? { namespace: '', value: key }
		: { namespace: key.slice(0, at), value: key.slice(at + 1) };
}

export function tagPage(key: string, reveal: boolean): TagPage | null {
	const db = getDb();
	const { namespace, value } = parseTagKey(key);
	const tag = db
		.prepare(`SELECT id FROM tags WHERE namespace = ? AND value = ?`)
		.get(namespace, value) as { id: number } | undefined;
	if (!tag) return null;
	const where = libraryWhere(reveal);

	// Books inside series of books, matched by their own tags.
	const books = db
		.prepare(
			`SELECT e.id AS entryId, s.id AS seriesId, e.title, s.title AS seriesTitle, e.rating, e.favourite,
				${HIDDEN_SQL} AS hidden, e.page_count AS pages, e.read_at, e.last_position, e.position,
				e.added_at AS addedAt, e.cover_page AS coverPage, e.available AS downloaded,
				(SELECT COUNT(*) FROM entries x WHERE x.shadowed = 0 AND x.matter = '' AND x.series_id = s.id) AS total
			FROM entry_tags et JOIN entries e ON e.id = et.entry_id
			JOIN series s ON s.id = e.series_id JOIN roots r ON r.id = s.root_id
			WHERE et.tag_id = ? AND ${where}
			AND (SELECT COUNT(*) FROM entries x WHERE x.shadowed = 0 AND x.matter = '' AND x.series_id = s.id) > 1`
		)
		.all(tag.id) as {
		entryId: number;
		seriesId: number;
		title: string;
		seriesTitle: string;
		rating: number;
		favourite: number;
		hidden: number;
		pages: number;
		read_at: number | null;
		last_position: number | null;
		position: number;
		addedAt: number;
		coverPage: number | null;
		downloaded: number;
		total: number;
	}[];

	// Everything else, matched by its series' tags: singles, manga, novels.
	const series = db
		.prepare(
			`SELECT s.id AS seriesId, s.title, s.kind, COALESCE(s.rating, 0) AS rating, s.favourite,
				${HIDDEN_SQL} AS hidden, s.added_at AS addedAt,
				s.cover_at AS cover,
				EXISTS (SELECT 1 FROM entries e WHERE e.series_id = s.id AND e.available = 1) AS downloaded,
				(SELECT COUNT(*) FROM entries e WHERE e.shadowed = 0 AND e.matter = '' AND e.series_id = s.id) AS entries,
				(SELECT COUNT(*) FROM entries e WHERE e.shadowed = 0 AND e.matter = '' AND e.series_id = s.id AND e.read_at IS NOT NULL) AS readCount,
				(SELECT COALESCE(SUM(page_count), 0) FROM entries e WHERE e.shadowed = 0 AND e.matter = '' AND e.series_id = s.id) AS pages,
				(SELECT e.last_position FROM entries e WHERE e.shadowed = 0 AND e.matter = '' AND e.series_id = s.id AND e.read_at IS NULL
					AND e.last_opened_at IS NOT NULL ORDER BY e.last_opened_at DESC LIMIT 1) AS lastPosition,
				(SELECT COUNT(*) FROM entries e WHERE e.edition_of IS NULL AND e.series_id = s.id) AS whole
			FROM series_tags st JOIN series s ON s.id = st.series_id JOIN roots r ON r.id = s.root_id
			WHERE st.tag_id = ? AND ${where}
			AND NOT (s.kind = 'doujin' AND (SELECT COUNT(*) FROM entries e WHERE e.shadowed = 0 AND e.matter = '' AND e.series_id = s.id) > 1)`
		)
		.all(tag.id) as {
		seriesId: number;
		title: string;
		kind: Kind;
		rating: number;
		favourite: number;
		hidden: number;
		addedAt: number;
		entries: number;
		/** Entries with no edition either: a set-aside duplicate or an extra counts here. */
		whole: number;
		readCount: number;
		pages: number;
		lastPosition: number | null;
		cover: number | null;
		downloaded: number;
	}[];

	// Each item's languages, as codes, for the FILTER panel's LANGUAGE: a
	// book's own tags and edition, a series' tags and editions.
	const NOT_LANGUAGES = `('translated', 'rewrite', 'speechless', 'text cleaned')`;
	const codes = (rows: { id: number; name: string }[]) => {
		const out = new Map<number, string[]>();
		for (const r of rows) {
			const c = langCode(r.name);
			const list = out.get(r.id) ?? [];
			if (!list.includes(c)) list.push(c);
			out.set(r.id, list);
		}
		return out;
	};
	const bookLangs = codes(
		db
			.prepare(
				`SELECT et.entry_id AS id, t.value AS name FROM entry_tags et JOIN tags t ON t.id = et.tag_id
				WHERE t.namespace = 'language' AND t.value NOT IN ${NOT_LANGUAGES}
					AND et.entry_id IN (SELECT value FROM json_each(?))
				UNION SELECT id, language FROM entries
				WHERE language IS NOT NULL AND id IN (SELECT value FROM json_each(?))`
			)
			.all(
				JSON.stringify(books.map((b) => b.entryId)),
				JSON.stringify(books.map((b) => b.entryId))
			) as {
			id: number;
			name: string;
		}[]
	);
	const seriesIds = JSON.stringify(series.map((s) => s.seriesId));
	const seriesLangs = codes(
		db
			.prepare(
				`SELECT st.series_id AS id, t.value AS name FROM series_tags st JOIN tags t ON t.id = st.tag_id
				WHERE t.namespace = 'language' AND t.value NOT IN ${NOT_LANGUAGES}
					AND st.series_id IN (SELECT value FROM json_each(?))
				UNION SELECT series_id, language FROM entries
				WHERE language IS NOT NULL AND series_id IN (SELECT value FROM json_each(?))`
			)
			.all(seriesIds, seriesIds) as { id: number; name: string }[]
	);

	const items: TagItem[] = [
		...books.map((b): TagItem => ({
			key: `b${b.entryId}`,
			seriesId: b.seriesId,
			cover: null,
			coverPage: b.coverPage,
			entryId: b.entryId,
			title: b.title || b.seriesTitle,
			kind: 'doujin',
			rating: b.rating as Rating,
			favourite: b.favourite === 1,
			hidden: b.hidden === 1,
			pages: b.pages,
			read: b.read_at !== null,
			progress:
				b.read_at === null && b.last_position !== null && b.pages > 0
					? (b.last_position + 1) / b.pages
					: null,
			seriesTitle: b.seriesTitle,
			position: b.position,
			total: b.total,
			groupable: false,
			addedAt: b.addedAt,
			entries: 1,
			languages: bookLangs.get(b.entryId) ?? [],
			downloaded: b.downloaded === 1
		})),
		...series.map((s): TagItem => ({
			key: `s${s.seriesId}`,
			seriesId: s.seriesId,
			cover: s.cover,
			coverPage: null,
			entryId: null,
			title: s.title,
			kind: s.kind,
			rating: s.rating as Rating,
			favourite: s.favourite === 1,
			hidden: s.hidden === 1,
			pages: s.pages,
			read: s.entries > 0 && s.readCount === s.entries,
			progress:
				kindFacts(s.kind).grouping === 'books' && s.lastPosition !== null && s.pages > 0
					? (s.lastPosition + 1) / s.pages
					: null,
			seriesTitle: null,
			position: null,
			total: null,
			// GROUP takes one book with nothing beside it (`groupIntoSeries`), so a
			// book with an extra or a set-aside duplicate is no singleton here.
			groupable: kindFacts(s.kind).grouping === 'books' && s.entries === 1 && s.whole === 1,
			addedAt: s.addedAt,
			entries: s.entries,
			languages: seriesLangs.get(s.seriesId) ?? [],
			downloaded: s.downloaded === 1
		}))
	].sort((a, b) => b.addedAt - a.addedAt || a.key.localeCompare(b.key));

	if (items.length === 0) return null;

	const bookSeries = new Map<
		number,
		{
			id: number;
			title: string;
			books: number;
			read: number;
			favourite: boolean;
			cover: number | null;
		}
	>();
	for (const b of books) {
		if (!bookSeries.has(b.seriesId)) {
			const s = db
				.prepare(
					`SELECT s.id, s.title, s.favourite, s.cover_at AS cover,
						(SELECT COUNT(*) FROM entries e WHERE e.shadowed = 0 AND e.matter = '' AND e.series_id = s.id) AS books,
						(SELECT COUNT(*) FROM entries e WHERE e.shadowed = 0 AND e.matter = '' AND e.series_id = s.id AND e.read_at IS NOT NULL) AS read
					FROM series s WHERE s.id = ?`
				)
				.get(b.seriesId) as {
				id: number;
				title: string;
				favourite: number;
				books: number;
				read: number;
				cover: number | null;
			};
			bookSeries.set(b.seriesId, { ...s, favourite: s.favourite === 1 });
		}
	}

	// A circle's artists: the artist tags on the same visible books, counted
	// over exactly the items this page shows, so reveal applies to them too.
	const members: { value: string; count: number }[] = [];
	if (namespace === 'circle') {
		const ofEntry = db.prepare(
			`SELECT t.value FROM entry_tags et JOIN tags t ON t.id = et.tag_id
			WHERE et.entry_id = ? AND t.namespace = 'artist'`
		);
		const ofSeries = db.prepare(
			`SELECT t.value FROM series_tags st JOIN tags t ON t.id = st.tag_id
			WHERE st.series_id = ? AND t.namespace = 'artist'`
		);
		const counts = new Map<string, number>();
		for (const item of items) {
			const rows = (
				item.entryId !== null ? ofEntry.all(item.entryId) : ofSeries.all(item.seriesId)
			) as {
				value: string;
			}[];
			for (const { value: artist } of rows) counts.set(artist, (counts.get(artist) ?? 0) + 1);
		}
		members.push(
			...[...counts.entries()]
				.map(([artist, count]) => ({ value: artist, count }))
				.sort((a, b) => b.count - a.count || a.value.localeCompare(b.value))
				.slice(0, 12)
		);
	}

	const favourite = isPersonNamespace(namespace)
		? db
				.prepare(`SELECT 1 FROM person_favourites WHERE namespace = ? AND value = ?`)
				.get(namespace, value) !== undefined
		: false;

	const single = items.filter((i) => i.groupable).length;
	return {
		namespace,
		value,
		person: isPersonNamespace(namespace),
		favourite,
		items,
		series: [...bookSeries.values()],
		members,
		counts: {
			books:
				books.length +
				items.filter((i) => kindFacts(i.kind).grouping === 'books' && i.entryId === null).length,
			series:
				bookSeries.size +
				items.filter((i) => i.entryId === null && kindFacts(i.kind).grouping !== 'books').length,
			single,
			read: items.filter((i) => i.read).length,
			favourite: items.filter((i) => i.favourite).length
		}
	};
}

export function setPersonFavourite(
	namespace: string,
	value: string,
	on: boolean,
	now = Date.now()
): void {
	if (!isPersonNamespace(namespace))
		throw new Error('only artists, circles and authors can be favourited');
	const db = getDb();
	if (on) {
		db.prepare(
			`INSERT OR IGNORE INTO person_favourites (namespace, value, added_at) VALUES (?, ?, ?)`
		).run(namespace, value, now);
	} else {
		db.prepare(`DELETE FROM person_favourites WHERE namespace = ? AND value = ?`).run(
			namespace,
			value
		);
	}
}

/**
 * Favourite people for the PEOPLE shelf, with how many visible books each
 * has. One with none visible is left out while reveal is off: a favourite
 * circle of hidden books must not be named on a reveal-off screen.
 */
export function favouritePeople(
	reveal: boolean
): { namespace: string; value: string; count: number }[] {
	const db = getDb();
	const people = db
		.prepare(`SELECT namespace, value FROM person_favourites ORDER BY added_at DESC`)
		.all() as { namespace: string; value: string }[];
	return people
		.map((p) => ({ ...p, count: tagPage(`${p.namespace}:${p.value}`, reveal)?.items.length ?? 0 }))
		.filter((p) => p.count > 0);
}

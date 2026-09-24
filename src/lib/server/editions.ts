import { getDb } from './db.ts';
import { getSetting } from './settings.ts';
import { editionsOf } from './books.ts';
import { langCode, onlyIn, openingEdition, type Edition } from '../library/editions.ts';
import type { PageRow } from '../library/dupes.ts';

/**
 * A folded book as the screens see it (doc/EDITIONS.md): its editions, the
 * one it opens in, and what differs between them. Null for a book that isn't
 * folded.
 */
export type EditionView = {
	entryId: number;
	language: string;
	code: string;
	title: string;
	site: string;
	pages: number;
	/** Pixel size of a typical page, "1280 × 1808"; '' unknown. */
	size: string;
	base: boolean;
	rows: PageRow[];
	/** Pages only this edition has, 1-based. */
	only: number[];
	/** Where its pages are on disk. */
	file: string;
};
export type BookEditions = {
	editions: EditionView[];
	/** The entry READ opens. */
	opens: number;
	/** The book's own language choice (its LANGUAGE row), or null for the preferred. */
	own: string | null;
	preferred: string;
	lastRead: string | null;
	/** When it was folded, from the duplicates review; null if unknown. */
	folded: number | null;
	/** The base's page, 0-based, and whether it's read: where every edition resumes. */
	at: number | null;
	read: boolean;
};

const siteOf = (entryId: number): string =>
	(
		getDb()
			.prepare(
				`SELECT t.value FROM entry_tags et JOIN tags t ON t.id = et.tag_id
				WHERE et.entry_id = ? AND t.namespace = 'source' LIMIT 1`
			)
			.get(entryId) as { value: string } | undefined
	)?.value ?? '';

export function bookEditions(seriesId: number): BookEditions | null {
	const rows = editionsOf(seriesId);
	if (rows.length < 2) return null;
	const s = getDb()
		.prepare(`SELECT edition_lang, edition_read FROM series WHERE id = ?`)
		.get(seriesId) as { edition_lang: string | null; edition_read: string | null };
	const baseSite =
		siteOf(rows[0].id) ||
		((
			getDb()
				.prepare(
					`SELECT t.value FROM series_tags st JOIN tags t ON t.id = st.tag_id
					WHERE st.series_id = ? AND t.namespace = 'source' LIMIT 1`
				)
				.get(seriesId) as { value: string } | undefined
		)?.value ??
			'');
	const sizes = new Map(
		(
			getDb()
				.prepare(
					`SELECT a, b, rows FROM dupe_pairs WHERE a IN (${rows.map(() => '?').join(',')})
					OR b IN (${rows.map(() => '?').join(',')})`
				)
				.all(...rows.map((r) => r.id), ...rows.map((r) => r.id)) as { rows: string }[]
		).flatMap((r) =>
			Object.entries((JSON.parse(r.rows) as { sizes: Record<string, [number, number]> }).sizes)
		)
	);
	const seriesTitle = (
		getDb().prepare(`SELECT title FROM series WHERE id = ?`).get(seriesId) as { title: string }
	).title;
	const fileOf = getDb().prepare(
		`SELECT s.path, e.file FROM entries e JOIN series s ON s.id = e.series_id WHERE e.id = ?`
	);
	const editions: EditionView[] = rows.map((r, i) => {
		const f = fileOf.get(r.id) as { path: string | null; file: string | null };
		const pr = JSON.parse(r.edition_rows ?? '[]') as PageRow[];
		const base = i === 0;
		const sz = sizes.get(String(r.id));
		return {
			entryId: r.id,
			language: r.language ?? '',
			code: langCode(r.language ?? '??'),
			// The book's own entry is often untitled: it goes by the book's name.
			title: r.title || (base ? seriesTitle : ''),
			site: base ? baseSite : siteOf(r.id),
			pages: r.page_count,
			size: sz && sz[0] ? `${sz[0]} × ${sz[1]}` : '',
			base,
			rows: pr,
			only: base
				? [
						...new Set(
							rows.slice(1).flatMap((x) => onlyIn(JSON.parse(x.edition_rows ?? '[]'), 'a'))
						)
					]
						.filter((p) =>
							rows
								.slice(1)
								.every((x) =>
									onlyIn(JSON.parse(x.edition_rows ?? '[]') as PageRow[], 'a').includes(p)
								)
						)
						.sort((a, b) => a - b)
				: onlyIn(pr, 'b'),
			file: [f.path, f.file].filter(Boolean).join('/')
		};
	});
	const preferred = getSetting('edition_language');
	const pick = openingEdition(
		editions.map((e): Edition => ({
			entryId: e.entryId,
			language: e.language,
			rows: e.rows,
			base: e.base
		})),
		{ own: s.edition_lang, preferred, lastRead: s.edition_read }
	);
	const ids = rows.map((r) => r.id);
	const keys = ids.flatMap((a) => ids.filter((b) => b > a).map((b) => `${a},${b}`));
	const folded = (
		getDb()
			.prepare(
				`SELECT MAX(at) AS at FROM dupe_decisions WHERE decision = 'fold'
				AND pair IN (${keys.map(() => '?').join(',')})`
			)
			.get(...keys) as { at: number | null }
	).at;
	return {
		editions,
		opens: pick.entryId,
		own: s.edition_lang,
		preferred,
		lastRead: s.edition_read,
		folded,
		at: rows[0].read_at === null ? rows[0].last_position : null,
		read: rows[0].read_at !== null
	};
}

/** LANGUAGE on the book's screen: this book opens in `language`; null goes back to the preferred. */
export function setBookLanguage(seriesId: number, language: string | null): void {
	getDb().prepare(`UPDATE series SET edition_lang = ? WHERE id = ?`).run(language, seriesId);
}

/** The reader read an edition: remembered, for a preferred language the book hasn't got. */
export function markEditionRead(seriesId: number, language: string): void {
	getDb().prepare(`UPDATE series SET edition_read = ? WHERE id = ?`).run(language, seriesId);
}

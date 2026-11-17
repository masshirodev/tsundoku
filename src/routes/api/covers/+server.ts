import { error, json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { getDb } from '$lib/server/db';
import { isRevealed } from '$lib/server/prefs';
import { VISIBLE_SQL } from '$lib/server/visibility';
import { refreshSeriesCover } from '$lib/server/covers';

type Chosen = { entry: number; page: number } | null;

/**
 * The page menu's choices (doc/COVERS.md, "Chosen"). The body names
 * what to set, each part optional:
 *
 * - `book`: the pressed book's cover page (0-based), or null for automatic;
 * - `series`: the series' cover, a page of one of its entries, or null.
 *
 * It answers with what was there before, in the same shape, so UNDO is the
 * same call with the answer. The series' thumbnail is remade before it
 * answers, so the tile shows the new cover next time it's drawn. Hidden
 * means hidden: a 404 while reveal is off.
 */
export const POST: RequestHandler = async ({ request, cookies }) => {
	const b = (await request.json().catch(() => null)) as {
		entryId?: number;
		book?: number | null;
		series?: Chosen;
	} | null;
	const entryId = Number(b?.entryId);
	if (!b || !Number.isInteger(entryId)) error(400, 'which entry');
	const db = getDb();
	const e = db
		.prepare(
			`SELECT e.id, e.series_id, e.page_count, e.cover_page, s.cover_entry, s.cover_page AS series_page
			FROM entries e JOIN series s ON s.id = e.series_id JOIN roots r ON r.id = s.root_id
			WHERE e.id = ? AND (? OR ${VISIBLE_SQL})`
		)
		.get(entryId, isRevealed(cookies) ? 1 : 0) as
		| {
				id: number;
				series_id: number;
				page_count: number;
				cover_page: number | null;
				cover_entry: number | null;
				series_page: number | null;
		  }
		| undefined;
	if (!e) error(404, 'not found');
	const valid = (p: unknown, count: number) =>
		p === null || (Number.isInteger(p) && (p as number) >= 0 && (p as number) < count);

	const was: { book?: number | null; series?: Chosen } = {};
	db.transaction(() => {
		if ('book' in b) {
			if (!valid(b.book, e.page_count)) error(400, 'no such page');
			was.book = e.cover_page;
			db.prepare(`UPDATE entries SET cover_page = ? WHERE id = ?`).run(b.book ?? null, e.id);
		}
		if ('series' in b) {
			const s = b.series ?? null;
			if (s) {
				// A page of an entry of this series, and a page it has.
				const of = db
					.prepare(`SELECT page_count FROM entries WHERE id = ? AND series_id = ?`)
					.get(s.entry, e.series_id) as { page_count: number } | undefined;
				if (!of || !valid(s.page, of.page_count)) error(400, 'no such page');
			}
			was.series =
				e.cover_entry !== null && e.series_page !== null
					? { entry: e.cover_entry, page: e.series_page }
					: null;
			db.prepare(`UPDATE series SET cover_entry = ?, cover_page = ? WHERE id = ?`).run(
				s?.entry ?? null,
				s?.page ?? null,
				e.series_id
			);
		}
	})();
	// The series' tile: its chosen page, or -- a book's cover changing -- its
	// first book's. Made now, from this computer's files only.
	await refreshSeriesCover(e.series_id);
	const at = (
		db.prepare(`SELECT cover_at FROM series WHERE id = ?`).get(e.series_id) as {
			cover_at: number | null;
		}
	).cover_at;
	return json({ was, coverAt: at });
};

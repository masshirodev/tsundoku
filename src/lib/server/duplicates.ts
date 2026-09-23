import type Database from 'better-sqlite3';
import { getDb } from './db.ts';
import {
	automaticScanlator,
	mergedState,
	representative,
	type Copy
} from '../library/duplicates.ts';

/**
 * Settle which copy of each duplicated chapter represents it, for the given
 * series or for all of them (doc/DUPLICATES.md). Runs after every import and
 * whenever a series' preferred scanlator changes. It only ever sets
 * `shadowed` and carries read state forward onto the representative, so it
 * can run as often as you like.
 *
 * Books aren't chapters: a series of doujin books is never collapsed, even
 * if two books ended up at the same position.
 */
export function reconcileDuplicates(seriesIds?: number[], db: Database.Database = getDb()): number {
	const only =
		seriesIds === undefined
			? ''
			: `AND series_id IN (${seriesIds.map(Number).join(',') || 'NULL'})`;
	return db
		.transaction(() => {
			const groups = db
				.prepare(
					`SELECT e.series_id, e.position FROM entries e JOIN series s ON s.id = e.series_id
					WHERE s.kind != 'doujin' ${only.replace('series_id', 'e.series_id')}
					GROUP BY e.series_id, e.position HAVING COUNT(*) > 1`
				)
				.all() as { series_id: number; position: number }[];

			// Whatever isn't in a group any more (a copy removed, a preference
			// changed) comes back into view first.
			db.prepare(`UPDATE entries SET shadowed = 0 WHERE shadowed = 1 ${only}`).run();

			const copiesOf = db.prepare(
				`SELECT id, available, scanlator, read_at, last_opened_at, last_position
				FROM entries WHERE series_id = ? AND position = ?`
			);
			const seriesCopies = db.prepare(
				`SELECT scanlator, available FROM entries WHERE series_id = ?`
			);
			const chosen = db.prepare(`SELECT scanlator FROM series WHERE id = ?`);
			const shadow = db.prepare(`UPDATE entries SET shadowed = 1 WHERE id = ?`);
			const carry = db.prepare(
				`UPDATE entries SET read_at = ?, last_opened_at = ?, last_position = ? WHERE id = ?`
			);
			const preferred = new Map<number, string>();
			let shadowed = 0;
			for (const g of groups) {
				if (!preferred.has(g.series_id)) {
					const own = (chosen.get(g.series_id) as { scanlator: string | null }).scanlator;
					preferred.set(
						g.series_id,
						own ??
							automaticScanlator(
								(seriesCopies.all(g.series_id) as { scanlator: string; available: number }[]).map(
									(c) => ({ scanlator: c.scanlator, available: c.available === 1 })
								)
							)
					);
				}
				const copies = (
					copiesOf.all(g.series_id, g.position) as {
						id: number;
						available: number;
						scanlator: string;
						read_at: number | null;
						last_opened_at: number | null;
						last_position: number | null;
					}[]
				).map((r): Copy => ({
					id: r.id,
					available: r.available === 1,
					scanlator: r.scanlator,
					readAt: r.read_at,
					lastOpenedAt: r.last_opened_at,
					lastPosition: r.last_position
				}));
				const rep = representative(copies, preferred.get(g.series_id)!);
				const m = mergedState(copies, rep);
				carry.run(m.readAt, m.lastOpenedAt, m.lastPosition, rep.id);
				for (const c of copies)
					if (c.id !== rep.id) {
						shadow.run(c.id);
						shadowed += 1;
					}
			}
			return shadowed;
		})
		.immediate();
}

/** The scanlators a series has chapters from, for its SCANLATOR row. */
export function scanlatorsOf(seriesId: number): { name: string; count: number }[] {
	return getDb()
		.prepare(
			`SELECT scanlator AS name, COUNT(*) AS count FROM entries
			WHERE series_id = ? AND scanlator != ''
			GROUP BY scanlator ORDER BY count DESC, scanlator`
		)
		.all(seriesId) as { name: string; count: number }[];
}

/** NULL goes back to the automatic choice. */
export function setScanlator(seriesId: number, scanlator: string | null): void {
	getDb().prepare(`UPDATE series SET scanlator = ? WHERE id = ?`).run(scanlator, seriesId);
	reconcileDuplicates([seriesId]);
}

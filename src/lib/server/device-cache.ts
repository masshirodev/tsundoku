import { getDb } from './db.ts';
import { VISIBLE_SQL } from './visibility.ts';

/**
 * What a device may no longer keep (doc/OFFLINE.md, "Hiding takes it off the
 * device"). A device names the series and entries its caches hold; the
 * answer is those a viewer without reveal cannot see: hidden directly or by
 * their root, or gone from the library altogether.
 *
 * Reveal is ignored on purpose. The cache is something left on the device,
 * and a hidden series is never kept there whatever mode the device is in.
 * Hidden and deleted get the same answer, so a device learns nothing it
 * couldn't from a 404.
 */

/** More than any cache within its budget holds; a longer list is cut, not refused. */
export const MAX_ASKED = 20_000;

export type Held = { series: number[]; entries: number[] };

export function goneFromDevice(held: Held): Held {
	const db = getDb();
	const visible = (sql: string, ids: number[]) =>
		new Set(
			ids.length ? (db.prepare(sql).pluck().all(JSON.stringify(ids)) as number[]) : ([] as number[])
		);
	const series = visible(
		`SELECT s.id FROM series s JOIN roots r ON r.id = s.root_id
		 WHERE s.id IN (SELECT value FROM json_each(?)) AND ${VISIBLE_SQL}`,
		held.series
	);
	const entries = visible(
		`SELECT e.id FROM entries e JOIN series s ON s.id = e.series_id JOIN roots r ON r.id = s.root_id
		 WHERE e.id IN (SELECT value FROM json_each(?)) AND ${VISIBLE_SQL}`,
		held.entries
	);
	return {
		series: held.series.filter((id) => !series.has(id)),
		entries: held.entries.filter((id) => !entries.has(id))
	};
}

/** A posted list of ids, as the endpoint takes it: positive integers, once each, at most MAX_ASKED. */
export function idsOf(value: unknown): number[] {
	if (!Array.isArray(value)) return [];
	const ids = value.filter((n): n is number => Number.isInteger(n) && n > 0);
	return [...new Set(ids)].slice(0, MAX_ASKED);
}

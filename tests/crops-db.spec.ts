import { describe, expect, it } from 'vitest';

// Before anything imports db.ts: getDb() reads this once and memoises.
process.env.DATABASE_PATH = ':memory:';

const { getDb } = await import('$lib/server/db');
const { seedSample } = await import('$lib/server/fixtures');
const { cropsFor } = await import('$lib/server/pages/crops');

const db = getDb();
seedSample(db, Date.UTC(2026, 8, 23));
const entryOf = (title: string) =>
	(
		db
			.prepare(
				`SELECT e.id FROM entries e JOIN series s ON s.id = e.series_id WHERE s.title = ? ORDER BY e.position LIMIT 1`
			)
			.get(title) as { id: number }
	).id;
const rows = (id: number) =>
	(db.prepare(`SELECT COUNT(*) AS n FROM page_crops WHERE entry_id = ?`).get(id) as { n: number })
		.n;

describe('page borders, measured on the workstation', () => {
	it('finds the sample pages’ paper margin, once per page', async () => {
		const id = entryOf('Hikaru ga Shinda Natsu');
		const crops = (await cropsFor(id, false))!;
		expect(crops.length).toBeGreaterThan(10);
		// The generated page is drawn on paper with a margin all round.
		for (const side of crops[0]) expect(side).toBeGreaterThan(0);
		expect(rows(id)).toBe(crops.length);
		// The second time, nothing is decoded: the same answer from the table.
		const again = await cropsFor(id, false);
		expect(again).toEqual(crops);
	});

	it('is nothing for a hidden chapter while reveal is off', async () => {
		const hidden = (
			db
				.prepare(
					`SELECT e.id FROM entries e JOIN series s ON s.id = e.series_id JOIN roots r ON r.id = s.root_id
					WHERE r.hidden = 1 LIMIT 1`
				)
				.get() as { id: number }
		).id;
		expect(await cropsFor(hidden, false)).toBeNull();
		expect(rows(hidden)).toBe(0);
	});
});

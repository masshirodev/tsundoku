import { describe, expect, it } from 'vitest';

// Its own database: grouping renames and rehomes the seed's twins for good.
process.env.DATABASE_PATH = ':memory:';

const { getDb } = await import('$lib/server/db');
const { seedSample } = await import('$lib/server/fixtures');
const dupes = await import('$lib/server/dupes');

const db = getDb();
seedSample(db, Date.UTC(2026, 8, 24));

describe('GROUP AS A SERIES', () => {
	it('makes the two one series of books, and the pair is settled', async () => {
		const [p] = dupes.reviewQueue(true);
		await dupes.decide(p.key, 'group', null, true);
		expect(await dupes.applyPending()).toBe(1);
		const seriesOf = (id: number) =>
			(db.prepare(`SELECT series_id FROM entries WHERE id = ?`).get(id) as { series_id: number })
				.series_id;
		expect(seriesOf(p.a.entryId)).toBe(seriesOf(p.b.entryId));
		expect(
			db
				.prepare(`SELECT COUNT(*) FROM entries WHERE series_id = ?`)
				.pluck()
				.get(seriesOf(p.a.entryId))
		).toBe(2);
		expect(dupes.reviewQueue(true)).toEqual([]);
	});
});

import { describe, expect, it, vi } from 'vitest';

// Its own database: grouping renames and rehomes the seed's twins for good.
process.env.DATABASE_PATH = ':memory:';

// The sample has no files to make a thumbnail from: what's checked is that
// the covers are asked for, for the series the decision made.
const refreshCovers = vi.fn(async () => ({ made: 0, kept: 0, none: 0, failed: 0 }));
vi.mock('$lib/server/covers', async (original) => ({
	...(await original<typeof import('$lib/server/covers')>()),
	refreshCovers
}));

const { getDb } = await import('$lib/server/db');
const { seedSample } = await import('$lib/server/fixtures');
const dupes = await import('$lib/server/dupes');

const db = getDb();
seedSample(db, Date.UTC(2026, 8, 24));

describe('GROUP AS A SERIES', () => {
	it('makes the two one series of books, and the pair is settled', async () => {
		const [p] = dupes.reviewQueue(true);
		await dupes.decide(p.key, 'group', null, true);
		expect(await dupes.applyPending()).toEqual({ applied: 1, refused: [], failed: [] });
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
		// Its cover is remade from the files, off the request: a series of books
		// wears its first book's (GROUP here once left it with none).
		expect(refreshCovers).toHaveBeenCalledTimes(1);
		const [opts] = refreshCovers.mock.calls[0] as unknown as [{ ids: number[]; remote: boolean }];
		expect(opts.remote).toBe(false);
		expect(opts.ids).toContain(seriesOf(p.a.entryId));
	});
});

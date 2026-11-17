import { describe, expect, it } from 'vitest';

process.env.DATABASE_PATH = ':memory:';

const { getDb } = await import('$lib/server/db');
const { seedSample } = await import('$lib/server/fixtures');
const { goneFromDevice, idsOf, MAX_ASKED } = await import('$lib/server/device-cache');
const endpoint = await import('../src/routes/api/cache/gone/+server');

const db = getDb();
seedSample(db);

/**
 * What a device may not keep (doc/OFFLINE.md, "Hiding takes it off the
 * device"): a series hidden itself or by its root, and anything deleted.
 */
const one = (sql: string) => db.prepare(sql).pluck().get() as number;
const visible = one(
	`SELECT s.id FROM series s JOIN roots r ON r.id = s.root_id
	 WHERE s.hidden = 0 AND r.hidden = 0 AND EXISTS (SELECT 1 FROM entries e WHERE e.series_id = s.id)
	 ORDER BY s.id LIMIT 1`
);
const byRoot = one(
	`SELECT s.id FROM series s JOIN roots r ON r.id = s.root_id
	 WHERE s.hidden = 0 AND r.hidden = 1 AND s.public = 0 ORDER BY s.id LIMIT 1`
);
const entryOf = (seriesId: number) =>
	db
		.prepare(`SELECT id FROM entries WHERE series_id = ? ORDER BY id LIMIT 1`)
		.pluck()
		.get(seriesId) as number;

describe('goneFromDevice', () => {
	it('keeps what a viewer without reveal sees', () => {
		const e = entryOf(visible);
		expect(goneFromDevice({ series: [visible], entries: [e] })).toEqual({
			series: [],
			entries: []
		});
	});

	it('lets go of a series hidden after it was kept, and its entries', () => {
		const e = entryOf(visible);
		db.prepare(`UPDATE series SET hidden = 1 WHERE id = ?`).run(visible);
		try {
			expect(goneFromDevice({ series: [visible], entries: [e] })).toEqual({
				series: [visible],
				entries: [e]
			});
		} finally {
			db.prepare(`UPDATE series SET hidden = 0 WHERE id = ?`).run(visible);
		}
	});

	it('lets go of a series hidden by its root, unless it was made public', () => {
		expect(goneFromDevice({ series: [byRoot], entries: [] }).series).toEqual([byRoot]);
		db.prepare(`UPDATE series SET public = 1 WHERE id = ?`).run(byRoot);
		try {
			expect(goneFromDevice({ series: [byRoot], entries: [] }).series).toEqual([]);
		} finally {
			db.prepare(`UPDATE series SET public = 0 WHERE id = ?`).run(byRoot);
		}
	});

	it('answers a deleted series or entry the same as a hidden one', () => {
		expect(goneFromDevice({ series: [999_999], entries: [999_998] })).toEqual({
			series: [999_999],
			entries: [999_998]
		});
	});

	it('ignores reveal: the endpoint takes no cookie at all', async () => {
		db.prepare(`UPDATE series SET hidden = 1 WHERE id = ?`).run(visible);
		try {
			const res = await endpoint.POST({
				request: new Request('http://localhost/api/cache/gone', {
					method: 'POST',
					body: JSON.stringify({ series: [visible, 'x', -1], entries: 'nope' })
				})
			} as never);
			expect(await res.json()).toEqual({ series: [visible], entries: [] });
		} finally {
			db.prepare(`UPDATE series SET hidden = 0 WHERE id = ?`).run(visible);
		}
	});
});

describe('idsOf', () => {
	it('keeps positive integers once each, and nothing else', () => {
		expect(idsOf([3, 3, 1, 0, -2, 1.5, '4', null])).toEqual([3, 1]);
		expect(idsOf('3')).toEqual([]);
		expect(idsOf(undefined)).toEqual([]);
	});

	it('cuts a list longer than any cache holds', () => {
		const many = Array.from({ length: MAX_ASKED + 5 }, (_, i) => i + 1);
		expect(idsOf(many)).toHaveLength(MAX_ASKED);
	});
});

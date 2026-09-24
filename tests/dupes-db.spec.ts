import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { beforeEach, describe, expect, it } from 'vitest';

// Before anything imports db.ts: getDb() reads this once and memoises.
process.env.DATABASE_PATH = ':memory:';
process.env.TRASH_DIR = mkdtempSync(join(tmpdir(), 'tsundoku-dupes-trash-'));

const { getDb } = await import('$lib/server/db');
const { seedSample } = await import('$lib/server/fixtures');
const dupes = await import('$lib/server/dupes');
const { pairKey } = await import('$lib/library/dupes');

const db = getDb();
seedSample(db, Date.UTC(2026, 8, 24));
const ONE = 'Rakugaki Collection Vol. 3';
const TWO = 'Rakugaki Collection Vol. 3 [Digital]';
const seriesOf = (t: string) =>
	(db.prepare(`SELECT id FROM series WHERE title = ?`).get(t) as { id: number } | undefined)?.id;
const entryOf = (t: string) =>
	(
		db
			.prepare(`SELECT e.id FROM entries e JOIN series s ON s.id = e.series_id WHERE s.title = ?`)
			.get(t) as { id: number }
	).id;
const key = () => pairKey(entryOf(ONE), entryOf(TWO));

describe('finding duplicate books', () => {
	it('keeps a hidden pair hidden while reveal is off, and offers it with reveal on', () => {
		expect(dupes.reviewQueue(false)).toEqual([]);
		const [p] = dupes.reviewQueue(true);
		expect(p.kind).toBe('dup');
		expect(p.conf).toBe('likely');
		expect([p.a.title, p.b.title].sort()).toEqual([ONE, TWO]);
		// Same pages; [Digital]'s are larger, so it's the pick.
		expect(p.pick).toMatchObject({ rule: 2 });
		expect(p[p.pick!.keep].title).toBe(TWO);
	});

	it('finds the pair again from the hashes, and never a blank cover', async () => {
		db.prepare(`DELETE FROM dupe_pairs`).run();
		const r = await dupes.findDuplicates({ now: Date.UTC(2026, 8, 24) });
		expect(r.pairs).toBeGreaterThanOrEqual(1);
		expect(dupes.reviewQueue(true).map((p) => p.key)).toContain(key());
	});
});

describe('deciding', () => {
	beforeEach(() => db.prepare(`DELETE FROM dupe_decisions`).run());

	it('waits with a decision, so UNDO only forgets it', async () => {
		await dupes.decide(key(), 'keep', entryOf(TWO), true);
		expect(dupes.reviewQueue(true).map((p) => p.key)).not.toContain(key());
		expect(dupes.undoDecision(key())).toBe(true);
		expect(dupes.reviewQueue(true).map((p) => p.key)).toContain(key());
		expect(seriesOf(ONE)).toBeDefined();
	});

	it('KEEP BOTH is remembered: found again, the pair stays settled', async () => {
		await dupes.decide(key(), 'both', null, true);
		await dupes.applyPending();
		await dupes.findDuplicates();
		expect(dupes.reviewQueue(true).map((p) => p.key)).not.toContain(key());
		db.prepare(`DELETE FROM dupe_decisions`).run();
		await dupes.findDuplicates();
	});

	it('KEEP carries over what the other had, then trashes it', async () => {
		const shelf = Number(
			db.prepare(`INSERT INTO collections (name) VALUES ('Weekend') RETURNING id`).pluck().get()
		);
		db.prepare(`INSERT INTO collection_series (collection_id, series_id) VALUES (?, ?)`).run(
			shelf,
			seriesOf(TWO)
		);
		const keep = entryOf(ONE);
		await dupes.decide(key(), 'keep', keep, true);
		expect(await dupes.applyPending()).toBe(1);
		expect(seriesOf(TWO)).toBeUndefined();
		const s = db
			.prepare(`SELECT rating, favourite FROM series WHERE id = ?`)
			.get(seriesOf(ONE)) as { rating: number; favourite: number };
		expect(s).toEqual({ rating: 4, favourite: 1 });
		const e = db.prepare(`SELECT read_at FROM entries WHERE id = ?`).get(keep) as {
			read_at: number | null;
		};
		expect(e.read_at).not.toBeNull();
		expect(
			db
				.prepare(`SELECT 1 FROM collection_series WHERE collection_id = ? AND series_id = ?`)
				.get(shelf, seriesOf(ONE))
		).toBeTruthy();
		// Burying it (tombstones) is the delete's own, tested in delete-db.spec.ts: the
		// seed's books have no source to bury.
	});
});

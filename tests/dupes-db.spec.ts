import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { beforeEach, describe, expect, it, vi } from 'vitest';

// Finding a pair makes every page's thumbnail with sharp, about five seconds
// of real work for the sample books. Until 2026-10-29 this spec ran in half a
// second only because it found them made already, in the live covers folder
// (its default), where it had written them; a run now starts from an empty
// one (tests/vitest.global-setup.ts) and does the work.
vi.setConfig({ testTimeout: 30_000 });

// Before anything imports db.ts: getDb() reads this once and memoises.
process.env.DATABASE_PATH = ':memory:';
process.env.TRASH_DIR = mkdtempSync(join(tmpdir(), 'tsundoku-dupes-trash-'));

const { getDb } = await import('$lib/server/db');
const { seedSample } = await import('$lib/server/fixtures');
const dupes = await import('$lib/server/dupes');
const { pairKey } = await import('$lib/library/dupes');
// Reveal is a value only the server makes (prefs.ts), never a bare '1'.
const { revealValue } = await import('$lib/server/prefs');
const seriesScreen = await import('../src/routes/series/[id]/+page.server');

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

	// c671: KEEP BOTH on the series screen carries out the decisions waiting
	// from before first, as every decision does, and used to drop what
	// `decide` answered of them. A 409 would be false -- this KEEP BOTH is
	// recorded -- so the answer is a success that names the refusal.
	it('the series screen’s KEEP BOTH is recorded and says an earlier decision was refused', async () => {
		// Two series of several entries each: a FOLD of one entry of each is
		// refused (only a single book folds), as the review's own c648 case.
		const many = db
			.prepare(
				`SELECT series_id AS id, MIN(id) AS entry FROM entries
				 WHERE series_id NOT IN (?, ?)
				 GROUP BY series_id HAVING COUNT(*) > 1 ORDER BY series_id LIMIT 2`
			)
			.all(seriesOf(ONE), seriesOf(TWO)) as { id: number; entry: number }[];
		expect(many).toHaveLength(2);
		const [ea, eb] = [many[0].entry, many[1].entry].sort((x, y) => x - y);
		const earlier = `${ea},${eb}`;
		db.prepare(`INSERT INTO dupe_pairs (a, b, bits, rows, found_at) VALUES (?, ?, 0, ?, 1)`).run(
			ea,
			eb,
			JSON.stringify({ rows: [{ a: 1, b: 1 }], sizes: { [ea]: [0, 0], [eb]: [0, 0] } })
		);
		db.prepare(
			`INSERT INTO dupe_decisions (pair, decision, keep, at) VALUES (?, 'fold', NULL, 1)`
		).run(earlier);
		try {
			const body = new FormData();
			body.append('pair', key());
			const answer = (await (
				seriesScreen.actions.keepBoth as unknown as (e: unknown) => Promise<unknown>
			)({
				request: new Request('http://localhost/', { method: 'POST', body }),
				params: { id: String(seriesOf(ONE)) },
				url: new URL(`http://localhost/series/${seriesOf(ONE)}`),
				cookies: { get: (n: string) => (n === 'tsundoku_reveal' ? revealValue('1') : '1') }
			})) as { ok?: boolean; refused?: { pair: string; decision: string }[]; failed?: [] };
			expect(answer).toMatchObject({ ok: true, failed: [] });
			expect(answer.refused?.map((r) => [r.pair, r.decision])).toEqual([[earlier, 'fold']]);
			// The KEEP BOTH itself is recorded, and the refused FOLD is dropped.
			expect(
				db.prepare(`SELECT decision FROM dupe_decisions WHERE pair = ?`).pluck().get(key())
			).toBe('both');
			expect(
				db.prepare(`SELECT 1 FROM dupe_decisions WHERE pair = ?`).get(earlier)
			).toBeUndefined();
			// A second KEEP BOTH is a settled pair: the 409 it always was.
			const again = new FormData();
			again.append('pair', key());
			const second = (await (
				seriesScreen.actions.keepBoth as unknown as (e: unknown) => Promise<unknown>
			)({
				request: new Request('http://localhost/', { method: 'POST', body: again }),
				params: { id: String(seriesOf(ONE)) },
				url: new URL(`http://localhost/series/${seriesOf(ONE)}`),
				cookies: { get: (n: string) => (n === 'tsundoku_reveal' ? revealValue('1') : '1') }
			})) as { status?: number };
			expect(second.status).toBe(409);
		} finally {
			db.prepare(`DELETE FROM dupe_pairs WHERE a = ? AND b = ?`).run(ea, eb);
		}
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
		expect(await dupes.applyPending()).toEqual({ applied: 1, refused: [], failed: [] });
		expect(seriesOf(TWO)).toBeUndefined();
		const s = db
			.prepare(`SELECT rating, favourite FROM series WHERE id = ?`)
			.get(seriesOf(ONE)) as { rating: number; favourite: number };
		expect(s).toEqual({ rating: 8, favourite: 1 });
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

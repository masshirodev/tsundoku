import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { beforeAll, describe, expect, it } from 'vitest';

// Before anything imports db.ts: getDb() reads this once and memoises.
process.env.DATABASE_PATH = ':memory:';

const { getDb } = await import('$lib/server/db');
const { runImport } = await import('$lib/server/import');
const { writeMihonFolder } = await import('./helpers/mihon-fixture');

/**
 * When a chapter arrived is the import's time, not the source's date (rung
 * 34; doc/LIBRARY.md, "The NEW shelf"): Mihon dates a chapter by when its
 * source listed it, often years before it was downloaded.
 */
const library = dirname(writeMihonFolder(mkdtempSync(join(tmpdir(), 'tsundoku-arrivals-'))));
process.env.LIBRARY_ROOT = library;

const db = getDb();
const FIRST = 1_800_000_000_000;
const LATER = 1_800_500_000_000;
type Row = { id: number; added_at: number; arrived_at: number | null; available: number };
const entriesOf = (title: string) =>
	db
		.prepare(
			`SELECT e.id, e.added_at, e.arrived_at, e.available FROM entries e
			JOIN series s ON s.id = e.series_id WHERE s.title = ? ORDER BY e.position`
		)
		.all(title) as Row[];
const seriesArrived = (title: string) =>
	(db.prepare(`SELECT arrived_at FROM series WHERE title = ?`).get(title) as { arrived_at: number })
		.arrived_at;

beforeAll(async () => {
	await runImport(library, { now: FIRST });
});

describe('arrivals', () => {
	it('a new series and its downloaded chapters arrive with the import', () => {
		expect(seriesArrived('Drawing: Saikyou Mangaka')).toBe(FIRST);
		const rows = entriesOf('Drawing: Saikyou Mangaka');
		for (const r of rows) expect(r.arrived_at).toBe(r.available ? FIRST : null);
		// The source's own date is kept as it was.
		expect(rows.some((r) => r.available && r.added_at < FIRST)).toBe(true);
	});

	it('a file that comes in later arrives then, and the series with it', async () => {
		const [gone] = entriesOf('Drawing: Saikyou Mangaka').filter((r) => r.available);
		// As if this chapter weren't downloaded at the first import.
		db.prepare(`UPDATE entries SET available = 0, arrived_at = NULL WHERE id = ?`).run(gone.id);
		await runImport(library, { now: LATER });

		const rows = entriesOf('Drawing: Saikyou Mangaka');
		expect(rows.find((r) => r.id === gone.id)?.arrived_at).toBe(LATER);
		expect(rows.filter((r) => r.available && r.id !== gone.id).map((r) => r.arrived_at)).toEqual(
			rows.filter((r) => r.available && r.id !== gone.id).map(() => FIRST)
		);
		expect(seriesArrived('Drawing: Saikyou Mangaka')).toBe(LATER);
		// Nothing came in for this one.
		expect(seriesArrived('Academy’s Undercover Professor')).toBe(FIRST);
	});
});

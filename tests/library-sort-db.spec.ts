import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

// Before anything imports db.ts: getDb() reads this once and memoises.
process.env.DATABASE_PATH = ':memory:';

const { load } = await import('../src/routes/+page.server');
const { getDb } = await import('$lib/server/db');
const { seedSample } = await import('$lib/server/fixtures');
const { runImport } = await import('$lib/server/import');
const { recordReading } = await import('$lib/server/series');
const lib = await import('$lib/server/library');
const works = await import('$lib/server/works');
const { writeMihonFolder } = await import('./helpers/mihon-fixture');

type Scan = { finishedAt: number | null } | null;
const sortOf = async (query: string, scan: Scan = null) => {
	const data = (await load({
		url: new URL(`http://tsundoku.test/${query}`),
		cookies: { get: () => undefined },
		parent: async () => ({ scan })
	} as never)) as { sort: string };
	return data.sort;
};

/** Which sort the library opens on when the link names none (doc/LIBRARY.md). */
describe('the default sort', () => {
	it('is NEWEST on NEW, where it means newest arrival', async () => {
		expect(await sortOf('?shelf=new')).toBe('added');
	});

	it('is NEWEST while a scan runs', async () => {
		expect(await sortOf('', { finishedAt: null })).toBe('added');
	});

	it('is the library’s own anywhere else', async () => {
		expect(await sortOf('')).toBe('recent');
		expect(await sortOf('?shelf=all')).toBe('recent');
	});

	it('gives way to a sort the link names', async () => {
		expect(await sortOf('?shelf=new&sort=title')).toBe('title');
	});
});

/**
 * RECENTLY READ counts a series never opened as read when it was added (c524,
 * doc/LIBRARY.md, "Sort and direction"), reached through the doors that add
 * one: a scan of the downloads, then a read through the reader's own call.
 */
describe('RECENTLY READ and a series just added', () => {
	const T0 = Date.UTC(2026, 8, 22);
	const SCAN = T0 + 3_600_000;
	const LATER = SCAN + 3_600_000;
	const folder = mkdtempSync(join(tmpdir(), 'tsundoku-recent-'));
	const idOf = (title: string) =>
		(getDb().prepare(`SELECT id FROM series WHERE title = ?`).get(title) as { id: number }).id;
	const order = (dir: 'asc' | 'desc') =>
		lib.listSeries({ reveal: true, sort: 'recent', dir }).map((c) => c.id);
	let older: number;
	let later: number;

	beforeAll(async () => {
		seedSample(getDb(), T0);
		// The sample's most recently read series, read before the scan.
		older = lib.listSeries({ reveal: true, sort: 'recent' }).find((c) => c.opened)!.id;
		writeMihonFolder(join(folder, 'devices', 'tsundoku'));
		await runImport(folder, { now: SCAN });
		// Read after the scan, through the reader's call: one series the sample never opened.
		const never = lib.listSeries({ reveal: true, sort: 'title' }).find((c) => !c.opened)!;
		const entry = getDb()
			.prepare(`SELECT id FROM entries WHERE series_id = ? AND shadowed = 0 ORDER BY position`)
			.get(never.id) as { id: number };
		recordReading({ seriesId: never.id, entryId: entry.id, kind: 'open', page: 0, now: LATER });
		later = never.id;
	});
	afterAll(() => rmSync(folder, { recursive: true, force: true }));

	it('a scan stamps a series it found with no backup behind it as added at the scan', () => {
		const row = getDb()
			.prepare(`SELECT added_at FROM series WHERE title = 'Not In The Backup'`)
			.get() as { added_at: number };
		expect(row.added_at).toBe(SCAN);
	});

	it('sorts the new add above an older read and below a read after it was added', () => {
		const ids = order('desc');
		const added = idOf('Not In The Backup');
		expect(ids.indexOf(later)).toBe(0);
		expect(ids.indexOf(added)).toBeGreaterThan(ids.indexOf(later));
		expect(ids.indexOf(added)).toBeLessThan(ids.indexOf(older));
	});

	it('leaves a backup’s series where the backup says it was added, not at the top', () => {
		const ids = order('desc');
		// Mihon's dateAdded, 2023: below every read of the sample's, so below `older`.
		expect(ids.indexOf(idOf('Bunk Beds'))).toBeGreaterThan(ids.indexOf(older));
	});

	it('turned round is the exact mirror: the longest untouched first, the new add near the end', () => {
		const down = order('desc');
		expect(order('asc')).toEqual([...down].reverse());
		const up = order('asc');
		expect(up.indexOf(idOf('Not In The Backup'))).toBeGreaterThan(up.indexOf(older));
	});

	it('writes no reading for the new add: nothing is opened, nothing logged', () => {
		const added = idOf('Not In The Backup');
		const opened = getDb()
			.prepare(
				`SELECT COUNT(*) AS n FROM entries WHERE series_id = ? AND last_opened_at IS NOT NULL`
			)
			.get(added) as { n: number };
		const logged = getDb()
			.prepare(`SELECT COUNT(*) AS n FROM reading_events WHERE series_id = ?`)
			.get(added) as { n: number };
		expect([opened.n, logged.n]).toEqual([0, 0]);
	});

	it('a Work sorts the same way: a part just added lifts it above an older read', () => {
		// A Work of a series read before `older` and the new add.
		const reads = lib.listSeries({ reveal: true, sort: 'recent' }).filter((c) => c.opened);
		const stale = reads[reads.length - 1].id;
		const added = idOf('Not In The Backup');
		const facts = works.createWork({ seriesIds: [stale, added], name: 'Recent Run', now: LATER });
		try {
			const tiles = lib.listTiles({ reveal: true, sort: 'recent' });
			const at = (pick: (t: (typeof tiles)[number]) => boolean) => tiles.findIndex(pick);
			const work = at((t) => t.work?.id === facts.work.id);
			expect(at((t) => t.id === later && !t.work)).toBe(0);
			expect(work).toBe(1);
			expect(work).toBeLessThan(at((t) => t.id === older && !t.work));
		} finally {
			works.undoCreate(facts);
		}
	});
});

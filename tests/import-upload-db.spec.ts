import { mkdirSync, mkdtempSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { gzipSync } from 'node:zlib';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

/**
 * IMPORT A BACKUP's server half (c438, doc/IMPORT-BACKUP.md): the upload in pieces,
 * the import area, reading a file before anything is written, the preview,
 * IMPORT as a scan job, a second backup merging, and the log's counts
 * following reveal. Reached through the functions the routes call, from a
 * library that came in from a first backup, never from hand-seeded rows.
 */

const home = mkdtempSync(join(tmpdir(), 'tsundoku-import-upload-'));
const library = join(home, 'library');
const area = join(home, 'imports');
mkdirSync(library);
// Before anything imports db.ts or data-dirs.ts: both read these once.
process.env.DATABASE_PATH = ':memory:';
process.env.LIBRARY_ROOT = library;
process.env.IMPORT_DIR = area;

const { getDb } = await import('$lib/server/db');
const b = await import('$lib/server/import/backup');
const log = await import('$lib/server/import/log');
const { backup, CATEGORIES } = await import('./helpers/mihon-fixture');
const { encode } = await import('./helpers/protobuf-writer');
const mihonBackup = await import('$lib/import/mihon-backup');
const { encodeBackup } = mihonBackup;
const { setRating, setFavourite, setInCollection, setHidden } = await import('$lib/server/library');
const { setDirection } = await import('$lib/server/series');
const { BACKUP_LABEL } = await import('$lib/import/backup-preview');
const { runImport, runQueued, sourcesIn, startScan, SCAN_WAITS } =
	await import('$lib/server/import');

const db = () => getDb();
const NAME = 'app.mihon_2026-11-02_03-14.tachibk';
const gz = (raw: Uint8Array) => new Uint8Array(gzipSync(raw));

/** The browser's side: the file in pieces of CHUNK_BYTES, as /import/upload takes them. */
function upload(bytes: Uint8Array, name = NAME, origin: 'desktop' | 'phone' = 'desktop') {
	let token: string | null = null;
	let offset = 0;
	let pieces = 0;
	for (;;) {
		const piece = bytes.subarray(offset, offset + b.CHUNK_BYTES);
		const a = b.receiveChunk({ token, name, size: bytes.length, offset, origin }, piece);
		pieces += 1;
		if (a.state !== 'more') return { ...a, pieces };
		token = a.token;
		offset = a.written;
	}
}

const series = (title: string) =>
	db().prepare(`SELECT * FROM series WHERE title = ?`).get(title) as
		(Record<string, unknown> & { id: number }) | undefined;
const shelvesOf = (id: number) =>
	(
		db()
			.prepare(
				`SELECT c.name FROM collection_series cs JOIN collections c ON c.id = cs.collection_id
				WHERE cs.series_id = ? ORDER BY c.name`
			)
			.all(id) as { name: string }[]
	).map((r) => r.name);

afterAll(() => rmSync(home, { recursive: true, force: true }));

describe('the upload', () => {
	it('takes a multi-megabyte file in pieces under adapter-node’s 512 KB limit', () => {
		// A real backup is megabytes (the board's is 2.4 MB): padding the
		// fixture's manga list with browsed-only series makes it one.
		const more = Array.from({ length: 6000 }, (_, i) => [
			[1, 2131019126180322627n],
			[2, `/series/pad-${i}`],
			[3, `Browsed ${i} ${'x'.repeat(400)}`],
			[100, false]
		]);
		const raw = backup([], more as never);
		const bytes = new Uint8Array(raw.length);
		bytes.set(raw);
		// Stored, not compressed: gzip at level 0 keeps it the size it is.
		const file = new Uint8Array(gzipSync(bytes, { level: 0 }));
		expect(file.length).toBeGreaterThan(2 * 1024 * 1024);
		expect(b.CHUNK_BYTES).toBeLessThan(512 * 1024);
		const r = upload(file);
		expect(r.state).toBe('read');
		expect(r.pieces).toBe(Math.ceil(file.length / b.CHUNK_BYTES));
		const row = b.importRow(r.state === 'read' ? r.id : -1)!;
		expect(row).toMatchObject({ state: 'read', app: 'mihon', fileBytes: file.length });
		// Kept in the import area, never the library.
		expect(row.stored.startsWith(area)).toBe(true);
		expect(readdirSync(library)).toEqual([]);
	});

	it('refuses a file over the limit with a sentence, keeping nothing', () => {
		const before = readdirSync(area).length;
		const r = b.receiveChunk(
			{
				token: null,
				name: 'huge.tachibk',
				size: b.MAX_BACKUP_BYTES + 1,
				offset: 0,
				origin: 'desktop'
			},
			new Uint8Array(10)
		);
		expect(r).toEqual({
			state: 'refused',
			id: null,
			reason: `HUGE.TACHIBK · 100.0 MB · OVER THE 100 MB A BACKUP MAY BE · NOTHING CHANGED`
		});
		expect(readdirSync(area).length).toBe(before);
	});

	it('takes a file of exactly the limit’s size as far as its first piece', () => {
		const r = b.receiveChunk(
			{ token: null, name: 'edge.tachibk', size: b.MAX_BACKUP_BYTES, offset: 0, origin: 'desktop' },
			new Uint8Array(10)
		);
		expect(r.state).toBe('more');
		if (r.state === 'more') b.cancelUpload(r.token);
	});

	it('refuses a piece that does not start where the last ended, and drops what it had', () => {
		const file = gz(backup());
		const first = b.receiveChunk(
			{ token: null, name: NAME, size: file.length, offset: 0, origin: 'desktop' },
			file.subarray(0, 100)
		);
		expect(first.state).toBe('more');
		const token = first.state === 'more' ? first.token : '';
		const skip = b.receiveChunk(
			{ token, name: NAME, size: file.length, offset: 200, origin: 'desktop' },
			file.subarray(200, 300)
		);
		expect(skip).toMatchObject({ state: 'refused', reason: /INTERRUPTED/ });
		expect(readdirSync(area).some((n) => n.includes(token))).toBe(false);
	});

	it('CANCEL removes the pieces kept so far', () => {
		const first = b.receiveChunk(
			{ token: null, name: NAME, size: 1000, offset: 0, origin: 'desktop' },
			new Uint8Array(100)
		);
		const token = first.state === 'more' ? first.token : '';
		expect(readdirSync(area).some((n) => n.includes(token))).toBe(true);
		b.cancelUpload(token);
		expect(readdirSync(area).some((n) => n.includes(token))).toBe(false);
	});
});

describe('a file that is not a backup it reads', () => {
	const refused = (bytes: Uint8Array, name: string) => {
		const r = upload(bytes, name);
		expect(r.state).toBe('refused');
		return r.state === 'refused' ? r : null!;
	};

	it('is refused on the pick screen with what it was taken for, and nothing kept', () => {
		const series0 = (db().prepare(`SELECT COUNT(*) n FROM series`).get() as { n: number }).n;
		const cases: [Uint8Array, string, RegExp, string][] = [
			[new TextEncoder().encode('just some notes'), 'notes.txt', /NOT A MIHON BACKUP/, ''],
			[
				new Uint8Array([0x50, 0x4b, 3, 4, 0, 0]),
				'Notes.zip',
				/LNREADER BACKUPS ARE NOT READ YET/,
				'lnreader'
			],
			[
				gz(backup()).subarray(0, 200),
				'cut.tachibk',
				/ISN’T WHOLE \(CUT OFF IN THE COPY\)/,
				'mihon'
			],
			[gz(new Uint8Array([0xff, 0xff, 0xff])), 'odd.tachibk', /DON’T READ AS A BACKUP/, ''],
			// Aniyomi's anime (field 3) beside its manga.
			[
				gz(
					encode([
						[3, [[3, 'An anime']]],
						[1, [[3, 'A manga']]]
					])
				),
				'ani.tachibk',
				/AN ANIYOMI BACKUP · ANIYOMI IS NOT READ YET/,
				'aniyomi'
			],
			[new Uint8Array(), 'empty.tachibk', /AN EMPTY FILE/, '']
		];
		for (const [bytes, name, reason, app] of cases) {
			const r = refused(bytes, name);
			expect(r.reason, name).toMatch(reason);
			expect(r.reason, name).toMatch(/NOTHING CHANGED$/);
			const row = b.importRow(r.id!)!;
			expect(row, name).toMatchObject({ state: 'refused', app, stored: '' });
		}
		expect(readdirSync(area).filter((n) => !n.startsWith('1-'))).toEqual([]);
		expect((db().prepare(`SELECT COUNT(*) n FROM series`).get() as { n: number }).n).toBe(series0);
	});

	it('a small file that unpacks past the cap is refused with a sentence (round 2)', () => {
		// 2 MB of zeros gzips to about 2 KB; with a 1 MB cap it never inflates whole.
		const bomb = gz(new Uint8Array(2 * 1024 * 1024));
		expect(bomb.length).toBeLessThan(10_000);
		const r = b.readBackupFile(bomb, 'bomb.tachibk', 1024 * 1024);
		expect(r).toMatchObject({ ok: false, app: 'mihon' });
		expect(!r.ok && r.reason).toBe(
			'BOMB.TACHIBK · IT UNPACKS TO MORE THAN THE 1 MB A BACKUP MAY HOLD · NOTHING CHANGED'
		);
		// The cap the upload reads with.
		expect(b.MAX_RAW_BYTES).toBe(10 * b.MAX_BACKUP_BYTES);
	});

	it('a backup whose library is empty says there is nothing to bring in', () => {
		const onlyBrowsed = encodeBackup({
			manga: [
				{
					source: '1',
					url: '/a',
					title: 'Only Browsed',
					artist: '',
					author: '',
					description: '',
					genres: [],
					status: 0,
					thumbnailUrl: '',
					dateAdded: null,
					viewer: 0,
					chapters: [],
					categories: [],
					favorite: false,
					history: [],
					trackers: []
				}
			],
			categories: [{ name: 'Good', order: 0 }],
			sources: new Map([['1', 'Somewhere']])
		});
		const r = refused(gz(onlyBrowsed), 'empty-library.tachibk');
		expect(r.reason).toBe(
			'NOTHING TO BRING IN · MIHON BACKUP · 0 SERIES IN ITS LIBRARY · 1 ONLY BROWSED'
		);
	});
});

describe('the preview, and IMPORT', () => {
	let first: number;
	beforeAll(() => {
		const r = upload(gz(backup()), NAME, 'phone');
		first = r.state === 'read' ? r.id : -1;
	});

	it('counts the file before anything is written', () => {
		const p = b.previewImport(first, true)!;
		expect(p.ok).toBe(true);
		if (!p.ok) return;
		// The fixture's library: four series in it, one only browsed, one local.
		expect(p.preview).toMatchObject({
			app: 'mihon',
			series: 4,
			alreadyHere: 0,
			same: null,
			leftOut: { browsed: 1, local: 1, damaged: [] }
		});
		expect(p.preview.kinds.reduce((a, k) => a + k.series, 0)).toBe(4);
		expect(p.preview.rows.map((r) => r.title).sort()).toEqual([
			'Academy’s Undercover Professor',
			'Bunk Beds',
			'Drawing: Saikyou Mangaka',
			'Myst, Might, Mayhem'
		]);
		// Every source is missing: no extension is installed in this library.
		expect(p.preview.missing.every((m) => m.found === null)).toBe(true);
		expect(p.preview.missing.reduce((a, m) => a + m.series, 0)).toBe(4);
		// Every category is a chip; the importer's rating names say RATES.
		expect(p.preview.categories.map((c) => c.name)).toEqual(CATEGORIES);
		const chip = (n: string) => p.preview.categories.find((c) => c.name === n)!;
		expect(chip('Good')).toMatchObject({ effect: 'rates', rating: 8 });
		expect(chip('Amazing+')).toMatchObject({ effect: 'rates', rating: 10 });
		expect(chip('To Read')).toMatchObject({ effect: 'shelf' });
		expect((db().prepare(`SELECT COUNT(*) n FROM series`).get() as { n: number }).n).toBe(0);
		expect(b.importRow(first)).toMatchObject({ state: 'read', origin: 'phone', seriesTotal: 4 });
	});

	it('a category named like an existing shelf adds to it', () => {
		db().prepare(`INSERT INTO collections (name, position) VALUES ('To Read', 0)`).run();
		const p = b.previewImport(first, true)!;
		expect(p.ok && p.preview.categories.find((c) => c.name === 'To Read')).toMatchObject({
			effect: 'adds'
		});
	});

	it('IMPORT brings the series in as a job, leaves an unticked category off the shelves, and keeps hiding', async () => {
		expect(b.startBackupImport(first, { leaveOut: ['Dropped', 'Good+'] })).toEqual({
			started: true
		});
		await b.settled();
		const row = b.importRow(first)!;
		expect(row).toMatchObject({ state: 'done', seriesTotal: 4, seriesDone: 4 });
		expect(row.jobId).not.toBeNull();
		const job = db().prepare(`SELECT * FROM scan_jobs WHERE id = ?`).get(row.jobId) as {
			source_label: string;
			finished_at: number | null;
		};
		expect(job).toMatchObject({ source_label: 'MIHON BACKUP' });
		expect(job.finished_at).not.toBeNull();
		// The fixture's "+" series is in Good+: left out, it is not rated by it,
		// and it is still hidden.
		const plus = db().prepare(`SELECT * FROM series WHERE hidden = 1`).all() as {
			title: string;
			rating: number;
		}[];
		expect(plus.map((s) => s.title)).toEqual(['Bunk Beds']);
		expect(plus[0].rating).toBe(0);
		// The root a Mihon folder's backup writes to, whether the folder exists or not.
		const root = db()
			.prepare(`SELECT r.path FROM series s JOIN roots r ON r.id = s.root_id LIMIT 1`)
			.get() as { path: string };
		expect(root.path).toBe(join(library, 'Mihon'));
		expect(readdirSync(library)).toEqual([]);
		expect(row.outcome).toMatchObject({ leftOut: ['Dropped', 'Good+'], browsed: 1, local: 1 });
		expect(row.outcome.noSource!.map((s) => s.name).sort()).toEqual([
			'Asura Scans',
			'Weeb Central'
		]);
	});

	it('counts what it brought, following reveal', () => {
		expect(log.importCounts(first, true)).toEqual({ fresh: 4, merged: 0, noSource: 4 });
		expect(log.importCounts(first, false)).toEqual({ fresh: 3, merged: 0, noSource: 3 });
		const entry = log.importLog(false).find((e) => e.kind === 'backup' && e.id === first);
		expect(entry).toMatchObject({ kind: 'backup', state: 'done', counts: { fresh: 3 } });
		expect(log.lastImport(false)).toMatchObject({ id: first, counts: { fresh: 3 } });
		expect(log.sourcesLacking(first, true).sort()).toEqual(['Asura Scans', 'Weeb Central']);
	});

	it('a refused file is in the log, a preview nobody imported is not', () => {
		const entries = log.importLog(true);
		expect(entries.some((e) => e.kind === 'backup' && e.state === 'refused')).toBe(true);
		expect(entries.some((e) => e.kind === 'backup' && e.state === 'read')).toBe(false);
	});
});

describe('a second backup of the same library', () => {
	let firstId: number;
	let second: number;
	beforeAll(() => {
		firstId = log.lastImport(true)!.id;
	});

	it('is called the same library, with what is new, here, newer and gone', () => {
		// The owner reads on in the app: Drawing's chapter 3 read, and one more
		// series added; Bunk Beds deleted on the phone.
		const raw = backup([4], [
			[
				[1, 2131019126180322627n],
				[2, '/series/new-one'],
				[3, 'A New One'],
				[
					16,
					[
						[1, '/chapters/N1'],
						[2, 'Chapter 1'],
						[4, true]
					]
				]
			]
		] as never);
		const r = upload(gz(raw), 'app.mihon_2026-11-03_08-00.tachibk');
		second = r.state === 'read' ? r.id : -1;
		const p = b.previewImport(second, true)!;
		expect(p.ok).toBe(true);
		if (!p.ok) return;
		expect(p.preview.same).toMatchObject({ importId: firstId, fresh: 1, here: 4, gone: 0 });
		expect(p.preview.alreadyHere).toBe(4);
	});

	it('merges: adds and updates, removes nothing, and leaves the owner’s edits alone', async () => {
		const drawing = series('Drawing: Saikyou Mangaka')!;
		const bunk = series('Bunk Beds')!;
		// Through the app's doors: rating, FAV, a shelf, hidden, direction.
		setRating([drawing.id], 3);
		setFavourite([drawing.id], true);
		const shelf = Number(
			db().prepare(`INSERT INTO collections (name, position) VALUES ('Mine', 9)`).run()
				.lastInsertRowid
		);
		setInCollection([drawing.id], shelf, true);
		setDirection(drawing.id, 'ltr');
		setHidden([bunk.id], true);
		// The writer never touches the title or kind of a series it finds again
		// (doc/IMPORT-BACKUP.md, "IMPORT"), so both are set by hand here.
		db().prepare(`UPDATE series SET title = 'My Title', kind = 'manhwa' WHERE id = ?`).run(bunk.id);
		const before = (db().prepare(`SELECT COUNT(*) n FROM series`).get() as { n: number }).n;

		b.startBackupImport(second);
		await b.settled();
		expect(b.importRow(second)).toMatchObject({ state: 'done' });
		const after = (db().prepare(`SELECT COUNT(*) n FROM series`).get() as { n: number }).n;
		expect(after).toBe(before + 1);
		expect(series('A New One')).toBeDefined();
		const d = series('Drawing: Saikyou Mangaka')!;
		expect(d).toMatchObject({ rating: 3, favourite: 1, direction: 'ltr' });
		expect(shelvesOf(d.id)).toContain('Mine');
		const kept = db().prepare(`SELECT * FROM series WHERE id = ?`).get(bunk.id) as {
			title: string;
			kind: string;
			hidden: number;
		};
		expect(kept).toMatchObject({ title: 'My Title', kind: 'manhwa', hidden: 1 });
		// The new chapter came in.
		expect(
			db()
				.prepare(
					`SELECT COUNT(*) n FROM entries WHERE series_id = ? AND source_url = '/chapters/AAA4'`
				)
				.get(d.id)
		).toEqual({ n: 1 });
		expect(log.importCounts(second, true)).toMatchObject({ fresh: 1, merged: 4 });
	});

	it('a series deleted in the app is counted as gone, and stays', () => {
		// The app's library without Bunk Beds and the "+" series: three of the
		// five the last import brought, enough to be the same library.
		const { decodeBackup } = mihonBackup;
		const full = decodeBackup(
			backup([4], [
				[
					[1, 2131019126180322627n],
					[2, '/series/new-one'],
					[3, 'A New One']
				]
			] as never)
		);
		const lean = encodeBackup({
			...full,
			manga: full.manga.filter((m) => !['Bunk Beds', 'Myst, Might, Mayhem'].includes(m.title))
		});
		const r = upload(gz(lean), 'app.mihon_2026-11-04_08-00.tachibk');
		const p = b.previewImport(r.state === 'read' ? r.id : -1, true)!;
		expect(p.ok && p.preview.same).toMatchObject({ importId: second, gone: 2, fresh: 0 });
		// Bunk Beds is hidden: with reveal off it is neither here nor gone (round 2).
		const off = b.previewImport(r.state === 'read' ? r.id : -1, false)!;
		expect(off.ok && off.preview.same).toMatchObject({ importId: second, gone: 1, fresh: 0 });
		expect(series('Bunk Beds') ?? series('My Title')).toBeDefined();
	});

	it('another library is not called the same', () => {
		const other = encodeBackup({
			manga: [
				{
					source: '77',
					url: '/x',
					title: 'Someone Else’s',
					artist: '',
					author: '',
					description: '',
					genres: [],
					status: 0,
					thumbnailUrl: '',
					dateAdded: null,
					viewer: 0,
					chapters: [],
					categories: [],
					favorite: true,
					history: [],
					trackers: []
				}
			],
			categories: [],
			sources: new Map([['77', 'Elsewhere']])
		});
		const r = upload(gz(other), 'friend.tachibk');
		const p = b.previewImport(r.state === 'read' ? r.id : -1, true)!;
		expect(p.ok && p.preview.same).toBeNull();
	});
});

describe('one import or scan at a time', () => {
	it('an import chosen while a scan runs waits, says so, then runs', async () => {
		// A backup dropped in the library's Mihon folder gives the scan something to do.
		const { writeFileSync } = await import('node:fs');
		mkdirSync(join(library, 'Mihon', 'autobackup'), { recursive: true });
		writeFileSync(join(library, 'Mihon', 'autobackup', NAME), gzipSync(backup()));
		expect(sourcesIn(library).length).toBe(1);
		const r = upload(gz(backup([5])), 'app.mihon_2026-11-05_08-00.tachibk');
		const id = r.state === 'read' ? r.id : -1;
		const scan = runImport(library);
		b.startBackupImport(id);
		expect(b.importRow(id)!.state).toBe('waiting');
		await scan;
		await b.settled();
		const row = b.importRow(id)!;
		expect(row.state).toBe('done');
		const jobs = db().prepare(`SELECT id FROM scan_jobs ORDER BY id DESC LIMIT 2`).all() as {
			id: number;
		}[];
		// Its own job, opened after the scan's.
		expect(row.jobId).toBe(jobs[0].id);
		rmSync(join(library, 'Mihon'), { recursive: true });
	});

	it('the log lists the scan and the imports, newest first', () => {
		const entries = log.importLog(true);
		expect(entries.some((e) => e.kind === 'scan')).toBe(true);
		const ats = entries.map((e) => e.at);
		expect(ats).toEqual([...ats].sort((x, y) => y - x));
	});
});

/**
 * A backup's job whose plan is held open until `release()`: the queue
 * runQueued keeps for IMPORT, with nothing in the file.
 */
function heldBackup() {
	let release = () => {};
	const gate = new Promise<void>((r) => (release = r));
	const job = runQueued({
		name: 'Mihon',
		label: BACKUP_LABEL,
		device: null,
		root: join(home, 'held'),
		hidden: false,
		markMissing: false,
		counts: 'series',
		bytes: async () => 0,
		plan: async () => {
			await gate;
			return { series: [], skipped: 0 };
		}
	});
	return { job, release };
}

const jobs = () =>
	db()
		.prepare(`SELECT id, started_at, finished_at, source_label FROM scan_jobs ORDER BY id`)
		.all() as {
		id: number;
		started_at: number;
		finished_at: number | null;
		source_label: string;
	}[];

describe('an import whose process died (round 2)', () => {
	it('reads as stopped, and the log has nothing live', () => {
		// Rows left `running` and `waiting` by a process that is gone: no queue here holds them.
		const ids = ['app.mihon_2026-11-06_01-00.tachibk', 'app.mihon_2026-11-06_02-00.tachibk'].map(
			(name) => {
				const r = upload(gz(backup()), name);
				return r.state === 'read' ? r.id : -1;
			}
		);
		db()
			.prepare(`UPDATE imports SET state = 'running', started_at = ? WHERE id = ?`)
			.run(1, ids[0]);
		db()
			.prepare(`UPDATE imports SET state = 'waiting', started_at = ? WHERE id = ?`)
			.run(1, ids[1]);
		expect(log.liveImport()).toBeNull();
		for (const id of ids) {
			const row = b.importRow(id)!;
			expect(row.state).toBe('failed');
			expect(row.finishedAt).not.toBeNull();
		}
		const live = log
			.importLog(true)
			.filter((e) => (e.kind === 'scan' ? e.running : ['running', 'waiting'].includes(e.state)));
		expect(live).toEqual([]);
	});

	it('an import really queued behind a running job still waits, then runs', async () => {
		const held = heldBackup();
		const r = upload(gz(backup([5])), 'app.mihon_2026-11-06_03-00.tachibk');
		const id = r.state === 'read' ? r.id : -1;
		expect(b.startBackupImport(id)).toEqual({ started: true });
		// Read through every door that reconciles: still waiting, in the log too.
		expect(b.importRow(id)!.state).toBe('waiting');
		expect(log.liveImport()!.id).toBe(id);
		expect(log.importLog(true).find((e) => e.kind === 'backup' && e.id === id)).toMatchObject({
			state: 'waiting'
		});
		await new Promise((r) => setTimeout(r, 50));
		expect(b.importRow(id)!.state).toBe('waiting');
		held.release();
		await held.job;
		await b.settled();
		expect(b.importRow(id)!.state).toBe('done');
	});
});

describe('a scan asked for during a backup’s import (round 2)', () => {
	it('waits its turn, says so, then reads the folder in a job of its own', async () => {
		const { writeFileSync } = await import('node:fs');
		mkdirSync(join(library, 'Mihon', 'autobackup'), { recursive: true });
		writeFileSync(join(library, 'Mihon', 'autobackup', NAME), gzipSync(backup()));
		const label = sourcesIn(library)
			.map((s) => s.label ?? s.name.toUpperCase())
			.join(' + ');
		// The folder's series are gone first, so the scan's job is seen writing them.
		db().prepare(`DELETE FROM series`).run();
		const before = jobs().length;
		const held = heldBackup();
		const scan = startScan(library);
		expect(scan).toEqual({ started: true, waiting: true });
		// A second press while it waits joins the waiting scan: still one job to come.
		const a = runImport(library);
		const c = runImport(library);
		expect(a).toBe(c);
		held.release();
		const [backupDone, scanDone] = await Promise.all([held.job, a]);
		const after = jobs().slice(before);
		expect(after).toHaveLength(2);
		const [own, theScan] = after;
		expect(own.id).toBe(backupDone.jobId);
		expect(own.source_label).toBe(BACKUP_LABEL);
		expect(theScan.id).toBe(scanDone.jobId);
		expect(theScan.source_label).toBe(label);
		expect(theScan.started_at).toBeGreaterThanOrEqual(own.finished_at!);
		const written = db()
			.prepare(`SELECT COUNT(*) n FROM series WHERE scan_job_id = ?`)
			.get(theScan.id) as { n: number };
		expect(written.n).toBeGreaterThan(0);
		rmSync(join(library, 'Mihon'), { recursive: true });
	});

	it('two scans asked for during a scan are still one job', async () => {
		mkdirSync(join(library, 'Mihon', 'autobackup'), { recursive: true });
		const { writeFileSync } = await import('node:fs');
		writeFileSync(join(library, 'Mihon', 'autobackup', NAME), gzipSync(backup()));
		const before = jobs().length;
		const first = runImport(library);
		const second = runImport(library);
		expect(second).toBe(first);
		expect(startScan(library)).toEqual({ started: true, waiting: false });
		await first;
		await new Promise((r) => setTimeout(r, 20));
		expect(jobs().length - before).toBe(1);
		rmSync(join(library, 'Mihon'), { recursive: true });
	});

	it('RESCAN during a held import answers WAITING, and the sidebar’s line follows the queue past the scan’s end (c512)', async () => {
		const { writeFileSync } = await import('node:fs');
		mkdirSync(join(library, 'Mihon', 'autobackup'), { recursive: true });
		writeFileSync(join(library, 'Mihon', 'autobackup', NAME), gzipSync(backup()));
		const { actions } = await import('../src/routes/+page.server');
		// What the layout's load hands the sidebar on every page (`scanWaits`, from `scanQueued`).
		const { scanWaitsLine } = await import('$lib/server/import');
		const sidebar = async () => scanWaitsLine();
		expect(await sidebar()).toBeNull();
		const held = heldBackup();
		// A backup's import runs and nobody has asked for a scan: no line. A
		// scan asked for now would wait (`scanWaits`), but none is waiting, so
		// the sidebar must not say one is (round 2's high).
		const { scanWaits } = await import('$lib/server/import');
		expect(scanWaits()).toBe(true);
		expect(await sidebar()).toBeNull();
		await new Promise((r) => setTimeout(r, 20));
		expect(await sidebar()).toBeNull();
		// The library page's own `?/scan` action, the one RESCAN posts.
		const answer = await (actions.scan as () => Promise<unknown>)();
		expect(answer).toEqual({ scanMessage: SCAN_WAITS });
		expect(SCAN_WAITS).toBe('WAITING · THE SCAN STARTS WHEN THE BACKUP’S IMPORT ENDS');
		expect(await sidebar()).toBe(SCAN_WAITS);
		// Still waiting, a while later: the line is the queue's, not a timer's.
		await new Promise((r) => setTimeout(r, 50));
		expect(await sidebar()).toBe(SCAN_WAITS);
		held.release();
		await held.job;
		// The scan has started, and then ended: no line, where the action's
		// answer stayed drawn until the next press.
		const { importRunning } = await import('$lib/server/import');
		await importRunning();
		expect(await sidebar()).toBeNull();
		rmSync(join(library, 'Mihon'), { recursive: true });
	});
});

describe('an IMPORT that throws before its run (c512)', () => {
	it('fails where it stands, with a reason, and leaves nothing live', async () => {
		const r = upload(gz(backup([7])), 'app.mihon_2026-11-07_01-00.tachibk');
		const id = r.state === 'read' ? r.id : -1;
		// An added repository's listing the preview read, then spoiled: what
		// `libraryFacts` parses between the row's `running` and the queue.
		const repo = Number(
			db()
				.prepare(
					`INSERT INTO engine_repos (base, name, fingerprint, added_at) VALUES ('https://c512.example', 'C512', 'f', 1)`
				)
				.run().lastInsertRowid
		);
		db()
			.prepare(
				`INSERT INTO engine_listings (repo_id, pkg, listing) VALUES (?, 'c512.pkg', '{not json')`
			)
			.run(repo);
		try {
			expect(b.startBackupImport(id)).toEqual({ started: false, reason: b.COULD_NOT_START });
			const row = b.importRow(id)!;
			expect(row.state).toBe('failed');
			expect(row.finishedAt).not.toBeNull();
			// Nothing live: the log has no running import, and a spec's wait ends.
			expect(log.liveImport()).toBeNull();
			await b.settled(500);
			// The second press: refused as what it now is, not run.
			expect(b.startBackupImport(id)).toEqual({ started: false, reason: 'NOT A PREVIEW WAITING' });
		} finally {
			db().prepare(`DELETE FROM engine_repos WHERE id = ?`).run(repo);
		}
	});
});

describe('IMPORT A BACKUP from a source with ADDED HIDDEN (c503)', () => {
	it('brings a series new to the library in hidden, and leaves one already here as it is', async () => {
		const { setSourceFlag } = await import('$lib/server/engine/source-flags');
		const SWITCHED = 9_200_000_000_000_000_001n;
		const manga = (title: string) => [
			[1, SWITCHED],
			[2, `/c503/${title.toLowerCase().replace(/ /g, '-')}`],
			[3, title],
			[
				16,
				[
					[1, `/c503/${title.toLowerCase().replace(/ /g, '-')}/1`],
					[2, 'Chapter 1']
				]
			],
			[17, 1]
		];
		const importFile = async (name: string, titles: string[]) => {
			const r = upload(gz(backup([], titles.map(manga) as never)), name);
			const id = r.state === 'read' ? r.id : -1;
			expect(b.startBackupImport(id)).toEqual({ started: true });
			await b.settled();
			expect(b.importRow(id)!.state).toBe('done');
		};
		await importFile('app.mihon_2026-11-08_01-00.tachibk', ['Upload Before']);
		expect(series('Upload Before')).toMatchObject({ hidden: 0 });
		setSourceFlag(String(SWITCHED), 'addedHidden', true, db());
		try {
			await importFile('app.mihon_2026-11-08_02-00.tachibk', ['Upload Before', 'Upload After']);
			expect(series('Upload After')).toMatchObject({ hidden: 1 });
			expect(series('Upload Before')).toMatchObject({ hidden: 0 });
		} finally {
			setSourceFlag(String(SWITCHED), 'addedHidden', false, db());
		}
	});
});

describe('the TV never imports, refused on the server (c511)', () => {
	const TV =
		'Mozilla/5.0 (Linux; Android 9; BRAVIA 4K GB) AppleWebKit/537.36 Chrome/94.0 Safari/537.36 TsundokuTV/1.0.0';
	const PHONE =
		'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Version/4.0 Chrome/131.0.6778.135 Mobile Safari/537.36 TsundokuApp/2026.11.05';
	const BROWSER =
		'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0 Safari/537.36';
	const req = (ua: string, url = 'http://localhost/import', init: RequestInit = {}) =>
		new Request(url, { ...init, headers: { 'user-agent': ua, ...(init.headers ?? {}) } });
	const cookies = { get: () => undefined } as never;
	let pick: typeof import('../src/routes/import/+page.server');
	let one: typeof import('../src/routes/import/[id]/+page.server');
	let uploadRoute: typeof import('../src/routes/import/upload/+server');
	let tv: typeof import('$lib/server/import/tv');
	let id = -1;
	beforeAll(async () => {
		pick = await import('../src/routes/import/+page.server');
		one = await import('../src/routes/import/[id]/+page.server');
		uploadRoute = await import('../src/routes/import/upload/+server');
		tv = await import('$lib/server/import/tv');
		const r = (await import('$lib/server/import/backup')).receiveChunk(
			{
				token: null,
				name: 'app.mihon_2026-11-09_01-00.tachibk',
				size: 0,
				offset: 0,
				origin: 'desktop'
			},
			new Uint8Array()
		);
		// An empty file is refused, but kept as a row: a page the TV could ask for.
		id = r.state === 'more' ? -1 : (r.id ?? -1);
		expect(id).toBeGreaterThan(0);
	});

	it('the TV’s user agent is told apart from the phone app’s', () => {
		expect(tv.fromTv(req(TV))).toBe(true);
		expect(tv.fromTv(req(PHONE))).toBe(false);
		expect(tv.fromTv(req(BROWSER))).toBe(false);
		expect(tv.fromTv(new Request('http://localhost/import'))).toBe(false);
	});

	it('/import’s load draws the refusal on a TV, and the pick screen elsewhere', async () => {
		const at = async (ua: string) =>
			(await pick.load({ request: req(ua) } as never)) as { tv: string | null };
		expect((await at(TV)).tv).toBe(
			'THE TV NEVER IMPORTS · CHOOSE THE FILE ON THE COMPUTER OR A PHONE · NOTHING CHANGED'
		);
		expect((await at(PHONE)).tv).toBeNull();
		expect((await at(BROWSER)).tv).toBeNull();
	});

	it('/import/<id>’s load refuses a TV before it reads the row; the phone reads it', async () => {
		const at = async (ua: string) =>
			(await one.load({
				params: { id: String(id) },
				cookies,
				request: req(ua, `http://localhost/import/${id}`)
			} as never)) as { view: string; reason?: string };
		expect(await at(TV)).toEqual({ view: 'tv', reason: tv.TV_REFUSAL });
		expect((await at(PHONE)).view).toBe('refused');
		expect((await at(BROWSER)).view).toBe('refused');
		// Even for an import that does not exist: nothing is read for a TV.
		expect(
			await one.load({
				params: { id: '999999' },
				cookies,
				request: req(TV, 'http://localhost/import/999999')
			} as never)
		).toEqual({ view: 'tv', reason: tv.TV_REFUSAL });
	});

	it('the upload refuses a TV’s first piece with the sentence, keeping nothing', async () => {
		const rows = () => (db().prepare(`SELECT COUNT(*) AS n FROM imports`).get() as { n: number }).n;
		const files = () => readdirSync(area).length;
		const before = { rows: rows(), files: files() };
		const bytes = gz(backup());
		const post = (ua: string) =>
			uploadRoute.POST({
				request: req(
					ua,
					`http://localhost/import/upload?name=x.tachibk&size=${bytes.length}&offset=0`,
					{ method: 'POST', body: bytes }
				),
				url: new URL(`http://localhost/import/upload?name=x.tachibk&size=${bytes.length}&offset=0`)
			} as never);
		const refused = await post(TV);
		expect(refused.status).toBe(403);
		expect(await refused.json()).toEqual({ state: 'refused', id: null, reason: tv.TV_REFUSAL });
		expect({ rows: rows(), files: files() }).toEqual(before);
		// The phone app uploads as any browser does.
		const phone = await post(PHONE);
		expect(phone.status).toBe(200);
		const a = (await phone.json()) as { state: string; id: number };
		expect(a.state).toBe('read');
		expect(rows()).toBe(before.rows + 1);
	});

	it('IMPORT refuses a TV, and starts nothing', async () => {
		const r = upload(gz(backup()), 'app.mihon_2026-11-09_02-00.tachibk');
		const read = r.state === 'read' ? r.id : -1;
		const form = () => {
			const f = new FormData();
			return new Request(`http://localhost/import/${read}?/import`, {
				method: 'POST',
				body: f,
				headers: { 'user-agent': TV }
			});
		};
		const answer = await one.actions.import({
			params: { id: String(read) },
			request: form()
		} as never);
		expect(answer).toMatchObject({ status: 403, data: { message: tv.TV_REFUSAL } });
		expect(b.importRow(read)!.state).toBe('read');
	});
});

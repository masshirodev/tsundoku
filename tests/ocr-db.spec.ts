import { chmodSync, existsSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';

// Before anything imports db.ts: getDb() reads this once and memoises.
process.env.DATABASE_PATH = ':memory:';
const work = mkdtempSync(join(tmpdir(), 'tsundoku-ocr-'));
process.env.OCR_SCRATCH = join(work, 'scratch');
// The folder is this file's alone, wherever TMPDIR puts it, and it goes with the file.
afterAll(() => rmSync(work, { recursive: true, force: true }));

/**
 * A stand-in for mokuro: for each chapter folder under --parent_dir it writes
 * `<folder>.mokuro` with one block per page, as mokuro 0.2 does. With FAIL
 * set it fails, as a crashed run would.
 *
 * It is CommonJS, so it is named `.cjs` (c321): a file with no extension takes
 * its module type from the nearest package.json, and when TMPDIR is inside the
 * worktree (the waves keep it at `temp/`) that is the repo's `"type": "module"`,
 * where `require` is undefined. The fake then crashed on every batch, and three
 * cases failed as if the OCR run were wrong.
 */
const fake = join(work, 'mokuro.cjs');
writeFileSync(
	fake,
	`#!/usr/bin/env node
const fs = require('node:fs'), path = require('node:path');
if (process.env.FAKE_MOKURO_FAIL) process.exit(1);
const parent = process.argv[process.argv.indexOf('--parent_dir') + 1];
for (const d of fs.readdirSync(parent, { withFileTypes: true })) {
	if (!d.isDirectory()) continue;
	const pages = fs.readdirSync(path.join(parent, d.name)).sort().map((f) => ({
		img_path: f, img_width: 800, img_height: 1136,
		blocks: [{ box: [80, 114, 240, 454], vertical: true, font_size: 20, lines: ['テスト'] }]
	}));
	fs.writeFileSync(path.join(parent, d.name + '.mokuro'), JSON.stringify({ version: '0.2.5', pages }));
}
`
);
chmodSync(fake, 0o755);
process.env.MOKURO_BIN = fake;

const { getDb } = await import('$lib/server/db');
const { seedSample } = await import('$lib/server/fixtures');
const ocr = await import('$lib/server/japanese/ocr');

const db = getDb();
seedSample(db, Date.UTC(2026, 8, 24));
const seriesOf = (title: string) =>
	(db.prepare(`SELECT id FROM series WHERE title = ?`).get(title) as { id: number }).id;
const chainsaw = seriesOf('Chainsaw Man');

describe('OCR on the workstation', () => {
	it('waits for nothing until a series is Japanese', () => {
		expect(ocr.ocrQueue(50).filter((j) => j.seriesId === chainsaw)).toEqual([]);
		expect(ocr.ocrStatus(chainsaw)).toMatchObject({ japanese: false, done: 0 });
	});

	it('queues a Japanese series, by its language tag or by hand', () => {
		db.prepare(
			`INSERT OR IGNORE INTO tags (namespace, value) VALUES ('language', 'japanese')`
		).run();
		const tag = (
			db
				.prepare(`SELECT id FROM tags WHERE namespace = 'language' AND value = 'japanese'`)
				.get() as {
				id: number;
			}
		).id;
		db.prepare(`INSERT OR IGNORE INTO series_tags (series_id, tag_id) VALUES (?, ?)`).run(
			chainsaw,
			tag
		);
		expect(ocr.ocrStatus(chainsaw).japanese).toBe(true);
		expect(ocr.ocrQueue(500).some((j) => j.seriesId === chainsaw)).toBe(true);
		// Off by hand wins over the tag.
		ocr.setSeriesOcr(chainsaw, false);
		expect(ocr.ocrQueue(500).some((j) => j.seriesId === chainsaw)).toBe(false);
		ocr.setSeriesOcr(chainsaw, true);
	});

	it('reads a batch with one run, stores every page, and cleans the scratch', async () => {
		// Only this series, so the batch is its first two chapters.
		db.prepare(`UPDATE series SET ocr = 0 WHERE id != ?`).run(chainsaw);
		const jobs = ocr.ocrQueue(2);
		expect(jobs.every((j) => j.seriesId === chainsaw)).toBe(true);
		const r = await ocr.runOcrBatch({ limit: 2 });
		expect(r.failed).toBe(0);
		expect(r.chapters).toBe(2);
		const [first] = jobs;
		const pages = ocr.pageText(first.entryId, false)!;
		expect(pages.length).toBeGreaterThan(10);
		expect(pages.every((p) => p !== null && p.length === 1)).toBe(true);
		expect(pages[0]![0]).toEqual({
			box: [0.1, 0.1004, 0.2, 0.2993],
			vertical: true,
			lines: ['テスト']
		});
		expect(readdirSync(join(work, 'scratch')).filter((f) => f.startsWith('batch-'))).toEqual([]);
		expect(existsSync(join(work, 'scratch', '_ocr'))).toBe(false);
		expect(ocr.ocrStatus(chainsaw).done).toBe(2);
		expect(ocr.ocrQueue(500).some((j) => j.entryId === first.entryId)).toBe(false);
		// A real batch through the fake mokuro: about 4 s alone, so the default
		// 5 s failed it whenever the workstation was busy (2026-09-27, load 59),
		// and the tests after it, which read what it stored, failed with it.
	}, 30_000);

	it('marks a failed run, and tries it again only after a week', async () => {
		process.env.FAKE_MOKURO_FAIL = '1';
		const now = Date.UTC(2026, 8, 24);
		const r = await ocr.runOcrBatch({ limit: 1, now });
		delete process.env.FAKE_MOKURO_FAIL;
		expect(r).toMatchObject({ chapters: 0, failed: 1 });
		const [failed] = db.prepare(`SELECT id FROM entries WHERE ocr_failed_at = ?`).all(now) as {
			id: number;
		}[];
		expect(ocr.ocrQueue(500, now + 3600_000).some((j) => j.entryId === failed.id)).toBe(false);
		expect(ocr.ocrQueue(500, now + 8 * 24 * 3600_000).some((j) => j.entryId === failed.id)).toBe(
			true
		);
	});

	it('places a series in the queue, with its next chapter and those that failed', () => {
		const now = Date.UTC(2026, 8, 24) + 3600_000;
		const p = ocr.ocrPlace(chainsaw, now);
		expect(p).toMatchObject({ japanese: true, done: 2, ahead: 0, failed: 1, running: false });
		expect(p.next).toMatch(/^CH\. /);
		// A series first in line reads as running only while a run holds the lock.
		writeFileSync(join(work, 'scratch', 'ocr.lock'), String(process.pid));
		expect(ocr.ocrPlace(chainsaw, now).running).toBe(true);
		// Not Japanese: nothing to place.
		ocr.setSeriesOcr(chainsaw, false);
		expect(ocr.ocrPlace(chainsaw, now)).toMatchObject({ japanese: false, ahead: null });
		ocr.setSeriesOcr(chainsaw, true);
	});

	it('keeps a block marked NOT TEXT, for UNDO, for RESTORE, and out of a second reading', () => {
		const [entry] = db
			.prepare(
				`SELECT entry_id AS id FROM page_text p JOIN entries e ON e.id = p.entry_id WHERE e.series_id = ? LIMIT 1`
			)
			.all(chainsaw) as { id: number }[];
		const before = ocr.pageText(entry.id, false)![0]!;
		const dropped = ocr.dropBlock(entry.id, 0, 0)!;
		expect(ocr.pageText(entry.id, false)![0]).toHaveLength(before.length - 1);
		expect(ocr.notTextCount(chainsaw)).toBe(1);

		// UNDO: back, and off the list.
		expect(ocr.restoreBlock(entry.id, 0, 0, dropped)).toBe(true);
		expect(ocr.pageText(entry.id, false)![0]).toEqual(before);
		expect(ocr.notTextCount(chainsaw)).toBe(0);

		// The band gone: read again, it stays out; RESTORE puts it back.
		ocr.dropBlock(entry.id, 0, 0);
		ocr.storeChapter(entry.id, [
			{
				img_path: '0000.jpg',
				img_width: 800,
				img_height: 1136,
				blocks: [{ box: [80, 114, 240, 454], vertical: true, lines: ['テスト'] }]
			}
		]);
		expect(ocr.pageText(entry.id, false)![0]).toEqual([]);
		expect(ocr.restoreNotText(chainsaw)).toBe(1);
		expect(ocr.pageText(entry.id, false)![0]).toEqual(before);
		expect(ocr.notTextCount(chainsaw)).toBe(0);
	});

	it('keeps a hidden series’ text hidden while reveal is off', () => {
		const hidden = (
			db
				.prepare(
					`SELECT e.id FROM entries e JOIN series s ON s.id = e.series_id JOIN roots r ON r.id = s.root_id WHERE r.hidden = 1 LIMIT 1`
				)
				.get() as { id: number }
		).id;
		expect(ocr.pageText(hidden, false)).toBeNull();
		expect(ocr.pageText(hidden, true)).not.toBeNull();
	});
});

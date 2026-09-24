import { execFile } from 'node:child_process';
import { existsSync } from 'node:fs';
import { mkdir, readdir, readFile, rm, writeFile } from 'node:fs/promises';
import type { ReadStream } from 'node:fs';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { getDb } from '../db.ts';
import { VISIBLE_SQL } from '../visibility.ts';
import { manifest, readPage } from '../pages/index.ts';
import {
	blocksOf,
	pageIndexOf,
	type MokuroPage,
	type OcrPlace,
	type TextBlock
} from '../../japanese/ocr.ts';

/**
 * OCR on the workstation (doc/JAPANESE.md): mokuro, on the GPU, reads a
 * Japanese chapter's pages into text blocks, one per speech bubble.
 *
 * - **Which series:** `series.ocr` 1 always, 0 never, NULL by language: tagged
 *   `language:japanese`, or downloaded from a Mihon source whose folder says
 *   "(JA)".
 * - **How:** a batch of chapters is written, page by page, into a scratch
 *   folder on the library disk -- never inside the synced folders, which are
 *   receive-only -- and mokuro reads the lot in one run, so its models load
 *   once. Each chapter's blocks are stored per page, and the scratch goes.
 * - **Order:** the series read most recently first, then its chapters in
 *   order. A chapter that fails waits a week before it's tried again.
 */

const run = promisify(execFile);

export function mokuroBin(): string {
	return process.env.MOKURO_BIN ?? '/mnt/hdd2/tsundoku/mokuro/venv/bin/mokuro';
}
export function scratchDir(): string {
	return process.env.OCR_SCRATCH ?? '/mnt/hdd2/tsundoku/ocr-scratch';
}

const RETRY_MS = 7 * 24 * 3600_000;

/** Whether series `s` is read with OCR (see above). */
export const JAPANESE_SQL = `(s.ocr = 1 OR (s.ocr IS NULL AND s.kind != 'novel' AND (
	s.path LIKE '%(JA)%'
	OR EXISTS (SELECT 1 FROM series_tags st JOIN tags t ON t.id = st.tag_id
		WHERE st.series_id = s.id AND t.namespace = 'language' AND t.value = 'japanese')
)))`;

export type OcrJob = { entryId: number; seriesId: number };

/** The chapters waiting to be read, most recently read series first. */
export function ocrQueue(limit: number, now = Date.now()): OcrJob[] {
	return getDb()
		.prepare(
			`SELECT e.id AS entryId, s.id AS seriesId FROM entries e JOIN series s ON s.id = e.series_id
			WHERE ${JAPANESE_SQL} AND s.kind != 'novel'
				AND e.available = 1 AND e.shadowed = 0 AND e.ocr_at IS NULL
				AND (e.ocr_failed_at IS NULL OR e.ocr_failed_at < ?)
			ORDER BY (SELECT MAX(x.last_opened_at) FROM entries x WHERE x.series_id = s.id) DESC NULLS LAST,
				s.id, e.position
			LIMIT ?`
		)
		.all(now - RETRY_MS, limit) as OcrJob[];
}

async function bytesOf(body: Buffer | ReadStream): Promise<Buffer> {
	if (Buffer.isBuffer(body)) return body;
	const chunks: Buffer[] = [];
	for await (const c of body) chunks.push(c as Buffer);
	return Buffer.concat(chunks);
}

const EXT: Record<string, string> = {
	'image/jpeg': 'jpg',
	'image/png': 'png',
	'image/webp': 'webp',
	'image/gif': 'gif'
};

/** Write a chapter's pages as `0000.jpg`, `0001.jpg`…: mokuro's input, named by page. */
async function extract(entryId: number, dir: string): Promise<number> {
	const m = await manifest(entryId, true);
	if (!m) return 0;
	await mkdir(dir, { recursive: true });
	let n = 0;
	for (let i = 0; i < m.pages.length; i++) {
		const page = await readPage(entryId, i, true);
		if (!page) continue;
		const ext = EXT[page.type] ?? 'jpg';
		await writeFile(join(dir, `${String(i).padStart(4, '0')}.${ext}`), await bytesOf(page.body));
		n += 1;
	}
	return n;
}

/** Store a chapter's pages from its `.mokuro` file, and mark it read. */
export function storeChapter(entryId: number, pages: MokuroPage[], now = Date.now()): number {
	const db = getDb();
	return db
		.transaction((): number => {
			const notText = new Map<number, TextBlock[]>();
			for (const r of db
				.prepare(`SELECT page, block FROM not_text WHERE entry_id = ?`)
				.all(entryId) as { page: number; block: string }[])
				notText.set(r.page, [...(notText.get(r.page) ?? []), JSON.parse(r.block) as TextBlock]);
			db.prepare(`DELETE FROM page_text WHERE entry_id = ?`).run(entryId);
			const put = db.prepare(`INSERT INTO page_text (entry_id, page, blocks) VALUES (?, ?, ?)`);
			let blocks = 0;
			for (const p of pages) {
				const i = pageIndexOf(p.img_path);
				if (i === null) continue;
				// Read again, a block marked NOT TEXT stays out.
				const b = blocksOf(p).filter((x) => !(notText.get(i) ?? []).some((d) => sameBox(d, x)));
				put.run(entryId, i, JSON.stringify(b));
				blocks += b.length;
			}
			db.prepare(`UPDATE entries SET ocr_at = ?, ocr_failed_at = NULL WHERE id = ?`).run(
				now,
				entryId
			);
			return blocks;
		})
		.immediate();
}

export type BatchResult = { chapters: number; blocks: number; failed: number };

/**
 * Read a batch of waiting chapters with one mokuro run. `log` hears what
 * happens; nothing here prints page text.
 */
export async function runOcrBatch(
	o: { limit?: number; now?: number; log?: (line: string) => void } = {}
): Promise<BatchResult> {
	const log = o.log ?? (() => {});
	const jobs = ocrQueue(o.limit ?? 10, o.now);
	const result: BatchResult = { chapters: 0, blocks: 0, failed: 0 };
	if (jobs.length === 0) return result;
	const batch = join(scratchDir(), `batch-${Date.now()}`);
	const db = getDb();
	const fail = db.prepare(`UPDATE entries SET ocr_failed_at = ? WHERE id = ?`);
	try {
		const ready: number[] = [];
		for (const j of jobs) {
			const n = await extract(j.entryId, join(batch, String(j.entryId)));
			if (n > 0) ready.push(j.entryId);
			else fail.run(o.now ?? Date.now(), j.entryId);
		}
		log(`ocr: ${ready.length} chapters, ${jobs.length - ready.length} without pages`);
		if (ready.length === 0) return { ...result, failed: jobs.length };
		// 0.2.5 takes no --disable_html (its README says otherwise, and the run
		// then exits 2): the HTML it writes goes with the batch folder.
		await run(mokuroBin(), ['--parent_dir', batch, '--disable_confirmation=true'], {
			cwd: scratchDir(),
			maxBuffer: 64 * 1024 * 1024,
			timeout: 3 * 3600_000,
			// Its models are cached after the first run; a batch never waits on the network.
			env: { ...process.env, HF_HUB_OFFLINE: '1' }
		});
		const outputs = new Set(await readdir(batch));
		for (const id of ready) {
			const file = `${id}.mokuro`;
			if (!outputs.has(file)) {
				fail.run(o.now ?? Date.now(), id);
				result.failed += 1;
				continue;
			}
			const parsed = JSON.parse(await readFile(join(batch, file), 'utf8')) as {
				pages: MokuroPage[];
			};
			result.blocks += storeChapter(id, parsed.pages, o.now);
			result.chapters += 1;
		}
		result.failed += jobs.length - ready.length;
		return result;
	} catch (e) {
		// mokuro itself failed: the batch is tried again in a week, one by one.
		for (const j of jobs) fail.run(o.now ?? Date.now(), j.entryId);
		log(`ocr: mokuro failed: ${(e as Error).message.split('\n')[0]}`);
		return { ...result, failed: jobs.length };
	} finally {
		await rm(batch, { recursive: true, force: true });
		// mokuro keeps a cache of what it read beside the folder it's given.
		await rm(join(scratchDir(), '_ocr'), { recursive: true, force: true });
	}
}

/** A chapter's text blocks by page (null for a page not read), or null if it can't be seen. */
export function pageText(entryId: number, reveal: boolean): (TextBlock[] | null)[] | null {
	const db = getDb();
	const e = db
		.prepare(
			`SELECT e.page_count FROM entries e JOIN series s ON s.id = e.series_id JOIN roots r ON r.id = s.root_id
			WHERE e.id = ? AND (? OR ${VISIBLE_SQL})`
		)
		.get(entryId, reveal ? 1 : 0) as { page_count: number } | undefined;
	if (!e) return null;
	const rows = db.prepare(`SELECT page, blocks FROM page_text WHERE entry_id = ?`).all(entryId) as {
		page: number;
		blocks: string;
	}[];
	const out: (TextBlock[] | null)[] = Array.from({ length: e.page_count }, () => null);
	for (const r of rows) if (r.page < out.length) out[r.page] = JSON.parse(r.blocks) as TextBlock[];
	return out;
}

export type OcrStatus = { japanese: boolean; done: number; total: number };
export type { OcrPlace } from '../../japanese/ocr.ts';

/** How far a series' OCR has got: its downloaded chapters, and those read. */
export function ocrStatus(seriesId: number): OcrStatus {
	const db = getDb();
	const s = db
		.prepare(`SELECT ${JAPANESE_SQL} AS japanese FROM series s WHERE s.id = ?`)
		.get(seriesId) as { japanese: number } | undefined;
	const c = db
		.prepare(
			`SELECT COUNT(*) AS total, SUM(ocr_at IS NOT NULL) AS done FROM entries
			WHERE series_id = ? AND available = 1 AND shadowed = 0`
		)
		.get(seriesId) as { total: number; done: number | null };
	return { japanese: !!s?.japanese, done: c.done ?? 0, total: c.total };
}

/** Where a series stands on the workstation: the series screen's OCR row. */
export function ocrPlace(seriesId: number, now = Date.now()): OcrPlace {
	const status = ocrStatus(seriesId);
	const none = {
		...status,
		ahead: null,
		next: null,
		failed: 0,
		running: false,
		notText: notTextCount(seriesId)
	};
	if (!status.japanese) return none;
	const db = getDb();
	const queue = ocrQueue(1_000_000, now);
	const order = [...new Set(queue.map((j) => j.seriesId))];
	const at = order.indexOf(seriesId);
	const first = queue.find((j) => j.seriesId === seriesId);
	const next = first
		? ((
				db.prepare(`SELECT label FROM entries WHERE id = ?`).get(first.entryId) as
					{ label: string } | undefined
			)?.label.toUpperCase() ?? null)
		: null;
	const failed = (
		db
			.prepare(
				`SELECT COUNT(*) AS n FROM entries WHERE series_id = ? AND available = 1 AND shadowed = 0
				AND ocr_at IS NULL AND ocr_failed_at >= ?`
			)
			.get(seriesId, now - RETRY_MS) as { n: number }
	).n;
	return {
		...status,
		ahead: at < 0 ? null : at,
		next,
		failed,
		// scripts/ocr.ts holds this while a run is on the GPU.
		running: at === 0 && existsSync(join(scratchDir(), 'ocr.lock')),
		notText: notTextCount(seriesId)
	};
}

/** OCR on for a series (it's Japanese the workstation didn't see), off, or back to by language. */
export function setSeriesOcr(seriesId: number, on: boolean | null): void {
	getDb()
		.prepare(`UPDATE series SET ocr = ? WHERE id = ?`)
		.run(on === null ? null : on ? 1 : 0, seriesId);
}

/**
 * NOT TEXT (doc/JAPANESE.md): a block OCR got wrong is taken out of its page,
 * and kept aside (`not_text`) so it can be restored. Returns the block, so
 * UNDO can put it back where it was.
 */
export function dropBlock(
	entryId: number,
	page: number,
	index: number,
	now = Date.now()
): TextBlock | null {
	const db = getDb();
	return db
		.transaction((): TextBlock | null => {
			const row = db
				.prepare(`SELECT blocks FROM page_text WHERE entry_id = ? AND page = ?`)
				.get(entryId, page) as { blocks: string } | undefined;
			if (!row) return null;
			const blocks = JSON.parse(row.blocks) as TextBlock[];
			const [dropped] = blocks.splice(index, 1);
			if (!dropped) return null;
			db.prepare(`UPDATE page_text SET blocks = ? WHERE entry_id = ? AND page = ?`).run(
				JSON.stringify(blocks),
				entryId,
				page
			);
			db.prepare(
				`INSERT INTO not_text (entry_id, page, idx, block, at) VALUES (?, ?, ?, ?, ?)`
			).run(entryId, page, index, JSON.stringify(dropped), now);
			return dropped;
		})
		.immediate();
}

const sameBox = (a: TextBlock, b: TextBlock) => a.box.every((n, i) => n === b.box[i]);

/** Put a block back at its place on its page, and off the NOT TEXT list. */
function putBack(entryId: number, page: number, index: number, block: TextBlock): boolean {
	const db = getDb();
	const row = db
		.prepare(`SELECT blocks FROM page_text WHERE entry_id = ? AND page = ?`)
		.get(entryId, page) as { blocks: string } | undefined;
	if (!row) return false;
	const blocks = JSON.parse(row.blocks) as TextBlock[];
	if (!blocks.some((b) => sameBox(b, block)))
		blocks.splice(Math.min(Math.max(0, index), blocks.length), 0, block);
	db.prepare(`UPDATE page_text SET blocks = ? WHERE entry_id = ? AND page = ?`).run(
		JSON.stringify(blocks),
		entryId,
		page
	);
	for (const r of db
		.prepare(`SELECT id, block FROM not_text WHERE entry_id = ? AND page = ?`)
		.all(entryId, page) as { id: number; block: string }[])
		if (sameBox(JSON.parse(r.block) as TextBlock, block))
			db.prepare(`DELETE FROM not_text WHERE id = ?`).run(r.id);
	return true;
}

/** UNDO after NOT TEXT: the block back at its place. */
export function restoreBlock(
	entryId: number,
	page: number,
	index: number,
	block: TextBlock
): boolean {
	const db = getDb();
	return db.transaction(() => putBack(entryId, page, index, block)).immediate();
}

/** How many of a series' blocks are marked NOT TEXT: the series screen's RESTORE. */
export function notTextCount(seriesId: number): number {
	return (
		getDb()
			.prepare(
				`SELECT COUNT(*) AS n FROM not_text t JOIN entries e ON e.id = t.entry_id WHERE e.series_id = ?`
			)
			.get(seriesId) as { n: number }
	).n;
}

/** RESTORE: every block of a series marked NOT TEXT, back where it was. */
export function restoreNotText(seriesId: number): number {
	const db = getDb();
	return db
		.transaction((): number => {
			const rows = db
				.prepare(
					`SELECT t.entry_id, t.page, t.idx, t.block FROM not_text t JOIN entries e ON e.id = t.entry_id
					WHERE e.series_id = ? ORDER BY t.entry_id, t.page, t.idx`
				)
				.all(seriesId) as { entry_id: number; page: number; idx: number; block: string }[];
			let n = 0;
			for (const r of rows)
				if (putBack(r.entry_id, r.page, r.idx, JSON.parse(r.block) as TextBlock)) n += 1;
			// A page read again since has no place for it: nothing to keep it for.
			db.prepare(
				`DELETE FROM not_text WHERE entry_id IN (SELECT id FROM entries WHERE series_id = ?)`
			).run(seriesId);
			return n;
		})
		.immediate();
}

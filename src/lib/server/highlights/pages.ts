import type Database from 'better-sqlite3';
import { mkdirSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { randomBytes } from 'node:crypto';
import { getDb } from '../db.ts';
import { highlightsArea } from '../data-dirs.ts';
import { join } from '../fspath.ts';
import { readPage, type PageBody } from '../pages/index.ts';
import { HIDDEN_SQL, VISIBLE_SQL } from '../visibility.ts';

/**
 * Highlights H3: a page kept from the image reader (card c703; doc/HIGHLIGHTS.md,
 * "Pages"). The copy is `highlights/pages/<id>.webp` at the page's own size,
 * made from the downloaded file or fetched once from the source for a page
 * read online: `readPage`, the reader's own door to a page's bytes, does
 * both. A spread kept as BOTH is one image, the two pages as they are drawn.
 *
 * The rules this keeps:
 *
 * - **No row without its copy.** The copy is made first, under a name of its
 *   own, and the row goes in with it in one transaction; the reader's cell
 *   says HIGHLIGHTED only once the answer arrives, so it never says so of a
 *   page whose fetch failed or is still coming.
 * - **One highlight per page.** The same page asked for again (a retry after
 *   a late answer, a second press, a second device) gets the one already
 *   kept: the asks still being made are shared by key, and the insert checks
 *   again inside its transaction, so two that slip past each other end as one
 *   row and one copy.
 * - **A page's kind is `page`**, never the series' kind: what the series is
 *   called comes from the snapshot's `series_kind` and the registry.
 * - **Hidden is copied from the series and kept** (Main 02), and a hidden
 *   series' page is not found without reveal, as the reader itself is not.
 * - **Incognito makes none** (Main 02): the caller refuses before this runs.
 */

export type KeptPage = {
	id: number;
	page: number;
	pageEnd: number | null;
	note: string;
	madeAt: number;
	bytes: number;
};

export class KeepError extends Error {
	constructor(
		message: string,
		/** What the reader's band says: the page is not there, or its source did not send it. */
		readonly why: 'not_found' | 'source' | 'not_an_image'
	) {
		super(message);
	}
}

type EntrySnap = {
	entry_id: number;
	series_id: number;
	label: string;
	title: string;
	volume: string;
	number: number;
	season: number | null;
	series_title: string;
	series_kind: string;
	origin_key: string | null;
	hidden: number;
};

function snapshot(entryId: number, reveal: boolean, db: Database.Database): EntrySnap | null {
	return (
		(db
			.prepare(
				`SELECT e.id AS entry_id, s.id AS series_id, e.label, COALESCE(e.title, '') AS title,
					COALESCE(e.volume, '') AS volume, COALESCE(e.episode_number, e.position) AS number,
					e.season, s.title AS series_title, s.kind AS series_kind, s.origin_key,
					CASE WHEN ${HIDDEN_SQL} THEN 1 ELSE 0 END AS hidden
				FROM entries e JOIN series s ON s.id = e.series_id JOIN roots r ON r.id = s.root_id
				WHERE e.id = ? ${reveal ? '' : `AND ${VISIBLE_SQL}`}`
			)
			.get(entryId) as EntrySnap | undefined) ?? null
	);
}

/** The pages of an entry kept already, for the reader's cell, the scrubber's ticks and the gutter rule. */
export function pageHighlights(
	entryId: number,
	reveal: boolean,
	db: Database.Database = getDb()
): KeptPage[] {
	return (
		db
			.prepare(
				`SELECT h.id, h.page, h.page_end, h.note, h.made_at, h.copy_bytes FROM highlights h
				WHERE h.kind = 'page' AND h.entry_id = ? AND h.deleted_at IS NULL
					${reveal ? '' : 'AND h.hidden = 0'}
				ORDER BY h.page, h.id`
			)
			.all(entryId) as {
			id: number;
			page: number;
			page_end: number | null;
			note: string;
			made_at: number;
			copy_bytes: number;
		}[]
	).map((r) => ({
		id: r.id,
		page: r.page,
		pageEnd: r.page_end,
		note: r.note,
		madeAt: r.made_at,
		bytes: r.copy_bytes
	}));
}

function existing(
	db: Database.Database,
	entryId: number,
	page: number,
	pageEnd: number | null
): number | null {
	const r = db
		.prepare(
			`SELECT id FROM highlights WHERE kind = 'page' AND entry_id = ? AND page = ?
				AND page_end IS ? AND deleted_at IS NULL ORDER BY id LIMIT 1`
		)
		.get(entryId, page, pageEnd) as { id: number } | undefined;
	return r?.id ?? null;
}

function keptById(db: Database.Database, id: number): KeptPage {
	const r = db
		.prepare(`SELECT id, page, page_end, note, made_at, copy_bytes FROM highlights WHERE id = ?`)
		.get(id) as {
		id: number;
		page: number;
		page_end: number | null;
		note: string;
		made_at: number;
		copy_bytes: number;
	};
	return {
		id: r.id,
		page: r.page,
		pageEnd: r.page_end,
		note: r.note,
		madeAt: r.made_at,
		bytes: r.copy_bytes
	};
}

async function bytesOf(p: PageBody): Promise<Buffer> {
	if (Buffer.isBuffer(p.body)) return p.body;
	const chunks: Buffer[] = [];
	for await (const c of p.body) chunks.push(Buffer.isBuffer(c) ? c : Buffer.from(c as Uint8Array));
	return Buffer.concat(chunks);
}

const sharpOf = async () => (await import('sharp')).default;

/**
 * The copy, as WebP at the page's own size. A spread is the two pages side
 * by side as the reader draws them (R→L: the later page on the left), the
 * shorter scaled to the taller's height, so a double page stays one picture.
 */
export async function pageCopy(
	images: Buffer[],
	rtl: boolean
): Promise<{ webp: Buffer; width: number; height: number }> {
	const sharp = await sharpOf();
	if (images.length === 1) {
		const { data, info } = await sharp(images[0])
			.rotate()
			.webp({ quality: 90 })
			.toBuffer({ resolveWithObject: true });
		return { webp: data, width: info.width, height: info.height };
	}
	const drawn = rtl ? [...images].reverse() : images;
	const upright = await Promise.all(
		drawn.map((b) => sharp(b).rotate().png().toBuffer({ resolveWithObject: true }))
	);
	const height = Math.max(...upright.map((u) => u.info.height));
	const scaled = await Promise.all(
		upright.map((u) =>
			u.info.height === height
				? Promise.resolve(u)
				: sharp(u.data).resize({ height }).png().toBuffer({ resolveWithObject: true })
		)
	);
	const width = scaled.reduce((w, s) => w + s.info.width, 0);
	let left = 0;
	const composite = scaled.map((s) => {
		const at = { input: s.data, left, top: 0 };
		left += s.info.width;
		return at;
	});
	const { data, info } = await sharp({
		create: { width, height, channels: 3, background: { r: 0, g: 0, b: 0 } }
	})
		.composite(composite)
		.webp({ quality: 90 })
		.toBuffer({ resolveWithObject: true });
	return { webp: data, width: info.width, height: info.height };
}

/** The asks still being made, by page: a second ask for the same page waits on the first. */
const making = new Map<string, Promise<KeptPage>>();

export type KeepAsk = {
	entryId: number;
	/** 0-based; for BOTH the first page in reading order. */
	page: number;
	/** BOTH: the spread's other page; null for one page. */
	pageEnd?: number | null;
	/** How a spread is drawn: R→L puts the later page on the left. */
	rtl?: boolean;
};

/** Where the bytes come from; the reader's own door unless a test hands in a stand-in. */
export type PageReader = (
	entryId: number,
	index: number,
	reveal: boolean
) => Promise<PageBody | null>;

/**
 * HIGHLIGHT: keep the page. Answers the highlight, made now or kept before
 * (`made: false`). Throws KeepError when the entry is not there for this
 * viewer, a page is not there, or the source did not send it: nothing is
 * stored then, so asking again starts clean.
 */
export async function keepPage(
	ask: KeepAsk,
	reveal: boolean,
	opts: { db?: Database.Database; read?: PageReader; now?: () => number } = {}
): Promise<{ highlight: KeptPage; made: boolean }> {
	const db = opts.db ?? getDb();
	const pageEnd = ask.pageEnd ?? null;
	if (!Number.isInteger(ask.page) || ask.page < 0) throw new KeepError('no such page', 'not_found');
	if (pageEnd !== null && (!Number.isInteger(pageEnd) || pageEnd < 0 || pageEnd === ask.page))
		throw new KeepError('no such page', 'not_found');
	const snap = snapshot(ask.entryId, reveal, db);
	if (!snap) throw new KeepError('no such entry', 'not_found');
	const before = existing(db, ask.entryId, ask.page, pageEnd);
	if (before !== null) return { highlight: keptById(db, before), made: false };

	const key = `${ask.entryId}:${ask.page}:${pageEnd ?? ''}`;
	const inFlight = making.get(key);
	if (inFlight) return { highlight: await inFlight, made: false };
	let made = false;
	const job = (async () => {
		const read = opts.read ?? readPage;
		const indexes = pageEnd === null ? [ask.page] : [ask.page, pageEnd];
		const images: Buffer[] = [];
		for (const i of indexes) {
			let p: PageBody | null;
			try {
				p = await read(ask.entryId, i, reveal);
			} catch (e) {
				throw new KeepError((e as Error).message || 'the source did not send this page', 'source');
			}
			if (!p) throw new KeepError('no such page', 'not_found');
			images.push(await bytesOf(p));
		}
		let copy: Awaited<ReturnType<typeof pageCopy>>;
		try {
			copy = await pageCopy(images, ask.rtl ?? false);
		} catch (e) {
			if (e instanceof KeepError) throw e;
			throw new KeepError('the page is not an image', 'not_an_image');
		}
		const area = highlightsArea();
		mkdirSync(area.pages, { recursive: true });
		const scratch = join(area.pages, `.keeping-${randomBytes(6).toString('hex')}.webp`);
		writeFileSync(scratch, copy.webp);
		try {
			const id = db
				.transaction(() => {
					// A same page kept while this one was being made (another process, a
					// stand-in's race): the one already there stands.
					const already = existing(db, ask.entryId, ask.page, pageEnd);
					if (already !== null) return already;
					const id = Number(
						db
							.prepare(
								`INSERT INTO highlights (kind, series_id, entry_id, origin_key, number, season, page,
									page_end, series_title, series_kind, entry_label, entry_title, volume, made_at, hidden,
									copy_bytes, copy_width, copy_height, quality)
								VALUES ('page', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'webp 90')`
							)
							.run(
								snap.series_id,
								snap.entry_id,
								snap.origin_key,
								snap.number,
								snap.season,
								ask.page,
								pageEnd,
								snap.series_title,
								snap.series_kind,
								snap.label,
								snap.title,
								snap.volume,
								(opts.now ?? Date.now)(),
								snap.hidden,
								copy.webp.length,
								copy.width,
								copy.height
							).lastInsertRowid
					);
					const relative = `pages/${id}.webp`;
					renameSync(scratch, join(area.root, relative));
					db.prepare(`UPDATE highlights SET copy_path = ? WHERE id = ?`).run(relative, id);
					made = true;
					return id;
				})
				.immediate();
			return keptById(db, id);
		} finally {
			// Renamed when it was kept; litter otherwise (a same page that won, a failure).
			rmSync(scratch, { force: true });
		}
	})();
	making.set(key, job);
	try {
		const highlight = await job;
		return { highlight, made };
	} finally {
		making.delete(key);
	}
}

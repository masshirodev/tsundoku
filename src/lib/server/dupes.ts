import sharp from 'sharp';
import type { ReadStream } from 'node:fs';
import { getDb } from './db.ts';
import { VISIBLE_SQL } from './visibility.ts';
import { manifest, readPage } from './pages/index.ts';
import { readPageThumb } from './covers.ts';
// Deleting and grouping are loaded only to carry a decision out: finding runs
// from a plain node script (scripts/dupes.ts), and they bring the app's
// Vite-only imports with them.
const deleting = () => import('./delete.ts');
const grouping = () => import('./books.ts');
import { sharedStart } from '../library/books.ts';
import { langCode, partOfBigger } from '../library/editions.ts';
import {
	candidatePairs,
	confidence,
	kindOf,
	matchPages,
	pairKey,
	sameBook,
	pick,
	type Confidence,
	type Copy,
	type PageRow,
	type PairKind,
	type Pick
} from '../library/dupes.ts';

/**
 * Duplicate books on the workstation (doc/DUPLICATE-BOOKS.md).
 *
 * - **Finding:** books whose Hentoid cover hashes are close become candidate
 *   pairs; each book in one gets its pages hashed here (Hentoid hashes covers
 *   only), and the pair's pages are lined up. `findDuplicates` does it after
 *   an import, and `yarn run dupes` by hand.
 * - **Deciding:** the review settles a pair at a time. A decision waits until
 *   the next one (or leaving the review), so UNDO only has to forget it;
 *   applying it is what deletes, groups or carries over.
 */

type Row = {
	id: number;
	series_id: number;
	etitle: string;
	stitle: string;
	page_count: number;
	added_at: number;
	read_at: number | null;
	last_position: number | null;
	erating: number;
	efav: number;
	srating: number;
	sfav: number;
	hidden: number;
	books: number;
	position: number;
};

const TAG = (ns: string) => `COALESCE(
	(SELECT t.value FROM entry_tags et JOIN tags t ON t.id = et.tag_id
		WHERE et.entry_id = e.id AND t.namespace = '${ns}' AND t.value NOT IN ('translated', 'rewrite') LIMIT 1),
	(SELECT t.value FROM series_tags st JOIN tags t ON t.id = st.tag_id
		WHERE st.series_id = s.id AND t.namespace = '${ns}' AND t.value NOT IN ('translated', 'rewrite') LIMIT 1),
	'')`;

/** Everything the review shows of one book, from the database. `size` comes from the pair. */
function copyOf(entryId: number, size: [number, number] = [0, 0]): Copy | null {
	const db = getDb();
	const r = db
		.prepare(
			`SELECT e.id, e.series_id, e.title AS etitle, s.title AS stitle, e.page_count, e.added_at,
				e.read_at, e.last_position, e.rating AS erating, e.favourite AS efav,
				s.rating AS srating, s.favourite AS sfav, NOT ${VISIBLE_SQL} AS hidden, e.position,
				(SELECT COUNT(*) FROM entries x WHERE x.series_id = s.id AND x.shadowed = 0) AS books,
				COALESCE(e.language, ${TAG('language')}) AS language, ${TAG('source')} AS site
			FROM entries e JOIN series s ON s.id = e.series_id JOIN roots r ON r.id = s.root_id
			WHERE e.id = ?`
		)
		.get(entryId) as (Row & { language: string; site: string }) | undefined;
	if (!r) return null;
	const single = r.books <= 1;
	const shelves = (
		db
			.prepare(
				`SELECT c.name FROM collection_series cs JOIN collections c ON c.id = cs.collection_id
				WHERE cs.series_id = ? ORDER BY c.position, c.name`
			)
			.all(r.series_id) as { name: string }[]
	).map((x) => x.name);
	return {
		entryId: r.id,
		seriesId: r.series_id,
		title: single ? r.stitle : r.etitle || r.stitle,
		site: r.site,
		language: r.language.toLowerCase(),
		pages: r.page_count,
		width: size[0],
		height: size[1],
		addedAt: r.added_at,
		rating: single ? r.srating : r.erating,
		favourite: !!(single ? r.sfav : r.efav),
		read: r.read_at !== null ? 'read' : r.last_position !== null ? r.last_position + 1 : null,
		shelves,
		series: single ? null : { id: r.series_id, title: r.stitle, position: r.position },
		hidden: !!r.hidden
	};
}

// ---- finding ----------------------------------------------------------------------------

async function bytesOf(body: Buffer | ReadStream): Promise<Buffer> {
	if (Buffer.isBuffer(body)) return body;
	const chunks: Buffer[] = [];
	for await (const c of body) chunks.push(c as Buffer);
	return Buffer.concat(chunks);
}

/**
 * A 64-bit difference hash of an image: its 9×8 grey thumbnail, a bit per
 * pair of neighbours (left brighter than right). Scans of one page, resized
 * or re-encoded, land a few bits apart.
 */
export async function imageHash(image: Buffer): Promise<string | null> {
	try {
		const px = await sharp(image, { failOn: 'none' })
			.grayscale()
			.resize(9, 8, { fit: 'fill' })
			.raw()
			.toBuffer();
		let hi = 0;
		let lo = 0;
		for (let y = 0; y < 8; y++)
			for (let x = 0; x < 8; x++) {
				const bit = px[y * 9 + x] > px[y * 9 + x + 1] ? 1 : 0;
				const i = y * 8 + x;
				if (i < 32) hi = (hi | (bit << (31 - i))) >>> 0;
				else lo = (lo | (bit << (63 - i))) >>> 0;
			}
		return hi.toString(16).padStart(8, '0') + lo.toString(16).padStart(8, '0');
	} catch {
		return null;
	}
}

/** A book's pages' hashes, hashing the ones not stored yet. '' for a page that wouldn't read. */
async function pageHashes(entryId: number): Promise<string[]> {
	const db = getDb();
	const m = await manifest(entryId, true);
	const count = m?.pages.length ?? 0;
	const have = new Map(
		(
			db.prepare(`SELECT page, hash FROM page_hashes WHERE entry_id = ?`).all(entryId) as {
				page: number;
				hash: string;
			}[]
		).map((r) => [r.page, r.hash])
	);
	const put = db.prepare(
		`INSERT OR REPLACE INTO page_hashes (entry_id, page, hash) VALUES (?, ?, ?)`
	);
	const out: string[] = [];
	for (let i = 0; i < count; i++) {
		let h = have.get(i);
		if (h === undefined) {
			const page = await readPage(entryId, i, true);
			h = (page ? await imageHash(await bytesOf(page.body)) : null) ?? '';
			put.run(entryId, i, h);
		}
		out.push(h);
	}
	return out;
}

/** A typical page's size: the median of the manifest's. */
async function pageSize(entryId: number): Promise<[number, number]> {
	const m = await manifest(entryId, true);
	const pages = (m?.pages ?? []).filter((p) => p.w > 0 && p.h > 0);
	if (!pages.length) return [0, 0];
	const mid = [...pages].sort((x, y) => x.w * x.h - y.w * y.h)[Math.floor(pages.length / 2)];
	return [mid.w, mid.h];
}

type Stored = { rows: PageRow[]; sizes: Record<number, [number, number]> };

/**
 * Find the pairs (doc/DUPLICATE-BOOKS.md, "Finding"): every book with a
 * usable cover hash against every other, then each new pair's pages. Pairs
 * no longer close, or settled, go. Logs counts only.
 */
export async function findDuplicates(
	o: { now?: number; log?: (line: string) => void } = {}
): Promise<{ pairs: number; hashed: number }> {
	const db = getDb();
	const log = o.log ?? (() => {});
	const books = (
		db
			.prepare(
				`SELECT e.id AS entryId, e.series_id AS seriesId, e.cover_phash AS hash
				FROM entries e JOIN series s ON s.id = e.series_id
				WHERE s.kind = 'doujin' AND e.shadowed = 0 AND e.available = 1 AND e.cover_phash IS NOT NULL`
			)
			.all() as { entryId: number; seriesId: number; hash: string }[]
	).map((b) => ({ ...b, hash: b.hash.toLowerCase() }));
	const settled = new Set(
		(db.prepare(`SELECT pair FROM dupe_decisions`).all() as { pair: string }[]).map((r) => r.pair)
	);
	const found = candidatePairs(books, settled);
	log(`dupes: ${found.length} pairs from ${books.length} books`);
	const known = new Set(
		(db.prepare(`SELECT a, b FROM dupe_pairs`).all() as { a: number; b: number }[]).map((r) =>
			pairKey(r.a, r.b)
		)
	);
	const keep = new Set(found.map((p) => pairKey(p.a, p.b)));
	// A pair the owner asked for (FOLD AS LANGUAGES, bits -1) stays until it's settled.
	for (const r of db.prepare(`SELECT a, b FROM dupe_pairs WHERE bits >= 0`).all() as {
		a: number;
		b: number;
	}[])
		if (!keep.has(pairKey(r.a, r.b)))
			db.prepare(`DELETE FROM dupe_pairs WHERE a = ? AND b = ?`).run(r.a, r.b);
	let hashed = 0;
	const put = db.prepare(
		`INSERT OR REPLACE INTO dupe_pairs (a, b, bits, rows, found_at) VALUES (?, ?, ?, ?, ?)`
	);
	for (const p of found) {
		// Pages already hashed are read back, not hashed again: lining them up
		// again is cheap, and follows any change in how pages are matched.
		const fresh = !known.has(pairKey(p.a, p.b));
		const [ha, hb] = [await pageHashes(p.a), await pageHashes(p.b)];

		if (fresh) hashed += 2;
		const rows = matchPages(ha, hb);
		// The review shows every page of both: made now, not while the owner
		// waits -- for pairs it will show, not covers merely alike.
		if (sameBook(rows, ha.length, hb.length))
			for (const [id, n] of [
				[p.a, ha.length],
				[p.b, hb.length]
			] as const)
				for (let i = 0; i < n; i++) await readPageThumb(id, i, true);
		const stored: Stored = {
			rows,
			sizes: { [p.a]: await pageSize(p.a), [p.b]: await pageSize(p.b) }
		};
		put.run(
			p.a,
			p.b,
			p.bits,
			JSON.stringify(stored),
			fresh
				? (o.now ?? Date.now())
				: (
						db.prepare(`SELECT found_at FROM dupe_pairs WHERE a = ? AND b = ?`).get(p.a, p.b) as {
							found_at: number;
						}
					).found_at
		);
	}
	log(`dupes: ${hashed} books' pages hashed`);
	return { pairs: found.length, hashed };
}

/**
 * FOLD AS LANGUAGES, from the library's selection (doc/EDITIONS.md): books
 * the covers didn't pair, offered to the review as if they had. Their pages
 * are hashed and lined up with the first's; a pair already settled is asked
 * again, since the owner asked. Stored with bits -1: first in the review, and
 * kept by the next import's pass, which drops pairs the covers no longer make.
 * Returns the first pair's key, or null when
 * the pages don't match (they aren't one book).
 */
export async function offerFold(entryIds: number[], now = Date.now()): Promise<string | null> {
	const db = getDb();
	const [first, ...rest] = entryIds;
	let key: string | null = null;
	for (const other of rest) {
		const [a, b] = first < other ? [first, other] : [other, first];
		const [ha, hb] = [await pageHashes(a), await pageHashes(b)];
		const rows = matchPages(ha, hb);
		if (!sameBook(rows, ha.length, hb.length)) continue;
		for (const [id, n] of [
			[a, ha.length],
			[b, hb.length]
		] as const)
			for (let i = 0; i < n; i++) await readPageThumb(id, i, true);
		const stored: Stored = { rows, sizes: { [a]: await pageSize(a), [b]: await pageSize(b) } };
		db.prepare(
			`INSERT OR REPLACE INTO dupe_pairs (a, b, bits, rows, found_at) VALUES (?, ?, -1, ?, ?)`
		).run(a, b, JSON.stringify(stored), now);
		db.prepare(`DELETE FROM dupe_decisions WHERE pair = ?`).run(pairKey(a, b));
		key ??= pairKey(a, b);
	}
	return key;
}

// ---- the review -------------------------------------------------------------------------

export type Pair = {
	key: string;
	kind: PairKind;
	conf: Confidence;
	a: Copy;
	b: Copy;
	rows: PageRow[];
	/** The pick, for a duplicate; null for a fold, where nothing goes. */
	pick: Pick | null;
	bits: number;
	/**
	 * A fold where one side is a folded book already: its languages' codes
	 * ("EN · JA"), and the offer is ADD AS A THIRD LANGUAGE (Pair Review 3b).
	 */
	folded: { side: 'a' | 'b'; codes: string[] } | null;
	/** A fold that's part of a bigger book (3c): no FOLD, only KEEP APART or SKIP. */
	part: boolean;
};

/** A book's editions' languages, when it's folded: ["EN", "JA"]. */
function foldedCodes(entryId: number): string[] | null {
	const rows = getDb()
		.prepare(
			`SELECT language FROM entries WHERE (id = ? OR edition_of = ?) AND language IS NOT NULL ORDER BY edition_of IS NOT NULL, id`
		)
		.all(entryId, entryId) as { language: string }[];
	return rows.length > 1 ? rows.map((r) => langCode(r.language)) : null;
}

/**
 * The pairs to review, closest first: none decided, both books still there
 * and apart, and -- hidden means hidden -- none with a hidden book while
 * reveal is off.
 */
export function reviewQueue(reveal: boolean): Pair[] {
	const db = getDb();
	const rows = db
		.prepare(
			`SELECT p.a, p.b, p.bits, p.rows FROM dupe_pairs p
			JOIN entries ea ON ea.id = p.a JOIN entries eb ON eb.id = p.b
			WHERE ea.series_id != eb.series_id
				AND NOT EXISTS (SELECT 1 FROM dupe_decisions d WHERE d.pair = p.a || ',' || p.b)
			ORDER BY p.bits, p.a, p.b`
		)
		.all() as { a: number; b: number; bits: number; rows: string }[];
	const out: Pair[] = [];
	for (const r of rows) {
		const stored = JSON.parse(r.rows) as Stored;
		const a = copyOf(r.a, stored.sizes[r.a]);
		const b = copyOf(r.b, stored.sizes[r.b]);
		if (!a || !b) continue;
		if (!reveal && (a.hidden || b.hidden)) continue;
		if (!sameBook(stored.rows, a.pages, b.pages)) continue;
		const kind = kindOf(a, b);
		const fa = foldedCodes(r.a);
		const fb = foldedCodes(r.b);
		out.push({
			key: pairKey(r.a, r.b),
			kind,
			conf: confidence(a, b),
			a,
			b,
			rows: stored.rows,
			pick: kind === 'dup' ? pick(a, b, stored.rows) : null,
			bits: r.bits,
			folded: fa ? { side: 'a', codes: fa } : fb ? { side: 'b', codes: fb } : null,
			part: kind === 'fold' && partOfBigger(stored.rows, a.pages, b.pages)
		});
	}
	return out;
}

/** The series screen's band: a pair to review with a book of this series in it. */
export function twinOf(seriesId: number, reveal: boolean): Pair | null {
	return (
		reviewQueue(reveal).find((p) => p.a.seriesId === seriesId || p.b.seriesId === seriesId) ?? null
	);
}

export type Decision = 'keep' | 'both' | 'group' | 'fold' | 'apart';

/**
 * Settle a pair. What was decided before is carried out first; this one
 * waits, so UNDO can still take it back.
 */
export async function decide(
	key: string,
	decision: Decision,
	keep: number | null,
	reveal: boolean,
	now = Date.now()
): Promise<void> {
	const pair = reviewQueue(reveal).find((p) => p.key === key);
	if (!pair) throw new Error('no such pair');
	if (decision === 'keep' && keep !== pair.a.entryId && keep !== pair.b.entryId)
		throw new Error('keep which?');
	await applyPending();
	getDb()
		.prepare(`INSERT OR REPLACE INTO dupe_decisions (pair, decision, keep, at) VALUES (?, ?, ?, ?)`)
		.run(key, decision, decision === 'keep' ? keep : null, now);
}

/** UNDO: the last decision forgotten, if it hasn't been carried out. */
export function undoDecision(key: string): boolean {
	return (
		getDb().prepare(`DELETE FROM dupe_decisions WHERE pair = ? AND applied_at IS NULL`).run(key)
			.changes > 0
	);
}

/** Carry out the decisions waiting: on the next decision, or leaving the review. */
export async function applyPending(now = Date.now()): Promise<number> {
	const db = getDb();
	const waiting = db
		.prepare(`SELECT pair, decision, keep FROM dupe_decisions WHERE applied_at IS NULL`)
		.all() as { pair: string; decision: Decision; keep: number | null }[];
	let n = 0;
	for (const d of waiting) {
		const [a, b] = d.pair.split(',').map(Number);
		try {
			if (d.decision === 'keep' && d.keep) await keepOne(d.keep, d.keep === a ? b : a, now);
			if (d.decision === 'group') await group(a, b, now);
			if (d.decision === 'fold') await fold(a, b);
		} catch {
			// A book gone since, or a grouping or fold refused: the decision stands, nothing more to do.
		}
		db.prepare(`UPDATE dupe_decisions SET applied_at = ? WHERE pair = ?`).run(now, d.pair);
		n += 1;
	}
	return n;
}

/**
 * KEEP: the kept copy takes over what the other had more of (rating, FAV,
 * progress, shelves, a place in a series of books), then the other goes to
 * the trash as any delete does (doc/DELETING.md).
 */
async function keepOne(keepId: number, loseId: number, now: number): Promise<void> {
	const db = getDb();
	const keep = copyOf(keepId);
	const lose = copyOf(loseId);
	if (!keep || !lose) return;
	const rating = Math.max(keep.rating, lose.rating);
	const favourite = keep.favourite || lose.favourite;
	const k = db
		.prepare(`SELECT read_at, last_position, last_opened_at FROM entries WHERE id = ?`)
		.get(keepId) as {
		read_at: number | null;
		last_position: number | null;
		last_opened_at: number | null;
	};
	const l = db
		.prepare(`SELECT read_at, last_position, last_opened_at FROM entries WHERE id = ?`)
		.get(loseId) as typeof k;
	// Shelves first: the lost copy's series may be about to go.
	const shelvesTo = lose.series && !keep.series ? lose.series.id : keep.seriesId;
	db.prepare(
		`INSERT OR IGNORE INTO collection_series (collection_id, series_id)
		SELECT collection_id, ? FROM collection_series WHERE series_id IN (?, ?)`
	).run(shelvesTo, keep.seriesId, lose.seriesId);
	// Its place in a series of books: the kept single moves in where the other was.
	let inSeries = !!keep.series;
	if (lose.series && !keep.series) {
		const order = (
			db
				.prepare(`SELECT id FROM entries WHERE series_id = ? ORDER BY position, id`)
				.all(lose.series.id) as { id: number }[]
		).map((r) => (r.id === loseId ? keepId : r.id));
		const { moveBook, reorderBooks } = await grouping();
		moveBook(keep.seriesId, keepId, lose.series.id);
		reorderBooks(lose.series.id, [...order, loseId]);
		inSeries = true;
	}
	const seriesId = (
		db.prepare(`SELECT series_id FROM entries WHERE id = ?`).get(keepId) as { series_id: number }
	).series_id;
	if (inSeries)
		db.prepare(`UPDATE entries SET rating = ?, favourite = ? WHERE id = ?`).run(
			rating,
			favourite ? 1 : 0,
			keepId
		);
	else
		db.prepare(`UPDATE series SET rating = ?, favourite = ? WHERE id = ?`).run(
			rating,
			favourite ? 1 : 0,
			seriesId
		);
	// Progress: read beats unread; otherwise the further page.
	if (k.read_at === null && l.read_at !== null)
		db.prepare(`UPDATE entries SET read_at = ?, last_position = NULL WHERE id = ?`).run(
			l.read_at,
			keepId
		);
	else if (k.read_at === null && (l.last_position ?? -1) > (k.last_position ?? -1))
		db.prepare(`UPDATE entries SET last_position = ? WHERE id = ?`).run(l.last_position, keepId);
	if ((l.last_opened_at ?? 0) > (k.last_opened_at ?? 0))
		db.prepare(`UPDATE entries SET last_opened_at = ? WHERE id = ?`).run(l.last_opened_at, keepId);
	// Then the other copy goes, as any delete does.
	const loser = db
		.prepare(
			`SELECT e.series_id, (SELECT COUNT(*) FROM entries x WHERE x.series_id = e.series_id) AS n
			FROM entries e WHERE e.id = ?`
		)
		.get(loseId) as { series_id: number; n: number } | undefined;
	if (!loser) return;
	const { deleteBook, deleteSeries } = await deleting();
	if (loser.n <= 1) await deleteSeries([loser.series_id], true, now);
	else await deleteBook(loser.series_id, loseId, true, now);
}

/**
 * FOLD INTO ONE BOOK (doc/EDITIONS.md): the two, or a folded book and a new
 * language, become one book. The folded side, if there is one, is the base;
 * otherwise A. Its pages are lined up with the other's as the pair was.
 */
async function fold(a: number, b: number): Promise<void> {
	const db = getDb();
	const stored = db.prepare(`SELECT rows FROM dupe_pairs WHERE a = ? AND b = ?`).get(a, b) as
		{ rows: string } | undefined;
	if (!stored) return;
	const rows = (JSON.parse(stored.rows) as Stored).rows;
	const baseIsB = foldedCodes(b) !== null && foldedCodes(a) === null;
	const [base, other] = baseIsB ? [b, a] : [a, b];
	const lined = baseIsB ? rows.map((r) => ({ a: r.b, b: r.a })) : rows;
	const seriesOf = (id: number) =>
		(db.prepare(`SELECT series_id FROM entries WHERE id = ?`).get(id) as { series_id: number })
			.series_id;
	const { foldEditions } = await grouping();
	const book = seriesOf(base);
	foldEditions(book, [seriesOf(other)], () => lined);
	// Its tile wears the opening edition's cover (doc/EDITIONS.md); off the decision.
	void import('./covers.ts').then((c) => c.refreshSeriesCover(book)).catch(() => undefined);
}

/**
 * GROUP AS A SERIES: the two become a series of books, A first, through the
 * grouping that exists (doc/BOOKS.md). A book already in a series brings the
 * other in.
 */
async function group(a: number, b: number, now: number): Promise<void> {
	const { groupIntoSeries } = await grouping();
	const ca = copyOf(a);
	const cb = copyOf(b);
	if (!ca || !cb) return;
	if (ca.series && cb.series) return;
	if (ca.series) groupIntoSeries({ seriesIds: [cb.seriesId], into: ca.series.id, now });
	else if (cb.series) groupIntoSeries({ seriesIds: [ca.seriesId], into: cb.series.id, now });
	else
		groupIntoSeries({
			seriesIds: [ca.seriesId, cb.seriesId],
			name: sharedStart([ca.title, cb.title]) || ca.title,
			now
		});
}

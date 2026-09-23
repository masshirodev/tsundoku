import { existsSync } from 'node:fs';
import { mkdir, readFile, readdir, rename, stat, unlink, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { join } from 'node:path';
import type { ReadStream } from 'node:fs';
import { getDb } from './db.ts';
import { VISIBLE_SQL } from './visibility.ts';
import { readPage } from './pages/index.ts';
import { SAMPLE_PREFIX } from './pages/sample.ts';
import { readEpub } from './import/epub.ts';
import { bookCoverVersion } from '../library/cover.ts';
import { listZip, readMember } from './zip.ts';

/**
 * Covers (doc/COVERS.md). One thumbnail per series, made once and kept on the
 * library disk, from the first source that has one:
 *
 * 1. a cover the files carry: Hentoid's thumbnail, Mihon local's cover.jpg,
 *    an EPUB's cover image;
 * 2. the source site's cover URL (Mihon's backup), fetched by
 *    `refreshCovers` -- never while a screen waits;
 * 3. the first page of the first downloaded entry, cropped from the top to
 *    the tile's shape. Last, because a chapter's first page is so often a
 *    scanlator's credits, or a sliver of a webtoon strip.
 *
 * `series.cover_key` names what the thumbnail was made from, so a changed
 * source makes a new one and an unchanged one costs nothing; `cover_at` is
 * its version. A fetch that failed is remembered in `cover_failed_at` and not
 * tried again for a week, and the next source down stands in meanwhile.
 */

export const THUMB_WIDTH = 400;
const RETRY_FAILED_MS = 7 * 24 * 3600_000;

export function coverDir(): string {
	return process.env.COVER_DIR ?? '/mnt/hdd2/tsundoku/covers';
}

const thumbPath = (seriesId: number) => join(coverDir(), `${seriesId}.webp`);

type SeriesRow = {
	id: number;
	path: string;
	kind: string;
	cover_url: string;
	cover_key: string;
	cover_at: number | null;
	cover_failed_at: number | null;
};

/** `crop`: cut to the tile's 2:2.9 from the top, for a page rather than a cover. */
type Source = { key: string; read: () => Promise<Buffer | null>; crop?: boolean };

async function bytesOf(body: Buffer | ReadStream): Promise<Buffer> {
	if (Buffer.isBuffer(body)) return body;
	const chunks: Buffer[] = [];
	for await (const c of body) chunks.push(c as Buffer);
	return Buffer.concat(chunks);
}

/** A cover the files carry: an entry's own cover file, or an EPUB's cover. */
function ownSource(s: SeriesRow): Source | null {
	if (!s.path || s.path.startsWith(SAMPLE_PREFIX)) return null;
	const db = getDb();
	const own = db
		.prepare(
			`SELECT file, cover_file FROM entries
			WHERE series_id = ? AND cover_file IS NOT NULL AND cover_file != '' AND available = 1
			ORDER BY position, id LIMIT 1`
		)
		.get(s.id) as { file: string; cover_file: string } | undefined;
	if (own) {
		const path = join(s.path, own.file, own.cover_file);
		return { key: `file:${path}`, read: () => readFile(path).catch(() => null) };
	}
	const first = firstEntry(s);
	if (!first) return null;
	if (s.kind === 'novel' && /\.epub$/i.test(first.file)) {
		const path = join(s.path, first.file);
		return {
			key: `epub:${path}`,
			read: async () => {
				const { pkg } = await readEpub(path);
				if (!pkg?.cover) return null;
				const { open } = await import('node:fs/promises');
				const fh = await open(path);
				try {
					const member = (await listZip(fh, (await fh.stat()).size)).find(
						(m) => m.name === pkg.cover
					);
					return member ? await readMember(fh, member) : null;
				} finally {
					await fh.close();
				}
			}
		};
	}
	return null;
}

function firstEntry(s: SeriesRow): { id: number; file: string } | undefined {
	return getDb()
		.prepare(
			`SELECT id, file FROM entries WHERE series_id = ? AND available = 1 AND shadowed = 0
			ORDER BY position, id LIMIT 1`
		)
		.get(s.id) as { id: number; file: string } | undefined;
}

/** The first page of the first downloaded entry: the last resort. */
function pageSource(s: SeriesRow): Source | null {
	if (!s.path || s.path.startsWith(SAMPLE_PREFIX) || s.kind === 'novel') return null;
	const first = firstEntry(s);
	if (!first) return null;
	return {
		key: `page:${first.id}:${first.file}`,
		crop: true,
		read: async () => {
			const page = await readPage(first.id, 0, true);
			return page ? bytesOf(page.body) : null;
		}
	};
}

function remoteSource(s: SeriesRow): Source | null {
	if (!/^https?:\/\//.test(s.cover_url)) return null;
	const url = s.cover_url.replace(/#.*$/, '');
	return {
		key: `url:${url}`,
		read: async () => {
			// Sites that guard their images against hotlinking accept their own
			// origin as the referrer.
			const origin = new URL(url).origin;
			const res = await fetch(url, {
				headers: {
					'user-agent':
						'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140 Safari/537.36',
					referer: `${origin}/`,
					accept: 'image/avif,image/webp,image/*,*/*;q=0.8'
				},
				signal: AbortSignal.timeout(15_000)
			});
			if (!res.ok) return null;
			return Buffer.from(await res.arrayBuffer());
		}
	};
}

async function sharp() {
	// libvips warns about optional modules Arch ships unbuilt (openslide);
	// nothing tsundoku uses. Set before libvips starts.
	process.env.VIPS_WARNING ??= '0';
	return (await import('sharp')).default;
}

/**
 * A cover's bytes as the thumbnail every screen uses: 400px wide, WebP. A
 * page stands in for a cover cut to the tile's 2:2.9 from its top, so a
 * webtoon strip shows its first panel rather than a sliver.
 */
export async function thumbnail(input: Buffer, crop = false): Promise<Buffer> {
	const s = await sharp();
	const img = s(input, { failOn: 'none', animated: false }).rotate();
	return (
		crop
			? img.resize({
					width: THUMB_WIDTH,
					height: Math.round((THUMB_WIDTH * 2.9) / 2),
					fit: 'cover',
					position: 'top'
				})
			: img.resize({ width: THUMB_WIDTH, withoutEnlargement: true })
	)
		.webp({ quality: 78 })
		.toBuffer();
}

async function write(seriesId: number, bytes: Buffer): Promise<void> {
	await mkdir(coverDir(), { recursive: true });
	const final = thumbPath(seriesId);
	const partial = `${final}.partial`;
	await writeFile(partial, bytes);
	await rename(partial, final);
}

export type CoverResult = 'made' | 'kept' | 'none' | 'failed';

/** Bring one series' thumbnail up to date. `remote`: may ask the source site. */
export async function refreshCover(
	s: SeriesRow,
	remote: boolean,
	now = Date.now()
): Promise<CoverResult> {
	const db = getDb();
	const set = db.prepare(`UPDATE series SET cover_key = ?, cover_at = ? WHERE id = ?`);
	const fresh = (key: string) =>
		s.cover_key === key && s.cover_at !== null && existsSync(thumbPath(s.id));
	const make = async (source: Source): Promise<boolean> => {
		if (fresh(source.key)) return true;
		const bytes = await source.read().catch(() => null);
		if (!bytes) return false;
		try {
			await write(s.id, await thumbnail(bytes, source.crop));
		} catch {
			return false;
		}
		set.run(source.key, now, s.id);
		return true;
	};

	const own = ownSource(s);
	if (own) {
		if (fresh(own.key)) return 'kept';
		if (await make(own)) return 'made';
	}
	const site = remoteSource(s);
	if (site) {
		if (fresh(site.key)) return 'kept';
		const due = s.cover_failed_at === null || now - s.cover_failed_at >= RETRY_FAILED_MS;
		if (remote && due) {
			if (await make(site)) {
				db.prepare(`UPDATE series SET cover_failed_at = NULL WHERE id = ?`).run(s.id);
				return 'made';
			}
			// Remembered, so a scan doesn't ask a refusing site again for a week.
			db.prepare(`UPDATE series SET cover_failed_at = ? WHERE id = ?`).run(now, s.id);
		}
	}
	const page = pageSource(s);
	if (page) {
		if (fresh(page.key)) return site && remote ? 'failed' : 'kept';
		if (await make(page)) return 'made';
	}
	if (s.cover_key !== '') {
		set.run('', null, s.id);
		await unlink(thumbPath(s.id)).catch(() => undefined);
	}
	return site && remote ? 'failed' : 'none';
}

/**
 * Every series' cover, brought up to date: after an import, or by hand
 * (`yarn run covers`). Local covers first, then remote ones, a few at a time
 * so the source sites see a reader, not a crawler.
 */
export async function refreshCovers(
	opts: { ids?: number[]; remote?: boolean; now?: number; progress?: (r: CoverResult) => void } = {}
): Promise<Record<CoverResult, number>> {
	const db = getDb();
	const where = opts.ids ? `WHERE id IN (${opts.ids.map(Number).join(',') || 'NULL'})` : '';
	const rows = db
		.prepare(
			`SELECT id, path, kind, cover_url, cover_key, cover_at, cover_failed_at FROM series ${where} ORDER BY id`
		)
		.all() as SeriesRow[];
	const counts: Record<CoverResult, number> = { made: 0, kept: 0, none: 0, failed: 0 };
	const tally = (r: CoverResult) => {
		counts[r] += 1;
		opts.progress?.(r);
	};
	const remote = opts.remote ?? true;
	const needsRemote: SeriesRow[] = [];
	for (const s of rows) {
		if (!ownSource(s) && remote && remoteSource(s)) needsRemote.push(s);
		else tally(await refreshCover(s, false, opts.now));
	}
	let next = 0;
	const worker = async () => {
		while (next < needsRemote.length)
			tally(await refreshCover(needsRemote[next++], true, opts.now));
	};
	await Promise.all([worker(), worker(), worker()]);
	return counts;
}

/** A visible series' thumbnail, or null. */
export async function readCover(
	seriesId: number,
	reveal: boolean
): Promise<{ body: Buffer; at: number } | null> {
	const row = getDb()
		.prepare(
			`SELECT s.cover_at FROM series s JOIN roots r ON r.id = s.root_id
			WHERE s.id = ? AND s.cover_at IS NOT NULL AND (? OR ${VISIBLE_SQL})`
		)
		.get(seriesId, reveal ? 1 : 0) as { cover_at: number } | undefined;
	if (!row) return null;
	try {
		const path = thumbPath(seriesId);
		await stat(path);
		return { body: await readFile(path), at: row.cover_at };
	} catch {
		return null;
	}
}

// ---- books ---------------------------------------------------------------------

/**
 * A book's own cover, for its tile in a series of books (doc/COVERS.md,
 * "Books"): the page the owner chose (`cover_page`), else the cover file its
 * folder carries (Hentoid's thumbnail), else its first page. Made on first ask
 * and kept beside the series' covers, named by what it was made from, so a
 * new choice makes a new one.
 */
export async function readBookCover(
	entryId: number,
	reveal: boolean
): Promise<{ body: Buffer; version: string } | null> {
	const row = getDb()
		.prepare(
			`SELECT e.cover_page, e.cover_file, e.file, s.path FROM entries e
			JOIN series s ON s.id = e.series_id JOIN roots r ON r.id = s.root_id
			WHERE e.id = ? AND e.available = 1 AND (? OR ${VISIBLE_SQL})`
		)
		.get(entryId, reveal ? 1 : 0) as
		| { cover_page: number | null; cover_file: string | null; file: string; path: string }
		| undefined;
	if (!row) return null;
	const version = bookCoverVersion(row.cover_page);
	const key = createHash('sha1')
		.update(`${row.cover_page ?? ''}|${row.cover_file ?? ''}|${row.path}|${row.file}`)
		.digest('hex')
		.slice(0, 12);
	const dir = join(coverDir(), 'books');
	const path = join(dir, `${entryId}-${key}.webp`);
	try {
		return { body: await readFile(path), version };
	} catch {
		// Not made yet, or made from something else: made below.
	}
	const page = async (n: number) => {
		const p = await readPage(entryId, n, true);
		return p ? bytesOf(p.body) : null;
	};
	let made: Buffer | null = null;
	try {
		if (row.cover_page !== null) {
			const b = await page(row.cover_page);
			if (b) made = await thumbnail(b, true);
		}
		if (!made && row.cover_file && !row.path.startsWith(SAMPLE_PREFIX)) {
			const b = await readFile(join(row.path, row.file, row.cover_file)).catch(() => null);
			if (b) made = await thumbnail(b);
		}
		if (!made) {
			const b = await page(0);
			if (b) made = await thumbnail(b, true);
		}
	} catch {
		return null;
	}
	if (!made) return null;
	await mkdir(dir, { recursive: true });
	// One file per book: what it was made from before is gone.
	for (const f of await readdir(dir).catch(() => [] as string[]))
		if (f.startsWith(`${entryId}-`)) await unlink(join(dir, f)).catch(() => undefined);
	await writeFile(`${path}.partial`, made);
	await rename(`${path}.partial`, path);
	return { body: made, version };
}

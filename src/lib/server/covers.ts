import { existsSync } from 'node:fs';
import { mkdir, readFile, readdir, rename, stat, unlink, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { join } from './fspath.ts';
import type { ReadStream } from 'node:fs';
import { getDb } from './db.ts';
import { VISIBLE_SQL } from './visibility.ts';
import { manifest, readPage } from './pages/index.ts';
import { SAMPLE_PREFIX } from './pages/sample.ts';
import { readEpub } from './import/epub.ts';
import { coverImageOfPage, coverPages } from '../epub/epub.ts';
import { bookCoverVersion } from '../library/cover.ts';
import { listZip, readMember } from './zip.ts';
import { getSetting } from './settings.ts';
import { openingEdition } from '../library/editions.ts';
import { linkCover } from './catalogue.ts';
import { engineAuth } from './engine/auth.ts';
import { publicFetch } from './net-guard.ts';
import { dataPaths } from './data-dirs.ts';
import { kindFacts, type Kind } from '../library/kinds.ts';

/**
 * Covers (doc/COVERS.md). One thumbnail per series, made once and kept on the
 * library disk, from the first source that has one:
 *
 * 1. a cover the files carry: Hentoid's thumbnail, an EPUB's cover image;
 * 2. the source site's cover URL (Mihon's backup), fetched by
 *    `refreshCovers` -- never while a screen waits;
 * 3. the cover of the series' AniList entry, once it's linked
 *    (doc/LINKS.md), fetched by `refreshCovers` as the site's is;
 * 4. the first page of the first downloaded entry, cropped from the top to
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
	return dataPaths().covers;
}

const thumbPath = (seriesId: number) => join(coverDir(), `${seriesId}.webp`);

type SeriesRow = {
	id: number;
	path: string;
	kind: Kind;
	cover_entry: number | null;
	cover_page: number | null;
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
	// A text kind's EPUB carries its own cover (card c303: the medium, not the name).
	if (kindFacts(s.kind).medium === 'text' && /\.epub$/i.test(first.file)) {
		const path = join(s.path, first.file);
		return {
			key: `epub:${path}`,
			read: () => epubCover(path)
		};
	}
	return null;
}

/**
 * An EPUB's cover image: the member its package names, else the image its
 * `Cover` page holds (c835). Haibara's books have no manifest `cover-image`
 * and no `<meta name="cover">`, but each lists a Cover entry whose page is an
 * image alone, which `parsePackage` cannot see; the disk side can.
 */
async function epubCover(path: string): Promise<Buffer | null> {
	const { pkg, toc } = await readEpub(path);
	if (!pkg) return null;
	const { open } = await import('node:fs/promises');
	const fh = await open(path);
	try {
		const members = await listZip(fh, (await fh.stat()).size);
		const byName = new Map(members.map((m) => [m.name, m]));
		const read = async (name: string) => {
			const m = byName.get(name);
			return m ? readMember(fh, m) : null;
		};
		if (pkg.cover) {
			const named = await read(pkg.cover).catch(() => null);
			if (named) return named;
		}
		for (const page of coverPages(pkg, toc)) {
			const html = (await read(page).catch(() => null))?.toString('utf8');
			const image = html ? coverImageOfPage(html, page) : null;
			const bytes = image ? await read(image).catch(() => null) : null;
			if (bytes) return bytes;
		}
		return null;
	} finally {
		await fh.close();
	}
}

function firstEntry(s: SeriesRow): { id: number; file: string } | undefined {
	return getDb()
		.prepare(
			`SELECT id, file FROM entries WHERE series_id = ? AND available = 1 AND shadowed = 0
			ORDER BY position, id LIMIT 1`
		)
		.get(s.id) as { id: number; file: string } | undefined;
}

/** The first page of the first downloaded entry: the last resort. An episode has no pages. */
function pageSource(s: SeriesRow): Source | null {
	// Only a pages kind has a first page: not a text's, not a video's.
	if (!s.path || s.path.startsWith(SAMPLE_PREFIX) || kindFacts(s.kind).medium !== 'pages')
		return null;
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

/**
 * A page the owner chose as the series' cover (the page menu), cut to the
 * tile from its top as any page is.
 */
function chosenSource(s: SeriesRow): Source | null {
	if (s.cover_entry === null || s.cover_page === null) return null;
	const entry = s.cover_entry;
	const page = s.cover_page;
	return {
		key: `chosen:${entry}:${page}`,
		crop: true,
		read: async () => {
			const p = await readPage(entry, page, true);
			return p ? bytesOf(p.body) : null;
		}
	};
}

/**
 * A series of books (doujins grouped by the owner) wears its first book's
 * cover: the page chosen for it, Hentoid's thumbnail, or its first page --
 * what the book's own tile shows in BOOKS (card c57).
 */
function firstBookSource(s: SeriesRow): Source | null {
	if (kindFacts(s.kind).grouping !== 'books') return null;
	const db = getDb();
	const books = db
		.prepare(
			`SELECT id, file, cover_page, cover_file FROM entries WHERE series_id = ? AND shadowed = 0 ORDER BY position, id`
		)
		.all(s.id) as {
		id: number;
		file: string;
		cover_page: number | null;
		cover_file: string | null;
	}[];
	if (books.length < 2) return null;
	const b = books[0];
	if (b.cover_page !== null)
		return {
			key: `book:${b.id}:p${b.cover_page}`,
			crop: true,
			read: async () => {
				const p = await readPage(b.id, b.cover_page!, true);
				return p ? bytesOf(p.body) : null;
			}
		};
	if (b.cover_file && s.path && !s.path.startsWith(SAMPLE_PREFIX)) {
		const path = join(s.path, b.file, b.cover_file);
		return { key: `book:${b.id}:${path}`, read: () => readFile(path).catch(() => null) };
	}
	if (!s.path || s.path.startsWith(SAMPLE_PREFIX)) return null;
	return {
		key: `book:${b.id}:p0`,
		crop: true,
		read: async () => {
			const p = await readPage(b.id, 0, true);
			return p ? bytesOf(p.body) : null;
		}
	};
}

/**
 * A book folded from several languages (doc/EDITIONS.md) wears the cover of
 * the edition it opens in: that edition's Hentoid thumbnail, or its first
 * page. Null when it opens in its own, base, edition: the usual chain covers it.
 */
function editionSource(s: SeriesRow): Source | null {
	// Editions fold single books (`foldEditions`, books.ts): a kind GROUP binds as books.
	if (kindFacts(s.kind).grouping !== 'books' || !s.path || s.path.startsWith(SAMPLE_PREFIX))
		return null;
	const db = getDb();
	const eds = db
		.prepare(
			`SELECT id, file, cover_file, language, edition_of FROM entries WHERE series_id = ?
			AND (shadowed = 0 OR edition_of IS NOT NULL) AND language IS NOT NULL ORDER BY edition_of IS NOT NULL, id`
		)
		.all(s.id) as {
		id: number;
		file: string;
		cover_file: string | null;
		language: string;
		edition_of: number | null;
	}[];
	if (eds.length < 2 || !eds.some((e) => e.edition_of !== null)) return null;
	const own = db
		.prepare(`SELECT edition_lang, edition_read FROM series WHERE id = ?`)
		.get(s.id) as {
		edition_lang: string | null;
		edition_read: string | null;
	};
	const pick = openingEdition(
		eds.map((e) => ({
			entryId: e.id,
			language: e.language,
			rows: [],
			base: e.edition_of === null
		})),
		{ own: own.edition_lang, preferred: getSetting('edition_language'), lastRead: own.edition_read }
	);
	const e = eds.find((x) => x.id === pick.entryId)!;
	if (e.edition_of === null) return null;
	if (e.cover_file) {
		const path = join(s.path, e.file, e.cover_file);
		return { key: `edition:${e.id}:${path}`, read: () => readFile(path).catch(() => null) };
	}
	return {
		key: `edition:${e.id}:p0`,
		crop: true,
		read: async () => {
			const p = await readPage(e.id, 0, true);
			return p ? bytesOf(p.body) : null;
		}
	};
}

/**
 * Where a series' cover comes from without a chosen page: what the page
 * menu's BACK TO AUTOMATIC would give. Only looks; reads nothing.
 */
export function automaticCover(
	seriesId: number
): 'book' | 'file' | 'url' | 'link' | 'page' | 'none' {
	const s = seriesRow(seriesId);
	if (!s) return 'none';
	if (firstBookSource(s)) return 'book';
	if (ownSource(s)) return 'file';
	// A site that refused stands aside for the link, as it does in refreshCover.
	if (remoteSource(s) && !(s.cover_failed_at !== null && linkSource(s))) return 'url';
	if (linkSource(s)) return 'link';
	if (pageSource(s)) return 'page';
	return 'none';
}

function seriesRow(id: number): SeriesRow | null {
	return (
		(getDb()
			.prepare(
				`SELECT id, path, kind, cover_entry, cover_page, cover_url, cover_key, cover_at, cover_failed_at
				FROM series WHERE id = ?`
			)
			.get(id) as SeriesRow | undefined) ?? null
	);
}

/** Bring one series' cover up to date now, from the workstation's files only. */
export async function refreshSeriesCover(seriesId: number): Promise<CoverResult> {
	const s = seriesRow(seriesId);
	return s ? refreshCover(s, false) : 'none';
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
			// An engine cover needs its token; any other site gets nothing.
			const auth = engineAuth(url);
			// The engine is on the workstation by design. Any other address came
			// from a source (a backup, a plugin), and stays on the internet.
			const get = auth.authorization ? fetch : publicFetch;
			const res = await get(url, {
				headers: {
					'user-agent':
						'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140 Safari/537.36',
					referer: `${origin}/`,
					accept: 'image/avif,image/webp,image/*,*/*;q=0.8',
					...auth
				},
				signal: AbortSignal.timeout(15_000)
			});
			if (!res.ok) return null;
			return Buffer.from(await res.arrayBuffer());
		}
	};
}

/** The linked AniList entry's cover (doc/LINKS.md). */
function linkSource(s: SeriesRow): Source | null {
	const l = linkCover(s.id);
	if (!l) return null;
	return {
		key: `link:anilist:${l.anilistId}`,
		read: async () => {
			const res = await fetch(l.url, {
				headers: { accept: 'image/avif,image/webp,image/*,*/*;q=0.8' },
				signal: AbortSignal.timeout(15_000)
			});
			return res.ok ? Buffer.from(await res.arrayBuffer()) : null;
		}
	};
}

/** sharp, loaded on first use (episode pictures share it: anime/pictures.ts). */
export async function loadSharp() {
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
	const s = await loadSharp();
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
			const thumb = await thumbnail(bytes, source.crop);
			// Gone while its cover was fetched (UNDO right after ADD): a file
			// under its id would be the next series' cover, since ids are reused.
			if (!db.prepare(`SELECT 1 FROM series WHERE id = ?`).get(s.id)) return false;
			await write(s.id, thumb);
		} catch {
			return false;
		}
		set.run(source.key, now, s.id);
		return true;
	};

	// The owner's choice, then a folded book's opening edition, then a series of books' first book, then the rest.
	for (const source of [chosenSource(s), editionSource(s), firstBookSource(s)]) {
		if (!source) continue;
		if (fresh(source.key)) return 'kept';
		if (await make(source)) return 'made';
	}
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
	const linked = linkSource(s);
	if (linked) {
		if (fresh(linked.key)) return 'kept';
		if (remote && (await make(linked))) return 'made';
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
			`SELECT id, path, kind, cover_entry, cover_page, cover_url, cover_key, cover_at, cover_failed_at
			FROM series ${where} ORDER BY id`
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
		if (
			!chosenSource(s) &&
			!firstBookSource(s) &&
			!ownSource(s) &&
			remote &&
			(remoteSource(s) || linkSource(s))
		)
			needsRemote.push(s);
		else tally(await refreshCover(s, false, opts.now));
	}
	let next = 0;
	const worker = async () => {
		while (next < needsRemote.length)
			tally(await refreshCover(needsRemote[next++], true, opts.now));
	};
	await Promise.all([worker(), worker(), worker()]);
	await sweepVolumeCovers();
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

// ---- volumes -------------------------------------------------------------------

/** A volume's cover, kept by its EPUB file: every chapter of the volume shares one (c835). */
const volumeCoverDir = () => join(coverDir(), 'volumes');
const volumeKey = (path: string) => createHash('sha1').update(path).digest('hex').slice(0, 20);

/**
 * A volume's own cover (c835): the cover its EPUB carries, kept in the cover
 * directory by its file, so no row names it and no column is new. A volume is
 * a file, not an entry: taking it out, UNGROUP, or a re-group in another order
 * leaves the same file, so its cover is kept; a rescan that replaces the file
 * leaves the old cover for `refreshCovers`' sweep. Hidden means hidden, as for
 * the series' and a book's cover: the same `VISIBLE_SQL`, and reveal off is a
 * 404.
 */
export async function readVolumeCover(
	entryId: number,
	reveal: boolean
): Promise<{ body: Buffer; version: string } | null> {
	const row = getDb()
		.prepare(
			`SELECT e.file, s.path FROM entries e JOIN series s ON s.id = e.series_id
			JOIN roots r ON r.id = s.root_id
			WHERE e.id = ? AND e.available = 1 AND e.file LIKE '%.epub'
			AND (? OR ${VISIBLE_SQL})`
		)
		.get(entryId, reveal ? 1 : 0) as { file: string; path: string } | undefined;
	if (!row || !row.path || row.path.startsWith(SAMPLE_PREFIX)) return null;
	const file = join(row.path, row.file);
	let st;
	try {
		st = await stat(file);
	} catch {
		return null;
	}
	const version = createHash('sha1').update(`${st.size}|${st.mtimeMs}`).digest('hex').slice(0, 12);
	const dir = volumeCoverDir();
	const base = volumeKey(file);
	const path = join(dir, `${base}-${version}.webp`);
	const kept = await readFile(path).catch(() => null);
	if (kept) return { body: kept, version };
	const bytes = await epubCover(file);
	if (!bytes) return null;
	let made: Buffer;
	try {
		made = await thumbnail(bytes);
	} catch {
		return null;
	}
	await mkdir(dir, { recursive: true });
	// One cover per file: what it was made from before is gone.
	for (const f of await readdir(dir).catch(() => [] as string[]))
		if (f.startsWith(`${base}-`)) await unlink(join(dir, f)).catch(() => undefined);
	const partial = `${path}.partial`;
	await writeFile(partial, made);
	await rename(partial, path);
	return { body: made, version };
}

/** A cover of an EPUB file the library no longer has: a replaced volume's, a deleted book's. */
async function sweepVolumeCovers(): Promise<void> {
	const dir = volumeCoverDir();
	const files = await readdir(dir).catch(() => [] as string[]);
	if (files.length === 0) return;
	const live = new Set(
		(
			getDb()
				.prepare(
					`SELECT e.file, s.path FROM entries e JOIN series s ON s.id = e.series_id
					WHERE e.available = 1 AND e.file LIKE '%.epub' AND s.path != ''`
				)
				.all() as { file: string; path: string }[]
		).map((r) => volumeKey(join(r.path, r.file)))
	);
	for (const f of files)
		if (![...live].some((k) => f.startsWith(`${k}-`)))
			await unlink(join(dir, f)).catch(() => undefined);
}

// ---- page thumbnails ---------------------------------------------------------------

const PAGE_THUMB_WIDTH = 320;

/**
 * A page's thumbnail, for a book's page grid (doc/COVERS.md, "Page
 * thumbnails"): 320px wide, its own shape, made on first ask and kept as
 * `$COVER_DIR/pages/<entry>/<page>-<version>.webp`, so a chapter whose file
 * changes gets new ones. Hidden means hidden, as for the page itself.
 */
export async function readPageThumb(
	entryId: number,
	page: number,
	reveal: boolean
): Promise<Buffer | null> {
	const m = await manifest(entryId, reveal);
	if (!m || !Number.isInteger(page) || page < 0 || page >= m.pages.length) return null;
	const version = createHash('sha1').update(m.version).digest('hex').slice(0, 10);
	const dir = join(coverDir(), 'pages', String(entryId));
	const path = join(dir, `${page}-${version}.webp`);
	try {
		return await readFile(path);
	} catch {
		// Not made yet: made below.
	}
	const body = await readPage(entryId, page, reveal);
	if (!body) return null;
	let thumb: Buffer;
	try {
		const s = await loadSharp();
		thumb = await s(await bytesOf(body.body), { failOn: 'none', animated: false })
			.rotate()
			.resize({ width: PAGE_THUMB_WIDTH, withoutEnlargement: true })
			.webp({ quality: 72 })
			.toBuffer();
	} catch {
		return null;
	}
	await mkdir(dir, { recursive: true });
	await writeFile(`${path}.partial`, thumb);
	await rename(`${path}.partial`, path);
	return thumb;
}

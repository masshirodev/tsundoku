import { keepOrPromote } from '../browsing.ts';
import { createHash } from 'node:crypto';
import { join } from '../fspath.ts';
import { getDb } from '../db.ts';
import { ensureNamedRoot, writeSeries } from '../import/write.ts';
import { libraryRoot } from '../import/index.ts';
import { refreshCovers } from '../covers.ts';
import { forgetSourceUse, libraryIndex, sourceUse } from '../library-sources.ts';
import { checkPublic } from '../net-guard.ts';
import { TSUNDOKU_DEVICE } from '../engine/device.ts';
import {
	highlight,
	mostlyHidden,
	novelKeyOf,
	sourcesToSearch,
	type ResultMatch
} from '../../library/downloads.ts';
import { lnSchema, lnValues, type LnFilters } from '../../library/lnreader-filters.ts';
import type { FilterField } from '../../library/browse-filters.ts';
import { novelNumbers, planNovel, releasedAt, type LnNovel } from '../../import/novel-plan.ts';
import type { SearchHit, SourceManga } from '../download-types.ts';
import { browsedIds } from '../engine/browse.ts';
import type { BrowseSource } from '../engine/browse.ts';
import { installedPlugins, novelHost, type InstalledPlugin } from './plugins.ts';

/**
 * A novel plugin as a source (doc/NOVELS.md, "Browsing and adding"; card
 * c149): what BROWSE lists, a page of its POPULAR or LATEST or filtered list,
 * a search in it, a novel's preview, and ADD TO LIBRARY. BROWSE knows a
 * plugin as `ln:<id>`, and a novel in it as `ln:<id>~<its path, base64url>`,
 * as a Mihon source's manga is `<source>~<url>` (engine/backend.ts).
 */

const ID = /^ln:([A-Za-z0-9._-]{1,100})$/;

export const isNovelSource = (id: string) => ID.test(id);
const pluginId = (sourceId: string) => ID.exec(sourceId)?.[1] ?? null;

/** An installed plugin that loaded, by BROWSE's id for it. */
function loaded(sourceId: string): InstalledPlugin | null {
	const id = pluginId(sourceId);
	const p = id ? installedPlugins().find((x) => x.id === id) : undefined;
	return p && !p.failed ? p : null;
}

function plugin(sourceId: string): InstalledPlugin {
	const p = loaded(sourceId);
	if (!p) throw new NovelSourceError('No installed plugin has this source');
	return p;
}

export class NovelSourceError extends Error {}

/**
 * A minute is enough for a list; two when the first request meets a site's
 * check, which the app solves (20-45 s, doc/EXTENSION-ENGINE.md) before the
 * host retries with the clearance (c152). A novel's chapters can take several
 * pages on top.
 */
const call = <T>(p: InstalledPlugin, method: string, args: unknown[], timeoutMs = 120_000) =>
	novelHost().call<T>(p.file, method, args, timeoutMs);

/**
 * Every installed plugin, as BROWSE lists a source. Hidden means hidden: a
 * mostly-hidden one isn't listed, named or counted with reveal off.
 */
export function novelSources(reveal: boolean): BrowseSource[] {
	const use = sourceUse();
	const out: BrowseSource[] = [];
	for (const p of installedPlugins()) {
		const id = `ln:${p.id}`;
		const u = use.get(id) ?? { series: 0, hidden: 0 };
		const hiddenMostly = mostlyHidden(u);
		if (hiddenMostly && !reveal) continue;
		out.push({
			id,
			pkg: id,
			name: p.name,
			lang: p.lang,
			kind: 'novel',
			family: 'lnreader',
			series: reveal ? u.series : u.series - u.hidden,
			hidden: reveal ? u.hidden : 0,
			mostlyHidden: hiddenMostly,
			failed: p.failed
		});
	}
	return out;
}

/** The plugins SEARCH THE SOURCES asks: those the library reads from, as for manga. */
export function novelSearchSources(reveal: boolean): { id: string; name: string }[] {
	const rows = installedPlugins()
		.filter((p) => !p.failed)
		.map((p) => ({ id: `ln:${p.id}`, name: p.name }));
	return sourcesToSearch(rows, sourceUse(), reveal, browsedIds(reveal));
}

// ---- its filters ----------------------------------------------------------------------------

export type NovelFilters = { raw: LnFilters; keys: string[]; schema: FilterField[] };

export async function novelFilters(sourceId: string): Promise<NovelFilters> {
	const info = await novelHost().info(plugin(sourceId).file);
	const raw = (info.filters ?? {}) as LnFilters;
	return { raw, ...lnSchema(raw) };
}

// ---- a page of a list -----------------------------------------------------------------------

export type NovelItem = { name: string; path: string; cover?: string | null };

/**
 * One page. LNReader has no "last page": a plugin answers an empty one past
 * its end, so there's more while a page has anything on it.
 */
export async function novelPage(
	sourceId: string,
	mode: 'popular' | 'latest' | 'filtered',
	page: number,
	opts: { query?: string; applied?: FilterField[]; filters?: NovelFilters }
): Promise<{ items: NovelItem[]; more: boolean }> {
	const p = plugin(sourceId);
	const q = (opts.query ?? '').trim();
	let got: NovelItem[];
	if (mode === 'filtered' && q) got = await call(p, 'searchNovels', [q, page]);
	else {
		const f = opts.filters;
		const filters =
			mode === 'filtered' && f && opts.applied ? lnValues(f.raw, f.keys, opts.applied) : undefined;
		got = await call(p, 'popularNovels', [page, { showLatestNovels: mode === 'latest', filters }]);
	}
	const items = (Array.isArray(got) ? got : []).filter(
		(n): n is NovelItem => !!n && typeof n.path === 'string' && !!n.path
	);
	return { items, more: items.length > 0 };
}

// ---- results, as search and BROWSE show them -------------------------------------------------

export const novelMangaId = (sourceId: string, path: string) =>
	`${sourceId}~${Buffer.from(path).toString('base64url')}`;

export function parseNovelMangaId(
	id: string
): { sourceId: string; plugin: string; path: string } | null {
	const m = /^(ln:[A-Za-z0-9._-]{1,100})~([A-Za-z0-9_-]+)$/.exec(id);
	if (!m) return null;
	const path = Buffer.from(m[2], 'base64url').toString('utf8');
	return path ? { sourceId: m[1], plugin: m[1].slice(3), path } : null;
}

/** The key a novel would have here, for opening its series instead of its preview. */
export function novelMangaKey(id: string): string | null {
	const ref = parseNovelMangaId(id);
	return ref ? novelKeyOf(ref.plugin, ref.path) : null;
}

/** LNReader's "no cover" picture (@libs/defaultCover): shown as tsundoku's own blank instead. */
const DEFAULT_COVER = /lnreader-plugins\/.*coverNotAvailable\./;

// A cover is fetched by the server and served as one of tsundoku's URLs, as an
// engine cover is (the browser never asks a plugin's site). The token stands
// for the address; only addresses a plugin handed over have one.
const COVERS_KEPT = 5000;
const covers = new Map<string, string>();

export function coverRoute(url: string | null | undefined): string {
	if (!url || !/^https?:\/\//.test(url) || DEFAULT_COVER.test(url)) return '';
	const token = createHash('sha256').update(url).digest('base64url').slice(0, 32);
	covers.delete(token);
	covers.set(token, url);
	if (covers.size > COVERS_KEPT) covers.delete(covers.keys().next().value!);
	return `/api/browse/novel-cover/${token}`;
}

/** The address behind a cover's token, while it's kept. */
export const coverAddress = (token: string) => covers.get(token) ?? null;

/** A plugin's results as the screens show them: matched against the library, hidden ones left out with reveal off. */
export function novelHits(
	sourceId: string,
	items: NovelItem[],
	reveal: boolean,
	query = ''
): SearchHit[] {
	const p = loaded(sourceId);
	const { byKey, sameTitle, nameable } = libraryIndex(reveal);
	const seen = new Set<string>();
	const out: SearchHit[] = [];
	for (const n of items) {
		if (seen.has(n.path)) continue;
		seen.add(n.path);
		const mine = p ? byKey.get(novelKeyOf(p.id, n.path)) : undefined;
		if (mine?.hidden && !reveal) continue;
		const other = sameTitle('lnreader:', n.name);
		const match: ResultMatch = mine
			? {
					kind: 'in-library',
					seriesId: mine.id,
					meta: `${mine.have.toLocaleString('en-US')} OF ${mine.total.toLocaleString('en-US')} DOWNLOADED`,
					hidden: !!mine.hidden
				}
			: other && other !== sourceId
				? { kind: 'same-title', source: nameable(other) ? sourceLabel(other) : '' }
				: { kind: 'new' };
		out.push({
			mangaId: novelMangaId(sourceId, n.path),
			title: n.name,
			parts: highlight(n.name, query),
			cover: coverRoute(n.cover),
			meta: '',
			match
		});
	}
	return out;
}

/** A source's name for SAME TITLE: a plugin's, or a Mihon source's. */
function sourceLabel(sourceId: string): string {
	if (isNovelSource(sourceId)) return (loaded(sourceId)?.name ?? '').toUpperCase();
	const row = getDb().prepare(`SELECT name FROM engine_sources WHERE id = ?`).get(sourceId) as
		{ name: string } | undefined;
	return (row?.name ?? '').toUpperCase();
}

/** SEARCH THE SOURCES' question to one plugin. */
export async function novelSearch(
	sourceId: string,
	query: string,
	reveal: boolean
): Promise<SearchHit[]> {
	const { items } = await novelPage(sourceId, 'filtered', 1, { query });
	return novelHits(sourceId, items, reveal, query);
}

// ---- a novel in full ---------------------------------------------------------------------------

/** A plugin that pages its chapters: as many pages as a long web novel needs, and no more. */
const MAX_CHAPTER_PAGES = 200;
const NOVEL_MS = 120_000;

type Parsed = LnNovel & { totalPages?: number };

// The preview and ADD ask the same question within a minute; a paged novel
// is a hundred calls. Kept briefly, then asked again.
const KEEP_NOVEL_MS = 10 * 60 * 1000;
const novels = new Map<string, { at: number; novel: Parsed }>();

/**
 * A novel and every chapter it lists, every page of a paged plugin's, a
 * chapter listed twice kept once; kept ten minutes. The preview, ADD and
 * FOLLOW (novels/follow.ts) all ask through here; FOLLOW with [fresh], since
 * what's new is the question.
 */
export async function parseNovel(p: InstalledPlugin, path: string, fresh = false): Promise<Parsed> {
	const key = `${p.id}\n${p.version}\n${path}`;
	const kept = novels.get(key);
	if (!fresh && kept && Date.now() - kept.at < KEEP_NOVEL_MS) return kept.novel;
	const n = await call<Parsed>(p, 'parseNovel', [path], NOVEL_MS);
	if (!n || typeof n !== 'object') throw new NovelSourceError('The plugin gave no novel');
	const chapters = Array.isArray(n.chapters) ? [...n.chapters] : [];
	const pages = Math.min(Math.floor(Number(n.totalPages) || 0), MAX_CHAPTER_PAGES);
	// Page 1 is parseNovel's own chapters, unless it gave none.
	for (let page = chapters.length ? 2 : 1; page <= pages; page++) {
		const more = await call<{ chapters?: LnNovel['chapters'] }>(
			p,
			'parsePage',
			[path, String(page)],
			NOVEL_MS
		);
		chapters.push(...(more?.chapters ?? []));
	}
	// A plugin that lists a chapter twice (across pages, often): the source has one.
	const seen = new Set<string>();
	const unique = chapters.filter(
		(c) => !!c && typeof c.path === 'string' && !!c.path && !seen.has(c.path) && !!seen.add(c.path)
	);
	const novel: Parsed = { ...n, path: n.path || path, chapters: unique };
	novels.set(key, { at: Date.now(), novel });
	if (novels.size > 50) novels.delete(novels.keys().next().value!);
	return novel;
}

/** The novel's page at its site, for OPEN ↗. */
async function realUrl(p: InstalledPlugin, path: string): Promise<string> {
	try {
		const r = await call<string | null>(p, 'resolveUrl', [path, true]);
		if (r && /^https?:\/\//.test(r)) return r;
	} catch {
		// A plugin without resolveUrl: the site and the path make one.
	}
	try {
		return /^https?:\/\//.test(path) ? path : new URL(path, p.site).toString();
	} catch {
		return '';
	}
}

/** "On Hiatus" as the preview's status words are: "ON_HIATUS". */
const statusWord = (s: string | null | undefined) => {
	const v = (s ?? '').trim();
	return !v || /^unknown$/i.test(v) ? '' : v.toUpperCase().replace(/\s+/g, '_');
};

/** A result in full, as the preview draws a manga. */
export async function novelManga(id: string): Promise<SourceManga | null> {
	const ref = parseNovelMangaId(id);
	if (!ref) return null;
	const p = plugin(ref.sourceId);
	const n = await parseNovel(p, ref.path);
	const numbers = novelNumbers(n.name, n.chapters);
	const now = Date.now();
	return {
		id,
		title: n.name,
		description: n.summary ?? '',
		author: n.author ?? '',
		artist: n.artist ?? '',
		genres: (n.genres ?? '')
			.split(',')
			.map((g) => g.trim())
			.filter(Boolean),
		status: statusWord(n.status),
		source: p.name,
		sourceId: ref.sourceId,
		url: n.path,
		inLibrary: false,
		thumbnailUrl: n.cover ?? '',
		cover: coverRoute(n.cover),
		realUrl: await realUrl(p, n.path),
		lang: p.lang.toUpperCase(),
		// Newest first, as a source's chapters are listed in the preview.
		chapters: n.chapters
			.map((c, i) => ({
				id: String(i),
				url: c.path,
				name: c.name,
				number: numbers[i],
				scanlator: '',
				sourceOrder: n.chapters.length - 1 - i,
				uploadDate: releasedAt(c.releaseTime),
				fetchedAt: now
			}))
			.reverse()
	};
}

// ---- ADD TO LIBRARY ---------------------------------------------------------------------------

export class NovelAddError extends Error {}

/**
 * Where a novel's EPUB will be (c150): tsundoku's device folder's Library/,
 * whose root the EPUB importer shares with every other device's books.
 */
const novelRoot = () => join(libraryRoot(), 'devices', TSUNDOKU_DEVICE, 'Library');

/** ADD TO LIBRARY: a novel series at once, every chapter NOT DOWNLOADED, through the importers' one writer. */
export async function addNovel(id: string, now = Date.now(), browsing = false): Promise<number> {
	const ref = parseNovelMangaId(id);
	if (!ref) throw new NovelAddError('That isn’t a novel');
	const db = getDb();
	const key = novelKeyOf(ref.plugin, ref.path);
	const existing = db.prepare(`SELECT id, in_library FROM series WHERE origin_key = ?`).get(key) as
		{ id: number; in_library: number } | undefined;
	// A browsing record (doc/BROWSING.md): kept longer when opened again, the library's on ADD.
	if (existing) return keepOrPromote(existing, browsing, now, db);
	const p = loaded(ref.sourceId);
	if (!p) throw new NovelAddError('its plugin isn’t installed');
	const n = await parseNovel(p, ref.path);
	// The key is the path asked for: a plugin that answers with another
	// spelling of it mustn't make a second series of the same novel.
	const plan = planNovel({ ...n, path: ref.path }, { plugin: p.id, name: p.name }, now);
	plan.coverUrl = await publicCover(n.cover);
	const rootId = ensureNamedRoot(db, 'Library', novelRoot(), false);
	writeSeries(plan, { rootId, jobId: null, now, browsing });
	const row = db.prepare(`SELECT id FROM series WHERE origin_key = ?`).get(key) as
		{ id: number } | undefined;
	if (!row) {
		const buried = db.prepare(`SELECT 1 FROM tombstones WHERE key = ?`).get(key);
		throw new NovelAddError(
			buried ? 'that novel was deleted here once, and stays gone' : 'it couldn’t be added'
		);
	}
	if (!browsing) {
		db.prepare(`UPDATE series SET arrived_at = ? WHERE id = ?`).run(now, row.id);
		forgetSourceUse();
	}
	void refreshCovers({ ids: [row.id], remote: true });
	return row.id;
}

/** A plugin's cover address, kept only when it's on the internet and isn't LNReader's blank. */
async function publicCover(url: string | null | undefined): Promise<string | undefined> {
	if (!url || DEFAULT_COVER.test(url)) return undefined;
	try {
		return (await checkPublic(url)).toString();
	} catch {
		return undefined;
	}
}

import { getDb } from '../db.ts';
import { sourceUse } from '../library-sources.ts';
import { mostlyHidden } from '../../library/downloads.ts';
import type { SourceFamily, SourceKind } from '../../library/kinds.ts';
import { familyOfKind } from './repo-index.ts';
import { sourcesWith } from './source-flags.ts';
import { cleanSchema, toEngine, type FilterField } from '../../library/browse-filters.ts';
import type { SearchHit } from '../download-types.ts';
import { asHits, callSource, type EngineManga } from './backend.ts';
import { challenges } from './client.ts';
import { installed, preferences } from './extensions.ts';
import { getSetting } from '../settings.ts';
import { preferenceSnapshot } from './protocol.ts';
import {
	isNovelSource,
	novelFilters,
	novelHits,
	novelPage,
	novelSources,
	type NovelFilters,
	type NovelItem
} from '../novels/source.ts';
import { installedPlugins } from '../novels/plugins.ts';
import { solvingSince } from '../novels/solver.ts';

/**
 * Browsing a source (doc/BROWSE.md; card c141): its POPULAR and LATEST
 * lists, its own filters, and a search inside it, on the engine. Pages are
 * asked for one at a time and kept for a while, so MORE, back and a reload
 * re-draw what was loaded without asking the site again; a source's answer to
 * the same question doesn't change by the minute.
 */

export type Mode = 'popular' | 'latest' | 'filtered';

export type BrowseSource = {
	id: string;
	pkg: string;
	name: string;
	lang: string;
	/** The kind its family names a row by (`SOURCE_KINDS`): Mihon's manga, Aniyomi's anime, LNReader's novel. */
	kind: SourceKind;
	/**
	 * The extension family it is (card c420): what a screen asks instead of
	 * comparing `kind` with a family's kind (doc/KINDS.md, "No new kind checks").
	 */
	family: SourceFamily;
	/** Series the library has from it that the viewer may see, and of those how many are hidden (0 with reveal off). */
	series: number;
	hidden: number;
	/**
	 * Shown only while reveal is on: its HIDDEN SOURCE switch is on
	 * (`hiddenSource`; card c435), or more than half of what's here from it
	 * is hidden. Every door that hides a source reads this one field.
	 */
	mostlyHidden: boolean;
	/** Its own HIDDEN SOURCE switch (engine/source-flags.ts), whatever its series are. */
	hiddenSource: boolean;
	/** The extension's own word when the engine refused it, else ''. */
	failed: string;
	/**
	 * Its extension's code uses a WebView (rung 78; doc/BROWSE.md, "Extensions
	 * that need a WebView"): NEEDS A WEBVIEW. Never an LNReader plugin's.
	 */
	webview: boolean;
};

/**
 * Every installed source BROWSE may name, Mihon's and Aniyomi's on the
 * engine and LNReader's plugins (novels/source.ts). Hidden means hidden: with
 * reveal off, a mostly-hidden source isn't listed, named or counted
 * (doc/PRIVACY.md).
 */
export function browseSources(reveal: boolean): BrowseSource[] {
	return [...engineSources(reveal), ...novelSources(reveal)];
}

function engineSources(reveal: boolean): BrowseSource[] {
	const rows = getDb()
		.prepare(
			`SELECT s.id, s.pkg, s.name, s.lang, e.kind, e.failed, e.webview
			FROM engine_sources s JOIN engine_extensions e ON e.pkg = s.pkg
			ORDER BY s.name COLLATE NOCASE, s.lang`
		)
		.all() as {
		id: string;
		pkg: string;
		name: string;
		lang: string;
		kind: 'manga' | 'anime';
		failed: string;
		webview: number | null;
	}[];
	const use = sourceUse();
	const switchedOff = sourcesWith('hidden');
	const out: BrowseSource[] = [];
	for (const r of rows) {
		// The column's CHECK allows only a family's kind; a word none names is skipped.
		const family = familyOfKind(r.kind);
		if (!family) continue;
		const u = use.get(r.id) ?? { series: 0, hidden: 0 };
		const hiddenSource = switchedOff.has(r.id);
		const hiddenMostly = hiddenSource || mostlyHidden(u);
		if (hiddenMostly && !reveal) continue;
		// Counts are what reveal lets the viewer see.
		out.push({
			...r,
			webview: r.webview === 1,
			family,
			series: reveal ? u.series : u.series - u.hidden,
			hidden: reveal ? u.hidden : 0,
			mostlyHidden: hiddenMostly,
			hiddenSource
		});
	}
	return out;
}

// ---- a site's browser check (c143) ----------------------------------------------------------

/** A source's site, for matching the hosts the engine solves checks for: "mangadex.org". */
export function siteOf(baseUrl: string): string {
	try {
		return new URL(baseUrl).hostname.replace(/^www\./, '').toLowerCase();
	} catch {
		return '';
	}
}

/** The same site: one host is the other or under it (a source's API or image subdomain). */
export const sameSite = (host: string, site: string) =>
	!!site && (host === site || host.endsWith(`.${site}`) || site.endsWith(`.${host}`));

const baseUrlOf = (sourceId: string) =>
	(
		getDb().prepare(`SELECT base_url FROM engine_sources WHERE id = ?`).get(sourceId) as
			{ base_url: string } | undefined
	)?.base_url ?? '';

/**
 * A source's site: an extension's base URL, or, for an LNReader plugin, the
 * site its file names (`novel_plugins.site`). A novel's checks are solved by
 * the app, but its site is matched the same way (card c152).
 */
function siteOfSource(sourceId: string): string {
	if (isNovelSource(sourceId)) {
		const row = getDb()
			.prepare(`SELECT site FROM novel_plugins WHERE id = ?`)
			.get(sourceId.slice(3)) as { site: string } | undefined;
		return row ? siteOf(row.site) : '';
	}
	return siteOf(baseUrlOf(sourceId));
}

/** Remembers the hosts the engine has solved a check for, so BROWSE can say so after. */
function noteChecked(solved: Record<string, number>): void {
	const put = getDb().prepare(
		`INSERT INTO site_checks (host, seen_at) VALUES (?, ?)
		ON CONFLICT (host) DO UPDATE SET seen_at = MAX(seen_at, excluded.seen_at)`
	);
	for (const [host, at] of Object.entries(solved)) put.run(host.toLowerCase(), at);
}

/**
 * Whether [sourceId]'s site's browser check is being passed right now, and
 * since when: what the waiting page names at once (Browse Calls, "A site's
 * check is named at once"). The engine says for an extension; the app itself
 * for a novel, which it solves (novels/solver.ts). Null when neither is.
 */
export async function checkingSince(sourceId: string): Promise<number | null> {
	const site = siteOfSource(sourceId);
	if (!site) return null;
	const since: number[] = [];
	const own = solvingSince(site);
	if (own !== null) since.push(own);
	try {
		const c = await challenges();
		noteChecked(c.solved);
		for (const [host, at] of Object.entries(c.solving))
			if (sameSite(host.toLowerCase(), site)) since.push(at);
	} catch {
		// The engine not answering is drawn elsewhere; the app's own solve still counts.
	}
	return since.length ? Math.min(...since) : null;
}

/**
 * Reads the checks the engine has solved into site_checks, for BROWSE's
 * line. Quick, and quiet on failure: BROWSE draws while the engine is down.
 */
export async function noteSolvedChecks(timeoutMs = 800): Promise<void> {
	try {
		noteChecked((await challenges(timeoutMs)).solved);
	} catch {
		// The engine not answering is drawn elsewhere; the list doesn't need it.
	}
}

/** Sites seen behind a check: "FIRST VISIT WAITS FOR THE SITE'S CHECK". */
function checkedSites(): string[] {
	return (getDb().prepare(`SELECT host FROM site_checks`).all() as { host: string }[]).map(
		(r) => r.host
	);
}

// ---- BROWSE's list ------------------------------------------------------------------------

export type BrowseRow = BrowseSource & {
	/** "MangaDex · EN" where the extension lists more than one of its languages here. */
	label: string;
	/** When it was last browsed, for RECENT. */
	browsedAt: number | null;
	/** Its site has made the engine pass a browser check: a first visit waits for it. */
	check: boolean;
};

export type BrowseList = {
	/** The last four browsed, any kind: nothing to pin or manage. */
	recent: BrowseRow[];
	manga: BrowseRow[];
	anime: BrowseRow[];
	/** LNReader plugins (doc/NOVELS.md). */
	novels: BrowseRow[];
	/** Extensions behind the listed sources. */
	extensions: number;
	/** Extensions with a newer version waiting, among those the viewer may see. */
	updates: number;
};

const RECENT = 4;

/** The owner's languages (SETTINGS): the sources BROWSE lists. */
export const browseLanguages = (): string[] =>
	getSetting('browse_languages')
		.split(',')
		.map((l) => l.trim().toLowerCase())
		.filter(Boolean);

/**
 * BROWSE (Index-Browse, sources; Browse Calls, "One list, the kinds as
 * sections"): the sources in the owner's languages, and any other the
 * library reads from (a series from MangaDex's French source keeps that one
 * listed). An extension's every language would be forty-odd rows of MangaDex.
 */
export function browseList(reveal: boolean): BrowseList {
	const langs = new Set(browseLanguages());
	const sources = browseSources(reveal);
	const mine = (s: BrowseSource) =>
		langs.has(s.lang.toLowerCase()) || ['all', 'multi'].includes(s.lang) || s.series > 0;
	// An extension installed with nothing in the owner's languages was installed
	// on purpose, so all its sources show (a pt-BR site, 2026-10-30); one that
	// has some, as MangaDex has forty, shows only those.
	const speaks = new Set(sources.filter(mine).map((s) => s.pkg));
	const shown = sources.filter((s) => mine(s) || !speaks.has(s.pkg));
	const perPkg = new Map<string, number>();
	for (const s of shown) perPkg.set(s.pkg, (perPkg.get(s.pkg) ?? 0) + 1);
	const at = new Map(
		(
			getDb().prepare(`SELECT source_id, browsed_at FROM browse_recent`).all() as {
				source_id: string;
				browsed_at: number;
			}[]
		).map((r) => [r.source_id, r.browsed_at])
	);
	const checked = checkedSites();
	const plugins = installedPlugins();
	const bases = new Map(
		(
			getDb().prepare(`SELECT id, base_url FROM engine_sources`).all() as {
				id: string;
				base_url: string;
			}[]
		).map((r) => [r.id, siteOf(r.base_url)])
	);
	// A plugin's site is the plugin's, not an engine source's (c152).
	for (const p of plugins) bases.set(`ln:${p.id}`, siteOf(p.site));
	const rows: BrowseRow[] = shown.map((s) => ({
		...s,
		label: (perPkg.get(s.pkg) ?? 0) > 1 ? `${s.name} · ${s.lang.toUpperCase()}` : s.name,
		browsedAt: at.get(s.id) ?? null,
		check: checked.some((h) => sameSite(h, bases.get(s.id) ?? ''))
	}));
	const visiblePkgs = new Set(shown.map((s) => s.pkg));
	const ofFamily = (family: SourceFamily) => rows.filter((r) => r.family === family);
	return {
		recent: rows
			.filter((r) => r.browsedAt !== null)
			.sort((a, b) => b.browsedAt! - a.browsedAt!)
			.slice(0, RECENT),
		// One list per source family, by the source's own family (cards c303,
		// c420): Mihon's, Aniyomi's, LNReader's.
		manga: ofFamily('mihon'),
		anime: ofFamily('aniyomi'),
		novels: ofFamily('lnreader'),
		extensions: visiblePkgs.size,
		updates:
			installed().filter((e) => e.update && visiblePkgs.has(e.pkg)).length +
			plugins.filter((p) => p.update && visiblePkgs.has(`ln:${p.id}`)).length
	};
}

/** A source's page was opened: it moves to the top of RECENT. */
export function noteBrowsed(sourceId: string, at = Date.now()): void {
	getDb()
		.prepare(
			`INSERT INTO browse_recent (source_id, browsed_at) VALUES (?, ?)
			ON CONFLICT (source_id) DO UPDATE SET browsed_at = excluded.browsed_at`
		)
		.run(sourceId, at);
}

/** One source, if BROWSE may name it to this viewer. */
export const browseSource = (id: string, reveal: boolean): BrowseSource | null =>
	browseSources(reveal).find((s) => s.id === id) ?? null;

// ---- what a source can do, kept per its settings -------------------------------------------

const KEEP_MS = 15 * 60 * 1000;
const MAX_PAGES = 20;
const MAX_KEPT = 300;

type Kept<T> = { at: number; value: T };
const kept = new Map<string, Kept<unknown>>();

/**
 * Asks once and keeps the answer for KEEP_MS. A setting is part of the key,
 * since one can change what a source lists ("Settings, per type": the page
 * asks again on return). A failure isn't kept: the next visit asks again.
 */
async function keep<T>(key: string, ask: () => Promise<T>): Promise<T> {
	const k = kept.get(key);
	if (k && Date.now() - k.at < KEEP_MS) return k.value as T;
	const value = await ask();
	kept.set(key, { at: Date.now(), value });
	if (kept.size > MAX_KEPT) {
		// Oldest first: a Map iterates in insertion order.
		for (const old of kept.keys()) {
			kept.delete(old);
			if (kept.size <= MAX_KEPT) break;
		}
	}
	return value;
}

/** Forgets what a source answered: after a setting changes, or an update. */
export function forgetSource(sourceId: string): void {
	for (const k of [...kept.keys()]) if (k.startsWith(`${sourceId}\n`)) kept.delete(k);
}

// A plugin has no settings here; its version is what changes its answers.
const settingsKey = (sourceId: string) =>
	isNovelSource(sourceId)
		? (installedPlugins().find((p) => `ln:${p.id}` === sourceId)?.version ?? '')
		: JSON.stringify(preferenceSnapshot(preferences(sourceId)));

const keyOf = (sourceId: string, ...parts: unknown[]) =>
	[sourceId, settingsKey(sourceId), ...parts.map((p) => JSON.stringify(p))].join('\n');

/** A first call through a site's browser check took 42 s in the spike. */
const SLOW_MS = 60_000;

/** Every LNReader plugin is asked for LATEST (`showLatestNovels`); one that has none answers its popular list. */
export const supportsLatest = async (sourceId: string) =>
	isNovelSource(sourceId) ||
	keep(keyOf(sourceId, 'latest?'), () =>
		callSource<boolean>(sourceId, 'supportLatestManga', {}, SLOW_MS)
	);

const novelFiltersKept = (sourceId: string): Promise<NovelFilters> =>
	keep(keyOf(sourceId, 'filters'), () => novelFilters(sourceId));

export const filterSchema = async (sourceId: string): Promise<FilterField[]> =>
	isNovelSource(sourceId)
		? (await novelFiltersKept(sourceId)).schema
		: keep(keyOf(sourceId, 'filters'), async () =>
				cleanSchema(await callSource<unknown>(sourceId, 'filterSchemaManga', {}, SLOW_MS))
			);

type Page = { mangas: EngineManga[]; hasNextPage: boolean };

function askNovelPage(
	sourceId: string,
	mode: Mode,
	page: number,
	query: string,
	applied: FilterField[] | undefined
): Promise<{ items: NovelItem[]; more: boolean }> {
	return keep(keyOf(sourceId, mode, page, query, applied ?? null), async () =>
		novelPage(sourceId, mode, page, {
			query,
			applied,
			filters: applied ? await novelFiltersKept(sourceId) : undefined
		})
	);
}

function askPage(
	sourceId: string,
	mode: Mode,
	page: number,
	query: string,
	applied: FilterField[] | undefined
): Promise<Page> {
	const filters = applied ? toEngine(applied) : [];
	const method =
		mode === 'popular'
			? 'getPopularManga'
			: mode === 'latest'
				? 'getLatestManga'
				: 'getSearchManga';
	const args = mode === 'filtered' ? { page, search: query, filterList: filters } : { page };
	return keep(keyOf(sourceId, mode, page, query, filters), () =>
		callSource<Page>(sourceId, method, args, SLOW_MS)
	);
}

export type Shelf = { hits: SearchHit[]; more: boolean; pages: number };

/**
 * Pages 1 to [pages] of a list ("It scrolls on, and the URL keeps the
 * place"): what back returns to and what the no-script MORE link renders.
 * Stops early at the source's last page.
 */
export async function shelf(
	sourceId: string,
	mode: Mode,
	/** `applied`: the panel's choices, on the filtered tab only. */
	opts: { pages: number; query?: string; applied?: FilterField[]; reveal: boolean }
): Promise<Shelf> {
	const want = Math.min(Math.max(1, Math.floor(opts.pages) || 1), MAX_PAGES);
	if (isNovelSource(sourceId)) {
		const items: NovelItem[] = [];
		let more = false;
		let pages = 0;
		for (let p = 1; p <= want; p++) {
			const got = await askNovelPage(sourceId, mode, p, opts.query ?? '', opts.applied);
			items.push(...got.items);
			pages = p;
			more = got.more;
			if (!more) break;
		}
		return {
			hits: novelHits(sourceId, items, opts.reveal),
			more: more && pages < MAX_PAGES,
			pages
		};
	}
	const mangas: EngineManga[] = [];
	let more = false;
	let pages = 0;
	for (let p = 1; p <= want; p++) {
		const got = await askPage(sourceId, mode, p, opts.query ?? '', opts.applied);
		mangas.push(...got.mangas);
		pages = p;
		more = got.hasNextPage && got.mangas.length > 0;
		if (!more) break;
	}
	return { hits: asHits(sourceId, mangas, opts.reveal), more: more && pages < MAX_PAGES, pages };
}

/** For tests: forget everything kept. */
export const forgetAll = () => kept.clear();

/** Every source BROWSE lists, by id: what a search asks besides what the library reads from. */
export function browsedIds(reveal: boolean): Set<string> {
	const l = browseList(reveal);
	return new Set([...l.manga, ...l.anime, ...l.novels].map((r) => r.id));
}

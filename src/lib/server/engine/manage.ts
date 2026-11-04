import { existsSync, readFileSync } from 'node:fs';
import type Database from 'better-sqlite3';
import { getDb } from '../db.ts';
import { IN_LIBRARY_SQL, VISIBLE_SQL } from '../visibility.ts';
import { parseKey } from '../../library/downloads.ts';
import type { Kind, Listing } from './repo-index.ts';
import { load as engineLoad } from './client.ts';
import {
	apkPath,
	findListing,
	installed,
	listings,
	remove,
	type ExtensionInfo,
	type Installed
} from './extensions.ts';
import { browseLanguages, browseSources, type BrowseSource } from './browse.ts';
import { NO_EXT_FILTERS, searchMatches, type ExtFilters } from '../../library/ext-filters.ts';
import { novelListings, pluginsAvailable } from '../novels/plugins.ts';

/**
 * EXTENSIONS, BROWSE's back room (Index-Extensions; doc/BROWSE.md,
 * "Extensions and repositories"; card c144): what the installed and
 * available lists show, and what removing one does. The installing itself
 * is extensions.ts's (c134).
 */

// ---- installed ------------------------------------------------------------------------------

export type InstalledRow = Installed & {
	/** Its sources BROWSE may name, as "2 OF 43 SOURCES SHOWN" counts them. */
	shown: BrowseSource[];
	/** Series here from it, as reveal lets the viewer see them. */
	series: number;
	hidden: number;
	/** No repository lists it any more: it still loads, and won't update. */
	obsolete: boolean;
	/** BACK TO this version, within the week it's kept; null when there's none. */
	backTo: string | null;
	mostlyHidden: boolean;
};

export type InstalledView = {
	/** Failed to load, or gone from its repository: 01 — NEEDS A HAND. */
	needsHand: InstalledRow[];
	/** A newer version waits: 02 — UPDATES. */
	updates: InstalledRow[];
	/** Up to date: 03 — INSTALLED. */
	current: InstalledRow[];
};

/**
 * The installed list (Index-Extensions, installed): NEEDS A HAND first, then
 * UPDATES, then the rest. Hidden means hidden: an extension whose every
 * source is mostly hidden is listed only in reveal, so it isn't in UPDATE
 * ALL either, which updates only what's shown.
 */
export function installedView(reveal: boolean, now = Date.now()): InstalledView {
	const visible = browseSources(reveal);
	const byPkg = new Map<string, BrowseSource[]>();
	for (const s of visible) byPkg.set(s.pkg, [...(byPkg.get(s.pkg) ?? []), s]);
	const all = browseSources(true);
	const rows: InstalledRow[] = [];
	for (const e of installed()) {
		const shown = byPkg.get(e.pkg) ?? [];
		const mine = all.filter((s) => s.pkg === e.pkg);
		// An extension with no sources yet (one that failed to load) is listed as itself.
		if (shown.length === 0 && mine.length > 0) continue;
		rows.push({
			...e,
			shown,
			series: shown.reduce((n, s) => n + s.series, 0),
			hidden: shown.reduce((n, s) => n + s.hidden, 0),
			obsolete: findListing(e.pkg, getDb()) === null,
			backTo:
				e.previousVersion && e.previousUntil && e.previousUntil > now ? e.previousVersion : null,
			mostlyHidden: shown.length > 0 && shown.every((s) => s.mostlyHidden)
		});
	}
	return {
		needsHand: rows.filter((r) => r.failed || r.obsolete),
		updates: rows.filter((r) => !r.failed && !r.obsolete && r.update),
		current: rows.filter((r) => !r.failed && !r.obsolete && !r.update)
	};
}

// ---- LNReader's plugins, as EXTENSIONS shows them ---------------------------------------------

/**
 * The installed plugins hidden outside reveal: their `ln:<id>` is not among
 * the sources BROWSE may name, because the owner switched on its HIDDEN
 * SOURCE or because it is mostly hidden (card c435; doc/BROWSE.md, "Hidden
 * means hidden"). Plugin ids, without `ln:`. Inside reveal, none.
 * `pluginView` and `pluginsAvailable` (novels/plugins.ts) take no reveal, so
 * EXTENSIONS asks this, as `installedView` asks `browseSources` for packages.
 */
export function pluginsHidden(reveal: boolean): Set<string> {
	if (reveal) return new Set();
	const shown = new Set(browseSources(false).map((s) => s.id));
	return new Set(
		browseSources(true)
			.filter((s) => s.family === 'lnreader' && !shown.has(s.id))
			.map((s) => s.id.slice(3))
	);
}

type PluginSections<R> = { needsHand: R[]; updates: R[]; current: R[] };

/**
 * INSTALLED's plugin sections (`pluginView`) with what reveal hides left
 * out, so the tab's count and UPDATE ALL, which updates only what's shown,
 * see only the rows drawn.
 */
export function pluginsShown<R extends { id: string }>(
	view: PluginSections<R>,
	reveal: boolean
): PluginSections<R> {
	const hidden = pluginsHidden(reveal);
	if (hidden.size === 0) return view;
	const keep = (rows: R[]) => rows.filter((r) => !hidden.has(r.id));
	return {
		needsHand: keep(view.needsHand),
		updates: keep(view.updates),
		current: keep(view.current)
	};
}

/**
 * AVAILABLE's NOVELS tab (`pluginsAvailable`) without an installed plugin
 * reveal hides: not a row, not in "+ N IN OTHER LANGUAGES", not in the
 * tab's count. A plugin not installed is never hidden: it has no use yet.
 */
export function novelsAvailable(opts: Parameters<typeof pluginsAvailable>[0]) {
	const view = pluginsAvailable(opts);
	const hidden = pluginsHidden(!!opts.reveal);
	if (hidden.size === 0) return view;
	const rows = view.rows.filter((r) => !hidden.has(r.id));
	// The matches in other languages are those every language would add.
	const everyLanguage = pluginsAvailable({
		...opts,
		filters: { ...(opts.filters ?? NO_EXT_FILTERS), langs: [] }
	}).rows;
	const drawn = new Set(view.rows.map((r) => r.id));
	const hiddenElsewhere = everyLanguage.filter((r) => !drawn.has(r.id) && hidden.has(r.id)).length;
	return {
		...view,
		rows,
		total: view.total - novelListings(opts.db).filter((l) => hidden.has(l.id)).length,
		otherLanguages: view.otherLanguages - hiddenElsewhere
	};
}

// ---- available ------------------------------------------------------------------------------

export type AvailableRow = Listing & {
	repoId: number;
	/** Its sources in the languages asked for. */
	sourcesShown: number;
	installed: boolean;
	/** Series here from it, as reveal lets the viewer see them. */
	series: number;
	hidden: number;
	mostlyHidden: boolean;
};

export type AvailableView = {
	rows: AvailableRow[];
	/** Per kind, what the tabs count: with the adult rule, not the language one. */
	counts: Record<Kind, number>;
	/** Matches whose sources are all in other languages: "+ 12 IN OTHER LANGUAGES · SHOW". */
	otherLanguages: number;
	/** Every language this kind's listings hold: LANGUAGE's choices. */
	languages: string[];
	/** The languages the list is in now (SETTINGS' unless the visit changed them; none is all). */
	asked: string[];
};

const LANGLESS = new Set(['all', 'multi', '']);

/**
 * The available list (Index-Extensions, available; doc/BROWSE.md, "Filters"):
 * every repository's listings of one kind, matching a search (case and
 * spacing ignored, against the extension's name and its sources'), narrowed
 * by AVAILABLE's filters (lib/library/ext-filters.ts). LANGUAGE starts from
 * SETTINGS' languages; none asked is every language. An 18+ extension is
 * listed for everyone, marked (the owner, 2026-10-31: Keiyoushi flags Weeb
 * Central, which a friend couldn't find); one whose every source here is
 * mostly hidden still isn't, with reveal off: hidden means hidden.
 */
export function availableView(opts: {
	kind: Kind;
	q?: string;
	filters?: ExtFilters;
	reveal: boolean;
}): AvailableView {
	const f = opts.filters ?? NO_EXT_FILTERS;
	const mine = browseLanguages();
	const asked = f.langs ?? mine;
	const wanted = (lang: string) =>
		asked.length === 0 || LANGLESS.has(lang.toLowerCase()) || asked.includes(lang.toLowerCase());
	const have = new Set(installed().map((e) => e.pkg));
	const sources = new Map<string, BrowseSource[]>();
	for (const s of browseSources(true)) sources.set(s.pkg, [...(sources.get(s.pkg) ?? []), s]);
	// One row a package, from the first repository that lists it.
	const seen = new Set<string>();
	const pool: AvailableRow[] = [];
	for (const l of listings()) {
		if (seen.has(l.pkg)) continue;
		seen.add(l.pkg);
		const theirs = sources.get(l.pkg) ?? [];
		const mostlyHidden = theirs.length > 0 && theirs.every((s) => s.mostlyHidden);
		if (!opts.reveal && mostlyHidden) continue;
		pool.push({
			...l,
			sourcesShown: l.sources.length,
			installed: have.has(l.pkg),
			series: theirs.reduce((n, s) => n + (opts.reveal ? s.series : s.series - s.hidden), 0),
			hidden: opts.reveal ? theirs.reduce((n, s) => n + s.hidden, 0) : 0,
			mostlyHidden
		});
	}
	const counts: Record<Kind, number> = { manga: 0, anime: 0 };
	for (const r of pool) counts[r.kind]++;
	const ofKind = pool.filter((r) => r.kind === opts.kind);
	const languages = [
		...new Set(
			ofKind.flatMap((r) =>
				r.sources.map((s) => s.lang.toLowerCase()).filter((l) => !LANGLESS.has(l))
			)
		)
	].sort();
	const matching = ofKind
		.filter(
			(r) =>
				searchMatches(opts.q ?? '', [r.name, ...r.sources.map((s) => s.name)]) &&
				(f.installed === 'any' || r.installed === (f.installed === 'yes')) &&
				(!f.repo || f.repo === `e${r.repoId}`) &&
				(f.adult === 'any' || r.adult === (f.adult === 'only')) &&
				(!f.library || r.series > 0)
		)
		.sort((a, b) => a.name.localeCompare(b.name, 'en', { sensitivity: 'base' }));
	const inLangs = (r: AvailableRow) =>
		r.sources.length === 0 || r.sources.some((s) => wanted(s.lang));
	const rows = matching.filter(inLangs).map((r) => ({
		...r,
		sourcesShown: r.sources.filter((s) => wanted(s.lang)).length || r.sources.length
	}));
	return {
		rows,
		counts,
		otherLanguages: matching.length - rows.length,
		languages,
		asked
	};
}

// ---- removing, and loading again --------------------------------------------------------------

export type Removal = {
	name: string;
	version: string;
	sources: number;
	/** Series here from it, as reveal lets the viewer see them. */
	series: number;
	/** Their chapters waiting in the queue, which leave it. */
	queued: number;
	/** Followed series that stop being checked for new chapters. */
	followed: number;
};

/** The source ids an extension holds. */
const sourcesOf = (pkg: string, db: Database.Database) =>
	(db.prepare(`SELECT id FROM engine_sources WHERE pkg = ?`).all(pkg) as { id: string }[]).map(
		(r) => r.id
	);

/** The library's series from [pkg]'s sources: the ids, hidden ones only with reveal. */
function seriesFrom(
	pkg: string,
	reveal: boolean,
	db: Database.Database
): { id: number; followed: boolean }[] {
	const ids = new Set(sourcesOf(pkg, db));
	const rows = db
		.prepare(
			`SELECT s.id, s.origin_key AS k, s.followed_at IS NOT NULL AS followed, NOT ${VISIBLE_SQL} AS hidden
			FROM series s JOIN roots r ON r.id = s.root_id WHERE ${IN_LIBRARY_SQL} AND s.origin_key LIKE 'mihon:%'`
		)
		.all() as { id: number; k: string; followed: number; hidden: number }[];
	return rows
		.filter((r) => ids.has(parseKey(r.k)?.sourceId ?? '') && (reveal || !r.hidden))
		.map((r) => ({ id: r.id, followed: r.followed === 1 }));
}

/**
 * What REMOVE's sheet says (Browse Calls, "Removing says what stays"): how
 * many series come from it (they stay, files and all), what stops (its
 * queued chapters, the followed series' checks), and its settings kept for a
 * reinstall. Counts are what reveal lets the viewer see.
 */
export function removal(
	pkg: string,
	reveal: boolean,
	db: Database.Database = getDb()
): Removal | null {
	const e = installed(db).find((x) => x.pkg === pkg);
	if (!e) return null;
	const series = seriesFrom(pkg, reveal, db);
	const ids = series.map((s) => s.id);
	const queued = ids.length
		? (
				db
					.prepare(
						`SELECT COUNT(*) AS n FROM download_queue WHERE series_id IN (${ids.map(() => '?').join(',')})`
					)
					.get(...ids) as { n: number }
			).n
		: 0;
	return {
		name: e.name,
		version: e.versionName,
		sources: e.sources.length,
		series: series.length,
		queued,
		followed: series.filter((s) => s.followed).length
	};
}

/**
 * Uninstalls [pkg], taking its series' chapters out of the queue (nothing
 * could download them) and leaving everything else: the series, their files,
 * the follow (which waits for a reinstall), and the source's settings.
 */
export function removeExtension(pkg: string, db: Database.Database = getDb()): void {
	const ids = seriesFrom(pkg, true, db).map((s) => s.id);
	db.transaction(() => {
		if (ids.length)
			db.prepare(
				`DELETE FROM download_queue WHERE state != 'downloading' AND series_id IN (${ids.map(() => '?').join(',')})`
			).run(...ids);
		remove(pkg, db);
	})();
}

/**
 * TRY AGAIN on an extension that failed to load: the same APK, kept in the
 * store, offered to the engine again (a fix to the engine, or the engine
 * back up, is what changes between tries). True when it loaded.
 */
export async function loadAgain(
	pkg: string,
	loader: (apk: Uint8Array) => Promise<{ info: ExtensionInfo }> = (apk) =>
		engineLoad<ExtensionInfo>(apk),
	db: Database.Database = getDb()
): Promise<boolean> {
	const row = db.prepare(`SELECT handle FROM engine_extensions WHERE pkg = ?`).get(pkg) as
		{ handle: string } | undefined;
	const path = row ? apkPath(row.handle) : '';
	if (!row || !existsSync(path)) return false;
	try {
		const { info } = await loader(new Uint8Array(readFileSync(path)));
		db.transaction(() => {
			db.prepare(`UPDATE engine_extensions SET failed = '', name = ? WHERE pkg = ?`).run(
				info.name,
				pkg
			);
			db.prepare(`DELETE FROM engine_sources WHERE pkg = ?`).run(pkg);
			const put = db.prepare(
				`INSERT OR REPLACE INTO engine_sources (id, pkg, name, lang, base_url) VALUES (?, ?, ?, ?, ?)`
			);
			for (const s of info.sources) put.run(String(s.id), pkg, s.name, s.lang, s.baseUrl ?? '');
		})();
		return true;
	} catch (e) {
		db.prepare(`UPDATE engine_extensions SET failed = ? WHERE pkg = ?`).run(
			(e as Error).message || 'failed to load',
			pkg
		);
		return false;
	}
}

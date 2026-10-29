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

// ---- available ------------------------------------------------------------------------------

export type AvailableRow = Listing & {
	repoId: number;
	/** Its sources in the languages asked for; all of them with ALL. */
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
	languages: string[];
};

const LANGLESS = new Set(['all', 'multi', '']);

/**
 * The available list (Index-Extensions, available): every repository's
 * listings of one kind, in the owner's languages unless ALL widens this
 * visit, matching a search. With reveal off an adult extension isn't listed
 * or counted (decided 2026-10-28), and neither is one whose every source here
 * is mostly hidden.
 */
export function availableView(opts: {
	kind: Kind;
	q?: string;
	all?: boolean;
	adult?: 'any' | 'only' | 'none';
	reveal: boolean;
}): AvailableView {
	const langs = browseLanguages();
	const wanted = (lang: string) =>
		LANGLESS.has(lang.toLowerCase()) || langs.includes(lang.toLowerCase());
	const have = new Set(installed().map((e) => e.pkg));
	const sources = new Map<string, BrowseSource[]>();
	for (const s of browseSources(true)) sources.set(s.pkg, [...(sources.get(s.pkg) ?? []), s]);
	// One row a package, from the first repository that lists it.
	const seen = new Set<string>();
	const pool: AvailableRow[] = [];
	for (const l of listings()) {
		if (seen.has(l.pkg)) continue;
		seen.add(l.pkg);
		const mine = sources.get(l.pkg) ?? [];
		const mostlyHidden = mine.length > 0 && mine.every((s) => s.mostlyHidden);
		if (!opts.reveal && (l.adult || mostlyHidden)) continue;
		if (opts.reveal && opts.adult === 'only' && !l.adult) continue;
		if (opts.reveal && opts.adult === 'none' && l.adult) continue;
		pool.push({
			...l,
			sourcesShown: l.sources.length,
			installed: have.has(l.pkg),
			series: mine.reduce((n, s) => n + (opts.reveal ? s.series : s.series - s.hidden), 0),
			hidden: opts.reveal ? mine.reduce((n, s) => n + s.hidden, 0) : 0,
			mostlyHidden
		});
	}
	const counts: Record<Kind, number> = { manga: 0, anime: 0 };
	for (const r of pool) counts[r.kind]++;
	const q = (opts.q ?? '').trim().toLowerCase();
	const matching = pool
		.filter((r) => r.kind === opts.kind && (!q || r.name.toLowerCase().includes(q)))
		.sort((a, b) => a.name.localeCompare(b.name, 'en', { sensitivity: 'base' }));
	const inLangs = (r: AvailableRow) =>
		r.sources.length === 0 || r.sources.some((s) => wanted(s.lang));
	const rows = opts.all
		? matching
		: matching.filter(inLangs).map((r) => ({
				...r,
				sourcesShown: r.sources.filter((s) => wanted(s.lang)).length || r.sources.length
			}));
	return {
		rows,
		counts,
		otherLanguages: opts.all ? 0 : matching.length - rows.length,
		languages: langs
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

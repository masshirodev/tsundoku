import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { join } from '../fspath.ts';
import type Database from 'better-sqlite3';
import { getDb } from '../db.ts';
import { IN_LIBRARY_SQL, VISIBLE_SQL, visibleWhere } from '../visibility.ts';
import {
	newer,
	NovelRepoError,
	parseIndex,
	repoUrl,
	type NovelListing
} from '../../library/lnreader-index.ts';
import { NovelHost, type HostOptions } from './host.ts';
import { fetchPage, solveChallenge } from './solver.ts';
import { dataPaths } from '../data-dirs.ts';
import { readCappedText } from '../net-guard.ts';
import { NO_EXT_FILTERS, searchMatches, type ExtFilters } from '../../library/ext-filters.ts';

/**
 * LNReader repositories and the plugins installed from them (doc/NOVELS.md),
 * as extensions.ts is for Mihon's. There's no signature to
 * check: the trust is the repository's address over https, and each plugin
 * file pinned by its SHA-256 once installed, so what runs is what was
 * fetched then, never a file that changed under it. A plugin must load in
 * the host before it's installed.
 */

/** A week, as for an extension (extensions.ts): BACK TO after an update. */
export const KEEP_PREVIOUS_MS = 7 * 24 * 60 * 60 * 1000;

const storeDir = () => dataPaths().novelStore;
export const pluginPath = (hash: string) => join(storeDir(), `${hash}.js`);

let host: NovelHost | null = null;
/**
 * The options the app's one host runs with: this store to read, and the app's
 * own solve for a site's check — never the host's, since it refuses local
 * addresses and a solver is one (novels/solver.ts), and its page
 * through the solver for a host whose check is bound to the browser.
 * Exported so the wiring that puts the cards into production can be pinned by
 * a spec.
 */
export function hostOptions(): HostOptions {
	return { store: storeDir(), solve: solveChallenge, page: fetchPage };
}

/** The one plugin host, reading this store. */
export function novelHost(): NovelHost {
	host ??= new NovelHost(hostOptions());
	return host;
}

export type Fetcher = (url: string) => Promise<{
	ok: boolean;
	status: number;
	text(): Promise<string>;
}>;
/** An index or a plugin is text of a few hundred kilobytes: past this it is something else. */
const MAX_TEXT_BYTES = 32 * 1024 * 1024;

const netFetch: Fetcher = async (url) => {
	const res = await fetch(url, { signal: AbortSignal.timeout(60_000) });
	return { ok: res.ok, status: res.status, text: () => readCappedText(res, MAX_TEXT_BYTES) };
};

async function getIndex(url: string, fetcher: Fetcher): Promise<NovelListing[]> {
	const res = await fetcher(url);
	if (!res.ok) throw new NovelRepoError(`${url} answered ${res.status}`);
	let json: unknown;
	try {
		json = JSON.parse(await res.text());
	} catch {
		throw new NovelRepoError(`${url} isn't JSON`);
	}
	return parseIndex(json);
}

/** A repository's name: the GitHub owner it's served from, or its host. */
function repoName(url: string): string {
	const u = new URL(url);
	const gh = /^\/([^/]+)\//.exec(u.pathname);
	return u.hostname === 'raw.githubusercontent.com' && gh ? gh[1] : u.hostname;
}

export type NovelRepoPreview = { url: string; name: string; listings: NovelListing[] };

/** What a pasted address holds, before anything is added. */
export async function previewNovelRepo(
	address: string,
	fetcher: Fetcher = netFetch
): Promise<NovelRepoPreview> {
	const url = repoUrl(address);
	return { url, name: repoName(url), listings: await getIndex(url, fetcher) };
}

function saveListings(db: Database.Database, repoId: number, listings: NovelListing[]) {
	db.prepare(`DELETE FROM novel_listings WHERE repo_id = ?`).run(repoId);
	const put = db.prepare(`INSERT INTO novel_listings (repo_id, plugin, listing) VALUES (?, ?, ?)`);
	for (const l of listings) put.run(repoId, l.id, JSON.stringify(l));
}

export async function addNovelRepo(
	address: string,
	now = Date.now(),
	fetcher: Fetcher = netFetch,
	db: Database.Database = getDb()
): Promise<number> {
	const p = await previewNovelRepo(address, fetcher);
	return db.transaction(() => {
		db.prepare(
			`INSERT INTO novel_repos (url, name, added_at, checked_at) VALUES (?, ?, ?, ?)
			ON CONFLICT (url) DO UPDATE SET name = excluded.name, checked_at = excluded.checked_at, failed_at = NULL, error = ''`
		).run(p.url, p.name, now, now);
		const id = (db.prepare(`SELECT id FROM novel_repos WHERE url = ?`).get(p.url) as { id: number })
			.id;
		saveListings(db, id, p.listings);
		return id;
	})();
}

/** Reads a repository's index again; one that stopped answering keeps its row and listings. */
export async function refreshNovelRepo(
	id: number,
	now = Date.now(),
	fetcher: Fetcher = netFetch,
	db: Database.Database = getDb()
): Promise<boolean> {
	const repo = db.prepare(`SELECT url FROM novel_repos WHERE id = ?`).get(id) as
		{ url: string } | undefined;
	if (!repo) return false;
	try {
		const listings = await getIndex(repo.url, fetcher);
		db.transaction(() => {
			db.prepare(
				`UPDATE novel_repos SET checked_at = ?, failed_at = NULL, error = '' WHERE id = ?`
			).run(now, id);
			saveListings(db, id, listings);
		})();
		return true;
	} catch (e) {
		db.prepare(
			`UPDATE novel_repos SET failed_at = COALESCE(failed_at, ?), error = ? WHERE id = ?`
		).run(now, (e as Error).message, id);
		return false;
	}
}

export function removeNovelRepo(id: number, db: Database.Database = getDb()): void {
	db.prepare(`DELETE FROM novel_repos WHERE id = ?`).run(id);
}

export type NovelRepo = {
	id: number;
	url: string;
	name: string;
	checkedAt: number | null;
	failedAt: number | null;
	error: string;
	plugins: number;
	installed: number;
};

export function listNovelRepos(db: Database.Database = getDb()): NovelRepo[] {
	return (
		db
			.prepare(
				`SELECT r.id, r.url, r.name, r.checked_at, r.failed_at, r.error,
					(SELECT COUNT(*) FROM novel_listings l WHERE l.repo_id = r.id) AS plugins,
					(SELECT COUNT(*) FROM novel_plugins p WHERE p.repo_id = r.id) AS installed
				FROM novel_repos r ORDER BY r.name`
			)
			.all() as {
			id: number;
			url: string;
			name: string;
			checked_at: number | null;
			failed_at: number | null;
			error: string;
			plugins: number;
			installed: number;
		}[]
	).map((r) => ({
		id: r.id,
		url: r.url,
		name: r.name,
		checkedAt: r.checked_at,
		failedAt: r.failed_at,
		error: r.error,
		plugins: r.plugins,
		installed: r.installed
	}));
}

/** Every repository's plugins, the first repository's where two list one. */
export function novelListings(
	db: Database.Database = getDb()
): (NovelListing & { repoId: number })[] {
	const seen = new Set<string>();
	const out: (NovelListing & { repoId: number })[] = [];
	for (const r of db
		.prepare(`SELECT repo_id, listing FROM novel_listings ORDER BY repo_id`)
		.all() as { repo_id: number; listing: string }[]) {
		const l = JSON.parse(r.listing) as NovelListing;
		if (seen.has(l.id)) continue;
		seen.add(l.id);
		out.push({ ...l, repoId: r.repo_id });
	}
	return out;
}

export function findNovelListing(id: string, db: Database.Database = getDb()) {
	return novelListings(db).find((l) => l.id === id) ?? null;
}

export type PluginLoader = (file: string) => Promise<{ name: string; version: string }>;
const hostLoader: PluginLoader = (file) => novelHost().info(file);

/**
 * Downloads [id]'s file from the repository that lists it, keeps it under
 * its hash, loads it in the host, and records it. An update keeps the
 * previous file a week for BACK TO. A file that won't load is kept, and
 * said so (NEEDS A HAND), as an extension that fails to load is.
 */
export async function installPlugin(
	id: string,
	now = Date.now(),
	fetcher: Fetcher = netFetch,
	loader: PluginLoader = hostLoader,
	db: Database.Database = getDb()
): Promise<void> {
	const listing = findNovelListing(id, db);
	if (!listing) throw new NovelRepoError(`No repository lists ${id}`);
	const res = await fetcher(listing.url);
	if (!res.ok) throw new NovelRepoError(`${listing.url} answered ${res.status}`);
	const code = await res.text();
	const hash = createHash('sha256').update(code).digest('hex');
	const path = pluginPath(hash);
	if (!existsSync(path)) {
		mkdirSync(storeDir(), { recursive: true });
		writeFileSync(`${path}.partial`, code);
		renameSync(`${path}.partial`, path);
	}
	let failed = '';
	let name = listing.name;
	let version = listing.version;
	try {
		const info = await loader(path);
		name = info.name || name;
		version = info.version || version;
	} catch (e) {
		failed = (e as Error).message || 'failed to load';
	}
	const before = db.prepare(`SELECT hash, version FROM novel_plugins WHERE id = ?`).get(id) as
		{ hash: string; version: string } | undefined;
	const isUpdate = !!before && before.hash !== hash;
	db.prepare(
		`INSERT INTO novel_plugins (id, repo_id, name, site, lang, version, hash, installed_at, updated_at, failed)
		VALUES (@id, @repo, @name, @site, @lang, @version, @hash, @now, @now, @failed)
		ON CONFLICT (id) DO UPDATE SET repo_id = @repo, name = @name, site = @site, lang = @lang,
			version = @version, hash = @hash, updated_at = @now, failed = @failed,
			previous_hash = CASE WHEN @isUpdate THEN novel_plugins.hash ELSE previous_hash END,
			previous_version = CASE WHEN @isUpdate THEN novel_plugins.version ELSE previous_version END,
			previous_until = CASE WHEN @isUpdate THEN @until ELSE previous_until END`
	).run({
		id,
		repo: listing.repoId,
		name,
		site: listing.site,
		lang: listing.lang,
		version,
		hash,
		now,
		failed,
		isUpdate: isUpdate ? 1 : 0,
		until: now + KEEP_PREVIOUS_MS
	});
}

/** BACK TO the version before the last update, within its week. */
export function backPlugin(id: string, now = Date.now(), db: Database.Database = getDb()): boolean {
	const row = db
		.prepare(
			`SELECT hash, version, previous_hash, previous_version, previous_until FROM novel_plugins WHERE id = ?`
		)
		.get(id) as
		| {
				hash: string;
				version: string;
				previous_hash: string | null;
				previous_version: string | null;
				previous_until: number | null;
		  }
		| undefined;
	if (
		!row?.previous_hash ||
		!row.previous_until ||
		row.previous_until < now ||
		!existsSync(pluginPath(row.previous_hash))
	)
		return false;
	db.prepare(
		`UPDATE novel_plugins SET hash = ?, version = ?, previous_hash = ?, previous_version = ?, updated_at = ?, failed = '' WHERE id = ?`
	).run(row.previous_hash, row.previous_version, row.hash, row.version, now, id);
	return true;
}

/** Uninstalls [id], its file too when nothing else keeps it. */
export function removePlugin(id: string, db: Database.Database = getDb()): void {
	const row = db.prepare(`SELECT hash, previous_hash FROM novel_plugins WHERE id = ?`).get(id) as
		{ hash: string; previous_hash: string | null } | undefined;
	if (!row) return;
	db.prepare(`DELETE FROM novel_plugins WHERE id = ?`).run(id);
	for (const h of [row.hash, row.previous_hash])
		if (
			h &&
			!db.prepare(`SELECT 1 FROM novel_plugins WHERE hash = ? OR previous_hash = ?`).get(h, h)
		)
			rmSync(pluginPath(h), { force: true });
}

export type InstalledPlugin = {
	id: string;
	name: string;
	site: string;
	lang: string;
	version: string;
	failed: string;
	repoId: number | null;
	/** The repository's newer version, when it has one. */
	update: string | null;
	previousVersion: string | null;
	previousUntil: number | null;
	/** No repository lists it any more. */
	obsolete: boolean;
	/** The file the host runs. */
	file: string;
};

export function installedPlugins(db: Database.Database = getDb()): InstalledPlugin[] {
	const listings = new Map(novelListings(db).map((l) => [l.id, l]));
	return (
		db
			.prepare(
				`SELECT id, name, site, lang, version, failed, repo_id, hash, previous_version, previous_until
				FROM novel_plugins ORDER BY name COLLATE NOCASE`
			)
			.all() as {
			id: string;
			name: string;
			site: string;
			lang: string;
			version: string;
			failed: string;
			repo_id: number | null;
			hash: string;
			previous_version: string | null;
			previous_until: number | null;
		}[]
	).map((r) => {
		const l = listings.get(r.id);
		return {
			id: r.id,
			name: r.name,
			site: r.site,
			lang: r.lang,
			version: r.version,
			failed: r.failed,
			repoId: r.repo_id,
			update: l && newer(l.version, r.version) ? l.version : null,
			previousVersion: r.previous_version,
			previousUntil: r.previous_until,
			obsolete: !l,
			file: pluginPath(r.hash)
		};
	});
}

// ---- EXTENSIONS' view of them ------------------------------------------------------

export type PluginRow = InstalledPlugin & {
	/** BACK TO this version, within its week; null when there's none. */
	backTo: string | null;
	/** Series here from it, as reveal lets the viewer see them. */
	series: number;
	/** Of those, how many are hidden: 0 with reveal off, as `installedView`'s. */
	hidden: number;
};

/**
 * INSTALLED's plugins, in its three sections: NEEDS A HAND, UPDATES, INSTALLED.
 * Each counts its series as reveal lets the viewer see them, as
 * `installedView` counts a Mihon package's: outside reveal a hidden series is
 * not one of its "N SERIES HERE". Which plugins are drawn at all is
 * `pluginsShown`'s (engine/manage.ts).
 */
export function pluginView(reveal: boolean, now = Date.now(), db: Database.Database = getDb()) {
	const counts = new Map<string, { series: number; hidden: number }>();
	for (const r of db
		.prepare(
			`SELECT s.origin_key AS k, NOT ${VISIBLE_SQL} AS hidden
			FROM series s JOIN roots r ON r.id = s.root_id
			WHERE ${IN_LIBRARY_SQL} AND ${visibleWhere(reveal)} AND s.origin_key LIKE 'lnreader:%'`
		)
		.all() as { k: string; hidden: number }[]) {
		const id = r.k.split(':')[1];
		const c = counts.get(id) ?? { series: 0, hidden: 0 };
		c.series++;
		c.hidden += r.hidden;
		counts.set(id, c);
	}
	const rows: PluginRow[] = installedPlugins(db).map((p) => ({
		...p,
		backTo:
			p.previousVersion && p.previousUntil && p.previousUntil > now ? p.previousVersion : null,
		series: counts.get(p.id)?.series ?? 0,
		hidden: counts.get(p.id)?.hidden ?? 0
	}));
	return {
		needsHand: rows.filter((r) => r.failed || r.obsolete),
		updates: rows.filter((r) => !r.failed && !r.obsolete && r.update),
		current: rows.filter((r) => !r.failed && !r.obsolete && !r.update)
	};
}

/**
 * AVAILABLE's NOVELS tab: every repository's plugins in the user's
 * languages (or all of them with ALL), matching a search. LNReader's index
 * marks nothing adult, so nothing is held back for reveal here.
 */
/**
 * The novels' available list, with AVAILABLE's filters (doc/BROWSE.md,
 * "Filters"; lib/library/ext-filters.ts): a search that ignores case and
 * spacing, the languages asked (SETTINGS' unless the visit changed them; none
 * is all), INSTALLED, REPOSITORY (`n<id>`) and IN LIBRARY. LNReader marks
 * nothing 18+, so ONLY lists none.
 */
export function pluginsAvailable(opts: {
	q?: string;
	filters?: ExtFilters;
	languages: string[];
	reveal?: boolean;
	db?: Database.Database;
}) {
	const db = opts.db ?? getDb();
	const f = opts.filters ?? NO_EXT_FILTERS;
	const asked = f.langs ?? opts.languages;
	const have = new Set(installedPlugins(db).map((p) => p.id));
	const all = novelListings(db);
	// Series here a plugin's sources hold, as the viewer may see them: IN LIBRARY.
	const inLibrary = new Set(
		(
			db
				.prepare(
					`SELECT DISTINCT s.origin_key FROM series s JOIN roots r ON r.id = s.root_id
					WHERE ${IN_LIBRARY_SQL} AND s.origin_key LIKE 'lnreader:%'${opts.reveal ? '' : ` AND ${VISIBLE_SQL}`}`
				)
				.all() as { origin_key: string }[]
		).map((r) => r.origin_key.split(':')[1])
	);
	const matching = all
		.filter(
			(l) =>
				searchMatches(opts.q ?? '', [l.name]) &&
				(f.installed === 'any' || have.has(l.id) === (f.installed === 'yes')) &&
				(!f.repo || f.repo === `n${l.repoId}`) &&
				f.adult !== 'only' &&
				(!f.library || inLibrary.has(l.id))
		)
		.sort((a, b) => a.name.localeCompare(b.name, 'en', { sensitivity: 'base' }))
		.map((l) => ({ ...l, installed: have.has(l.id) }));
	const wanted = (l: { lang: string }) =>
		asked.length === 0 || l.lang === 'multi' || asked.includes(l.lang.toLowerCase());
	const rows = matching.filter(wanted);
	const languages = [
		...new Set(all.map((l) => l.lang.toLowerCase()).filter((l) => l && l !== 'multi'))
	].sort();
	return {
		rows,
		total: all.length,
		otherLanguages: matching.length - rows.length,
		languages,
		asked
	};
}

/** TRY AGAIN on a plugin that failed to load: the same file, offered to the host again. */
export async function reloadPlugin(
	id: string,
	loader: PluginLoader = hostLoader,
	db: Database.Database = getDb()
): Promise<boolean> {
	const row = db.prepare(`SELECT hash FROM novel_plugins WHERE id = ?`).get(id) as
		{ hash: string } | undefined;
	if (!row || !existsSync(pluginPath(row.hash))) return false;
	// A fresh host: the old one may hold the file as it failed.
	host?.stop();
	try {
		const info = await loader(pluginPath(row.hash));
		db.prepare(`UPDATE novel_plugins SET failed = '', name = ? WHERE id = ?`).run(info.name, id);
		return true;
	} catch (e) {
		db.prepare(`UPDATE novel_plugins SET failed = ? WHERE id = ?`).run(
			(e as Error).message || 'failed to load',
			id
		);
		return false;
	}
}

/** What REMOVE's sheet says of a plugin: its series stay, its settings are kept. */
export function pluginRemoval(id: string, reveal: boolean, db: Database.Database = getDb()) {
	const p = installedPlugins(db).find((x) => x.id === id);
	if (!p) return null;
	const rows = db
		.prepare(
			`SELECT NOT ${VISIBLE_SQL} AS hidden, s.followed_at FROM series s JOIN roots r ON r.id = s.root_id
			WHERE ${IN_LIBRARY_SQL} AND s.origin_key LIKE ? ESCAPE '\\'`
		)
		.all(`lnreader:${id.replace(/[%_\\]/g, '\\$&')}:%`) as {
		hidden: number;
		followed_at: number | null;
	}[];
	const seen = rows.filter((r) => reveal || !r.hidden);
	return {
		name: p.name,
		version: p.version,
		sources: 1,
		series: seen.length,
		queued: 0,
		followed: seen.filter((r) => r.followed_at !== null).length
	};
}

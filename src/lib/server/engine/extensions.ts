import { existsSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { join } from '../fspath.ts';
import type Database from 'better-sqlite3';
import { getDb } from '../db.ts';
import { signedBy, signerFingerprints } from './apk-signature.ts';
import { handleOf, load as engineLoad, type Extension } from './client.ts';
import type { Preference } from './protocol.ts';
import {
	parseIndexLegacy,
	parseIndexV2,
	parseRepoJson,
	repoBase,
	RepoError,
	type Kind,
	type Listing,
	type RepoMeta
} from './repo-index.ts';
import { dataPaths } from '../data-dirs.ts';
import { apkUsesWebView } from './apk-webview.ts';
import { readCapped, readCappedText } from '../net-guard.ts';

/**
 * Repositories, installed extensions and their sources' preferences
 * (doc/DOWNLOADS.md, "Extensions"; card c136). The engine keeps none of it:
 * it runs whatever APK it's handed, so what's installed, which version, which
 * source is in which extension, and every preference live here, and the APKs
 * themselves in the store under TSUNDOKU_HOME.
 *
 * An APK is installed only when it is signed, validly, by the key its
 * repository publishes (apk-signature.ts). tsundoku ships no repository: the
 * owner adds them (doc/ARCHITECTURE.md, "Downloading").
 */

/** The previous version is kept this long after an update, for BACK TO (c126). */
export const KEEP_PREVIOUS_MS = 7 * 24 * 60 * 60 * 1000;

const storeDir = () => dataPaths().engineStore;
/** Extension icons, fetched from their repository once and kept (doc/BROWSE.md). */
export const iconsDir = () => join(storeDir(), 'icons');
export const apkPath = (handle: string) => join(storeDir(), `${handle}.apk`);

/**
 * Not signed by the key its repository lists. Carries both, so REVIEW can
 * show them side by side (c144); nothing was installed.
 */
export class UntrustedError extends Error {
	signers: string[];
	expected: string;
	constructor(message: string, signers: string[] = [], expected = '') {
		super(message);
		this.signers = signers;
		this.expected = expected;
	}
}

/** What fetching needs; injectable so the rules can be tested without a network. */
export type Fetcher = (url: string) => Promise<{
	ok: boolean;
	status: number;
	json(): Promise<unknown>;
	bytes(): Promise<Uint8Array>;
}>;
/**
 * What a repository may send: an index is text, an APK is an app of a few
 * megabytes. Past these it is not what it says, and is not read to the end.
 */
const MAX_INDEX_BYTES = 32 * 1024 * 1024;
const MAX_APK_BYTES = 128 * 1024 * 1024;

const netFetch: Fetcher = async (url) => {
	const res = await fetch(url, { signal: AbortSignal.timeout(60_000) });
	return {
		ok: res.ok,
		status: res.status,
		json: async () => JSON.parse(await readCappedText(res, MAX_INDEX_BYTES)) as unknown,
		bytes: async () => new Uint8Array(await readCapped(res, MAX_APK_BYTES))
	};
};

/** The engine's `extensionInfo` for an APK; injectable for the same reason. */
export type ExtensionInfo = {
	name: string;
	versionName: string;
	versionCode: number;
	sources: { id: string | number; name: string; lang: string; baseUrl?: string }[];
	/** The extension's code names android.webkit.WebView (the fork's, `engine-webview`). */
	usesWebView?: boolean;
};

/**
 * Whether an installed APK uses a WebView: the engine's word when it gave one
 * (`extensionInfo.usesWebView`), else the APK's own dex (an engine older than
 * the support, or one that refused to load it). Null when neither can say.
 */
export async function webviewFlag(
	info: { usesWebView?: unknown } | null,
	handle: string
): Promise<0 | 1 | null> {
	if (typeof info?.usesWebView === 'boolean') return info.usesWebView ? 1 : 0;
	const path = apkPath(handle);
	if (!existsSync(path)) return null;
	try {
		return (await apkUsesWebView(path)) ? 1 : 0;
	} catch {
		// Not a zip we can read: the engine's word, at its next load, will do.
		return null;
	}
}

let flagsFilled = false;

/**
 * Reads the WebView flag (rung 78) of every extension installed before it,
 * from its stored APK. Once a process: an install and a TRY AGAIN set the
 * flag themselves, so only rows from before the rung are ever unknown, and
 * an APK missing from the store stays unknown until its next install.
 */
export async function fillWebViewFlags(db: Database.Database = getDb()): Promise<number> {
	if (flagsFilled) return 0;
	flagsFilled = true;
	const rows = db
		.prepare(`SELECT pkg, handle FROM engine_extensions WHERE webview IS NULL`)
		.all() as { pkg: string; handle: string }[];
	let n = 0;
	for (const r of rows) {
		const flag = await webviewFlag(null, r.handle);
		if (flag === null) continue;
		db.prepare(`UPDATE engine_extensions SET webview = ? WHERE pkg = ? AND handle = ?`).run(
			flag,
			r.pkg,
			r.handle
		);
		n++;
	}
	return n;
}

/** For a test that fills twice in one process. */
export const refillWebViewFlags = () => {
	flagsFilled = false;
};
export type Loader = (apk: Uint8Array) => Promise<{ handle: string; info: ExtensionInfo }>;
const engineLoader: Loader = (apk) => engineLoad<ExtensionInfo>(apk);

async function getJson(fetcher: Fetcher, url: string): Promise<unknown> {
	const res = await fetcher(url);
	if (!res.ok) throw new RepoError(`${url} answered ${res.status}`);
	return res.json().catch(() => {
		throw new RepoError(`${url} isn't JSON`);
	});
}

export type RepoPreview = RepoMeta & { base: string; listings: Listing[] };

/**
 * What a pasted address holds, before anything is added: its name, key and
 * listings (c126: "a pasted address answers with the repository's own name,
 * its count and kind before anything is added").
 */
export async function previewRepo(
	address: string,
	fetcher: Fetcher = netFetch
): Promise<RepoPreview> {
	const base = repoBase(address);
	const meta = parseRepoJson(await getJson(fetcher, base + 'repo.json'));
	let listings: Listing[];
	try {
		const v2 = parseIndexV2(await getJson(fetcher, base + 'index.json'));
		// The index carries the key too; one that disagrees with repo.json is
		// someone else's index under this repository's name.
		if (v2.fingerprint && v2.fingerprint !== meta.fingerprint)
			throw new UntrustedError('The index is signed by a different key than the repository');
		listings = v2.listings;
	} catch (e) {
		if (e instanceof UntrustedError) throw e;
		listings = parseIndexLegacy(await getJson(fetcher, base + 'index.min.json'), base);
	}
	return { ...meta, base, listings };
}

function saveListings(db: Database.Database, repoId: number, listings: Listing[]) {
	db.prepare(`DELETE FROM engine_listings WHERE repo_id = ?`).run(repoId);
	const put = db.prepare(
		`INSERT OR REPLACE INTO engine_listings (repo_id, pkg, listing) VALUES (?, ?, ?)`
	);
	for (const l of listings) put.run(repoId, l.pkg, JSON.stringify(l));
}

export async function addRepo(
	address: string,
	now = Date.now(),
	fetcher: Fetcher = netFetch,
	db: Database.Database = getDb()
): Promise<number> {
	const p = await previewRepo(address, fetcher);
	return db.transaction(() => {
		const existing = db.prepare(`SELECT id FROM engine_repos WHERE base = ?`).get(p.base) as
			{ id: number } | undefined;
		const id =
			existing?.id ??
			Number(
				db
					.prepare(
						`INSERT INTO engine_repos (base, name, fingerprint, website, added_at, checked_at) VALUES (?, ?, ?, ?, ?, ?)`
					)
					.run(p.base, p.name, p.fingerprint, p.website, now, now).lastInsertRowid
			);
		db.prepare(
			`UPDATE engine_repos SET name = ?, fingerprint = ?, website = ?, checked_at = ?, failed_at = NULL, error = '' WHERE id = ?`
		).run(p.name, p.fingerprint, p.website, now, id);
		saveListings(db, id, p.listings);
		return id;
	})();
}

/**
 * Reads a repository's index again. One that stopped answering keeps its
 * row and the index read before, and says since when (c126: Kohi-den's
 * parked domain); what's installed from it keeps running.
 */
export async function refreshRepo(
	id: number,
	now = Date.now(),
	fetcher: Fetcher = netFetch,
	db: Database.Database = getDb()
): Promise<boolean> {
	const repo = db.prepare(`SELECT base, fingerprint FROM engine_repos WHERE id = ?`).get(id) as
		{ base: string; fingerprint: string } | undefined;
	if (!repo) return false;
	try {
		const p = await previewRepo(repo.base, fetcher);
		// A repository whose key changed is no longer the one the owner added.
		if (p.fingerprint !== repo.fingerprint)
			throw new UntrustedError('The repository’s signing key changed');
		db.transaction(() => {
			db.prepare(
				`UPDATE engine_repos SET name = ?, checked_at = ?, failed_at = NULL, error = '' WHERE id = ?`
			).run(p.name, now, id);
			saveListings(db, id, p.listings);
		})();
		return true;
	} catch (e) {
		db.prepare(
			`UPDATE engine_repos SET failed_at = COALESCE(failed_at, ?), error = ? WHERE id = ?`
		).run(now, (e as Error).message, id);
		return false;
	}
}

export function removeRepo(id: number, db: Database.Database = getDb()): void {
	db.prepare(`DELETE FROM engine_repos WHERE id = ?`).run(id);
}

export type Repo = {
	id: number;
	base: string;
	name: string;
	fingerprint: string;
	checkedAt: number | null;
	failedAt: number | null;
	error: string;
	counts: Record<Kind, number>;
	installed: number;
};

export function listRepos(db: Database.Database = getDb()): Repo[] {
	const rows = db
		.prepare(
			`SELECT r.id, r.base, r.name, r.fingerprint, r.checked_at, r.failed_at, r.error,
				(SELECT COUNT(*) FROM engine_extensions e WHERE e.repo_id = r.id) AS installed
			FROM engine_repos r ORDER BY r.name`
		)
		.all() as {
		id: number;
		base: string;
		name: string;
		fingerprint: string;
		checked_at: number | null;
		failed_at: number | null;
		error: string;
		installed: number;
	}[];
	return rows.map((r) => {
		const counts: Record<Kind, number> = { manga: 0, anime: 0 };
		for (const l of listingsOf(r.id, db)) counts[l.kind]++;
		return {
			id: r.id,
			base: r.base,
			name: r.name,
			fingerprint: r.fingerprint,
			checkedAt: r.checked_at,
			failedAt: r.failed_at,
			error: r.error,
			counts,
			installed: r.installed
		};
	});
}

function listingsOf(repoId: number, db: Database.Database): Listing[] {
	return (
		db.prepare(`SELECT listing FROM engine_listings WHERE repo_id = ?`).all(repoId) as {
			listing: string;
		}[]
	).map((r) => JSON.parse(r.listing) as Listing);
}

/** Every listing of every repository, with the repository it's from. */
export function listings(db: Database.Database = getDb()): (Listing & { repoId: number })[] {
	return (
		db.prepare(`SELECT repo_id, listing FROM engine_listings`).all() as {
			repo_id: number;
			listing: string;
		}[]
	).map((r) => ({ ...(JSON.parse(r.listing) as Listing), repoId: r.repo_id }));
}

export function findListing(
	pkg: string,
	db: Database.Database
): (Listing & { repoId: number; fingerprint: string }) | null {
	const row = db
		.prepare(
			`SELECT l.repo_id, l.listing, r.fingerprint FROM engine_listings l JOIN engine_repos r ON r.id = l.repo_id
			WHERE l.pkg = ? ORDER BY r.failed_at IS NOT NULL, r.id LIMIT 1`
		)
		.get(pkg) as { repo_id: number; listing: string; fingerprint: string } | undefined;
	return row
		? { ...(JSON.parse(row.listing) as Listing), repoId: row.repo_id, fingerprint: row.fingerprint }
		: null;
}

/** Keeps [apk] in the store under its handle, written beside and renamed, so a crash never leaves half an APK. */
function store(apk: Uint8Array): string {
	const handle = handleOf(apk);
	const path = apkPath(handle);
	if (!existsSync(path)) {
		mkdirSync(storeDir(), { recursive: true });
		writeFileSync(`${path}.partial`, apk);
		renameSync(`${path}.partial`, path);
	}
	return handle;
}

/**
 * Downloads [pkg]'s APK from the repository that lists it, checks it is
 * signed by that repository's key, keeps it, loads it into the engine, and
 * records it with its sources. An update keeps the previous version a week.
 * Throws UntrustedError (and installs nothing) when the signature doesn't hold.
 */
export async function install(
	pkg: string,
	now = Date.now(),
	fetcher: Fetcher = netFetch,
	loader: Loader = engineLoader,
	db: Database.Database = getDb()
): Promise<void> {
	let listing = findListing(pkg, db);
	if (!listing) throw new RepoError(`No repository lists ${pkg}`);
	let res = await fetcher(listing.apkUrl);
	// The index this install read can be days old, and a repository deletes an
	// APK when it publishes the next version: MoviesMod 16.4 answered 404 on a
	// friend's computer once the repository had 16.5 (2026-11-15). Read that
	// repository's index again, once, and ask for the APK it lists now.
	if (res.status === 404 || res.status === 410) {
		const gone = listing.apkUrl;
		await refreshRepo(listing.repoId, now, fetcher, db);
		const fresh = findListing(pkg, db);
		if (!fresh) throw new RepoError(`No repository lists ${pkg} any more`);
		if (fresh.apkUrl !== gone) {
			listing = fresh;
			res = await fetcher(listing.apkUrl);
		}
	}
	if (!res.ok) throw new RepoError(`${listing.apkUrl} answered ${res.status}`);
	const apk = await res.bytes();
	if (!signedBy(Buffer.from(apk), listing.fingerprint)) {
		let signers: string[] = [];
		try {
			signers = signerFingerprints(Buffer.from(apk));
		} catch {
			// Unsigned or malformed: no key to show beside the repository's.
		}
		throw new UntrustedError(
			`${listing.name} is not signed by its repository’s key`,
			signers,
			listing.fingerprint
		);
	}
	const handle = store(apk);
	let info: ExtensionInfo | null = null;
	let failed = '';
	try {
		info = (await loader(apk)).info;
	} catch (e) {
		// Kept installed, and said so: NEEDS A HAND · FAILED TO LOAD (c126).
		failed = (e as Error).message || 'failed to load';
	}
	const webview = await webviewFlag(info, handle);
	const before = db
		.prepare(`SELECT handle, version_name FROM engine_extensions WHERE pkg = ?`)
		.get(pkg) as { handle: string; version_name: string } | undefined;
	db.transaction(() => {
		const isUpdate = before && before.handle !== handle;
		db.prepare(
			`INSERT INTO engine_extensions (pkg, repo_id, name, kind, version_code, version_name, lib, adult, handle,
				previous_handle, previous_version, previous_until, installed_at, updated_at, failed, webview)
			VALUES (@pkg, @repo, @name, @kind, @code, @version, @lib, @adult, @handle, NULL, NULL, NULL, @now, @now, @failed, @webview)
			ON CONFLICT (pkg) DO UPDATE SET repo_id = @repo, name = @name, kind = @kind, version_code = @code,
				version_name = @version, lib = @lib, adult = @adult, handle = @handle, updated_at = @now, failed = @failed,
				webview = @webview,
				previous_handle = CASE WHEN @isUpdate THEN engine_extensions.handle ELSE previous_handle END,
				previous_version = CASE WHEN @isUpdate THEN engine_extensions.version_name ELSE previous_version END,
				previous_until = CASE WHEN @isUpdate THEN @until ELSE previous_until END`
		).run({
			pkg,
			repo: listing.repoId,
			name: info?.name || listing.name,
			kind: listing.kind,
			code: listing.versionCode,
			version: info?.versionName || listing.versionName,
			lib: listing.lib,
			adult: listing.adult ? 1 : 0,
			handle,
			now,
			failed,
			webview,
			isUpdate: isUpdate ? 1 : 0,
			until: now + KEEP_PREVIOUS_MS
		});
		setSources(
			db,
			pkg,
			info ? info.sources.map((s) => ({ ...s, id: String(s.id) })) : listing.sources
		);
	})();
}

function setSources(
	db: Database.Database,
	pkg: string,
	sources: { id: string; name: string; lang: string; baseUrl?: string }[]
) {
	db.prepare(`DELETE FROM engine_sources WHERE pkg = ?`).run(pkg);
	const put = db.prepare(
		`INSERT OR REPLACE INTO engine_sources (id, pkg, name, lang, base_url) VALUES (?, ?, ?, ?, ?)`
	);
	for (const s of sources) put.run(s.id, pkg, s.name, s.lang, s.baseUrl ?? '');
}

/**
 * BACK TO the version before the last update, within the week it's kept: a
 * broken update one tap from undone (c126, decided 2026-10-28).
 */
export function back(pkg: string, now = Date.now(), db: Database.Database = getDb()): boolean {
	const row = db
		.prepare(
			`SELECT handle, version_name, previous_handle, previous_version, previous_until FROM engine_extensions WHERE pkg = ?`
		)
		.get(pkg) as
		| {
				handle: string;
				version_name: string;
				previous_handle: string | null;
				previous_version: string | null;
				previous_until: number | null;
		  }
		| undefined;
	if (
		!row?.previous_handle ||
		!row.previous_until ||
		row.previous_until < now ||
		!existsSync(apkPath(row.previous_handle))
	)
		return false;
	db.prepare(
		`UPDATE engine_extensions SET handle = ?, version_name = ?, previous_handle = ?, previous_version = ?, updated_at = ?, failed = '', webview = NULL WHERE pkg = ?`
	).run(row.previous_handle, row.previous_version, row.handle, row.version_name, now, pkg);
	// The version gone back to may differ in its WebView: read again on the next visit.
	flagsFilled = false;
	return true;
}

/** Uninstalls [pkg]. Its sources go; their preferences stay for a reinstall. */
export function remove(pkg: string, db: Database.Database = getDb()): void {
	const row = db
		.prepare(`SELECT handle, previous_handle FROM engine_extensions WHERE pkg = ?`)
		.get(pkg) as { handle: string; previous_handle: string | null } | undefined;
	if (!row) return;
	db.prepare(`DELETE FROM engine_extensions WHERE pkg = ?`).run(pkg);
	for (const h of [row.handle, row.previous_handle])
		if (
			h &&
			!db
				.prepare(`SELECT 1 FROM engine_extensions WHERE handle = ? OR previous_handle = ?`)
				.get(h, h)
		)
			rmSync(apkPath(h), { force: true });
}

/** Drops previous versions older than their week. */
export function prunePrevious(now = Date.now(), db: Database.Database = getDb()): number {
	const old = db
		.prepare(
			`SELECT pkg, previous_handle FROM engine_extensions WHERE previous_until IS NOT NULL AND previous_until < ?`
		)
		.all(now) as { pkg: string; previous_handle: string }[];
	for (const o of old) {
		db.prepare(
			`UPDATE engine_extensions SET previous_handle = NULL, previous_version = NULL, previous_until = NULL WHERE pkg = ?`
		).run(o.pkg);
		if (!db.prepare(`SELECT 1 FROM engine_extensions WHERE handle = ?`).get(o.previous_handle))
			rmSync(apkPath(o.previous_handle), { force: true });
	}
	return old.length;
}

export type Installed = {
	pkg: string;
	name: string;
	kind: Kind;
	versionName: string;
	versionCode: number;
	adult: boolean;
	failed: string;
	repoId: number | null;
	previousVersion: string | null;
	previousUntil: number | null;
	/** The repository's newer version, when it has one. */
	update: string | null;
	sources: { id: string; name: string; lang: string }[];
	/** Its code uses a WebView (rung 78): NEEDS A WEBVIEW. False while not known. */
	webview: boolean;
};

export function installed(db: Database.Database = getDb()): Installed[] {
	const rows = db
		.prepare(
			`SELECT pkg, name, kind, version_name, version_code, adult, failed, repo_id, previous_version, previous_until, webview
			FROM engine_extensions ORDER BY name COLLATE NOCASE`
		)
		.all() as {
		pkg: string;
		name: string;
		kind: Kind;
		version_name: string;
		version_code: number;
		adult: number;
		failed: string;
		repo_id: number | null;
		previous_version: string | null;
		previous_until: number | null;
		webview: number | null;
	}[];
	const sources = db.prepare(
		`SELECT id, name, lang FROM engine_sources WHERE pkg = ? ORDER BY lang, name`
	);
	return rows.map((r) => {
		const listing = findListing(r.pkg, db);
		return {
			pkg: r.pkg,
			name: r.name,
			kind: r.kind,
			versionName: r.version_name,
			versionCode: r.version_code,
			adult: r.adult === 1,
			failed: r.failed,
			repoId: r.repo_id,
			previousVersion: r.previous_version,
			previousUntil: r.previous_until,
			update: listing && listing.versionCode > r.version_code ? listing.versionName : null,
			sources: sources.all(r.pkg) as { id: string; name: string; lang: string }[],
			webview: r.webview === 1
		};
	});
}

/**
 * What the engine client needs to call a source: its extension's handle and
 * a way to read the APK if the engine asks for it. Null for a source no
 * installed extension has.
 */
export function extensionFor(
	sourceId: string,
	db: Database.Database = getDb()
): (Extension & { pkg: string }) | null {
	const row = db
		.prepare(
			`SELECT e.pkg, e.handle FROM engine_sources s JOIN engine_extensions e ON e.pkg = s.pkg WHERE s.id = ? AND e.failed = ''`
		)
		.get(sourceId) as { pkg: string; handle: string } | undefined;
	if (!row) return null;
	return {
		pkg: row.pkg,
		handle: row.handle,
		apk: async () => new Uint8Array(readFileSync(apkPath(row.handle)))
	};
}

/** A source's preferences as tsundoku keeps them, to send with every call. */
export function preferences(sourceId: string, db: Database.Database = getDb()): Preference[] {
	return (
		db
			.prepare(`SELECT entry FROM engine_preferences WHERE source_id = ? ORDER BY key`)
			.all(sourceId) as { entry: string }[]
	).map((r) => JSON.parse(r.entry) as Preference);
}

/**
 * Keeps the preferences a source describes (`preferencesManga`), with the
 * values tsundoku already holds for keys it knows: the engine's description
 * is the shape, tsundoku's copy is the value.
 */
export function keepPreferences(
	sourceId: string,
	described: Preference[],
	db: Database.Database = getDb()
): void {
	const mine = new Map(preferences(sourceId, db).map((p) => [p.key, p]));
	const put = db.prepare(
		`INSERT OR REPLACE INTO engine_preferences (source_id, key, entry) VALUES (?, ?, ?)`
	);
	db.transaction(() => {
		for (const p of described) {
			const kept = mine.get(p.key);
			put.run(sourceId, p.key, JSON.stringify(kept ? withValueOf(p, kept) : p));
		}
	})();
}

/** [shape] with the value [from] holds, when both are the same type of preference. */
function withValueOf(shape: Preference, from: Preference): Preference {
	const type = Object.keys(shape).find((k) => k !== 'key');
	if (!type || !(type in from)) return shape;
	const s = shape[type] as Record<string, unknown>;
	const f = from[type] as Record<string, unknown>;
	const value = (['value', 'valueIndex', 'values'] as const).find((k) => k in f);
	return value ? { ...shape, [type]: { ...s, [value]: f[value] } } : shape;
}

/** Sets one preference's value; the next call sends it. */
export function setPreference(
	sourceId: string,
	key: string,
	value: boolean | string | number | string[],
	db: Database.Database = getDb()
): boolean {
	const row = db
		.prepare(`SELECT entry FROM engine_preferences WHERE source_id = ? AND key = ?`)
		.get(sourceId, key) as { entry: string } | undefined;
	if (!row) return false;
	const entry = JSON.parse(row.entry) as Preference;
	const type = Object.keys(entry).find((k) => k !== 'key');
	if (!type) return false;
	const field =
		type === 'listPreference'
			? 'valueIndex'
			: type === 'multiSelectListPreference'
				? 'values'
				: 'value';
	entry[type] = { ...(entry[type] as Record<string, unknown>), [field]: value };
	db.prepare(`UPDATE engine_preferences SET entry = ? WHERE source_id = ? AND key = ?`).run(
		JSON.stringify(entry),
		sourceId,
		key
	);
	return true;
}

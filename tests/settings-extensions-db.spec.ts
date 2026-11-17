import { describe, expect, it, vi } from 'vitest';

/**
 * SETTINGS › 07 — BROWSE's EXTENSIONS row (c725; doc/SETTINGS.md): the counts
 * it draws are the ones EXTENSIONS' own INSTALLED tab draws, from SETTINGS'
 * load as SvelteKit runs it, on a library with every kind of installed row:
 * up to date, an update waiting, one that failed to load, one gone from its
 * repository, and LNReader plugins, one with an update and one whose HIDDEN
 * SOURCE switch is on (counted only inside reveal).
 *
 * The engine is set up (ENGINE_URL and ENGINE_TOKEN) at an address nothing
 * answers, as on a friend's install whose engine has stopped: the counts are
 * the database's record, so they are the same as with it running. With no
 * engine at all, SETTINGS has no 07 and so no row, as EXTENSIONS has no page.
 */

process.env.DATABASE_PATH = ':memory:';
process.env.ENGINE_URL = 'http://127.0.0.1:1';
process.env.ENGINE_TOKEN = 'settings-extensions-db';
vi.mock('$env/dynamic/private', () => ({ env: process.env }));
// SETTINGS' load asks GitHub for a friend's updates: never from a test.
vi.mock('$lib/server/updates', () => ({ checkIfStale: () => {}, updateView: () => null }));

const { getDb } = await import('$lib/server/db');
const { setSourceFlag } = await import('$lib/server/engine/source-flags');
const settingsPage = await import('../src/routes/settings/+page.server');
const extensionsPage = await import('../src/routes/browse/extensions/+page.server');
// Reveal is a value only the server makes (prefs.ts), never a bare '1'.
const { revealValue } = await import('$lib/server/prefs');

const db = getDb();
db.exec(`INSERT INTO engine_repos (id, base, name, fingerprint, added_at) VALUES (1, 'https://r/', 'Repo', 'f', 0);
	INSERT INTO novel_repos (id, url, name, added_at) VALUES (1, 'https://n/plugins.min.json', 'Plugins', 0);`);

const ext = (pkg: string, code: number, failed = '') =>
	db
		.prepare(
			`INSERT INTO engine_extensions (pkg, repo_id, name, kind, version_code, version_name, lib, handle, installed_at, updated_at, failed)
			VALUES (?, 1, ?, 'manga', ?, '1.0', '1.4', ?, 0, 0, ?)`
		)
		.run(pkg, pkg, code, pkg.padEnd(64, '0'), failed);
const listing = (pkg: string, code: number) =>
	db.prepare(`INSERT INTO engine_listings (repo_id, pkg, listing) VALUES (1, ?, ?)`).run(
		pkg,
		JSON.stringify({
			pkg,
			name: pkg,
			kind: 'manga',
			versionCode: code,
			versionName: `${code}.0`,
			lib: '1.4',
			adult: false,
			apkUrl: '',
			jarUrl: null,
			iconUrl: null,
			sources: [{ id: `${pkg}-0`, name: pkg, lang: 'en', baseUrl: '' }]
		})
	);
const src = (id: string, pkg: string) =>
	db
		.prepare(
			`INSERT INTO engine_sources (id, pkg, name, lang, base_url) VALUES (?, ?, ?, 'en', '')`
		)
		.run(id, pkg, pkg);
const plugin = (id: string, version: string, listed: string) => {
	db.prepare(
		`INSERT INTO novel_plugins (id, repo_id, name, site, lang, version, hash, installed_at, updated_at, failed)
		VALUES (?, 1, ?, 'https://novel.example/', 'en', ?, 'h', 0, 0, '')`
	).run(id, id, version);
	db.prepare(`INSERT INTO novel_listings (repo_id, plugin, listing) VALUES (1, ?, ?)`).run(
		id,
		JSON.stringify({
			id,
			name: id,
			site: 'https://novel.example/',
			lang: 'English',
			version: listed,
			url: `https://n/${id}.js`,
			iconUrl: ''
		})
	);
};

// Up to date; an update waiting (listed 2, installed 1); one that failed to
// load; one gone from its repository (no listing).
ext('e2e.current', 1);
listing('e2e.current', 1);
src('900', 'e2e.current');
ext('e2e.update', 1);
listing('e2e.update', 2);
src('901', 'e2e.update');
ext('e2e.failed', 1, 'no such class');
listing('e2e.failed', 1);
ext('e2e.gone', 1);
src('903', 'e2e.gone');
// Two plugins with a newer version listed, one of them a hidden source.
plugin('shown', '1.0.0', '1.1.0');
plugin('secret', '1.0.0', '1.1.0');
setSourceFlag('ln:secret', 'hidden', true);

type Counts = { installed: number; updates: number };

async function settingsCounts(reveal: boolean): Promise<Counts | null> {
	const url = new URL('http://localhost/settings');
	const data = (await settingsPage.load({
		cookies: {
			get: (n: string) => (reveal && n === 'tsundoku_reveal' ? revealValue(undefined) : undefined)
		},
		url,
		locals: { via: 'local', paired: null },
		isDataRequest: true,
		request: new Request(url)
	} as never)) as { browse: { extensions: Counts } | null };
	return data.browse?.extensions ?? null;
}

/** What EXTENSIONS' INSTALLED tab says: its count, and its two update sections. */
async function extensionsCounts(reveal: boolean): Promise<Counts> {
	const url = new URL('http://localhost/browse/extensions');
	const data = (await extensionsPage.load({
		url,
		cookies: {
			get: (n: string) => (reveal && n === 'tsundoku_reveal' ? revealValue(undefined) : undefined)
		}
	} as never)) as {
		counts: { installed: number };
		installed: { updates: unknown[] };
		plugins: { updates: unknown[] };
	};
	return {
		installed: data.counts.installed,
		updates: data.installed.updates.length + data.plugins.updates.length
	};
}

describe('the EXTENSIONS row in SETTINGS (c725)', () => {
	it('reads the real counts, the ones EXTENSIONS itself draws', async () => {
		// Four APKs and the one plugin not hidden; the APK and the plugin with updates.
		expect(await settingsCounts(false)).toEqual({ installed: 5, updates: 2 });
		expect(await settingsCounts(false)).toEqual(await extensionsCounts(false));
	});
	it('counts a hidden source only inside reveal, as EXTENSIONS does', async () => {
		const { isRevealed } = await import('$lib/server/prefs');
		// The reveal cookie as the app names and signs it: the case is only as good as this.
		const revealed = isRevealed({
			get: (n: string) => (n === 'tsundoku_reveal' ? revealValue(undefined) : undefined)
		} as never);
		expect(revealed).toBe(true);
		expect(await settingsCounts(true)).toEqual({ installed: 6, updates: 3 });
		expect(await settingsCounts(true)).toEqual(await extensionsCounts(true));
	});
	it('follows an install and an update as they happen', async () => {
		ext('e2e.later', 1);
		listing('e2e.later', 3);
		src('904', 'e2e.later');
		expect(await settingsCounts(false)).toEqual({ installed: 6, updates: 3 });
		db.prepare(`UPDATE engine_extensions SET version_code = 3 WHERE pkg = 'e2e.later'`).run();
		expect(await settingsCounts(false)).toEqual({ installed: 6, updates: 2 });
		expect(await settingsCounts(false)).toEqual(await extensionsCounts(false));
	});
	it('has no row without an engine, where EXTENSIONS has no page', async () => {
		const token = process.env.ENGINE_TOKEN;
		delete process.env.ENGINE_TOKEN;
		try {
			expect(await settingsCounts(false)).toBeNull();
			await expect(extensionsCounts(false)).rejects.toMatchObject({ status: 404 });
		} finally {
			process.env.ENGINE_TOKEN = token;
		}
	});
});

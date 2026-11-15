import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

// Before anything imports db.ts: getDb() reads this once and memoises.
process.env.DATABASE_PATH = ':memory:';
const store = mkdtempSync(join(tmpdir(), 'tsundoku-engine-store-'));
process.env.ENGINE_STORE = store;

const { getDb } = await import('$lib/server/db');
const ext = await import('$lib/server/engine/extensions');
const { handleOf } = await import('$lib/server/engine/client');
const { zip } = await import('$lib/server/zip-write');
type Fetcher = import('$lib/server/engine/extensions').Fetcher;
type Loader = import('$lib/server/engine/extensions').Loader;

afterAll(() => rmSync(store, { recursive: true, force: true }));

// Two real Keiyoushi-signed APKs (tests/fixtures/apk/README.md).
const webtoons = new Uint8Array(
	readFileSync('tests/fixtures/apk/tachiyomi-all.webtoons-v1.6.2.apk')
);
const mangadex = new Uint8Array(
	readFileSync('tests/fixtures/apk/tachiyomi-all.mangadex-v1.6.0.apk')
);
const KEIYOUSHI = '9add655a78e96c4ec7a53ef89dccb557cb5d767489fac5e785d671a5a75d4da2';
const BASE = 'https://repo.example/keiyoushi/';
const PKG = 'eu.kanade.tachiyomi.extension.all.webtoons';

const listing = (code: number, apk: string) => ({
	name: 'Webtoons.com',
	packageName: PKG,
	resources: { apkUrl: `${BASE}${apk}`, iconUrl: '', jarUrl: '' },
	extensionLib: '1.6',
	versionCode: String(code),
	versionName: `1.6.${code}`,
	contentWarning: 'CONTENT_WARNING_SAFE',
	sources: [
		{
			id: '2522335540328470744',
			name: 'Webtoons.com',
			language: 'en',
			homeUrl: 'https://www.webtoons.com'
		}
	]
});

/** A fake web: the repository's files, and nothing else. */
let files: Record<string, unknown>;
const fetcher: Fetcher = async (url) => {
	const f = files[url];
	return {
		ok: f !== undefined,
		status: f === undefined ? 404 : 200,
		json: async () => f,
		bytes: async () => f as Uint8Array
	};
};
const repoJson = (fingerprint = KEIYOUSHI) => ({
	meta: { name: 'Keiyoushi', signingKeyFingerprint: fingerprint }
});
const index = (...entries: unknown[]) => ({
	name: 'Keiyoushi',
	signingKey: KEIYOUSHI,
	extensionList: { extensions: entries }
});

let loads: Uint8Array[];
const loader: Loader = async (apk) => {
	loads.push(apk);
	// Each APK reports its own version, so a swap that went wrong would show.
	const version = handleOf(apk) === handleOf(mangadex) ? '1.6.3' : '1.6.2';
	return {
		handle: handleOf(apk),
		info: {
			name: 'Webtoons.com',
			versionName: version,
			versionCode: 0,
			sources: [{ id: '2522335540328470744', name: 'Webtoons.com', lang: 'en' }]
		}
	};
};

const db = getDb();
beforeEach(() => {
	db.exec(
		`DELETE FROM engine_preferences; DELETE FROM engine_extensions; DELETE FROM engine_repos;`
	);
	loads = [];
	files = {
		[`${BASE}repo.json`]: repoJson(),
		[`${BASE}index.json`]: index(listing(2, 'webtoons.apk')),
		[`${BASE}webtoons.apk`]: webtoons,
		[`${BASE}mangadex.apk`]: mangadex
	};
});

describe('repositories', () => {
	it('answers with what an address holds before anything is added', async () => {
		const p = await ext.previewRepo(`${BASE}index.min.json`, fetcher);
		expect(p).toMatchObject({ name: 'Keiyoushi', fingerprint: KEIYOUSHI, base: BASE });
		expect(p.listings.map((l) => l.pkg)).toEqual([PKG]);
		expect(db.prepare(`SELECT COUNT(*) AS n FROM engine_repos`).get()).toEqual({ n: 0 });
	});

	it('falls back to index.min.json for an older repository', async () => {
		delete files[`${BASE}index.json`];
		files[`${BASE}index.min.json`] = [
			{
				name: 'Tachiyomi: Webtoons.com',
				pkg: PKG,
				apk: 'webtoons.apk',
				code: 2,
				version: '1.6.2',
				nsfw: 0,
				sources: []
			}
		];
		const p = await ext.previewRepo(BASE, fetcher);
		expect(p.listings[0].apkUrl).toBe(`${BASE}apk/webtoons.apk`);
	});

	it('refuses an index signed by another key than its repository', async () => {
		files[`${BASE}index.json`] = { ...index(), signingKey: 'f'.repeat(64) };
		await expect(ext.previewRepo(BASE, fetcher)).rejects.toBeInstanceOf(ext.UntrustedError);
	});

	it('adds one once, and lists it with its counts', async () => {
		await ext.addRepo(BASE, 1000, fetcher);
		const id = await ext.addRepo(`${BASE}repo.json`, 2000, fetcher);
		const [r] = ext.listRepos();
		expect(ext.listRepos()).toHaveLength(1);
		expect(r).toMatchObject({
			id,
			name: 'Keiyoushi',
			checkedAt: 2000,
			failedAt: null,
			counts: { manga: 1, anime: 0 }
		});
	});

	// Kohi-den's parked domain: the row stays, with what was installed from it.
	it('keeps a repository that stopped answering, and since when', async () => {
		const id = await ext.addRepo(BASE, 1000, fetcher);
		files = {};
		expect(await ext.refreshRepo(id, 5000, fetcher)).toBe(false);
		expect(await ext.refreshRepo(id, 9000, fetcher)).toBe(false);
		const [r] = ext.listRepos();
		expect(r).toMatchObject({ failedAt: 5000, counts: { manga: 1 } });
		expect(r.error).toMatch(/404/);
	});

	it('stops trusting a repository whose key changed', async () => {
		const id = await ext.addRepo(BASE, 1000, fetcher);
		files[`${BASE}repo.json`] = repoJson('a'.repeat(64));
		files[`${BASE}index.json`] = {
			...index(listing(2, 'webtoons.apk')),
			signingKey: 'a'.repeat(64)
		};
		expect(await ext.refreshRepo(id, 2000, fetcher)).toBe(false);
		expect(ext.listRepos()[0].error).toMatch(/signing key changed/);
	});
});

describe('installing', () => {
	it('checks the signature, keeps the APK, loads it and records its sources', async () => {
		await ext.addRepo(BASE, 1000, fetcher);
		await ext.install(PKG, 2000, fetcher, loader);

		const [i] = ext.installed();
		expect(i).toMatchObject({
			pkg: PKG,
			kind: 'manga',
			versionName: '1.6.2',
			failed: '',
			update: null
		});
		expect(i.sources).toEqual([{ id: '2522335540328470744', name: 'Webtoons.com', lang: 'en' }]);
		const e = ext.extensionFor('2522335540328470744')!;
		expect(e.handle).toBe(handleOf(webtoons));
		expect(await e.apk()).toEqual(webtoons);
		expect(existsSync(join(store, `${e.handle}.apk`))).toBe(true);
		expect(loads).toHaveLength(1);
	});

	it('installs nothing that isn’t signed by its repository', async () => {
		await ext.addRepo(BASE, 1000, fetcher);
		const forged = new Uint8Array(webtoons);
		forged[100] ^= 1;
		files[`${BASE}webtoons.apk`] = forged;

		await expect(ext.install(PKG, 2000, fetcher, loader)).rejects.toBeInstanceOf(
			ext.UntrustedError
		);
		expect(ext.installed()).toEqual([]);
		expect(loads).toEqual([]);
		expect(existsSync(join(store, `${handleOf(forged)}.apk`))).toBe(false);
	});

	// MoviesMod on a friend's computer, 2026-11-15: the index read days before
	// named 16.4, and the repository had replaced it with 16.5 and deleted it.
	it('reads the index again when the APK it named is gone, and installs the one it names now', async () => {
		await ext.addRepo(BASE, 1000, fetcher);
		delete files[`${BASE}webtoons.apk`];
		files[`${BASE}index.json`] = index(listing(3, 'webtoons-new.apk'));
		files[`${BASE}webtoons-new.apk`] = webtoons;

		await ext.install(PKG, 2000, fetcher, loader);
		expect(ext.installed()).toHaveLength(1);
		expect(loads).toHaveLength(1);
		expect(ext.listRepos()[0]).toMatchObject({ checkedAt: 2000, failedAt: null });
	});

	it('still says which URL answered 404 when the fresh index names the same APK', async () => {
		await ext.addRepo(BASE, 1000, fetcher);
		delete files[`${BASE}webtoons.apk`];
		await expect(ext.install(PKG, 2000, fetcher, loader)).rejects.toThrow(
			`${BASE}webtoons.apk answered 404`
		);
		expect(ext.installed()).toEqual([]);
	});

	it('says so when the fresh index no longer lists the package at all', async () => {
		await ext.addRepo(BASE, 1000, fetcher);
		delete files[`${BASE}webtoons.apk`];
		files[`${BASE}index.json`] = index();
		await expect(ext.install(PKG, 2000, fetcher, loader)).rejects.toThrow(
			`No repository lists ${PKG} any more`
		);
	});

	it('keeps one that fails to load, says why, and gives it to no call', async () => {
		await ext.addRepo(BASE, 1000, fetcher);
		await ext.install(PKG, 2000, fetcher, async () => {
			throw new Error('No Injekt instance for ProtoBuf');
		});
		expect(ext.installed()[0].failed).toBe('No Injekt instance for ProtoBuf');
		expect(ext.extensionFor('2522335540328470744')).toBeNull();
	});
});

describe('whether it uses a WebView (rung 78; doc/BROWSE.md, "Extensions that need a WebView")', () => {
	it('takes the engine’s word at install', async () => {
		await ext.addRepo(BASE, 1000, fetcher);
		await ext.install(PKG, 2000, fetcher, async (apk) => {
			const { info } = await loader(apk);
			return { handle: handleOf(apk), info: { ...info, usesWebView: true } };
		});
		expect(ext.installed()[0].webview).toBe(true);
	});

	it('reads the APK when the engine doesn’t say: an older one, or one that refused it', async () => {
		await ext.addRepo(BASE, 1000, fetcher);
		await ext.install(PKG, 2000, fetcher, async () => {
			throw new Error('Cef was not initialized');
		});
		expect(db.prepare(`SELECT webview FROM engine_extensions`).get()).toEqual({ webview: 0 });
	});

	it('fills what was installed before tsundoku asked, from the store, once', async () => {
		await ext.addRepo(BASE, 1000, fetcher);
		await ext.install(PKG, 2000, fetcher, loader);
		// A WebView extension's APK in the store, and a row whose APK is gone.
		const apk = zip([
			{ name: 'classes.dex', data: Buffer.from('dex\n035\0Landroid/webkit/WebView;\0', 'latin1') }
		]);
		const handle = handleOf(new Uint8Array(apk));
		writeFileSync(join(store, `${handle}.apk`), apk);
		db.prepare(
			`INSERT INTO engine_extensions (pkg, name, kind, version_code, version_name, lib, handle, installed_at, updated_at)
			VALUES ('x.mkissa', 'MKissa', 'anime', 1, '16.75', '16', ?, 1, 1),
				('x.gone', 'Gone', 'anime', 1, '1', '16', ?, 1, 1)`
		).run(handle, 'f'.repeat(64));
		db.prepare(`UPDATE engine_extensions SET webview = NULL`).run();

		ext.refillWebViewFlags();
		expect(await ext.fillWebViewFlags()).toBe(2);
		expect(db.prepare(`SELECT pkg, webview FROM engine_extensions ORDER BY pkg`).all()).toEqual([
			{ pkg: PKG, webview: 0 },
			{ pkg: 'x.gone', webview: null },
			{ pkg: 'x.mkissa', webview: 1 }
		]);
		expect(ext.installed().find((e) => e.pkg === 'x.mkissa')!.webview).toBe(true);
		// Once a process: the row whose APK is gone isn't read again on every visit.
		expect(await ext.fillWebViewFlags()).toBe(0);
	});

	it('forgets it on BACK TO, whose version may differ, and reads it again', async () => {
		await ext.addRepo(BASE, 1000, fetcher);
		await ext.install(PKG, 2000, fetcher, loader);
		files[`${BASE}index.json`] = index(listing(3, 'mangadex.apk'));
		await ext.refreshRepo(1, 3000, fetcher);
		await ext.install(PKG, 4000, fetcher, loader);
		expect(ext.back(PKG, 5000)).toBe(true);
		expect(db.prepare(`SELECT webview FROM engine_extensions`).get()).toEqual({ webview: null });
		await ext.fillWebViewFlags();
		expect(db.prepare(`SELECT webview FROM engine_extensions`).get()).toEqual({ webview: 0 });
	});
});

describe('updating, and going back', () => {
	async function installThenUpdate() {
		await ext.addRepo(BASE, 1000, fetcher);
		await ext.install(PKG, 2000, fetcher, loader);
		files[`${BASE}index.json`] = index(listing(3, 'mangadex.apk'));
		await ext.refreshRepo(1, 3000, fetcher);
		expect(ext.installed()[0].update).toBe('1.6.3');
		await ext.install(PKG, 4000, fetcher, loader);
	}

	it('offers an update, and keeps the version before it a week', async () => {
		await installThenUpdate();
		const [i] = ext.installed();
		expect(i).toMatchObject({
			versionName: '1.6.3',
			update: null,
			previousVersion: '1.6.2',
			previousUntil: 4000 + ext.KEEP_PREVIOUS_MS
		});
		expect(ext.extensionFor('2522335540328470744')!.handle).toBe(handleOf(mangadex));
	});

	it('goes BACK TO it within the week', async () => {
		await installThenUpdate();
		expect(ext.back(PKG, 5000)).toBe(true);
		expect(ext.extensionFor('2522335540328470744')!.handle).toBe(handleOf(webtoons));
		// The update is now the one kept, so going back is undone the same way.
		expect(ext.installed()[0]).toMatchObject({ versionName: '1.6.2', previousVersion: '1.6.3' });
	});

	it('lets the previous version go after its week', async () => {
		await installThenUpdate();
		expect(ext.back(PKG, 4000 + ext.KEEP_PREVIOUS_MS + 1)).toBe(false);
		expect(ext.prunePrevious(4000 + ext.KEEP_PREVIOUS_MS + 1)).toBe(1);
		expect(existsSync(join(store, `${handleOf(webtoons)}.apk`))).toBe(false);
		expect(existsSync(join(store, `${handleOf(mangadex)}.apk`))).toBe(true);
	});
});

describe('removing', () => {
	it('takes the extension and its APK, and keeps its sources’ settings for a reinstall', async () => {
		await ext.addRepo(BASE, 1000, fetcher);
		await ext.install(PKG, 2000, fetcher, loader);
		ext.keepPreferences('2522335540328470744', [
			{ key: 'quality', switchPreferenceCompat: { title: 'HD', value: true } }
		]);

		ext.remove(PKG);
		expect(ext.installed()).toEqual([]);
		expect(ext.extensionFor('2522335540328470744')).toBeNull();
		expect(existsSync(join(store, `${handleOf(webtoons)}.apk`))).toBe(false);
		expect(ext.preferences('2522335540328470744')).toHaveLength(1);
	});
});

describe('a source’s preferences', () => {
	const described = [
		{
			key: 'mirror',
			listPreference: {
				title: 'Mirror',
				entries: ['A', 'B'],
				entryValues: ['a', 'b'],
				valueIndex: 0
			}
		},
		{ key: 'adult', switchPreferenceCompat: { title: 'Show adult', value: false } },
		{
			key: 'tags',
			multiSelectListPreference: {
				title: 'Tags',
				entries: ['x', 'y'],
				entryValues: ['x', 'y'],
				values: []
			}
		}
	];

	it('keeps what the source describes, and tsundoku’s values over the source’s defaults', () => {
		ext.keepPreferences('1', described);
		expect(ext.setPreference('1', 'mirror', 1)).toBe(true);
		expect(ext.setPreference('1', 'adult', true)).toBe(true);
		expect(ext.setPreference('1', 'tags', ['y'])).toBe(true);
		expect(ext.setPreference('1', 'nope', true)).toBe(false);

		// The source describes itself again (a new version), with its defaults.
		ext.keepPreferences('1', [
			...described,
			{ key: 'new', editTextPreference: { title: 'New', value: '' } }
		]);
		const byKey = Object.fromEntries(ext.preferences('1').map((p) => [p.key, p]));
		expect(byKey.mirror).toEqual({
			key: 'mirror',
			listPreference: { ...described[0].listPreference, valueIndex: 1 }
		});
		expect((byKey.adult.switchPreferenceCompat as { value: boolean }).value).toBe(true);
		expect((byKey.tags.multiSelectListPreference as { values: string[] }).values).toEqual(['y']);
		expect(byKey.new).toBeDefined();
	});
});

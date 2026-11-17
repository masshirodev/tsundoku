import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

// Before anything imports db.ts: getDb() reads this once and memoises.
process.env.DATABASE_PATH = ':memory:';
const store = mkdtempSync(join(tmpdir(), 'tsundoku-novel-store-'));
process.env.NOVEL_STORE = store;

const { getDb } = await import('$lib/server/db');
const plugins = await import('$lib/server/novels/plugins');
const solver = await import('$lib/server/novels/solver');
const { parseIndex, langCode, newer, repoUrl, isNovelRepoAddress, NovelRepoError } =
	await import('$lib/library/lnreader-index');
type Fetcher = import('$lib/server/novels/plugins').Fetcher;

// LNReader repositories and plugins (doc/NOVELS.md).

afterAll(() => rmSync(store, { recursive: true, force: true }));

const REPO =
	'https://raw.githubusercontent.com/LNReader/lnreader-plugins/plugins/v3.0.0/.dist/plugins.min.json';
// Shaped as the owner's repository's entries were on 2026-10-28.
const entry = (id: string, version: string, lang = 'English') => ({
	id,
	name: id === 'royalroad' ? 'Royal Road' : id,
	site: `https://www.${id}.com/`,
	lang,
	version,
	url: `https://raw.githubusercontent.com/lnreader/lnreader-plugins/plugins/v3.0.0/.js/src/plugins/english/${id}.js`,
	iconUrl: `https://raw.githubusercontent.com/lnreader/lnreader-plugins/plugins/v3.0.0/public/static/src/en/${id}/icon.png`
});

let files: Record<string, string>;
const fetcher: Fetcher = async (url) => ({
	ok: url in files,
	status: url in files ? 200 : 404,
	text: async () => files[url]
});
let loads: string[];
const loader = async (file: string) => {
	loads.push(file);
	return { name: 'Royal Road', version: '2.3.4' };
};

const db = getDb();
beforeEach(() => {
	db.exec(`DELETE FROM novel_plugins; DELETE FROM novel_repos;`);
	loads = [];
	files = {
		[REPO]: JSON.stringify([entry('royalroad', '2.3.4'), entry('ranobes', '1.0.0', 'Русский')]),
		[entry('royalroad', '').url]: 'exports.default = { id: "royalroad" }; // v1'
	};
});

describe('an index', () => {
	it('reads plugins, their languages as codes, and drops what it can’t trust', () => {
		const got = parseIndex([
			entry('royalroad', '2.3.4'),
			entry('arnovel', '2.3.0', '‎العربية'),
			{ ...entry('evil/../x', '1'), id: 'evil/../x' },
			{ ...entry('plain', '1'), url: 'http://insecure.example/p.js' },
			entry('royalroad', '9.9.9')
		]);
		expect(got.map((l) => [l.id, l.lang])).toEqual([
			['royalroad', 'en'],
			['arnovel', 'ar']
		]);
		expect(() => parseIndex({})).toThrow(NovelRepoError);
		expect(() => parseIndex([])).toThrow(/no plugins/);
	});

	it('knows LNReader’s language names, and compares versions as numbers', () => {
		expect(['日本語', '中文, 汉语, 漢語', 'Bahasa Indonesia', 'Klingon'].map(langCode)).toEqual([
			'ja',
			'zh',
			'id',
			'klingon'
		]);
		expect(newer('2.3.10', '2.3.4')).toBe(true);
		expect(newer('2.3.4', '2.3.4')).toBe(false);
		expect(newer('1.9', '2.0.0')).toBe(false);
	});

	it('takes an https .json address, and tells one from a Mihon repository’s', () => {
		expect(repoUrl(REPO)).toBe(REPO);
		expect(() => repoUrl('http://x/plugins.min.json')).toThrow(/https/);
		expect(() => repoUrl('https://x/plugins/')).toThrow(/\.json/);
		expect(isNovelRepoAddress(REPO)).toBe(true);
		expect(
			isNovelRepoAddress(
				'https://raw.githubusercontent.com/keiyoushi/extensions/repo/index.min.json'
			)
		).toBe(false);
	});
});

describe('repositories', () => {
	it('answers with what an address holds, then adds it', async () => {
		const p = await plugins.previewNovelRepo(REPO, fetcher);
		expect([p.name, p.listings.length]).toEqual(['LNReader', 2]);
		const id = await plugins.addNovelRepo(REPO, 1_000, fetcher);
		expect(plugins.listNovelRepos()).toMatchObject([
			{ id, name: 'LNReader', plugins: 2, installed: 0 }
		]);
	});

	it('keeps a repository that stopped answering, and its listings', async () => {
		const id = await plugins.addNovelRepo(REPO, 1_000, fetcher);
		files = {};
		expect(await plugins.refreshNovelRepo(id, 2_000, fetcher)).toBe(false);
		expect(plugins.listNovelRepos()[0]).toMatchObject({ failedAt: 2_000, plugins: 2 });
	});
});

describe('a plugin', () => {
	it('is installed pinned by its hash, after it loads in the host', async () => {
		await plugins.addNovelRepo(REPO, 1_000, fetcher);
		await plugins.installPlugin('royalroad', 1_000, fetcher, loader);
		const [p] = plugins.installedPlugins();
		expect(p).toMatchObject({
			id: 'royalroad',
			name: 'Royal Road',
			lang: 'en',
			version: '2.3.4',
			failed: '',
			update: null
		});
		expect(existsSync(p.file)).toBe(true);
		expect(loads).toEqual([p.file]);
	});

	it('updates, keeps the previous file a week for BACK TO, and goes back', async () => {
		await plugins.addNovelRepo(REPO, 1_000, fetcher);
		await plugins.installPlugin('royalroad', 1_000, fetcher, loader);
		const first = plugins.installedPlugins()[0].file;
		files[REPO] = JSON.stringify([entry('royalroad', '2.3.5')]);
		files[entry('royalroad', '').url] = 'exports.default = { id: "royalroad" }; // v2';
		await plugins.refreshNovelRepo(1, 2_000, fetcher);
		expect(plugins.installedPlugins()[0].update).toBe('2.3.5');
		await plugins.installPlugin(
			'royalroad',
			2_000,
			async (u) => fetcher(u),
			async () => ({
				name: 'Royal Road',
				version: '2.3.5'
			})
		);
		const after = plugins.installedPlugins()[0];
		expect([after.version, after.previousVersion, after.update]).toEqual(['2.3.5', '2.3.4', null]);
		expect(plugins.backPlugin('royalroad', 2_000 + plugins.KEEP_PREVIOUS_MS + 1)).toBe(false);
		expect(plugins.backPlugin('royalroad', 3_000)).toBe(true);
		expect(plugins.installedPlugins()[0]).toMatchObject({ version: '2.3.4', file: first });
	});

	it('is kept, and says so, when it won’t load', async () => {
		await plugins.addNovelRepo(REPO, 1_000, fetcher);
		await plugins.installPlugin('royalroad', 1_000, fetcher, async () => {
			throw new Error('SyntaxError');
		});
		expect(plugins.installedPlugins()[0].failed).toBe('SyntaxError');
	});

	it('is removed with its file, and is obsolete when no repository lists it', async () => {
		await plugins.addNovelRepo(REPO, 1_000, fetcher);
		await plugins.installPlugin('royalroad', 1_000, fetcher, loader);
		const file = plugins.installedPlugins()[0].file;
		plugins.removeNovelRepo(1);
		expect(plugins.installedPlugins()[0].obsolete).toBe(true);
		plugins.removePlugin('royalroad');
		expect(plugins.installedPlugins()).toEqual([]);
		expect(existsSync(file)).toBe(false);
	});
});

describe('the host the app builds', () => {
	it('solves a site’s check with the app’s own solver', () => {
		// The one line that puts the card into production. Every other spec builds
		// its own host with its own solve, so nothing would notice this going.
		const opts = plugins.hostOptions();
		expect(opts.solve).toBe(solver.solveChallenge);
		expect(opts.store).toBe(store);
	});

	it('fetches a page bound to the solver’s browser through the app’s own solver', () => {
		// The same line for page mode: without it the host would ask for pages
		// and hear only "this app has no solver to fetch a page through".
		const opts = plugins.hostOptions();
		expect(opts.page).toBe(solver.fetchPage);
		// Nothing a spec sets for itself leaks into the app's own host.
		expect(opts.refusedMs).toBeUndefined();
		expect(opts.allow).toBeUndefined();
	});
});

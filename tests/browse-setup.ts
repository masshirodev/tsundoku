import Database from 'better-sqlite3';
import { spawn, execFileSync, type ChildProcess } from 'node:child_process';
import { createServer, type Server } from 'node:http';
import { createServer as createHttpsServer } from 'node:https';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { E2E_TOKEN } from '../playwright.config';
import {
	BROWSE_PORT,
	ENGINE_PORT,
	REPO_PORT,
	ANIME_SOURCE,
	SHELF_PLUGIN,
	SOURCES,
	type EngineCall
} from './browse-world';

/**
 * BROWSE's world for the browser suite (doc/BROWSE.md, card c141): a fake
 * extension engine in the runner's process, and a preview of the same build
 * on its own seeded database with ENGINE_URL pointing at it.
 * It's its own server because turning downloads on for the shared one would
 * draw a DOWNLOAD row under the specs that pin the series screen; it lives
 * for the whole run (a global setup, after the shared server has built) so
 * the generated frame spec and the flow can both use it.
 *
 * Specs steer the fake over HTTP: POST /__reset, POST /__down (it stops
 * answering), GET /__calls (what it was asked, filters included).
 */

let calls: EngineCall[] = [];
let down = false;
/** /__check: the next search takes this long, while example.org's "check" is solved (c143). */
let checkMs = 0;
const challenges: { solving: Record<string, number>; solved: Record<string, number> } = {
	solving: {},
	solved: {}
};

// ---- a fake web: extension repositories (c144) ------------------------------------------------

// Real Keiyoushi-signed APKs (tests/fixtures/apk/README.md), so installs are
// checked against a real signature.
const WEBTOONS = readFileSync('tests/fixtures/apk/tachiyomi-all.webtoons-v1.6.2.apk');
const MANGADEX = readFileSync('tests/fixtures/apk/tachiyomi-all.mangadex-v1.6.0.apk');
const KEIYOUSHI = '9add655a78e96c4ec7a53ef89dccb557cb5d767489fac5e785d671a5a75d4da2';
const OTHER_KEY = 'f'.repeat(64);
const handle = (b: Buffer) => createHash('sha256').update(b).digest('hex');
/** The webtoons listing's version: /__bump moves it to 3, served from the other APK. */
let webtoonsVersion = 2;

const listing = (
	base: string,
	pkg: string,
	name: string,
	code: number,
	apk: string,
	o: { nsfw?: boolean } = {}
) => ({
	name,
	packageName: pkg,
	resources: { apkUrl: `${base}${apk}`, iconUrl: '', jarUrl: '' },
	extensionLib: '1.6',
	versionCode: String(code),
	versionName: `1.6.${code}`,
	contentWarning: o.nsfw ? 'CONTENT_WARNING_NSFW' : 'CONTENT_WARNING_SAFE',
	sources: [{ id: `${pkg}-src`, name, language: 'en', homeUrl: 'https://example.org' }]
});

function repoFile(path: string, base: string): unknown {
	// An LNReader repository (doc/NOVELS.md): one index, a plugin file by URL.
	if (path === '/novels/plugins.min.json')
		return [
			{
				id: 'goodnovels',
				name: 'Good Novels',
				site: 'https://example.org/',
				lang: 'English',
				version: '1.0.0',
				url: `${base}goodnovels.js`,
				iconUrl: ''
			}
		];
	if (path === '/good/repo.json')
		return { meta: { name: 'Fake Repo', signingKeyFingerprint: KEIYOUSHI } };
	if (path === '/good/index.json')
		return {
			name: 'Fake Repo',
			signingKey: KEIYOUSHI,
			extensionList: {
				extensions: [
					listing(
						base,
						'eu.kanade.tachiyomi.extension.all.webtoons',
						'Webtoons.com',
						webtoonsVersion,
						webtoonsVersion > 2 ? 'mangadex.apk' : 'webtoons.apk'
					),
					listing(
						base,
						'eu.kanade.tachiyomi.extension.en.adultplace',
						'Adult Place',
						1,
						'webtoons.apk',
						{ nsfw: true }
					)
				]
			}
		};
	// A repository whose listings aren't signed by the key it names.
	if (path === '/bad/repo.json')
		return { meta: { name: 'Bad Repo', signingKeyFingerprint: OTHER_KEY } };
	if (path === '/bad/index.json')
		return {
			name: 'Bad Repo',
			signingKey: OTHER_KEY,
			extensionList: {
				extensions: [
					listing(
						base,
						'eu.kanade.tachiyomi.extension.en.nightscans',
						'Night Scans',
						1,
						'webtoons.apk'
					)
				]
			}
		};
	return null;
}

const manga = (sourceId: string, page: number, i: number, title?: string) => ({
	url: `/s${sourceId}/p${page}-${i}`,
	title: title ?? `${SOURCES.open.name} ${page}-${i}`,
	author: i % 2 ? 'Someone' : null,
	status: 1,
	thumbnail_url: null
});

function answer(b: EngineCall): unknown {
	const page = b.page ?? 1;
	const animeData = (b as { animeData?: { url: string } }).animeData;
	switch (b.method) {
		// The anime source (tests/browse-anime.e2e.ts): one show, two seasons of two.
		case 'supportLatestAnime':
			return false;
		case 'filterSchemaAnime':
			return [];
		case 'getPopularAnime':
		case 'getLatestAnime':
			return {
				animes: [{ url: '/show/kori', title: 'Kōri no Shiro no Majo', status: 2 }],
				hasNextPage: false
			};
		case 'getDetailsAnime':
			return {
				url: animeData?.url ?? '/show/kori',
				title: 'Kōri no Shiro no Majo',
				description: 'A witch, and a castle of ice.',
				genre: 'Fantasy',
				status: 2
			};
		case 'getEpisodeList':
			return [
				{ url: '/ep/s2e2', name: 'Season 2 - Episode 2 - Thaw', episode_number: 2 },
				{ url: '/ep/s2e1', name: 'Season 2 - Episode 1', episode_number: 1 },
				{ url: '/ep/s1e2', name: 'Season 1 - Episode 2 - A Door Without a Key', episode_number: 2 },
				{ url: '/ep/s1e1', name: 'Season 1 - Episode 1 - The First Snow', episode_number: 1 }
			];
		case 'supportLatestManga':
			return b.sourceId === SOURCES.open.id;
		case 'filterSchemaManga':
			return [
				{ type: 'header', name: 'Ignored when searching by text' },
				{
					type: 'sort',
					name: 'Sort By',
					state: { index: 0, ascending: false },
					values: ['Latest', 'A-Z']
				},
				{ type: 'select', name: 'Status', state: 0, values: ['All', 'Ongoing', 'Completed'] },
				{ type: 'checkbox', name: 'Has chapters', state: true },
				{ type: 'text', name: 'Author', state: '' },
				{
					type: 'group',
					name: 'Genre',
					children: ['Action', 'Cooking', 'Romance'].map((name) => ({
						type: 'tristate',
						name,
						state: 0
					}))
				}
			];
		case 'preferencesManga':
			return [
				{
					key: 'quality',
					listPreference: {
						title: 'Cover quality',
						summary: '%s',
						valueIndex: 0,
						entries: ['Original', 'Medium', 'Low'],
						entryValues: ['o', 'm', 'l']
					}
				},
				{
					key: 'saver',
					switchPreferenceCompat: { title: 'Data saver', summary: 'Smaller pages', value: false }
				},
				{
					key: 'alt',
					checkBoxPreference: { title: 'Alternative titles', summary: '', value: false }
				},
				{
					key: 'rating',
					multiSelectListPreference: {
						title: 'Content rating',
						summary: '',
						entries: ['Safe', 'Suggestive'],
						entryValues: ['safe', 'suggestive'],
						values: ['safe']
					}
				},
				{
					key: 'blocked',
					editTextPreference: { title: 'Blocked groups', summary: '', value: '', text: '' }
				}
			];
		case 'getPopularManga':
			return {
				mangas: [
					// The first is in the library; the second is a twin of a series from the hidden source.
					...(page === 1
						? [
								{ ...manga(b.sourceId, 1, 0), title: 'Lindenborough Heir', url: '/manga/linden' },
								{ ...manga(b.sourceId, 1, 1), title: 'Toonily One' }
							]
						: []),
					...Array.from({ length: 12 }, (_, i) => manga(b.sourceId, page, i + 2))
				],
				hasNextPage: page < 2
			};
		case 'getLatestManga':
			return { mangas: [manga(b.sourceId, 9, 0, 'Latest One')], hasNextPage: false };
		case 'getSearchManga':
			// "paged" is a list with a second page, for scrolling on.
			if (b.search === 'paged')
				return {
					mangas: Array.from({ length: 13 }, (_, i) =>
						manga(b.sourceId, page, i, `Paged ${page}-${i}`)
					),
					hasNextPage: page < 2
				};
			return { mangas: [manga(b.sourceId, 7, 0, 'Filtered One')], hasNextPage: false };
	}
	return null;
}

function startEngine(): Promise<Server> {
	const server = createServer((req, res) => {
		const json = (status: number, v: unknown) =>
			res.writeHead(status, { 'content-type': 'application/json' }).end(JSON.stringify(v));
		if (req.url === '/__reset') {
			calls = [];
			down = false;
			checkMs = 0;
			return json(200, {});
		}
		if (req.url === '/__down') {
			down = true;
			return json(200, {});
		}
		if (req.url === '/__calls') return json(200, calls);
		if (req.url?.startsWith('/__check')) {
			checkMs = Number(new URL(req.url, 'http://x').searchParams.get('ms')) || 3000;
			return json(200, {});
		}
		if (req.url === '/challenges' && !down) return json(200, challenges);
		if (req.url === '/__bump') {
			webtoonsVersion = 3;
			return json(200, {});
		}
		// Not answering, as a stopped engine doesn't: the connection is dropped.
		if (down) return req.socket.destroy();
		let raw = '';
		req.on('data', (c) => (raw += c));
		req.on('end', () => {
			const b = JSON.parse(raw || '{}') as EngineCall & { data?: string };
			calls.push({ ...b, data: undefined } as EngineCall);
			// Loading an APK: the engine answers what it holds, under its handle.
			if (b.method === 'extensionInfo') {
				const apk = Buffer.from(b.data ?? '', 'base64');
				const mine = handle(apk) === handle(MANGADEX) ? '1.6.3' : '1.6.2';
				return res
					.writeHead(200, {
						'content-type': 'application/json',
						'x-mangayomi-extension-id': handle(apk)
					})
					.end(
						JSON.stringify({
							name: 'Webtoons.com',
							versionName: mine,
							versionCode: 0,
							sources: [
								{
									id: 'eu.kanade.tachiyomi.extension.all.webtoons-src',
									name: 'Webtoons.com',
									lang: 'en'
								}
							]
						})
					);
			}
			const a = answer(b);
			// A search behind a browser check: slow, and "solving" its site meanwhile.
			if (b.method === 'getSearchManga' && checkMs > 0) {
				const ms = checkMs;
				checkMs = 0;
				challenges.solving['example.org'] = Date.now();
				setTimeout(() => {
					delete challenges.solving['example.org'];
					challenges.solved['example.org'] = Date.now();
					json(200, a);
				}, ms);
				return;
			}
			return a === null ? json(404, { error: 'unknown' }) : json(200, a);
		});
	});
	return new Promise((ok) => server.listen(ENGINE_PORT, '127.0.0.1', () => ok(server)));
}

/**
 * The repositories, over https: tsundoku refuses a repository served any
 * other way (repo-index.ts), and a test-only exception in that check would be
 * one more way past it. So the setup makes a throwaway certificate for
 * 127.0.0.1 and the preview trusts it through NODE_EXTRA_CA_CERTS.
 */
function startRepos(dir: string): Promise<Server> {
	execFileSync(
		'openssl',
		[
			'req',
			'-x509',
			'-newkey',
			'ec',
			'-pkeyopt',
			'ec_paramgen_curve:prime256v1',
			'-nodes',
			'-keyout',
			join(dir, 'key.pem'),
			'-out',
			join(dir, 'cert.pem'),
			'-days',
			'1',
			'-subj',
			'/CN=127.0.0.1',
			'-addext',
			'subjectAltName=IP:127.0.0.1'
		],
		{ stdio: 'pipe' }
	);
	const server = createHttpsServer(
		{ key: readFileSync(join(dir, 'key.pem')), cert: readFileSync(join(dir, 'cert.pem')) },
		(req, res) => {
			const url = req.url ?? '';
			if (url === '/novels/goodnovels.js')
				return res
					.writeHead(200, { 'content-type': 'text/javascript' })
					.end(readFileSync('tests/fixtures/lnreader/good.js'));
			if (url.endsWith('.apk'))
				return res
					.writeHead(200, { 'content-type': 'application/vnd.android.package-archive' })
					.end(url.endsWith('mangadex.apk') ? MANGADEX : WEBTOONS);
			const f = repoFile(url, `https://127.0.0.1:${REPO_PORT}${url.replace(/[^/]*$/, '')}`);
			if (f === null) return res.writeHead(404).end('not here');
			res.writeHead(200, { 'content-type': 'application/json' }).end(JSON.stringify(f));
		}
	);
	return new Promise((ok) =>
		server.listen(REPO_PORT, '127.0.0.1', () => ok(server as unknown as Server))
	);
}

function seed(dbPath: string, store: string): void {
	rmSync(dbPath, { force: true });
	execFileSync(process.execPath, ['--experimental-strip-types', 'scripts/seed.ts'], {
		env: { ...process.env, DATABASE_PATH: dbPath, NODE_NO_WARNINGS: '1' },
		stdio: 'pipe'
	});
	const db = new Database(dbPath);
	const root = (db.prepare(`SELECT id FROM roots WHERE name = 'Library'`).get() as { id: number })
		.id;
	const now = Date.UTC(2026, 9, 28, 12);
	const series = (title: string, key: string, hidden = 0) =>
		db
			.prepare(
				`INSERT INTO series (root_id, title, kind, source, hue, added_at, indexed_at, origin_key, hidden)
				VALUES (?, ?, 'manhwa', 'mihon', 210, ?, ?, ?, ?)`
			)
			.run(root, title, now, now, key, hidden);
	series('Lindenborough Heir', `mihon:${SOURCES.open.id}:/manga/linden`);
	// The hidden source: two of three series here are hidden, so it's mostly hidden.
	series('Toonily One', `mihon:${SOURCES.hidden.id}:/manga/t1`);
	series('Toonily Two', `mihon:${SOURCES.hidden.id}:/manga/t2`, 1);
	series('Toonily Three', `mihon:${SOURCES.hidden.id}:/manga/t3`, 1);
	for (const s of Object.values(SOURCES)) {
		db.prepare(
			`INSERT INTO engine_extensions (pkg, name, kind, version_code, version_name, lib, handle, installed_at, updated_at, failed)
			VALUES (?, ?, 'manga', 1, '1.0', '1.4', ?, 0, 0, ?)`
		).run(s.pkg, s.name, s.pkg.padEnd(64, '0'), s.failed ?? '');
		db.prepare(
			`INSERT INTO engine_sources (id, pkg, name, lang, base_url) VALUES (?, ?, ?, 'en', 'https://example.org')`
		).run(s.id, s.pkg, s.name);
	}
	// An Aniyomi source on the fake engine (tests/browse-anime.e2e.ts).
	db.prepare(
		`INSERT INTO engine_extensions (pkg, name, kind, version_code, version_name, lib, handle, installed_at, updated_at, failed)
		VALUES (?, ?, 'anime', 1, '1.0', '16', ?, 0, 0, '')`
	).run(ANIME_SOURCE.pkg, ANIME_SOURCE.name, ANIME_SOURCE.pkg.padEnd(64, '0'));
	db.prepare(
		`INSERT INTO engine_sources (id, pkg, name, lang, base_url) VALUES (?, ?, ?, 'en', 'https://anime.example')`
	).run(ANIME_SOURCE.id, ANIME_SOURCE.pkg, ANIME_SOURCE.name);
	// An anime series (tests/browse-anime.e2e.ts; doc/ANIME.md), as Anime States
	// draws one: season 1 watched through, season 2 part-way, EP. 7 at 14:32 left,
	// EP. 8 downloaded, a recap and a filler.
	const anime = Number(
		db
			.prepare(
				`INSERT INTO series (root_id, title, kind, source, status, hue, added_at, indexed_at, alt_titles)
				VALUES (?, 'Tsukiakari no Ryokōsha', 'anime', 'AnimePahe', 'ongoing', 255, ?, ?, ?)`
			)
			.run(root, now, now, JSON.stringify(['月明かりの旅行者', 'Moonlit Travellers']))
			.lastInsertRowid
	);
	const put = db.prepare(
		`INSERT INTO entries (series_id, position, label, title, added_at, read_at, last_position, last_opened_at,
			available, file, bytes, duration_s, season, episode_number, episode_note)
		VALUES (@series, @position, @label, @title, @now, @read, @at, @opened, @available, @file, @bytes, 1440, @season, @n, @note)`
	);
	// Opened just now, so it heads CONTINUE above the sample's minutes-ago rows.
	const opened = Date.now();
	const TITLES = [
		'Departure, Again',
		'The Ferry at Imre',
		'',
		'Weights and Measures',
		'Two Roads North',
		'',
		'The Lantern Market',
		'Salt Road',
		'A Letter from Hollin',
		'',
		"The Ferryman's Count",
		''
	];
	for (const season of [1, 2])
		for (let n = 1; n <= 12; n++) {
			const watched = season === 1 || n <= 6;
			put.run({
				series: anime,
				position: (season - 1) * 12 + n,
				n,
				label: `Ep. ${n}`,
				title: season === 2 ? TITLES[n - 1] : `Episode ${n}`,
				now,
				read: watched ? opened - (25 - n - (season - 1) * 12) * 60_000 : null,
				at: season === 2 && n === 7 ? 568 : null,
				opened: watched
					? opened - (25 - n - (season - 1) * 12) * 60_000
					: season === 2 && n === 7
						? opened
						: null,
				available: season === 2 && n === 8 ? 1 : 0,
				file: season === 2 && n === 8 ? 'Season 02/S02E08.mkv' : '',
				bytes: season === 2 && n === 8 ? 410_000_000 : 0,
				season,
				note: season === 2 && n === 6 ? 'recap' : season === 2 && n === 10 ? 'filler' : ''
			});
		}
	// A novel plugin that needs no network (tests/browse-novels.e2e.ts), installed
	// as the EXTENSIONS screen would: its file in the store under its hash.
	const shelf = readFileSync('tests/fixtures/lnreader/shelf.js');
	const hash = handle(shelf);
	mkdirSync(join(store, 'novels'), { recursive: true });
	writeFileSync(join(store, 'novels', `${hash}.js`), shelf);
	db.prepare(
		`INSERT INTO novel_plugins (id, name, site, lang, version, hash, installed_at, updated_at, failed)
		VALUES (?, 'Shelf Novels', 'https://shelf.example/', 'en', '1.0.0', ?, 0, 0, '')`
	).run(SHELF_PLUGIN, hash);
	db.close();
}

export default async function setup() {
	const dbPath = join(tmpdir(), `tsundoku-e2e-browse-${process.pid}.sqlite`);
	// Installs and icons write here, never into the real store on /mnt/hdd2.
	const store = mkdtempSync(join(tmpdir(), 'tsundoku-e2e-browse-store-'));
	seed(dbPath, store);
	const engine = await startEngine();
	const repos = await startRepos(store);
	const preview: ChildProcess = spawn(
		'npx',
		['vite', 'preview', '--port', String(BROWSE_PORT), '--strictPort'],
		{
			env: {
				...process.env,
				DATABASE_PATH: dbPath,
				TSUNDOKU_TOKEN: E2E_TOKEN,
				ENGINE_URL: `http://127.0.0.1:${ENGINE_PORT}`,
				ENGINE_TOKEN: 'e2e-engine-token',
				TSUNDOKU_ANILIST: 'off',
				// Its own, gone with the run: a novel downloaded here writes its EPUB
				// into it, which the shared server's empty library must never see.
				LIBRARY_ROOT: join(store, 'library'),
				COVER_DIR: join(tmpdir(), `tsundoku-e2e-browse-covers-${process.pid}`),
				ENGINE_STORE: store,
				NODE_EXTRA_CA_CERTS: join(store, 'cert.pem'),
				BACKUP_DIR: join(tmpdir(), 'tsundoku-e2e-backups'),
				SUWAYOMI_URL: ''
			},
			stdio: 'ignore'
		}
	);
	let up = false;
	for (let i = 0; i < 120 && !up; i++) {
		try {
			up = (await fetch(`http://localhost:${BROWSE_PORT}`, { redirect: 'manual' })).status > 0;
		} catch {
			await new Promise((r) => setTimeout(r, 500));
		}
	}
	if (!up) throw new Error('the browse preview never answered');
	return async () => {
		preview.kill();
		engine.closeAllConnections();
		engine.close();
		repos.close();
		rmSync(dbPath, { force: true });
		rmSync(store, { recursive: true, force: true });
		rmSync(join(tmpdir(), `tsundoku-e2e-browse-covers-${process.pid}`), {
			recursive: true,
			force: true
		});
	};
}

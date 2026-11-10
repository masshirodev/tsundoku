import Database from 'better-sqlite3';
import { spawn, execFileSync, type ChildProcess } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { createServer as createHttp, type Server } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { E2E_TOKEN } from '../../playwright.config';
import { freePort } from './tag-world';

/**
 * A world for SELECT in a catalog (card c868; doc/BROWSE.md, "SELECT in a
 * catalog"), for tests/browse-select*.e2e.ts: two manga sources on a fake
 * engine, a seeded database of its own with a series already IN LIBRARY from
 * the first and a twin of another of its results from the second, a shelf to
 * put a press on, and a preview of the same build on a port of its own. A
 * press adds series and queues chapters, so nothing here touches the shared
 * server or the browse world, and each spec file starts its own.
 *
 * The first source has POPULAR (eight results, a second page of four),
 * LATEST, a search for `solo`, and a genre filter whose Action is a tag's
 * arrival. One result's details are refused (403), as a site that refuses
 * does: its series is NOT ADDED, in a word.
 */

export const PAPER = { id: '500', name: 'Paper Moon' };
export const SECOND = { id: '501', name: 'Second Shelf' };

/** Every title a fake result has, by its URL at its source. */
export const TITLES: Record<string, string> = {
	'/a/1': 'Alpha In Library',
	'/a/2': 'Twin Peaks Saga',
	'/a/3': 'Gamma Ray',
	'/a/4': 'Delta Wave',
	'/a/5': 'Epsilon Road',
	'/a/6': 'Zeta Garden',
	'/a/7': 'Eta Lantern',
	'/a/refuse': 'Refuser At The Gate',
	'/a/p2-1': 'Page Two First',
	'/a/p2-2': 'Page Two Second',
	'/a/p2-3': 'Page Two Third',
	'/a/p2-4': 'Page Two Fourth',
	'/a/l1': 'Latest Leaf',
	'/a/l2': 'Latest Lantern',
	'/a/s1': 'Solo Climber',
	'/a/s2': 'Solo Diver',
	'/a/g1': 'Genre Pick',
	'/b/1': 'Second One',
	'/b/2': 'Second Two',
	'/b/3': 'Second Three'
};

export const SCHEMA = [
	{
		type: 'group',
		name: 'Genre',
		children: ['Action', 'Romance'].map((name) => ({ type: 'tristate', name, state: 0 }))
	}
];

export type SelectWorld = {
	base: string;
	db: string;
	/** The shelf a press can be put on. */
	later: number;
	stop: () => Promise<void>;
};

/** The preview's id for a result (`sourceMangaId`). */
export const resultId = (source: string, url: string) =>
	`${source}~${Buffer.from(url).toString('base64url')}`;

function seed(dbPath: string): number {
	rmSync(dbPath, { force: true });
	execFileSync(process.execPath, ['--experimental-strip-types', 'scripts/seed.ts'], {
		env: { ...process.env, DATABASE_PATH: dbPath, NODE_NO_WARNINGS: '1' },
		stdio: 'pipe'
	});
	const db = new Database(dbPath);
	try {
		const root = (db.prepare(`SELECT id FROM roots WHERE name = 'Library'`).get() as { id: number })
			.id;
		const now = Date.UTC(2026, 10, 3, 12);
		for (const s of [PAPER, SECOND]) {
			db.prepare(
				`INSERT INTO engine_extensions (pkg, name, kind, version_code, version_name, lib, handle, installed_at, updated_at, failed)
				VALUES (?, ?, 'manga', 1, '1', '1', ?, 0, 0, '')`
			).run(`e2e.select.${s.id}`, s.name, `e2e.select.${s.id}`.padEnd(64, '0'));
			db.prepare(
				`INSERT INTO engine_sources (id, pkg, name, lang, base_url) VALUES (?, ?, ?, 'en', ?)`
			).run(s.id, `e2e.select.${s.id}`, s.name, `https://${s.id}.example`);
		}
		const series = (title: string, key: string) =>
			Number(
				db
					.prepare(
						`INSERT INTO series (root_id, title, kind, source, hue, added_at, indexed_at, origin_key, in_library)
						VALUES (?, ?, 'manga', 'mihon', 210, ?, ?, ?, 1)`
					)
					.run(root, title, now, now, key).lastInsertRowid
			);
		series(TITLES['/a/1'], `mihon:${PAPER.id}:/a/1`);
		// The twin: the same title, from the other source.
		series(TITLES['/a/2'], `mihon:${SECOND.id}:/b/twin`);
		return Number(
			db
				.prepare(
					`INSERT INTO collections (name, position) VALUES ('Later', (SELECT COALESCE(MAX(position), 0) + 1 FROM collections))`
				)
				.run().lastInsertRowid
		);
	} finally {
		db.close();
	}
}

const manga = (url: string) => ({ url, title: TITLES[url], status: 1, thumbnail_url: null });

function startEngine(port: number) {
	const server = createHttp((req, res) => {
		const json = (status: number, v: unknown) =>
			res.writeHead(status, { 'content-type': 'application/json' }).end(JSON.stringify(v));
		if (req.url === '/challenges') return json(200, { solving: {}, solved: {} });
		let raw = '';
		req.on('data', (c) => (raw += c));
		req.on('end', () => {
			const b = JSON.parse(raw || '{}') as {
				method: string;
				sourceId: string;
				page?: number;
				search?: string;
				filterList?: { stateList?: { name: string; stateInt?: number }[] }[];
				mangaData?: { url: string };
			};
			const url = b.mangaData?.url ?? '';
			const paper = b.sourceId === PAPER.id;
			switch (b.method) {
				case 'filterSchemaManga':
					return json(200, paper ? SCHEMA : []);
				case 'supportLatestManga':
					return json(200, paper);
				case 'getPopularManga':
					if (!paper)
						return json(200, { mangas: ['/b/1', '/b/2', '/b/3'].map(manga), hasNextPage: false });
					return b.page === 2
						? json(200, {
								mangas: ['/a/p2-1', '/a/p2-2', '/a/p2-3', '/a/p2-4'].map(manga),
								hasNextPage: false
							})
						: json(200, {
								mangas: ['/a/1', '/a/2', '/a/3', '/a/4', '/a/5', '/a/6', '/a/7', '/a/refuse'].map(
									manga
								),
								hasNextPage: true
							});
				case 'getLatestManga':
					return json(200, { mangas: ['/a/l1', '/a/l2'].map(manga), hasNextPage: false });
				case 'getSearchManga': {
					const action = b.filterList?.some((f) =>
						f.stateList?.some((c) => c.name === 'Action' && c.stateInt === 1)
					);
					if (action) return json(200, { mangas: [manga('/a/g1')], hasNextPage: false });
					if (/solo/i.test(b.search ?? ''))
						return json(200, { mangas: ['/a/s1', '/a/s2'].map(manga), hasNextPage: false });
					return json(200, { mangas: [], hasNextPage: false });
				}
				case 'getDetailsManga':
					if (url === '/a/refuse') return json(500, { error: 'Forbidden', code: 403 });
					return json(200, {
						url,
						title: TITLES[url] ?? url,
						author: 'Aoi Hanamura',
						genre: 'Action, Drama',
						description: 'A result to tick.',
						status: 1
					});
				case 'getChapterList':
					return json(
						200,
						Array.from({ length: 12 }, (_, i) => ({
							url: `${url}/c${i + 1}`,
							name: `Chapter ${i + 1}`,
							scanlator: null,
							chapter_number: i + 1
						}))
					);
				default:
					return json(404, { error: 'unknown', code: 404 });
			}
		});
	});
	return new Promise<Server>((ok) => server.listen(port, '127.0.0.1', () => ok(server)));
}

/** The world, up: seeded, its engine listening and its preview answering. */
export async function startSelectWorld(name: string): Promise<SelectWorld> {
	const work = mkdtempSync(join(tmpdir(), `tsundoku-e2e-${name}-`));
	const dbPath = join(work, 'library.sqlite');
	const later = seed(dbPath);
	const enginePort = await freePort();
	const engine = await startEngine(enginePort);
	const port = await freePort();
	const base = `http://localhost:${port}`;
	const preview: ChildProcess = spawn(
		'npx',
		['vite', 'preview', '--port', String(port), '--strictPort'],
		{
			env: {
				...process.env,
				DATABASE_PATH: dbPath,
				TSUNDOKU_TOKEN: E2E_TOKEN,
				ENGINE_URL: `http://127.0.0.1:${enginePort}`,
				ENGINE_TOKEN: 'e2e-engine-token',
				TSUNDOKU_ANILIST: 'off',
				TSUNDOKU_HOME: join(work, 'home'),
				LIBRARY_ROOT: join(work, 'library'),
				COVER_DIR: join(work, 'covers'),
				ENGINE_STORE: join(work, 'store'),
				BACKUP_DIR: join(work, 'backups')
			},
			stdio: 'ignore'
		}
	);
	let up = false;
	for (let i = 0; i < 120 && !up; i++) {
		try {
			up = (await fetch(base, { redirect: 'manual' })).status > 0;
		} catch {
			await new Promise((r) => setTimeout(r, 500));
		}
	}
	if (!up) throw new Error(`the ${name} preview never answered`);
	return {
		base,
		db: dbPath,
		later,
		stop: async () => {
			preview.kill();
			engine.closeAllConnections();
			await new Promise((ok) => engine.close(ok));
			rmSync(work, { recursive: true, force: true });
		}
	};
}

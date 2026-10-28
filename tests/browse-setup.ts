import Database from 'better-sqlite3';
import { spawn, execFileSync, type ChildProcess } from 'node:child_process';
import { createServer, type Server } from 'node:http';
import { rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { E2E_TOKEN } from '../playwright.config';
import { BROWSE_PORT, ENGINE_PORT, SOURCES, type EngineCall } from './browse-world';

/**
 * BROWSE's world for the browser suite (doc/BROWSE.md, card c141): a fake
 * extension engine in the runner's process, and a preview of the same build
 * on its own seeded database with DOWNLOADS_BACKEND=engine pointing at it.
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

const manga = (sourceId: string, page: number, i: number, title?: string) => ({
	url: `/s${sourceId}/p${page}-${i}`,
	title: title ?? `${SOURCES.open.name} ${page}-${i}`,
	author: i % 2 ? 'Someone' : null,
	status: 1,
	thumbnail_url: null
});

function answer(b: EngineCall): unknown {
	const page = b.page ?? 1;
	switch (b.method) {
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
			return json(200, {});
		}
		if (req.url === '/__down') {
			down = true;
			return json(200, {});
		}
		if (req.url === '/__calls') return json(200, calls);
		// Not answering, as a stopped engine doesn't: the connection is dropped.
		if (down) return req.socket.destroy();
		let raw = '';
		req.on('data', (c) => (raw += c));
		req.on('end', () => {
			const b = JSON.parse(raw || '{}') as EngineCall;
			calls.push(b);
			const a = answer(b);
			return a === null ? json(404, { error: 'unknown' }) : json(200, a);
		});
	});
	return new Promise((ok) => server.listen(ENGINE_PORT, '127.0.0.1', () => ok(server)));
}

function seed(dbPath: string): void {
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
	db.close();
}

export default async function setup() {
	const dbPath = join(tmpdir(), `tsundoku-e2e-browse-${process.pid}.sqlite`);
	seed(dbPath);
	const engine = await startEngine();
	const preview: ChildProcess = spawn(
		'npx',
		['vite', 'preview', '--port', String(BROWSE_PORT), '--strictPort'],
		{
			env: {
				...process.env,
				DATABASE_PATH: dbPath,
				TSUNDOKU_TOKEN: E2E_TOKEN,
				DOWNLOADS_BACKEND: 'engine',
				ENGINE_URL: `http://127.0.0.1:${ENGINE_PORT}`,
				ENGINE_TOKEN: 'e2e-engine-token',
				TSUNDOKU_ANILIST: 'off',
				LIBRARY_ROOT: join(tmpdir(), 'tsundoku-e2e-empty-library'),
				COVER_DIR: join(tmpdir(), `tsundoku-e2e-browse-covers-${process.pid}`),
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
		rmSync(dbPath, { force: true });
		rmSync(join(tmpdir(), `tsundoku-e2e-browse-covers-${process.pid}`), {
			recursive: true,
			force: true
		});
	};
}

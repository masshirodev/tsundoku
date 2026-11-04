import Database from 'better-sqlite3';
import { spawn, execFileSync, type ChildProcess } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { createServer as createHttp, type Server } from 'node:http';
import { createServer, type AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { E2E_TOKEN } from '../../playwright.config';

/**
 * A world for tags that search their source (card c313; doc/BROWSE.md,
 * "Arriving from a tag"), shared by tests/browse-tags.e2e.ts and
 * tests/tv-tags.e2e.ts: a fake engine whose manga has an author, an artist and
 * genres (the browse world's fake answers its details with none, and that file
 * is not this card's), a seeded database of its own, and a preview of the same
 * build, each on a port the OS hands out. Nothing here touches the shared
 * server or the browse world, so the files can run beside them.
 *
 * The fake answers as a real source does, wrong answers included: its genre
 * filter names some of the manga's genres and not others ("Gourmet" is on the
 * manga and in no filter), and its schema can be slow or fail outright.
 */

export const SOURCE = { id: '100', name: 'Tag Source' };
/**
 * A second working source, asked only by the preview's slow case: a source's
 * filters are kept once they answer (`keep`), so a case that needs a cold
 * cache needs a source no earlier case has asked.
 */
export const COLD = { id: '102', name: 'Cold Tags' };
/**
 * A third working source, asked only by the preview's pending case (c452),
 * which needs a cold cache after the slow case above has warmed COLD.
 */
export const COLDER = { id: '103', name: 'Colder Tags' };
/** Installed, but its extension failed to load: BROWSE's page only says why. */
export const BROKEN = { id: '101', name: 'Broken Tags' };

/** The preview's manga, as a search result names it (`sourceMangaId`). */
export const PREVIEW_URL = '/manga/preview-me';
export const previewId = `${SOURCE.id}~${Buffer.from(PREVIEW_URL).toString('base64url')}`;
/** The same manga, previewed from COLD. */
export const coldPreviewId = `${COLD.id}~${Buffer.from(PREVIEW_URL).toString('base64url')}`;
/** The same manga, previewed from COLDER. */
export const colderPreviewId = `${COLDER.id}~${Buffer.from(PREVIEW_URL).toString('base64url')}`;
/**
 * A manga whose genre string names one genre twice, as scraped themes do when
 * they merge a type list and a genre list (the engine splits it on commas and
 * keeps both: engine/backend.ts).
 */
export const REPEAT_URL = '/manga/repeats';
export const repeatId = `${SOURCE.id}~${Buffer.from(REPEAT_URL).toString('base64url')}`;

/** The source's filters (the browse world's shape: a sort, a select, a checkbox on, a text, a genre group). */
export const SCHEMA = [
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
		children: ['Action', 'Romance', 'Slice of Life'].map((name) => ({
			type: 'tristate',
			name,
			state: 0
		}))
	}
];
/** Where the genre group sits, for the `f<i>.<j>` keys a spec expects. */
export const GENRE = SCHEMA.findIndex((f) => f.name === 'Genre');

export type Call = {
	method: string;
	sourceId: string;
	search?: string;
	filterList?: {
		name: string;
		type: string;
		stateInt?: number;
		stateList?: { name: string; stateInt?: number; stateBoolean?: boolean }[];
	}[];
};

export type TagWorld = {
	base: string;
	ids: Record<
		'tagged' | 'unsourced' | 'missing' | 'broken' | 'hentoid' | 'gallery' | 'twice' | 'edited',
		number
	>;
	calls: () => Call[];
	reset: () => void;
	/** How the next schema calls answer: at once, after `ms`, or not at all (an engine error). */
	schema: (mode: 'ok' | 'down' | { slowMs: number }) => void;
	stop: () => Promise<void>;
};

export async function freePort(): Promise<number> {
	return new Promise<number>((resolve, reject) => {
		const probe = createServer();
		probe.once('error', reject);
		probe.listen(0, '127.0.0.1', () => {
			const { port } = probe.address() as AddressInfo;
			probe.close(() => resolve(port));
		});
	});
}

function seed(dbPath: string): TagWorld['ids'] {
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
		const ext = db.prepare(
			`INSERT INTO engine_extensions (pkg, name, kind, version_code, version_name, lib, handle, installed_at, updated_at, failed)
			VALUES (?, ?, 'manga', 1, '1', '1', ?, 0, 0, ?)`
		);
		const src = db.prepare(
			`INSERT INTO engine_sources (id, pkg, name, lang, base_url) VALUES (?, ?, ?, 'en', ?)`
		);
		ext.run('e2e.tags', SOURCE.name, 'e2e.tags'.padEnd(64, '0'), '');
		src.run(SOURCE.id, 'e2e.tags', SOURCE.name, 'https://tags.example');
		ext.run('e2e.tags.cold', COLD.name, 'e2e.tags.cold'.padEnd(64, '0'), '');
		src.run(COLD.id, 'e2e.tags.cold', COLD.name, 'https://cold.example');
		ext.run('e2e.tags.colder', COLDER.name, 'e2e.tags.colder'.padEnd(64, '0'), '');
		src.run(COLDER.id, 'e2e.tags.colder', COLDER.name, 'https://colder.example');
		ext.run('e2e.tags.broken', BROKEN.name, 'e2e.tags.broken'.padEnd(64, '0'), 'protobuf');
		src.run(BROKEN.id, 'e2e.tags.broken', BROKEN.name, 'https://broken.example');

		const series = (title: string, kind: string, source: string, key: string | null) =>
			Number(
				db
					.prepare(
						`INSERT INTO series (root_id, title, kind, source, hue, added_at, indexed_at, origin_key, in_library)
						VALUES (?, ?, ?, ?, 210, ?, ?, ?, 1)`
					)
					.run(root, title, kind, source, now, now, key).lastInsertRowid
			);
		const tagId = (namespace: string, value: string) => {
			db.prepare(`INSERT OR IGNORE INTO tags (namespace, value) VALUES (?, ?)`).run(
				namespace,
				value
			);
			return (
				db
					.prepare(`SELECT id FROM tags WHERE namespace = ? AND value = ?`)
					.get(namespace, value) as {
					id: number;
				}
			).id;
		};
		const tag = (id: number, namespace: string, value: string) =>
			db
				.prepare(`INSERT INTO series_tags (series_id, tag_id) VALUES (?, ?)`)
				.run(id, tagId(namespace, value));
		const entry = (id: number) =>
			db
				.prepare(
					`INSERT INTO entries (series_id, position, label, added_at, file, bytes, page_count, available, source_url)
					VALUES (?, 1, 'Ch. 1', ?, '', 0, 0, 0, '/c1')`
				)
				.run(id, now);

		// From the installed source: its tags ask where to look.
		const tagged = series('Tagbearer Heir', 'manhwa', 'mihon', `mihon:${SOURCE.id}:/manga/tagged`);
		tag(tagged, 'genre', 'Romance');
		tag(tagged, 'genre', 'Gourmet');
		tag(tagged, 'artist', 'Ren Kisaragi');
		// A bare tag: grouped under `tag`, stored with no namespace.
		tag(tagged, '', 'slice of life');
		// The doors with no sheet: no origin at all, a source not installed, one
		// whose extension failed, a Hentoid gallery (no family's key).
		const unsourced = series('Keyless Wanderer', 'manga', 'mihon', null);
		const missing = series('Gone Source Saga', 'manga', 'mihon', 'mihon:999:/manga/gone');
		const broken = series('Broken Source Tale', 'manga', 'mihon', `mihon:${BROKEN.id}:/manga/b`);
		const hentoid = series('Hentoid Gallery Tags', 'doujin', 'hentoid', 'hentoid:nhentai:/g/1');
		// A doujin with a Mihon key: a source's gallery, so its tags search that source.
		const gallery = series('Gallery From Tags', 'doujin', 'mihon', `mihon:${SOURCE.id}:/g/2`);
		// A bare tag and the same value under `tag:` (parseTag takes both): the
		// TAGS row groups both under `tag`, the same value twice.
		const twice = series('Twice Tagged Mecha', 'manga', 'mihon', `mihon:${SOURCE.id}:/manga/twice`);
		tag(twice, '', 'Mecha');
		tag(twice, 'tag', 'Mecha');
		// No tag but its genre: c451's case gives it a bare `Mecha` and a
		// `tag:Mecha` through the EDIT sheet, the owner's own door.
		const edited = series(
			'Edited Mecha Tale',
			'manga',
			'mihon',
			`mihon:${SOURCE.id}:/manga/edited`
		);
		for (const id of [tagged, unsourced, missing, broken, hentoid, gallery, twice, edited]) {
			entry(id);
			if (id !== tagged) tag(id, 'genre', 'Romance');
		}
		return { tagged, unsourced, missing, broken, hentoid, gallery, twice, edited };
	} finally {
		db.close();
	}
}

function startEngine(
	port: number,
	state: { calls: Call[]; mode: 'ok' | 'down' | { slowMs: number } }
) {
	const server = createHttp((req, res) => {
		const json = (status: number, v: unknown) =>
			res.writeHead(status, { 'content-type': 'application/json' }).end(JSON.stringify(v));
		if (req.url === '/challenges') return json(200, { solving: {}, solved: {} });
		let raw = '';
		req.on('data', (c) => (raw += c));
		req.on('end', () => {
			const b = JSON.parse(raw || '{}') as Call & { mangaData?: { url: string } };
			state.calls.push({
				method: b.method,
				sourceId: b.sourceId,
				search: b.search,
				filterList: b.filterList
			});
			const url = b.mangaData?.url ?? '';
			switch (b.method) {
				case 'filterSchemaManga': {
					const mode = state.mode;
					if (mode === 'down') return json(500, { error: 'the source is down' });
					if (typeof mode === 'object') {
						setTimeout(() => json(200, SCHEMA), mode.slowMs);
						return;
					}
					return json(200, SCHEMA);
				}
				case 'supportLatestManga':
					return json(200, false);
				case 'getPopularManga':
				case 'getSearchManga':
					return json(200, {
						mangas: [
							{ url: '/manga/found', title: 'Found By Tag', status: 1, thumbnail_url: null }
						],
						hasNextPage: false
					});
				case 'getDetailsManga':
					if (url === REPEAT_URL)
						return json(200, {
							url,
							title: 'Repeats Its Genres',
							author: 'Aoi Hanamura',
							genre: 'Action, Comedy, Action, Romance',
							description: 'A genre listed twice.',
							status: 1
						});
					return json(200, {
						url,
						title: 'Preview Me Tagged',
						author: 'Aoi Hanamura',
						artist: 'Ren Kisaragi',
						genre: 'Romance, Gourmet, slice of life',
						description: 'A preview with tags.',
						status: 1
					});
				case 'getChapterList':
					return json(200, [
						{ url: `${url}/c1`, name: 'Chapter 1', scanlator: null, chapter_number: 1 }
					]);
				default:
					return json(404, { error: 'unknown' });
			}
		});
	});
	return new Promise<Server>((ok) => server.listen(port, '127.0.0.1', () => ok(server)));
}

/** The world, up: seeded, its engine listening and its preview answering. */
export async function startTagWorld(name: string): Promise<TagWorld> {
	const work = mkdtempSync(join(tmpdir(), `tsundoku-e2e-${name}-`));
	const dbPath = join(work, 'library.sqlite');
	const ids = seed(dbPath);
	const state: { calls: Call[]; mode: 'ok' | 'down' | { slowMs: number } } = {
		calls: [],
		mode: 'ok'
	};
	const enginePort = await freePort();
	const engine = await startEngine(enginePort, state);
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
				BACKUP_DIR: join(work, 'backups'),
				SUWAYOMI_URL: ''
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
		ids,
		calls: () => state.calls,
		reset: () => {
			state.calls = [];
			state.mode = 'ok';
		},
		schema: (mode) => {
			state.mode = mode;
		},
		stop: async () => {
			preview.kill();
			engine.closeAllConnections();
			await new Promise((ok) => engine.close(ok));
			rmSync(work, { recursive: true, force: true });
		}
	};
}

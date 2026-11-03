import Database from 'better-sqlite3';
import { describe, expect, it } from 'vitest';
import { climb } from '$lib/server/db';
import { KIND_FACTS, KINDS, MOVABLE_KINDS, MOVE_MAP, SOURCE_KINDS } from '$lib/library/kinds';
import { movableKind } from '$lib/server/move';
import { planMihon } from '$lib/import/mihon-plan';
import type { MihonManga } from '$lib/import/mihon-backup';

/**
 * The registry against the database (doc/KINDS.md; card c301): the CHECK that
 * guards `series.kind` is the last line of defence, so a kind added to the
 * registry without a rung has to fail here rather than in production.
 *
 * A **fresh database at the top rung**, not the source text: rung 47 rewrote
 * `series`'s CHECK in place by string replacement (`OLD_KINDS`/`NEW_KINDS`
 * and `widenKinds`, db.ts:1268-1293), so the schema SQL in `sqlite_master` is the only thing that says
 * what SQLite accepts today. `src/lib/server/db.ts` is not this card's to
 * edit, and no rung is.
 *
 * Like every spec that opens a database it can flake under the whole parallel
 * unit run and passes alone; it is one of the migration specs by nature.
 */

// The one case below that goes through the app's own doors needs `getDb()`'s
// database: getDb reads this once, on first use, and nothing above calls it.
// The other cases climb connections of their own and never touch it.
process.env.DATABASE_PATH = ':memory:';
const { getDb } = await import('$lib/server/db');
const { seedSample } = await import('$lib/server/fixtures');
const { ensureRoot, writeSeries } = await import('$lib/server/import/write');
const { resolveLinks, setAnilistFetch } = await import('$lib/server/catalogue');
const move = await import('$lib/server/move');

const fresh = () => {
	const conn = new Database(':memory:');
	// From rung 0 to MIGRATIONS.length, the way a new install is created.
	climb(conn);
	return conn;
};

/** A table's `CHECK (kind IN (…))` values, read from the schema's own SQL. */
function kindCheck(conn: Database.Database, table: string): string[] {
	const row = conn
		.prepare(`SELECT sql FROM sqlite_master WHERE type = 'table' AND name = ?`)
		.get(table) as { sql: string } | undefined;
	expect(row, `${table} is in the schema`).toBeTruthy();
	const m = /\bkind\s+TEXT\s+NOT\s+NULL\s+CHECK\s*\(\s*kind\s+IN\s*\(([^)]*)\)/i.exec(row!.sql);
	expect(m, `${table}'s kind CHECK`).toBeTruthy();
	return m![1]
		.split(',')
		.map((v) => v.trim().replace(/^'|'$/g, ''))
		.filter(Boolean);
}

const sorted = (v: readonly string[]) => [...v].sort();

describe('series.kind', () => {
	it('accepts exactly the registry\u2019s kinds', () => {
		const conn = fresh();
		const values = kindCheck(conn, 'series');
		// The CHECK's list is rung 47's order, not the registry's: compare sets.
		expect(sorted(values)).toEqual(sorted(KINDS));
		expect(new Set(values).size).toBe(values.length);
	});

	it('takes every kind the registry names, and refuses one it does not', () => {
		// The schema's text is only half of it: the rung changed the schema's SQL
		// in place, so the CHECK has to be exercised on a live connection.
		const conn = fresh();
		conn.prepare(`INSERT INTO roots (id, name, path) VALUES (1, 'Mihon', '/nowhere')`).run();
		for (const kind of KINDS) {
			expect(() =>
				conn
					.prepare(`INSERT INTO series (root_id, title, kind, added_at) VALUES (1, ?, ?, 1)`)
					.run(kind, kind)
			).not.toThrow();
		}
		expect(() =>
			conn
				.prepare(
					`INSERT INTO series (root_id, title, kind, added_at) VALUES (1, 'Film', 'movie', 1)`
				)
				.run()
		).toThrow(/CHECK/);
	});
});

describe('engine_extensions.kind', () => {
	/**
	 * The card called this "the move table", and there is none: MOVE has no
	 * table of its own (`src/lib/server/db.ts` has no `move` table, and MOVE
	 * runs through a source's extension). This is the only CHECK in the schema
	 * listing exactly `('manga', 'anime')`, and what it lists is the two APK
	 * extension families' kinds -- Mihon's and Aniyomi's -- not the movable
	 * kinds, which are three (`MOVABLE_KINDS`, because a manhwa moves as a
	 * manga). So it is asserted against the source families it really names.
	 */
	it('names the APK source families\u2019 kinds, and nothing wider', () => {
		const conn = fresh();
		const values = kindCheck(conn, 'engine_extensions');
		expect(sorted(values)).toEqual(sorted([SOURCE_KINDS.mihon, SOURCE_KINDS.aniyomi]));
		expect(sorted(values)).toEqual(['anime', 'manga']);
	});

	it('is MOVE\u2019s map kind, which is narrower than the movable kinds', () => {
		// The same two words, for a different reason: an extension's kind, and
		// the shape of MOVE's map. A manhwa is movable and maps as a manga, so
		// MOVABLE_KINDS is not this list -- the map kind is.
		const conn = fresh();
		const values = kindCheck(conn, 'engine_extensions');
		expect(sorted(values)).toEqual(sorted([...new Set(Object.values(MOVE_MAP))]));
		expect(sorted(MOVABLE_KINDS)).toEqual(['anime', 'manga', 'manhwa']);
	});
});

describe('movable', () => {
	it('is the kinds movableKind offers MOVE to, as it offered them at fb2bd3a7', () => {
		// `movableKind` (src/lib/server/move.ts) is what `moveState`,
		// `moveEligible`, `moveComparison` and `applyMove` ask, and since K4
		// (c304) it reads `movable`. So this pins its answers to the ones it
		// gave as a list of names, for every kind, rather than to the fact.
		const before: Record<string, boolean> = {
			manga: true,
			manhwa: true,
			doujin: false,
			novel: false,
			anime: true
		};
		for (const k of KINDS) expect(movableKind(k), k).toBe(before[k]);
		expect(KINDS.filter((k) => movableKind(k))).toEqual([...MOVABLE_KINDS]);
	});

	/**
	 * Wave 16's open question, decided in wave 17 (c304): a doujin with a
	 * `mihon:` key does not move. A gallery source's series is a doujin and
	 * keeps its Mihon key (`planMihon`, mihon-plan.ts), yet `movable` is false
	 * for every doujin, so MOVE is not offered. Reached through the importer's
	 * own doors from a fresh seed, then asked through MOVE's.
	 */
	it('refuses a gallery doujin with a mihon: key at every MOVE door', async () => {
		const db = getDb();
		const NOW = Date.UTC(2026, 10, 3, 1);
		const NH = '7309872737163460316';
		const gallery: MihonManga = {
			source: NH,
			url: '/g/kinds-db-move/',
			title: 'A Gallery Doujin That Stays',
			artist: '',
			author: '',
			description: '',
			genres: [],
			status: 2,
			thumbnailUrl: '',
			dateAdded: 1,
			viewer: 0,
			chapters: [],
			categories: [],
			favorite: true,
			history: [],
			trackers: []
		};
		const planned = planMihon(
			{ categories: [], sources: new Map([[NH, 'NHentai']]), manga: [gallery] },
			[],
			NOW
		).series[0];
		expect(planned.kind).toBe('doujin');
		expect(planned.originKey).toMatch(/^mihon:/);
		const root = ensureRoot(db, 'Mihon', '/kinds-db/mihon-move', false);
		writeSeries(planned, { rootId: root, jobId: null, now: NOW, markMissing: false }, db);
		const row = db
			.prepare(`SELECT id, kind, in_library FROM series WHERE origin_key = ?`)
			.get(planned.originKey) as { id: number; kind: string; in_library: number };
		expect(row).toMatchObject({ kind: 'doujin', in_library: 1 });

		expect(move.moveState(row.id, NOW).eligible).toBe(false);
		expect(move.moveEligible(row.id)).toBeNull();
		expect(await move.moveComparison(row.id, '1~L3g', false, null, NOW)).toBeNull();
		expect(() =>
			move.applyMove(
				row.id,
				{ key: 'mihon:1:/x', source: 'Elsewhere', sourceId: '1', url: '/x' },
				[],
				{ now: NOW, db }
			)
		).toThrow(move.MoveError);
	});
});

describe('a doujin\u2019s catalogue', () => {
	/**
	 * Round 2 of wave 16 (c301): the audit said a doujin's catalogue was asked
	 * by no door, having looked only at the owner-facing ones (LINKABLE,
	 * linkState). The importer is a door too: `planMihon` keeps Mihon's MAL
	 * tracker for a gallery source's doujin (`malLink`, mihon-plan.ts:414),
	 * `writeSeries` links it (write.ts:448, `linkFromTracker`, no kind check),
	 * and `resolveLinks` reads the MAL id in the series' own kind's catalogue
	 * (catalogue.ts:487-545, `byIds`). So the fact is reached here through
	 * those, from a fresh seed, not through KIND_FACTS.
	 */
	it('is the one resolveLinks reads a gallery doujin\u2019s Mihon tracker in', async () => {
		const db = getDb();
		const NOW = Date.UTC(2026, 10, 3);
		seedSample(db, NOW);
		const NH = '7309872737163460316';
		const MAL = 424242;
		const gallery: MihonManga = {
			source: NH,
			url: '/g/kinds-db/',
			title: 'A Gallery Doujin',
			artist: '',
			author: '',
			description: '',
			genres: [],
			status: 2,
			thumbnailUrl: '',
			dateAdded: 1,
			viewer: 0,
			chapters: [],
			categories: [],
			favorite: true,
			history: [],
			trackers: [
				{
					service: 1,
					mediaId: MAL,
					title: 'A Gallery Doujin',
					status: 1,
					score: 0,
					lastChapterRead: 0,
					totalChapters: 0
				}
			]
		};
		const planned = planMihon(
			{ categories: [], sources: new Map([[NH, 'NHentai']]), manga: [gallery] },
			[],
			NOW
		).series[0];
		expect(planned.kind).toBe('doujin');
		expect(planned.malLink).toEqual({ id: MAL, score: 0 });
		const root = ensureRoot(db, 'Mihon', '/kinds-db/mihon', false);
		writeSeries(planned, { rootId: root, jobId: null, now: NOW, markMissing: false }, db);
		const series = db
			.prepare(
				`SELECT s.id, s.kind, l.via FROM series s JOIN series_links l ON l.series_id = s.id
				WHERE s.origin_key = ?`
			)
			.get(planned.originKey) as { id: number; kind: string; via: string } | undefined;
		expect(series).toMatchObject({ kind: 'doujin', via: 'mihon' });

		const queries: { query: string; ids: unknown }[] = [];
		setAnilistFetch(async (_url, init) => {
			const { query, variables } = JSON.parse(String(init?.body)) as {
				query: string;
				variables: { ids?: unknown };
			};
			queries.push({ query, ids: variables.ids });
			return new Response(JSON.stringify({ data: { Page: { media: [] } } }), {
				headers: { 'content-type': 'application/json' }
			});
		});
		try {
			await resolveLinks(NOW);
		} finally {
			setAnilistFetch(null);
		}
		const asked = queries.filter(
			(q) => q.query.includes('idMal_in') && Array.isArray(q.ids) && q.ids.includes(MAL)
		);
		expect(asked).toHaveLength(1);
		const type = /type: (\w+)/.exec(asked[0].query)?.[1];
		expect(type).toBe(KIND_FACTS.doujin.catalogue.type);
		expect(type).toBe('MANGA');
	});
});

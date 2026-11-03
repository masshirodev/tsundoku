import Database from 'better-sqlite3';
import { describe, expect, it } from 'vitest';
import { climb } from '$lib/server/db';
import { KINDS, MOVABLE_KINDS, MOVE_MAP, SOURCE_KINDS } from '$lib/library/kinds';
import { movableKind } from '$lib/server/move';

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
	it('is the kinds movableKind offers MOVE to, which is the server\u2019s rule', () => {
		// `movableKind` (src/lib/server/move.ts:56-57) is what `moveState` and
		// `moveEligible` ask; the registry's `movable` copies it until K4 makes
		// MOVE read the fact. A doujin and a novel are left out although each
		// can carry a family's key (a gallery's `mihon:`, LNReader's).
		expect(KINDS.filter((k) => movableKind(k))).toEqual([...MOVABLE_KINDS]);
		expect(movableKind('doujin')).toBe(false);
		expect(movableKind('novel')).toBe(false);
	});
});

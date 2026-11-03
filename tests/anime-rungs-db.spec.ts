import Database from 'better-sqlite3';
import { describe, expect, it } from 'vitest';
import { climb } from '$lib/server/db';
import { chosenMarks } from '$lib/server/anime/marks';

/**
 * The anime rungs that move stored marks, run against a database stopped at
 * the rung before and filled the way it was then. Each case also asks the
 * app's own rule (`chosenMarks`, which `syncEndingAt` writes) what every
 * entry's `ending_at` should be after the climb: the rung's SQL is a frozen
 * copy of that rule, and this is where the copy is checked against it.
 */

type Mark = {
	entry: number;
	method: 'source' | 'aniskip' | 'fingerprint';
	intro?: [number, number];
	ending?: [number, number];
};

function seed(conn: Database.Database, marks: Mark[]): void {
	for (const m of marks)
		conn
			.prepare(
				`INSERT INTO episode_marks (entry_id, method, intro_start, intro_end, ending_start, ending_end, tried_at)
				VALUES (?, ?, ?, ?, ?, ?, 1)`
			)
			.run(
				m.entry,
				m.method,
				m.intro?.[0] ?? null,
				m.intro?.[1] ?? null,
				m.ending?.[0] ?? null,
				m.ending?.[1] ?? null
			);
}

const endings = (conn: Database.Database) =>
	Object.fromEntries(
		(
			conn.prepare(`SELECT id, ending_at FROM entries ORDER BY id`).all() as {
				id: number;
				ending_at: number | null;
			}[]
		).map((r) => [r.id, r.ending_at])
	);

const methods = (conn: Database.Database) =>
	conn.prepare(`SELECT entry_id, method FROM episode_marks ORDER BY entry_id, method`).all() as {
		entry_id: number;
		method: string;
	}[];

/** Every entry's `ending_at` is what the app's own rule chooses from the marks left. */
function agreesWithTheRule(conn: Database.Database): void {
	const ids = (conn.prepare(`SELECT id FROM entries`).all() as { id: number }[]).map((r) => r.id);
	for (const id of ids)
		expect(
			(
				conn.prepare(`SELECT ending_at FROM entries WHERE id = ?`).get(id) as {
					ending_at: number | null;
				}
			).ending_at,
			`entry ${id}`
		).toBe(chosenMarks(id, conn).ending?.start ?? null);
}

describe('rung 63: fingerprints found before c384 are forgotten (c384)', () => {
	const old = () => {
		const conn = new Database(':memory:');
		climb(conn, 62);
		conn.exec(`
			INSERT INTO roots (id, name, path) VALUES (1, 'Engine', '/nowhere');
			INSERT INTO series (id, root_id, title, kind, added_at) VALUES (1, 1, 'Ranma', 'anime', 1);
			-- ending_at as the old rule wrote it: the best ending at the time.
			INSERT INTO entries (id, series_id, position, label, added_at, duration_s, ending_at) VALUES
				(1, 1, 1, 'Ep. 1', 1, 1440, 1300),
				(2, 1, 2, 'Ep. 2', 1, 1440, 1298.25),
				(3, 1, 3, 'Ep. 3', 1, 1440, 1310),
				(4, 1, 4, 'Ep. 4', 1, 1440, 1320),
				(5, 1, 5, 'Ep. 5', 1, 1440, 1350),
				(6, 1, 6, 'Ep. 6', 1, NULL, 1330),
				(7, 1, 7, 'Ep. 7', 1, 1440, 1290);
		`);
		seed(conn, [
			// A source's ending beside a fingerprint: the source's stays.
			{ entry: 1, method: 'source', ending: [1300, 1390] },
			{ entry: 1, method: 'fingerprint', intro: [22.75, 60.75], ending: [1299, 1387] },
			// The fingerprint was the only ending: none is left.
			{ entry: 2, method: 'fingerprint', intro: [22.75, 60.75], ending: [1298.25, 1387.875] },
			// A negative fingerprint (asked, found nothing) goes too; AniSkip's stays.
			{ entry: 3, method: 'fingerprint' },
			{ entry: 3, method: 'aniskip', intro: [80, 170], ending: [1310, 1400] },
			// No fingerprint at all: nothing of this entry moves.
			{ entry: 4, method: 'aniskip', ending: [1320, 1410] },
			// A source ending past the episode's end is not usable; AniSkip's is chosen.
			{ entry: 5, method: 'source', ending: [1350, 1500] },
			{ entry: 5, method: 'aniskip', ending: [1340, 1430] },
			{ entry: 5, method: 'fingerprint', ending: [1350, 1430] },
			// An unknown length takes any sane span.
			{ entry: 6, method: 'source', ending: [1330, 1420] },
			{ entry: 6, method: 'fingerprint', ending: [1200, 1290] },
			// Source, AniSkip and a fingerprint all usable: the source's wins.
			{ entry: 7, method: 'source', ending: [1335, 1425] },
			{ entry: 7, method: 'aniskip', ending: [1330, 1420] },
			{ entry: 7, method: 'fingerprint', ending: [1290, 1380] }
		]);
		return conn;
	};

	it('removes every fingerprint row, found or not, and keeps the other finders', () => {
		const conn = old();
		climb(conn, 63);
		expect(conn.pragma('user_version', { simple: true })).toBe(63);
		expect(methods(conn)).toEqual([
			{ entry_id: 1, method: 'source' },
			{ entry_id: 3, method: 'aniskip' },
			{ entry_id: 4, method: 'aniskip' },
			{ entry_id: 5, method: 'aniskip' },
			{ entry_id: 5, method: 'source' },
			{ entry_id: 6, method: 'source' },
			{ entry_id: 7, method: 'aniskip' },
			{ entry_id: 7, method: 'source' }
		]);
	});

	it('moves ending_at to what remains, and to nothing where only a fingerprint had one', () => {
		const conn = old();
		climb(conn, 63);
		expect(endings(conn)).toEqual({
			1: 1300,
			2: null,
			3: 1310,
			4: 1320,
			5: 1340,
			6: 1330,
			7: 1335
		});
		agreesWithTheRule(conn);
	});

	it('leaves an entry with no fingerprint alone, even one whose ending_at the rule would change', () => {
		// The rung touches only what it forgets: an ending_at the rule would
		// write otherwise is another rung's business, not this one's.
		const conn = old();
		conn.prepare(`UPDATE entries SET ending_at = 1 WHERE id = 4`).run();
		climb(conn, 63);
		expect(endings(conn)[4]).toBe(1);
	});
});

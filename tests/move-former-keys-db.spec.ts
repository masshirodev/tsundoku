import { beforeAll, describe, expect, it } from 'vitest';

// Before anything imports db.ts: getDb() reads this once and memoises.
process.env.DATABASE_PATH = ':memory:';

const { getDb } = await import('$lib/server/db');
const move = await import('$lib/server/move');
const { writeSeries } = await import('$lib/server/import/write');
type PlannedSeries = import('$lib/import/plan').PlannedSeries;

/**
 * Every key a series has left (rung 58; card c139; doc/MOVE.md): a series moved
 * A → B → C forgot A, and the tablet's backup still names A. The same record
 * goes for an entry's own addresses. The source answers are fabricated here;
 * nothing reaches a network.
 */

const NOW = Date.UTC(2026, 10, 1, 12);
let root = 0;

function candidate(n: number, url: string): import('$lib/library/move').MoveCandidateEntry {
	return {
		number: n,
		season: null,
		title: `Chapter ${n}`,
		url,
		name: `Chapter ${n}`,
		uploaded: NOW,
		order: n
	};
}

function target(
	sourceId: string,
	url: string,
	source: string
): import('$lib/server/move').MoveTarget {
	return { key: `mihon:${sourceId}:${url}`, source, sourceId, url };
}

function makeSeries(title: string, key: string): number {
	return Number(
		getDb()
			.prepare(
				`INSERT INTO series (root_id, title, kind, source, status, added_at, indexed_at, origin_key)
				VALUES (?, ?, 'manga', 'mihon', 'ongoing', ?, ?, ?)`
			)
			.run(root, title, NOW, NOW, key).lastInsertRowid
	);
}

function makeEntry(seriesId: number, url: string): number {
	return Number(
		getDb()
			.prepare(
				`INSERT INTO entries (series_id, position, label, title, added_at, source_url)
				VALUES (?, 1, 'Ch. 1', '', ?, ?)`
			)
			.run(seriesId, NOW, url).lastInsertRowid
	);
}

/** A backup's plan for one chapter, as the tablet still names it. */
function planned(title: string, originKey: string, url: string): PlannedSeries {
	return {
		originKey,
		source: 'mihon',
		title,
		kind: 'manga',
		rating: 0,
		favourite: false,
		hidden: false,
		shelves: [],
		tags: [],
		description: '',
		status: '',
		direction: null,
		addedAt: NOW,
		sourceUrl: url,
		path: '',
		entries: [
			{
				position: 1,
				label: 'Ch. 1',
				title: '',
				sourceUrl: url,
				available: false,
				file: '',
				bytes: 0,
				pageCount: 0,
				addedAt: NOW,
				readAt: null,
				lastPosition: null,
				lastOpenedAt: null,
				history: null
			}
		]
	};
}

const keys = (seriesId: number) =>
	getDb()
		.prepare(
			`SELECT origin_key, left_at FROM series_former_keys WHERE series_id = ? ORDER BY left_at`
		)
		.all(seriesId) as { origin_key: string; left_at: number }[];

const urls = (entryId: number) =>
	getDb()
		.prepare(
			`SELECT former_url, left_at FROM entry_former_urls WHERE entry_id = ? ORDER BY left_at`
		)
		.all(entryId) as { former_url: string; left_at: number }[];

const count = (table: string, where: string, value: number) =>
	(
		getDb().prepare(`SELECT COUNT(*) AS n FROM ${table} WHERE ${where} = ?`).get(value) as {
			n: number;
		}
	).n;

beforeAll(() => {
	const db = getDb();
	root = Number(
		db.prepare(`INSERT INTO roots (name, path, hidden) VALUES ('Library', '/l', 0)`).run()
			.lastInsertRowid
	);
});

describe('a series moved more than once', () => {
	it('resolves a backup naming the source before the last move, without a twin or a second chapter', () => {
		const series = makeSeries('Formerberg', 'mihon:100:/a');
		const entry = makeEntry(series, '/a/c1');
		move.applyMove(series, target('200', '/b', 'Weeb Central'), [candidate(1, '/b/c1')], {
			now: NOW
		});
		move.applyMove(series, target('300', '/c', 'Other Source'), [candidate(1, '/c/c1')], {
			now: NOW + 1000
		});
		// Both keys are remembered, and the chapter keeps both addresses. C is
		// current, so it is not also a former key.
		expect(keys(series)).toEqual([
			{ origin_key: 'mihon:100:/a', left_at: NOW },
			{ origin_key: 'mihon:200:/b', left_at: NOW + 1000 }
		]);
		expect(urls(entry)).toEqual([
			{ former_url: '/a/c1', left_at: NOW },
			{ former_url: '/b/c1', left_at: NOW + 1000 }
		]);

		const result = writeSeries(planned('Formerberg', 'mihon:100:/a', '/a/c1'), {
			rootId: root,
			jobId: null,
			now: NOW + 2000
		});
		expect(result).toEqual({ created: false, entriesAdded: 0, filesAttached: 0 });
		expect(
			(
				getDb().prepare(`SELECT COUNT(*) AS n FROM series WHERE title = 'Formerberg'`).get() as {
					n: number;
				}
			).n
		).toBe(1);
		expect(count('entries', 'series_id', series)).toBe(1);
		// The series keeps the key it moved to.
		expect(
			(
				getDb().prepare(`SELECT origin_key FROM series WHERE id = ?`).get(series) as {
					origin_key: string;
				}
			).origin_key
		).toBe('mihon:300:/c');
	});
});

describe('a series moved back', () => {
	it('takes the key it returned to out of the former keys, and the one just left stays', () => {
		const series = makeSeries('Backberg', 'mihon:100:/back');
		const entry = makeEntry(series, '/back/c1');
		move.applyMove(series, target('200', '/backb', 'Weeb Central'), [candidate(1, '/backb/c1')], {
			now: NOW
		});
		move.applyMoveBack(series, [candidate(1, '/back/c1')], { now: NOW + 1000 });
		expect(keys(series)).toEqual([{ origin_key: 'mihon:200:/backb', left_at: NOW + 1000 }]);
		expect(urls(entry)).toEqual([{ former_url: '/backb/c1', left_at: NOW + 1000 }]);

		const result = writeSeries(planned('Backberg', 'mihon:200:/backb', '/backb/c1'), {
			rootId: root,
			jobId: null,
			now: NOW + 2000
		});
		expect(result).toEqual({ created: false, entriesAdded: 0, filesAttached: 0 });
		expect(
			(
				getDb().prepare(`SELECT COUNT(*) AS n FROM series WHERE title = 'Backberg'`).get() as {
					n: number;
				}
			).n
		).toBe(1);
		expect(count('entries', 'series_id', series)).toBe(1);
	});
});

describe('a series that goes', () => {
	it('takes its former keys and its entries’ former addresses with it', () => {
		const series = makeSeries('Goneberg', 'mihon:100:/gone');
		const entry = makeEntry(series, '/gone/c1');
		move.applyMove(series, target('200', '/goneb', 'Weeb Central'), [candidate(1, '/goneb/c1')], {
			now: NOW
		});
		expect(count('series_former_keys', 'series_id', series)).toBe(1);
		expect(count('entry_former_urls', 'entry_id', entry)).toBe(1);

		getDb().prepare(`DELETE FROM series WHERE id = ?`).run(series);
		expect(count('series_former_keys', 'series_id', series)).toBe(0);
		expect(count('entry_former_urls', 'entry_id', entry)).toBe(0);
	});
});

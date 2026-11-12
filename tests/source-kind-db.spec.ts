import { describe, expect, it } from 'vitest';
import type { PlannedEntry, PlannedSeries } from '$lib/import/plan';

// Before anything imports db.ts: getDb() reads this once and memoises.
process.env.DATABASE_PATH = ':memory:';
process.env.ENGINE_TOKEN = 't';

const { getDb } = await import('$lib/server/db');
const { ensureRoot, writeSeries } = await import('$lib/server/import/write');
const { animeKeyOf, keyOf, novelKeyOf } = await import('$lib/library/downloads');
const { defaultSourceKind, sourceKindChoices } = await import('$lib/library/kinds');
const { setSourceKind, sourceKind, sourceKindOfKey } =
	await import('$lib/server/engine/source-kind');
const { kindOfSource } = await import('../src/routes/downloads/search/kinds.server');

/**
 * The kind a source serves (card c986; doc/KINDS.md, "The kind a source cannot
 * name"): where it is kept, that a new series takes it, and that one already
 * in the library keeps its own.
 */

const db = getDb();
const NOW = Date.UTC(2026, 10, 12, 12);
const MANGA = '300';
const root = ensureRoot(db, 'Mihon', '/nowhere/Mihon', false);

const entry = (n: number, url: string): PlannedEntry => ({
	position: n,
	label: `Ch. ${n}`,
	title: '',
	sourceUrl: url,
	scanlator: '',
	available: true,
	file: `c${n}.cbz`,
	bytes: 0,
	pageCount: 10,
	addedAt: NOW,
	readAt: null,
	lastPosition: null,
	lastOpenedAt: null,
	history: null
});

const plan = (originKey: string, title: string, kind: PlannedSeries['kind']): PlannedSeries => ({
	originKey,
	source: originKey.slice(0, originKey.indexOf(':')) as PlannedSeries['source'],
	title,
	kind,
	rating: 0,
	favourite: false,
	hidden: false,
	shelves: [],
	tags: [],
	description: '',
	status: '',
	direction: null,
	addedAt: NOW,
	sourceUrl: '',
	path: '',
	entries: [entry(1, `${originKey}/c1`)]
});

const write = (originKey: string, title: string, kind: PlannedSeries['kind']) => {
	writeSeries(plan(originKey, title, kind), { rootId: root, jobId: null, now: NOW }, db);
	return db.prepare(`SELECT id, kind FROM series WHERE origin_key = ?`).get(originKey) as {
		id: number;
		kind: string;
	};
};

// Two engine rows, so a source has a family to ask (never called: nothing here
// reaches the engine).
for (const [pkg, id, kind] of [
	['en.manga', MANGA, 'manga'],
	['en.anime', '400', 'anime']
]) {
	db.prepare(
		`INSERT INTO engine_extensions (pkg, name, kind, version_code, version_name, lib, handle, installed_at, updated_at)
		VALUES (?, ?, ?, 1, '1.0', '1.4', ?, 0, 0)`
	).run(pkg, pkg, kind, pkg.padEnd(64, 'x'));
	db.prepare(
		`INSERT INTO engine_sources (id, pkg, name, lang, base_url)
		VALUES (?, ?, ?, 'en', 'https://example.org')`
	).run(id, pkg, pkg);
}

describe('the choices a family has', () => {
	it('every family defaults to the first kind it may serve', () => {
		expect(defaultSourceKind('mihon')).toBe('manga');
		expect(defaultSourceKind('lnreader')).toBe('novel');
		expect(defaultSourceKind('aniyomi')).toBe('anime');
		expect(sourceKindChoices('mihon')).toEqual(['manga', 'manhwa', 'doujin']);
	});
});

describe('a source keeps its own kind', () => {
	it('is AUTO (null) until set, and AUTO again when cleared', () => {
		expect(sourceKind(MANGA, 'mihon')).toBeNull();
		setSourceKind(MANGA, 'mihon', 'manhwa');
		expect(sourceKind(MANGA, 'mihon')).toBe('manhwa');
		setSourceKind(MANGA, 'mihon', 'manga');
		expect(sourceKind(MANGA, 'mihon')).toBe('manga');
		setSourceKind(MANGA, 'mihon', null);
		expect(sourceKind(MANGA, 'mihon')).toBeNull();
		expect(
			db.prepare(`SELECT value FROM settings WHERE key = ?`).get(`source.kind:${MANGA}`)
		).toBeUndefined();
	});

	it('refuses a kind its family cannot serve', () => {
		expect(() => setSourceKind(MANGA, 'mihon', 'novel')).toThrow();
		expect(() => setSourceKind(MANGA, 'mihon', 'anime')).toThrow();
		expect(sourceKind(MANGA, 'mihon')).toBeNull();
	});

	it('reads a stored word its family cannot serve as nothing', () => {
		db.prepare(`INSERT INTO settings (key, value) VALUES (?, 'anime')`).run(`source.kind:${MANGA}`);
		expect(sourceKind(MANGA, 'mihon')).toBeNull();
		db.prepare(`DELETE FROM settings WHERE key = ?`).run(`source.kind:${MANGA}`);
	});

	it('answers by a series’ key, and nothing for a key no family parses', () => {
		setSourceKind(MANGA, 'mihon', 'manhwa');
		expect(sourceKindOfKey(keyOf(MANGA, '/manga/a'))).toBe('manhwa');
		expect(sourceKindOfKey(animeKeyOf('400', '/anime/b'))).toBeNull();
		expect(sourceKindOfKey(novelKeyOf('good', '/novel/c'))).toBeNull();
		expect(sourceKindOfKey('mihon-dir:Manga/A Book')).toBeNull();
		expect(sourceKindOfKey('hentoid:nhentai/A Book')).toBeNull();
		expect(sourceKindOfKey(null)).toBeNull();
		setSourceKind(MANGA, 'mihon', null);
	});

	it('is what a search source serves, so MANHWA is a cell there', () => {
		expect(kindOfSource(MANGA)).toBe('manga');
		setSourceKind(MANGA, 'mihon', 'manhwa');
		expect(kindOfSource(MANGA)).toBe('manhwa');
		setSourceKind(MANGA, 'mihon', null);
	});
});

describe('a new series takes its source’s kind', () => {
	it('over the plan’s own inference', () => {
		setSourceKind(MANGA, 'mihon', 'manhwa');
		const s = write(keyOf(MANGA, '/manga/a'), 'From The Manga Source', 'manga');
		expect(s.kind).toBe('manhwa');
	});

	it('even a gallery’s doujin, when the owner says manga', () => {
		setSourceKind(MANGA, 'mihon', 'manga');
		const s = write(keyOf(MANGA, '/manga/gallery'), 'A Gallery', 'doujin');
		expect(s.kind).toBe('manga');
	});

	it('never rewrites a series already in the library', () => {
		setSourceKind(MANGA, 'mihon', null);
		const key = keyOf(MANGA, '/manga/b');
		write(key, 'Already Here', 'manga');
		setSourceKind(MANGA, 'mihon', 'manhwa');
		const again = write(key, 'Already Here', 'manga');
		expect(again.kind).toBe('manga');
		setSourceKind(MANGA, 'mihon', null);
	});

	it('leaves a key no family parses to the plan', () => {
		const s = write('mihon-dir:Some Folder/A Book', 'From A Folder', 'doujin');
		expect(s.kind).toBe('doujin');
	});
});

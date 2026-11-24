import { describe, expect, it } from 'vitest';
import type { PlannedEntry, PlannedSeries } from '$lib/import/plan';

// Before anything imports db.ts: getDb() reads this once and memoises.
process.env.DATABASE_PATH = ':memory:';
process.env.ENGINE_TOKEN = 't';

const { getDb } = await import('$lib/server/db');
const { ensureRoot, writeSeries } = await import('$lib/server/import/write');
const { forgetSourceUse } = await import('$lib/server/library-sources');
const flags = await import('$lib/server/engine/source-flags');
const { addToLibrary, sourceMangaId, undoAdd } = await import('$lib/server/engine/backend');
const { createCollection, seriesDetail } = await import('$lib/server/library');
const { keyOf } = await import('$lib/library/downloads');
const {
	addedBand,
	addedLanding,
	bandShelves,
	BAND_UNKNOWN,
	newShelfAdded,
	shelveAdded,
	SHELVE_GONE
} = await import('../src/routes/browse/added.server');

/**
 * PUT ON A SHELF on the ADDED band (doc/BROWSE.md, "Shelves in the
 * ADD band"): a chip's write and + NEW SHELF's, against an in-memory library
 * reached through the app's own actions (an ADD outside reveal from a source
 * with ADDED HIDDEN on, as the preview's action runs it), and what UNDO does
 * to the shelves after.
 */

const db = getDb();
const NOW = Date.UTC(2026, 10, 7, 12);
const SRC = '510';
const root = ensureRoot(db, 'Mihon', '/nowhere/Mihon', false);
const entry = (n: number, url: string): PlannedEntry => ({
	position: n,
	label: `Ch. ${n}`,
	title: '',
	sourceUrl: url,
	scanlator: '',
	available: false,
	file: `c${n}.cbz`,
	bytes: 0,
	pageCount: 10,
	addedAt: NOW,
	readAt: null,
	lastPosition: null,
	lastOpenedAt: null,
	history: null
});
const plan = (originKey: string, title: string): PlannedSeries => ({
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
	sourceUrl: '',
	path: '',
	entries: [entry(1, `${originKey}/c1`), entry(2, `${originKey}/c2`)]
});
const idOf = (key: string) =>
	(db.prepare(`SELECT id FROM series WHERE origin_key = ?`).get(key) as { id: number }).id;

db.prepare(
	`INSERT INTO engine_extensions (pkg, name, kind, version_code, version_name, lib, handle, installed_at, updated_at)
	VALUES ('en.shelf', 'Shelf Source', 'manga', 1, '1.0', '1.4', ?, 0, 0)`
).run('en.shelf'.padEnd(64, 'x'));
db.prepare(
	`INSERT INTO engine_sources (id, pkg, name, lang, base_url) VALUES (?, 'en.shelf', 'Shelf Source', 'en', 'https://shelf.example')`
).run(SRC);
// Two shown series, so one ADD hidden leaves the source found: the band is the source page's.
for (const p of ['/manga/s1', '/manga/s2'])
	writeSeries(plan(keyOf(SRC, p), `Shown ${p}`), { rootId: root, jobId: null, now: NOW }, db);
flags.setSourceFlag(SRC, 'addedHidden', true);
forgetSourceUse();

const later = createCollection('Later');
const faves = createCollection('Faves');

/** A browsing record of `path`, then ADD outside reveal as the preview's action runs it, and the band's URL. */
async function addHidden(path: string) {
	const key = keyOf(SRC, path);
	const id = sourceMangaId(SRC, path);
	writeSeries(
		plan(key, `Added ${path}`),
		{ rootId: root, jobId: null, now: NOW, browsing: true },
		db
	);
	const r = await flags.addWatchingHidden(key, () => addToLibrary(id, NOW));
	const to = new URL(addedLanding(r, id, `/browse/${SRC}`, false, { added: id }), 'http://x');
	return { id, key, seriesId: r.seriesId, to };
}
const chip = (seriesId: number, preview: string, collection: number, on: boolean) => {
	const f = new FormData();
	f.set('series', String(seriesId));
	f.set('preview', preview);
	f.set('collection', String(collection));
	f.set('on', on ? '1' : '0');
	return f;
};
const shelvesOf = (seriesId: number) => seriesDetail(seriesId, true)?.collections ?? [];

describe('a chip on the band', () => {
	it('puts the band’s series on a shelf, on two, and a second tap takes one off', async () => {
		const a = await addHidden('/manga/a');
		expect(a.to.pathname).toBe(`/browse/${SRC}`);
		expect(a.to.searchParams.get('added')).toBe('hidden');
		const band = await addedBand(a.to.searchParams, SRC, false);
		expect(band?.seriesId).toBe(a.seriesId);
		expect(bandShelves(band)).toEqual([]);
		expect(bandShelves(null)).toEqual([]);

		expect(await shelveAdded(chip(a.seriesId, a.id, later, true), SRC)).toEqual({
			collection: later,
			on: true
		});
		// The same tap twice is the same write: still on it once.
		expect(await shelveAdded(chip(a.seriesId, a.id, later, true), SRC)).toEqual({
			collection: later,
			on: true
		});
		await shelveAdded(chip(a.seriesId, a.id, faves, true), SRC);
		expect(bandShelves(band).sort()).toEqual([later, faves].sort());
		// BROWSE's band (any source's) shelves it the same.
		await shelveAdded(chip(a.seriesId, a.id, faves, false), null);
		expect(bandShelves(band)).toEqual([later]);
		// Hidden still: the chip did not show it.
		expect(seriesDetail(a.seriesId, false)).toBeNull();
	});

	it('refuses a shelf that does not exist, and a band that is not its series’', async () => {
		const b = await addHidden('/manga/b');
		expect(await shelveAdded(chip(b.seriesId, b.id, 9999, true), SRC)).toEqual({
			status: 400,
			message: 'no such shelf'
		});
		const bad = chip(b.seriesId, b.id, later, true);
		bad.set('collection', 'x');
		expect(await shelveAdded(bad, SRC)).toMatchObject({ status: 400 });
		// Another series' id under this preview: the band's own facts don't hold.
		const shown = idOf(keyOf(SRC, '/manga/s1'));
		expect(await shelveAdded(chip(shown, b.id, later, true), SRC)).toEqual({
			status: 409,
			message: SHELVE_GONE
		});
		expect(shelvesOf(shown)).toEqual([]);
		// Another source page's band.
		expect(await shelveAdded(chip(b.seriesId, b.id, later, true), '999')).toMatchObject({
			status: 409
		});
		expect(shelvesOf(b.seriesId)).toEqual([]);
	});

	it('UNDO takes both back: the series and its shelves; a chip tapped after UNDO shelves nothing', async () => {
		const c = await addHidden('/manga/c');
		await shelveAdded(chip(c.seriesId, c.id, later, true), SRC);
		await shelveAdded(chip(c.seriesId, c.id, faves, true), SRC);
		expect(shelvesOf(c.seriesId).length).toBe(2);
		expect(await undoAdd(c.seriesId)).toBe(true);
		// The series row is gone, and its shelf rows with it (ON DELETE CASCADE).
		const rows = db
			.prepare(`SELECT COUNT(*) AS n FROM collection_series WHERE series_id = ?`)
			.get(c.seriesId) as { n: number };
		expect(rows.n).toBe(0);
		expect(await shelveAdded(chip(c.seriesId, c.id, later, true), SRC)).toEqual({
			status: 409,
			message: SHELVE_GONE
		});
		const after = db
			.prepare(`SELECT COUNT(*) AS n FROM collection_series WHERE series_id = ?`)
			.get(c.seriesId) as { n: number };
		expect(after.n).toBe(0);
		// The shelves themselves stay: only the series left them.
		expect(
			db.prepare(`SELECT COUNT(*) AS n FROM collections WHERE id IN (?, ?)`).get(later, faves)
		).toEqual({
			n: 2
		});
	});
});

describe('+ NEW SHELF on the band', () => {
	/** The action's own URL on the page the band landed on, and that page's source (BROWSE's is none). */
	const at = (to: URL) => ({
		here: new URL(`http://app.test${to.pathname}?/newShelf`),
		source: to.pathname === '/browse' ? null : SRC,
		other: to.pathname === '/browse' ? `/browse/${SRC}` : '/browse'
	});
	const named = (name: string) => {
		const f = new FormData();
		f.set('name', name);
		return f;
	};

	it('makes the shelf, puts the band’s series on it, and lands on the band with the sheet closed', async () => {
		const d = await addHidden('/manga/d');
		const { here, source } = at(d.to);
		const band = `http://app.test${d.to.pathname}?${d.to.searchParams}&new=shelf`;
		const r = await newShelfAdded(named('  To Read  '), band, here, source);
		expect(r).toHaveProperty('to');
		if (!('to' in r)) return;
		const to = new URL(r.to, 'http://app.test');
		expect(to.pathname).toBe(d.to.pathname);
		expect(to.searchParams.has('new')).toBe(false);
		expect(to.searchParams.get('series')).toBe(String(d.seriesId));
		expect(shelvesOf(d.seriesId)).toEqual([r.collection]);
		const name = db.prepare(`SELECT name FROM collections WHERE id = ?`).get(r.collection);
		expect(name).toEqual({ name: 'To Read' });
		// The same name again is the same shelf (createCollection), and the series stays on it once.
		const again = await newShelfAdded(named('To Read'), band, here, source);
		expect(again).toMatchObject({ collection: r.collection });
		expect(shelvesOf(d.seriesId)).toEqual([r.collection]);
	});

	// A browser or an extension set to no-referrer sends none: the sheet posts
	// the band's own address, which is read first (c791).
	it('reads the band the sheet posts, with no Referer at all', async () => {
		const f2 = await addHidden('/manga/f2');
		const { here, source } = at(f2.to);
		const form = named('No Referer');
		form.set('band', `${f2.to.pathname}?${f2.to.searchParams}&new=shelf`);
		const r = await newShelfAdded(form, null, here, source);
		expect(r).toHaveProperty('to');
		if (!('to' in r)) return;
		expect(new URL(r.to, 'http://app.test').searchParams.has('new')).toBe(false);
		expect(shelvesOf(f2.seriesId)).toEqual([r.collection]);
		// The field must name this page too: another page's address is no band of this one's.
		const elsewhere = named('Elsewhere');
		elsewhere.set('band', `/somewhere-else?${f2.to.searchParams}`);
		expect(await newShelfAdded(elsewhere, null, here, source)).toEqual({
			status: 409,
			message: BAND_UNKNOWN
		});
	});

	it('makes nothing for a band it cannot read, or one that is gone', async () => {
		const e = await addHidden('/manga/e');
		const { here, source, other } = at(e.to);
		const count = () =>
			(db.prepare(`SELECT COUNT(*) AS n FROM collections`).get() as { n: number }).n;
		const before = count();
		const band = `http://app.test${e.to.pathname}?${e.to.searchParams}`;
		for (const referer of [
			null,
			'',
			'not a url',
			// Another origin, and another page of this one.
			`http://evil.example${e.to.pathname}?${e.to.searchParams}`,
			`http://app.test${other}?${e.to.searchParams}`,
			// This page, without a band.
			`http://app.test${e.to.pathname}`
		])
			// Nothing here says which series: not "gone", which would be false.
			expect(await newShelfAdded(named('Nope'), referer, here, source), String(referer)).toEqual({
				status: 409,
				message: BAND_UNKNOWN
			});
		expect(await newShelfAdded(named('   '), band, here, source)).toEqual({
			status: 400,
			message: 'a shelf needs a name'
		});
		expect(await undoAdd(e.seriesId)).toBe(true);
		expect(await newShelfAdded(named('After Undo'), band, here, source)).toEqual({
			status: 409,
			message: SHELVE_GONE
		});
		expect(count()).toBe(before);
	});
});

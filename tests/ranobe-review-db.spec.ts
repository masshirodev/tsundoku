import { vi, beforeEach, describe, expect, it } from 'vitest';

// Before anything imports db.ts: getDb() reads this once and memoises.
process.env.DATABASE_PATH = ':memory:';
process.env.RANOBE_TOKEN = 'rb_test';
process.env.RANOBE_URL = 'https://ranobe.test/api/v1';

const { getDb } = await import('$lib/server/db');
const { seedSample } = await import('$lib/server/fixtures');
const rb = await import('$lib/server/ranobe');
const rv = await import('$lib/server/ranobe-review');

const db = getDb();
const NOW = Date.UTC(2026, 8, 27, 14, 20);
seedSample(db, NOW);

const root = (db.prepare(`SELECT id FROM roots WHERE name = 'Library'`).get() as { id: number }).id;
const hentoid = (db.prepare(`SELECT id FROM roots WHERE name = 'Hentoid'`).get() as { id: number })
	.id;
/** A novel series of one EPUB volume, with `n` chapters and `read` of them read. */
function volume(title: string, n = 3, read = 0, rootId = root, source = 'epub'): number {
	const id = Number(
		db
			.prepare(
				`INSERT INTO series (root_id, title, kind, source, hue, added_at, indexed_at) VALUES (?, ?, 'novel', ?, 230, ?, ?)`
			)
			.run(rootId, title, source, NOW, NOW).lastInsertRowid
	);
	for (let i = 1; i <= n; i++)
		db.prepare(
			`INSERT INTO entries (series_id, position, label, added_at, read_at, file) VALUES (?, ?, ?, ?, ?, ?)`
		).run(id, i, `Chapter ${i}`, NOW, i <= read ? NOW : null, `${title}.epub`);
	return id;
}
const V2 = volume('The Beginning After the End, Vol. 2', 3, 3);
const V3 = volume('The Beginning After the End, Vol. 3');
const V8 = volume('The Beginning After The End 08');
const V8B = volume('The Beginning After the End Volume 8');
const LOTM = volume('Lord of the Mysteries: 1-1429');
const HIDDEN = volume('The Beginning After the End, Vol. 9');
db.prepare(`UPDATE series SET hidden = 1 WHERE id = ?`).run(HIDDEN);
const FROM_HENTOID = volume('The Beginning After the End, Vol. 10', 3, 0, hentoid, 'hentoid');

// ---- Ranobe, faked --------------------------------------------------------------------------

type Call = { method: string; path: string; query: string };
let calls: Call[] = [];
let down = false;
const tbate = {
	ref: 'w388',
	kind: { id: 'web_novel', label: 'Web novel' },
	title: 'The Beginning After the End',
	matched: 'The Beginning After the End',
	status: 'ongoing',
	years: '2017–',
	cover: { url: '/img/388.jpg', sensitive: false },
	units: { volume: 9 }
};
const side = {
	...tbate,
	ref: 'w1301',
	title: 'The Beginning After the End: Side Stories',
	cover: { url: '/img/1301.jpg', sensitive: true },
	units: { volume: 1 }
};
const json = (d: unknown, status = 200) =>
	new Response(JSON.stringify(d), { status, headers: { 'content-type': 'application/json' } });
rb.setRanobeFetch(async (input, init) => {
	if (down) throw new TypeError('fetch failed');
	const url = new URL(String(input));
	const path = url.pathname.replace('/api/v1', '');
	calls.push({ method: init?.method ?? 'GET', path, query: url.search });
	if (path === '/lookup') return json({ results: {} });
	if (path === '/search') {
		const q = url.searchParams.get('q') ?? '';
		return json({
			items: q.startsWith('The Beginning After the End') ? [tbate, side] : [],
			nextCursor: null
		});
	}
	if (path === '/works/w2')
		return json({
			ref: 'w2',
			title: 'Lord of the Mysteries',
			kind: { id: 'web_novel' },
			cover: null,
			editions: [
				{ ref: 'e5', lang: 'en', origin: 'licensed', format: 'ebook', units: { chapter: 1432 } }
			],
			snapshot: { status: 'completed' }
		});
	if (path.startsWith('/works/')) return json({ error: { code: 'not_found' } }, 404);
	if (path === '/me/library') return json({ items: [], nextCursor: null });
	return json({ error: { code: 'not_found' } }, 404);
});

beforeEach(() => {
	calls = [];
	down = false;
});

const searched = () =>
	calls.filter((c) => c.path === '/search').map((c) => new URLSearchParams(c.query).get('q'));
const queueIds = () => rv.ranobeQueue().map((i) => i.seriesId);

describe('searching', () => {
	it('searches by title with the volume taken off, novels only, never hidden or Hentoid', async () => {
		await rb.syncRanobe(NOW);
		const qs = searched();
		expect(qs).toContain('The Beginning After the End');
		expect(qs).toContain('Lord of the Mysteries');
		expect(calls.find((c) => c.path === '/search')?.query).toContain('kind=light_novel,web_novel');
		// Nothing of a hidden series or Hentoid's is ever asked, even its title.
		const asked = db
			.prepare(`SELECT series_id FROM ranobe_searches`)
			.all()
			.map((r) => (r as { series_id: number }).series_id);
		expect(asked).not.toContain(HIDDEN);
		expect(asked).not.toContain(FROM_HENTOID);
		// A search links nothing: the user chooses.
		expect(
			db.prepare(`SELECT COUNT(*) AS n FROM ranobe_links WHERE via != 'lookup'`).get()
		).toEqual({ n: 0 });
	});

	it('queues what it found, with nothing found at the back', () => {
		const q = rv.ranobeQueue();
		expect(q.map((i) => i.seriesId)).toEqual(expect.arrayContaining([V2, V3, V8, V8B, LOTM]));
		expect(q.at(-1)?.found).toBe(0);
		const item = q.find((i) => i.seriesId === V2)!;
		expect(item.candidates.map((c) => c.work)).toEqual(['w388', 'w1301']);
		expect(item.candidates[0]).toMatchObject({
			why: 'TITLE EQUAL WITHOUT “VOL. 2”',
			ids: 'RANOBE W388 · WEB NOVEL',
			coverUrl: 'https://ranobe.test/img/388.jpg',
			href: 'https://ranobe.ink/w388'
		});
		// A sensitive cover is never drawn.
		expect(item.candidates[1]).toMatchObject({
			coverUrl: null,
			coverNote: 'SENSITIVE · NOT SHOWN'
		});
		expect(item.rows.find((r) => r.label === 'ANILIST')?.value).toBe('NOT LINKED');
		expect(item.searchedLine).toBe(
			'NO ANILIST OR MAL ID TO SAY WHICH · SEARCHED RANOBE, NOVELS ONLY · 2 FOUND'
		);
	});
});

describe('LINK, and the same work for its siblings (1b)', () => {
	it('links, and offers the siblings with nothing preselected', async () => {
		const r = await rv.linkFromReview(V2, 'w388', 'review', NOW);
		expect(r.title).toBe('The Beginning After the End');
		expect(r.siblings.map((s) => s.seriesId)).toEqual(expect.arrayContaining([V3, V8, V8B]));
		expect(r.siblings.map((s) => s.seriesId)).not.toContain(HIDDEN);
		expect(r.siblings.map((s) => s.seriesId)).not.toContain(LOTM);
		// Two copies of volume 8: the second says so.
		expect(r.siblings.filter((s) => s.meta.endsWith('A SECOND COPY'))).toHaveLength(1);
		expect(
			db.prepare(`SELECT work, via, volume FROM ranobe_links WHERE series_id = ?`).get(V2)
		).toEqual({
			work: 'w388',
			via: 'review',
			volume: '2'
		});
		// Left out, a sibling leads with the work (1c).
		expect(rv.ranobeItem(V3)?.candidates[0]).toMatchObject({
			work: 'w388',
			why: 'CHOSEN FOR VOL. 2 JUST NOW',
			prior: true
		});
	});

	it('links the ones tapped, and UNDO puts them back', () => {
		const done = rv.linkMany([V8, V8B], 'w388', NOW);
		expect(done).toEqual([V8, V8B]);
		expect(queueIds()).not.toContain(V8);
		rv.undoMany(done);
		expect(queueIds()).toEqual(expect.arrayContaining([V8, V8B]));
		// UNDO is no decision: the pass may still link them.
		expect(db.prepare(`SELECT COUNT(*) AS n FROM ranobe_decisions`).get()).toEqual({ n: 0 });
	});

	it('UNDO of the LINK takes back what it gave the siblings', () => {
		expect(rv.undoLink(V2)).toBe(true);
		expect(rv.ranobeItem(V3)?.candidates.some((c) => c.prior)).toBe(false);
		expect(queueIds()).toContain(V2);
	});
});

describe('the other decisions', () => {
	it('NOT ON RANOBE settles it, and UNDO unsettles it', () => {
		rv.notOnRanobe(LOTM, NOW);
		expect(queueIds()).not.toContain(LOTM);
		expect(rv.ranobeAccount().notOn).toBeGreaterThanOrEqual(1);
		expect(rv.undoNone(LOTM)).toBe(true);
		expect(queueIds()).toContain(LOTM);
	});

	it('SKIP sends it to the back', () => {
		rv.skip(V3, NOW);
		expect(queueIds().at(-1)).toBe(V3);
	});

	it('PASTE reads the work by its id, and LINK takes it', async () => {
		const r = await rv.linkFromReview(LOTM, 'w2', 'pasted', NOW);
		expect(r.title).toBe('Lord of the Mysteries');
		// PASTE reads the work by its id first; then the link's own steps follow at
		// once (afterLinking: the edition, the units, the reads so far), not at the
		// next pass, which is what "Ane no Tomodachi" missed.
		expect(calls[0].path).toBe('/works/w2');
		await vi.waitFor(() => expect(calls.length).toBeGreaterThan(1));
		expect(db.prepare(`SELECT via FROM ranobe_links WHERE series_id = ?`).get(LOTM)).toEqual({
			via: 'pasted'
		});
		await expect(rv.linkFromReview(V3, 'w999', 'pasted', NOW)).rejects.toThrow();
	});

	it('SEARCH AGAIN waits for the pass when Ranobe is down, and UNDO restores it', async () => {
		down = true;
		expect(await rv.searchAgain(V3, 'TBATE', NOW)).toEqual({ outcome: 'queued' });
		expect(queueIds()).not.toContain(V3);
		rv.undoSearch(V3);
		expect(queueIds()).toContain(V3);
		expect(rv.ranobeItem(V3)?.candidates).toHaveLength(2);
	});

	it('UNLINK on the series screen is a decision the pass keeps', async () => {
		rb.unlinkSeries(LOTM, NOW);
		await rb.syncRanobe(NOW);
		expect(db.prepare(`SELECT 1 FROM ranobe_links WHERE series_id = ?`).get(LOTM)).toBeUndefined();
		expect(searched()).not.toContain('Lord of the Mysteries');
	});
});

describe('the series screen and SETTINGS', () => {
	it('draws the link row and the line for a linked novel', () => {
		rv.linkMany([V8], 'w388', NOW);
		db.prepare(`UPDATE ranobe_links SET edition = 'e9' WHERE work = 'w388'`).run();
		db.prepare(`UPDATE entries SET ranobe_unit = 'e9:volume:8' WHERE series_id = ?`).run(V8);
		db.prepare(`UPDATE entries SET read_at = ? WHERE series_id = ? AND position = 1`).run(NOW, V8);
		const s = rv.ranobeSeries(V8)!;
		expect(s.link).toMatchObject({ work: 'w388', href: 'https://ranobe.ink/w388' });
		expect(s.link?.meta).toContain('RANOBE W388 · ENGLISH EDITION');
		expect(s.facts.half).toEqual({ unit: 'e9:volume:8', read: 1, of: 3 });
		expect(rv.ranobeSeries(HIDDEN)?.facts.hidden).toBe(true);
		expect(rv.ranobeSeries(FROM_HENTOID)).toBeNull();
	});

	it('counts SETTINGS from the database', () => {
		const a = rv.ranobeAccount();
		expect(a).toMatchObject({ configured: true, passAt: NOW });
		expect(a.linked).toBe(
			(db.prepare(`SELECT COUNT(*) AS n FROM ranobe_links`).get() as { n: number }).n
		);
		// TO CHOOSE and NOT ON RANOBE never count one series twice.
		expect(a.toChoose).toBe(rv.ranobeQueue().filter((i) => i.found > 0).length);
	});
});

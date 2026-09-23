import { beforeAll, describe, expect, it } from 'vitest';

// Before anything imports db.ts: getDb() reads this once and memoises.
process.env.DATABASE_PATH = ':memory:';

const { getDb } = await import('$lib/server/db');
const { seedSample, SAMPLE_ROWS, HIDDEN_TITLES } = await import('$lib/server/fixtures');
const lib = await import('$lib/server/library');

beforeAll(() => {
	seedSample(getDb(), Date.UTC(2026, 8, 22));
});

const titles = (cards: { title: string }[]) => cards.map((c) => c.title);
const hiddenTitles = HIDDEN_TITLES;

describe('hidden means hidden', () => {
	it('lists, counts and searches nothing hidden while reveal is off', () => {
		expect(lib.countSeries(false)).toBe(SAMPLE_ROWS.length);
		const all = lib.listSeries({ reveal: false });
		for (const t of hiddenTitles) expect(titles(all)).not.toContain(t);
		expect(lib.search('Onsen', false).titles).toEqual([]);
		expect(lib.search('Onsen', false).titleTotal).toBe(0);
	});

	it('does not even name a hidden root as a shelf while reveal is off', () => {
		const names = lib.listShelves({ reveal: false, withNew: false }).map((s) => s.name);
		expect(names).not.toContain('Hentoid');
	});

	it('shows hidden series, marked, and the hidden root as a shelf, while reveal is on', () => {
		expect(lib.countSeries(true)).toBe(SAMPLE_ROWS.length + HIDDEN_TITLES.length);
		const hidden = lib.listSeries({ reveal: true }).filter((c) => c.hidden);
		expect(titles(hidden).sort()).toEqual([...hiddenTitles].sort());
		const root = lib
			.listShelves({ reveal: true, withNew: false })
			.find((s) => s.name === 'Hentoid');
		expect(root).toMatchObject({ kind: 'root', count: HIDDEN_TITLES.length });
	});

	it('refuses the sheet for a hidden series while reveal is off', () => {
		const id = lib.listSeries({ reveal: true }).find((c) => c.hidden)!.id;
		expect(lib.seriesDetail(id, false)).toBeNull();
		expect(lib.seriesDetail(id, true)).not.toBeNull();
	});
});

describe('shelves', () => {
	it('counts the smart shelves from the data', () => {
		const shelves = lib.listShelves({ reveal: false, withNew: false });
		const byKey = Object.fromEntries(shelves.map((s) => [s.key, s.count]));
		expect(byKey.all).toBe(SAMPLE_ROWS.length);
		expect(byKey.favourites).toBe(SAMPLE_ROWS.filter((r) => r.favourite).length);
		expect(byKey.rated4).toBe(SAMPLE_ROWS.filter((r) => r.rating !== null && r.rating >= 4).length);
	});

	it('narrows the listing to a collection', () => {
		const toFinish = lib
			.listShelves({ reveal: false, withNew: false })
			.find((s) => s.name === 'To finish')!;
		const listed = lib.listSeries({ reveal: false, shelf: toFinish.key });
		expect(listed).toHaveLength(toFinish.count);
		expect(titles(listed)).toContain('Tower of God');
	});
});

describe('continue reading', () => {
	it('lists series opened and not finished, most recent first', () => {
		const { items, total } = lib.continueReading(false);
		expect(items.map((i) => i.title).slice(0, 2)).toEqual([
			'Drawing: Saikyou Mangaka wa Oekaki Skill de Isekai Musou Suru',
			"Omniscient Reader's Viewpoint"
		]);
		expect(items[0].entryLabel).toBe('Ch. 41');
		expect(total).toBeGreaterThanOrEqual(items.length);
		for (const item of items) expect(item.readCount).toBeLessThan(item.entryCount);
	});
});

describe('search', () => {
	it('matches titles and tags, ranking title matches first and saying why', () => {
		const result = lib.search('isekai', false);
		expect(result.titles[0].why).toBe('TITLE');
		const byTag = result.titles.find((t) => t.title === 'Mushoku Tensei');
		expect(byTag?.why).toBe('TAG genre · isekai');
		expect(result.tags[0]).toMatchObject({ namespace: 'genre', value: 'isekai' });
		expect(result.shelves.map((s) => s.name)).toContain('Isekai pile');
	});
});

describe('writes touch only what was asked', () => {
	it('rates, clears to unrated (0), and leaves other series alone', () => {
		const [a, b] = lib.listSeries({ reveal: false, sort: 'title' });
		const before = lib.seriesDetail(b.id, false)!.rating;
		expect(lib.setRating([a.id], 3)).toBe(1);
		expect(lib.seriesDetail(a.id, false)!.rating).toBe(3);
		expect(lib.setRating([a.id], 0)).toBe(1);
		expect(lib.seriesDetail(a.id, false)!.rating).toBe(0);
		expect(lib.seriesDetail(b.id, false)!.rating).toBe(before);
	});

	it('never leaves a NULL rating behind after the migrations', () => {
		const { n } = getDb()
			.prepare('SELECT COUNT(*) AS n FROM series WHERE rating IS NULL')
			.get() as { n: number };
		expect(n).toBe(0);
	});

	it('applies a bulk action to exactly the selected series', () => {
		const ids = lib
			.listSeries({ reveal: false, sort: 'title' })
			.slice(0, 3)
			.map((c) => c.id);
		const favBefore = lib
			.listShelves({ reveal: false, withNew: false })
			.find((s) => s.key === 'favourites')!.count;
		const alreadyFav = ids.filter((id) => lib.seriesDetail(id, false)!.favourite).length;
		expect(lib.setFavourite(ids, true)).toBe(3);
		const favAfter = lib
			.listShelves({ reveal: false, withNew: false })
			.find((s) => s.key === 'favourites')!.count;
		expect(favAfter - favBefore).toBe(3 - alreadyFav);
	});

	it('hides a series so it vanishes from every reveal-off read', () => {
		const target = lib.listSeries({ reveal: false }).find((c) => c.title === 'Lookism')!;
		lib.setHidden([target.id], true);
		expect(titles(lib.listSeries({ reveal: false }))).not.toContain('Lookism');
		expect(lib.search('Lookism', false).titleTotal).toBe(0);
		lib.setHidden([target.id], false);
		expect(titles(lib.listSeries({ reveal: false }))).toContain('Lookism');
	});

	it('adds to and removes from a shelf, creating it once', () => {
		const id = lib.createCollection('Reread someday');
		expect(lib.createCollection('reread someday')).toBe(id);
		const target = lib.listSeries({ reveal: false })[0];
		expect(lib.setInCollection([target.id], id, true)).toBe(1);
		expect(lib.setInCollection([target.id], id, true)).toBe(0);
		expect(lib.seriesDetail(target.id, false)!.collections).toContain(id);
		expect(lib.setInCollection([target.id], id, false)).toBe(1);
		expect(() => lib.createCollection('   ')).toThrow();
	});
});

describe('scan state', () => {
	it('reports a running scan over a finished one, and forgets a dismissed one', () => {
		const db = getDb();
		expect(lib.currentScan()).toBeNull();
		const done = Number(
			db
				.prepare(
					`INSERT INTO scan_jobs (started_at, finished_at, series_found, failed_files) VALUES (1, 2, 847, 3)`
				)
				.run().lastInsertRowid
		);
		expect(lib.currentScan()).toMatchObject({ id: done, seriesFound: 847, failedFiles: 3 });
		const running = Number(
			db
				.prepare(`INSERT INTO scan_jobs (started_at, bytes_done, bytes_total) VALUES (3, 10, 100)`)
				.run().lastInsertRowid
		);
		expect(lib.currentScan()?.id).toBe(running);
		db.prepare(`UPDATE scan_jobs SET finished_at = 4 WHERE id = ?`).run(running);
		lib.dismissScan(running);
		expect(lib.currentScan()?.id).toBe(done);
		lib.dismissScan(done);
		expect(lib.currentScan()).toBeNull();
	});
});

describe('new chapters', () => {
	// "+3" means three chapters arrived since the series was last opened. It is
	// not the unread count: Drawing has 18 unread and 3 new.
	it('counts entries that arrived after the last open, not everything unread', () => {
		const byTitle = new Map(lib.listSeries({ reveal: false }).map((c) => [c.title, c]));
		const drawing = byTitle.get('Drawing: Saikyou Mangaka wa Oekaki Skill de Isekai Musou Suru')!;
		expect(drawing.entryCount - drawing.readCount).toBe(18);
		expect(drawing.newCount).toBe(3);
		expect(byTitle.get("Omniscient Reader's Viewpoint")!.newCount).toBe(0);
		// Never opened: unread, but nothing is "new" to someone who has not started.
		expect(byTitle.get('Isekai Yakkyoku')!.newCount).toBe(0);
	});
});

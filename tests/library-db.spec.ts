import { beforeAll, describe, expect, it } from 'vitest';

// Before anything imports db.ts: getDb() reads this once and memoises.
process.env.DATABASE_PATH = ':memory:';

const { getDb } = await import('$lib/server/db');
const { seedSample, SAMPLE_ROWS, HIDDEN_TITLES, BOOK_SERIES_TITLE } =
	await import('$lib/server/fixtures');
const lib = await import('$lib/server/library');
const filtersMod = await import('$lib/library/filters');
const { NO_FILTERS } = filtersMod;
type Filters = import('$lib/library/filters').Filters;
const only = (patch: Partial<Filters>): Filters => ({ ...NO_FILTERS, ...patch });

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

describe('one book out of a hidden root', () => {
	const idOf = (title: string) =>
		lib.listSeries({ reveal: true }).find((s) => s.title === title)!.id;

	it('UNHIDE makes it public while the rest of the root stays hidden, and HIDE takes it back', () => {
		const book = 'Kōhai no Himitsu Nikki';
		const id = idOf(book);
		lib.setHidden([id], false);
		const shown = titles(lib.listSeries({ reveal: false }));
		expect(shown).toContain(book);
		// Its neighbours in the Hentoid root are still hidden.
		for (const t of hiddenTitles.filter((t) => t !== book)) expect(shown).not.toContain(t);
		expect(lib.listSeries({ reveal: true }).find((s) => s.id === id)?.hidden).toBe(false);

		lib.setHidden([id], true);
		expect(titles(lib.listSeries({ reveal: false }))).not.toContain(book);
		lib.setHidden([id], false);
		lib.setHidden([id], true);
		expect(countPublic()).toBe(0);
	});
});

const countPublic = () =>
	(getDb().prepare(`SELECT COUNT(*) AS n FROM series WHERE public = 1`).get() as { n: number }).n;

describe('shelves', () => {
	it('counts the smart shelves from the data', () => {
		const shelves = lib.listShelves({ reveal: false, withNew: false });
		const byKey = Object.fromEntries(shelves.map((s) => [s.key, s.count]));
		expect(byKey.all).toBe(SAMPLE_ROWS.length);
		// FAVOURITES, RATED and DOWNLOADED are filters since c68, not shelves.
		expect(byKey.favourites).toBeUndefined();
		expect(byKey.rated4).toBeUndefined();
		expect(byKey.downloaded).toBeUndefined();
		expect(byKey.series + byKey.oneoff).toBe(byKey.all);
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

	it('names a book in a series of books by its place in the owner order', () => {
		const book = lib.continueReading(true, 50).items.find((i) => i.title === BOOK_SERIES_TITLE);
		expect(book?.entryLabel).toMatch(/^Book \d+$/);
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
		const favs = () => lib.countListed({ reveal: false, filters: only({ fav: 1 }) });
		const favBefore = favs();
		const alreadyFav = ids.filter((id) => lib.seriesDetail(id, false)!.favourite).length;
		expect(lib.setFavourite(ids, true)).toBe(3);
		const favAfter = favs();
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

describe('the FILTER panel (c68, doc/FILTERS.md)', () => {
	const list = (filters: Filters, reveal = false, shelf = 'all') =>
		lib.listSeries({ reveal, shelf, filters });
	const everything = (reveal = false) => lib.listSeries({ reveal });

	it('DOWNLOADED: a chapter on disk, and NO its complement, counted the same way', () => {
		const db = getDb();
		const target = everything().find((c) => c.title === 'Chainsaw Man')!;
		const before = list(only({ dl: 1 }));
		expect(titles(before)).toContain('Chainsaw Man');
		expect(target.downloaded).toBe(true);
		// Only known from a backup: every chapter read online, none on disk.
		db.prepare(`UPDATE entries SET available = 0 WHERE series_id = ?`).run(target.id);
		const after = list(only({ dl: 1 }));
		expect(titles(after)).not.toContain('Chainsaw Man');
		expect(after.length).toBe(before.length - 1);
		expect(titles(list(only({ dl: 0 })))).toContain('Chainsaw Man');
		expect(lib.countListed({ reveal: false, filters: only({ dl: 1 }) })).toBe(after.length);
		expect(after.length + list(only({ dl: 0 })).length).toBe(everything().length);
		db.prepare(`UPDATE entries SET available = 1 WHERE series_id = ?`).run(target.id);
	});

	it('RATING: at least a threshold, or unrated, and the two split the rated from the rest', () => {
		const all = everything();
		expect(list(only({ min: 8 })).every((c) => c.rating >= 8)).toBe(true);
		expect(list(only({ min: 8 })).length).toBe(all.filter((c) => c.rating >= 8).length);
		expect(list(only({ unrated: true })).length).toBe(all.filter((c) => c.rating === 0).length);
		expect(list(only({ min: 1 })).length + list(only({ unrated: true })).length).toBe(all.length);
	});

	it('FAV and NOT FAV split the shelf', () => {
		const shelf = 'k:manga';
		const whole = lib.countListed({ reveal: false, shelf });
		const fav = lib.countListed({ reveal: false, shelf, filters: only({ fav: 1 }) });
		const not = lib.countListed({ reveal: false, shelf, filters: only({ fav: 0 }) });
		expect(fav + not).toBe(whole);
		expect(list(only({ fav: 0 }), false, shelf).some((c) => c.favourite)).toBe(false);
	});

	it('combine with each other and with the shelf', () => {
		const combined = list(only({ min: 6, fav: 1 }), false, 'k:manga');
		const byHand = everything().filter((c) => c.kind === 'manga' && c.rating >= 6 && c.favourite);
		expect(titles(combined).sort()).toEqual(titles(byHand).sort());
	});

	it('DATE ADDED: on or after the start of that day', () => {
		const all = everything();
		const days = [...new Set(all.map((c) => c.addedAt))].sort((a, b) => a - b);
		const mid = new Date(days[Math.floor(days.length / 2)]);
		const day = `${mid.getFullYear()}-${String(mid.getMonth() + 1).padStart(2, '0')}-${String(mid.getDate()).padStart(2, '0')}`;
		const start = new Date(mid.getFullYear(), mid.getMonth(), mid.getDate()).getTime();
		expect(list(only({ added: day })).length).toBe(all.filter((c) => c.addedAt >= start).length);
	});

	it('LANGUAGE: only what the shelf holds, never "translated", and nothing while reveal is off', () => {
		// The sample's languages are all on hidden books, as the real library's are.
		expect(lib.languagesOn({ reveal: false, shelf: 'all' })).toEqual([]);
		const langs = lib.languagesOn({ reveal: true, shelf: 'all' });
		expect(langs).toEqual(expect.arrayContaining(['ja', 'en']));
		expect(langs).not.toContain('tr');
		expect(lib.languagesOn({ reveal: true, shelf: 'k:manhwa' })).toEqual([]);
		const ja = list(only({ lang: 'ja' }), true);
		expect(ja.length).toBeGreaterThan(0);
		expect(ja.every((c) => c.hidden)).toBe(true);
		// Hidden means hidden: with reveal off, a language finds nothing.
		expect(list(only({ lang: 'ja' }), false)).toEqual([]);
	});

	it('READING: UNREAD and READ, in SQL as the device decides them, hidden included', () => {
		const { progressOf } = filtersMod;
		const state = { unread: 'unread', read: 'finished' } as const;
		for (const reveal of [false, true]) {
			const all = everything(reveal);
			for (const progress of ['unread', 'read'] as const) {
				const got = list(only({ progress }), reveal);
				expect(titles(got).sort()).toEqual(
					titles(all.filter((c) => progressOf(c) === state[progress])).sort()
				);
				expect(lib.countListed({ reveal, filters: only({ progress }) })).toBe(got.length);
			}
		}
		// Hidden ones are what it's for: with reveal on, it reaches them.
		const both = only({ hidden: true, progress: 'unread' });
		expect(list(both, true).every((c) => c.hidden && !c.opened && c.readCount === 0)).toBe(true);
		expect(list(only({ progress: 'read' }), true).length).toBeGreaterThan(0);
	});

	it('HIDDEN: only hidden, and only ever with reveal on', () => {
		const hidden = list(only({ hidden: true }), true);
		expect(titles(hidden).sort()).toEqual([...hiddenTitles].sort());
		// Asked for with reveal off, it narrows nothing to hidden ones.
		expect(list(only({ hidden: true }), false).some((c) => c.hidden)).toBe(false);
	});
});

describe('SERIES and ONE-OFF (c68)', () => {
	it('split the library: a single doujin book is a one-off, everything else a series', () => {
		const oneoff = lib.listSeries({ reveal: true, shelf: 'oneoff' });
		const series = lib.listSeries({ reveal: true, shelf: 'series' });
		expect(oneoff.length + series.length).toBe(lib.countListed({ reveal: true }));
		expect(oneoff.every((c) => c.kind === 'doujin' && c.entryCount <= 1)).toBe(true);
		expect(titles(series)).toContain(BOOK_SERIES_TITLE);
		// A Mihon series is a series whatever it holds so far.
		expect(series.filter((c) => c.kind !== 'doujin').length).toBe(
			lib.listSeries({ reveal: true }).filter((c) => c.kind !== 'doujin').length
		);
	});
});

describe('pages of a shelf', () => {
	it('page through the same list the whole shelf is, without gaps or repeats', () => {
		for (const sort of ['recent', 'progress', 'title', 'rating', 'added', 'random'] as const)
			for (const dir of ['asc', 'desc'] as const) {
				const whole = lib.listSeries({ reveal: true, sort, dir }).map((c) => c.id);
				const paged: number[] = [];
				for (let offset = 0; offset < whole.length; offset += 7)
					paged.push(
						...lib.listSeries({ reveal: true, sort, dir, limit: 7, offset }).map((c) => c.id)
					);
				expect(paged).toEqual(whole);
			}
	});

	it('PROGRESS: begun and unfinished, then never opened, then the read; ↑ sends the begun last', () => {
		const { progressOf } = filtersMod;
		const tiers = (dir: 'asc' | 'desc') =>
			lib.listSeries({ reveal: true, sort: 'progress', dir }).map((c) => progressOf(c));
		const runs = (xs: string[]) => xs.filter((x, i) => i === 0 || xs[i - 1] !== x);
		expect(runs(tiers('desc'))).toEqual(['reading', 'unread', 'finished']);
		expect(runs(tiers('asc'))).toEqual(['unread', 'finished', 'reading']);
		// Inside a tier, the most recent first either way: the same begun series, in the same order.
		const begun = (dir: 'asc' | 'desc') =>
			lib
				.listSeries({ reveal: true, sort: 'progress', dir })
				.filter((c) => progressOf(c) === 'reading')
				.map((c) => c.id);
		expect(begun('asc')).toEqual(begun('desc'));
	});

	it('turn each sort round with ?dir=, never-read still last under RECENTLY READ', () => {
		for (const sort of ['title', 'added'] as const) {
			const down = lib.listSeries({ reveal: true, sort, dir: 'desc' }).map((c) => c.id);
			const up = lib.listSeries({ reveal: true, sort, dir: 'asc' }).map((c) => c.id);
			expect(up).toEqual([...down].reverse());
		}
		expect(lib.listSeries({ reveal: true, sort: 'title' })).toEqual(
			lib.listSeries({ reveal: true, sort: 'title', dir: 'asc' })
		);
		const up = lib.listSeries({ reveal: true, sort: 'recent', dir: 'asc' });
		const firstNever = up.findIndex((c) => !c.opened);
		expect(firstNever).toBeGreaterThan(0);
		expect(up.slice(firstNever).every((c) => !c.opened)).toBe(true);
		const ratings = lib
			.listSeries({ reveal: true, sort: 'rating', dir: 'asc' })
			.map((c) => c.rating);
		expect(ratings).toEqual([...ratings].sort((a, b) => a - b));
	});

	it('RANDOM is one shuffle per seed: the same every time, another with another seed', () => {
		const ids = (seed: number) =>
			lib.listSeries({ reveal: false, sort: 'random', seed }).map((c) => c.id);
		const byTitle = lib.listSeries({ reveal: false, sort: 'title' }).map((c) => c.id);
		expect(ids(42)).toEqual(ids(42));
		expect(ids(42)).not.toEqual(ids(43));
		expect([...ids(42)].sort()).toEqual([...byTitle].sort());
		expect(ids(42)).not.toEqual(byTitle);
		// Paged with a seed, as the grid asks for it: the same cards, in order.
		const paged = [0, 5, 10, 15, 20, 25].flatMap((offset) =>
			lib.listSeries({ reveal: false, sort: 'random', seed: 42, limit: 5, offset }).map((c) => c.id)
		);
		expect(paged).toEqual(ids(42));
	});

	it('count and list ids for exactly what the shelf shows, hidden left out', () => {
		for (const shelf of ['all', 'series', 'oneoff', 'k:novel']) {
			const cards = lib.listSeries({ reveal: false, shelf });
			expect(lib.countListed({ reveal: false, shelf })).toBe(cards.length);
			expect(lib.listedIds({ reveal: false, shelf }).sort()).toEqual(cards.map((c) => c.id).sort());
		}
		expect(lib.countListed({ reveal: true })).toBeGreaterThan(lib.countListed({ reveal: false }));
	});
});

describe('the kind shelves', () => {
	it('list one kind each, counted the same way, and only kinds the library has', () => {
		const shelves = lib.listShelves({ reveal: false, withNew: false });
		const all = lib.listSeries({ reveal: false });
		for (const kind of ['manga', 'manhwa', 'novel'] as const) {
			const want = all.filter((c) => c.kind === kind);
			const shelf = shelves.find((s) => s.key === `k:${kind}`);
			if (want.length === 0) {
				expect(shelf).toBeUndefined();
				continue;
			}
			const listed = lib.listSeries({ reveal: false, shelf: `k:${kind}` });
			expect(listed.every((c) => c.kind === kind)).toBe(true);
			expect(listed.length).toBe(want.length);
			expect(shelf).toMatchObject({ kind: 'smart', count: want.length });
		}
		// The sample library has manga, manhwa and novels, so none of the above was vacuous.
		expect(shelves.filter((s) => s.key.startsWith('k:')).length).toBe(3);
		expect(shelves.some((s) => s.key === 'k:doujin')).toBe(false);
		// A key naming no kind shelf falls back to all, as any unknown key does.
		expect(lib.listSeries({ reveal: false, shelf: 'k:doujin' }).length).toBe(all.length);
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

describe('the NEW shelf', () => {
	// What arrived (rung 34) in the last NEW_DAYS and hasn't been opened since:
	// not the import the band is about, so neither a later import nor TIDY NEW
	// empties it.
	const db = () => getDb();
	const idOf = (title: string) =>
		lib.listSeries({ reveal: false }).find((s) => s.title === title)!.id;
	const onNew = () => titles(lib.listSeries({ reveal: false, shelf: 'new' }));
	const arrive = (id: number, at: number) =>
		db().prepare(`UPDATE series SET arrived_at = ? WHERE id = ?`).run(at, id);
	const opened = (id: number) =>
		(
			db().prepare(`SELECT MAX(last_opened_at) AS at FROM entries WHERE series_id = ?`).get(id) as {
				at: number | null;
			}
		).at;

	it('holds an arrival, whatever the band does', () => {
		const id = idOf('Dungeon Meshi');
		arrive(id, Math.max(Date.now() - 60_000, (opened(id) ?? 0) + 1));
		expect(onNew()).toContain('Dungeon Meshi');
		const job = Number(
			db()
				.prepare(`INSERT INTO scan_jobs (started_at, finished_at, series_found) VALUES (20, 21, 1)`)
				.run().lastInsertRowid
		);
		lib.dismissScan(job);
		expect(onNew()).toContain('Dungeon Meshi');
		// Listed with no import to show, as long as something is new.
		const shelf = lib.listShelves({ reveal: false, withNew: false }).find((s) => s.key === 'new');
		expect(shelf?.count).toBeGreaterThanOrEqual(1);
	});

	it('lets it go once it is opened', () => {
		const id = idOf('Dungeon Meshi');
		const at = Date.now() - 60_000;
		arrive(id, at);
		db()
			.prepare(
				`UPDATE entries SET last_opened_at = ? WHERE id = (SELECT id FROM entries WHERE series_id = ? LIMIT 1)`
			)
			.run(at + 1, id);
		expect(onNew()).not.toContain('Dungeon Meshi');
	});

	it(`lets it go after ${lib.NEW_DAYS} days unopened`, () => {
		const id = idOf('Isekai Yakkyoku');
		expect(opened(id)).toBeNull();
		arrive(id, Date.now() - (lib.NEW_DAYS - 1) * 86_400_000);
		expect(onNew()).toContain('Isekai Yakkyoku');
		arrive(id, Date.now() - (lib.NEW_DAYS + 1) * 86_400_000);
		expect(onNew()).not.toContain('Isekai Yakkyoku');
		arrive(id, 0);
		expect(lib.listShelves({ reveal: false, withNew: false }).some((s) => s.key === 'new')).toBe(
			false
		);
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

	it('counts a chapter downloaded since, unless it was already read', () => {
		const title = 'Drawing: Saikyou Mangaka wa Oekaki Skill de Isekai Musou Suru';
		const drawing = () => lib.listSeries({ reveal: false }).find((c) => c.title === title)!;
		const db = getDb();
		// An old chapter, listed long before the last open, downloaded just now.
		const old = db
			.prepare(
				`SELECT id, read_at FROM entries WHERE series_id = ? AND added_at <
					(SELECT MAX(last_opened_at) FROM entries WHERE series_id = ?) ORDER BY position LIMIT 1`
			)
			.get(drawing().id, drawing().id) as { id: number; read_at: number | null };
		const now = Date.now();
		db.prepare(`UPDATE entries SET arrived_at = ?, read_at = 1 WHERE id = ?`).run(now, old.id);
		expect(drawing().newCount).toBe(3);
		db.prepare(`UPDATE entries SET read_at = NULL WHERE id = ?`).run(old.id);
		expect(drawing().newCount).toBe(4);
		db.prepare(`UPDATE entries SET arrived_at = NULL, read_at = ? WHERE id = ?`).run(
			old.read_at,
			old.id
		);
	});
});

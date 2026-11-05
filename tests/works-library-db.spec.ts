import { beforeEach, describe, expect, it } from 'vitest';

// Before anything imports db.ts: getDb() reads this once and memoises.
process.env.DATABASE_PATH = ':memory:';
// No catalogue: the Works here are grouped by hand, never offered.
process.env.TSUNDOKU_ANILIST = 'off';

const { getDb } = await import('$lib/server/db');
const { seedSample } = await import('$lib/server/fixtures');
const lib = await import('$lib/server/library');
const works = await import('$lib/server/works');
const { NO_FILTERS } = await import('$lib/library/filters');
/** One kind, as the KIND band asks it (c436): `?kind=` on whichever shelf, here ALL. */
const kind = (k: 'manga' | 'manhwa') => ({ ...NO_FILTERS, kind: k });

/** A fresh library per test: a Work changes every count and every list. */
beforeEach(() => {
	const db = getDb();
	db.exec(`DELETE FROM works; DELETE FROM work_dismissals; DELETE FROM roots;
		DELETE FROM collections; DELETE FROM tags; DELETE FROM scan_jobs;
		DELETE FROM suggestion_dismissals; DELETE FROM person_favourites; DELETE FROM history_removed;
		DELETE FROM tracker_accounts;`);
	seedSample(db, Date.UTC(2026, 8, 22));
});

const idOf = (title: string) =>
	lib.listSeries({ reveal: true }).find((s) => s.title === title)?.id as number;
const NOW = Date.UTC(2026, 10, 2);
const make = (titles: string[], name: string) =>
	works.createWork({ seriesIds: titles.map(idOf), name, now: NOW });

const tiles = (opts: Parameters<typeof lib.listTiles>[0]) => lib.listTiles(opts);
const workTiles = (opts: Parameters<typeof lib.listTiles>[0]) =>
	tiles(opts)
		.map((t) => t.tile)
		.filter((t) => t !== undefined);

describe('browsing shows the run as one tile', () => {
	it('lists a Work once, with its parts in order and its face the part CONTINUE opens', () => {
		const drawing = idOf('Drawing: Saikyou Mangaka wa Oekaki Skill de Isekai Musou Suru');
		const kusuriya = idOf('Kusuriya no Hitorigoto');
		const facts = make(
			['Drawing: Saikyou Mangaka wa Oekaki Skill de Isekai Musou Suru', 'Kusuriya no Hitorigoto'],
			'The Breaker'
		);
		const list = tiles({ reveal: true, shelf: 'all' });
		const own = workTiles({ reveal: true, shelf: 'all' });
		expect(own).toHaveLength(1);
		expect(own[0]).toMatchObject({ id: facts.work.id, name: 'The Breaker' });
		expect(own[0].parts.map((p) => p.seriesId)).toEqual([drawing, kusuriya]);
		// Drawing was opened five minutes ago and Kusuriya ten hours: CONTINUE
		// opens Drawing, so that is the cover the tile wears.
		expect(own[0].face.id).toBe(drawing);
		// The parts are not tiles of their own (the Work's face carries the face
		// series' id), and the grid's length is what the shelf counts.
		expect(list.filter((t) => !t.tile && [drawing, kusuriya].includes(t.id))).toHaveLength(0);
		expect(list).toHaveLength(lib.countTiles(true));
		// The marks a run carries: new chapters summed (Drawing 3, Kusuriya 2),
		// FAV if any part is one.
		expect(own[0].newCount).toBe(5);
		expect(own[0].face.favourite).toBe(true);
	});

	it('counts tiles everywhere: the shelf, the sidebar and the KIND band', () => {
		const before = lib.countListed({ reveal: true, shelf: 'all' });
		make(
			['Drawing: Saikyou Mangaka wa Oekaki Skill de Isekai Musou Suru', 'Hikaru ga Shinda Natsu'],
			'One Run'
		);
		// A Work of two manga is one tile on ALL and one on MANGA, not two.
		expect(lib.countListed({ reveal: true, shelf: 'all' })).toBe(before - 1);
		expect(lib.countTiles(true)).toBe(before - 1);
		const shelves = lib.listShelves({ reveal: true, withNew: false });
		expect(shelves.find((s) => s.key === 'all')?.count).toBe(before - 1);
		// The KIND band's MANGA cell counts the Work once too (c436).
		expect(lib.kindCounts({ reveal: true, shelf: 'all' }).kinds.manga).toBe(
			lib.listSeries({ reveal: true, filters: kind('manga') }).length - 1
		);
	});

	it('puts a Work of two kinds on both kind shelves, wearing the part that is there', () => {
		const manga = idOf('Drawing: Saikyou Mangaka wa Oekaki Skill de Isekai Musou Suru');
		const manhwa = idOf("Omniscient Reader's Viewpoint");
		make(
			[
				'Drawing: Saikyou Mangaka wa Oekaki Skill de Isekai Musou Suru',
				"Omniscient Reader's Viewpoint"
			],
			'Two Kinds'
		);
		// The same Work on both shelves -- and each count is what it was, since
		// one series swapped itself for the tile.
		const onManga = workTiles({ reveal: true, filters: kind('manga') })[0];
		const onManhwa = workTiles({ reveal: true, filters: kind('manhwa') })[0];
		expect([onManga.face.id, onManhwa.face.id]).toEqual([manga, manhwa]);
		expect(onManga.name).toBe('Two Kinds');
		// One Work on each, not one per part.
		expect(workTiles({ reveal: true, filters: kind('manga') })).toHaveLength(1);
		expect(workTiles({ reveal: true, filters: kind('manhwa') })).toHaveLength(1);
		// And the band counts it once under each kind, and once in ALL (c436).
		const band = lib.kindCounts({ reveal: true, shelf: 'all' });
		expect([band.kinds.manga, band.kinds.manhwa]).toEqual([
			tiles({ reveal: true, filters: kind('manga'), limit: 1000 }).length,
			tiles({ reveal: true, filters: kind('manhwa'), limit: 1000 }).length
		]);
		expect(band.all).toBe(lib.countListed({ reveal: true, shelf: 'all' }));
	});

	it('pages the same tiles the whole shelf is: a Work once, in order, no part as its own card', () => {
		make(['Isekai Ojisan', 'Isekai Yakkyoku'], 'Paged Run');
		// The offset is in tiles: a page of two carries on where the last
		// stopped, whether the boundary falls inside a Work or between two.
		for (const sort of ['recent', 'title', 'added', 'random'] as const) {
			const whole = tiles({ reveal: true, shelf: 'all', sort }).map((t) => t.id);
			const paged: number[] = [];
			for (let offset = 0; offset < whole.length; offset += 2)
				paged.push(
					...tiles({ reveal: true, shelf: 'all', sort, limit: 2, offset }).map((t) => t.id)
				);
			expect(paged).toEqual(whole);
			expect(new Set(paged).size).toBe(whole.length);
		}
	});

	it('sorts a Work by its most recent part', () => {
		// Two runs, each a pair: one is in the newest thing read, the other in
		// the oldest. Their names order the other way, so title is a real check.
		const recent = make(['Yofukashi no Uta', 'Isekai Ojisan'], 'Aaa Last Read');
		const old = make(['Ame no Hi no Toshokan', 'Sekai no Owari no Kissaten'], 'Zzz Last Read');
		const order = workTiles({ reveal: true, shelf: 'all', sort: 'recent' }).map((t) => t.id);
		expect(order.indexOf(recent.work.id)).toBeLessThan(order.indexOf(old.work.id));
		const byTitle = workTiles({ reveal: true, shelf: 'all', sort: 'title' }).map((t) => t.name);
		expect(byTitle.indexOf('Aaa Last Read')).toBeLessThan(byTitle.indexOf('Zzz Last Read'));
	});

	it('leaves a hidden Work out while reveal is off, and draws it once while it is on', () => {
		const a = idOf('Kōhai no Himitsu Nikki');
		const b = idOf('Onsen Ryokan no Yoru');
		const before = lib.countTiles(false);
		const facts = works.createWork({ seriesIds: [a, b], name: 'Hidden Run', now: NOW });
		const off = tiles({ reveal: false, shelf: 'all' });
		expect(off.some((t) => t.tile?.id === facts.work.id)).toBe(false);
		// Both parts were already hidden, so the visible count is unchanged: the
		// Work neither appears nor takes the parts' places.
		expect(lib.countTiles(false)).toBe(before);
		const on = workTiles({ reveal: true, shelf: 'all' });
		expect(on.filter((t) => t.id === facts.work.id)).toHaveLength(1);
		expect(on.find((t) => t.id === facts.work.id)?.face.hidden).toBe(true);
		expect(works.workPage(facts.work.id, { reveal: false })).toBeNull();
	});

	it('hides a Work whole from a kind shelf, so its screen is the missing 404', () => {
		// SELECT ALL over MANGA hands every series id the tiles hold, a Work's
		// off-shelf manhwa part included (`tileIds`); bulk HIDE acts on series,
		// so it hides the run part by part. This is the node half of the flow
		// case that used to prove it by hiding the whole shelf (round 2's
		// finding): a write there landed on every manga in the shared library.
		const manga = idOf('Drawing: Saikyou Mangaka wa Oekaki Skill de Isekai Musou Suru');
		const manhwa = idOf("Omniscient Reader's Viewpoint");
		const facts = make(
			[
				'Drawing: Saikyou Mangaka wa Oekaki Skill de Isekai Musou Suru',
				"Omniscient Reader's Viewpoint"
			],
			'Two Kinds'
		);
		const picked = lib.tileIds({ reveal: false, filters: kind('manga') });
		expect(picked).toContain(manga);
		expect(picked).toContain(manhwa);
		const hidden = works.hideWork(facts.work.id, true);
		expect(hidden.ids.sort()).toEqual([manga, manhwa].sort());
		// With reveal off the Work is gone from the shelf and its screen is the
		// 404 a missing id gets; with reveal on it is one tile again.
		expect(lib.tileIds({ reveal: false, filters: kind('manga') })).not.toContain(manga);
		expect(works.workPage(facts.work.id, { reveal: false })).toBeNull();
		expect(lib.tileIds({ reveal: true, filters: kind('manga') })).toContain(manga);
	});

	it('marks a Work hidden when any part is, whatever part the tile wears', () => {
		// Grouping refuses to mix hidden and visible, but a part can be hidden on
		// its own afterwards (the series screen's HIDE, until W4 settles it). The
		// Work is then still one tile, and HIDDEN is the Work's mark: the face is
		// the part the tile opens, which here is the visible one, so a mark read
		// off the face would say this run is not hidden.
		const a = idOf('Drawing: Saikyou Mangaka wa Oekaki Skill de Isekai Musou Suru');
		const b = idOf('Kusuriya no Hitorigoto');
		const facts = make(
			['Drawing: Saikyou Mangaka wa Oekaki Skill de Isekai Musou Suru', 'Kusuriya no Hitorigoto'],
			'Diverged Run'
		);
		getDb().prepare(`UPDATE series SET hidden = 1 WHERE id = ?`).run(b);
		const own = workTiles({ reveal: true, shelf: 'all' }).find((t) => t.id === facts.work.id)!;
		expect(own.face.id).toBe(a);
		expect(own.face.hidden).toBe(false);
		expect(own.parts.some((p) => p.hidden)).toBe(true);
		expect(own.hidden).toBe(true);
	});
});

describe('finding shows the series', () => {
	it('lists each matching part as its own tile, with its place in the Work', () => {
		const a = idOf('Drawing: Saikyou Mangaka wa Oekaki Skill de Isekai Musou Suru');
		const b = idOf('Hikaru ga Shinda Natsu');
		const facts = make(
			['Drawing: Saikyou Mangaka wa Oekaki Skill de Isekai Musou Suru', 'Hikaru ga Shinda Natsu'],
			'The Breaker'
		);
		// A tag page is finding: listSeries is what it reads.
		const founder = lib.listSeries({ reveal: true }).filter((c) => c.work);
		expect(founder.map((c) => c.id).sort()).toEqual([a, b].sort());
		expect(founder.find((c) => c.id === b)?.work).toEqual({
			id: facts.work.id,
			name: 'The Breaker',
			part: 2,
			of: 2
		});
	});

	it('finds a Work by its own name, before its parts', () => {
		make(
			['Drawing: Saikyou Mangaka wa Oekaki Skill de Isekai Musou Suru', 'Hikaru ga Shinda Natsu'],
			'The Breaker'
		);
		const byWork = lib.search('Breaker', true);
		expect(byWork.works).toHaveLength(1);
		expect(byWork.works[0].name).toBe('The Breaker');
		// The parts are not found by the Work's name: they are called otherwise.
		expect(byWork.titles).toHaveLength(0);
		// A part found by its own name still says which run it is in.
		const byPart = lib.search('Hikaru', true);
		expect(byPart.works).toHaveLength(0);
		expect(byPart.titles[0].work?.name).toBe('The Breaker');
		expect(byPart.titles[0].work?.part).toBe(2);
		// The count is tiles: one Work plus the series it found.
		expect(byWork.titleTotal).toBe(1);
	});

	it('finds a Work whose run is read through, wearing its last part', () => {
		// Both parts are finished, so CONTINUE's part is null: the face must be
		// the last part (`facePart`), or the Work is missing from the hits
		// entirely even though its own name is what was typed.
		const facts = make(['Yofukashi no Uta', 'Natsu no Owari ni Kimi to'], 'Read Through Run');
		const found = lib.search('Read Through Run', true);
		expect(found.works).toHaveLength(1);
		expect(found.works[0].name).toBe('Read Through Run');
		expect(found.works[0].id).toBe(facts.work.id);
		expect(found.works[0].face.id).toBe(idOf('Natsu no Owari ni Kimi to'));
		expect(found.titleTotal).toBe(1);
	});
});

describe('CONTINUE is one row per Work', () => {
	const cont = () => lib.continueReading(true, 10);

	it('carries the part, its label and the Work’s name', () => {
		const facts = make(
			['Drawing: Saikyou Mangaka wa Oekaki Skill de Isekai Musou Suru', 'Hikaru ga Shinda Natsu'],
			'The Breaker'
		);
		const rows = cont().items.filter((i) => i.work);
		expect(rows).toHaveLength(1);
		expect(rows[0]).toMatchObject({
			title: 'The Breaker',
			work: { id: facts.work.id, name: 'The Breaker', part: 1, of: 2, upNext: false }
		});
		expect(rows[0].entryLabel).toBe('Ch. 41');
		expect(rows[0].resumeId).not.toBeNull();
	});

	it('says UP NEXT, pointing at the next part’s first chapter, when the run moves on', () => {
		// Yofukashi is read through and Isekai Yakkyoku never started: the Work
		// is exactly the handoff's Akasaka row.
		make(['Yofukashi no Uta', 'Isekai Yakkyoku'], 'Two Runs');
		const rows = cont().items.filter((i) => i.work?.name === 'Two Runs');
		expect(rows).toHaveLength(1);
		expect(rows[0].work).toMatchObject({ part: 2, of: 2, upNext: true });
		expect(rows[0].entryLabel).toBe('Ch. 1');
		expect(rows[0].resumeId).not.toBeNull();
	});

	it('sorts and slices before hydrating, and counts the rows it did not show', () => {
		const page = lib.continueReading(true, 2);
		expect(page.items).toHaveLength(2);
		expect(page.total).toBe(cont().total);
		expect(page.total).toBeGreaterThan(2);
		expect(page.items[0].lastReadAt).toBeGreaterThanOrEqual(page.items[1].lastReadAt);
	});

	it('counts rows, not parts, in the section total', () => {
		const a = idOf('Drawing: Saikyou Mangaka wa Oekaki Skill de Isekai Musou Suru');
		const b = idOf('Kusuriya no Hitorigoto');
		const before = lib.continueReading(true, 1000).total;
		make(
			['Drawing: Saikyou Mangaka wa Oekaki Skill de Isekai Musou Suru', 'Kusuriya no Hitorigoto'],
			'The Breaker'
		);
		const { items, total } = lib.continueReading(true, 1000);
		// Two open series became one row.
		expect(total).toBe(before - 1);
		// Neither part is a row of its own: the one row that names either is the Work's.
		const own = items.filter((i) => i.id === a || i.id === b);
		expect(own).toHaveLength(1);
		expect(own[0].work).not.toBeNull();
		// `limit` is rows, too.
		expect(lib.continueReading(true, 2).items).toHaveLength(2);
	});
});

describe('CONTINUE’s Work arm pays for the rows it shows (c332)', () => {
	// Every row's place is decided before any Work's parts are read, so these
	// pin that the keys alone give the same rows, order and count.
	const runs = () => {
		// Three Works with a last open each, oldest first; and one read through.
		const a = make(['Isekai Ojisan', 'Isekai Yakkyoku'], 'Up Next Run');
		const b = make(
			['Drawing: Saikyou Mangaka wa Oekaki Skill de Isekai Musou Suru', 'Kusuriya no Hitorigoto'],
			'Drawing Run'
		);
		const done = make(['Yofukashi no Uta', 'Dungeon Meshi'], 'Read Run');
		return { a, b, done };
	};

	it('never counts a Work whose every part is read, and counts each other Work once', () => {
		const before = lib.continueReading(true, 1000);
		const { done } = runs();
		const after = lib.continueReading(true, 1000);
		expect(after.items.some((i) => i.work?.id === done.work.id)).toBe(false);
		// The open series that became parts stop being rows; each Work with an
		// unfinished part is one row, and the read-through Work is none.
		const names = after.items.filter((i) => i.work).map((i) => i.work!.name);
		expect(names.sort()).toEqual(['Drawing Run', 'Up Next Run']);
		const parts = [
			'Isekai Ojisan',
			'Isekai Yakkyoku',
			'Drawing: Saikyou Mangaka wa Oekaki Skill de Isekai Musou Suru',
			'Kusuriya no Hitorigoto',
			'Yofukashi no Uta',
			'Dungeon Meshi'
		].map(idOf);
		const wereRows = before.items.filter((i) => parts.includes(i.id)).length;
		expect(after.total).toBe(after.items.length);
		expect(after.total).toBe(before.total - wereRows + 2);
	});

	it('slices to the limit in recency order, Works and series alike, and still counts every row', () => {
		runs();
		const whole = lib.continueReading(true, 1000);
		for (const limit of [1, 2, 3, 5]) {
			const page = lib.continueReading(true, limit);
			expect(page.total).toBe(whole.total);
			expect(page.items.map((i) => [i.id, i.work?.id ?? null])).toEqual(
				whole.items.slice(0, limit).map((i) => [i.id, i.work?.id ?? null])
			);
		}
	});

	it('keeps a Work with a never-opened part whose chapters are all marked read out, as continuePart does', () => {
		const { a } = runs();
		const yakkyoku = idOf('Isekai Yakkyoku');
		// Marked read without opening: finished, so the run is read through.
		getDb().prepare(`UPDATE entries SET read_at = 1 WHERE series_id = ?`).run(yakkyoku);
		const rows = lib.continueReading(true, 1000);
		expect(rows.items.some((i) => i.work?.id === a.work.id)).toBe(false);
		expect(rows.total).toBe(rows.items.length);
	});

	it('leaves a Work whose only open part is hidden out with reveal off', () => {
		const { b } = runs();
		lib.setHidden([idOf('Drawing: Saikyou Mangaka wa Oekaki Skill de Isekai Musou Suru')], true);
		lib.setHidden([idOf('Kusuriya no Hitorigoto')], true);
		const off = lib.continueReading(false, 1000);
		expect(off.items.some((i) => i.work?.id === b.work.id)).toBe(false);
		expect(off.total).toBe(off.items.length);
		expect(lib.continueReading(true, 1000).items.some((i) => i.work?.id === b.work.id)).toBe(true);
	});
});

describe('THE RUN counts what the library counts', () => {
	it('ignores a shadowed duplicate and front matter, and never exceeds the chapters it lists', () => {
		const id = idOf('Drawing: Saikyou Mangaka wa Oekaki Skill de Isekai Musou Suru');
		const db = getDb();
		// A duplicate of chapter 1, shadowed in place and still on disk, and a
		// cover downloaded like a chapter: neither is a chapter the run prints.
		db.prepare(
			`UPDATE entries SET shadowed = 1, available = 1, file = 'Chapter 1.cbz'
			WHERE series_id = ? AND position = 1`
		).run(id);
		db.prepare(
			`INSERT INTO entries (series_id, position, label, added_at, matter, available, file)
			VALUES (?, 0, 'Cover', ?, 'front', 1, 'Cover.jpg')`
		).run(id, NOW);
		// And one counted chapter that is not on disk: the count is below the
		// denominator, not over it.
		db.prepare(
			`UPDATE entries SET available = 0, file = '' WHERE series_id = ? AND position = 2`
		).run(id);
		const facts = make(
			['Drawing: Saikyou Mangaka wa Oekaki Skill de Isekai Musou Suru', 'Kusuriya no Hitorigoto'],
			'Counted Run'
		);
		const part = works
			.workPage(facts.work.id, { reveal: true })!
			.parts.find((p) => p.seriesId === id)!;
		const chapters = db
			.prepare(
				`SELECT COUNT(*) AS n FROM entries WHERE series_id = ? AND shadowed = 0 AND matter = ''`
			)
			.get(id) as { n: number };
		// The denominator the run prints, and a numerator under it: the matter
		// row and the shadowed copy are both `available = 1`, so counting every
		// available row said N > M and could say ALL DOWNLOADED over a gap.
		expect(part.entries).toBe(chapters.n);
		expect(part.downloaded).toBe(chapters.n - 1);
		expect(part.downloaded).toBeLessThanOrEqual(part.entries);
		const loose = db
			.prepare(`SELECT COUNT(*) AS n FROM entries WHERE series_id = ? AND available = 1`)
			.get(id) as { n: number };
		expect(loose.n).toBeGreaterThan(part.downloaded);
		expect(loose.n).toBeGreaterThan(part.entries);
	});
});

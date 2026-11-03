import { beforeEach, describe, expect, it } from 'vitest';

// Before anything imports db.ts: getDb() reads this once and memoises.
process.env.DATABASE_PATH = ':memory:';
// No catalogue: the Works here are grouped by hand, never offered.
process.env.TSUNDOKU_ANILIST = 'off';

const { getDb } = await import('$lib/server/db');
const { seedSample } = await import('$lib/server/fixtures');
const lib = await import('$lib/server/library');
const works = await import('$lib/server/works');

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
		expect(own[0]).toMatchObject({ id: facts.work.id, name: 'The Breaker', total: 2 });
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

	it('counts tiles everywhere: the shelf, the sidebar and a kind shelf', () => {
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
		expect(shelves.find((s) => s.key === 'k:manga')?.count).toBe(
			lib.listSeries({ reveal: true, shelf: 'k:manga' }).length - 1
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
		const onManga = workTiles({ reveal: true, shelf: 'k:manga' })[0];
		const onManhwa = workTiles({ reveal: true, shelf: 'k:manhwa' })[0];
		expect([onManga.face.id, onManhwa.face.id]).toEqual([manga, manhwa]);
		expect(onManga.name).toBe('Two Kinds');
		// One Work on each, not one per part.
		expect(workTiles({ reveal: true, shelf: 'k:manga' })).toHaveLength(1);
		expect(workTiles({ reveal: true, shelf: 'k:manhwa' })).toHaveLength(1);
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

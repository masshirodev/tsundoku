import { beforeEach, describe, expect, it } from 'vitest';

// Before anything imports db.ts: getDb() reads this once and memoises.
process.env.DATABASE_PATH = ':memory:';
process.env.TSUNDOKU_ANILIST = 'off';

/**
 * MIGHT CONTINUE <WORK> · AS PART N (W7, c281; Works Calls, question 6): the
 * read that decides the offer, the series screen's four actions behind it,
 * and the NEVER list as absences. The stem rule's own finite domain is in
 * tests/works.spec.ts; this file is what the server makes of it.
 */
const { getDb } = await import('$lib/server/db');
const { seedSample } = await import('$lib/server/fixtures');
const lib = await import('$lib/server/library');
const works = await import('$lib/server/works');
const seriesScreen = await import('../src/routes/series/[id]/+page.server');

beforeEach(() => {
	const db = getDb();
	db.exec(`DELETE FROM works; DELETE FROM work_dismissals; DELETE FROM roots;
		DELETE FROM collections; DELETE FROM tags; DELETE FROM scan_jobs;
		DELETE FROM suggestion_dismissals; DELETE FROM person_favourites; DELETE FROM history_removed;
		DELETE FROM tracker_accounts;`);
	seedSample(db, Date.UTC(2026, 8, 22));
	// The board's titles on six of the seed's visible manga, unrated, in no Work.
	for (const [from, to] of TITLES)
		db.prepare(`UPDATE series SET title = ? WHERE title = ?`).run(to, from);
});

const TITLES: [string, string][] = [
	['Isekai Yakkyoku', 'The Breaker'],
	['Tensei Shitara Ken Deshita', 'The Breaker: New Waves'],
	['Mushoku Tensei', 'The Breaker: Eternal Force'],
	['Villainess Level 99', 'Naruto'],
	['Chainsaw Man', 'Naruto Gaiden'],
	['Honzuki no Gekokujou', 'Boruto: Naruto Next Generations']
];
const NOW = Date.UTC(2026, 10, 5);
const idOf = (title: string) => {
	const id = lib.listSeries({ reveal: true }).find((s) => s.title === title)?.id;
	if (id === undefined) throw new Error(`no series ${title}`);
	return id;
};
const breaker = () =>
	works.createWork({
		seriesIds: [idOf('The Breaker'), idOf('The Breaker: New Waves')],
		name: 'The Breaker',
		now: NOW
	});

/** Everything a Work offer must never write on its own, as one comparable value. */
function snapshot() {
	const db = getDb();
	return {
		works: db.prepare(`SELECT id, name, created_at, order_mode FROM works ORDER BY id`).all(),
		members: db
			.prepare(`SELECT work_id, series_id, position FROM work_series ORDER BY work_id, series_id`)
			.all(),
		series: db
			.prepare(`SELECT id, title, rating, favourite, hidden, followed_at FROM series ORDER BY id`)
			.all(),
		links: db.prepare(`SELECT * FROM series_links ORDER BY series_id`).all()
	};
}

type Answer = { status?: number; data?: Record<string, unknown> } & Record<string, unknown>;
async function postSeries(
	action: unknown,
	seriesId: number,
	fields: [string, string][] = [],
	reveal = true
): Promise<Answer> {
	const body = new FormData();
	for (const [k, v] of fields) body.append(k, v);
	return (await (action as (e: unknown) => Promise<Answer>)({
		request: new Request('http://localhost/', { method: 'POST', body }),
		params: { id: String(seriesId) },
		url: new URL(`http://localhost/series/${seriesId}`),
		cookies: { get: () => (reveal ? '1' : undefined) }
	})) as Answer;
}

describe('the offer a series screen reads (c281)', () => {
	it('offers The Breaker to Eternal Force, as part 3, by the Work’s name', () => {
		const { work } = breaker();
		const offer = works.workOfferFor(idOf('The Breaker: Eternal Force'), false)!;
		expect(offer).toMatchObject({
			workId: work.id,
			name: 'The Breaker',
			part: 3,
			reason: "ITS TITLE STARTS WITH THE WORK'S NAME · THE WORK HOLDS 2 SERIES",
			key: `work:${NOW}:${idOf('The Breaker: Eternal Force')}`
		});
		expect(offer.parts.map((p) => p.title)).toEqual(['The Breaker', 'The Breaker: New Waves']);
		expect(offer.series.title).toBe('The Breaker: Eternal Force');
	});

	it('never offers Naruto to Boruto, and offers it to Naruto Gaiden by the part’s title', () => {
		// A Work whose name is not the stem: only its part's title can match.
		const run = works.createWork({
			seriesIds: [idOf('Naruto'), idOf('The Breaker')],
			name: 'Shonen Shelf',
			now: NOW
		});
		expect(works.workOfferFor(idOf('Boruto: Naruto Next Generations'), true)).toBeNull();
		expect(works.workOfferFor(idOf('Naruto Gaiden'), true)).toMatchObject({
			workId: run.work.id,
			reason: "ITS TITLE STARTS WITH PART 1'S TITLE · THE WORK HOLDS 2 SERIES"
		});
	});

	it('offers nothing to a series already in a Work, nor to a part of the Work itself', () => {
		breaker();
		const other = works.createWork({
			seriesIds: [idOf('The Breaker: Eternal Force'), idOf('Naruto')],
			name: 'Elsewhere',
			now: NOW + 1
		});
		expect(works.workOfferFor(idOf('The Breaker: Eternal Force'), true)).toBeNull();
		expect(works.workOfferFor(idOf('The Breaker: New Waves'), true)).toBeNull();
		void other;
	});

	it('offers nothing for a hidden series with reveal off, and never names a hidden Work', () => {
		breaker();
		const force = idOf('The Breaker: Eternal Force');
		lib.setHidden([force], true);
		expect(works.workOfferFor(force, false)).toBeNull();
		// Reveal on, a hidden series cannot join a visible Work: no offer either.
		expect(works.workOfferFor(force, true)).toBeNull();
		lib.setHidden([force], false);
		// The Work hidden whole: a visible series' screen never names it.
		const { work } = works.createWork({
			seriesIds: [idOf('Naruto'), idOf('Naruto Gaiden')],
			name: 'Naruto',
			now: NOW + 1
		});
		works.hideWork(work.id, true);
		const boruto = idOf('Boruto: Naruto Next Generations');
		void boruto;
		lib.setHidden([idOf('The Breaker'), idOf('The Breaker: New Waves')], true);
		expect(works.workOfferFor(force, false)).toBeNull();
		expect(works.workOfferFor(force, true)).toBeNull();
	});

	it('offers a hidden series a hidden Work only with reveal on, which it could join', () => {
		const { work } = breaker();
		const force = idOf('The Breaker: Eternal Force');
		works.hideWork(work.id, true);
		lib.setHidden([force], true);
		expect(works.workOfferFor(force, false)).toBeNull();
		expect(works.workOfferFor(force, true)?.workId).toBe(work.id);
	});

	it('offers nothing for a Work whose parts are hidden differently: it refuses every add', () => {
		const { work } = breaker();
		lib.setHidden([idOf('The Breaker: New Waves')], true);
		expect(works.workOfferFor(idOf('The Breaker: Eternal Force'), true)).toBeNull();
		void work;
	});

	it('keeps NOT THIS for good, through an UNDO that brings the Work back under a new id', () => {
		const { work } = breaker();
		const force = idOf('The Breaker: Eternal Force');
		const offer = works.workOfferFor(force, true)!;
		works.dismissWorkOffer(offer.key, NOW);
		expect(works.workOfferFor(force, true)).toBeNull();

		// Ended, a newer Work given its id, then brought back under a new one:
		// still the Work the owner said NOT THIS to.
		const out = works.takeOut(work.id, idOf('The Breaker'));
		expect(out.ended).not.toBeNull();
		const newer = works.createWork({
			seriesIds: [idOf('Naruto'), idOf('Naruto Gaiden')],
			name: 'Naruto',
			now: NOW + 1
		});
		expect(newer.work.id).toBe(work.id);
		works.undoTakeOut(out);
		expect(works.workOfSeries(idOf('The Breaker'))?.id).not.toBe(work.id);
		expect(works.workOfferFor(force, true)).toBeNull();
	});

	it('does not let an old NOT THIS silence a newer Work that was given the same id', () => {
		const { work } = breaker();
		const force = idOf('The Breaker: Eternal Force');
		works.dismissWorkOffer(works.workOfferFor(force, true)!.key, NOW);
		works.ungroup(work.id);
		const again = works.createWork({
			seriesIds: [idOf('The Breaker'), idOf('The Breaker: New Waves')],
			name: 'The Breaker',
			now: NOW + 5
		});
		expect(again.work.id).toBe(work.id);
		// Keyed by the id, as W1's helper was, the dismissal would hide this.
		expect(works.workOfferFor(force, true)?.workId).toBe(again.work.id);
	});

	it('picks the longest stem when two Works match, and the newer on a tie', () => {
		breaker();
		const waves = works.createWork({
			seriesIds: [idOf('Naruto'), idOf('Naruto Gaiden')],
			name: 'The Breaker: Eternal',
			now: NOW + 1
		});
		expect(works.workOfferFor(idOf('The Breaker: Eternal Force'), true)?.workId).toBe(
			waves.work.id
		);
	});
});

describe('the series screen’s offer, through its own actions (c281)', () => {
	it('loads the offer, and reading it writes nothing', async () => {
		breaker();
		const force = idOf('The Breaker: Eternal Force');
		const before = snapshot();
		const data = (await seriesScreen.load({
			params: { id: String(force) },
			cookies: { get: () => undefined },
			url: new URL(`http://localhost/series/${force}`),
			parent: async () => ({ shelves: [] })
		} as never)) as { workOffer: { name: string; part: number } | null };
		expect(data.workOffer).toMatchObject({ name: 'The Breaker', part: 3 });
		expect(snapshot()).toEqual(before);
	});

	it('REVIEW’s add puts this series last, and moves nothing else (the NEVER list)', async () => {
		const { work } = breaker();
		const force = idOf('The Breaker: Eternal Force');
		const [a, b] = [idOf('The Breaker'), idOf('The Breaker: New Waves')];
		lib.setRating([a], 9);
		lib.setFavourite([a], true);
		getDb().prepare(`UPDATE series SET followed_at = ? WHERE id = ?`).run(NOW, a);
		const before = snapshot();
		const answer = await postSeries(seriesScreen.actions.addToWork, force, [
			['work', String(work.id)],
			['series', String(force)]
		]);
		expect(answer.workJoined).toMatchObject({ workId: work.id, seriesId: force, position: 3 });
		expect(works.workParts(work.id, true).map((p) => p.seriesId)).toEqual([a, b, force]);
		// Its own rating, FAV, FOLLOW (`followed_at`) and link: nothing crossed from part 1.
		const after = snapshot();
		expect(after.series).toEqual(before.series);
		expect(after.links).toEqual(before.links);
		// Nor was the Work renamed or reordered: only one membership is new.
		expect(after.works).toEqual(before.works);
		expect(after.members.length).toBe(before.members.length + 1);

		// UNDO takes it out again; the Work is as it was.
		const undone = await postSeries(seriesScreen.actions.undoAddToWork, force, [
			['facts', JSON.stringify(answer.workJoined)]
		]);
		expect(undone).toEqual({ ok: true });
		expect(snapshot()).toEqual(before);
		// A second press refuses as a band, never a 500, and changes nothing.
		const again = await postSeries(seriesScreen.actions.undoAddToWork, force, [
			['facts', JSON.stringify(answer.workJoined)]
		]);
		expect(again.status).toBe(400);
		expect(snapshot()).toEqual(before);
	});

	it('adds only this series from its screen, whatever else a form names', async () => {
		const { work } = breaker();
		const force = idOf('The Breaker: Eternal Force');
		const before = snapshot();
		const answer = await postSeries(seriesScreen.actions.addToWork, force, [
			['work', String(work.id)],
			['series', String(force)],
			['series', String(idOf('Naruto'))]
		]);
		expect(answer.status).toBe(400);
		const other = await postSeries(seriesScreen.actions.addToWork, force, [
			['work', String(work.id)],
			['series', String(idOf('Naruto'))]
		]);
		expect(other.status).toBe(400);
		expect(snapshot()).toEqual(before);
	});

	it('NOT THIS stores the offer and nothing else; UNDO brings it back', async () => {
		breaker();
		const force = idOf('The Breaker: Eternal Force');
		const offer = works.workOfferFor(force, true)!;
		const before = snapshot();
		const answer = await postSeries(seriesScreen.actions.dismissWorkOffer, force, [
			['key', offer.key]
		]);
		expect(answer).toEqual({ workOfferDismissed: offer.key });
		expect(snapshot()).toEqual(before);
		expect(works.workOfferFor(force, true)).toBeNull();
		// The same press again keeps one row: NOT THIS is idempotent.
		await postSeries(seriesScreen.actions.dismissWorkOffer, force, [['key', offer.key]]);
		expect(
			(getDb().prepare(`SELECT COUNT(*) AS n FROM work_dismissals`).get() as { n: number }).n
		).toBe(1);
		expect(
			await postSeries(seriesScreen.actions.undoWorkOffer, force, [['key', offer.key]])
		).toEqual({ ok: true });
		expect(works.workOfferFor(force, true)?.key).toBe(offer.key);
	});

	it('refuses a key that is not this series’ own, or not a key at all', async () => {
		breaker();
		const force = idOf('The Breaker: Eternal Force');
		const naruto = idOf('Naruto');
		for (const key of [`work:${NOW}:${naruto}`, 'work:1:2:3', 'work:1; DROP TABLE works', ''])
			expect(
				(await postSeries(seriesScreen.actions.dismissWorkOffer, force, [['key', key]])).status
			).toBe(400);
		expect(
			(getDb().prepare(`SELECT COUNT(*) AS n FROM work_dismissals`).get() as { n: number }).n
		).toBe(0);
	});
});

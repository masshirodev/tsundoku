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
// Reveal is a value only the server makes (prefs.ts), never a bare '1'.
const { revealValue } = await import('$lib/server/prefs');
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
		cookies: {
			get: (n: string) => (reveal ? (n === 'tsundoku_reveal' ? revealValue('1') : '1') : undefined)
		}
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
		// A visible series whose title continues it: offered while the Work is
		// visible, so the nulls below are the hiding's, not the stem rule's.
		getDb()
			.prepare(`UPDATE series SET title = ? WHERE title = ?`)
			.run('Naruto Shippuden', 'Boruto: Naruto Next Generations');
		const shippuden = idOf('Naruto Shippuden');
		expect(works.workOfferFor(shippuden, false)?.workId).toBe(work.id);
		works.hideWork(work.id, true);
		expect(works.workOfferFor(shippuden, false)).toBeNull();
		expect(works.workOfferFor(shippuden, true)).toBeNull();
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
			['series', String(force)],
			['key', works.workOfferFor(force, true)!.key]
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

	it('refuses an offer whose Work ended and whose id another Work was given', async () => {
		// The page loaded the offer; then, elsewhere, the Work was ungrouped and
		// a newer, unrelated Work took its id. The sheet still posts the old id.
		const { work } = breaker();
		const force = idOf('The Breaker: Eternal Force');
		const offer = works.workOfferFor(force, true)!;
		works.ungroup(offer.workId);
		const unrelated = works.createWork({
			seriesIds: [idOf('Naruto'), idOf('Naruto Gaiden')],
			name: 'Unrelated',
			now: NOW + 7
		});
		expect(unrelated.work.id).toBe(work.id);
		const before = snapshot();
		const answer = await postSeries(seriesScreen.actions.addToWork, force, [
			['work', String(offer.workId)],
			['series', String(force)],
			['key', offer.key]
		]);
		expect(answer.status).toBe(400);
		expect(answer.data).toEqual({ workMessage: 'THAT WORK HAS CHANGED · LOOK AGAIN', stale: true });
		expect(snapshot()).toEqual(before);
		expect(works.workOfSeries(force)).toBeNull();
	});

	it('refuses an offer dismissed between the page’s load and the tap', async () => {
		const { work } = breaker();
		const force = idOf('The Breaker: Eternal Force');
		const offer = works.workOfferFor(force, true)!;
		// NOT THIS from another screen (the TV, another tab) after this one loaded.
		works.dismissWorkOffer(offer.key, NOW);
		const before = snapshot();
		const answer = await postSeries(seriesScreen.actions.addToWork, force, [
			['work', String(work.id)],
			['series', String(force)],
			['key', offer.key]
		]);
		expect(answer.status).toBe(400);
		expect(answer.data).toEqual({ workMessage: 'THAT WORK HAS CHANGED · LOOK AGAIN', stale: true });
		expect(snapshot()).toEqual(before);
	});

	it('refuses a post with no key, another series’ key, or a key the Work was not made at', async () => {
		const { work } = breaker();
		const force = idOf('The Breaker: Eternal Force');
		const naruto = idOf('Naruto');
		const before = snapshot();
		for (const key of [
			null,
			'',
			'work:1; DROP TABLE works',
			`work:${NOW}:${naruto}`,
			`work:${NOW + 1}:${force}`
		]) {
			const fields: [string, string][] = [
				['work', String(work.id)],
				['series', String(force)]
			];
			if (key !== null) fields.push(['key', key]);
			const answer = await postSeries(seriesScreen.actions.addToWork, force, fields);
			expect(answer.status, String(key)).toBe(400);
		}
		expect(snapshot()).toEqual(before);
	});

	it('UNDO of an add refuses malformed facts, or facts naming another series, as a band', async () => {
		const { work } = breaker();
		const force = idOf('The Breaker: Eternal Force');
		const naruto = idOf('Naruto Gaiden');
		// Another series' add, made elsewhere: this screen must not undo it.
		const theirs = works.addSeries(work.id, naruto);
		const before = snapshot();
		for (const facts of ['{not json', JSON.stringify(theirs)]) {
			const answer = await postSeries(seriesScreen.actions.undoAddToWork, force, [
				['facts', facts]
			]);
			expect(answer.status, facts).toBe(400);
		}
		expect(snapshot()).toEqual(before);
		expect(works.workOfSeries(naruto)?.id).toBe(work.id);
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

describe('every UNDO on the series screen reads its posted facts before writing (c585)', () => {
	/** The library as every UNDO here could change it, alt titles included (RENAME's). */
	const state = () => ({
		...snapshot(),
		alts: getDb().prepare(`SELECT id, alt_titles FROM series ORDER BY id`).all()
	});
	/** Facts that are not JSON, not an object, or an object missing or mistyping a field. */
	const malformed = (good: Record<string, unknown>, optional = ['workName']) => [
		'{not json',
		'',
		'null',
		'5',
		'"facts"',
		'[]',
		'{}',
		...Object.keys(good)
			.filter((k) => !optional.includes(k))
			.map((k) => {
				const { [k]: _gone, ...rest } = good;
				void _gone;
				return JSON.stringify(rest);
			}),
		...Object.keys(good).map((k) => JSON.stringify({ ...good, [k]: { nested: true } }))
	];
	async function refusesAll(action: unknown, seriesId: number, list: string[]) {
		const before = state();
		for (const facts of list) {
			const answer = await postSeries(action, seriesId, [['facts', facts]]);
			expect(answer.status, facts).toBe(400);
			expect((answer.data as { message: string }).message, facts).toBeTruthy();
			expect(state(), facts).toEqual(before);
		}
		// And no facts field at all.
		const none = await postSeries(action, seriesId);
		expect(none.status).toBe(400);
		expect(state()).toEqual(before);
	}

	it('UNDO of the WORK row’s TAKE OUT: malformed facts are 400 NOTHING TO UNDO, never a 500', async () => {
		const { work } = breaker();
		const waves = idOf('The Breaker: New Waves');
		const force = idOf('The Breaker: Eternal Force');
		works.addSeries(work.id, force);
		const out = await postSeries(seriesScreen.actions.takeOutWork, force, [
			['made', String(work.createdAt)]
		]);
		const facts = out.workTakenOut as Record<string, unknown>;
		expect(facts.seriesId).toBe(force);
		await refusesAll(seriesScreen.actions.undoTakeOutWork, force, malformed(facts));
		const answer = await postSeries(seriesScreen.actions.undoTakeOutWork, force, [
			['facts', '{not json']
		]);
		expect(answer).toMatchObject({ status: 400, data: { message: 'NOTHING TO UNDO' } });
		// The good facts still put it back: the guard refuses only what is malformed.
		expect(
			await postSeries(seriesScreen.actions.undoTakeOutWork, force, [
				['facts', JSON.stringify(facts)]
			])
		).toEqual({ ok: true });
		expect(works.workOfSeries(force)?.id).toBe(work.id);
		void waves;
	});

	it('UNDO of a TAKE OUT that ended the Work refuses an ended Work that is malformed or lacks this series', async () => {
		const { work } = breaker();
		const breakerId = idOf('The Breaker');
		const out = await postSeries(seriesScreen.actions.takeOutWork, breakerId, [
			['made', String(work.createdAt)]
		]);
		const facts = out.workTakenOut as { ended: { work: object; members: object[] } };
		expect(facts.ended).not.toBeNull();
		const bad = [
			{ ...facts, ended: {} },
			{ ...facts, ended: { ...facts.ended, work: { ...facts.ended.work, orderMode: 'nope' } } },
			{ ...facts, ended: { ...facts.ended, members: [{ seriesId: 'x', position: 1 }] } },
			// An ended Work that never held this series: another's take-out, dressed as ours.
			{
				...facts,
				ended: {
					...facts.ended,
					members: [{ seriesId: idOf('Naruto'), position: 1 }]
				}
			}
		].map((f) => JSON.stringify(f));
		await refusesAll(seriesScreen.actions.undoTakeOutWork, breakerId, bad);
		expect(
			await postSeries(seriesScreen.actions.undoTakeOutWork, breakerId, [
				['facts', JSON.stringify(facts)]
			])
		).toEqual({ ok: true });
		expect(works.workOfSeries(breakerId)?.name).toBe(work.name);
	});

	it('UNDO of a TAKE OUT refuses another series’ take-out, and one whose Work has moved on, writing nothing', async () => {
		const { work } = breaker();
		const force = idOf('The Breaker: Eternal Force');
		const waves = idOf('The Breaker: New Waves');
		works.addSeries(work.id, force);
		const theirs = (
			await postSeries(seriesScreen.actions.takeOutWork, waves, [['made', String(work.createdAt)]])
		).workTakenOut as object;
		// Another series' facts, posted on this screen.
		await refusesAll(seriesScreen.actions.undoTakeOutWork, force, [JSON.stringify(theirs)]);
		expect(works.workOfSeries(waves)).toBeNull();
		// Its own facts, but it is in another Work since: the writer's refusal, still a band.
		const mine = (
			await postSeries(seriesScreen.actions.takeOutWork, force, [['made', String(work.createdAt)]])
		).workTakenOut as object;
		works.createWork({ seriesIds: [force, idOf('Naruto')], name: 'Elsewhere', now: NOW + 5 });
		const before = state();
		const answer = await postSeries(seriesScreen.actions.undoTakeOutWork, force, [
			['facts', JSON.stringify(mine)]
		]);
		expect(answer.status).toBe(400);
		expect(state()).toEqual(before);
	});

	it('UNDO of ADD TO A WORK: malformed facts and a Work changed since are refused, writing nothing', async () => {
		const { work } = breaker();
		const force = idOf('The Breaker: Eternal Force');
		const facts = works.addSeries(work.id, force) as unknown as Record<string, unknown>;
		await refusesAll(seriesScreen.actions.undoAddToWork, force, malformed(facts));
		// Taken out since by hand: the add's UNDO has nothing left to undo.
		works.takeOut(work.id, force);
		const before = state();
		const answer = await postSeries(seriesScreen.actions.undoAddToWork, force, [
			['facts', JSON.stringify(facts)]
		]);
		expect(answer.status).toBe(400);
		expect(state()).toEqual(before);
	});

	it('UNDO of RENAME: malformed facts, another series’ and a name changed since are refused, writing nothing', async () => {
		const force = idOf('The Breaker: Eternal Force');
		const naruto = idOf('Naruto');
		const renamed = (
			await postSeries(seriesScreen.actions.rename, force, [['name', 'Eternal Force (mine)']])
		).renamed as Record<string, unknown>;
		expect(renamed.seriesId).toBe(force);
		await refusesAll(seriesScreen.actions.undoRename, force, malformed(renamed));
		const theirs = (
			await postSeries(seriesScreen.actions.rename, naruto, [['name', 'Naruto (mine)']])
		).renamed as object;
		await refusesAll(seriesScreen.actions.undoRename, force, [JSON.stringify(theirs)]);
		await postSeries(seriesScreen.actions.rename, force, [['name', 'Eternal Force (again)']]);
		const before = state();
		const answer = await postSeries(seriesScreen.actions.undoRename, force, [
			['facts', JSON.stringify(renamed)]
		]);
		expect(answer.status).toBe(400);
		expect(state()).toEqual(before);
	});

	it('UNDO of a HIDE: malformed facts, another series’ and a Work ended since are refused, writing nothing', async () => {
		const { work } = breaker();
		const breakerId = idOf('The Breaker');
		const force = idOf('The Breaker: Eternal Force');
		works.addSeries(work.id, force);
		const hid = (await postSeries(seriesScreen.actions.hidePart, breakerId)).hideFacts as {
			hidden: number[];
			out: Record<string, unknown>[];
		};
		expect(hid.hidden).toEqual([breakerId]);
		const bad = [
			...malformed({ hidden: hid.hidden, out: hid.out }),
			JSON.stringify({ ...hid, hidden: ['x'] }),
			JSON.stringify({ ...hid, out: [{ ...hid.out[0], position: 'first' }] }),
			JSON.stringify({ ...hid, out: [{}] }),
			// Neither hid nor took out this series.
			JSON.stringify({ hidden: [force], out: [] }),
			JSON.stringify({ hidden: [], out: [] })
		];
		await refusesAll(seriesScreen.actions.undoHide, breakerId, bad);
		// Another series' HIDE, posted on this one's screen.
		const theirs = (await postSeries(seriesScreen.actions.hidePart, force)).hideFacts;
		await refusesAll(seriesScreen.actions.undoHide, breakerId, [JSON.stringify(theirs)]);
		// Its own facts, but the Work has ended since (and a newer one took its id).
		// (Taking Eternal Force out above left one part, which ended it.)
		expect(works.workOfSeries(idOf('The Breaker: New Waves'))).toBeNull();
		works.createWork({
			seriesIds: [idOf('Naruto'), idOf('Naruto Gaiden')],
			name: 'Newer',
			now: NOW + 9
		});
		const before = state();
		const answer = await postSeries(seriesScreen.actions.undoHide, breakerId, [
			['facts', JSON.stringify(hid)]
		]);
		expect(answer.status).toBe(400);
		expect(state()).toEqual(before);
	});
});

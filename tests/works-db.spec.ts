import { beforeEach, describe, expect, it, vi } from 'vitest';

// Before anything imports db.ts: getDb() reads this once and memoises.
process.env.DATABASE_PATH = ':memory:';
// No catalogue, as the tracking specs do: the send is fire-and-forget, so a
// spec that watches one must not reach the network and must see a queued row.
process.env.TSUNDOKU_ANILIST = 'off';

const { getDb } = await import('$lib/server/db');
const { seedSample } = await import('$lib/server/fixtures');
const lib = await import('$lib/server/library');
const works = await import('$lib/server/works');
const { continuePart, runStatus, workFoot, workRating } = await import('$lib/library/works');
type Rating = import('$lib/library/types').Rating;

/** A fresh library per test: grouping reshapes the data under test. */
beforeEach(() => {
	const db = getDb();
	db.exec(`DELETE FROM works; DELETE FROM work_dismissals; DELETE FROM roots;
		DELETE FROM collections; DELETE FROM tags; DELETE FROM scan_jobs;
		DELETE FROM suggestion_dismissals; DELETE FROM person_favourites; DELETE FROM history_removed;
		DELETE FROM tracker_accounts;`);
	seedSample(db, Date.UTC(2026, 8, 22));
});

const idOf = (title: string) => lib.listSeries({ reveal: true }).find((s) => s.title === title)?.id;
const NOW = Date.UTC(2026, 10, 2);

/** A part's ids in the Work's own order: what the reads and the writes act on. */
const partsOf = (workId: number) => works.workParts(workId, true).map((p) => p.seriesId);
const workIds = () =>
	(getDb().prepare(`SELECT id FROM works ORDER BY id`).all() as { id: number }[]).map((r) => r.id);
const positions = (workId: number) =>
	getDb()
		.prepare(
			`SELECT series_id AS seriesId, position FROM work_series WHERE work_id = ? ORDER BY position`
		)
		.all(workId) as { seriesId: number; position: number }[];
const ratingOf = (id: number) =>
	(getDb().prepare(`SELECT rating FROM series WHERE id = ?`).get(id) as { rating: number }).rating;
const favouriteOf = (id: number) =>
	(getDb().prepare(`SELECT favourite FROM series WHERE id = ?`).get(id) as { favourite: number })
		.favourite !== 0;
const hiddenOf = (id: number) =>
	(getDb().prepare(`SELECT hidden FROM series WHERE id = ?`).get(id) as { hidden: number })
		.hidden !== 0;

// Two manga both rated 8 and both a favourite: the seed's one agreeing pair.
const AGREE = [
	'Drawing: Saikyou Mangaka wa Oekaki Skill de Isekai Musou Suru',
	'Hikaru ga Shinda Natsu'
];
// Unrated and not a favourite, neither ever opened.
const UNRATED = ['Isekai Yakkyoku', 'Tensei Shitara Ken Deshita'];
// Titles that share their first word, and titles that do not: the default name.
const STEM = ['Isekai Yakkyoku', 'Isekai Ojisan'];

describe('creating a Work', () => {
	it('keeps the parts in the selection’s order, and names it by the words they share', () => {
		const [a, b] = STEM.map(idOf) as number[];
		const facts = works.createWork({ seriesIds: [a, b], now: NOW });
		expect(facts.work).toMatchObject({ name: 'Isekai', orderMode: 'hand' });
		expect(facts.members).toEqual([
			{ seriesId: a, position: 1 },
			{ seriesId: b, position: 2 }
		]);
		expect(works.workParts(facts.work.id, true).map((p) => p.kind)).toEqual(['manga', 'manga']);
	});

	it('orders by date added or by title when the sheet asks', () => {
		// Villainess was added before Honzuki, so date puts it first; title doesn't.
		const byTitleFirst = idOf('Honzuki no Gekokujou')!;
		const byDateFirst = idOf('Villainess Level 99')!;
		const added = works.createWork({
			seriesIds: [byTitleFirst, byDateFirst],
			name: 'Pair',
			order: 'added',
			now: NOW
		});
		expect(partsOf(added.work.id)).toEqual([byDateFirst, byTitleFirst]);
		const byTitle = works.createWork({
			seriesIds: [byDateFirst, byTitleFirst],
			name: 'Pair',
			order: 'title',
			now: NOW
		});
		expect(partsOf(byTitle.work.id)).toEqual([byTitleFirst, byDateFirst]);
	});

	it('refuses fewer than two series, a duplicate, no name, and mixing hidden with visible', () => {
		const a = idOf(UNRATED[0])!;
		const hidden = idOf('Kōhai no Himitsu Nikki')!;
		expect(() => works.createWork({ seriesIds: [a], name: 'One' })).toThrow(works.WorkError);
		expect(() => works.createWork({ seriesIds: [a, a], name: 'Twice' })).toThrow(works.WorkError);
		expect(() => works.createWork({ seriesIds: [a, idOf(UNRATED[1])!], name: '  ' })).toThrow(
			works.WorkError
		);
		// 'Kaori Mama on …' and 'Kaori Mama …' share a stem; these two do not.
		expect(() =>
			works.createWork({
				seriesIds: [idOf("Omniscient Reader's Viewpoint")!, idOf('Chainsaw Man')!]
			})
		).toThrow(works.WorkError);
		expect(() => works.createWork({ seriesIds: [a, hidden], name: 'Mixed' })).toThrow(
			/hidden and visible/
		);
		// The reverse: two hidden series make a hidden Work, which is allowed.
		const h2 = idOf('Onsen Ryokan no Yoru')!;
		expect(works.createWork({ seriesIds: [hidden, h2], name: 'Hidden' }).members).toHaveLength(2);
	});

	it('refuses a series that is only a browsing record', () => {
		const [a, b] = UNRATED.map(idOf) as number[];
		getDb().prepare(`UPDATE series SET in_library = 0 WHERE id = ?`).run(a);
		expect(() => works.createWork({ seriesIds: [a, b], name: 'Isekai' })).toThrow(
			/browsing record/
		);
	});

	it('moves a series out of another Work and UNDO puts it back where it sat', () => {
		const [a, b] = UNRATED.map(idOf) as number[];
		const c = idOf('Villainess Level 99')!;
		const first = works.createWork({ seriesIds: [a, b, c], name: 'First', now: NOW });
		const second = works.createWork({
			seriesIds: [b, idOf('Mushoku Tensei')!],
			name: 'Second',
			now: NOW
		});
		expect(second.movedFrom).toEqual([{ seriesId: b, workId: first.work.id, position: 2 }]);
		expect(partsOf(first.work.id)).toEqual([a, c]);
		expect(partsOf(second.work.id)).toContain(b);
		// The former Work kept two series, so it did not end.
		expect(workIds()).toContain(first.work.id);

		works.undoCreate(second);
		expect(workIds()).toEqual([first.work.id]);
		expect(positions(first.work.id)).toEqual([
			{ seriesId: a, position: 1 },
			{ seriesId: b, position: 2 },
			{ seriesId: c, position: 3 }
		]);
	});

	it('ends a Work the move leaves with one series, and UNDO restores the same Work', () => {
		const [a, b] = UNRATED.map(idOf) as number[];
		const first = works.createWork({ seriesIds: [a, b], name: 'Two', order: 'title', now: NOW });
		const second = works.createWork({
			seriesIds: [a, idOf('Mushoku Tensei')!],
			name: 'Steal',
			now: NOW
		});
		expect(second.ended.map((e) => e.work)).toEqual([first.work]);
		// Ended: the row is gone, not left holding one series.
		expect(workIds()).toEqual([second.work.id]);

		works.undoCreate(second);
		expect(workIds()).toEqual([first.work.id]);
		// The same Work, not a new one: its name, its order and both members.
		expect(works.workPage(first.work.id, { reveal: true })!.work).toEqual(first.work);
		expect(positions(first.work.id)).toEqual([
			{ seriesId: a, position: 1 },
			{ seriesId: b, position: 2 }
		]);
	});
});

describe('changing a Work', () => {
	it('adds to the end, refuses a duplicate, and UNDO takes it out again', () => {
		const [a, b] = UNRATED.map(idOf) as number[];
		const { work } = works.createWork({ seriesIds: [a, b], name: 'Isekai', now: NOW });
		const c = idOf('Mushoku Tensei')!;
		const facts = works.addSeries(work.id, c);
		expect(facts.position).toBe(3);
		expect(partsOf(work.id)).toEqual([a, b, c]);
		expect(() => works.addSeries(work.id, c)).toThrow(/already in this Work/);
		works.undoAdd(facts);
		expect(partsOf(work.id)).toEqual([a, b]);
	});

	it('moves a series in from another Work, ending that Work if one is left, and UNDO restores both', () => {
		const [a, b] = UNRATED.map(idOf) as number[];
		const old = works.createWork({ seriesIds: [a, b], name: 'Old', now: NOW });
		const other = works.createWork({
			seriesIds: [idOf('Mushoku Tensei')!, idOf('Villainess Level 99')!],
			name: 'Other',
			now: NOW
		});
		const facts = works.addSeries(other.work.id, a);
		expect(facts.ended.map((e) => e.work.id)).toEqual([old.work.id]);
		expect(workIds()).not.toContain(old.work.id);

		works.undoAdd(facts);
		expect(workIds()).toContain(old.work.id);
		expect(positions(old.work.id)).toEqual([
			{ seriesId: a, position: 1 },
			{ seriesId: b, position: 2 }
		]);
		expect(partsOf(other.work.id)).not.toContain(a);
	});

	it('refuses to add a hidden series to a visible Work', () => {
		const [a, b] = UNRATED.map(idOf) as number[];
		const { work } = works.createWork({ seriesIds: [a, b], name: 'Isekai', now: NOW });
		expect(() => works.addSeries(work.id, idOf('Kōhai no Himitsu Nikki')!)).toThrow(
			/hidden and visible/
		);
	});

	it('refuses every add to a Work whose parts have diverged, whichever one was hidden', () => {
		// A Work is made from two visible series, then one is hidden on its own
		// (HIDE on the series screen does exactly this today). Whichever part
		// that is -- first or last, lowest id or highest -- the Work is mixed,
		// and no add can keep it from staying so.
		const [a, b] = UNRATED.map(idOf) as number[];
		const { work } = works.createWork({ seriesIds: [a, b], name: 'Mixed', now: NOW });
		const visibleOther = idOf('Mushoku Tensei')!;
		const hiddenOther = idOf('Kōhai no Himitsu Nikki')!;

		lib.setHidden([a], true);
		expect(() => works.addSeries(work.id, visibleOther)).toThrow(/hidden differently/);
		expect(() => works.addSeries(work.id, hiddenOther)).toThrow(/hidden differently/);
		expect(partsOf(work.id)).toEqual([a, b]);

		// The other part, the other way round: same answer.
		lib.setHidden([a], false);
		lib.setHidden([b], true);
		expect(() => works.addSeries(work.id, visibleOther)).toThrow(/hidden differently/);
		expect(() => works.addSeries(work.id, hiddenOther)).toThrow(/hidden differently/);
		expect(partsOf(work.id)).toEqual([a, b]);
	});

	it('takes a series out at its place, and a Work of two ends; UNDO brings it back whole', () => {
		const [a, b] = UNRATED.map(idOf) as number[];
		const { work } = works.createWork({ seriesIds: [a, b], name: 'Two', order: 'hand', now: NOW });
		const c = idOf('Mushoku Tensei')!;
		works.addSeries(work.id, c);
		const middle = works.takeOut(work.id, b);
		expect(middle.position).toBe(2);
		expect(middle.ended).toBeNull();
		expect(partsOf(work.id)).toEqual([a, c]);
		works.undoTakeOut(middle);
		expect(positions(work.id)).toEqual([
			{ seriesId: a, position: 1 },
			{ seriesId: b, position: 2 },
			{ seriesId: c, position: 3 }
		]);

		const last = works.takeOut(work.id, c);
		expect(last.ended).toBeNull();
		const secondToLast = works.takeOut(work.id, a);
		expect(secondToLast.ended!.work).toEqual(work);
		expect(secondToLast.ended!.members).toEqual([
			{ seriesId: a, position: 1 },
			{ seriesId: b, position: 2 }
		]);
		expect(workIds()).not.toContain(work.id);

		works.undoTakeOut(secondToLast);
		expect(works.workPage(work.id, { reveal: true })!.work).toEqual(work);
		expect(positions(work.id)).toEqual([
			{ seriesId: a, position: 1 },
			{ seriesId: b, position: 2 }
		]);
	});

	it('reorders the whole list only, leaving another Work’s positions alone', () => {
		const [a, b] = UNRATED.map(idOf) as number[];
		const c = idOf('Villainess Level 99')!;
		const one = works.createWork({ seriesIds: [a, b, c], name: 'One', now: NOW });
		const other = works.createWork({
			seriesIds: [idOf('The Greatest Estate Developer')!, idOf('Lookism')!],
			name: 'Other',
			now: NOW
		});
		const otherBefore = positions(other.work.id);

		const facts = works.reorder(one.work.id, [c, a, b]);
		expect(partsOf(one.work.id)).toEqual([c, a, b]);
		expect(positions(other.work.id)).toEqual(otherBefore);
		// A partial list is a bug, not a convenience.
		expect(() => works.reorder(one.work.id, [a, b])).toThrow(/every series/);
		expect(() => works.reorder(one.work.id, [a, b, c, c])).toThrow(/every series/);

		works.undoReorder(facts);
		expect(partsOf(one.work.id)).toEqual([a, b, c]);
	});

	it('renames and UNDO gives the old name back', () => {
		const [a, b] = UNRATED.map(idOf) as number[];
		const { work } = works.createWork({ seriesIds: [a, b], name: 'Isekai', now: NOW });
		const facts = works.rename(work.id, '  Everything Isekai  ');
		expect(works.workPage(work.id, { reveal: true })!.work.name).toBe('Everything Isekai');
		expect(() => works.rename(work.id, '   ')).toThrow(/name/);
		works.undoRename(facts);
		expect(works.workPage(work.id, { reveal: true })!.work.name).toBe('Isekai');
	});

	it('ungroups everything and UNDO makes the same Work, not a new one', () => {
		const [a, b] = UNRATED.map(idOf) as number[];
		const { work } = works.createWork({
			seriesIds: [a, b],
			name: 'Isekai',
			order: 'title',
			now: NOW
		});
		const facts = works.ungroup(work.id);
		expect(workIds()).toEqual([]);
		works.undoUngroup(facts);
		expect(works.workPage(work.id, { reveal: true })!.work).toEqual(work);
		expect(partsOf(work.id)).toEqual([a, b]);
	});
});

describe('a Work’s rating and FAV', () => {
	it('sets the same rating on every part, and allows unrating an all-unrated Work', () => {
		const [a, b] = UNRATED.map(idOf) as number[];
		const { work } = works.createWork({ seriesIds: [a, b], name: 'Isekai', now: NOW });
		expect(works.setWorkRating(work.id, 5)).toBe(2);
		expect([ratingOf(a), ratingOf(b)]).toEqual([5, 5]);
		// All agree at 0 again: "unrate every part" is a real action.
		expect(works.setWorkRating(work.id, 0)).toBe(2);
		expect([ratingOf(a), ratingOf(b)]).toEqual([0, 0]);
	});

	it('sets all parts when they share one rating, and refuses mixed parts', () => {
		const [a, b] = AGREE.map(idOf) as number[];
		const { work } = works.createWork({ seriesIds: [a, b], name: 'Both', now: NOW });
		expect(works.setWorkRating(work.id, 6)).toBe(2);
		expect([ratingOf(a), ratingOf(b)]).toEqual([6, 6]);

		// Mixed: one part rated apart refuses, and neither rating moves.
		const [c] = UNRATED.map(idOf) as number[];
		const mixed = works.createWork({ seriesIds: [a, c], name: 'Mixed', now: NOW });
		expect(() => works.setWorkRating(mixed.work.id, 9)).toThrow(/rated differently/);
		expect(ratingOf(a)).toBe(6);
		expect(ratingOf(c)).toBe(0);
	});

	it('sends a linked part its score through the series’ own rating path', async () => {
		const [a, b] = AGREE.map(idOf) as number[];
		const { work } = works.createWork({ seriesIds: [a, b], name: 'Both', now: NOW });
		const db = getDb();
		db.prepare(
			`INSERT INTO series_links (series_id, anilist_id, via, linked_at) VALUES (?, 900001, 'mihon', 1)`
		).run(a);
		db.prepare(
			`INSERT INTO tracker_accounts (service, user_id, user_name, access_token, signed_in_at)
			VALUES ('anilist', '7', 'masshiro', 'al-token', 1)`
		).run();

		works.setWorkRating(work.id, 5);
		// Fire-and-forget: the queue row is the proof the tracker path ran, and
		// with the catalogue off it stays with its refusal, not a success.
		await vi.waitFor(
			() => {
				const row = db
					.prepare(
						`SELECT score, failed_at FROM tracker_sends WHERE series_id = ? AND service = 'anilist'`
					)
					.get(a) as { score: number; failed_at: number | null } | undefined;
				expect(row?.score).toBe(5);
				expect(row?.failed_at).not.toBeNull();
			},
			{ timeout: 5000 }
		);
	});

	it('refuses a set from a page that can see only part of the Work, as the server does', () => {
		const [a, b] = UNRATED.map(idOf) as number[];
		const { work } = works.createWork({ seriesIds: [a, b], name: 'Apart', now: NOW });
		lib.setRating([a], 8);
		lib.setRating([b], 3);
		lib.setHidden([b], true);

		// Reveal off: one part, and the page is told how many the Work holds.
		const page = works.workPage(work.id, { reveal: false })!;
		expect(page.parts.map((p) => p.seriesId)).toEqual([a]);
		expect(page.total).toBe(2);
		// The rule is over the visible parts, but knows it saw only one, so the
		// control is not live -- exactly what setWorkRating would refuse.
		expect(workRating(page.parts, page.total)).toEqual({ shown: 8, settable: false, value: null });
		expect(() => works.setWorkRating(work.id, 5)).toThrow(/rated differently/);
		expect([ratingOf(a), ratingOf(b)]).toEqual([8, 3]);

		// Reveal on sees both and reaches the same answer for the same reason.
		const all = works.workPage(work.id, { reveal: true })!;
		expect(workRating(all.parts, all.total)).toEqual({ shown: 6, settable: false, value: null });
	});

	it('sets FAV on every part while they agree, and refuses mixed parts', () => {
		const [a, b] = AGREE.map(idOf) as number[];
		const { work } = works.createWork({ seriesIds: [a, b], name: 'Both', now: NOW });
		expect(works.setWorkFavourite(work.id, false)).toBe(2);
		expect([favouriteOf(a), favouriteOf(b)]).toEqual([false, false]);
		expect(works.setWorkFavourite(work.id, true)).toBe(2);
		expect([favouriteOf(a), favouriteOf(b)]).toEqual([true, true]);

		const mixed = works.createWork({ seriesIds: [a, idOf(UNRATED[0])!], name: 'Mixed', now: NOW });
		expect(() => works.setWorkFavourite(mixed.work.id, true)).toThrow(/only some parts/);
	});
});

describe('hiding a Work', () => {
	it('hides and shows every part', () => {
		const [a, b] = UNRATED.map(idOf) as number[];
		const { work } = works.createWork({ seriesIds: [a, b], name: 'Isekai', now: NOW });
		expect(works.hideWork(work.id, true).changed).toBe(2);
		expect([hiddenOf(a), hiddenOf(b)]).toEqual([true, true]);
		expect(works.workPage(work.id, { reveal: false })).toBeNull();
		expect(works.workPage(work.id, { reveal: true })).not.toBeNull();
		works.hideWork(work.id, false);
		expect([hiddenOf(a), hiddenOf(b)]).toEqual([false, false]);
		expect(works.workPage(work.id, { reveal: false })).not.toBeNull();
	});

	it('filters a hidden part out in SQL, and a browsing record with it', () => {
		const [a, b] = UNRATED.map(idOf) as number[];
		const { work } = works.createWork({ seriesIds: [a, b], name: 'Isekai', now: NOW });
		lib.setHidden([a], true);
		// Gone from the server read while reveal is off -- not merely flagged.
		expect(works.workParts(work.id, false).map((p) => p.seriesId)).toEqual([b]);
		expect(works.workParts(work.id, true).map((p) => p.seriesId)).toEqual([a, b]);
		expect(works.workParts(work.id, true).find((p) => p.seriesId === a)!.hidden).toBe(true);
		lib.setHidden([a], false);

		// A browsing record is on no shelf, so a Work does not show one either.
		getDb().prepare(`UPDATE series SET in_library = 0 WHERE id = ?`).run(b);
		expect(works.workParts(work.id, true).map((p) => p.seriesId)).toEqual([a]);
	});

	it('gives a Work with nothing left to see no page at all', () => {
		const [a, b] = UNRATED.map(idOf) as number[];
		const { work } = works.createWork({ seriesIds: [a, b], name: 'Isekai', now: NOW });
		lib.setHidden([a, b], true);
		expect(works.workPage(work.id, { reveal: false })).toBeNull();
		expect(works.workPage(work.id, { reveal: true })!.parts).toHaveLength(2);
	});

	it('reads a hidden root’s Work as hidden, which s.hidden alone would not', () => {
		// Neither series is hidden itself: the root is. Only HIDDEN_SQL knows
		// that, so a JS filter on s.hidden would show both while reveal is off.
		const [h1, h2] = [idOf('Kōhai no Himitsu Nikki')!, idOf('Onsen Ryokan no Yoru')!];
		const { work } = works.createWork({ seriesIds: [h1, h2], name: 'Hidden', now: NOW });
		expect(works.workParts(work.id, false)).toEqual([]);
		expect(works.workPage(work.id, { reveal: false })).toBeNull();
		expect(works.workParts(work.id, true)).toHaveLength(2);

		// UNHIDE one makes it public inside that root: now SQL calls it visible,
		// and it joins a Work of visible series without mixing anything.
		lib.setHidden([h1], false);
		expect(works.workParts(work.id, false).map((p) => p.seriesId)).toEqual([h1]);
	});
});

describe('refusals the card asked for', () => {
	const MISSING = 999_999;

	it('refuses every action on a Work that is not there', () => {
		const [a, b] = UNRATED.map(idOf) as number[];
		expect(() => works.addSeries(MISSING, a)).toThrow(/no such Work/);
		expect(() => works.takeOut(MISSING, a)).toThrow(/no such Work/);
		expect(() => works.reorder(MISSING, [a, b])).toThrow(/no such Work/);
		expect(() => works.rename(MISSING, 'Ghost')).toThrow(/no such Work/);
		expect(() => works.ungroup(MISSING)).toThrow(/no such Work/);
		expect(() => works.setWorkRating(MISSING, 5)).toThrow(/no such Work/);
		expect(() => works.setWorkFavourite(MISSING, true)).toThrow(/no such Work/);
		expect(() => works.hideWork(MISSING, true)).toThrow(/no such Work/);
	});

	it('refuses a take-out of a series that is not a member', () => {
		const [a, b] = UNRATED.map(idOf) as number[];
		const { work } = works.createWork({ seriesIds: [a, b], name: 'Two', now: NOW });
		expect(() => works.takeOut(work.id, idOf('Mushoku Tensei')!)).toThrow(/not in this Work/);
		// A member of another Work is not a member of this one either.
		const other = works.createWork({
			seriesIds: [idOf('Villainess Level 99')!, idOf('Lookism')!],
			name: 'Other',
			now: NOW
		});
		expect(() => works.takeOut(work.id, partsOf(other.work.id)[0])).toThrow(/not in this Work/);
		expect(partsOf(work.id)).toEqual([a, b]);
	});

	it('refuses a rating that is not a whole number from 0 to 10', () => {
		const [a, b] = UNRATED.map(idOf) as number[];
		const { work } = works.createWork({ seriesIds: [a, b], name: 'Isekai', now: NOW });
		for (const bad of [-1, 11, 5.5, Number.NaN])
			expect(() => works.setWorkRating(work.id, bad as Rating)).toThrow(/a rating is 0-10/);
		expect([ratingOf(a), ratingOf(b)]).toEqual([0, 0]);
	});
});

describe('the Work a series belongs to', () => {
	it('finds a member’s Work, and nothing for a series in none', () => {
		const [a, b] = UNRATED.map(idOf) as number[];
		const { work } = works.createWork({ seriesIds: [a, b], name: 'Isekai', now: NOW });
		expect(works.workOfSeries(a)).toEqual(work);
		expect(works.workOfSeries(b)).toEqual(work);
		expect(works.workOfSeries(idOf('Mushoku Tensei')!)).toBeNull();
	});

	it('says nothing once the Work has ended', () => {
		const [a, b] = UNRATED.map(idOf) as number[];
		const { work } = works.createWork({ seriesIds: [a, b], name: 'Two', now: NOW });
		// Taking one out leaves one, so the Work ends and the survivor is free.
		works.takeOut(work.id, b);
		expect(works.workOfSeries(a)).toBeNull();
		expect(works.workOfSeries(b)).toBeNull();
	});
});

describe('the ADD A SERIES picker', () => {
	it('pages and searches in SQL, and never offers a part the Work already holds', () => {
		const [a, b] = UNRATED.map(idOf) as number[];
		const { work } = works.createWork({ seriesIds: [a, b], name: 'Isekai', now: NOW });

		const first = works.addableSeries(work.id, true, { limit: 1 });
		expect(first.items).toHaveLength(1);
		expect(first.total).toBeGreaterThan(1);
		expect(first.items.map((s) => s.seriesId)).not.toContain(a);
		// The page is in the library's order, and the total is what the filter
		// holds, not the page: the sheet says "N TO OFFER" while showing 120.
		const second = works.addableSeries(work.id, true, { limit: 1, offset: 1 });
		expect(second.items).toHaveLength(1);
		expect(second.items[0].seriesId).not.toBe(first.items[0].seriesId);
		expect(second.total).toBe(first.total);

		const matched = works.addableSeries(work.id, true, { q: 'Isekai', limit: 50 });
		expect(matched.items.length).toBeGreaterThan(0);
		expect(matched.items.every((s) => s.title.toLowerCase().includes('isekai'))).toBe(true);
		expect(matched.items.some((s) => s.seriesId === a)).toBe(false);
		expect(matched.total).toBe(matched.items.length);
		expect(works.addableSeries(work.id, true, { q: 'no such title' })).toEqual({
			items: [],
			total: 0
		});
	});
});

describe('a never-opened part reports new chapters', () => {
	it('reads NEW from the Work’s last open, so the run can draw NOT STARTED · +N NEW', () => {
		// Yofukashi is read through, so the Work has a last open; Isekai
		// Yakkyoku has never been opened, which is the state the run's
		// `NOT STARTED · +4 NEW` promises but a part-local read can never say.
		const opened = idOf('Yofukashi no Uta')!;
		const fresh = idOf('Isekai Yakkyoku')!;
		const { work } = works.createWork({ seriesIds: [opened, fresh], name: 'New Run', now: NOW });
		const db = getDb();
		const at = NOW - 60_000;
		db.prepare(`UPDATE entries SET last_opened_at = NULL WHERE series_id = ?`).run(opened);
		db.prepare(`UPDATE entries SET last_opened_at = ? WHERE series_id = ? AND position = 1`).run(
			at,
			opened
		);
		// Nothing on the never-opened part is new until one chapter arrives after
		// the Work's open.
		db.prepare(
			`UPDATE entries SET added_at = ?, arrived_at = NULL, read_at = NULL WHERE series_id = ?`
		).run(at - 1000, fresh);
		db.prepare(`UPDATE entries SET arrived_at = ? WHERE series_id = ? AND position = 1`).run(
			at + 1000,
			fresh
		);

		const part = works
			.workPage(work.id, { reveal: true })!
			.parts.find((p) => p.seriesId === fresh)!;
		expect(part.lastOpenedAt).toBeNull();
		expect(part.newCount).toBe(1);
		expect(runStatus(part, { now: at + 2000 })).toEqual({
			ink: '',
			sub: 'NOT STARTED · +1 NEW'
		});
	});
});

describe('a series deleted through the app’s own door', () => {
	it('ends the Work the delete leaves with one, and leaves another Work alone', async () => {
		const [a, b] = ['Chainsaw Man', 'Tensei Shitara Ken Deshita'].map(idOf) as number[];
		const [c, d] = ['Mushoku Tensei', 'Villainess Level 99'].map(idOf) as number[];
		const ends = works.createWork({ seriesIds: [a, b], name: 'Ends', now: NOW });
		const stays = works.createWork({ seriesIds: [c, d], name: 'Stays', now: NOW });

		// The library's own delete, which knows nothing about Works: the rule has
		// to be where the series row goes, not at the doors inside works.ts.
		const { deleteSeries } = await import('$lib/server/delete');
		await deleteSeries([a], true);

		expect(workIds()).toEqual([stays.work.id]);
		expect(works.workPage(ends.work.id, { reveal: true })).toBeNull();
		expect(works.workOfSeries(b)).toBeNull();
		expect(
			(
				getDb()
					.prepare(`SELECT COUNT(*) AS n FROM work_series WHERE work_id = ?`)
					.get(ends.work.id) as { n: number }
			).n
		).toBe(0);
		expect(partsOf(stays.work.id)).toEqual([c, d]);
	});

	it('leaves no Works row behind when the last part goes', async () => {
		const [a, b] = UNRATED.map(idOf) as number[];
		works.createWork({ seriesIds: [a, b], name: 'Two', now: NOW });
		const { deleteSeries } = await import('$lib/server/delete');
		await deleteSeries([a], true);
		await deleteSeries([b], true);
		expect(workIds()).toEqual([]);
		expect(
			(getDb().prepare(`SELECT COUNT(*) AS n FROM work_series`).get() as { n: number }).n
		).toBe(0);
	});
});

describe('offers a later slice stores and undoes', () => {
	it('keeps a Work dismissal apart from the books’ table, and takes it back', () => {
		const [a, b] = UNRATED.map(idOf) as number[];
		const { work } = works.createWork({ seriesIds: [a, b], name: 'Isekai', now: NOW });
		const key = works.workDismissalKey(work.id, idOf('Mushoku Tensei')!);
		expect(key.startsWith('work:')).toBe(true);
		expect(works.workOfferDismissed(key)).toBe(false);
		works.dismissWorkOffer(key, NOW);
		expect(works.workOfferDismissed(key)).toBe(true);
		// The books' reader only ever reads its own table.
		expect(
			(getDb().prepare(`SELECT COUNT(*) AS n FROM suggestion_dismissals`).get() as { n: number }).n
		).toBe(0);
		works.undoWorkOffer(key);
		expect(works.workOfferDismissed(key)).toBe(false);
	});
});

describe('a Work’s parts as CONTINUE reads them', () => {
	it('reads the part the owner was in, and crosses to the next when it is finished', () => {
		const done = idOf('Dungeon Meshi')!; // read through, opened 20,000 minutes ago
		const next = idOf('Isekai Yakkyoku')!; // never opened
		const { work } = works.createWork({ seriesIds: [done, next], name: 'Run', now: NOW });
		const parts = works.workParts(work.id, true);
		expect(parts[0].read).toBe(parts[0].entries);
		expect(parts[1].lastOpenedAt).toBeNull();
		// The pure module owns the decision; this pins what the server hands it.
		expect(continuePart(parts)!.seriesId).toBe(next);
		expect(workFoot(parts).label).toBe('UP NEXT · PART 2');
	});

	it('carries the series’ own added_at, which W2’s “most recent part” sort needs', () => {
		const [a, b] = UNRATED.map(idOf) as number[];
		const { work } = works.createWork({ seriesIds: [a, b], name: 'Facts', now: NOW });
		const addedAt = (id: number) =>
			(getDb().prepare(`SELECT added_at AS at FROM series WHERE id = ?`).get(id) as { at: number })
				.at;
		expect(works.workParts(work.id, true).map((p) => p.addedAt)).toEqual([addedAt(a), addedAt(b)]);
	});
});

describe('what W4 and W5 read off a Work', () => {
	/** A Work of three: the manga trio the page reads below. */
	const three = () =>
		works.createWork({
			seriesIds: [
				idOf('Isekai Ojisan')!,
				idOf('Isekai Yakkyoku')!,
				idOf('Tensei Shitara Ken Deshita')!
			],
			name: 'Three',
			now: NOW
		});

	it('lists the Works a sheet can add to, with how many series each holds', () => {
		const made = three();
		expect(works.workChoices()).toEqual([{ id: made.work.id, name: 'Three', series: 3 }]);
	});

	it('says, for a page of series, which Works have one here and where each run is', () => {
		const made = three();
		const [first, second, third] = partsOf(made.work.id);
		// Only two of the page's series are in the Work: "2 OF 3 HERE".
		const rows = works.worksOnTagPage([first, second], true);
		expect(rows).toHaveLength(1);
		expect(rows[0]).toMatchObject({ id: made.work.id, name: 'Three', here: 2, of: 3 });
		// UP NEXT names the part CONTINUE opens, which is the first unfinished one.
		expect(rows[0].upNext).toBe(continuePart(works.workParts(made.work.id, true))?.title);
		// A page with nothing of it says nothing; the same series twice counts once.
		expect(works.worksOnTagPage([third + 1000], true)).toEqual([]);
		expect(works.worksOnTagPage([first, first], true)[0].here).toBe(1);
		// A hidden Work is not on the page while reveal is off.
		works.hideWork(made.work.id, true);
		expect(works.worksOnTagPage([first, second], false)).toEqual([]);
	});

	it('draws one series’ row: its place, neighbours, and where the run is', () => {
		const made = three();
		const [first, second, third] = partsOf(made.work.id);
		// Part 1 read through, part 2 in progress (opened, ten chapters read), part
		// 3 never started.
		getDb()
			.prepare(`UPDATE entries SET read_at = ? WHERE series_id = ? AND shadowed = 0`)
			.run(NOW, first);
		getDb()
			.prepare(
				`UPDATE entries SET read_at = ? WHERE series_id = ? AND shadowed = 0 AND position <= 10`
			)
			.run(NOW, second);
		getDb()
			.prepare(
				`UPDATE entries SET last_opened_at = ? WHERE series_id = ? AND shadowed = 0 AND position = 10`
			)
			.run(NOW, second);
		const parts = works.workParts(made.work.id, true);

		// Part 2 is where the run is: the plain row, naming the third.
		const row = works.seriesWorkRow(second, true)!;
		expect(row).toMatchObject({ id: made.work.id, name: 'Three', part: 2, of: 3 });
		expect(row.prev).toEqual({ seriesId: first, title: expect.any(String) });
		expect(row.next).toEqual({ seriesId: third, title: expect.any(String) });
		expect(row.state).toBe('in-progress');
		expect(row.accent).toBe(false);
		expect(row.nextPart).toBeNull();
		expect(row.nextTitle).toBe(parts[2].title);
		expect(row.youAreIn).toBeNull();

		// Part 1 is read through and the owner is already in part 2: the row says
		// where the run is, and it is not the accent.
		const firstRow = works.seriesWorkRow(first, true)!;
		expect(firstRow.state).toBe('read-through');
		expect(firstRow.youAreIn).toBe(parts[1].title);
		expect(firstRow.accent).toBe(false);
		expect(firstRow.prev).toBeNull();

		// Read part 2 through too: now it leads into the unstarted third, and the
		// accent carries the next part's first chapter.
		getDb()
			.prepare(`UPDATE entries SET read_at = ? WHERE series_id = ? AND shadowed = 0`)
			.run(NOW, second);
		const accent = works.seriesWorkRow(second, true)!;
		expect(accent.accent).toBe(true);
		expect(accent.youAreIn).toBeNull();
		expect(accent.nextPart).toMatchObject({ seriesId: third });
		expect(accent.nextPart!.entry).not.toBeNull();

		// A series in no Work has no row at all.
		expect(works.seriesWorkRow(third + 1000, true)).toBeNull();
	});
});

describe('a part’s place after a take-out (wave 16)', () => {
	it('says PART 2 OF 2 for the last part on every read, not its sparse position', () => {
		const ids = [
			idOf('Isekai Ojisan')!,
			idOf('Isekai Yakkyoku')!,
			idOf('Tensei Shitara Ken Deshita')!
		];
		const { work } = works.createWork({ seriesIds: ids, name: 'Three', now: NOW });
		// The middle part goes; the last keeps position 3, so the run is 1, 3.
		works.takeOut(work.id, ids[1]);
		expect(positions(work.id).map((p) => p.position)).toEqual([1, 3]);
		const last = ids[2];

		// The search hit (the library's card, `cardQuery`'s `work_part`).
		const hit = lib.search('Tensei Shitara', true).titles.find((t) => t.id === last)!;
		expect(hit.work).toMatchObject({ id: work.id, part: 2, of: 2 });
		// A tag page's and a person's page's foot (`workFeetFor`).
		expect(works.workFeetFor([last]).get(last)).toMatchObject({ part: 2, of: 2 });
		// The series screen's WORK row (`seriesWorkRow`, through `partPlace`).
		expect(works.seriesWorkRow(last, true)).toMatchObject({ part: 2, of: 2 });
		// The first is still the first everywhere.
		expect(works.workFeetFor([ids[0]]).get(ids[0])).toMatchObject({ part: 1, of: 2 });

		// UNDO puts the middle back at its own place, and the numbers follow.
		works.undoTakeOut({
			workId: work.id,
			seriesId: ids[1],
			title: '',
			position: 2,
			ended: null
		});
		expect(works.workFeetFor(ids).get(last)).toMatchObject({ part: 3, of: 3 });
		expect(
			lib.search('Tensei Shitara', true).titles.find((t) => t.id === last)!.work
		).toMatchObject({ part: 3, of: 3 });
	});

	it('breaks a tie of positions by series id, as partPlace does', () => {
		const ids = STEM.map(idOf) as number[];
		const { work } = works.createWork({ seriesIds: ids, name: 'Tie', now: NOW });
		getDb().prepare(`UPDATE work_series SET position = 1 WHERE work_id = ?`).run(work.id);
		const [lo, hi] = [...ids].sort((a, b) => a - b);
		const feet = works.workFeetFor(ids);
		expect([feet.get(lo)!.part, feet.get(hi)!.part]).toEqual([1, 2]);
		expect(works.seriesWorkRow(hi, true)).toMatchObject({ part: 2, of: 2 });
	});
});

describe('hiding by id keeps a Work whole (wave 16)', () => {
	it('takes a part’s Work with it, both ways, and leaves a series in no Work alone', () => {
		const [a, b] = STEM.map(idOf) as number[];
		const loose = idOf('Chainsaw Man')!;
		const { work } = works.createWork({ seriesIds: [a, b], name: 'Isekai', now: NOW });

		const hid = works.setHiddenWhole([b, loose], true);
		expect([hiddenOf(a), hiddenOf(b), hiddenOf(loose)]).toEqual([true, true, true]);
		expect(hid).toEqual({ ids: expect.arrayContaining([a, b, loose]), whole: [a, b], works: 1 });
		expect(hid.ids).toHaveLength(3);

		const shown = works.setHiddenWhole([a], false);
		expect([hiddenOf(a), hiddenOf(b), hiddenOf(loose)]).toEqual([false, false, true]);
		expect(shown).toMatchObject({ whole: [a, b], works: 1 });

		// No Work in the ids: exactly setHidden, and nothing about a Work.
		expect(works.setHiddenWhole([loose], false)).toEqual({ ids: [loose], whole: [], works: 0 });
		expect(hiddenOf(loose)).toBe(false);
		expect(works.worksTouched([a, loose])).toEqual([work.id]);
	});

	it('counts each Work a selection touches once', () => {
		const one = works.createWork({ seriesIds: STEM.map(idOf) as number[], name: 'A', now: NOW });
		const two = works.createWork({
			seriesIds: [idOf('Sousou no Frieren')!, idOf('Dungeon Meshi')!],
			name: 'B',
			now: NOW
		});
		const facts = works.setHiddenWhole([...partsOf(one.work.id), partsOf(two.work.id)[0]], true);
		expect(facts.works).toBe(2);
		expect(facts.whole).toHaveLength(4);
		expect([...partsOf(one.work.id), ...partsOf(two.work.id)].every(hiddenOf)).toBe(true);
	});
});

/**
 * The library's and the Work screen's own actions, called as SvelteKit calls
 * them: what an UNDO's refusal comes back as is the route's answer, not the
 * function's throw (c308: "a refusal the route shows, never a 500").
 */
const library = await import('../src/routes/+page.server');
const workScreen = await import('../src/routes/work/[id]/+page.server');
type Answer = { status?: number; data?: Record<string, unknown> } & Record<string, unknown>;
async function post(
	action: unknown,
	fields: [string, string | number][],
	params: Record<string, string> = {}
): Promise<Answer> {
	const body = new FormData();
	for (const [k, v] of fields) body.append(k, String(v));
	const request = new Request('http://localhost/', { method: 'POST', body });
	try {
		return (await (action as (e: unknown) => Promise<Answer>)({
			request,
			params,
			url: new URL('http://localhost/'),
			cookies: { get: () => undefined }
		})) as Answer;
	} catch (e) {
		// A redirect is SvelteKit's success for these: the band leaves the page.
		if (e && typeof e === 'object' && 'location' in e) return { redirected: true };
		throw e;
	}
}
const ids = (list: number[]) => list.map((id) => ['id', id] as [string, number]);
const membersNow = (workId: number) => positions(workId).map((p) => p.seriesId);

describe('an UNDO never takes a series from the Work it joined since (c308)', () => {
	// Three unrelated, visible, unrated series in no Work, and two more.
	const pick = () =>
		[
			'Isekai Yakkyoku',
			'Tensei Shitara Ken Deshita',
			'Mushoku Tensei',
			'Villainess Level 99',
			'Chainsaw Man'
		].map(idOf) as number[];

	it('refuses a take-out’s UNDO once the series is in another Work, and leaves both Works whole', () => {
		const [a, b, c, d] = pick();
		const first = works.createWork({ seriesIds: [a, b, c], name: 'First', now: NOW });
		const out = works.takeOut(first.work.id, c);
		// The owner adds it to a second Work while the band's UNDO is still up.
		const second = works.createWork({ seriesIds: [c, d], name: 'Second', now: NOW });

		expect(() => works.undoTakeOut(out)).toThrow(works.WorkError);
		expect(() => works.undoTakeOut(out)).toThrow(/Mushoku Tensei is in Second now/i);
		// Before c308, INSERT OR REPLACE moved c back and left Second with one.
		expect(membersNow(second.work.id)).toEqual([c, d]);
		expect(membersNow(first.work.id)).toEqual([a, b]);
	});

	it('refuses to restore an ended Work whose member has joined another', () => {
		const [a, b, , d] = pick();
		const two = works.createWork({ seriesIds: [a, b], name: 'Two', now: NOW });
		const out = works.takeOut(two.work.id, b);
		expect(out.ended).not.toBeNull();
		const other = works.createWork({ seriesIds: [a, d], name: 'Other', now: NOW });

		expect(() => works.undoTakeOut(out)).toThrow(/Isekai Yakkyoku is in Other now/i);
		// The refusal is whole: the ended Work's row did not come back either.
		expect(workIds()).toEqual([other.work.id]);
		expect(membersNow(other.work.id)).toEqual([a, d]);
	});

	it('refuses an add’s UNDO once the series has moved on to a third Work', () => {
		const [a, b, c, d, e] = pick();
		const from = works.createWork({ seriesIds: [a, b, c], name: 'From', now: NOW });
		const into = works.createWork({ seriesIds: [d, e], name: 'Into', now: NOW });
		const added = works.addSeries(into.work.id, c);
		expect(added.former).toEqual({ workId: from.work.id, position: 3 });
		// The sheet moves it on again: Into keeps two, so nothing ends.
		const f = idOf('Honzuki no Gekokujou')!;
		const third = works.createWork({ seriesIds: [c, f], name: 'Third', now: NOW });

		expect(() => works.undoAdd(added)).toThrow(/is in Third now/i);
		expect(membersNow(third.work.id)).toEqual([c, f]);
		expect(membersNow(from.work.id)).toEqual([a, b]);
		expect(membersNow(into.work.id)).toEqual([d, e]);
	});

	it('refuses a create’s UNDO that would restore an ended Work over another', () => {
		const [a, b, c, d, e] = pick();
		const two = works.createWork({ seriesIds: [a, b], name: 'Two', now: NOW });
		const made = works.createWork({ seriesIds: [a, c], name: 'Made', now: NOW });
		expect(made.ended.map((x) => x.work.id)).toEqual([two.work.id]);
		const other = works.createWork({ seriesIds: [b, d], name: 'Other', now: NOW });

		expect(() => works.undoCreate(made)).toThrow(/is in Other now/i);
		expect(membersNow(other.work.id)).toEqual([b, d]);
		// Made is still there, whole: the delete was rolled back with the rest.
		expect(membersNow(made.work.id)).toEqual([a, c]);
		void e;
	});

	it('refuses a create’s UNDO once the Work holds a series the create never put in', () => {
		const [a, b, c] = pick();
		const made = works.createWork({ seriesIds: [a, b], name: 'Made', now: NOW });
		works.addSeries(made.work.id, c);
		expect(() => works.undoCreate(made)).toThrow(/Made has changed since/i);
		expect(membersNow(made.work.id)).toEqual([a, b, c]);
	});

	it('refuses an ungroup’s UNDO once a member is in another Work', () => {
		const [a, b, , d] = pick();
		const gone = works.ungroup(
			works.createWork({ seriesIds: [a, b], name: 'Gone', now: NOW }).work.id
		);
		const other = works.createWork({ seriesIds: [b, d], name: 'Other', now: NOW });
		expect(() => works.undoUngroup(gone)).toThrow(/is in Other now/i);
		expect(workIds()).toEqual([other.work.id]);
	});

	it('brings an ended Work back under a new id when a newer Work was given its own', () => {
		const [a, b, c, d] = pick();
		const two = works.createWork({ seriesIds: [a, b], name: 'Two', now: NOW });
		const out = works.takeOut(two.work.id, b);
		// works.id is a plain INTEGER PRIMARY KEY: the next Work reuses the id.
		const next = works.createWork({ seriesIds: [c, d], name: 'Next', now: NOW + 1 });
		expect(next.work.id).toBe(two.work.id);

		// Before, the restore's INSERT raised on the id: a 500, not an UNDO.
		works.undoTakeOut(out);
		const back = works.workOfSeries(a)!;
		expect(back).toMatchObject({ name: 'Two', createdAt: NOW, orderMode: two.work.orderMode });
		expect(back.id).not.toBe(next.work.id);
		expect(membersNow(back.id)).toEqual([a, b]);
		expect(works.workOfSeries(c)).toEqual(next.work);
		expect(membersNow(next.work.id)).toEqual([c, d]);
		// A second press of the same UNDO finds its members taken: by itself.
		expect(() => works.undoTakeOut(out)).toThrow(/is in Two now/i);
		// Nor may a create's UNDO delete the newer Work in its place.
		works.ungroup(back.id);
		const made = works.createWork({ seriesIds: [a, b], name: 'Made', now: NOW + 2 });
		works.ungroup(made.work.id);
		const reused = works.createWork({ seriesIds: [a, b], name: 'Reused', now: NOW + 3 });
		expect(reused.work.id).toBe(made.work.id);
		expect(() => works.undoCreate(made)).toThrow(/Made has changed since/i);
		expect(membersNow(reused.work.id)).toEqual([a, b]);
	});

	it('refuses to put back a series that has been deleted since', async () => {
		const [a, b, c] = pick();
		const three = works.createWork({ seriesIds: [a, b, c], name: 'Three', now: NOW });
		const out = works.takeOut(three.work.id, c);
		const { deleteSeries } = await import('$lib/server/delete');
		await deleteSeries([c], true);
		expect(() => works.undoTakeOut(out)).toThrow(/no longer in the library/);
		expect(membersNow(three.work.id)).toEqual([a, b]);
	});

	it('refuses to put a series hidden on its own since back into a visible Work', () => {
		const [a, b, c] = pick();
		const three = works.createWork({ seriesIds: [a, b, c], name: 'Three', now: NOW });
		const out = works.takeOut(three.work.id, c);
		works.setHiddenWhole([c], true);
		expect(() => works.undoTakeOuts([out])).toThrow(/hidden and visible series can't share/i);
		expect(membersNow(three.work.id)).toEqual([a, b]);
		expect(works.workOfSeries(c)).toBeNull();
	});

	it('undoes several take-outs as one write: a refusal puts none of them back', () => {
		const [a, b, c, d, e] = pick();
		const four = works.createWork({ seriesIds: [a, b, c, d], name: 'Four', now: NOW });
		const first = works.takeOut(four.work.id, c);
		const second = works.takeOut(four.work.id, d);
		works.createWork({ seriesIds: [c, e], name: 'Elsewhere', now: NOW });
		// d is free; c is not. Last first, d would go back before c refuses.
		expect(() => works.undoTakeOuts([first, second])).toThrow(/is in Elsewhere now/i);
		expect(membersNow(four.work.id)).toEqual([a, b]);
	});

	it('answers the library’s band UNDO with the refusal, never a 500', async () => {
		const [a, b, , d] = pick();
		const two = works.createWork({ seriesIds: [a, b], name: 'Two', now: NOW });
		// The Work screen's TAKE OUT of the second-to-last: the library carries
		// the band and its facts (`?band=ended`), which outlive a later action.
		const out = works.takeOut(two.work.id, b);
		const other = works.createWork({ seriesIds: [b, d], name: 'Other', now: NOW });
		const answer = await post(library.actions.undoWork, [
			['kind', 'ended'],
			['facts', JSON.stringify([out])],
			['from', 'band']
		]);
		expect(answer.status).toBe(400);
		expect(answer.data?.workMessage).toMatch(/TENSEI SHITARA KEN DESHITA IS IN OTHER NOW/);
		expect(membersNow(other.work.id)).toEqual([b, d]);
	});

	it('answers the Work screen’s UNDO with the refusal its band reads', async () => {
		const [a, b, c, d] = pick();
		const three = works.createWork({ seriesIds: [a, b, c], name: 'Three', now: NOW });
		const out = works.takeOut(three.work.id, c);
		const other = works.createWork({ seriesIds: [c, d], name: 'Other', now: NOW });
		const answer = await post(workScreen.actions.undoTakeOut, [['facts', JSON.stringify([out])]], {
			id: String(three.work.id)
		});
		expect(answer.status).toBe(400);
		expect(answer.data?.message).toMatch(/IS IN OTHER NOW/);
		expect(membersNow(other.work.id)).toEqual([c, d]);
		// And the Work screen's add UNDO the same way.
		const e = idOf('Chainsaw Man')!;
		const added = works.addSeries(three.work.id, e);
		works.createWork({ seriesIds: [e, idOf('Honzuki no Gekokujou')!], name: 'Away', now: NOW });
		const again = await post(workScreen.actions.undoAdd, [['facts', JSON.stringify(added)]], {
			id: String(three.work.id)
		});
		// e came from no Work, so its UNDO only takes it out of Three: nothing to
		// refuse, and Away keeps it.
		expect(again).toEqual({ ok: true });
		expect(works.workOfSeries(e)?.name).toBe('Away');
	});
});

describe('a HIDE’s UNDO puts back only what the HIDE changed (c390)', () => {
	const W = ['Isekai Yakkyoku', 'Tensei Shitara Ken Deshita', 'Mushoku Tensei'];

	it('leaves a Work hidden that was hidden before the press (the card’s TAKE OUT repro)', async () => {
		const [p, q, r] = W.map(idOf) as number[];
		const x = idOf('Villainess Level 99')!;
		const { work } = works.createWork({ seriesIds: [p, q, r], name: 'Run', now: NOW });
		works.setHiddenWhole([p], true);
		expect([p, q, r].every(hiddenOf)).toBe(true);

		// Reveal on, a person's page: P (an already-hidden part) and X, HIDE → TAKE OUT.
		const hid = await post(library.actions.hideParts, ids([p, x]));
		const facts = hid.hideFacts as { hidden: number[]; out: { seriesId: number }[] };
		expect(facts.hidden).toEqual([x]);
		expect(facts.out.map((o) => o.seriesId)).toEqual([p]);

		await post(library.actions.undoHide, [['facts', JSON.stringify(facts)]]);
		// P is back in its Work, and the Work is as it was: hidden, every part.
		expect(membersNow(work.id)).toEqual([p, q, r]);
		expect([p, q, r].map(hiddenOf)).toEqual([true, true, true]);
		expect(hiddenOf(x)).toBe(false);
	});

	it('does not over-show after HIDE ALL n either, nor over-hide after UNHIDE’s UNDO', async () => {
		const [p, q, r] = W.map(idOf) as number[];
		const loose = idOf('Villainess Level 99')!;
		works.createWork({ seriesIds: [p, q, r], name: 'Run', now: NOW });
		works.setHiddenWhole([loose], true);

		// A visible Work and a series hidden before: HIDE ALL hides the Work.
		const hid = await post(library.actions.hideAll, ids([p, loose]));
		const facts = hid.hideFacts as { hidden: number[]; whole: number[]; works: number };
		expect(facts).toMatchObject({ hidden: [p, q, r], whole: [p, q, r], works: 1 });
		await post(library.actions.undoHide, [['facts', JSON.stringify({ ...facts, out: [] })]]);
		expect([p, q, r].map(hiddenOf)).toEqual([false, false, false]);
		expect(hiddenOf(loose)).toBe(true);

		// And back: UNHIDE over the hidden Work and a series that was visible.
		works.setHiddenWhole([p], true);
		const other = idOf('Chainsaw Man')!;
		const shown = await post(library.actions.showAll, ids([q, other]));
		const sf = shown.showFacts as { shown: number[] };
		expect(sf.shown).toEqual([q, p, r]);
		await post(library.actions.undoShow, [['facts', JSON.stringify(sf)]]);
		expect([p, q, r].map(hiddenOf)).toEqual([true, true, true]);
		expect(hiddenOf(other)).toBe(false);
	});

	it('gives no band when the press changed no Work, as a plain HIDE of loose series has none', async () => {
		const [p, q, r] = W.map(idOf) as number[];
		const x = idOf('Villainess Level 99')!;
		works.createWork({ seriesIds: [p, q, r], name: 'Run', now: NOW });
		works.setHiddenWhole([p], true);
		expect(await post(library.actions.hideAll, ids([p, x]))).toEqual({ ok: true });
		expect(hiddenOf(x)).toBe(true);
		expect(works.setHiddenWhole([p, q], true)).toEqual({ ids: [], whole: [], works: 0 });
		// The series screen's HIDE ALL n reports the same: nothing changed.
		expect(works.hideWork(works.workOfSeries(p)!.id, true)).toEqual({ ids: [], changed: 0 });
	});

	it('reads a hidden root’s series as hidden: HIDE does not count one as changed', () => {
		const db = getDb();
		const x = idOf('Villainess Level 99')!;
		// Its root hidden and the series not made public: hidden already, by SQL's rule.
		db.prepare(
			`UPDATE roots SET hidden = 1 WHERE id = (SELECT root_id FROM series WHERE id = ?)`
		).run(x);
		db.prepare(
			`UPDATE series SET public = 0 WHERE root_id = (SELECT root_id FROM series WHERE id = ?)`
		).run(x);
		expect(works.setHiddenWhole([x], true).ids).toEqual([]);
	});

	it('puts a take-out back before it shows, so a Work of two comes back whole and visible', async () => {
		const [p, q] = W.map(idOf) as number[];
		const { work } = works.createWork({ seriesIds: [p, q], name: 'Two', now: NOW });
		const hid = await post(library.actions.hideParts, ids([p]));
		const facts = hid.hideFacts as { hidden: number[]; out: { ended: unknown }[] };
		expect(facts.hidden).toEqual([p]);
		expect(facts.out[0].ended).not.toBeNull();
		expect(works.workOfSeries(q)).toBeNull();

		await post(library.actions.undoHide, [['facts', JSON.stringify(facts)]]);
		expect(membersNow(work.id)).toEqual([p, q]);
		expect([p, q].map(hiddenOf)).toEqual([false, false]);
	});

	it('takes out every selected part of a Work of two: the second is on its own by then', async () => {
		const [p, q] = W.map(idOf) as number[];
		const { work } = works.createWork({ seriesIds: [p, q], name: 'Two', now: NOW });
		// The second part's take-out has no Work to leave: the first ended it.
		// That is the branch the route once caught; inside one write it cannot
		// fail, and what is left is hidden as a series on its own.
		const hid = await post(library.actions.hideParts, ids([p, q]));
		const facts = hid.hideFacts as { hidden: number[]; out: unknown[] };
		expect(facts.out).toHaveLength(1);
		expect([p, q].map(hiddenOf)).toEqual([true, true]);
		await post(library.actions.undoHide, [['facts', JSON.stringify(facts)]]);
		expect(membersNow(work.id)).toEqual([p, q]);
		expect([p, q].map(hiddenOf)).toEqual([false, false]);
	});

	it('refuses the HIDE’s UNDO, whole, once a taken-out part has joined another Work', async () => {
		const [p, q, r] = W.map(idOf) as number[];
		const d = idOf('Villainess Level 99')!;
		const { work } = works.createWork({ seriesIds: [p, q, r], name: 'Run', now: NOW });
		const hid = await post(library.actions.hideParts, ids([p]));
		works.setHiddenWhole([d], true);
		works.createWork({ seriesIds: [p, d], name: 'Elsewhere', now: NOW });
		const answer = await post(library.actions.undoHide, [['facts', JSON.stringify(hid.hideFacts)]]);
		expect(answer.status).toBe(400);
		expect(answer.data?.workMessage).toMatch(/IS IN ELSEWHERE NOW/);
		// Neither half ran: P is still hidden, in the Work it joined.
		expect(hiddenOf(p)).toBe(true);
		expect(membersNow(work.id)).toEqual([q, r]);
	});
});
